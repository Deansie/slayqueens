'use strict';
// Rutiner: everyday behaviour rewards paid in "streck" (marks; 10 marks = 1 star/"stjärna").
// Kids tick routines as done → a parent approves → marks land in the ledger. Parents can also
// award bonus marks directly (a spot award). The behaviour list and its values are fully
// parent-editable. Lives in the "Sysslor" tab next to the Jobb board. All crediting goes
// through SECURITY DEFINER RPCs so a kid can never self-credit.
let editingBehavior = null;
let bonusProfileId = null;

function markBalanceOf(profileId){
  const row = (state.markBalances || []).find(b => b.profile_id === profileId);
  return row ? row.marks : 0;
}
function pendingRequestFor(behaviorId, profileId){
  return (state.markRequests || []).find(r =>
    r.behavior_id === behaviorId && r.profile_id === profileId && r.status === 'pending');
}
function routineLib(){ return (state.behaviors || []).filter(b => b.kind === 'routine' && b.active); }
function bonusLib(){ return (state.behaviors || []).filter(b => b.kind === 'bonus' && b.active); }

function renderRoutines(){
  const board = $('routineBoard');
  if(!board || !me) return;
  board.innerHTML = isParent() ? routinesParentHtml() : routinesKidHtml();
}

// A person's marks shown as stars + a tally of progress toward the next star.
function markBalanceCard(profileId){
  const marks = markBalanceOf(profileId);
  const stars = starsOf(marks);
  const rem = marks % MARKS_PER_STAR;
  return `<div class="mark-card">
      <div class="mark-stars">${stars ? starsDisplay(stars) : '<span class="mark-nostar">Samla streck för din första stjärna ⭐</span>'}</div>
      <div class="mark-total"><b>${marks}</b> streck${stars ? ` · ${stars} ${stars === 1 ? 'stjärna' : 'stjärnor'}` : ''}</div>
      <div class="mark-progress">
        ${tallyMarks(rem)}
        <span class="mark-progress-label">${rem}/${MARKS_PER_STAR} till nästa stjärna</span>
      </div>
    </div>`;
}

// ---- kid view ----
function routinesKidHtml(){
  const routines = routineLib();
  const list = routines.length ? routines.map(routineRowKid).join('')
    : '<div class="placeholder mini"><p>Inga rutiner än — föräldrarna lägger till dem.</p></div>';
  return `${markBalanceCard(me.id)}
    <div class="section-title">Mina rutiner</div>
    <div class="routine-list">${list}</div>`;
}
function routineRowKid(b){
  const pending = pendingRequestFor(b.id, me.id);
  const action = pending
    ? '<span class="routine-wait">Väntar…</span>'
    : `<button class="btn sm" data-routine="submit" data-behavior="${b.id}" type="button">Bocka av</button>`;
  return `<div class="routine-row${pending ? ' pending' : ''}">
      <span class="routine-info">
        <span class="routine-title">${escapeHtml(b.title)}</span>
        <span class="routine-marks">+${b.marks} streck</span>
      </span>
      ${action}
    </div>`;
}

// ---- parent view ----
function routinesParentHtml(){
  const kids = (state.profiles || []).filter(p => p.role === 'kid');
  const pending = (state.markRequests || []).filter(r => r.status === 'pending');
  const approvals = pending.length
    ? `<div class="section-title">Att godkänna</div><div class="approve-list">${pending.map(approveRow).join('')}</div>`
    : '';
  const balances = kids.length ? kids.map(kidBalanceRow).join('')
    : '<div class="placeholder mini"><p>Inga barn-konton än.</p></div>';
  return `${approvals}
    <div class="section-title">Barnens streck</div>
    <div class="mark-rows">${balances}</div>
    ${routineLibHtml()}`;
}
function approveRow(r){
  const kid = state.profilesById[r.profile_id];
  const b = (state.behaviors || []).find(x => x.id === r.behavior_id);
  return `<div class="approve-item">
      <div class="ai-main">
        <span class="ai-who">${avatarHtml(profileColor(kid), kid ? kid.name : '?')}${escapeHtml(kid ? capital(kid.name) : '—')}</span>
        <span class="ai-what">${escapeHtml(b ? b.title : 'Rutin')}</span>
        <span class="ai-marks">+${r.amount}</span>
      </div>
      <div class="ai-actions">
        <button class="btn sm" data-routine="approve" data-req="${r.id}" type="button">Godkänn</button>
        <button class="btn ghost sm" data-routine="reject" data-req="${r.id}" type="button">Neka</button>
      </div>
    </div>`;
}
function kidBalanceRow(k){
  const marks = markBalanceOf(k.id);
  const stars = starsOf(marks);
  return `<div class="mark-row">
      <span class="mr-name">${avatarHtml(profileColor(k), k.name)}${escapeHtml(capital(k.name))}</span>
      <span class="mr-bal">${stars ? `<span class="mr-stars">${starsDisplay(stars)}</span> ` : ''}<b>${marks}</b> streck</span>
      <span class="mr-actions"><button class="btn ghost sm" data-routine="bonus" data-profile="${k.id}" type="button">Ge streck</button></span>
    </div>`;
}
function routineLibHtml(){
  const items = (state.behaviors || []).filter(b => b.active)
    .sort((a, b) => (a.kind === b.kind) ? 0 : (a.kind === 'routine' ? -1 : 1));
  const head = '<div class="section-title lib-head"><span>Rutiner &amp; bonusar</span>'
    + '<button class="btn ghost sm" data-routine="new" type="button">+ Ny</button></div>';
  if(!items.length){
    return head + '<div class="placeholder mini"><p>Skapa rutiner barnen kan bocka av, och bonusar du delar ut för fint beteende.</p></div>';
  }
  return head + '<div class="behavior-list">' + items.map(behaviorRow).join('') + '</div>';
}
function behaviorRow(b){
  return `<div class="behavior-row">
      <span class="bh-info">
        <span class="bh-kind ${b.kind}">${b.kind === 'bonus' ? 'Bonus' : 'Rutin'}</span>
        <span class="bh-title">${escapeHtml(b.title)}</span>
      </span>
      <span class="bh-marks">+${b.marks}</span>
      <span class="bh-actions">
        <button class="icon-btn" data-routine="edit" data-behavior="${b.id}" aria-label="Redigera">✎</button>
        <button class="icon-btn" data-routine="del" data-behavior="${b.id}" aria-label="Ta bort">🗑</button>
      </span>
    </div>`;
}

// ---- events ----
function onRoutineBoardClick(e){
  const b = e.target.closest('[data-routine]');
  if(!b) return;
  const beh = () => (state.behaviors || []).find(x => x.id === b.dataset.behavior);
  switch(b.dataset.routine){
    case 'submit':  submitRoutine(b.dataset.behavior); break;
    case 'approve': approveMarks(b.dataset.req); break;
    case 'reject':  rejectMarks(b.dataset.req); break;
    case 'bonus':   openBonusDialog(b.dataset.profile); break;
    case 'new':     openBehaviorDialog(null); break;
    case 'edit':    openBehaviorDialog(beh()); break;
    case 'del':     deleteBehavior(beh()); break;
  }
}

// ---- kid: submit a routine ----
async function submitRoutine(behaviorId){
  try{
    const { error } = await sb.rpc('submit_marks', { p_behavior: behaviorId });
    if(error) throw error;
    toast('ok', 'Inskickat ⭐');
    await Promise.all([loadMarkRequests(), loadMarkLedger(), loadMarkBalances()]);
    const mine = pendingRequestFor(behaviorId, me.id);
    if(mine) notify('mark_request', { requestId: mine.id });
    renderRoutines();
  }catch(err){ console.warn('submitRoutine', err); toast('warn', 'Något gick fel'); }
}

// ---- parent: approve / reject ----
async function approveMarks(reqId){
  try{
    const { error } = await sb.rpc('approve_marks', { p_request: reqId });
    if(error) throw error;
    toast('ok', 'Godkänt ⭐');
    notify('mark_approved', { requestId: reqId });
    await Promise.all([loadMarkRequests(), loadMarkLedger(), loadMarkBalances()]);
    renderRoutines();
  }catch(err){ console.warn('approveMarks', err); toast('warn', 'Kunde inte godkänna'); }
}
async function rejectMarks(reqId){
  try{
    const { error } = await sb.rpc('reject_marks', { p_request: reqId });
    if(error) throw error;
    toast('ok', 'Nekat');
    notify('mark_rejected', { requestId: reqId });
    await loadMarkRequests();
    renderRoutines();
  }catch(err){ console.warn('rejectMarks', err); toast('warn', 'Kunde inte neka'); }
}

// ---- parent: behaviour library ----
function openBehaviorDialog(b){
  editingBehavior = b || null;
  $('behaviorDlgTitle').textContent = b ? 'Redigera' : 'Ny rutin';
  $('behaviorTitle').value = b ? b.title : '';
  $('behaviorMarks').value = b ? b.marks : 1;
  $('behaviorKind').value  = b ? b.kind : 'routine';
  $('behaviorDialog').showModal();
}
async function saveBehavior(){
  const title = $('behaviorTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad som ska göras'); return; }
  const marks = Math.max(0, Math.round(Number($('behaviorMarks').value) || 0));
  const kind = $('behaviorKind').value === 'bonus' ? 'bonus' : 'routine';
  try{
    let error;
    if(editingBehavior){
      ({ error } = await sb.from('behaviors').update({ title, marks, kind }).eq('id', editingBehavior.id));
    } else {
      ({ error } = await sb.from('behaviors').insert({ title, marks, kind, created_by: me.id }));
    }
    if(error) throw error;
    toast('ok', editingBehavior ? 'Uppdaterad' : 'Tillagd');
    await loadBehaviors();
    renderRoutines();
  }catch(err){ console.warn('saveBehavior', err); toast('warn', 'Kunde inte spara'); }
}
async function deleteBehavior(b){
  if(!b) return;
  if(!(await confirmDialog(`Ta bort "${b.title}"?`))) return;
  try{
    const { error } = await sb.from('behaviors').delete().eq('id', b.id);
    if(error) throw error;
    toast('ok', 'Borttagen');
    await Promise.all([loadBehaviors(), loadMarkRequests()]);   // pending requests cascade away
    renderRoutines();
  }catch(err){ console.warn('deleteBehavior', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- parent: award bonus marks ----
function openBonusDialog(profileId){
  bonusProfileId = profileId || null;
  const kids = (state.profiles || []).filter(p => p.role === 'kid');
  $('bonusProfile').innerHTML = kids.map(k => `<option value="${k.id}">${escapeHtml(capital(k.name))}</option>`).join('');
  if(profileId) $('bonusProfile').value = profileId;
  const picks = bonusLib();
  const wrap = $('bonusQuickWrap');
  if(picks.length){
    $('bonusPicks').innerHTML = picks.map(b =>
      `<button type="button" class="bonus-pick" data-bonusfill="${b.id}">${escapeHtml(b.title)} <span class="bp-marks">+${b.marks}</span></button>`).join('');
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
  $('bonusReason').value = '';
  $('bonusMarks').value = 5;
  $('bonusDialog').showModal();
}
function onBonusPickClick(e){
  const b = e.target.closest('[data-bonusfill]');
  if(!b) return;
  const beh = (state.behaviors || []).find(x => x.id === b.dataset.bonusfill);
  if(!beh) return;
  $('bonusReason').value = beh.title;
  $('bonusMarks').value = beh.marks;
}
async function saveBonus(){
  const profile = $('bonusProfile').value;
  const reason = $('bonusReason').value.trim();
  const marks = Math.round(Number($('bonusMarks').value) || 0);
  if(!profile){ toast('warn', 'Välj vem'); return; }
  if(!reason){ toast('warn', 'Skriv en anledning'); return; }
  if(!marks){ toast('warn', 'Ange antal streck'); return; }
  try{
    const { error } = await sb.rpc('award_marks', { p_profile: profile, p_amount: marks, p_reason: reason });
    if(error) throw error;
    toast('ok', `+${marks} streck`);
    notify('mark_bonus', { toProfile: profile, amount: marks, reason });
    await Promise.all([loadMarkLedger(), loadMarkBalances()]);
    renderRoutines();
  }catch(err){ console.warn('saveBonus', err); toast('warn', 'Kunde inte spara'); }
}
