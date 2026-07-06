'use strict';
// Small pure helpers and constants, shared across the app (classic scripts, no modules).
const $ = id => document.getElementById(id);

const WEEKDAYS = ['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
const MONTHS   = ['jan','feb','mars','apr','maj','juni','juli','aug','sep','okt','nov','dec'];
const MONTHS_LONG = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];

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

// ---- Week helpers (Monday-first) for the matsedel ----
const MEAL_WEEKDAYS = ['Mån','Tis','Ons','Tor','Fre','Lör','Sön'];

// ISO-8601 week number of a date.
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3);         // nearest Thursday
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((t - firstThu) / (7 * 86400000));
}
// Monday of the week that is `offset` weeks from this one (0 = current).
function mondayOfWeek(offset){
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + offset * 7);
  return d;
}
// "6–12 juli" or, across a month boundary, "29 juni–5 juli"
function weekRangeLabel(mon){
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  if(mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${MONTHS_LONG[sun.getMonth()]}`;
  return `${mon.getDate()} ${MONTHS_LONG[mon.getMonth()]}–${sun.getDate()} ${MONTHS_LONG[sun.getMonth()]}`;
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
const PALETTE = ['#c98aa8','#5b8def','#7ea065','#d79b4e','#c94f9c','#3fae9a','#cf5f72','#b8863d'];
function profileColor(p){
  if(!p) return 'var(--faint)';
  const chosen = safeColor(p.color);
  if(chosen) return chosen;
  let h = 0;
  const s = String(p.id || '');
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
// first letter of a name, for the round avatars
function initialOf(name){ const s = String(name || '').trim(); return s ? s.charAt(0).toUpperCase() : '?'; }
// a coloured circle with an initial; `color` is a hex or a CSS var string (both are trusted here)
function avatarHtml(color, name){
  return `<span class="avatar" style="--c:${color}">${escapeHtml(initialOf(name))}</span>`;
}

// calendar event categories (client-side list; add/rename freely)
const CATEGORIES = [
  { key:'aktivitet', label:'Aktiviteter', emoji:'🏅', color:'#d79b4e' },
  { key:'skola',     label:'Skola',       emoji:'📚', color:'#7ea065' },
  { key:'familj',    label:'Familj',      emoji:'👨‍👩‍👧', color:'#caa25c' },
  { key:'halsa',     label:'Hälsa',       emoji:'🏥', color:'#d6788a' },
  { key:'kalas',     label:'Kalas',       emoji:'🎂', color:'#d98a2b' },
  { key:'annat',     label:'Annat',       emoji:'📌', color:'#8b95a1' }
];
function categoryOf(key){ return CATEGORIES.find(c => c.key === key) || CATEGORIES[CATEGORIES.length - 1]; }

// true once real Supabase values have replaced the placeholders in config.js
function isConfigured(){
  return !!(CONFIG && CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')
        && CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-'));
}
