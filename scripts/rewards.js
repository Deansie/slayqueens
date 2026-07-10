'use strict';
// Belöningsbutik: kids spend the streck ("marks") they earn in Rutiner on rewards a parent has
// set up. Rewards are grouped into parent-made tiers and priced in stars (1 star = 10 streck).
// Redeeming reserves the streck and creates a pending redemption a parent fulfils or cancels.
// Reached from the profile menu (not the tab bar). All value changes go through SECURITY DEFINER
// RPCs so a kid can never over-spend or self-fulfil.
const REWARD_EMOJI = ['🎁','🍦','🍭','🎮','🍿','🎬','🧸','🎡','🎢','🏊','🎨','⚽','🍔','🍕','🎂','📚','🛝','🐾'];
let editingTier = null, editingReward = null;
let tierEmoji = '🎁', rewardEmoji = '🎁';

function bySort(a, b){ return (a.sort - b.sort) || (new Date(a.created_at) - new Date(b.created_at)); }
function rewardById(id){ return (state.rewards || []).find(r => r.id === id); }

function renderRewards(){
  const box = $('rewardsBody');
  if(!box || !me) return;
  box.innerHTML = isParent() ? rewardsParentHtml() : rewardsKidHtml();
}

// ---- kid view ----
function rewardsKidHtml(){
  const mine = (state.redemptions || []).filter(r => r.profile_id === me.id && r.status === 'pending');
  const pending = mine.length
    ? `<div class="section-title">Väntar på förälder</div><div class="redeem-list">${mine.map(kidRedeemRow).join('')}</div>`
    : '';
  return `${markBalanceCard(me.id)}${pending}${shopHtml(false)}`;
}
function kidRedeemRow(r){
  const rw = rewardById(r.reward_id);
  return `<div class="redeem-item">
      <span class="ri-what">${escapeHtml(rw ? (rw.emoji ? rw.emoji + ' ' : '') + rw.title : 'Belöning')} <span class="ri-cost">${Math.round(r.cost_marks / 10)} ⭐</span></span>
      <span class="ri-status">Väntar…</span>
      <button class="btn ghost sm" data-reward="cancel" data-id="${r.id}" type="button">Ångra</button>
    </div>`;
}

// ---- parent view ----
function rewardsParentHtml(){
  const pending = (state.redemptions || []).filter(r => r.status === 'pending');
  const queue = pending.length
    ? `<div class="section-title">Att lösa in</div><div class="redeem-list">${pending.map(parentRedeemRow).join('')}</div>`
    : '';
  return `${queue}${shopHtml(true)}`;
}
function parentRedeemRow(r){
  const kid = state.profilesById[r.profile_id];
  const rw = rewardById(r.reward_id);
  return `<div class="redeem-item">
      <span class="ri-who">${avatarHtml(profileColor(kid), kid ? kid.name : '?')}${escapeHtml(kid ? capital(kid.name) : '—')}</span>
      <span class="ri-what">${escapeHtml(rw ? (rw.emoji ? rw.emoji + ' ' : '') + rw.title : 'Belöning')} <span class="ri-cost">${Math.round(r.cost_marks / 10)} ⭐</span></span>
      <span class="ri-actions">
        <button class="btn sm" data-reward="fulfill" data-id="${r.id}" type="button">Lämnad</button>
        <button class="btn ghost sm" data-reward="cancel" data-id="${r.id}" type="button">Avbryt</button>
      </span>
    </div>`;
}

// ---- the shop (shared; `manage` adds parent edit controls) ----
function shopHtml(manage){
  const tiers = (state.rewardTiers || []).filter(t => t.active).slice().sort(bySort);
  const rewards = (state.rewards || []).filter(r => r.active).slice().sort(bySort);
  const sections = tiers.map(t => tierSection(t, rewards.filter(r => r.tier_id === t.id), manage));
  const orphan = rewards.filter(r => !r.tier_id || !tiers.some(t => t.id === r.tier_id));
  if(orphan.length) sections.push(tierSection(null, orphan, manage));

  const head = manage
    ? '<div class="section-title lib-head"><span>Butik</span><button class="btn ghost sm" data-reward="newtier" type="button">+ Ny nivå</button></div>'
    : '<div class="section-title">Butik</div>';
  const empty = (!tiers.length && !rewards.length)
    ? `<div class="placeholder mini"><p>${manage
        ? 'Skapa en nivå (t.ex. Små belöningar) och lägg till belöningar barnen kan spara till.'
        : 'Inga belöningar än — föräldrarna fyller butiken.'}</p></div>`
    : '';
  return head + empty + sections.join('');
}
function tierSection(t, list, manage){
  const title = t ? `${t.emoji ? escapeHtml(t.emoji) + ' ' : ''}${escapeHtml(t.title)}` : 'Övrigt';
  const tools = (manage && t)
    ? `<span class="tier-tools">
        <button class="btn ghost sm" data-reward="newreward" data-tier="${t.id}" type="button">+ Belöning</button>
        <button class="icon-btn" data-reward="edittier" data-tier="${t.id}" aria-label="Redigera nivå">✎</button>
        <button class="icon-btn" data-reward="deltier" data-tier="${t.id}" aria-label="Ta bort nivå">🗑</button>
      </span>`
    : '';
  const cards = list.length
    ? list.map(r => rewardCard(r, manage)).join('')
    : (manage ? '<div class="placeholder mini"><p>Inga belöningar i den här nivån än.</p></div>' : '');
  return `<section class="reward-tier">
      <header class="reward-tier-head"><h3 class="reward-tier-name serif">${title}</h3>${tools}</header>
      <div class="reward-grid">${cards}</div>
    </section>`;
}
function rewardCard(r, manage){
  const pool = r.poolable ? '<span class="pool-badge">delbar</span>' : '';
  let action;
  if(manage){
    action = `<span class="reward-tools">
        <button class="icon-btn" data-reward="editreward" data-id="${r.id}" aria-label="Redigera">✎</button>
        <button class="icon-btn" data-reward="delreward" data-id="${r.id}" aria-label="Ta bort">🗑</button>
      </span>`;
  } else {
    const need = r.cost_stars - starsOf(markBalanceOf(me.id));
    action = need <= 0
      ? `<button class="btn sm" data-reward="redeem" data-id="${r.id}" type="button">Lös in</button>`
      : `<span class="reward-need">${need} ⭐ till</span>`;
  }
  const locked = (!manage && r.cost_stars - starsOf(markBalanceOf(me.id)) > 0) ? ' locked' : '';
  return `<div class="reward-card${locked}">
      <span class="reward-emoji" aria-hidden="true">${escapeHtml(r.emoji || '🎁')}</span>
      <span class="reward-info">
        <span class="reward-name">${escapeHtml(r.title)}${pool}</span>
        <span class="reward-cost">${r.cost_stars} ⭐</span>
      </span>
      ${action}
    </div>`;
}

// ---- events ----
function onRewardsClick(e){
  const b = e.target.closest('[data-reward]');
  if(!b) return;
  const id = b.dataset.id, tier = b.dataset.tier;
  switch(b.dataset.reward){
    case 'redeem':     requestRedemption(id); break;
    case 'cancel':     cancelRedemption(id); break;
    case 'fulfill':    fulfillRedemption(id); break;
    case 'newtier':    openTierDialog(null); break;
    case 'edittier':   openTierDialog((state.rewardTiers || []).find(t => t.id === tier)); break;
    case 'deltier':    deleteTier((state.rewardTiers || []).find(t => t.id === tier)); break;
    case 'newreward':  openRewardDialog(null, tier); break;
    case 'editreward': openRewardDialog(rewardById(id), null); break;
    case 'delreward':  deleteReward(rewardById(id)); break;
  }
}

// ---- kid: redeem / cancel ----
async function requestRedemption(id){
  const rw = rewardById(id);
  if(!rw) return;
  if(!(await confirmDialog(`Lös in "${rw.title}" för ${rw.cost_stars} ⭐?`, 'Lös in'))) return;
  try{
    const { error } = await sb.rpc('request_redemption', { p_reward: id });
    if(error) throw error;
    toast('ok', 'Inlöst! 🎁');
    await Promise.all([loadRedemptions(), loadMarkLedger(), loadMarkBalances()]);
    const mine = (state.redemptions || []).find(r => r.profile_id === me.id && r.reward_id === id && r.status === 'pending');
    if(mine) notify('redemption_request', { redemptionId: mine.id });
    renderRewards();
    renderRoutines();
  }catch(err){ console.warn('requestRedemption', err); toast('warn', 'Kunde inte lösa in'); }
}
async function cancelRedemption(id){
  if(!(await confirmDialog('Avbryta inlösen och betala tillbaka strecken?', 'Avbryt inlösen'))) return;
  try{
    const { error } = await sb.rpc('cancel_redemption', { p_redemption: id });
    if(error) throw error;
    toast('ok', 'Återbetalt');
    await Promise.all([loadRedemptions(), loadMarkLedger(), loadMarkBalances()]);
    renderRewards();
    renderRoutines();
  }catch(err){ console.warn('cancelRedemption', err); toast('warn', 'Kunde inte avbryta'); }
}

// ---- parent: fulfil ----
async function fulfillRedemption(id){
  try{
    const { error } = await sb.rpc('fulfill_redemption', { p_redemption: id });
    if(error) throw error;
    toast('ok', 'Inlöst ✓');
    notify('redemption_fulfilled', { redemptionId: id });
    await loadRedemptions();
    renderRewards();
  }catch(err){ console.warn('fulfillRedemption', err); toast('warn', 'Kunde inte lösa in'); }
}

// ---- parent: tiers ----
function openTierDialog(t){
  editingTier = t || null;
  tierEmoji = t && t.emoji ? t.emoji : '🎁';
  $('tierDlgTitle').textContent = t ? 'Redigera nivå' : 'Ny nivå';
  $('tierTitle').value = t ? t.title : '';
  renderTierEmoji();
  $('tierDialog').showModal();
}
function renderTierEmoji(){
  $('tierEmojiPicks').innerHTML = REWARD_EMOJI.map(em =>
    `<button type="button" class="shop-emoji-pick${em === tierEmoji ? ' on' : ''}" data-tierem="${em}" aria-label="Ikon ${em}">${em}</button>`).join('');
}
function onTierEmojiClick(e){
  const b = e.target.closest('[data-tierem]');
  if(!b) return;
  tierEmoji = b.dataset.tierem;
  renderTierEmoji();
}
async function saveTier(){
  const title = $('tierTitle').value.trim();
  if(!title){ toast('warn', 'Skriv ett namn'); return; }
  try{
    let error;
    if(editingTier){
      ({ error } = await sb.from('reward_tiers').update({ title, emoji: tierEmoji }).eq('id', editingTier.id));
    } else {
      const sort = (state.rewardTiers || []).length;
      ({ error } = await sb.from('reward_tiers').insert({ title, emoji: tierEmoji, sort, created_by: me.id }));
    }
    if(error) throw error;
    toast('ok', editingTier ? 'Uppdaterad' : 'Nivå tillagd');
    await loadRewardTiers();
    renderRewards();
  }catch(err){ console.warn('saveTier', err); toast('warn', 'Kunde inte spara'); }
}
async function deleteTier(t){
  if(!t) return;
  if(!(await confirmDialog(`Ta bort nivån "${t.title}"? Belöningarna flyttas till Övrigt.`))) return;
  try{
    const { error } = await sb.from('reward_tiers').delete().eq('id', t.id);   // rewards keep (tier_id → null)
    if(error) throw error;
    toast('ok', 'Borttagen');
    await Promise.all([loadRewardTiers(), loadRewards()]);
    renderRewards();
  }catch(err){ console.warn('deleteTier', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- parent: rewards ----
function openRewardDialog(r, tierId){
  editingReward = r || null;
  rewardEmoji = r && r.emoji ? r.emoji : '🎁';
  $('rewardDlgTitle').textContent = r ? 'Redigera belöning' : 'Ny belöning';
  $('rewardTitle').value = r ? r.title : '';
  $('rewardCost').value = r ? r.cost_stars : 5;
  const tiers = (state.rewardTiers || []).slice().sort(bySort);
  $('rewardTier').innerHTML = '<option value="">Övrigt</option>' +
    tiers.map(t => `<option value="${t.id}">${escapeHtml((t.emoji ? t.emoji + ' ' : '') + t.title)}</option>`).join('');
  $('rewardTier').value = r ? (r.tier_id || '') : (tierId || '');
  $('rewardPoolable').checked = r ? !!r.poolable : false;
  renderRewardEmoji();
  $('rewardDialog').showModal();
}
function renderRewardEmoji(){
  $('rewardEmojiPicks').innerHTML = REWARD_EMOJI.map(em =>
    `<button type="button" class="shop-emoji-pick${em === rewardEmoji ? ' on' : ''}" data-rewardem="${em}" aria-label="Ikon ${em}">${em}</button>`).join('');
}
function onRewardEmojiClick(e){
  const b = e.target.closest('[data-rewardem]');
  if(!b) return;
  rewardEmoji = b.dataset.rewardem;
  renderRewardEmoji();
}
async function saveReward(){
  const title = $('rewardTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad belöningen är'); return; }
  const cost_stars = Math.max(1, Math.round(Number($('rewardCost').value) || 1));
  const tier_id = $('rewardTier').value || null;
  const poolable = $('rewardPoolable').checked;
  try{
    let error;
    if(editingReward){
      ({ error } = await sb.from('rewards').update({ title, emoji: rewardEmoji, cost_stars, tier_id, poolable }).eq('id', editingReward.id));
    } else {
      const sort = (state.rewards || []).filter(x => x.tier_id === tier_id).length;
      ({ error } = await sb.from('rewards').insert({ title, emoji: rewardEmoji, cost_stars, tier_id, poolable, sort, created_by: me.id }));
    }
    if(error) throw error;
    toast('ok', editingReward ? 'Uppdaterad' : 'Belöning tillagd');
    await loadRewards();
    renderRewards();
  }catch(err){ console.warn('saveReward', err); toast('warn', 'Kunde inte spara'); }
}
async function deleteReward(r){
  if(!r) return;
  if(!(await confirmDialog(`Ta bort "${r.title}"?`))) return;
  try{
    const { error } = await sb.from('rewards').delete().eq('id', r.id);
    if(error) throw error;
    toast('ok', 'Borttagen');
    await loadRewards();
    renderRewards();
  }catch(err){ console.warn('deleteReward', err); toast('warn', 'Kunde inte ta bort'); }
}
