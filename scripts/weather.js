'use strict';
// Header weather widget. Uses Open-Meteo (free, keyless, CORS-enabled). Fully optional:
// it stays hidden until a reading arrives and hides itself again on any failure, so the
// app never looks broken offline or if the location is misconfigured.

// WMO weather codes → short Swedish description.
function weatherText(code){
  const map = {
    0:'Klart', 1:'Mest klart', 2:'Halvklart', 3:'Molnigt',
    45:'Dimma', 48:'Dimma',
    51:'Duggregn', 53:'Duggregn', 55:'Duggregn', 56:'Underkylt regn', 57:'Underkylt regn',
    61:'Regn', 63:'Regn', 65:'Regn', 66:'Underkylt regn', 67:'Underkylt regn',
    71:'Snö', 73:'Snö', 75:'Snö', 77:'Snökorn',
    80:'Regnskurar', 81:'Regnskurar', 82:'Regnskurar', 85:'Snöbyar', 86:'Snöbyar',
    95:'Åska', 96:'Åska', 99:'Åska'
  };
  return map[code] || 'Väder';
}

async function initWeather(){
  const box = $('weather');
  if(!box) return;
  if(!CONFIG.WEATHER_ENABLED || CONFIG.WEATHER_LAT == null || CONFIG.WEATHER_LON == null){
    box.hidden = true; return;
  }
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(CONFIG.WEATHER_LAT)}`
      + `&longitude=${encodeURIComponent(CONFIG.WEATHER_LON)}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(url);
    if(!r.ok) throw new Error('weather ' + r.status);
    const j = await r.json();
    const c = j && j.current;
    if(!c || c.temperature_2m == null) throw new Error('no data');
    $('wxTemp').textContent = Math.round(c.temperature_2m);
    $('wxDesc').textContent = weatherText(c.weather_code);
    box.hidden = false;
  }catch(e){
    console.warn('weather', e);
    box.hidden = true;
  }
}
