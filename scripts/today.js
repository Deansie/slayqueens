'use strict';
// Dagens agenda — the app's landing screen. A calm summary of *today*: the day's events,
// tonight's dinner, and (for parents) what's waiting to be approved. It reuses data already
// in `state` — no new loaders. Reached again from anywhere via the crown home button.

function renderToday(){
  const box = $('todayBody');
  if(!box || !me) return;

  box.innerHTML = `
    ${agendaEvents()}
    ${agendaDinner()}
    ${isParent() ? agendaApprovals() : agendaKidNudge()}`;
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

// ---- navigation ----
function onTodayClick(e){
  const b = e.target.closest('[data-go]');
  if(!b) return;
  switch(b.dataset.go){
    case 'calendar': switchView('calendar'); break;
    case 'jobs':     switchView('tasks'); setTasksTab('jobs'); break;
    case 'routines': switchView('tasks'); setTasksTab('routines'); break;
    case 'rewards':  switchView('rewards'); break;
    case 'credits':  switchView('credits'); break;
    case 'meal':     if(isParent()) openMealDialog(todayKey(), mealForDate(todayKey())); break;
  }
}
