'use strict';
// Family calendar: render upcoming events grouped by day, and add/edit/delete.
let editingEvent = null;
let categoryFilter = null;
let calendarExpanded = false;      // false = next 7 days only; true = all upcoming
const CAL_WINDOW_DAYS = 7;

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
  renderCategoryFilter();
  const list = $('eventList');
  list.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + CAL_WINDOW_DAYS);

  const upcoming = state.events
    .filter(ev => new Date(ev.starts_at) >= today)
    .filter(ev => !categoryFilter || (ev.category || 'annat') === categoryFilter)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  if(!upcoming.length){
    list.innerHTML =
      '<div class="placeholder"><div class="ph-emoji">📅</div>' +
      `<h3>${categoryFilter ? 'Inget i den kategorin' : 'Inga kommande händelser'}</h3>` +
      `<p>${categoryFilter ? 'Prova en annan kategori.' : 'Lägg till familjens viktiga datum.'}</p></div>`;
    return;
  }

  // Default to the next 7 days; "Visa fler" reveals everything further out.
  const inWindow = upcoming.filter(ev => new Date(ev.starts_at) < cutoff);
  const beyond = upcoming.length - inWindow.length;
  const shown = calendarExpanded ? upcoming : inWindow;

  if(!shown.length){
    const ph = document.createElement('div');
    ph.className = 'placeholder mini';
    ph.innerHTML = '<p>Inget de närmaste 7 dagarna.</p>';
    list.appendChild(ph);
  } else {
    let lastKey = null;
    for(const ev of shown){
      const key = dateKey(ev.starts_at);
      if(key !== lastKey){
        lastKey = key;
        list.appendChild(dayHeader(ev.starts_at));
      }
      list.appendChild(eventRow(ev));
    }
  }

  if(beyond > 0){
    list.appendChild(calendarExpanded
      ? calMoreButton('Visa mindre', false)
      : calMoreButton(`Visa fler (${beyond})`, true));
  }
}

// Serif day heading with a hair-rule; "Imorgon" also shows its weekday.
function dayHeader(d){
  const head = document.createElement('div');
  const key = dateKey(d);
  head.className = 'day-head' + (key === todayKey() ? ' is-today' : '');
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((x - today) / 86400000);
  const sub = diff === 1 ? WEEKDAYS[x.getDay()] : '';
  head.innerHTML =
    `<span class="dh-label">${escapeHtml(relativeDay(d))}</span>` +
    (sub ? `<span class="dh-sub">${escapeHtml(sub)}</span>` : '') +
    '<span class="dh-rule"></span>';
  return head;
}

function calMoreButton(label, expand){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cal-more';
  btn.textContent = label;
  btn.onclick = () => { calendarExpanded = expand; renderCalendar(); };
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

function openEventDialog(ev){
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
    $('evDate').value  = todayKey();
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
    } else {
      const { data, error } = await sb.from('calendar_events')
        .insert({ ...fields, created_by: me.id }).select('id').single();
      if(error) throw error;
      toast('ok', 'Tillagd');
      if(data) notify('event_new', { eventId: data.id });
    }
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
