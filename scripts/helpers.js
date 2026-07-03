'use strict';
// Small pure helpers and constants, shared across the app (classic scripts, no modules).
const $ = id => document.getElementById(id);

const WEEKDAYS = ['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
const MONTHS   = ['jan','feb','mars','apr','maj','juni','juli','aug','sep','okt','nov','dec'];

function pad(n){ return String(n).padStart(2, '0'); }
function capital(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtMoney(v){ return (Math.round(Number(v) || 0)).toLocaleString('sv-SE') + ' kr'; }
function fmtTime(d){ d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(d){ d = new Date(d); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
// past-oriented relative date for history: "Idag" / "Igår" / "2 jul"
function fmtWhen(d){
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((today - x) / 86400000);
  if(diff === 0) return 'Idag';
  if(diff === 1) return 'Igår';
  return fmtDate(d);
}
function dateKey(d){ d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayKey(){ return dateKey(new Date()); }

// Day-header label: "Idag" / "Imorgon" / "Onsdag" / "Fredag 4 juli"
function relativeDay(d){
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d);    x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - today) / 86400000);
  if(diff === 0) return 'Idag';
  if(diff === 1) return 'Imorgon';
  const wd = capital(WEEKDAYS[x.getDay()]);
  if(diff > 1 && diff < 7) return wd;
  return `${wd} ${x.getDate()} ${MONTHS[x.getMonth()]}`;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
// only allow hex colors from the DB into inline styles
function safeColor(c){
  return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : null;
}
// per-person palette; auto-assigns a stable colour by profile id until one is chosen
const PALETTE = ['#7c5cc4','#3d8f6a','#d98a2b','#4f8fd6','#c94f9c','#3fae9a','#cf5f72','#b8863d'];
function profileColor(p){
  if(!p) return 'var(--faint)';
  const chosen = safeColor(p.color);
  if(chosen) return chosen;
  let h = 0;
  const s = String(p.id || '');
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
// calendar event categories (client-side list; add/rename freely)
const CATEGORIES = [
  { key:'aktivitet', label:'Aktiviteter', emoji:'🏅', color:'#3d8f6a' },
  { key:'skola',     label:'Skola',       emoji:'📚', color:'#4f8fd6' },
  { key:'familj',    label:'Familj',      emoji:'👨‍👩‍👧', color:'#7c5cc4' },
  { key:'halsa',     label:'Hälsa',       emoji:'🏥', color:'#cf5f72' },
  { key:'kalas',     label:'Kalas',       emoji:'🎂', color:'#d98a2b' },
  { key:'annat',     label:'Annat',       emoji:'📌', color:'#6b6577' }
];
function categoryOf(key){ return CATEGORIES.find(c => c.key === key) || CATEGORIES[CATEGORIES.length - 1]; }

// true once real Supabase values have replaced the placeholders in config.js
function isConfigured(){
  return !!(CONFIG && CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')
        && CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-'));
}
