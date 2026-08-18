'use strict';
// Skola — per-child school schedules. A recurring weekly base (each child's ordinary hours + an
// optional subject chip per weekday) plus per-date overrides for exceptions (a day off, or a
// one-off change). Parents manage it from the profile-menu "Skola" view; the landing screen's
// Skola panel and the header sub-line read today's rows. Family-read, parent-write (via RLS).

const SCHOOL_WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
// Subject chips a parent can attach to a school day (client-side list, like CATEGORIES).
const SCHOOL_ACTIVITIES = [
  { key: 'gympa',    label: 'Gympa' },
  { key: 'utflykt',  label: 'Utflykt' },
  { key: 'slojd',    label: 'Slöjd' },
  { key: 'musik',    label: 'Musik' },
  { key: 'simning',  label: 'Simning' },
  { key: 'bibliotek',label: 'Bibliotek' }
];
function schoolActivityLabel(key){
  const a = SCHOOL_ACTIVITIES.find(x => x.key === key);
  return a ? a.label : capital(key || '');
}
// '08:00[:00]' → '8.00' (Swedish clock style used across the UI)
function fmtSchoolTime(t){
  if(!t) return '';
  const [h, m] = String(t).split(':');
  return `${Number(h)}.${m}`;
}

let editingSchoolDay = null;      // { childId, weekday } while the weekday editor is open
let editingOverride  = null;      // { id|null, childId } while the override editor is open
let editingClosure   = null;      // { id|null } while the family-wide ledig-dag editor is open

// Only these four kids go to school; any other kid profile is left out of the Skola feature.
const SCHOOL_KIDS = ['abbe', 'julia', 'olle', 'alfred'];
function kids(){
  return (state.profiles || []).filter(p =>
    p.role === 'kid' && SCHOOL_KIDS.includes(String(p.name || '').trim().toLowerCase()));
}
function weekdayIdx(d){ return (new Date(d).getDay() + 6) % 7; }   // Mon=0 … Sun=6

// ---- röda dagar ----
// Swedish public holidays, computed rather than fetched: the fixed ones by date, the movable
// ones from Easter. Schools are closed on these, so they count as non-school days without
// anyone adding an avvikelse. NOTE: school holidays (lov) vary per kommun and are NOT covered
// here — those still need a per-date override.

// Easter Sunday (anonymous Gregorian algorithm).
function easterSunday(y){
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);      // 3 = mars, 4 = april
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
// First Saturday on or after a given date — midsommar- and allhelgonadagen are defined that way.
function saturdayFrom(y, month, day){
  const d = new Date(y, month - 1, day);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return dateKey(d);
}

// The holiday's name if `date` is a röd dag, else null.
function redDayName(date){
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const y = d.getFullYear(), key = dateKey(d);
  const on = (m, day) => dateKey(new Date(y, m - 1, day));

  const fixed = {
    [on(1, 1)]:  'Nyårsdagen',
    [on(1, 6)]:  'Trettondedag jul',
    [on(5, 1)]:  'Första maj',
    [on(6, 6)]:  'Nationaldagen',
    // Julafton/nyårsafton aren't formally röda dagar, but school is never in session then.
    [on(12, 24)]: 'Julafton',
    [on(12, 25)]: 'Juldagen',
    [on(12, 26)]: 'Annandag jul',
    [on(12, 31)]: 'Nyårsafton'
  };
  if(fixed[key]) return fixed[key];

  const e = easterSunday(y);
  const fromEaster = n => { const x = new Date(e); x.setDate(x.getDate() + n); return dateKey(x); };
  const movable = {
    [fromEaster(-2)]: 'Långfredag',
    [fromEaster(0)]:  'Påskdagen',
    [fromEaster(1)]:  'Annandag påsk',
    [fromEaster(39)]: 'Kristi himmelsfärds dag',
    [fromEaster(49)]: 'Pingstdagen'
  };
  if(movable[key]) return movable[key];

  if(key === saturdayFrom(y, 6, 20))  return 'Midsommardagen';
  if(key === saturdayFrom(y, 10, 31)) return 'Alla helgons dag';
  return null;
}

// ---- lediga dagar (family-wide lov / studiedagar) ----
// A shared closure list, managed once for the whole family (a "common group" in Skola settings),
// so a lov that applies to every kid doesn't need a per-child avvikelse each. Any date a closure
// covers is a non-school day for everyone — same precedence as a röd dag (a per-child avvikelse
// for that exact date still wins). end_date null = a single day (= start_date).
function closureOn(date){
  const k = dateKey(date);
  return (state.schoolClosures || []).find(c => k >= c.start_date && k <= (c.end_date || c.start_date)) || null;
}
function closureName(date){ const c = closureOn(date); return c ? c.label : null; }

// The resolved school day for a child on a date, or null if no school that day.
function schoolDayFor(childId, date){
  const wd = weekdayIdx(date);
  const base = (state.schoolWeekly || []).find(w => w.child_id === childId && w.weekday === wd) || null;
  const over = (state.schoolOverrides || []).find(o => o.child_id === childId && o.date === dateKey(date)) || null;
  if(over && over.no_school) return null;
  // A röd dag or a family-wide ledig dag (lov/studiedag) closes school — unless an avvikelse for
  // that exact date says otherwise.
  if(!over && (redDayName(date) || closureOn(date))) return null;
  const start = (over && over.start_time) || (base && base.start_time) || null;
  const end   = (over && over.end_time)   || (base && base.end_time)   || null;
  if(!start || !end) return null;
  const activity = (over && over.activity) || (base && base.activity) || null;
  return { start, end, activity };
}

// Kids with school on a given date, each { child, day }, sorted by start time.
function schoolOn(date){
  return kids()
    .map(child => ({ child, day: schoolDayFor(child.id, date) }))
    .filter(r => r.day)
    .sort((a, b) => a.day.start.localeCompare(b.day.start));
}
function schoolToday(){ return schoolOn(new Date()); }
function isSchoolDay(date){ return kids().some(c => schoolDayFor(c.id, date)); }

// The next date with school for anyone — today when it's a school day, else the coming
// weekday (looks a week ahead). Lets the agenda show the schedule on weekends and lov too.
function nextSchoolDate(){
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for(let i = 0; i < 8; i++){
    const d = new Date(base); d.setDate(d.getDate() + i);
    if(isSchoolDay(d)) return d;
  }
  return null;
}

// ---- school lunch (skolmaten.se, fetched server-side into `school_meals`) ----
function schoolMealFor(key){
  return (state.schoolMeals || []).find(m => m.date === key) || null;
}
// Monday of the week containing `date` (helpers' mondayOfWeek only covers the current week).
function mondayOfDate(date){
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// The dishes of a day as one readable line.
function mealLine(meal){
  return meal && meal.courses && meal.courses.length ? meal.courses.join(' · ') : '';
}
// Is there any lunch at all in the Mon–Fri week containing `key`? Lets the agenda tell
// "nothing served that day" apart from "no menu fetched yet".
function weekHasMeals(key){
  const mon = mondayOfDate(key);
  for(let i = 0; i < 5; i++){
    const d = new Date(mon); d.setDate(d.getDate() + i);
    if(schoolMealFor(dateKey(d))) return true;
  }
  return false;
}

// Full week behind the tap on the lunch row, with ‹ › to page between weeks. Opens on the week
// of the day the agenda is showing (the next school day), so a tap on a Saturday or Sunday
// lands on the week that's coming — not the one that just ended.
let menuMonday = null;

// The weeks we actually hold menus for — skolmaten only publishes about two weeks ahead, so
// paging is bounded by the fetched data rather than running off into empty weeks.
function menuWeekBounds(){
  const dates = (state.schoolMeals || []).map(m => m.date).sort();
  if(!dates.length) return null;
  return { first: mondayOfDate(dates[0]), last: mondayOfDate(dates[dates.length - 1]) };
}
function clampMonday(d){
  const b = menuWeekBounds();
  if(!b) return d;
  if(d < b.first) return b.first;
  if(d > b.last) return b.last;
  return d;
}

function openSchoolMenu(key){
  const from = key || (typeof nextSchoolDate === 'function' && nextSchoolDate()) || todayKey();
  menuMonday = clampMonday(mondayOfDate(from));
  renderSchoolMenu();
  $('schoolMenuDialog').showModal();
}

function shiftSchoolMenu(deltaWeeks){
  if(!menuMonday) return;
  const d = new Date(menuMonday);
  d.setDate(d.getDate() + deltaWeeks * 7);
  menuMonday = clampMonday(d);
  renderSchoolMenu();
}

function renderSchoolMenu(){
  const mon = menuMonday;
  if(!mon) return;
  const rows = [];
  for(let i = 0; i < 5; i++){                     // Mån–Fre; school lunch is a weekday thing
    const d = new Date(mon); d.setDate(d.getDate() + i);
    const k = dateKey(d);
    const line = mealLine(schoolMealFor(k));
    rows.push(`
      <div class="smenu-day${k === todayKey() ? ' is-today' : ''}">
        <div class="smenu-day-name">${SCHOOL_WEEKDAYS[i]}</div>
        <div class="smenu-day-dish${line ? '' : ' muted'}">${line ? escapeHtml(line) : 'Ingen meny'}</div>
      </div>`);
  }
  $('schoolMenuTitle').textContent = `v.${isoWeek(mon)}`;
  $('schoolMenuRange').textContent = weekRangeLabel(mon);
  $('schoolMenuBody').innerHTML = rows.join('');

  // Grey out the arrows at the edges of what's been published.
  const b = menuWeekBounds();
  $('schoolMenuPrev').disabled = !b || mon <= b.first;
  $('schoolMenuNext').disabled = !b || mon >= b.last;
}

// ---- management view (profile menu → Skola) ----
// Parents edit here; kids get the same overview read-only (they look up each other's times).
function renderSchool(){
  const box = $('schoolBody');
  if(!box || !me) return;
  const readOnly = !isParent();
  const list = kids();
  const kidsHtml = list.length
    ? list.map(c => schoolKidCard(c, readOnly)).join('')
    : `<div class="placeholder"><div class="ph-emoji">🎓</div><h3>Inga barn än</h3><p>Skolscheman läggs upp per barn.</p></div>`;
  // The shared "Lediga dagar" group leads, then a card per child.
  box.innerHTML = schoolClosuresSection(readOnly) + kidsHtml;
}

// The family-wide "Lediga dagar" group at the top of the Skola view — one card for the whole
// family listing upcoming lov/studiedagar/klämdagar (past ones drop off). Parents add/edit here;
// kids see it read-only. Each row leads with the type and trails with the date (range).
function schoolClosuresSection(readOnly){
  const today = todayKey();
  const upcoming = (state.schoolClosures || [])
    .filter(c => (c.end_date || c.start_date) >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const rows = upcoming.map(c => {
    const range = (c.end_date && c.end_date !== c.start_date)
      ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`
      : fmtDate(c.start_date);
    const body = `<span class="school-lov-name">${escapeHtml(c.label)}</span>
        <span class="school-lov-date">${escapeHtml(range)}</span>`;
    return readOnly
      ? `<div class="school-over is-static">${body}</div>`
      : `<button class="school-over" type="button" data-schoolclosure="${escapeHtml(c.id)}">${body}<span class="ag-caret" aria-hidden="true">✎</span></button>`;
  }).join('');
  return `
    <section class="school-kid school-lov">
      <div class="school-kid-head">
        <span class="school-lov-ico" aria-hidden="true">📅</span>
        <h3 class="school-kid-name serif">Lediga dagar</h3>
      </div>
      <p class="school-lov-hint">Lov, studiedagar och klämdagar — gäller alla barn.</p>
      <div class="school-over-head">
        <span>Kommande</span>
        ${readOnly ? '' : `<button class="school-over-add" type="button" data-schoolclosureadd="1">+ Lägg till</button>`}
      </div>
      ${rows || '<div class="school-over-none">Inga kommande lediga dagar</div>'}
    </section>`;
}

function schoolKidCard(child, readOnly){
  const days = [];
  for(let wd = 0; wd < 5; wd++){       // Mån–Fre only; no school on weekends
    const base = (state.schoolWeekly || []).find(w => w.child_id === child.id && w.weekday === wd);
    const inner = base
      ? `<span class="school-day-time">${escapeHtml(fmtSchoolTime(base.start_time))}–${escapeHtml(fmtSchoolTime(base.end_time))}</span>
         ${base.activity ? `<span class="school-chip">${escapeHtml(schoolActivityLabel(base.activity))}</span>` : ''}`
      : `<span class="school-day-empty">Ingen skola</span>`;
    days.push(readOnly
      ? `<div class="school-day is-static">
           <span class="school-day-name">${SCHOOL_WEEKDAYS[wd]}</span>
           ${inner}
         </div>`
      : `<button class="school-day" type="button" data-schoolday="${child.id}:${wd}">
           <span class="school-day-name">${SCHOOL_WEEKDAYS[wd]}</span>
           ${inner}
         </button>`);
  }
  const overs = (state.schoolOverrides || [])
    .filter(o => o.child_id === child.id && o.date >= todayKey())
    .sort((a, b) => a.date.localeCompare(b.date));
  const overRows = overs.map(o => {
    const label = o.no_school
      ? 'Ingen skola'
      : `${o.start_time ? fmtSchoolTime(o.start_time) + '–' + fmtSchoolTime(o.end_time) : ''}${o.activity ? ' · ' + schoolActivityLabel(o.activity) : ''}`.trim() || 'Ändrad dag';
    const body = `<span class="school-over-date">${escapeHtml(fmtDate(o.date))}</span>
        <span class="school-over-txt">${escapeHtml(label)}</span>`;
    return readOnly
      ? `<div class="school-over is-static">${body}</div>`
      : `<button class="school-over" type="button" data-schoolover="${o.id}">${body}<span class="ag-caret" aria-hidden="true">✎</span></button>`;
  }).join('');

  return `
    <section class="school-kid">
      <div class="school-kid-head">
        <span class="school-kid-av">${avatarHtml(profileColor(child), child.name)}</span>
        <h3 class="school-kid-name serif">${escapeHtml(capital(child.name))}</h3>
      </div>
      <div class="school-week">${days.join('')}</div>
      <div class="school-over-head">
        <span>Avvikelser</span>
        ${readOnly ? '' : `<button class="school-over-add" type="button" data-schooloveradd="${child.id}">+ Lägg till</button>`}
      </div>
      ${overRows || '<div class="school-over-none">Inga kommande avvikelser</div>'}
    </section>`;
}

function onSchoolClick(e){
  const day = e.target.closest('[data-schoolday]');
  if(day){ const [cid, wd] = day.dataset.schoolday.split(':'); openSchoolDayDialog(cid, Number(wd)); return; }
  const add = e.target.closest('[data-schooloveradd]');
  if(add){ openOverrideDialog(add.dataset.schooloveradd, null); return; }
  const over = e.target.closest('[data-schoolover]');
  if(over){
    const o = (state.schoolOverrides || []).find(x => x.id === over.dataset.schoolover);
    if(o) openOverrideDialog(o.child_id, o);
    return;
  }
  const closAdd = e.target.closest('[data-schoolclosureadd]');
  if(closAdd){ openClosureDialog(null); return; }
  const clos = e.target.closest('[data-schoolclosure]');
  if(clos){
    const c = (state.schoolClosures || []).find(x => x.id === clos.dataset.schoolclosure);
    if(c) openClosureDialog(c);
  }
}

// ---- weekly-day editor ----
function activityOptions(selected){
  return `<option value="">— ingen —</option>` +
    SCHOOL_ACTIVITIES.map(a => `<option value="${a.key}"${a.key === selected ? ' selected' : ''}>${a.label}</option>`).join('');
}

function openSchoolDayDialog(childId, weekday){
  editingSchoolDay = { childId, weekday };
  const child = state.profilesById[childId];
  const base = (state.schoolWeekly || []).find(w => w.child_id === childId && w.weekday === weekday);
  $('schoolDayTitle').textContent = `${child ? capital(child.name) : ''} · ${SCHOOL_WEEKDAYS[weekday]}`;
  $('schoolDayStart').value = base ? String(base.start_time).slice(0, 5) : '08:00';
  $('schoolDayEnd').value   = base ? String(base.end_time).slice(0, 5)   : '14:00';
  $('schoolDayActivity').innerHTML = activityOptions(base ? base.activity : '');
  $('schoolDayDelete').hidden = !base;
  $('schoolDayDialog').showModal();
}

async function saveSchoolDay(){
  if(!editingSchoolDay) return;
  const start = $('schoolDayStart').value, end = $('schoolDayEnd').value;
  if(!start || !end){ toast('warn', 'Ange start och slut'); return; }
  const activity = $('schoolDayActivity').value || null;
  try{
    const { error } = await sb.from('school_weekly')
      .upsert({ child_id: editingSchoolDay.childId, weekday: editingSchoolDay.weekday,
                start_time: start, end_time: end, activity, created_by: me.id },
              { onConflict: 'child_id,weekday' });
    if(error) throw error;
    toast('ok', 'Sparad');
    await loadSchoolWeekly();
    afterSchoolChange();
  }catch(err){ console.warn('saveSchoolDay', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteSchoolDay(){
  if(!editingSchoolDay) return;
  try{
    const { error } = await sb.from('school_weekly').delete()
      .eq('child_id', editingSchoolDay.childId).eq('weekday', editingSchoolDay.weekday);
    if(error) throw error;
    $('schoolDayDialog').close();
    toast('ok', 'Borttagen');
    await loadSchoolWeekly();
    afterSchoolChange();
  }catch(err){ console.warn('deleteSchoolDay', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- per-date override editor ----
function openOverrideDialog(childId, over){
  editingOverride = { id: over ? over.id : null, childId };
  const child = state.profilesById[childId];
  $('overrideTitle').textContent = `Avvikelse · ${child ? capital(child.name) : ''}`;
  $('overrideDate').value = over ? over.date : todayKey();
  $('overrideNoSchool').checked = over ? !!over.no_school : false;
  $('overrideStart').value = over && over.start_time ? String(over.start_time).slice(0, 5) : '';
  $('overrideEnd').value   = over && over.end_time   ? String(over.end_time).slice(0, 5)   : '';
  $('overrideActivity').innerHTML = activityOptions(over ? over.activity : '');
  $('overrideDelete').hidden = !over;
  reflectOverrideNoSchool();
  $('overrideDialog').showModal();
}
// A day off hides the time/activity fields (they don't apply).
function reflectOverrideNoSchool(){
  const off = $('overrideNoSchool').checked;
  const rows = $('overrideFields');
  if(rows) rows.hidden = off;
}

async function saveOverride(){
  if(!editingOverride) return;
  const date = $('overrideDate').value;
  if(!date){ toast('warn', 'Välj ett datum'); return; }
  const noSchool = $('overrideNoSchool').checked;
  const start = noSchool ? null : ($('overrideStart').value || null);
  const end   = noSchool ? null : ($('overrideEnd').value || null);
  const activity = noSchool ? null : ($('overrideActivity').value || null);
  try{
    const { error } = await sb.from('school_overrides')
      .upsert({ child_id: editingOverride.childId, date, no_school: noSchool,
                start_time: start, end_time: end, activity, created_by: me.id },
              { onConflict: 'child_id,date' });
    if(error) throw error;
    toast('ok', 'Sparad');
    await loadSchoolOverrides();
    afterSchoolChange();
  }catch(err){ console.warn('saveOverride', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteOverride(){
  if(!editingOverride || !editingOverride.id) return;
  try{
    const { error } = await sb.from('school_overrides').delete().eq('id', editingOverride.id);
    if(error) throw error;
    $('overrideDialog').close();
    toast('ok', 'Borttagen');
    await loadSchoolOverrides();
    afterSchoolChange();
  }catch(err){ console.warn('deleteOverride', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- lediga dagar editor (family-wide) ----
function openClosureDialog(clos){
  editingClosure = { id: clos ? clos.id : null };
  $('closureTitle').textContent = clos ? 'Ledig dag' : 'Ny ledig dag';
  $('closureLabel').value = clos ? clos.label : '';
  $('closureStart').value = clos ? clos.start_date : todayKey();
  $('closureEnd').value   = clos && clos.end_date ? clos.end_date : '';
  $('closureDelete').hidden = !clos;
  $('closureDialog').showModal();
}

async function saveClosure(){
  if(!editingClosure) return;
  const label = $('closureLabel').value.trim();
  const start = $('closureStart').value;
  let end = $('closureEnd').value || null;
  if(!label){ toast('warn', 'Ange en typ, t.ex. Höstlov'); return; }
  if(!start){ toast('warn', 'Välj ett startdatum'); return; }
  if(end && end < start){ toast('warn', 'Till-datumet är före från-datumet'); return; }
  if(end === start) end = null;          // a single day stores end_date null
  try{
    let error;
    if(editingClosure.id){
      ({ error } = await sb.from('school_closures')
        .update({ label, start_date: start, end_date: end }).eq('id', editingClosure.id));
    } else {
      ({ error } = await sb.from('school_closures')
        .insert({ label, start_date: start, end_date: end, created_by: me.id }));
    }
    if(error) throw error;
    $('closureDialog').close();
    toast('ok', 'Sparad');
    await loadSchoolClosures();
    afterSchoolChange();
  }catch(err){
    console.warn('saveClosure', err);
    toast('warn', err && err.code === '23505' ? 'Den finns redan' : 'Kunde inte spara');
  }
}

async function deleteClosure(){
  if(!editingClosure || !editingClosure.id) return;
  try{
    const { error } = await sb.from('school_closures').delete().eq('id', editingClosure.id);
    if(error) throw error;
    $('closureDialog').close();
    toast('ok', 'Borttagen');
    await loadSchoolClosures();
    afterSchoolChange();
  }catch(err){ console.warn('deleteClosure', err); toast('warn', 'Kunde inte ta bort'); }
}

// Repaint everything that reads the schedule after an edit.
function afterSchoolChange(){
  renderSchool();
  renderToday();
  renderHeader();
}
