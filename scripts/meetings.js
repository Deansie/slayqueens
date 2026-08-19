'use strict';
// Möten — the household's known meeting/busy blocks, so a family event that collides gets a soft
// heads-up before it's saved. One adult works from home with scheduled meetings the other can't
// see when booking things (e.g. a doctor's appointment); these are kept here by hand because the
// work Google calendar has no shareable feed. Meetings are read by everyone and maintained by
// parents (profile menu → "Möten").
//
// Two kinds live in public.meetings: recurring weekly (weekday 0=Mon…6=Sun, repeats every week)
// and one-off (a specific date). Every meeting is padded by COLLISION_BUFFER_MIN when checking, so
// near-misses warn too. The check itself is owner-agnostic: it compares the new event's TIME to
// every meeting that day — that's what lets a partner get warned about the other's meetings.

const MEETING_WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const COLLISION_BUFFER_MIN = 15;   // headroom padded around every meeting when checking overlaps

// ---- collision helper (pure; called from the calendar) ----

// Minutes since midnight from a "HH:MM" / "HH:MM:SS" string, or null if it isn't one.
function hmToMin(s){
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Meetings that apply on `dateStr` (YYYY-MM-DD): one-offs on that date + recurring ones whose
// weekday matches. Sorted by start time.
function meetingsOn(dateStr){
  if(!dateStr) return [];
  const wd = (new Date(dateStr + 'T00:00').getDay() + 6) % 7;   // JS Sun=0 → 0 = Mon … 6 = Sun
  return (state.meetings || [])
    .filter(m => m.date === dateStr || (m.date == null && m.weekday === wd))
    .sort((a, b) => hmToMin(a.start_time) - hmToMin(b.start_time));
}

// The first meeting on `dateStr` that a timed event running [start, end) collides with — each
// meeting padded by the buffer so near-misses count — or null. `end` may be '' (open-ended →
// treated as a point at start). All-day/untimed events are filtered out by the caller.
function meetingConflict(dateStr, start, end){
  const evStart = hmToMin(start);
  if(evStart == null) return null;
  const eEnd = hmToMin(end);
  const evEnd = (eEnd != null && eEnd > evStart) ? eEnd : evStart;   // point event → evEnd == evStart
  for(const m of meetingsOn(dateStr)){
    const mStart = hmToMin(m.start_time) - COLLISION_BUFFER_MIN;
    const mEnd   = hmToMin(m.end_time)   + COLLISION_BUFFER_MIN;
    const overlaps = evEnd > evStart
      ? (evStart < mEnd && evEnd > mStart)         // interval vs padded meeting
      : (evStart >= mStart && evStart < mEnd);     // point inside padded meeting
    if(overlaps) return m;
  }
  return null;
}

// '"Standup" (09:00–09:30)' — one label reused by the collision confirm and the push notification.
function meetingLabel(m){
  const hhmm = t => String(t).slice(0, 5);
  return `${m.title ? `"${m.title}"` : 'ett möte'} (${hhmm(m.start_time)}–${hhmm(m.end_time)})`;
}

// ---- editor dialog (profile menu → "Möten") ----

function openMeetingsDialog(){
  if(!me) return;
  const wsel = $('meetWeekday');
  if(wsel && !wsel.options.length){
    wsel.innerHTML = MEETING_WEEKDAYS.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  }
  // Reset the add row to sensible defaults (today's weekday, a 30-min morning slot).
  $('meetKind').value = 'weekly';
  if(wsel) wsel.value = String((new Date().getDay() + 6) % 7);
  $('meetDate').value  = todayKey();
  $('meetStart').value = '09:00';
  $('meetEnd').value   = '09:30';
  $('meetTitle').value = '';
  onMeetKindChange();
  renderMeetingsList();
  $('meetingsDialog').showModal();
}

function onMeetKindChange(){
  const oneOff = $('meetKind').value === 'date';
  $('meetWeekday').hidden = oneOff;
  $('meetDate').hidden    = !oneOff;
}

function meetingRowHtml(m, withDate){
  const hhmm = t => escapeHtml(String(t).slice(0, 5));
  const when  = withDate ? `<span class="mt-date">${escapeHtml(fmtDate(m.date))}</span> ` : '';
  const title = m.title ? ` <span class="mt-title">${escapeHtml(m.title)}</span>` : '';
  return `<div class="mt-row">
      <span class="mt-when">${when}${hhmm(m.start_time)}–${hhmm(m.end_time)}${title}</span>
      <button type="button" class="mt-del" data-del="${m.id}" aria-label="Ta bort">✕</button>
    </div>`;
}

function renderMeetingsList(){
  const box = $('meetingsList');
  if(!box) return;
  const all = state.meetings || [];
  let html = '';
  for(let wd = 0; wd < 7; wd++){
    const rows = all.filter(m => m.weekday === wd).sort((a, b) => hmToMin(a.start_time) - hmToMin(b.start_time));
    if(!rows.length) continue;
    html += `<div class="mt-group"><div class="mt-group-h">${MEETING_WEEKDAYS[wd]}</div>${rows.map(m => meetingRowHtml(m)).join('')}</div>`;
  }
  const today = todayKey();
  const oneoff = all.filter(m => m.date != null && m.date >= today)   // only upcoming one-offs
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : hmToMin(a.start_time) - hmToMin(b.start_time));
  if(oneoff.length){
    html += `<div class="mt-group"><div class="mt-group-h">Enstaka</div>${oneoff.map(m => meetingRowHtml(m, true)).join('')}</div>`;
  }
  box.innerHTML = html || '<p class="mt-empty">Inga möten inlagda ännu.</p>';
}

async function addMeeting(){
  if(!me) return;
  const start = $('meetStart').value, end = $('meetEnd').value;
  if(!start || !end || end <= start){ toast('warn', 'Sluttid måste vara efter start'); return; }
  const row = { title: $('meetTitle').value.trim() || null, start_time: start, end_time: end,
                weekday: null, date: null, created_by: me.id };
  if($('meetKind').value === 'date'){
    const date = $('meetDate').value;
    if(!date){ toast('warn', 'Välj datum'); return; }
    row.date = date;
  } else {
    row.weekday = Number($('meetWeekday').value);
  }
  try{
    const { error } = await sb.from('meetings').insert(row);
    if(error) throw error;
    $('meetTitle').value = '';
    toast('ok', 'Möte tillagt');
    await loadMeetings();
    renderMeetingsList();
  }catch(err){ console.warn('addMeeting', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteMeeting(id){
  try{
    const { error } = await sb.from('meetings').delete().eq('id', id);
    if(error) throw error;
    await loadMeetings();
    renderMeetingsList();
  }catch(err){ console.warn('deleteMeeting', err); toast('warn', 'Kunde inte ta bort'); }
}
