'use strict';
// Dagens agenda — the app's landing screen. A calm, sectioned overview of *today*, in order:
// today's events (Idag), tonight's dinner (Middag, tap → Matsedel), the school panel (Skola),
// and a look-ahead "Imorgon" card. Pending-work callouts (the parent approval queue / a kid
// Rutiner nudge) float above when present. Each section is a serif header with a hairline rule
// and an optional "›" link, followed by its card(s). Empty/positive states are omitted rather
// than shown as filler — the header already reports the counts. Städning deliberately lives only
// in its own sub-tab (Att göra → Städschema), not here.
// Reuses data already in `state`; reached again from anywhere via the header date.

function renderToday(){
  const box = $('todayBody');
  if(!box || !me) return;

  const out = [];

  // Pending-work callouts float to the top when present (usually absent), so on a normal day
  // the agenda reads exactly Idag · Middag · Skola · Imorgon.
  const appr = approvalsSection();  if(appr) out.push(appr);   // parents, only when something is pending
  const nudge = kidNudgeSection();  if(nudge) out.push(nudge); // kids

  // 1) Idag — today's events (omitted entirely on a day with nothing in the calendar)
  const evsHtml = todayEventsHtml();
  if(evsHtml) out.push(agendaSection('Idag', navLink('calendar', 'Kalender'), evsHtml));

  // 2) Middag ikväll
  out.push(dinnerSection());

  // 3) Skola — school days (filled once school.js is loaded; silent otherwise)
  const school = schoolSection();
  if(school) out.push(school);

  // 4) Imorgon
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
      </div>
      <div class="ag-evc-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}${ongoing ? '<span class="ag-now">Pågår</span>' : ''}</div>
      ${ev.notes ? `<div class="ag-evc-sub">${escapeHtml(ev.notes)}</div>` : ''}
    </div>`;
}

// ---- Skola panel (parents, school days) — implemented in school.js; silent until then ----
// Shows today's school day; on a weekend/lov it looks ahead to the next school day instead of
// hiding, so a schedule that's been set up is always visible from the landing screen. Shown to
// everyone — the kids look up each other's times here too.
function schoolSection(){
  if(typeof nextSchoolDate !== 'function') return '';
  const when = nextSchoolDate();
  if(!when) return '';
  const rows = schoolOn(when);
  if(!rows.length) return '';
  const isToday = dateKey(when) === todayKey();
  const body = `
    <div class="ag-card ag-school">
      ${rows.map(schoolPanelRow).join('')}
      ${schoolMealRow(dateKey(when))}
    </div>`;
  const right = `${isToday ? '' : `<span class="ag-sec-when">${escapeHtml(relativeDay(when))}</span>`}${navLink('school', `${rows.length} barn`)}`;
  return agendaSection('Skola', right, body);
}
// The school lunch for the day the panel is showing, under the kids' rows. Always rendered —
// on a weekend or a lov there's no dish, but the row stays as the way in to the week's menu
// (that dialog is the only place the full week lives, keeping the agenda a single-day view).
function schoolMealRow(key){
  if(typeof schoolMealFor !== 'function') return '';
  const line = mealLine(schoolMealFor(key));
  const label = line || (weekHasMeals(key) ? 'Se veckans meny' : 'Ingen meny ännu');
  return `
    <button class="ag-school-meal" type="button" data-schoolmenu="${escapeHtml(key)}">
      <span class="ag-school-meal-ico" aria-hidden="true">🍽</span>
      <span class="ag-school-meal-main">
        <span class="ag-school-meal-cap">Skollunch</span>
        <span class="ag-school-meal-dish${line ? '' : ' is-empty'}">${escapeHtml(label)}</span>
      </span>
      <span class="ag-caret" aria-hidden="true">›</span>
    </button>`;
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

// ---- dinner ----
// The whole card is a button into Matsedel — where the meal is viewed and (by a parent) planned.
function dinnerSection(){
  const meal = (typeof mealForDate === 'function') ? mealForDate(todayKey()) : null;
  let main;
  if(meal && meal.title){
    main = `<span class="ag-meal-main"><b>${escapeHtml(meal.title)}</b>${meal.note ? `<span class="ag-meal-sub">${escapeHtml(meal.note)}</span>` : ''}</span>`;
  } else if(isParent()){
    main = `<span class="ag-meal-main muted">Planera middag</span>`;
  } else {
    main = `<span class="ag-meal-main muted">Ingen middag planerad</span>`;
  }
  const inner = `<span class="ag-meal-ico" aria-hidden="true">🍴</span>${main}<span class="ag-caret" aria-hidden="true">›</span>`;
  return agendaSection('Middag', linkLabel('Ikväll'),
    `<button class="ag-card ag-meal ag-meal-btn" type="button" data-go="matsedel">${inner}</button>`);
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

  const red = (typeof redDayName === 'function') ? redDayName(tmr) : null;

  // The summary line reports the *day* (why there's/there isn't school); the events themselves
  // are listed as their own cards below, so this stays a short context note even when there
  // are events — a school day with plans shows both "Skoldag som vanligt" and the event cards.
  let status;
  if(red){
    status = red;                                    // e.g. "Långfredag" — says why there's no school
  } else if(typeof isSchoolDay === 'function' && isSchoolDay(tmr)){
    status = 'Skoldag som vanligt';
  } else if(evs.length){
    status = `${evs.length} ${evs.length === 1 ? 'händelse' : 'händelser'}`;
  } else {
    status = 'Inget planerat än';
  }

  // A small hint listing the events (all-day first), so the day's plans are visible at a glance
  // without the weight of full cards — a left-aligned list with a time column that stays tidy
  // on a narrow phone.
  const listHtml = evs.length
    ? `<ul class="ag-tm-list">${evs.map(e => `
        <li class="ag-tm-ev">${e.private ? '🔒 ' : ''}${escapeHtml(e.title)}</li>`).join('')}</ul>`
    : '';

  const body = `
    <div class="ag-card ag-tomorrow">
      <div class="ag-tm-head">
        ${wxHtml}
        <span class="ag-tm-main">
          <span class="ag-tm-status">${escapeHtml(status)}</span>
        </span>
      </div>
      ${listHtml}
    </div>`;
  return agendaSection('Imorgon', linkLabel(capital(WEEKDAYS[tmr.getDay()])), body);
}

// ---- navigation ----
function onTodayClick(e){
  const menu = e.target.closest('[data-schoolmenu]');
  if(menu){ openSchoolMenu(menu.dataset.schoolmenu); return; }
  const b = e.target.closest('[data-go]');
  if(!b) return;
  switch(b.dataset.go){
    case 'calendar': switchView('calendar'); break;
    case 'school':   switchView('school'); break;
    case 'jobs':     switchView('tasks'); setTasksTab('jobs'); break;
    case 'routines': switchView('tasks'); setTasksTab('routines'); break;
    case 'rewards':  switchView('rewards'); break;
    case 'credits':  switchView('credits'); break;
    case 'matsedel': switchView('matsedel'); break;
  }
}
