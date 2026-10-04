'use strict';
// Läxor: the kids' homework as quick reminders on Dagens agenda, as a row inside the Skola card.
// No schedule: a läxa is added the day before it's due (+ Läxa on the start screen, the next school
// day pre-picked), ticked when done, and a ticked one stays crossed out until its day is over.
// Collapsed, the row only shows which kids have homework left (no counts); tap it to open the list.

let homeworkOpen = false;
try{ homeworkOpen = localStorage.getItem('slayqueens_hwopen') === '1'; }catch(e){}
let hwLastKid = null;   // the kid picked last time, pre-selected next time

// Who homework can be added for: a parent picks any school kid; a kid adds their own.
function homeworkKids(){
  const all = (typeof kids === 'function') ? kids() : (state.profiles || []).filter(p => p.role === 'kid');
  return isParent() ? all : all.filter(k => me && k.id === me.id);
}

// What the agenda shows: everything not done yet, plus ticked ones until their day is over.
function visibleHomework(){
  const today = todayKey();
  return (state.homework || [])
    .filter(h => !h.done_at || h.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.created_at).localeCompare(String(b.created_at)));
}

// "idag" / "imorgon" / "torsdag" / "mån 12 okt"
function homeworkDueLabel(key){
  const n = daysBetween(todayKey(), key);
  const d = new Date(key + 'T00:00:00');
  if(n === -1) return 'igår';
  if(n === 0) return 'idag';
  if(n === 1) return 'imorgon';
  if(n > 1 && n < 7) return WEEKDAYS[d.getDay()];
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The Läxor row inside the Skola card ('' when there's nothing to show).
function homeworkBlockHtml(){
  const list = visibleHomework();
  if(!list.length) return '';
  const left = [...new Set(list.filter(h => !h.done_at).map(h => h.kid_id))]
    .map(id => state.profilesById[id]).filter(Boolean);
  const who = left.length
    ? left.map(p => `<span class="hw-who">${avatarHtml(profileColor(p), p.name)}${escapeHtml(capital(p.name))}</span>`).join('')
    : '<span class="hw-allclear">Allt klart ✓</span>';
  const head = `
    <button class="hw-head" type="button" data-hwtoggle aria-expanded="${homeworkOpen}">
      <span class="hw-ico" aria-hidden="true">📚</span>
      <span class="hw-head-main">
        <span class="hw-cap">Läxor</span>
        <span class="hw-who-list">${who}</span>
      </span>
      <span class="ag-caret hw-caret" aria-hidden="true">›</span>
    </button>`;
  if(!homeworkOpen) return `<div class="hw-block">${head}</div>`;

  const byKid = {};
  for(const h of list) (byKid[h.kid_id] = byKid[h.kid_id] || []).push(h);
  const groups = Object.keys(byKid)
    .map(id => state.profilesById[id]).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
    .map(p => `
      <div class="hw-kid">
        <div class="hw-kid-name">${avatarHtml(profileColor(p), p.name)}${escapeHtml(capital(p.name))}</div>
        ${byKid[p.id].map(homeworkRowHtml).join('')}
      </div>`).join('');
  const add = homeworkKids().length ? '<button class="hw-add" type="button" data-hwadd>+ Ny läxa</button>' : '';
  return `<div class="hw-block is-open">${head}<div class="hw-list">${groups}${add}</div></div>`;
}

function homeworkRowHtml(h){
  const done = !!h.done_at;
  const late = !done && h.due_date < todayKey();
  const canTick = isParent() || (me && h.kid_id === me.id);
  const canDel = isParent() || (me && h.created_by === me.id);
  const due = `${late ? 'sen · ' : 'till '}${homeworkDueLabel(h.due_date)}`;
  return `
    <div class="hw-row${done ? ' is-done' : ''}">
      <button class="hw-check" type="button" data-hwdone="${h.id}" aria-pressed="${done}"
        aria-label="${escapeHtml(h.title)}: ${done ? 'klar' : 'inte klar'}"${canTick ? '' : ' disabled'}>✓</button>
      <span class="hw-main">
        <span class="hw-title">${escapeHtml(h.title)}</span>
        <span class="hw-due${late ? ' is-late' : ''}">${escapeHtml(due)}</span>
      </span>
      ${canDel ? `<button class="hw-del" type="button" data-hwdel="${h.id}" aria-label="Ta bort ${escapeHtml(h.title)}">✕</button>` : ''}
    </div>`;
}

// Clicks on the agenda that belong to Läxor; returns true when handled.
function onHomeworkClick(e){
  const t = e.target.closest('[data-hwtoggle],[data-hwdone],[data-hwdel],[data-hwadd]');
  if(!t) return false;
  if(t.hasAttribute('data-hwtoggle')){
    homeworkOpen = !homeworkOpen;
    try{ localStorage.setItem('slayqueens_hwopen', homeworkOpen ? '1' : '0'); }catch(err){}
    renderToday();
  } else if(t.dataset.hwdone){
    toggleHomework(t.dataset.hwdone);
  } else if(t.dataset.hwdel){
    deleteHomework(t.dataset.hwdel);
  } else {
    openHomeworkDialog();
  }
  return true;
}

// Tick / untick. Shown at once; reverted with a warning if the save fails.
async function toggleHomework(id){
  const h = (state.homework || []).find(x => x.id === id);
  if(!h) return;
  const before = { done_at: h.done_at, done_by: h.done_by };
  h.done_at = h.done_at ? null : new Date().toISOString();
  h.done_by = h.done_at && me ? me.id : null;
  renderToday();
  if(isDemo()) return;   // demo: the tick stays on this device only
  try{
    const { error } = await sb.from('homework').update({ done_at: h.done_at, done_by: h.done_by }).eq('id', id);
    if(error) throw error;
  }catch(err){
    console.warn('toggleHomework', err);
    Object.assign(h, before);
    renderToday();
    toast('warn', 'Kunde inte spara');
  }
}

async function deleteHomework(id){
  const h = (state.homework || []).find(x => x.id === id);
  if(!h) return;
  if(!(await confirmDialog(`Ta bort läxan "${h.title}"?`))) return;
  state.homework = state.homework.filter(x => x.id !== id);
  renderToday();
  if(isDemo()) return;
  try{
    const { error } = await sb.from('homework').delete().eq('id', id);
    if(error) throw error;
  }catch(err){
    console.warn('deleteHomework', err);
    toast('warn', 'Kunde inte ta bort');
    await loadHomework();
    renderToday();
  }
}

// ---- quick add (+ Läxa on the start screen) ----
// The next four school days from tomorrow (weekends, röda dagar and lov skipped).
function homeworkDueChoices(){
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for(let i = 0; out.length < 4 && i < 60; i++){
    d.setDate(d.getDate() + 1);
    if(d.getDay() === 0 || d.getDay() === 6) continue;
    if(typeof redDayName === 'function' && redDayName(d)) continue;
    if(typeof closureOn === 'function' && closureOn(d)) continue;
    out.push(dateKey(d));
  }
  return out;
}
function dueChipLabel(key){
  if(daysBetween(todayKey(), key) === 1) return 'Imorgon';
  const d = new Date(key + 'T00:00:00');
  return `${capital(WEEKDAYS[d.getDay()].slice(0, 3))} ${d.getDate()}`;
}

function openHomeworkDialog(){
  const list = homeworkKids();
  if(!list.length){ toast('warn', 'Det finns inga skolbarn att lägga läxor på'); return; }
  const pick = list.length === 1 ? list[0].id : (list.some(k => k.id === hwLastKid) ? hwLastKid : null);
  $('hwTitle').value = '';
  $('hwErr').hidden = true;
  $('hwKidPicks').innerHTML = list.map(k =>
    `<button class="hw-pick with-av${k.id === pick ? ' on' : ''}" type="button" data-kid="${k.id}" aria-pressed="${k.id === pick}">` +
    `${avatarHtml(profileColor(k), k.name)}${escapeHtml(capital(k.name))}</button>`).join('');
  $('hwKidField').hidden = list.length === 1;   // a kid adding their own has nothing to pick
  const days = homeworkDueChoices();
  $('hwDuePicks').innerHTML = days.map(k =>
    `<button class="hw-pick" type="button" data-due="${k}">${escapeHtml(dueChipLabel(k))}</button>`).join('');
  $('hwDate').min = todayKey();
  $('hwDate').value = days[0] || todayKey();
  reflectHomeworkDue();
  $('homeworkDialog').showModal();
  $('hwTitle').focus();
}

// The date field is the real value; the chips are shortcuts that fill it in.
function reflectHomeworkDue(){
  const v = $('hwDate').value;
  document.querySelectorAll('#hwDuePicks [data-due]').forEach(b => {
    const on = b.dataset.due === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
}
function onHomeworkDuePick(e){
  const b = e.target.closest('[data-due]');
  if(!b) return;
  $('hwDate').value = b.dataset.due;
  reflectHomeworkDue();
}
function onHomeworkKidPick(e){
  const b = e.target.closest('[data-kid]');
  if(!b) return;
  document.querySelectorAll('#hwKidPicks [data-kid]').forEach(x => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', x === b);
  });
  $('hwErr').hidden = true;
}

// Called on submit. Returns false (and keeps the dialog open) when the kid is missing.
function saveHomework(){
  const title = $('hwTitle').value.trim();
  const due = $('hwDate').value;
  const kidBtn = document.querySelector('#hwKidPicks [data-kid].on');
  if(!title || !due || !kidBtn){ $('hwErr').hidden = false; return false; }
  hwLastKid = kidBtn.dataset.kid;
  addHomework({ kid_id: kidBtn.dataset.kid, title, due_date: due });
  return true;
}

async function addHomework(row){
  if(isDemo()){
    // Demo: keep it on this device only, like the budget does; nothing is saved.
    state.homework.push({ ...row, id: 'demo-' + Date.now(), done_at: null, done_by: null,
      created_by: me.id, created_at: new Date().toISOString() });
    renderToday();
    return;
  }
  try{
    const { error } = await sb.from('homework').insert({ ...row, created_by: me.id });
    if(error) throw error;
    toast('ok', 'Läxa tillagd');
    await loadHomework();
  }catch(err){
    console.warn('addHomework', err);
    toast('warn', 'Kunde inte spara');
  }
  renderToday();
}
