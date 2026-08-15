'use strict';
// Dagens agenda — the app's landing screen. A calm, consolidated summary of *today* (events,
// cleaning, dinner, and — for parents — the approval queue) in ONE card with hairline-separated
// groups, plus a look-ahead "Imorgon" card (tomorrow's weather + events). Empty/positive states
// are omitted rather than shown as filler — the header already reports the event counts.
// Reuses data already in `state`; reached again from anywhere via the header date.

function renderToday(){
  const box = $('todayBody');
  if(!box || !me) return;

  const groups = [];
  const evs = todaysEvents();
  if(evs.length) groups.push(agendaGroup('Idag', `<button class="ag-cap-link" type="button" data-go="calendar">Kalender ›</button>`, evs.map(agendaEventRow).join('')));
  const clean = cleaningGroup();     if(clean) groups.push(clean);
  groups.push(dinnerGroup());        // dinner is a daily staple — always shown
  const appr = approvalsGroup();     if(appr) groups.push(appr);
  const nudge = kidNudgeGroup();     if(nudge) groups.push(nudge);

  const todayCard = `<div class="ag-card">${groups.join('')}</div>`;
  box.innerHTML = todayCard + agendaTomorrow();
}

// One labelled group inside a card. `right` is optional (a link/count on the caption row).
function agendaGroup(caption, right, body){
  return `<div class="ag-group">
      <div class="ag-cap"><span>${caption}</span>${right || ''}</div>
      ${body}
    </div>`;
}

// ---- events ----
function todaysEvents(){
  const k = todayKey();
  return eventsOn(k);
}
function eventsOn(key){
  return (state.events || [])
    .filter(e => dateKey(e.starts_at) === key)
    .sort((a, b) => {
      if(a.all_day !== b.all_day) return a.all_day ? -1 : 1;   // heldag first
      return new Date(a.starts_at) - new Date(b.starts_at);
    });
}

function agendaEventRow(ev){
  const owner = ownerLabel(ev);
  const cat = categoryOf(ev.category);
  const when = ev.all_day
    ? 'Heldag'
    : fmtTime(ev.starts_at) + (ev.ends_at ? '–' + fmtTime(ev.ends_at) : '');
  const ongoing = !ev.all_day && isOngoing(ev);
  return `
    <div class="ag-ev${ongoing ? ' is-ongoing' : ''}">
      <span class="ag-ev-time">${escapeHtml(when)}</span>
      <span class="ag-ev-title"><span class="ag-cat-dot" style="background:${cat.color}"></span>${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</span>
      <span class="ag-ev-av" title="${escapeHtml(owner.name)}">${avatarHtml(owner.color, owner.name)}</span>
    </div>`;
}

// ---- today's cleaning (Städschema) — parents only; kids aren't nudged about cleaning ----
function cleaningGroup(){
  if(!isParent()) return '';
  const tasks = state.cleaningTasks || [];
  if(!tasks.length) return '';
  const todayIdx = todayWeekdayIdx();
  const relevant = tasks.filter(t => t.weekday === todayIdx)
    .concat(tasks.filter(t => t.weekday < todayIdx && !cleaningDoneRow(t.id)));
  if(!relevant.length) return '';   // nothing due or overdue → omit for a clean page
  const total = tasks.length;
  const done = tasks.filter(t => cleaningDoneRow(t.id)).length;
  const body = relevant.map(agendaCleanRow).join('');
  return agendaGroup('Städning idag',
    `<button class="ag-cap-link" type="button" data-go="cleaning">${done}/${total} ›</button>`, body);
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
function dinnerGroup(){
  const meal = (typeof mealForDate === 'function') ? mealForDate(todayKey()) : null;
  let line;
  if(meal && meal.title){
    line = `<div class="ag-line"><span class="ag-line-ico">🍽</span><span class="ag-line-main"><b>${escapeHtml(meal.title)}</b>${meal.note ? ` <span class="ag-line-sub">${escapeHtml(meal.note)}</span>` : ''}</span></div>`;
  } else if(isParent()){
    line = `<button class="ag-line ag-line-btn" type="button" data-go="meal"><span class="ag-line-ico">🍽</span><span class="ag-line-main muted">Planera middag</span><span class="ag-caret">›</span></button>`;
  } else {
    line = `<div class="ag-line"><span class="ag-line-ico">🍽</span><span class="ag-line-main muted">Ingen middag planerad</span></div>`;
  }
  return agendaGroup('Middag ikväll', '', line);
}

// ---- parent approval queue (only when something is pending) ----
function approvalsGroup(){
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
  return agendaGroup('Att godkänna', '', rows);
}

// ---- kid: one light nudge toward Rutiner ----
function kidNudgeGroup(){
  if(isParent()) return '';
  if(!(state.behaviors || []).length) return '';
  const waiting = (state.markRequests || []).filter(r => r.profile_id === me.id && r.status === 'pending').length;
  const sub = waiting ? `${waiting} väntar på godkännande` : 'Bocka av dagens rutiner';
  const row = `
    <button class="ag-row" type="button" data-go="routines">
      <span class="ag-row-ico" aria-hidden="true">⭐</span>
      <span class="ag-row-txt"><b>Dagens rutiner</b> <span class="ag-line-sub">${escapeHtml(sub)}</span></span>
      <span class="ag-caret" aria-hidden="true">›</span>
    </button>`;
  return agendaGroup('Rutiner', '', row);
}

// ---- tomorrow heads-up: weather + events ----
function agendaTomorrow(){
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const evs = eventsOn(dateKey(tmr));
  const wx = (typeof tomorrowWeather !== 'undefined') ? tomorrowWeather : null;

  const wxHtml = wx ? `
    <div class="ag-wx">
      <span class="ag-wx-emoji" aria-hidden="true">${weatherEmoji(wx.code)}</span>
      <span class="ag-wx-temp">${Math.round(wx.max)}°<span class="ag-wx-min"> / ${Math.round(wx.min)}°</span></span>
      <span class="ag-wx-desc">${escapeHtml(weatherText(wx.code))}</span>
    </div>` : '';
  const evHtml = evs.length
    ? evs.map(agendaEventRow).join('')
    : `<div class="ag-line"><span class="ag-line-main muted">Inga händelser imorgon</span></div>`;

  const body = wxHtml + evHtml;
  return `<div class="ag-card ag-tomorrow">${agendaGroup(`Imorgon · ${escapeHtml(capital(WEEKDAYS[tmr.getDay()]))}`, '', body)}</div>`;
}

// ---- navigation ----
function onTodayClick(e){
  const clean = e.target.closest('[data-clean]');
  if(clean){ toggleCleaningDone(clean.dataset.clean); return; }
  const b = e.target.closest('[data-go]');
  if(!b) return;
  switch(b.dataset.go){
    case 'calendar': switchView('calendar'); break;
    case 'jobs':     switchView('tasks'); setTasksTab('jobs'); break;
    case 'routines': switchView('tasks'); setTasksTab('routines'); break;
    case 'rewards':  switchView('rewards'); break;
    case 'credits':  switchView('credits'); break;
    case 'cleaning': switchView('todos'); setTodoTab('cleaning'); break;
    case 'meal':     if(isParent()) openMealDialog(todayKey(), mealForDate(todayKey())); break;
  }
}
