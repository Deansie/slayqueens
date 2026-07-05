'use strict';
// Header weather widget + location picker. Uses Open-Meteo (free, keyless, CORS):
//   - forecast:  api.open-meteo.com          (current temperature + condition)
//   - geocoding: geocoding-api.open-meteo.com (search a town → coordinates)
// The chosen location is saved per device in localStorage and overrides the
// first-run default in config.js. Fully optional: the widget hides itself on any
// error and when weather is turned off (re-enable from the profile menu → Väderplats).

const WEATHER_KEY = 'slayqueens_weather';

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

// The active location: saved choice (incl. an {off:true} opt-out), else the config default.
function getWeatherLocation(){
  try{
    const raw = localStorage.getItem(WEATHER_KEY);
    if(raw){
      const l = JSON.parse(raw);
      if(l && (l.off || (typeof l.lat === 'number' && typeof l.lon === 'number'))) return l;
    }
  }catch(e){ /* fall through to the default */ }
  if(CONFIG.WEATHER_ENABLED && CONFIG.WEATHER_LAT != null && CONFIG.WEATHER_LON != null)
    return { lat: CONFIG.WEATHER_LAT, lon: CONFIG.WEATHER_LON, label: CONFIG.WEATHER_LABEL || '' };
  return null;
}
function saveWeatherLocation(loc){
  try{ localStorage.setItem(WEATHER_KEY, JSON.stringify(loc)); }catch(e){ console.warn('save weather loc', e); }
}

async function initWeather(){
  const box = $('weather');
  if(!box) return;
  const loc = getWeatherLocation();
  if(!loc || loc.off){ box.hidden = true; return; }
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(loc.lat)}`
      + `&longitude=${encodeURIComponent(loc.lon)}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(url);
    if(!r.ok) throw new Error('weather ' + r.status);
    const j = await r.json();
    const c = j && j.current;
    if(!c || c.temperature_2m == null) throw new Error('no data');
    $('wxTemp').textContent = Math.round(c.temperature_2m);
    $('wxDesc').textContent = weatherText(c.weather_code);
    const locEl = $('wxLoc');
    if(locEl) locEl.textContent = loc.label || '';
    box.hidden = false;
  }catch(e){
    console.warn('weather', e);
    box.hidden = true;
  }
}

// ---- location picker dialog ----
let wxSearchTimer = null;

function openWeatherDialog(){
  const dlg = $('weatherDialog');
  if(!dlg) return;
  $('wxSearch').value = '';
  $('wxResults').innerHTML = '';
  renderWeatherCurrent();
  dlg.showModal();
  $('wxSearch').focus();
}

function renderWeatherCurrent(){
  const el = $('wxCurrent');
  if(!el) return;
  const loc = getWeatherLocation();
  if(!loc || loc.off){ el.textContent = 'Väder är avstängt'; return; }
  el.textContent = 'Nuvarande: ' + (loc.label || `${(+loc.lat).toFixed(2)}, ${(+loc.lon).toFixed(2)}`);
}

function onWeatherSearchInput(){
  const q = $('wxSearch').value.trim();
  clearTimeout(wxSearchTimer);
  if(q.length < 2){ $('wxResults').innerHTML = ''; return; }
  wxSearchTimer = setTimeout(() => searchPlaces(q), 300);
}

async function searchPlaces(q){
  const box = $('wxResults');
  box.innerHTML = '<div class="wx-hint">Söker…</div>';
  try{
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=sv&format=json`;
    const r = await fetch(url);
    if(!r.ok) throw new Error('geo ' + r.status);
    const j = await r.json();
    const list = (j && j.results) || [];
    if(!list.length){ box.innerHTML = '<div class="wx-hint">Inga träffar</div>'; return; }
    box._results = list;
    box.innerHTML = list.map((p, i) => {
      const label = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
      return `<button type="button" class="wx-result" data-i="${i}">${escapeHtml(label)}</button>`;
    }).join('');
  }catch(e){
    console.warn('geocode', e);
    box.innerHTML = '<div class="wx-hint">Sökningen misslyckades</div>';
  }
}

function onWeatherResultsClick(e){
  const b = e.target.closest('[data-i]');
  if(!b) return;
  const box = $('wxResults');
  const p = box._results && box._results[Number(b.dataset.i)];
  if(!p) return;
  const label = [p.name, p.admin1].filter(Boolean).join(', ') || p.name;
  chooseWeatherLocation({ lat: p.latitude, lon: p.longitude, label });
}

function useMyLocation(){
  if(!navigator.geolocation){ toast('warn', 'Platstjänst stöds inte här'); return; }
  toast('', 'Hämtar plats…');
  navigator.geolocation.getCurrentPosition(
    pos => chooseWeatherLocation({
      lat: +pos.coords.latitude.toFixed(4),
      lon: +pos.coords.longitude.toFixed(4),
      label: 'Min plats'
    }),
    err => { console.warn('geolocation', err); toast('warn', 'Kunde inte hämta plats'); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}

function chooseWeatherLocation(loc){
  saveWeatherLocation(loc);
  const dlg = $('weatherDialog');
  if(dlg && dlg.open) dlg.close();
  toast('ok', 'Väderplats sparad');
  initWeather();
}

function turnWeatherOff(){
  saveWeatherLocation({ off: true });
  const dlg = $('weatherDialog');
  if(dlg && dlg.open) dlg.close();
  initWeather();
  toast('ok', 'Väder avstängt');
}
