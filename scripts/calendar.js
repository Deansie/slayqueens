'use strict';
// Family calendar: render upcoming events grouped by day, and add/edit/delete.
let editingEvent = null;
let categoryFilter = null;
let calendarExpanded = false;      // false = next 7 days only; true = all upcoming
const CAL_WINDOW_DAYS = 7;

function ownerLabel(ev){
  if(!ev.owner_id) return { name: 'Familjen', color: 'var(--faint)' };
  const p = state.profilesById[ev.owner_id];
  if(!p) return { name: '—', color: 'var(--faint)' };
  return { name: capital(p.name), color: profileColor(p) };
}

function renderCategoryFilter(){
  const box = $('catFilter');
  if(!box) return;
  const chip = (key, label) => `<button class="fchip${categoryFilter === key ? ' active' : ''}" data-cat="${key || ''}" type="button">${label}</button>`;
  box.innerHTML = chip(null, 'Alla') + CATEGORIES.map(c => chip(c.key, `${c.emoji} ${escapeHtml(c.label)}`)).join('');
}

function onCatFilterClick(e){
  const b = e.target.closest('[data-cat]');
  if(!b) return;
  categoryFilter = b.dataset.cat || null;
  renderCalendar();
}

function renderCalendar(){
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
        const head = document.createElement('div');
        head.className = 'day-head' + (key === todayKey() ? ' is-today' : '');
        head.textContent = relativeDay(ev.starts_at);
        list.appendChild(head);
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

function calMoreButton(label, expand){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cal-more';
  btn.textContent = label;
  btn.onclick = () => { calendarExpanded = expand; renderCalendar(); };
  return btn;
}

function eventRow(ev){
  const row = document.createElement('div');
  const isToday = dateKey(ev.starts_at) === todayKey();
  row.className = 'event' + (isToday ? ' is-today' : '');
  const owner = ownerLabel(ev);
  const cat = categoryOf(ev.category);
  const canEdit = (me && ev.created_by === me.id) || isParent();
  const when = ev.all_day
    ? 'Heldag'
    : fmtTime(ev.starts_at) + (ev.ends_at ? '–' + fmtTime(ev.ends_at) : '');
  const msgCount = messagesFor(ev.id).length;
  row.innerHTML = `
    <div class="ev-body">
      <div class="ev-when">${when}</div>
      <div class="ev-title">${ev.private ? '🔒 ' : ''}${escapeHtml(ev.title)}</div>
      ${ev.notes ? `<div class="ev-notes">${escapeHtml(ev.notes)}</div>` : ''}
      <div class="ev-tags">
        <span class="cat-chip"><span class="dot" style="background:${cat.color}"></span>${cat.emoji} ${escapeHtml(cat.label)}</span>
        <span class="owner-chip"><span class="dot" style="background:${owner.color}"></span>${escapeHtml(owner.name)}</span>
      </div>
    </div>
    <div class="ev-side">
      <button class="ev-chat" data-chat type="button" aria-label="Kommentarer">💬${msgCount ? `<span class="ev-chat-n">${msgCount}</span>` : ''}</button>
      ${canEdit ? `<div class="ev-actions">
        <button class="icon-btn" data-edit type="button" aria-label="Redigera">✎</button>
        <button class="icon-btn" data-del type="button" aria-label="Ta bort">🗑</button>
      </div>` : ''}
    </div>`;
  row.querySelector('[data-chat]').onclick = () => openEventChat(ev);
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

// Event chat: a comment thread hung off a single event. Messages inherit the event's
// visibility (private events stay hidden from the other kids — enforced by RLS).
let chatEventId = null;

function messagesFor(eventId){
  return (state.eventMessages || [])
    .filter(m => m.event_id === eventId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function openEventChat(ev){
  chatEventId = ev.id;
  $('eventChatDialog').showModal();   // open before painting — renderEventChat skips a closed dialog
  renderEventChat();
  $('chatInput').focus();
}

function renderEventChat(){
  if(!chatEventId) return;
  const dlg = $('eventChatDialog');
  if(!dlg || !dlg.open) return;                 // only paint while the thread is open
  const ev = (state.events || []).find(e => e.id === chatEventId);
  $('chatTitle').textContent = ev ? ev.title : 'Kommentarer';
  const thread = $('chatThread');
  const msgs = messagesFor(chatEventId);
  if(!msgs.length){
    thread.innerHTML = '<div class="chat-empty">Inga kommentarer än. Skriv den första!</div>';
    return;
  }
  thread.innerHTML = msgs.map(m => {
    const a = state.profilesById[m.author_id];
    const mine = me && m.author_id === me.id;
    const canDelete = mine || isParent();
    return `
      <div class="msg${mine ? ' mine' : ''}">
        <div class="msg-head">
          <span class="dot" style="background:${a ? profileColor(a) : 'var(--faint)'}"></span>
          ${escapeHtml(a ? capital(a.name) : '—')}
          <span class="msg-time">${escapeHtml(fmtWhen(m.created_at))} ${escapeHtml(fmtTime(m.created_at))}</span>
          ${canDelete ? `<button class="msg-del" data-delmsg="${m.id}" type="button" aria-label="Ta bort">✕</button>` : ''}
        </div>
        <div class="msg-body">${escapeHtml(m.body)}</div>
      </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

async function sendEventMessage(){
  const input = $('chatInput');
  const body = input.value.trim();
  if(!body || !chatEventId) return;
  input.value = '';
  try{
    const { error } = await sb.from('event_messages').insert({ event_id: chatEventId, author_id: me.id, body });
    if(error) throw error;
    await loadEventMessages();
    renderEventChat();
    renderCalendar();
    notify('event_msg', { eventId: chatEventId });
  }catch(err){
    console.warn('sendEventMessage', err);
    toast('warn', 'Kunde inte skicka');
    input.value = body;   // give it back so nothing is lost
  }
}

function onChatThreadClick(e){
  const del = e.target.closest('[data-delmsg]');
  if(del) deleteEventMessage(del.dataset.delmsg);
}

async function deleteEventMessage(id){
  try{
    const { error } = await sb.from('event_messages').delete().eq('id', id);
    if(error) throw error;
    await loadEventMessages();
    renderEventChat();
    renderCalendar();
  }catch(err){
    console.warn('deleteEventMessage', err);
    toast('warn', 'Kunde inte ta bort');
  }
}
