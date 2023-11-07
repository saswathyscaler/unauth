const { Op, transaction, Sequelize } = require("sequelize");
const models = require("../../models/index.js");
const m = require("../middleware.js");
const uuid = require("uuid").v4;
const createCQRS = require("../../util/createCQRS");
const { PROJECT_ADDRESS_KEYS, PROJECT_OFFICERS_KEYS } = require("gmi-domain-logic");
const axios = require("axios");
const Logger = require("../../util/logger.js");
const pLimit = require('p-limit');
const { async } = require('regenerator-runtime');

exports.getProjects = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  let projectsPerPage = req.query.projectsPerPage || 20;
  let complete=req.query.complete || "";
  
  const statusArray=['In Progress', 'Active', 'Construction', 'Preconstruction', 'Other', 'None']
  if(complete==="Complete"){
    statusArray.push(complete)
  }
  const totalProjectsCount = await req.user.countUserProjects({
    where: { userDeletedAt: null,
              status:{
            [Sequelize.Op.or]:[statusArray,null]} },
  });

  if (projectsPerPage === "All") {
    projectsPerPage = totalProjectsCount;
  }

  const totalPages = Math.ceil(totalProjectsCount / projectsPerPage);
  const offset = (page - 1) * projectsPerPage;

  const userProjects = await req.user.getUserProjects({
    where: { userDeletedAt: null,
      status:{
        [Sequelize.Op.or]:[statusArray,null]} },
    offset,
    limit: projectsPerPage,
  });

  const up = userProjects || [];
  const results = await Promise.all(
    up.map(async (userProject) => {
      const [snapshot, latestVersion, lastVersionSeen] = await Promise.all([
        models.ProjectSnapshot.getAllProjectObject(userProject.ProjectId),
        models.ProjectEvents.getLatestVersion(userProject.ProjectId),
        models.LastProjectNotificationSeen.findOne({
          where: { UserId: req.user.id, ProjectId: userProject.ProjectId },
        }),
      ]);

      const p = snapshot || {};

      p.latestVersion = latestVersion;
      p.lastVersionSeen = lastVersionSeen || 0;

      return p;
    })
  );
 
  const response = { data: results, totalPages };
  return res.json(response);
};

exports.getNativeProjects = async (req, res) => {
  let userProjects = await req.user.getUserProjects({where:{userDeletedAt:null}});
  const up = userProjects || [];
  const results = await Promise.all(
    up.map(async (userProject) => {
      const [snapshot, latestVersion, lastVersionSeen] = await Promise.all([
        models.ProjectSnapshot.findOne({
          raw: true,
          where: { ProjectId: userProject.ProjectId },
        }),
        models.ProjectEvents.getLatestVersion(userProject.ProjectId),
        models.LastProjectNotificationSeen.findOne({
          where: { UserId: req.user.id, ProjectId: userProject.ProjectId },
        }),
      ]);
  
      const p = snapshot?.data || {};
  
      // exclude unnecessary properties from the output
      delete p.Photos;
      delete p.Reports;
      delete p.Tasks;
      delete p.Annotations;
      delete p.WorkCompletes;
      delete p.Documents;
  
      p.latestVersion = latestVersion;
      p.lastVersionSeen = lastVersionSeen || 0;
  
      return p;
    })
  );
  
  const json = JSON.stringify(results);
  return res.send(json);
};

const MAX_NOTIFICATION_EVENTS = 1000;

exports.getProject = async (req, res) => {
  const { projectId } = req.form;
  const userProject = await models.UserProject.findOne({
    where: { UserId: req.user.id, ProjectId: projectId, userDeletedAt: null },
  });

  if (!userProject) return res.sendStatus(401);

  const project = await models.ProjectSnapshot.getProject(
    userProject.ProjectId
  );
  project.latestVersion = await models.ProjectEvents.getLatestVersion(
    userProject.ProjectId
  );

  // update user's LastProjectNotificationSeen
  const lastNotificationSeen = await models.LastProjectNotificationSeen.findOne(
    { where: { UserId: req.user.id, ProjectId: projectId } }
  );
  let lastVersionSeen = 0;

  if (!lastNotificationSeen) {
    await models.LastProjectNotificationSeen.create({
      UserId: req.user.id,
      ProjectId: projectId,
      lastVersionSeen: project.latestVersion,
      seenAt: new Date(),
    });
  } else {
    lastVersionSeen = lastNotificationSeen.lastVersionSeen;

    lastNotificationSeen.lastVersionSeen = project.latestVersion;
    lastNotificationSeen.seenAt = new Date();
    await lastNotificationSeen.save();
  }

  // GET UP TO MAX PROJECT EVENTS FOR FEED
  const maxEvents = Math.min(MAX_NOTIFICATION_EVENTS, project.latestVersion);
  const recentEvents = await models.ProjectEvents.eventsSince(
    projectId,
    project.latestVersion - maxEvents
  );
  const data = await models.UserProject.findAll({
    where: {
      ProjectId: projectId,
      userDeletedAt: null,
    },
  });
  project.Users = data.map(({ UserId, userRole }) => ({
    UserId,
    role: userRole,
  }));
  const users = await models.User.findAll({
    where: { id: { [Op.in]: (project.Users || []).map((u) => u.UserId) } },
  });

  project.Users.forEach(
    (u) => (u.User = users.find((a) => `${a.id}` === `${u.UserId}`))
  );

  return res.json({ ...project, recentEvents, lastVersionSeen });
};

exports.createProject = async (req, res) => {
  const {
    projectNum,
    projectName,
    addressData = {},
    startDate = null,
    endDate = null,
    status = "",
  } = req.body;

  const newProject = {
    id: uuid(),
    name: projectName,
    num: projectNum,
    addressData,
    startDate,
    endDate,
    status,
  };
  const commands = [{ type: "createProject", data: newProject }];
  const cqrs = createCQRS(req.user);

  const statusCode = await cqrs.reconcileCommandQueue(
    newProject.id,
    1,
    commands
  );
  if (statusCode !== 200) return res.sendStatus(statusCode);
  res.json(newProject);
};

exports.updateProjectInfo = async (req, res) => {
  const { projectId } = req.form;
  const { projectNum, projectName, projectStatus, officers, addressData } = req.body;
 
  const project = await models.ProjectSnapshot.getProject(projectId);
  const commands = [];
  if (project.name !== projectName)
    commands.push({ type: "changeProjectName", data: { name: projectName } });
  if (project.num !== projectNum)
    commands.push({ type: "changeProjectNum", data: { num: projectNum } });
  if (project.status !== projectStatus)
    commands.push({ type: "changeProjectStatus", data: { status: projectStatus } });

  if (!!officers && typeof officers === "object") {
    const officersKeys = Object.keys(officers);
    const projectOfficers = project.officers || {};
    // check object contains only expected keys (ie, PROJECT_OFFICERS_KEYS)
    const newOfficers = Object.fromEntries(
      officersKeys
        .filter((k) => PROJECT_OFFICERS_KEYS.includes(k))
        .map((k) => [k, officers[k]])
    );

    // loop through array at projectOfficers[key] and check if it is different from array at newOfficers[key]
    const officersChanged = PROJECT_OFFICERS_KEYS.some(
      (key) =>
        (projectOfficers[key] || []).length !==
          (newOfficers[key] || []).length ||
        (projectOfficers[key] || []).some(
          (userId) => !(newOfficers[key] || []).includes(userId)
        )
    );

    if (officersChanged)
      commands.push({
        type: "updateProjectOfficers",
        data: { ...newOfficers },
      });
  }

  if (!!addressData && typeof addressData === "object") {
    const addressKeys = Object.keys(addressData);
    const projectAddressData = project.addressData || {};
    // check object contains only expected keys (ie, PROJECT_ADDRESS_KEYS)
    const newAddressData = Object.fromEntries(
      addressKeys
        .filter((k) => PROJECT_ADDRESS_KEYS.includes(k))
        .map((k) => [k, addressData[k]])
    );

    const addressChanged = PROJECT_ADDRESS_KEYS.some(
      (key) => (projectAddressData[key] || "") !== (newAddressData[key] || "")
    );
    if (addressChanged)
      commands.push({
        type: "updateProjectAddressData",
        data: { ...newAddressData },
      });
  }

  if (!commands.length) return res.sendStatus(200);

  const cqrs = createCQRS(req.user);

  const statusCode = await cqrs.reconcileCommandQueue(project.id, 1, commands);
  if (statusCode !== 200) return res.sendStatus(statusCode);

  return res.status(200).send("Project info updated");
};

exports.updateProjectAverageHourlyRate = async (req, res) => {
  const { projectId } = req.form;
  const { averageHourlyRate } = req.body;

  const project = await models.ProjectSnapshot.getProject(projectId);
  const commands = [];

  if (project.averageHourlyRate !== averageHourlyRate)
    commands.push({
      type: "changeProjectAverageHourlyRate",
      data: { averageHourlyRate },
    });
  if (!commands.length) return res.sendStatus(200);

  const cqrs = createCQRS(req.user);

  const statusCode = await cqrs.reconcileCommandQueue(project.id, 1, commands);
  if (statusCode !== 200) return res.sendStatus(statusCode);

  return res.status(200).send("Project average hourly rate updated");
};

exports.addUserToProject = async (req, res) => {
  const projectId = req.params["projectId"];
  const { email, role } = req.body;
  if (!models.User.validateEmail(email)) return res.status(422).send("Invalid email");

  try {
    let user = await models.User.findOne({ where: { email } });

    if (!user) {
      user = await models.User.create({ email });
      await user.sendSignUpEmail().catch((e) => console.log(e));
    }
    const project = await models.ProjectSnapshot.getProject(projectId);
    if (!project) return res.status(404).send("Project not found");

    const data = { email, role, userId: user.id };
    const commands = [{ type: "addUserByEmail", data }];
    const cqrs = createCQRS(req.user);
    const expectedVersion = await models.ProjectEvents.getLatestVersion(
      projectId
    );

    const statusCode = await cqrs.reconcileCommandQueue(
      projectId,
      expectedVersion,
      commands
    );
    if (statusCode !== 200) return res.sendStatus(statusCode);

    return res.status(200).send("User added to project");

    // return res.json({ id: user.id });
  } catch (error) {
    Logger.error(error);
    res.status(422).send("Could not retrieve project information");
  }
};

exports.fixBrokenDocuments = async (req, res) => {
  const projectId = req.params["projectId"];

  try {
    const project = await models.ProjectSnapshot.getProject(projectId);
    if (!project) return res.status(404).send("Project not found");

    const commands = [{ type: "fixBrokenDocuments", data: {} }];
    const cqrs = createCQRS(req.user);
    const expectedVersion = await models.ProjectEvents.getLatestVersion(
      projectId
    );

    const statusCode = await cqrs.reconcileCommandQueue(
      projectId,
      expectedVersion,
      commands
    );
    if (statusCode !== 200) return res.sendStatus(statusCode);

    return res.status(200).send("User added to project");
  } catch (error) {
    Logger.error(error);
    res.status(422).send("Could not retrieve project information");
  }
};

exports.getProjectWeather = async (req, res) => {
  const projectId = req.params["projectId"];

  try {
    const project = await models.ProjectSnapshot.getProject(projectId);
    if (!project) return res.status(404).send("Project not found");
    const addressData = project.addressData || {};
    let zip = (addressData.postalCode || "") + "";
    if (zip.length > 5) zip = zip.substring(0, 5);
    if (zip.length < 5 || !zip.match(/^[0-9]*$/))
      return res
        .status(422)
        .send(`Invalid zip code - ${zip} - please update in project settings`);

   
        const appid = process.env.OPEN_WEATHER_MAP_API_KEY;

    axios
      .get(
        ` https://api.openweathermap.org/data/2.5/forecast?zip=${zip},US&units=imperial&appid=${appid}`
      )
      .then(function (response) {
        res.json(response.data);
        // console.log(response.data,"response dtaa ******************************")
      })
      .catch(function (error) {
        const status = error.response ? error.response.status : 422;
        res
          .status(status)
          .send(
            [
              `Error ${status}:`,
              status === 404
                ? `Could not get weather for zip code ${zip}`
                : "Could not get weather data",
            ].join(" ")
          );
      });
  } catch (error) {
    Logger.error(error);
    res.status(422).send("Could not get project weather");
  }
};
exports.setup = (app) => {
  app.get('/api/suggestion/user/:projectId',async(req,res)=>{
    const { projectId } = req.params
    try{
      let usedUser=await models.UserProject.findAll({ where: { ProjectId: projectId,userDeletedAt:null } })
      usedUser=usedUser.map((i)=>i.UserId)
      const allUser=await models.User.findAll({where:{id:{[Op.notIn]: usedUser }}})
      return res.status(200).json({allUser})
    }
    catch(err){
      console.log(err)
      return res.status(500).json({message: err.message})
    }

  })


  app.get('/api/superadmin/:projectId',async(req,res)=>{
    const { projectId } = req.params
    try{
      let userProject = await models.UserProject.findAll({ where: { ProjectId: projectId,userDeletedAt:null } })
      userProject= userProject.map(item=>item.UserId)
      const users=await models.User.findAll({ where: { role: "super admin" } })
      let val=users.map(item=>item.id)
      val=val.filter((item)=>userProject.includes(item))
      return res.status(200).json({ val})
    }
    catch(err){
      return res.status(404).json({message: err.message});
    }
  })
  app.delete(
    "/api/users/project/:projectId/delete",
    m.authUser,
    async (req, res) => {
      const { users } = req.body;
      const { projectId } = req.params;
      try {
        const userProject = await models.UserProject.findOne({
          where: { UserId: req.user.id, ProjectId: projectId ,userDeletedAt:null},
        });
        if(req.user.role === "super admin" || userProject.userRole === "project admin"){
          await models.UserProject.update(
            { userDeletedAt: Date.now() },
            { where: { UserId: users ,ProjectId:projectId} },

          );
          const data = await models.UserProject.findAll({
            where: {
              ProjectId: projectId,
              userDeletedAt: null,
            },
          });
          const val = data.map(({ UserId, userRole }) => ({
            UserId,
            role: userRole,
          }));
          const project = await models.ProjectSnapshot.findOne({
            raw: true,
            where: { ProjectId: projectId },
          });
          await models.ProjectSnapshot.update(
            { data: { ...project.data, Users: val } },
            { raw: true, where: { ProjectId: projectId } }
          );
          return res.status(200).json({ message: "Sucessfully deleted" });

        }
        else {
          return res
            .status(403)
            .json({ message: "User doesn't have sufficient permissions" });
        }
      } catch (err) {
        return res.status(422).send("Could not remove users from project");
      }
    }
  );

  app.get("/api/userProject/:projectId", m.authUser, async (req, res) => {
    const { projectId } = req.params;
    try {
      const userProject = await models.UserProject.findOne({
        where: { UserId: req.user.id, ProjectId: projectId,userDeletedAt:null },
      });
      return res.status(200).json(userProject);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/userProject/:id/update", m.authUser, async (req, res) => {
    const { id } = req.params;
    const { UserId, userRole } = req.body;
    try {
      const user = await models.UserProject.findOne({
        where: { UserId: req.user.id, ProjectId: id ,userDeletedAt:null},
      });
      if(req.user.role === "super admin" || user.userRole === "project admin"){
        const userUpdate = await models.UserProject.findOne({
          where: { UserId: UserId, ProjectId: id ,userDeletedAt:null},
        });
        const data = { userRole };
        await userUpdate.update(data);
        return res.status(200).json({ message: "User updated successfully" });
      }
      else {
        return res
          .status(403)
          .json({ message: "User doesn't have sufficient permissions" });
      }
    } catch (error) {
      return res.status(403).send("Could not complete request");
    }
  });
  // this api for archive the project
  app.delete(
    "/api/admin/project/archive",
    m.authSuperAdmin,
    async (req, res) => {
      const { data } = req.body;
      try {
        await models.UserProject.destroy({ where: { ProjectId: data } });
        return res.status(200).json({ message: "Deleted Successfully" });
      } catch (error) {
        res.status(422).send("Could not delete project");
      }
    }
  );

  //This is for restoring Project from Project table
  app.post("/api/admin/project/restore", m.authSuperAdmin, async (req, res) => {
    const { projectId } = req.body;
    try {
      const data = await models.UserProject.restore({
        where: {
          ProjectId: projectId,
        },
      });
      return res.status(200).json({ data: data });
    } catch (error) {
      res.status(422).send("Could not Restore Project");
    }
  });
  
  // this api for show thw archived project data
 app.get(
  "/api/admin/project/archivedprojects",
  m.authSuperAdmin,
  async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    let projectsPerPage = req.query.projectsPerPage || 20;

    const archivedProjectsCount = await models.UserProject.count({
      paranoid: false,
      distinct: true,
      col: "ProjectId",
      where: {
        deletedAt: {
          [Op.not]: null,
        },
      },
    });

    if (projectsPerPage === "All") {
      projectsPerPage = archivedProjectsCount;
    }

    const totalPages = Math.ceil(archivedProjectsCount / projectsPerPage);
    const offset = (page - 1) * projectsPerPage;

    const userProjects = await models.UserProject.findAll({
      paranoid: false,
      attributes: [
        "ProjectId",
        [Sequelize.fn("COUNT", Sequelize.col("ProjectId")), "count"],
      ],
      group: ["ProjectId"],
      where: {
        deletedAt: {
          [Op.not]: null,
        },
      },
      offset,
      limit: projectsPerPage,
    });

    const up = userProjects || [];
    const results = await Promise.all(
      up.map(async (userProject) => {
        const [snapshot, latestVersion, lastVersionSeen] = await Promise.all([
          models.ProjectSnapshot.findOne({
            raw: true,
            where: { ProjectId: userProject.ProjectId },
          }),
          models.ProjectEvents.getLatestVersion(userProject.ProjectId),
          models.LastProjectNotificationSeen.findOne({
            where: { UserId: req.user.id, ProjectId: userProject.ProjectId },
          }),
        ]);

        const p = snapshot?.data || {};

        // exclude unnecessary properties from the output
        delete p.Photos;
        delete p.Reports;
        delete p.Tasks;
        delete p.Annotations;
        delete p.WorkCompletes;
        delete p.Documents;

        p.latestVersion = latestVersion;
        p.lastVersionSeen = lastVersionSeen || 0;

        return p;
      })
    );

    const response = { data: results, totalPages };
    return res.json(response);
  }
);

};
