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
  box.innerHTML = `
    <div class="balance-card">
      <div class="balance-label">Ditt saldo</div>
      <div class="balance-value">${escapeHtml(fmtMoney(bal))}</div>
      <div class="balance-sub">Intjänat totalt: ${escapeHtml(fmtMoney(earned))}</div>
    </div>
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
      <span class="br-name"><span class="dot" style="background:${profileColor(k)}"></span>${escapeHtml(capital(k.name))}</span>
      <span class="br-bal">${escapeHtml(fmtMoney(bal))}</span>
      <span class="br-actions">
        ${bal > 0 ? `<button class="btn ghost sm" data-payout="${k.id}" type="button">Betala ut</button>` : ''}
        <button class="btn ghost sm" data-adjust="${k.id}" type="button">Justera</button>
      </span>
    </div>`;
  }).join('');
  const recent = (state.ledger || []).slice(0, 12);
  box.innerHTML = `
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
  if(payBtn){
    const id = payBtn.dataset.payout;
    openAdjustDialog(id, -balanceOf(id), 'Utbetalt');
  }
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
