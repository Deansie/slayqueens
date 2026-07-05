'use strict';
// Credits: kids see their own balance + history; parents see all balances and can adjust/pay out.
let adjustingProfile = null;

function balanceOf(profileId){
  const row = (state.balances || []).find(b => b.profile_id === profileId);
  return row ? row.balance : 0;
}

function renderCredits(){
  const box = $('creditsBody');
  if(!box || !me) return;
  if(isParent()) renderCreditsParent(box);
  else renderCreditsKid(box);
}

function renderCreditsKid(box){
  const bal = balanceOf(me.id);
  const entries = (state.ledger || []).filter(l => l.profile_id === me.id);
  const earned = entries.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const pending = (state.payouts || []).find(p => p.profile_id === me.id && p.status === 'pending');
  const action = pending
    ? `<div class="payout-pending">⏳ Väntar på utbetalning: ${escapeHtml(fmtMoney(pending.amount))}</div>`
    : (bal > 0 ? `<button class="btn block" data-request="1" type="button">Begär utbetalning</button>` : '');
  box.innerHTML = `
    <div class="balance-card">
      <div class="balance-label">Ditt saldo</div>
      <div class="balance-value">${escapeHtml(fmtMoney(bal))}</div>
      <div class="balance-sub">Intjänat totalt: ${escapeHtml(fmtMoney(earned))}</div>
    </div>
    ${action}
    <div class="section-title">Historik</div>
    <div class="ledger-list">
      ${entries.length ? entries.map(l => ledgerItem(l)).join('')
        : '<div class="placeholder mini"><p>Inget intjänat än — plocka ett jobb!</p></div>'}
    </div>`;
}

function renderCreditsParent(box){
  const kids = (state.profiles || []).filter(p => p.role === 'kid');
  const rows = kids.map(k => {
    const bal = balanceOf(k.id);
    return `
    <div class="balance-row">
      <span class="br-name">${avatarHtml(profileColor(k), k.name)}${escapeHtml(capital(k.name))}</span>
      <span class="br-bal">${escapeHtml(fmtMoney(bal))}</span>
      <span class="br-actions">
        ${bal > 0 ? `<button class="btn ghost sm" data-payout="${k.id}" type="button">Betala ut</button>` : ''}
        <button class="btn ghost sm" data-adjust="${k.id}" type="button">Justera</button>
      </span>
    </div>`;
  }).join('');
  const pending = (state.payouts || []).filter(p => p.status === 'pending');
  const reqRows = pending.map(p => {
    const kid = state.profilesById[p.profile_id];
    return `
    <div class="balance-row">
      <span class="br-name">${avatarHtml(profileColor(kid), kid ? kid.name : '?')}${escapeHtml(kid ? capital(kid.name) : '—')} vill ta ut</span>
      <span class="br-bal">${escapeHtml(fmtMoney(p.amount))}</span>
      <span class="br-actions">
        <button class="btn sm" data-resolve="${p.id}" data-approve="1" type="button">Betala</button>
        <button class="btn ghost sm" data-resolve="${p.id}" data-approve="0" type="button">Neka</button>
      </span>
    </div>`;
  }).join('');
  const recent = (state.ledger || []).slice(0, 12);
  box.innerHTML = `
    ${pending.length ? `<div class="section-title">Begäran om utbetalning</div>
    <div class="balance-rows">${reqRows}</div>` : ''}
    <div class="section-title">Familjens konton</div>
    <div class="balance-rows">
      ${kids.length ? rows : '<div class="placeholder mini"><p>Inga barn-konton än.</p></div>'}
    </div>
    <div class="section-title">Senaste händelser</div>
    <div class="ledger-list">
      ${recent.length ? recent.map(l => ledgerItem(l, true)).join('')
        : '<div class="placeholder mini"><p>Inga poäng utdelade än.</p></div>'}
    </div>`;
}

function ledgerItem(l, showWho){
  const p = state.profilesById[l.profile_id];
  const who = showWho && p ? escapeHtml(capital(p.name)) + ' · ' : '';
  const sign = l.amount >= 0 ? 'pos' : 'neg';
  const amount = (l.amount >= 0 ? '+' : '') + fmtMoney(l.amount);
  return `
    <div class="ledger-item">
      <div class="li-left">
        <div class="li-reason">${escapeHtml(l.reason)}</div>
        <div class="li-date">${who}${escapeHtml(fmtWhen(l.created_at))}</div>
      </div>
      <div class="li-amount ${sign}">${escapeHtml(amount)}</div>
    </div>`;
}

// Adjust / payout (parent) ---------------------------------------------
function onCreditsClick(e){
  const adjustBtn = e.target.closest('[data-adjust]');
  if(adjustBtn){ openAdjustDialog(adjustBtn.dataset.adjust); return; }
  const payBtn = e.target.closest('[data-payout]');
  if(payBtn){ const id = payBtn.dataset.payout; openAdjustDialog(id, -balanceOf(id), 'Utbetalt'); return; }
  const reqBtn = e.target.closest('[data-request]');
  if(reqBtn){ requestPayout(); return; }
  const resBtn = e.target.closest('[data-resolve]');
  if(resBtn){ resolvePayout(resBtn.dataset.resolve, resBtn.dataset.approve === '1'); }
}

async function requestPayout(){
  const bal = balanceOf(me.id);
  if(bal <= 0) return;
  if(!(await confirmDialog(`Begär utbetalning av ${fmtMoney(bal)}?`, 'Begär'))) return;
  try{
    const { error } = await sb.rpc('request_payout', { p_amount: bal });
    if(error) throw error;
    toast('ok', 'Begäran skickad');
    await loadPayouts();
    const mine = (state.payouts || []).find(p => p.profile_id === me.id && p.status === 'pending');
    if(mine) notify('payout_request', { payoutId: mine.id });
    renderCredits();
  }catch(err){ console.warn('requestPayout', err); toast('warn', 'Kunde inte begära'); }
}

async function resolvePayout(id, approve){
  try{
    const { error } = await sb.rpc('resolve_payout', { p_request: id, p_approve: approve });
    if(error) throw error;
    toast('ok', approve ? 'Utbetalt' : 'Nekad');
    notify('payout_resolved', { payoutId: id });
    await Promise.all([loadPayouts(), loadBalances(), loadLedger()]);
    renderCredits();
  }catch(err){ console.warn('resolvePayout', err); toast('warn', 'Kunde inte hantera'); }
}

function openAdjustDialog(profileId, amount, reason){
  adjustingProfile = profileId;
  const p = state.profilesById[profileId];
  $('adjustTitle').textContent = 'Justera – ' + (p ? capital(p.name) : '');
  $('adjustAmount').value = (amount != null) ? amount : '';
  $('adjustReason').value = reason || '';
  $('adjustDialog').showModal();
}

async function saveAdjust(){
  const amount = Math.round(Number($('adjustAmount').value) || 0);
  const reason = $('adjustReason').value.trim();
  if(!amount){ toast('warn', 'Ange ett belopp (t.ex. -50)'); return; }
  if(!reason){ toast('warn', 'Ange en anledning'); return; }
  try{
    const { error } = await sb.rpc('adjust_credits', { p_profile: adjustingProfile, p_amount: amount, p_reason: reason });
    if(error) throw error;
    toast('ok', 'Saldo justerat');
    await Promise.all([loadBalances(), loadLedger()]);
    renderCredits();
  }catch(err){
    console.warn('adjust', err);
    toast('warn', 'Kunde inte justera');
  }
}
