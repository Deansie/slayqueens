'use strict';
// Dagens agenda — the app's landing screen. A calm, sectioned overview of *today*: a school
// panel (parents, school days), the "Dagens båge" day-arc + today's events, cleaning, the
// approval queue, dinner, and a look-ahead "Imorgon" card. Each section is a serif header with a
// hairline rule and an optional "›" link, followed by its card(s). Empty/positive states are
// omitted rather than shown as filler — the header already reports the counts.
// Reuses data already in `state`; reached again from anywhere via the header date.

function renderToday(){
  const box = $('todayBody');
  if(!box || !me) return;

  const out = [];

  // 1) Skola — parents, school days (filled once school.js is loaded; silent otherwise)
  const school = schoolSection();
  if(school) out.push(school);

  // 2) Idag — the day-arc, then today's events
  out.push(agendaSection('Idag', navLink('calendar', 'Kalender'), dagensBageCard() + todayEventsHtml()));

  // 3) Städning idag (parents only — kids aren't nudged about cleaning)
  const clean = cleaningSection(); if(clean) out.push(clean);

  // 4) Att godkänna (parents, only when something is pending)
  const appr = approvalsSection();  if(appr) out.push(appr);

  // 5) Rutiner nudge (kids)
  const nudge = kidNudgeSection();  if(nudge) out.push(nudge);

  // 6) Middag ikväll
  out.push(dinnerSection());

  // 7) Imorgon
  out.push(agendaTomorrow());

  box.innerHTML = out.join('');
}

// ---- section + link scaffolding ----
// A titled section: big serif header + hairline rule + optional right-hand link, then a body.
function agendaSection(title, right, body){
  return `<section class="ag-sec">
      <div class="ag-sec-head">
        <h2 class="ag-sec-title serif">${escapeHtml(title)}</h2>
        <span class="ag-sec-rule" aria-hidden="true"></span>
        ${right || ''}
      </div>
      <div class="ag-sec-body">${body}</div>
    </section>`;
}
function navLink(go, label){
  return `<button class="ag-sec-link" type="button" data-go="${go}">${escapeHtml(label)} ›</button>`;
}

// ---- events ----
function todaysEvents(){ return eventsOn(todayKey()); }
function eventsOn(key){
  return (state.events || [])
    .filter(e => dateKey(e.starts_at) === key)
    .sort((a, b) => {
      if(a.all_day !== b.all_day) return a.all_day ? -1 : 1;   // heldag first
      return new Date(a.starts_at) - new Date(b.starts_at);
    });
}

function todayEventsHtml(){
  const evs = todaysEvents();
  if(!evs.length) return '';
  const allDay = evs.filter(e => e.all_day);
  const timed  = evs.filter(e => !e.all_day);
  let html = '';
  if(allDay.length) html += `<div class="ag-sub">Heldag</div>` + allDay.map(eventCard).join('');
  html += timed.map(eventCard).join('');
  return html;
}

// A rounded event card: colour-bordered, with time · category · attendee avatars, then title + note.
function eventCard(ev){
  const cat = categoryOf(ev.category);
  const when = ev.all_day
    ? 'Hela dagen'
    : fmtTime(ev.starts_at) + (ev.ends_at ? ' – ' + fmtTime(ev.ends_at) : '');
  const ongoing = !ev.all_day && isOngoing(ev);
  return `
    <div class="ag-evc${ongoing ? ' is-ongoing' : ''}" style="--evc:${cat.color}">
      <div class="ag-evc-top">
        <span class="ag-evc-when">${escapeHtml(when)}</span>
        <span class="ag-evc-cat"><span class="ag-cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}</span>
        <span class="ag-evc-avs">${eventAvatars(ev)}</span>
      </div>
      <div class="ag-evc-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}${ongoing ? '<span class="ag-now">Pågår</span>' : ''}</div>
      ${ev.notes ? `<div class="ag-evc-sub">${escapeHtml(ev.notes)}</div>` : ''}
    </div>`;
}

// Owned events show one avatar; family events (owner_id null) show a cluster of the whole family.
function eventAvatars(ev){
  if(ev.owner_id){
    const p = state.profilesById[ev.owner_id];
    return avatarHtml(p ? profileColor(p) : 'var(--faint)', p ? p.name : '?');
  }
  return (state.profiles || []).map(p => avatarHtml(profileColor(p), p.name)).join('');
}

// ---- Dagens båge (day-arc) ----
// A shallow arc from morning to evening with a "NU" marker at the current time and a peak dot at
// the next upcoming event today. Right caption reports the evening (a late event, or "fri").
const ARC_DAY_START = 6;    // 06:00 → left end
const ARC_DAY_END   = 22;   // 22:00 → right end
function arcProgress(hours){
  return Math.max(0, Math.min(1, (hours - ARC_DAY_START) / (ARC_DAY_END - ARC_DAY_START)));
}
function dagensBageCard(){
  const W = 320, H = 108, padX = 26, baseY = 82, archH = 46;
  const midX = W / 2, ctrlY = baseY - 2 * archH;
  // progress p ∈ [0,1] → point on the quadratic arc (x is linear because the control x is the midpoint)
  const px = p => padX + p * (W - 2 * padX);
  const py = p => baseY - 4 * archH * (1 - p) * p;

  const now = new Date();
  const nowP = arcProgress(now.getHours() + now.getMinutes() / 60);

  const timed = todaysEvents().filter(e => !e.all_day);
  const next = timed.find(e => new Date(e.starts_at) > now);
  // evening = a timed event starting at/after 17:00; drives the right-hand caption
  const evening = timed.filter(e => new Date(e.starts_at).getHours() >= 17).pop();

  let peakDot = '';
  if(next){
    const p = arcProgress(new Date(next.starts_at).getHours() + new Date(next.starts_at).getMinutes() / 60);
    const cat = categoryOf(next.category);
    peakDot = `
      <text x="${px(p)}" y="${py(p) - 12}" class="ag-arc-time" text-anchor="middle">${fmtTime(next.starts_at)}</text>
      <circle cx="${px(p)}" cy="${py(p)}" r="7" class="ag-arc-peak" style="stroke:${cat.color}"/>`;
  }

  const caption = evening
    ? `${escapeHtml(evening.title)} kl ${new Date(evening.starts_at).getHours()}`
    : 'Kvällen är fri';

  return `
    <div class="ag-arc-card">
      <div class="ag-arc-head">
        <span class="ag-arc-cap">Dagens båge</span>
        <span class="ag-arc-note">${caption}</span>
      </div>
      <svg class="ag-arc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dagens båge">
        <path d="M ${px(0)} ${baseY} Q ${midX} ${ctrlY} ${px(1)} ${baseY}" class="ag-arc-path"/>
        <circle cx="${px(1)}" cy="${baseY}" r="3" class="ag-arc-end"/>
        <circle cx="${px(0)}" cy="${baseY}" r="3" class="ag-arc-end"/>
        ${peakDot}
        <circle cx="${px(nowP)}" cy="${py(nowP)}" r="6" class="ag-arc-now"/>
        <text x="${px(nowP)}" y="${py(nowP) + 20}" class="ag-arc-nowlbl" text-anchor="middle">NU</text>
      </svg>
      <div class="ag-arc-ends"><span>Morgon</span><span>Kväll</span></div>
    </div>`;
}

// ---- Skola panel (parents, school days) — implemented in school.js; silent until then ----
function schoolSection(){
  if(typeof schoolToday !== 'function' || !isParent()) return '';
  const rows = schoolToday();
  if(!rows.length) return '';
  const sum = schoolSummaryToday();
  const body = `
    <div class="ag-card ag-school">
      <div class="ag-school-sum">
        <span class="ag-school-ico" aria-hidden="true">🎓</span>
        <span>Först ut <b>${escapeHtml(sum.firstOut)}</b> · sist hem <b>${escapeHtml(sum.lastHome)}</b></span>
      </div>
      ${rows.map(schoolPanelRow).join('')}
    </div>`;
  return agendaSection('Skola', navLink('school', `${rows.length} barn`), body);
}
function schoolPanelRow(r){
  const chip = r.day.activity
    ? `<span class="school-chip">${escapeHtml(schoolActivityLabel(r.day.activity))}</span>`
    : '';
  return `
    <div class="ag-school-row">
      <span class="ag-school-av">${avatarHtml(profileColor(r.child), r.child.name)}</span>
      <span class="ag-school-name">${escapeHtml(capital(r.child.name))}</span>
      <span class="ag-school-time">${escapeHtml(fmtSchoolTime(r.day.start))}–${escapeHtml(fmtSchoolTime(r.day.end))}</span>
      ${chip}
    </div>`;
}

// ---- today's cleaning (Städschema) — parents only ----
function cleaningSection(){
  if(!isParent()) return '';
  const tasks = state.cleaningTasks || [];
  if(!tasks.length) return '';
  const todayIdx = todayWeekdayIdx();
  const relevant = tasks.filter(t => t.weekday === todayIdx)
    .concat(tasks.filter(t => t.weekday < todayIdx && !cleaningDoneRow(t.id)));
  if(!relevant.length) return '';
  const total = tasks.length;
  const done = tasks.filter(t => cleaningDoneRow(t.id)).length;
  const body = `<div class="ag-card">${relevant.map(agendaCleanRow).join('')}</div>`;
  return agendaSection('Städning idag',
    `<button class="ag-sec-link" type="button" data-go="cleaning">${done}/${total} ›</button>`, body);
}
function agendaCleanRow(t){
  const isDone = !!cleaningDoneRow(t.id);
  const overdue = t.weekday < todayWeekdayIdx() && !isDone;
  return `
    <div class="cl-task${isDone ? ' done' : ''}${overdue ? ' overdue' : ''}">
      <button class="cl-check" data-clean="${t.id}" type="button" role="checkbox" aria-checked="${isDone}" aria-label="Klarmarkera">${isDone ? '✓' : ''}</button>
      <div class="cl-task-main">
        <div class="cl-task-title">${escapeHtml(t.title)}</div>
        ${overdue ? '<div class="cl-task-meta late">Släpar efter</div>' : ''}
      </div>
    </div>`;
}

// ---- dinner ----
function dinnerSection(){
  const meal = (typeof mealForDate === 'function') ? mealForDate(todayKey()) : null;
  let inner;
  if(meal && meal.title){
    inner = `<span class="ag-meal-ico" aria-hidden="true">🍴</span>
      <span class="ag-meal-main"><b>${escapeHtml(meal.title)}</b>${meal.note ? `<span class="ag-meal-sub">${escapeHtml(meal.note)}</span>` : ''}</span>`;
  } else if(isParent()){
    inner = `<span class="ag-meal-ico" aria-hidden="true">🍴</span>
      <span class="ag-meal-main muted">Planera middag</span><span class="ag-caret">›</span>`;
    return agendaSection('Middag', linkLabel('Ikväll'),
      `<button class="ag-card ag-meal ag-meal-btn" type="button" data-go="meal">${inner}</button>`);
  } else {
    inner = `<span class="ag-meal-ico" aria-hidden="true">🍴</span>
      <span class="ag-meal-main muted">Ingen middag planerad</span>`;
  }
  return agendaSection('Middag', linkLabel('Ikväll'), `<div class="ag-card ag-meal">${inner}</div>`);
}
// A non-interactive right-hand label (e.g. "Ikväll", "Tisdag").
function linkLabel(text){ return `<span class="ag-sec-when">${escapeHtml(text)}</span>`; }

// ---- parent approval queue (only when something is pending) ----
function approvalsSection(){
  if(!isParent()) return '';
  const jobs   = (state.tasks || []).filter(t => t.status === 'submitted').length;
  const marks  = (state.markRequests || []).filter(r => r.status === 'pending').length;
  const redeem = (state.redemptions || []).filter(r => r.status === 'pending').length;
  const payout = (state.payouts || []).filter(p => p.status === 'pending').length;
  const items = [
    { n: jobs,   go: 'jobs',     icon: '🧹', label: 'jobb att godkänna' },
    { n: marks,  go: 'routines', icon: '⭐', label: 'rutiner att godkänna' },
    { n: redeem, go: 'rewards',  icon: '🎁', label: 'belöningar att lösa in' },
    { n: payout, go: 'credits',  icon: '💸', label: 'utbetalningar att hantera' }
  ].filter(i => i.n > 0);
  if(!items.length) return '';
  const rows = items.map(i => `
    <button class="ag-row" type="button" data-go="${i.go}">
      <span class="ag-row-ico" aria-hidden="true">${i.icon}</span>
      <span class="ag-row-txt"><b>${i.n}</b> ${escapeHtml(i.label)}</span>
      <span class="ag-caret" aria-hidden="true">›</span>
    </button>`).join('');
  return agendaSection('Att godkänna', '', `<div class="ag-card">${rows}</div>`);
}

// ---- kid: one light nudge toward Rutiner ----
function kidNudgeSection(){
  if(isParent()) return '';
  if(!(state.behaviors || []).length) return '';
  const waiting = (state.markRequests || []).filter(r => r.profile_id === me.id && r.status === 'pending').length;
  const sub = waiting ? `${waiting} väntar på godkännande` : 'Bocka av dagens rutiner';
  const row = `
    <button class="ag-row" type="button" data-go="routines">
      <span class="ag-row-ico" aria-hidden="true">⭐</span>
      <span class="ag-row-txt"><b>Dagens rutiner</b> <span class="ag-row-sub">${escapeHtml(sub)}</span></span>
      <span class="ag-caret" aria-hidden="true">›</span>
    </button>`;
  return agendaSection('Rutiner', '', `<div class="ag-card">${row}</div>`);
}

// ---- tomorrow heads-up: weather + a school/plan line ----
function agendaTomorrow(){
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const tKey = dateKey(tmr);
  const evs = eventsOn(tKey);
  const wx = (typeof tomorrowWeather !== 'undefined') ? tomorrowWeather : null;

  const wxHtml = wx ? `
    <span class="ag-tm-wx">
      <span class="ag-tm-emoji" aria-hidden="true">${weatherEmoji(wx.code)}</span>
      <span class="ag-tm-temp">${Math.round(wx.max)}°<span class="ag-tm-min"> / ${Math.round(wx.min)}°</span></span>
    </span>` : '';

  let status;
  if(typeof isSchoolDay === 'function' && isSchoolDay(tmr)){
    status = 'Skoldag som vanligt';
  } else if(evs.length){
    status = `${evs.length} ${evs.length === 1 ? 'händelse' : 'händelser'}`;
  } else {
    status = 'Inget planerat än';
  }

  const body = `
    <div class="ag-card ag-tomorrow">
      ${wxHtml}
      <span class="ag-tm-main">
        <span class="ag-tm-status">${escapeHtml(status)}</span>
        <button class="ag-tm-plan" type="button" data-go="newEvent">+ Planera dagen</button>
      </span>
    </div>`;
  return agendaSection('Imorgon', linkLabel(capital(WEEKDAYS[tmr.getDay()])), body);
}

// ---- navigation ----
function onTodayClick(e){
  const clean = e.target.closest('[data-clean]');
  if(clean){ toggleCleaningDone(clean.dataset.clean); return; }
  const b = e.target.closest('[data-go]');
  if(!b) return;
  switch(b.dataset.go){
    case 'calendar': switchView('calendar'); break;
    case 'school':   switchView('school'); break;
    case 'jobs':     switchView('tasks'); setTasksTab('jobs'); break;
    case 'routines': switchView('tasks'); setTasksTab('routines'); break;
    case 'rewards':  switchView('rewards'); break;
    case 'credits':  switchView('credits'); break;
    case 'cleaning': switchView('todos'); setTodoTab('cleaning'); break;
    case 'meal':     if(isParent()) openMealDialog(todayKey(), mealForDate(todayKey())); break;
    case 'newEvent': if(typeof openEventDialog === 'function') openEventDialog(null); break;
  }
}
