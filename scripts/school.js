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

function kids(){ return (state.profiles || []).filter(p => p.role === 'kid'); }
function weekdayIdx(d){ return (new Date(d).getDay() + 6) % 7; }   // Mon=0 … Sun=6

// The resolved school day for a child on a date, or null if no school that day.
function schoolDayFor(childId, date){
  const wd = weekdayIdx(date);
  const base = (state.schoolWeekly || []).find(w => w.child_id === childId && w.weekday === wd) || null;
  const over = (state.schoolOverrides || []).find(o => o.child_id === childId && o.date === dateKey(date)) || null;
  if(over && over.no_school) return null;
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

// Earliest start / latest end across the kids in school on a date (formatted for display).
function schoolSummaryOn(date){
  const rows = schoolOn(date);
  let first = null, last = null;
  for(const r of rows){
    if(first === null || r.day.start < first) first = r.day.start;
    if(last === null || r.day.end > last) last = r.day.end;
  }
  return { firstOut: fmtSchoolTime(first), lastHome: fmtSchoolTime(last), count: rows.length };
}
function schoolSummaryToday(){ return schoolSummaryOn(new Date()); }

// ---- management view (profile menu → Skola, parents only) ----
function renderSchool(){
  const box = $('schoolBody');
  if(!box || !me) return;
  const list = kids();
  if(!isParent()){
    box.innerHTML = `<div class="placeholder"><div class="ph-emoji">🎓</div><h3>Skola</h3><p>Föräldrarna sköter skolschemat.</p></div>`;
    return;
  }
  if(!list.length){
    box.innerHTML = `<div class="placeholder"><div class="ph-emoji">🎓</div><h3>Inga barn än</h3><p>Skolscheman läggs upp per barn.</p></div>`;
    return;
  }
  box.innerHTML = list.map(schoolKidCard).join('');
}

function schoolKidCard(child){
  const days = [];
  for(let wd = 0; wd < 7; wd++){
    const base = (state.schoolWeekly || []).find(w => w.child_id === child.id && w.weekday === wd);
    const inner = base
      ? `<span class="school-day-time">${escapeHtml(fmtSchoolTime(base.start_time))}–${escapeHtml(fmtSchoolTime(base.end_time))}</span>
         ${base.activity ? `<span class="school-chip">${escapeHtml(schoolActivityLabel(base.activity))}</span>` : ''}`
      : `<span class="school-day-empty">Ingen skola</span>`;
    days.push(`
      <button class="school-day" type="button" data-schoolday="${child.id}:${wd}">
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
    return `
      <button class="school-over" type="button" data-schoolover="${o.id}">
        <span class="school-over-date">${escapeHtml(fmtDate(o.date))}</span>
        <span class="school-over-txt">${escapeHtml(label)}</span>
        <span class="ag-caret" aria-hidden="true">✎</span>
      </button>`;
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
        <button class="school-over-add" type="button" data-schooloveradd="${child.id}">+ Lägg till</button>
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

// Repaint everything that reads the schedule after an edit.
function afterSchoolChange(){
  renderSchool();
  renderToday();
  renderHeader();
}
