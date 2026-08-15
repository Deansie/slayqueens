'use strict';
// Dagens agenda — the app's landing screen. A calm summary of *today*: the day's events,
// tonight's dinner, and (for parents) what's waiting to be approved. It reuses data already
// in `state` — no new loaders. Reached again from anywhere via the crown home button.

function renderToday(){
  const box = $('todayBody');
  if(!box || !me) return;

  box.innerHTML = `
    ${agendaEvents()}
    ${agendaCleaning()}
    ${agendaDinner()}
    ${isParent() ? agendaApprovals() : agendaKidNudge()}
    ${agendaTomorrow()}`;
}

// ---- today's events ----
function todaysEvents(){
  const k = todayKey();
  return (state.events || [])
    .filter(e => dateKey(e.starts_at) === k)
    .sort((a, b) => {
      if(a.all_day !== b.all_day) return a.all_day ? -1 : 1;   // heldag first
      return new Date(a.starts_at) - new Date(b.starts_at);
    });
}

function agendaEvents(){
  const evs = todaysEvents();
  const rows = evs.length
    ? evs.map(agendaEventRow).join('')
    : `<div class="ag-empty">Inga händelser idag 🎉</div>`;
  return `
    <section class="ag-block">
      <div class="ag-head">
        <h2 class="section-title">Dagens schema</h2>
        <button class="ag-link" type="button" data-go="calendar">Kalender ›</button>
      </div>
      <div class="ag-events">${rows}</div>
    </section>`;
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
      <div class="ag-ev-when">
        <span class="ag-ev-time serif">${escapeHtml(when)}</span>
        ${ongoing ? '<span class="ev-live">Pågår</span>' : ''}
      </div>
      <div class="ag-ev-main">
        <div class="ag-ev-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</div>
        <div class="ag-ev-tags">
          <span class="cat-chip" style="--c:${cat.color}"><span class="dot"></span>${escapeHtml(cat.label)}</span>
          <span class="owner-chip">${avatarHtml(owner.color, owner.name)}${escapeHtml(owner.name)}</span>
        </div>
      </div>
    </div>`;
}

// ---- tonight's dinner (from Matsedel) ----
function agendaDinner(){
  const meal = (typeof mealForDate === 'function') ? mealForDate(todayKey()) : null;
  let body;
  if(meal && meal.title){
    body = `<div class="ag-dish serif">${escapeHtml(meal.title)}</div>
      ${meal.note ? `<div class="ag-dish-note">${escapeHtml(meal.note)}</div>` : ''}`;
  } else if(isParent()){
    body = `<button class="ag-empty ag-tap" type="button" data-go="meal">Ingen middag planerad — tryck för att planera</button>`;
  } else {
    body = `<div class="ag-empty">Ingen middag planerad än</div>`;
  }
  return `
    <section class="ag-block">
      <div class="ag-head"><h2 class="section-title">Middag ikväll</h2></div>
      ${body}
    </section>`;
}

// ---- parent approval queues ----
function agendaApprovals(){
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

  if(!items.length){
    return `
      <section class="ag-block">
        <div class="ag-head"><h2 class="section-title">Att godkänna</h2></div>
        <div class="ag-empty">Inget väntar på dig 👍</div>
      </section>`;
  }

  const rows = items.map(i => `
    <button class="ag-approve" type="button" data-go="${i.go}">
      <span class="ag-approve-ico" aria-hidden="true">${i.icon}</span>
      <span class="ag-approve-txt"><b>${i.n}</b> ${escapeHtml(i.label)}</span>
      <span class="ag-approve-caret" aria-hidden="true">›</span>
    </button>`).join('');

  return `
    <section class="ag-block">
      <div class="ag-head"><h2 class="section-title">Att godkänna</h2></div>
      <div class="ag-approvals">${rows}</div>
    </section>`;
}

// ---- kid: a single light nudge toward Rutiner (kept small on purpose) ----
function agendaKidNudge(){
  if(!(state.behaviors || []).length) return '';
  const waiting = (state.markRequests || []).filter(r => r.profile_id === me.id && r.status === 'pending').length;
  const sub = waiting ? `${waiting} väntar på godkännande` : 'Tryck för att bocka av dagens rutiner';
  return `
    <section class="ag-block">
      <button class="ag-approve" type="button" data-go="routines">
        <span class="ag-approve-ico" aria-hidden="true">⭐</span>
        <span class="ag-approve-txt"><b>Dagens rutiner</b><span class="ag-approve-sub">${escapeHtml(sub)}</span></span>
        <span class="ag-approve-caret" aria-hidden="true">›</span>
      </button>
    </section>`;
}

// ---- today's cleaning (Städschema) — parents only; kids aren't nudged about cleaning ----
function agendaCleaning(){
  if(!isParent()) return '';
  const tasks = state.cleaningTasks || [];
  if(!tasks.length) return '';                 // no schedule set up → hide the section
  const todayIdx = todayWeekdayIdx();
  const todays  = tasks.filter(t => t.weekday === todayIdx);
  const overdue = tasks.filter(t => t.weekday < todayIdx && !cleaningDoneRow(t.id));
  const relevant = todays.concat(overdue);
  const total = tasks.length;
  const done = tasks.filter(t => cleaningDoneRow(t.id)).length;

  const body = relevant.length
    ? `<div class="ag-clean">${relevant.map(agendaCleanRow).join('')}</div>`
    : `<div class="ag-empty">Inget städ idag ✓</div>`;

  return `
    <section class="ag-block">
      <div class="ag-head">
        <h2 class="section-title">Städning idag</h2>
        <button class="ag-link" type="button" data-go="cleaning">${done}/${total} ›</button>
      </div>
      ${body}
    </section>`;
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

// ---- tomorrow heads-up: weather + events ----
function agendaTomorrow(){
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const tKey = dateKey(tmr);
  const evs = (state.events || [])
    .filter(e => dateKey(e.starts_at) === tKey)
    .sort((a, b) => {
      if(a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return new Date(a.starts_at) - new Date(b.starts_at);
    });

  const wx = (typeof tomorrowWeather !== 'undefined') ? tomorrowWeather : null;
  const wxHtml = wx ? `
    <div class="ag-tmr-wx">
      <span class="ag-tmr-emoji" aria-hidden="true">${weatherEmoji(wx.code)}</span>
      <span class="ag-tmr-temp serif">${Math.round(wx.max)}°<span class="ag-tmr-min">/ ${Math.round(wx.min)}°</span></span>
      <span class="ag-tmr-desc">${escapeHtml(weatherText(wx.code))}</span>
    </div>` : '';

  const evHtml = evs.length
    ? evs.map(agendaEventRow).join('')
    : `<div class="ag-empty">Inga händelser imorgon</div>`;

  return `
    <section class="ag-block">
      <div class="ag-head"><h2 class="section-title">Imorgon · ${escapeHtml(capital(WEEKDAYS[tmr.getDay()]))}</h2></div>
      ${wxHtml}
      <div class="ag-events">${evHtml}</div>
    </section>`;
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
