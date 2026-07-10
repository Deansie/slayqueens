'use strict';
// Belöningsbutik: kids spend the streck ("marks") they earn in Rutiner on rewards a parent has
// set up. Rewards are grouped into parent-made tiers and priced in stars (1 star = 10 streck).
// Redeeming reserves the streck and creates a pending redemption a parent fulfils or cancels.
// Reached from the profile menu (not the tab bar). All value changes go through SECURITY DEFINER
// RPCs so a kid can never over-spend or self-fulfil.
const REWARD_EMOJI = ['🎁','🍦','🍭','🎮','🍿','🎬','🧸','🎡','🎢','🏊','🎨','⚽','🍔','🍕','🎂','📚','🛝','🐾'];
let editingTier = null, editingReward = null;
let tierEmoji = '🎁', rewardEmoji = '🎁';
let contributingGoal = null;

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
  return `${markBalanceCard(me.id)}${pending}${goalsHtml()}${shopHtml(false)}`;
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
  return `${queue}${goalsHtml()}${shopHtml(true)}`;
}

// ---- Familjemål (pooled goals) ----
function activeGoals(){ return (state.goals || []).filter(g => g.status === 'active' || g.status === 'reached'); }
function goalProgress(id){ return (state.contributions || []).filter(c => c.goal_id === id).reduce((s, c) => s + c.marks, 0); }
function myContribution(id){ return (state.contributions || []).filter(c => c.goal_id === id && c.profile_id === me.id).reduce((s, c) => s + c.marks, 0); }
function goalForReward(rewardId){ return (state.goals || []).find(g => g.reward_id === rewardId && (g.status === 'active' || g.status === 'reached')); }

function goalsHtml(){
  const goals = activeGoals();
  if(!goals.length) return '';
  return `<div class="section-title">Familjemål</div><div class="goal-list">${goals.map(goalCard).join('')}</div>`;
}
function goalCard(g){
  const prog = goalProgress(g.id);
  const pct = Math.min(100, Math.round(prog / g.target_marks * 100));
  const reached = prog >= g.target_marks;
  let actions;
  if(isParent()){
    actions = `${reached ? `<button class="btn sm" data-goal="fulfill" data-id="${g.id}" type="button">Lös in</button>` : ''}`
      + `<button class="btn ghost sm" data-goal="cancel" data-id="${g.id}" type="button">Avbryt</button>`;
  } else {
    const canGive = !reached && starsOf(markBalanceOf(me.id)) > 0;
    actions = `${canGive ? `<button class="btn sm" data-goal="contribute" data-id="${g.id}" type="button">Bidra</button>` : ''}`
      + `${myContribution(g.id) > 0 ? `<button class="btn ghost sm" data-goal="withdraw" data-id="${g.id}" type="button">Ta tillbaka</button>` : ''}`;
  }
  return `<div class="goal-card${reached ? ' reached' : ''}">
      <div class="goal-head">
        <span class="goal-emoji" aria-hidden="true">${escapeHtml(g.emoji || '🎯')}</span>
        <span class="goal-title serif">${escapeHtml(g.title)}</span>
        ${reached ? '<span class="goal-badge">Fullt! 🎉</span>' : ''}
      </div>
      <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
      <div class="goal-meta">
        <span class="goal-count">${Math.round(prog / 10)} / ${Math.round(g.target_marks / 10)} ⭐</span>
        ${contributorChips(g.id)}
      </div>
      ${actions ? `<div class="goal-actions">${actions}</div>` : ''}
    </div>`;
}
function contributorChips(id){
  const byProfile = {};
  for(const c of (state.contributions || []).filter(x => x.goal_id === id)){
    byProfile[c.profile_id] = (byProfile[c.profile_id] || 0) + c.marks;
  }
  const ids = Object.keys(byProfile);
  if(!ids.length) return '';
  return '<span class="goal-contribs">' + ids.map(pid => {
    const p = state.profilesById[pid];
    return `<span class="goal-contrib">${avatarHtml(profileColor(p), p ? p.name : '?')}<span class="gc-n">${Math.round(byProfile[pid] / 10)} ⭐</span></span>`;
  }).join('') + '</span>';
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

// Tiers ordered cheapest-first (by their star cost), so the shop reads Små → Mellan → Stora.
function byTierCost(a, b){ return (a.stars - b.stars) || bySort(a, b); }

// ---- the shop (shared; `manage` adds parent edit controls) ----
function shopHtml(manage){
  const tiers = (state.rewardTiers || []).filter(t => t.active).slice().sort(byTierCost);
  const rewards = (state.rewards || []).filter(r => r.active).slice().sort(bySort);
  const sections = tiers.map(t => tierSection(t, rewards.filter(r => r.tier_id === t.id), manage));
  // Rewards whose tier was deleted are non-redeemable; only parents see them (to reassign).
  const orphan = rewards.filter(r => !r.tier_id || !tiers.some(t => t.id === r.tier_id));
  if(manage && orphan.length) sections.push(tierSection(null, orphan, manage));

  const head = manage
    ? '<div class="section-title lib-head"><span>Butik</span><button class="btn ghost sm" data-reward="newtier" type="button">+ Ny nivå</button></div>'
    : '<div class="section-title">Butik</div>';
  const empty = (!tiers.length && !rewards.length)
    ? `<div class="placeholder mini"><p>${manage
        ? 'Skapa en nivå (t.ex. Små belöningar = 1 ⭐) och lägg till belöningar barnen kan spara till.'
        : 'Inga belöningar än — föräldrarna fyller butiken.'}</p></div>`
    : '';
  return head + empty + sections.join('');
}
function tierSection(t, list, manage){
  const label = t ? `${t.emoji ? escapeHtml(t.emoji) + ' ' : ''}${escapeHtml(t.title)}` : 'Övrigt (ingen nivå)';
  // A tier is unlocked once the kid's stars reach its cost; parents always see everything.
  const unlocked = manage || !t ? true : starsOf(markBalanceOf(me.id)) >= t.stars;
  const need = (t && !manage) ? t.stars - starsOf(markBalanceOf(me.id)) : 0;
  const cost = t ? `<span class="tier-cost">${t.stars} ⭐</span>` : '';
  const lock = (!manage && t && !unlocked) ? `<span class="tier-lock">🔒 ${need} ⭐ till</span>` : '';
  const tools = (manage && t)
    ? `<span class="tier-tools">
        <button class="btn ghost sm" data-reward="newreward" data-tier="${t.id}" type="button">+ Belöning</button>
        <button class="icon-btn" data-reward="edittier" data-tier="${t.id}" aria-label="Redigera nivå">✎</button>
        <button class="icon-btn" data-reward="deltier" data-tier="${t.id}" aria-label="Ta bort nivå">🗑</button>
      </span>`
    : '';
  const cards = list.length
    ? list.map(r => rewardCard(r, manage, unlocked)).join('')
    : (manage ? '<div class="placeholder mini"><p>Inga belöningar i den här nivån än.</p></div>' : '');
  return `<section class="reward-tier${unlocked ? '' : ' locked'}">
      <header class="reward-tier-head"><h3 class="reward-tier-name serif">${label}</h3>${cost}${lock}${tools}</header>
      <div class="reward-grid">${cards}</div>
    </section>`;
}
function rewardCard(r, manage, unlocked){
  const pool = r.poolable ? '<span class="pool-badge">delbar</span>' : '';
  let action = '';
  if(manage){
    // a poolable reward with no active goal yet can be turned into a Familjemål
    const startGoal = (r.poolable && !goalForReward(r.id))
      ? `<button class="btn ghost sm" data-reward="startgoal" data-id="${r.id}" type="button">Starta mål</button>`
      : '';
    action = `<span class="reward-tools">
        ${startGoal}
        <button class="icon-btn" data-reward="editreward" data-id="${r.id}" aria-label="Redigera">✎</button>
        <button class="icon-btn" data-reward="delreward" data-id="${r.id}" aria-label="Ta bort">🗑</button>
      </span>`;
  } else if(unlocked){
    action = `<button class="btn sm" data-reward="redeem" data-id="${r.id}" type="button">Lös in</button>`;
  }
  return `<div class="reward-card${(!manage && !unlocked) ? ' locked' : ''}">
      <span class="reward-emoji" aria-hidden="true">${escapeHtml(r.emoji || '🎁')}</span>
      <span class="reward-info"><span class="reward-name">${escapeHtml(r.title)}${pool}</span></span>
      ${action}
    </div>`;
}
function tierStarsOf(rewardId){
  const rw = rewardById(rewardId);
  const t = rw ? (state.rewardTiers || []).find(x => x.id === rw.tier_id) : null;
  return t ? t.stars : null;
}

// ---- events ----
function onRewardsClick(e){
  const g = e.target.closest('[data-goal]');
  if(g){ onGoalAction(g.dataset.goal, g.dataset.id); return; }
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
    case 'startgoal':  createGoal(id); break;
  }
}
function onGoalAction(act, id){
  if(act === 'contribute')   openContributeDialog(id);
  else if(act === 'withdraw') withdrawGoal(id);
  else if(act === 'fulfill')  fulfillGoal(id);
  else if(act === 'cancel')   cancelGoal(id);
}

// ---- kid: redeem / cancel ----
async function requestRedemption(id){
  const rw = rewardById(id);
  if(!rw) return;
  const stars = tierStarsOf(id);
  if(stars == null){ toast('warn', 'Belöningen saknar nivå'); return; }
  if(!(await confirmDialog(`Lös in "${rw.title}" för ${stars} ⭐?`, 'Lös in'))) return;
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

// ---- Familjemål (pooled goals) actions ----
async function createGoal(rewardId){
  try{
    const { error } = await sb.rpc('create_goal', { p_reward: rewardId });
    if(error) throw error;
    toast('ok', 'Familjemål startat 🎯');
    await loadGoals();
    const g = goalForReward(rewardId);
    if(g) notify('goal_new', { goalId: g.id });
    renderRewards();
  }catch(err){ console.warn('createGoal', err); toast('warn', 'Kunde inte starta mål'); }
}

function openContributeDialog(goalId){
  const g = (state.goals || []).find(x => x.id === goalId);
  if(!g) return;
  contributingGoal = goalId;
  const remainingStars = Math.max(0, Math.ceil((g.target_marks - goalProgress(goalId)) / 10));
  const myStars = starsOf(markBalanceOf(me.id));
  const maxStars = Math.max(1, Math.min(myStars, remainingStars));
  $('goalDlgTitle').textContent = 'Bidra: ' + g.title;
  $('goalDlgSub').textContent = `Du har ${myStars} ⭐. Målet behöver ${remainingStars} ⭐ till.`;
  const inp = $('goalStars');
  inp.max = maxStars;
  inp.value = 1;
  $('goalDialog').showModal();
}
async function saveContribution(){
  if(!contributingGoal) return;
  const stars = Math.round(Number($('goalStars').value) || 0);
  if(stars <= 0){ toast('warn', 'Ange hur många stjärnor'); return; }
  const goalId = contributingGoal;
  try{
    const { error } = await sb.rpc('contribute_goal', { p_goal: goalId, p_marks: stars * 10 });
    if(error) throw error;
    toast('ok', `Bidrog med ${stars} ⭐`);
    await Promise.all([loadGoals(), loadContributions(), loadMarkLedger(), loadMarkBalances()]);
    const g = (state.goals || []).find(x => x.id === goalId);
    if(g && g.status === 'reached') notify('goal_reached', { goalId: g.id });
    renderRewards();
    renderRoutines();
  }catch(err){ console.warn('saveContribution', err); toast('warn', 'Kunde inte bidra'); }
}
async function withdrawGoal(id){
  if(!(await confirmDialog('Ta tillbaka dina streck från målet?', 'Ta tillbaka'))) return;
  try{
    const { error } = await sb.rpc('withdraw_goal', { p_goal: id });
    if(error) throw error;
    toast('ok', 'Återtaget');
    await Promise.all([loadGoals(), loadContributions(), loadMarkLedger(), loadMarkBalances()]);
    renderRewards();
    renderRoutines();
  }catch(err){ console.warn('withdrawGoal', err); toast('warn', 'Kunde inte ta tillbaka'); }
}
async function fulfillGoal(id){
  if(!(await confirmDialog('Lös in familjemålet? Hela familjen får belöningen.', 'Lös in'))) return;
  try{
    const { error } = await sb.rpc('fulfill_goal', { p_goal: id });
    if(error) throw error;
    toast('ok', 'Inlöst 🎉');
    notify('goal_fulfilled', { goalId: id });
    await loadGoals();
    renderRewards();
  }catch(err){ console.warn('fulfillGoal', err); toast('warn', 'Kunde inte lösa in'); }
}
async function cancelGoal(id){
  if(!(await confirmDialog('Avbryta målet? Alla får tillbaka sina streck.', 'Avbryt mål'))) return;
  try{
    const { error } = await sb.rpc('cancel_goal', { p_goal: id });
    if(error) throw error;
    toast('ok', 'Avbrutet — streck återbetalda');
    await Promise.all([loadGoals(), loadContributions(), loadMarkLedger(), loadMarkBalances()]);
    renderRewards();
    renderRoutines();
  }catch(err){ console.warn('cancelGoal', err); toast('warn', 'Kunde inte avbryta'); }
}

// ---- parent: tiers ----
function openTierDialog(t){
  editingTier = t || null;
  tierEmoji = t && t.emoji ? t.emoji : '🎁';
  $('tierDlgTitle').textContent = t ? 'Redigera nivå' : 'Ny nivå';
  $('tierTitle').value = t ? t.title : '';
  // Default a new tier's cost to one more than the current highest, so tiers ladder 1, 2, 3…
  const maxStars = (state.rewardTiers || []).reduce((m, x) => Math.max(m, x.stars || 0), 0);
  $('tierStars').value = t ? t.stars : (maxStars + 1);
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
  const stars = Math.max(1, Math.round(Number($('tierStars').value) || 1));
  try{
    let error;
    if(editingTier){
      ({ error } = await sb.from('reward_tiers').update({ title, emoji: tierEmoji, stars }).eq('id', editingTier.id));
    } else {
      const sort = (state.rewardTiers || []).length;
      ({ error } = await sb.from('reward_tiers').insert({ title, emoji: tierEmoji, stars, sort, created_by: me.id }));
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
  const tiers = (state.rewardTiers || []).slice().sort(byTierCost);
  if(!tiers.length){ toast('warn', 'Skapa en nivå först'); return; }
  editingReward = r || null;
  rewardEmoji = r && r.emoji ? r.emoji : '🎁';
  $('rewardDlgTitle').textContent = r ? 'Redigera belöning' : 'Ny belöning';
  $('rewardTitle').value = r ? r.title : '';
  $('rewardTier').innerHTML = tiers.map(t =>
    `<option value="${t.id}">${escapeHtml((t.emoji ? t.emoji + ' ' : '') + t.title)} · ${t.stars} ⭐</option>`).join('');
  $('rewardTier').value = (r && r.tier_id) || tierId || tiers[0].id;
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
  const tier_id = $('rewardTier').value || null;
  if(!tier_id){ toast('warn', 'Välj en nivå'); return; }
  const poolable = $('rewardPoolable').checked;
  try{
    let error;
    if(editingReward){
      ({ error } = await sb.from('rewards').update({ title, emoji: rewardEmoji, tier_id, poolable }).eq('id', editingReward.id));
    } else {
      const sort = (state.rewards || []).filter(x => x.tier_id === tier_id).length;
      ({ error } = await sb.from('rewards').insert({ title, emoji: rewardEmoji, tier_id, poolable, sort, created_by: me.id }));
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
