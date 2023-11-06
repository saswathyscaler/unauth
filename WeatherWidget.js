import React, { useContext, useState, Suspense } from 'react';
import { ExclamationIcon } from '@heroicons/react/outline';
import { LocationMarkerIcon } from '@heroicons/react/solid';
import moment from 'moment';
import { ProjectContext } from '../../contexts/ProjectContext';
import { FullContainerLoadingSpinner, LoadingSpinner } from 'shared/components/LoadingSpinner';

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

const CONTAINER_HEIGHT = 190;
const CONTAINER_WIDTH = 404;

export const WeatherWidget = () => {
  const { weather } = useContext(ProjectContext);
  const { loading, error, data, zip } = weather;

  
  const distinctObjects = [];
  const distinctDates = {};
  
  for (const key in data.list) {
    if (Object.hasOwnProperty.call(data.list, key)) {
      const item = data.list[key];
      const date = item.dt_txt.split(' ')[0];
      if (!distinctDates[date]) {
        distinctDates[date] = true;
        distinctObjects.push(item);
      }
    }
  }
  
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  
  let selectedDay = null;
  if (!loading && !error) selectedDay = distinctObjects[selectedDayIdx || 0];
console.log(distinctObjects,"distinctObjects")  
  if (!!error) return (
    <div className="">
      <SectionHeader zip={zip} />
      <div className="px-2 overflow-y-auto bg-gray-50 border border-gray-200 rounded-sm shadow-inner w-80 sm:w-96 max-w-full sm:px-4 py-3" style={{ height: CONTAINER_HEIGHT, width: CONTAINER_WIDTH }}>
        <div className="flex flex-col justify-center items-center">
          <div className="bg-white p-1 rounded-full h-24 w-24 shadow-lg ring-1 ring-gray-100"><CloudMoonIcon /></div>
          <div className="p-1 mt-4 text-gray-500 text-center text-xs tracking-wide flex">
            <ExclamationIcon className="h-4 w-4 text-red-400 mr-1" />
            {error}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="">
      <SectionHeader date={selectedDay?.dt} zip={zip} />
      <div className="px-2 overflow-y-auto bg-white border border-gray-200 rounded-sm shadow-inner sm:px-4 py-3" style={{ height: CONTAINER_HEIGHT, width: CONTAINER_WIDTH }}>
        {loading && (
          <AnimatedLoadingMockup />
        )}
        {!!selectedDay && (
          <div className="flex flex-col justify-between h-full space-y-2">
            <SelectedDateInfo selectedDay={selectedDay} />
            <FiveDayForecast list={distinctObjects|| []} setSelectedDayIdx={setSelectedDayIdx} selectedDayIdx={selectedDayIdx} />
          </div>
        )}
      </div>
    </div>
  );
}


const SelectedDateInfo = ({ selectedDay }) => {
  // console.log("🚀 ~ file: WeatherWidget.js:58 ~ SelectedDateInfo ~ selectedDay:", selectedDay)
  return (
    <div className="flex flex-1 justify-between">
      <div className="">
        <WeatherIcon icon={selectedDay.icon} />
      </div>
      <div className="flex-grow-1">
        <SelectedDateDigest description={(selectedDay.weather?.[0] || {}).description} temp={selectedDay.main || {}} />
      </div>
      <div className="">
        <SelectedDateDetails weather={selectedDay} />
      </div>
    </div>
  )
}


const ForecastCard = ({ date, weather, selected }) => {
  let cardSelected = '';
  let imageSelected = 'bg-white bg-opacity-50 border-transparent';
  if (selected) {
    cardSelected = 'bg-blue-50 bg-opacity-50 ring-1 ring-blueGray-100 rounded-sm shadow-sm';
    imageSelected = 'bg-white border-blueGray-100 shadow-sm';
  };
  
  return (
    <div className={classNames(cardSelected, "flex flex-col items-center text-xxs w-full py-2 px-1 space-y-2 group-hover:bg-gray-200")}>
      <div className="flex-grow-1">
        <div className="text-gray-800 font-medium tracking-wide">
          {moment(date * 1000).format('ddd')}
        </div>
      </div>
      <div className={classNames(imageSelected, "rounded-sm w-5/6 flex justify-center border")}>
        <WeatherIcon small icon={weather.weather?.[0]?.icon} />
      </div>
      <div className="">
        {Math.round((weather.main?.temp_max)  || 0)}° F
      </div>
    </div>
  )
}





const FiveDayForecast = ({ list, setSelectedDayIdx, selectedDayIdx }) => {
 
  
  if (!list.length) return null;
  const dailyForecasts = list.slice(0, 5);
  

  return (
    <div className="flex w-full divide-x divide-gray-200">
      {dailyForecasts.map((day, i) => (
        <a key={i} className="cursor-pointer w-1/5 block bg-opacity-50 hover:bg-blueGray-50" onClick={() => setSelectedDayIdx(i)}>
          <ForecastCard selected={i === selectedDayIdx} date={day.dt} weather={day} />
        </a>
      ))}
    </div>
  );
}


const SelectedDateDetails = ({ weather }) => {
  const details = {
    wind: {
      data: (weather.wind?.speed  || 0).toFixed(1),
      unit: 'mph',
      title: 'Wind',
    },
    humidity: {
      data: weather.main.humidity || 0,
      unit: '%',
      title: 'Humidity',
    },
    precipitation: {
      data: weather.main.rain || weather.snow || 0,
      unit: 'mm',
      title: 'Precipitation',
    }
  }

  return (
    <div className="flex flex-col text-xxs">
      {Object.keys(details).map((key) => (
        <div key={key} className="flex items-center">
          <div className="text-gray-500 tracking-wide mr-2">
            {details[key].title}:
          </div>
          <div className="font-medium text-gray-600 tabular-nums tracking-tight">
            {details[key].data} {details[key].unit}
          </div>
        </div>
      ))}
    </div>
  );
}

const SelectedDateDigest = ({ description, temp }) => {
  const  high = Math.round((temp.temp_max ) || 0);
    const low = Math.round((temp.temp_min ) || 0);

  return (
    <>
      <div className="text-base text-gray-500 font-bold capitalize">
        {description}
      </div>
      <div className="text-xs text-gray-600 space-x-2 tabular-nums">
        <span>High: {high}° F</span>
        <span className="font-medium">|</span>
        <span>Low: {low}° F</span>
      </div>
    </>
  );
}

const WeatherIcon = ({ icon, small=false }) => {
  const size = small ? 'w-10 h-10 drop-shadow-md' : 'w-16 -mt-2 drop-shadow';
  const url = `http://openweathermap.org/img/wn/${icon || '02d'}@2x.png`
  return (
    <img
      src={url}
      alt="weather icon"
      className={size}
    />
  )
}

const SectionHeader = ({ date, zip }) => {
  const d = date ? date * 1000 : Date.now();
  return (
    <div className="flex justify-between mb-2">
      <div className="flex items-center text-gray-800 font-medium tracking-wide px-px space-x-4">
        <span className="">Weather</span>
        <span className="text-gray-600 text-light text-sm tracking-wide">
          {moment(d).format('ddd, MMM D, YYYY')}
        </span>
      </div>
      {!!zip && (
        <span className="text-xs text-gray-600 flex items-center pr-2">
          <LocationMarkerIcon className="w-4 h-4 mr-0.5 text-red-500" />
          {zip}
        </span>
      )}
    </div>
  )
}

const AnimatedLoadingMockup = () => {
  return (
    <div className="flex flex-col w-full py-2 px-2 overflow-hidden" style={{ height: CONTAINER_HEIGHT }}>
      <div className="max-w-sm w-full h-full mx-auto space-y-5">
        <div className="animate-pulse flex space-x-4">
          <div className="rounded-sm bg-gray-100 w-16"></div>
          <div className="flex-1 space-y-4 py-1">
            <div className="h-5 bg-gray-100 rounded"></div>
            <div className="h-2 bg-gray-100 rounded"></div>
          </div>
          <div className="w-1/4 space-y-2 py-1">
            <div className="h-2 bg-gray-100 rounded"></div>
            <div className="h-2 bg-gray-100 rounded"></div>
            <div className="h-2 bg-gray-100 rounded"></div>
          </div>
        </div>
        <div className="max-w-sm w-full h-full flex-1 mx-auto space-y-2 pb-2 overflow-hidden">
          <div className="animate-pulse flex h-full space-x-1">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="rounded-sm bg-gray-100 w-1/5 h-1/2"></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const CloudMoonIcon = () => (
  <svg version="1.1" x="0px" y="0px" viewBox="0 0 30 30" fill="#BCBCBC">
    <g>
    <path d="M2.66,20.92c0,0.23,0.08,0.42,0.25,0.57c0.17,0.16,0.38,0.23,0.62,0.23h18.61c0.24,0,0.44-0.08,0.6-0.23
	c0.17-0.16,0.25-0.35,0.25-0.57c0-0.24-0.08-0.45-0.24-0.61c-0.16-0.17-0.37-0.25-0.61-0.25H3.53c-0.24,0-0.44,0.08-0.61,0.25
	C2.75,20.48,2.66,20.69,2.66,20.92z M5.27,17.81c0,0.24,0.09,0.43,0.26,0.59c0.14,0.18,0.33,0.27,0.59,0.27h18.61
	c0.23,0,0.42-0.08,0.58-0.25s0.23-0.37,0.23-0.61c0-0.23-0.08-0.43-0.23-0.58C25.16,17.08,24.96,17,24.73,17H6.12
	c-0.24,0-0.44,0.08-0.6,0.23C5.35,17.39,5.27,17.58,5.27,17.81z M5.42,15.39v-0.05c-0.04,0.15,0,0.22,0.12,0.22h1.44
	c0.06,0,0.12-0.05,0.19-0.15c0.24-0.52,0.59-0.94,1.06-1.27c0.47-0.33,0.99-0.52,1.55-0.56l0.53-0.08c0.12,0,0.19-0.06,0.19-0.18
	l0.06-0.5c0.11-1.08,0.56-1.97,1.36-2.7c0.8-0.72,1.75-1.08,2.84-1.08c1.07,0,2.02,0.36,2.82,1.07s1.27,1.6,1.38,2.67l0.07,0.57
	c0,0.12,0.07,0.18,0.21,0.18h1.58c0.64,0,1.23,0.17,1.75,0.52c0.52,0.34,0.92,0.8,1.17,1.36c0.07,0.1,0.14,0.15,0.22,0.15h1.42
	c0.12,0,0.17-0.07,0.15-0.22c-0.22-0.56-0.37-0.91-0.46-1.06c0.72-0.65,1.23-1.51,1.5-2.57l0.17-0.66c0.03-0.06,0.02-0.12-0.01-0.16
	c-0.03-0.04-0.07-0.07-0.12-0.07l-0.62-0.22c-0.89-0.26-1.57-0.78-2.04-1.58c-0.47-0.8-0.59-1.65-0.37-2.56l0.13-0.58
	c0.05-0.09,0.01-0.17-0.13-0.23l-0.84-0.23c-1.09-0.27-2.17-0.18-3.22,0.26c-1.05,0.44-1.87,1.15-2.47,2.12
	c-0.79-0.31-1.56-0.46-2.29-0.46c-1.39,0-2.62,0.44-3.71,1.31s-1.78,1.99-2.1,3.35c-0.84,0.2-1.58,0.6-2.22,1.21
	S5.67,14.55,5.42,15.39z M7,23.97c0,0.24,0.09,0.43,0.26,0.59c0.17,0.18,0.37,0.27,0.59,0.27H26.5c0.23,0,0.43-0.08,0.59-0.25
	c0.16-0.17,0.24-0.37,0.24-0.61c0-0.23-0.08-0.42-0.24-0.58s-0.36-0.23-0.59-0.23H7.86c-0.24,0-0.44,0.08-0.6,0.23
	C7.09,23.55,7,23.74,7,23.97z M18.51,8.7c0.35-0.57,0.82-1.02,1.41-1.33c0.59-0.31,1.21-0.44,1.87-0.38
	c-0.07,1.04,0.17,2.02,0.7,2.93c0.54,0.91,1.28,1.58,2.22,2.02c-0.15,0.35-0.4,0.71-0.75,1.07c-0.92-0.76-1.97-1.13-3.14-1.13H20.5
	C20.18,10.57,19.52,9.51,18.51,8.7z"/>
    </g>
  </svg>
);



