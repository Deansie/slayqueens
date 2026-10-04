'use strict';
// Family calendar: one week at a time (Monday–Sunday, every day always shown), and add/edit/delete.
let editingEvent = null;
let categoryFilter = null;
let calWeekOffset = 0;      // 0 = this week, ±1 = neighbouring weeks (as in the matsedel)

function ownerLabel(ev){
  if(!ev.owner_id) return { name: 'Familjen', color: 'var(--gold)', letter: 'F' };
  const p = state.profilesById[ev.owner_id];
  if(!p) return { name: '—', color: 'var(--faint)', letter: '?' };
  return { name: capital(p.name), color: profileColor(p), letter: initialOf(p.name) };
}

// An event is "ongoing" if now falls between its start and end (events without an end
// get a 2-hour default window) — used for the amber PÅGÅR badge on today's cards.
function isOngoing(ev){
  if(ev.all_day) return false;
  const now = new Date();
  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 2 * 3600 * 1000);
  return now >= start && now <= end;
}

function renderCategoryFilter(){
  const box = $('catFilter');
  if(!box) return;
  const chip = (key, label, color) =>
    `<button class="fchip${categoryFilter === key ? ' active' : ''}" data-cat="${key || ''}" type="button">` +
    `${color ? `<span class="dot" style="--c:${color}"></span>` : ''}${label}</button>`;
  box.innerHTML = chip(null, 'Alla', null) +
    CATEGORIES.map(c => chip(c.key, escapeHtml(c.label), c.color)).join('');
}

function onCatFilterClick(e){
  const b = e.target.closest('[data-cat]');
  if(!b) return;
  categoryFilter = b.dataset.cat || null;
  renderCalendar();
}

function renderCalendar(){
  renderHeader();
  renderNotisBar();
  renderWeekNav();
  renderCategoryFilter();
  const list = $('eventList');
  list.innerHTML = '';

  const mon = mondayOfWeek(calWeekOffset);
  const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
  const keys = new Set(days.map(dateKey));
  const byDay = {};
  state.events
    .filter(ev => keys.has(dateKey(ev.starts_at)))
    .filter(ev => !categoryFilter || (ev.category || 'annat') === categoryFilter)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .forEach(ev => { const k = dateKey(ev.starts_at); (byDay[k] = byDay[k] || []).push(ev); });

  days.forEach((d, i) => list.appendChild(weekDay(d, i, byDay[dateKey(d)] || [])));
}

// ‹ v.41 › with the week's dates; away from this week, a pill leads back to it.
function renderWeekNav(){
  const box = $('calWeekNav');
  if(!box) return;
  const n = calWeekOffset;
  const mon = mondayOfWeek(n);
  const label = n === 0 ? 'Den här veckan'
    : n === -1 ? 'Förra veckan'
    : n === 1  ? 'Nästa vecka'
    : n < 0    ? `För ${-n} veckor sedan`
    :            `Om ${n} veckor`;
  box.innerHTML = `
    <div class="wk-nav-row">
      <button class="wk-arrow" data-calweek="-1" type="button" aria-label="Föregående vecka">‹</button>
      <div class="wk-mid">
        <div class="wk-eyebrow${n === 0 ? ' is-now' : ''}">${label}</div>
        <div class="wk-no serif">v.${isoWeek(mon)}</div>
        <div class="wk-range">${escapeHtml(weekRangeLabel(mon))}</div>
      </div>
      <button class="wk-arrow" data-calweek="1" type="button" aria-label="Nästa vecka">›</button>
    </div>
    ${n !== 0 ? '<button class="wk-today" data-calweek="today" type="button">↺ Till idag</button>' : ''}`;
}

function onWeekNavClick(e){
  const b = e.target.closest('[data-calweek]');
  if(!b) return;
  const v = b.dataset.calweek;
  calWeekOffset = v === 'today' ? 0 : calWeekOffset + Number(v);
  renderCalendar();
}

// Coming back to Kalender from another tab always starts on this week.
function resetCalendarWeek(){
  if(calWeekOffset === 0) return;
  calWeekOffset = 0;
  renderCalendar();
}

// Weeks between this week and the one holding `key` ('YYYY-MM-DD').
function weekOffsetOf(key){
  const [y, m, d] = key.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  mon.setDate(mon.getDate() - (mon.getDay() + 6) % 7);
  return Math.round((mon - mondayOfWeek(0)) / (7 * 86400000));
}

// One day of the week: the date on the left (Sundays and röda dagar in red, as in a paper
// almanac), then that day's events, or a line that adds one when nothing is planned.
function weekDay(d, idx, evs){
  const key = dateKey(d), today = todayKey();
  const red = (typeof redDayName === 'function') ? redDayName(d) : null;
  const lov = (typeof closureName === 'function') ? closureName(d) : null;
  const day = document.createElement('div');
  day.className = 'wk-day'
    + (key === today ? ' is-today' : key < today ? ' is-past' : '')
    + (red || d.getDay() === 0 ? ' is-red' : '')
    + (evs.length ? '' : ' is-empty');
  day.setAttribute('role', 'group');
  day.setAttribute('aria-label', `${capital(WEEKDAYS[d.getDay()])} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`);
  const tags = (red ? `<span class="wk-tag red">${escapeHtml(red)}</span>` : '')
    + (lov ? `<span class="wk-tag lov">${escapeHtml(lov)}</span>` : '');
  day.innerHTML = `
    <div class="wk-date" aria-hidden="true">
      <span class="wk-wd">${key === today ? 'Idag' : MEAL_WEEKDAYS[idx]}</span>
      <span class="wk-num serif">${d.getDate()}</span>
    </div>
    <div class="wk-body">${tags ? `<div class="wk-tags">${tags}</div>` : ''}</div>`;
  const body = day.querySelector('.wk-body');
  if(evs.length){
    for(const ev of evs){
      const row = eventRow(ev);
      row.classList.add('in-week');
      body.appendChild(row);
    }
  } else {
    body.appendChild(emptyDay(d, key < today));
  }
  return day;
}

// A day without events. Upcoming days get "Inget planerat +", which opens Ny händelse on that
// date; past days (and days emptied by the category filter) just show a dash.
function emptyDay(d, past){
  if(past || categoryFilter){
    const dash = document.createElement('p');
    dash.className = 'wk-empty';
    dash.textContent = '—';
    return dash;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wk-empty wk-add';
  btn.innerHTML = '<span>Inget planerat</span><span class="wk-plus" aria-hidden="true">+</span>';
  btn.setAttribute('aria-label', `Ny händelse ${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`);
  btn.onclick = () => openEventDialog(null, dateKey(d));
  return btn;
}

function eventRow(ev){
  const row = document.createElement('article');
  const isToday = dateKey(ev.starts_at) === todayKey();
  const ongoing = isToday && isOngoing(ev);
  row.className = 'event' + (isToday ? ' is-today' : '') + (ongoing ? ' is-ongoing' : '');
  const owner = ownerLabel(ev);
  const cat = categoryOf(ev.category);
  const canEdit = (me && ev.created_by === me.id) || isParent();
  const when = ev.all_day
    ? 'Heldag'
    : fmtTime(ev.starts_at) + (ev.ends_at ? '–' + fmtTime(ev.ends_at) : '');
  row.innerHTML = `
    <div class="ev-top">
      <div class="ev-when">
        <span class="ev-time">${escapeHtml(when)}</span>
        ${ongoing ? '<span class="ev-live">Pågår</span>' : ''}
      </div>
      ${canEdit ? `
      <details class="ev-menu">
        <summary aria-label="Fler val">⋯</summary>
        <div class="ev-menu-pop">
          <button type="button" data-edit>✎ Redigera</button>
          <button type="button" data-del class="danger">🗑 Ta bort</button>
        </div>
      </details>` : ''}
    </div>
    <h3 class="ev-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</h3>
    ${ev.notes ? `<p class="ev-notes">${escapeHtml(ev.notes)}</p>` : ''}
    <div class="ev-foot">
      <div class="ev-tags">
        <span class="cat-chip" style="--c:${cat.color}"><span class="dot"></span>${escapeHtml(cat.label)}</span>
        <span class="owner-chip">${avatarHtml(owner.color, owner.name)}${escapeHtml(owner.name)}</span>
      </div>
      ${chatButton('event', ev.id)}
    </div>`;
  if(canEdit){
    const menu = row.querySelector('.ev-menu');
    const close = () => { if(menu) menu.open = false; };
    row.querySelector('[data-edit]').onclick = () => { close(); openEventDialog(ev); };
    row.querySelector('[data-del]').onclick  = () => { close(); deleteEvent(ev); };
  }
  return row;
}

function toggleTime(){
  $('timeRow').hidden = $('evAllDay').checked;
}

// `date` ('YYYY-MM-DD') pre-fills a new event's day; it defaults to today.
function openEventDialog(ev, date){
  editingEvent = ev || null;
  $('eventDlgTitle').textContent = ev ? 'Redigera händelse' : 'Ny händelse';

  const sel = $('evOwner');
  sel.innerHTML = '<option value="">Hela familjen</option>' +
    state.profiles.map(p => `<option value="${p.id}">${escapeHtml(capital(p.name))}</option>`).join('');
  $('evCategory').innerHTML = CATEGORIES.map(c => `<option value="${c.key}">${c.emoji} ${escapeHtml(c.label)}</option>`).join('');

  if(ev){
    const d = new Date(ev.starts_at);
    $('evTitle').value = ev.title || '';
    $('evDate').value  = dateKey(d);
    $('evStart').value = ev.all_day ? '' : fmtTime(d);
    $('evEnd').value   = (!ev.all_day && ev.ends_at) ? fmtTime(ev.ends_at) : '';
    $('evAllDay').checked = !!ev.all_day;
    sel.value = ev.owner_id || '';
    $('evCategory').value = ev.category || 'annat';
    $('evPrivate').checked = !!ev.private;
    $('evNotes').value = ev.notes || '';
  } else {
    $('evTitle').value = '';
    $('evDate').value  = date || todayKey();
    $('evStart').value = '';
    $('evEnd').value   = '';
    $('evAllDay').checked = false;
    sel.value = me ? me.id : '';
    $('evCategory').value = 'annat';
    $('evPrivate').checked = false;
    $('evNotes').value = '';
  }
  toggleTime();
  $('eventDialog').showModal();
}

async function saveEventFromDialog(){
  const title = $('evTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad det gäller'); return; }
  const date = $('evDate').value;
  if(!date){ toast('warn', 'Välj datum'); return; }

  const allDay = $('evAllDay').checked;
  let starts_at, ends_at = null;
  if(allDay){
    starts_at = new Date(`${date}T00:00`).toISOString();
  } else {
    const start = $('evStart').value || '00:00';
    const end = $('evEnd').value;
    if(end && end <= start){ toast('warn', 'Sluttid måste vara efter starttid'); return; }
    starts_at = new Date(`${date}T${start}`).toISOString();
    if(end) ends_at = new Date(`${date}T${end}`).toISOString();
  }

  // Soft heads-up (never a hard block) when a timed event collides with a known meeting (±buffer).
  // On edit we only re-check if the start actually moved, so fixing a typo stays quiet. If the user
  // confirms anyway, remember the meeting so the co-parent gets a push after the save (below).
  let collisionMeeting = null;
  if(!allDay && typeof meetingConflict === 'function'){
    const movedStart = !editingEvent || editingEvent.all_day ||
      dateKey(editingEvent.starts_at) !== date ||
      fmtTime(editingEvent.starts_at) !== ($('evStart').value || '00:00');
    if(movedStart){
      const m = meetingConflict(date, $('evStart').value || '00:00', $('evEnd').value);
      if(m){
        if(!(await confirmDialog(`Krockar med ${meetingLabel(m)}. Lägga till ändå?`, 'Lägg till ändå', 'Krock med möte'))) return;
        collisionMeeting = m;
      }
    }
  }

  const fields = {
    title,
    starts_at,
    ends_at,
    all_day: allDay,
    owner_id: $('evOwner').value || null,
    category: $('evCategory').value || null,
    private: $('evPrivate').checked,
    notes: $('evNotes').value.trim() || null
  };

  try{
    if(editingEvent){
      const { error } = await sb.from('calendar_events')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', editingEvent.id);
      if(error) throw error;
      toast('ok', 'Uppdaterad');
      if(collisionMeeting) notify('event_collision', { eventId: editingEvent.id, meeting: meetingLabel(collisionMeeting) });
    } else {
      const { data, error } = await sb.from('calendar_events')
        .insert({ ...fields, created_by: me.id }).select('id').single();
      if(error) throw error;
      toast('ok', 'Tillagd');
      if(data) notify('event_new', { eventId: data.id });
      if(data && collisionMeeting) notify('event_collision', { eventId: data.id, meeting: meetingLabel(collisionMeeting) });
    }
    calWeekOffset = weekOffsetOf(date);   // show the week the event landed in
    await loadEvents();
    renderCalendar();
  }catch(err){
    console.warn('saveEvent', err);
    toast('warn', 'Kunde inte spara');
  }
}

async function deleteEvent(ev){
  if(!(await confirmDialog(`Ta bort "${ev.title}"?`))) return;
  try{
    const { error } = await sb.from('calendar_events').delete().eq('id', ev.id);
    if(error) throw error;
    toast('ok', 'Borttagen');
    await loadEvents();
    renderCalendar();
  }catch(err){
    console.warn('deleteEvent', err);
    toast('warn', 'Kunde inte ta bort');
  }
}
