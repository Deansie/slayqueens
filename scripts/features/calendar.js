'use strict';
// Family calendar: one week at a time (Monday–Sunday, every day always shown), and add/edit/delete.
let editingEvent = null;
let calWeekOffset = 0;      // 0 = this week, ±1 = neighbouring weeks (as in the matsedel)

// Where a parent works on a day (work_days). A tap waits in pendingWork until it's saved, so a
// quick 🏠 → 🏢 double tap shows at once and only the final choice is written.
const WORK_PLACES = { home: { icon: '🏠', label: 'hemma' }, office: { icon: '🏢', label: 'på kontoret' } };
const pendingWork = {};     // 'YYYY-MM-DD' → 'home' | 'office' | null until the latest tap is saved
const workTaps = {};        // 'YYYY-MM-DD' → tap counter, to tell the latest tap from older ones
const workTimers = {};
const workSaves = {};       // 'YYYY-MM-DD' → save in flight; a day's saves run one at a time, in order

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

function renderCalendar(){
  renderHeader();
  renderNotisBar();
  renderWeekNav();
  const list = $('eventList');

  const mon = mondayOfWeek(calWeekOffset);
  const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
  const keys = new Set(days.map(dateKey));
  const byDay = {};
  state.events
    .filter(ev => keys.has(dateKey(ev.starts_at)))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .forEach(ev => { const k = dateKey(ev.starts_at); (byDay[k] = byDay[k] || []).push(ev); });

  list.innerHTML = days.map(d => weekDay(d, byDay[dateKey(d)] || [])).join('');
}

// ‹ Vecka 41  5–11 oktober ›  (away from this week a small "Idag" pill leads back)
function renderWeekNav(){
  const box = $('calWeekNav');
  if(!box) return;
  const mon = mondayOfWeek(calWeekOffset);
  box.innerHTML = `
    <button class="wk-arrow" data-calweek="-1" type="button" aria-label="Föregående vecka">‹</button>
    <div class="wk-mid">
      <span class="wk-title serif">Vecka ${isoWeek(mon)}</span>
      <span class="wk-range">${escapeHtml(weekRangeLabel(mon))}</span>
      ${calWeekOffset !== 0 ? '<button class="wk-today" data-calweek="today" type="button">Idag</button>' : ''}
    </div>
    <button class="wk-arrow" data-calweek="1" type="button" aria-label="Nästa vecka">›</button>`;
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

// One day: a single header line (name · röd dag/lov · where people work), then one line per
// event. A free day is one quiet line that adds an event on that date when tapped.
function weekDay(d, evs){
  const key = dateKey(d), today = todayKey();
  const rel = key === today ? 'Idag · ' : key === dateKey(new Date(Date.now() + 86400000)) ? 'Imorgon · ' : '';
  const label = `${rel}${capital(WEEKDAYS[d.getDay()]).slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const full = `${capital(WEEKDAYS[d.getDay()])} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
  const red = (typeof redDayName === 'function') ? redDayName(d) : null;
  const lov = (typeof closureName === 'function') ? closureName(d) : null;
  const note = red ? `<span class="cal-note">${escapeHtml(red)}</span>`
    : lov ? `<span class="cal-note lov">${escapeHtml(lov)}</span>` : '';

  let free = '';
  if(!evs.length){
    free = key < today
      ? '<span class="cal-free" aria-hidden="true">—</span>'
      : `<button class="cal-free" type="button" data-addday="${key}" aria-label="Ny händelse ${escapeHtml(full)}">Inget planerat</button>`;
  }
  const cls = 'cal-day' + (key === today ? ' is-today' : key < today ? ' is-past' : '')
    + (red || d.getDay() === 0 ? ' is-red' : '');
  return `<section class="${cls}" aria-label="${escapeHtml(full)}">
      <div class="cal-day-h"><span class="cal-day-name">${escapeHtml(label)}</span>${note}${free}${workHtml(key, full)}</div>
      ${evs.map(eventLine).join('')}
    </section>`;
}

// Others' markers as a tiny avatar + icon; mine as an icon button parents can tap to change.
function workHtml(key, full){
  const others = (state.workDays || []).filter(w => w.date === key && !(me && w.profile_id === me.id))
    .map(w => {
      const p = state.profilesById[w.profile_id], place = WORK_PLACES[w.location];
      if(!p || !place) return '';
      return `<span class="cal-work-o" title="${escapeHtml(`${capital(p.name)} jobbar ${place.label}`)}">${avatarHtml(profileColor(p), p.name)}${place.icon}</span>`;
    }).join('');
  const mine = me ? workOf(me.id, key) : null;
  let mineHtml = '';
  if(isParent() && key >= todayKey()){
    mineHtml = `<button class="cal-work-me${mine ? '' : ' is-unset'}" type="button" data-work="${key}"
      aria-label="${escapeHtml(full)}: ${mine ? `du jobbar ${WORK_PLACES[mine].label}` : 'ingen arbetsplats vald'}. Tryck för att ändra.">${WORK_PLACES[mine || 'home'].icon}</button>`;
  } else if(mine){
    mineHtml = `<span class="cal-work-me" title="Du jobbar ${WORK_PLACES[mine].label}">${WORK_PLACES[mine].icon}</span>`;
  }
  return (others || mineHtml) ? `<span class="cal-work">${others}${mineHtml}</span>` : '';
}

// Where someone works on `key`; for me, a tap that's still waiting to be saved wins.
function workOf(profileId, key){
  if(me && profileId === me.id && key in pendingWork) return pendingWork[key];
  const w = (state.workDays || []).find(x => x.profile_id === profileId && x.date === key);
  return w ? w.location : null;
}

// Tap on a date: none → 🏠 hemma → 🏢 på kontoret → none. Shown at once, saved after a short pause.
function cycleWorkDay(key){
  if(!me || demoBlock()) return;
  const cur = workOf(me.id, key);
  pendingWork[key] = cur === null ? 'home' : cur === 'home' ? 'office' : null;
  const tap = workTaps[key] = (workTaps[key] || 0) + 1;
  renderCalendar();
  clearTimeout(workTimers[key]);
  workTimers[key] = setTimeout(() => {
    const location = pendingWork[key];
    workSaves[key] = (workSaves[key] || Promise.resolve()).catch(() => {})
      .then(() => saveWorkDay(key, location, tap));
  }, 600);
}

async function saveWorkDay(key, location, tap){
  {
    try{
      const { error } = location
        ? await sb.from('work_days').upsert({ profile_id: me.id, date: key, location }, { onConflict: 'profile_id,date' })
        : await sb.from('work_days').delete().eq('profile_id', me.id).eq('date', key);
      if(error) throw error;
      await loadWorkDays();
    }catch(err){
      console.warn('saveWorkDay', err);
      toast('warn', 'Kunde inte spara');
    }
  }
  if(workTaps[key] === tap) delete pendingWork[key];   // a newer tap keeps showing until it's saved
  renderCalendar();
}

// One line per event: time · colour bar (whose it is) · title + a quiet second line · 💬 count.
// Everything else (note, comments, edit, delete) is in the sheet that opens on tap.
function eventLine(ev){
  const owner = ownerLabel(ev);
  const ongoing = dateKey(ev.starts_at) === todayKey() && isOngoing(ev);
  const start = fmtTime(ev.starts_at);
  const time = ev.all_day ? 'Heldag' : `${start}${ev.ends_at ? `<small>${fmtTime(ev.ends_at)}</small>` : ''}`;
  const sub = (ongoing ? '<span class="now">Pågår</span> · ' : '') + escapeHtml([owner.name, ev.notes].filter(Boolean).join(' · '));
  const n = chatCountFor('event', ev.id);
  return `<button class="cal-ev" type="button" data-ev="${ev.id}" style="--c:${owner.color}">
      <span class="cal-ev-t">${time}</span>
      <span class="cal-ev-bar" aria-hidden="true"></span>
      <span class="cal-ev-main"><span class="cal-ev-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</span><span class="cal-ev-sub">${sub}</span></span>
      ${n ? `<span class="cal-ev-n" aria-label="${n} kommentarer">💬 ${n}</span>` : '<span></span>'}
    </button>`;
}

function onCalendarClick(e){
  const b = e.target.closest('[data-ev],[data-addday],[data-work]');
  if(!b) return;
  if(b.dataset.work) return cycleWorkDay(b.dataset.work);
  if(b.dataset.addday){ if(!demoBlock()) openEventDialog(null, b.dataset.addday); return; }
  const ev = state.events.find(x => x.id === b.dataset.ev);
  if(ev) openEventSheet(ev);
}

// Tap an event: everything about it, and what you can do (comments for all; edit/delete if yours).
function openEventSheet(ev){
  const owner = ownerLabel(ev);
  const canEdit = (me && ev.created_by === me.id) || isParent();
  const when = ev.all_day ? 'Heldag' : fmtTime(ev.starts_at) + (ev.ends_at ? '–' + fmtTime(ev.ends_at) : '');
  const d = new Date(ev.starts_at);
  const msgs = messagesFor('event', ev.id);
  const last = msgs[msgs.length - 1];
  const lastBy = last && state.profilesById[last.created_by];
  const lastText = last ? (last.body || '📷 Bild') : '';
  openSheet(`
    <div class="sheet-in">
      <span class="sheet-grab" aria-hidden="true"></span>
      <p class="sheet-who">${avatarHtml(owner.color, owner.name)}${escapeHtml(owner.name)}</p>
      <h3 class="sheet-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</h3>
      <p class="sheet-when">${escapeHtml(capital(WEEKDAYS[d.getDay()]))} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} · ${escapeHtml(when)}</p>
      ${ev.notes ? `<p class="sheet-notes">${escapeHtml(ev.notes)}</p>` : ''}
      ${last ? `<p class="sheet-last">💬 ${msgs.length} · ${escapeHtml(lastBy ? capital(lastBy.name) + ': ' : '')}${escapeHtml(lastText)}</p>` : ''}
      <div class="sheet-actions">
        <button class="sheet-btn" type="button" data-sh="chat">💬 ${msgs.length ? 'Visa kommentarer' : 'Skriv en kommentar'}</button>
        ${canEdit ? '<button class="sheet-btn" type="button" data-sh="edit">✎ Redigera</button>' : ''}
        ${canEdit ? '<button class="sheet-btn danger" type="button" data-sh="del">Ta bort</button>' : ''}
      </div>
    </div>`, (act) => {
    if(act === 'chat') openChat('event', ev.id, chatTitleFor('event', ev.id));
    else if(act === 'edit') openEventDialog(ev);
    else if(act === 'del') deleteEvent(ev);
  });
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
