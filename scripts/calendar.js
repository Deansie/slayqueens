'use strict';
// Family calendar: render upcoming events grouped by day, and add/edit/delete.
let editingEvent = null;

function ownerLabel(ev){
  if(!ev.owner_id) return { name: 'Familjen', color: 'var(--faint)' };
  const p = state.profilesById[ev.owner_id];
  if(!p) return { name: '—', color: 'var(--faint)' };
  return { name: capital(p.name), color: profileColor(p) };
}

function renderCalendar(){
  const list = $('eventList');
  list.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = state.events
    .filter(ev => new Date(ev.starts_at) >= today)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  if(!upcoming.length){
    list.innerHTML =
      '<div class="placeholder"><div class="ph-emoji">📅</div>' +
      '<h3>Inga kommande händelser</h3><p>Lägg till familjens viktiga datum.</p></div>';
    return;
  }

  let lastKey = null;
  for(const ev of upcoming){
    const key = dateKey(ev.starts_at);
    if(key !== lastKey){
      lastKey = key;
      const head = document.createElement('div');
      head.className = 'day-head' + (key === todayKey() ? ' is-today' : '');
      head.textContent = relativeDay(ev.starts_at);
      list.appendChild(head);
    }
    list.appendChild(eventRow(ev));
  }
}

function eventRow(ev){
  const row = document.createElement('div');
  row.className = 'event';
  const owner = ownerLabel(ev);
  const canEdit = (me && ev.created_by === me.id) || isParent();
  const when = ev.all_day
    ? 'Heldag'
    : fmtTime(ev.starts_at) + (ev.ends_at ? '–' + fmtTime(ev.ends_at) : '');
  row.innerHTML = `
    <div class="ev-body">
      <div class="ev-when">${when}</div>
      <div class="ev-title">${escapeHtml(ev.title)}</div>
      ${ev.notes ? `<div class="ev-notes">${escapeHtml(ev.notes)}</div>` : ''}
      <span class="owner-chip"><span class="dot" style="background:${owner.color}"></span>${escapeHtml(owner.name)}</span>
    </div>
    ${canEdit ? `<div class="ev-actions">
      <button class="icon-btn" data-edit type="button" aria-label="Redigera">✎</button>
      <button class="icon-btn" data-del type="button" aria-label="Ta bort">🗑</button>
    </div>` : ''}`;
  if(canEdit){
    row.querySelector('[data-edit]').onclick = () => openEventDialog(ev);
    row.querySelector('[data-del]').onclick  = () => deleteEvent(ev);
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

  if(ev){
    const d = new Date(ev.starts_at);
    $('evTitle').value = ev.title || '';
    $('evDate').value  = dateKey(d);
    $('evStart').value = ev.all_day ? '' : fmtTime(d);
    $('evEnd').value   = (!ev.all_day && ev.ends_at) ? fmtTime(ev.ends_at) : '';
    $('evAllDay').checked = !!ev.all_day;
    sel.value = ev.owner_id || '';
    $('evNotes').value = ev.notes || '';
  } else {
    $('evTitle').value = '';
    $('evDate').value  = todayKey();
    $('evStart').value = '';
    $('evEnd').value   = '';
    $('evAllDay').checked = false;
    sel.value = me ? me.id : '';
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
    notes: $('evNotes').value.trim() || null
  };

  try{
    let error;
    if(editingEvent){
      ({ error } = await sb.from('calendar_events')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', editingEvent.id));
    } else {
      ({ error } = await sb.from('calendar_events').insert({ ...fields, created_by: me.id }));
    }
    if(error) throw error;
    toast('ok', editingEvent ? 'Uppdaterad' : 'Tillagd');
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
