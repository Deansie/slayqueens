'use strict';
// Shopping board ("Inköp"): categories a parent creates and assigns, each holding what's
// missing. Parents make categories and assign each to a person (or leave it shared); a kid
// sees only their own + shared categories and adds what they need there. Ownership lives on
// the category, so item visibility is inherited (enforced by RLS). Items tick off when bought.
//
// Two levels, so the page stays short however long the lists get: an overview with one quiet
// row per list (name, who it's for, how many are left), and a list page that opens on tap with
// a big title, round ticks, and an "add" bar at the bottom by the thumb. Tapping an item's name
// opens a sheet (Köpt / Ta bort / in the kids' wish list "🔒 Spara undan" to Julklappar). Bought
// items fold into "n köpta". Parents can reorder the lists from the overview.

// A small palette of category icons parents can pick from (first one is the default).
const SHOP_EMOJI = ['🛒','👕','🎒','🧴','🍎','🧻','💊','🎮','🏠','✏️','⚽','🐶','🎄'];

let editingTopicEmoji = '🛒';      // emoji chosen in the category dialog
let shopOpenTopic = null;          // the list whose page is open (null = the overview)
let shopReorder = false;           // parents: "↕ Ändra ordning" — ↑/↓ on every list
const shopShowBought = {};         // category id → bought items unfolded

function itemsForTopic(id){ return (state.shopItems || []).filter(i => i.topic_id === id); }
const shopLeft = id => itemsForTopic(id).filter(i => !i.bought).length;

function renderShopping(){
  const box = $('shoppingBoard');
  if(!box || !me) return;
  const topics = state.shopTopics || [];

  if(!topics.length){
    box.innerHTML = `<div class="placeholder mini"><div class="ph-emoji">🛒</div>
        <h3>Inga inköpskategorier</h3>
        <p>${isParent()
          ? 'Tryck ＋ Ny kategori för att skapa en (t.ex. Kläder) — sen kan alla fylla i vad som saknas.'
          : 'Föräldrarna lägger till kategorier här, sen kan du fylla i vad du behöver.'}</p>
      </div>`;
    return;
  }
  if(shopOpenTopic && !topics.some(t => t.id === shopOpenTopic)) shopOpenTopic = null;
  if(!isParent()) shopReorder = false;

  // Keep a half-typed item (and the cursor) when a live update repaints the page.
  const active = document.activeElement;
  const typing = active && active.dataset && active.dataset.shopqa ? { id: active.id, value: active.value } : null;
  const topic = shopOpenTopic && topics.find(t => t.id === shopOpenTopic);
  box.innerHTML = topic ? listPage(topic) : overviewHtml(topics);
  if(typing){ const el = $(typing.id); if(el){ el.value = typing.value; el.focus(); } }
  updateFab();   // the "Ny kategori" button only belongs on the overview
}

// ---- overview: one quiet row per list ----
function overviewHtml(topics){
  const rows = shopReorder
    ? topics.map((t, i) => reorderRow(t, i, topics.length)).join('')
    : topics.map(topicRow).join('');
  const orderBtn = (isParent() && topics.length > 1)
    ? `<button class="shop-order" type="button" data-shop="order" aria-pressed="${shopReorder}">${shopReorder ? 'Klar' : '↕ Ändra ordning'}</button>`
    : '';
  return `<div class="shop-acc${shopReorder ? ' is-reorder' : ''}">${rows}</div>${orderBtn}`;
}

// Swedish genitive: Ella → Ellas, but Nils → Nils (names ending in s/x/z take no extra s).
function possessive(name){ return /[sxz]$/i.test(name) ? name : name + 's'; }

function ownerOf(t){ return t.owner_id ? state.profilesById[t.owner_id] : null; }

function topicRow(t){
  const items = itemsForTopic(t.id);
  const left = shopLeft(t.id);
  // parents see whose list it is (to manage assignments); a kid only ever sees their own +
  // shared lists, so a self-label would just be noise.
  const owner = isParent() ? ownerOf(t) : null;
  const count = left ? String(left) : (items.length ? 'Allt köpt' : '');
  return `
    <button class="shop-row" type="button" data-shop="open" data-topic="${t.id}">
      <span class="shop-emoji" aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>
      <span class="shop-row-text">
        <span class="shop-row-title">${escapeHtml(t.title)}</span>
        ${owner ? `<span class="shop-owner">${escapeHtml(capital(owner.name))}</span>` : ''}
      </span>
      <span class="shop-count${left ? '' : ' is-clear'}">${count}</span>
      <span class="shop-caret" aria-hidden="true">›</span>
    </button>`;
}

// A list's row while parents are changing the order: no opening, just ↑ / ↓.
function reorderRow(t, i, n){
  const owner = ownerOf(t);
  const name = escapeHtml(t.title);
  return `
    <div class="shop-row">
      <span class="shop-emoji" aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>
      <span class="shop-row-text">
        <span class="shop-row-title">${name}</span>
        ${owner ? `<span class="shop-owner">${escapeHtml(capital(owner.name))}</span>` : ''}
      </span>
      <span class="shop-move">
        <button class="shop-move-btn" type="button" data-shop="up" data-topic="${t.id}" aria-label="Flytta upp ${name}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="shop-move-btn" type="button" data-shop="down" data-topic="${t.id}" aria-label="Flytta ner ${name}"${i === n - 1 ? ' disabled' : ''}>↓</button>
      </span>
    </div>`;
}

// Move a list one step, renumber them all in the new order and save the ones that changed.
async function moveTopic(id, dir){
  if(demoBlock()) return;
  const list = (state.shopTopics || []).slice();
  const i = list.findIndex(t => t.id === id), j = i + dir;
  if(i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = [];
  list.forEach((t, k) => { if(t.sort !== k){ t.sort = k; changed.push(t); } });
  state.shopTopics = list;
  renderShopping();
  // keep the focus on the moved list's arrow so it can be tapped again
  const next = $('shoppingBoard').querySelector(`[data-shop="${dir < 0 ? 'up' : 'down'}"][data-topic="${id}"]:not(:disabled)`)
    || $('shoppingBoard').querySelector(`[data-topic="${id}"].shop-move-btn:not(:disabled)`);
  if(next) next.focus();
  if(!changed.length) return;
  try{
    const results = await Promise.all(changed.map(t =>
      sb.from('shopping_topics').update({ sort: t.sort }).eq('id', t.id)));
    const failed = results.find(r => r.error);
    if(failed) throw failed.error;
  }catch(err){
    console.warn('moveTopic', err);
    toast('warn', 'Kunde inte spara ordningen');
    await loadShopTopics();
    renderShopping();
  }
}

// ---- a list's own page ----
function listPage(t){
  const parent = isParent();
  const items = itemsForTopic(t.id);
  // still-needed first (oldest first), then bought (most recently bought first)
  const open   = items.filter(i => !i.bought).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const bought = items.filter(i =>  i.bought).sort((a, b) => new Date(b.bought_at || b.created_at) - new Date(a.bought_at || a.created_at));
  const showBought = !!shopShowBought[t.id];
  const owner = ownerOf(t);
  const left = open.length;
  const sub = `${owner ? `${possessive(capital(owner.name))} lista` : 'Familjens lista'} · ${left ? `${left} kvar` : 'allt köpt'}`;
  const n = chatCountFor('shopping', t.id);
  return `
    <div class="shop-page-head">
      <button class="shop-back" type="button" data-shop="back">‹ Inköp</button>
      <h2 class="shop-page-title serif"><span aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>${escapeHtml(t.title)}</h2>
      <p class="shop-page-sub">${escapeHtml(sub)}</p>
    </div>
    <div class="shop-list">
      ${open.length ? open.map(itemRow).join('') : '<p class="shop-empty">Inget som saknas just nu.</p>'}
      ${showBought ? bought.map(itemRow).join('') : ''}
    </div>
    <div class="shop-meta">
      ${bought.length ? `<button class="shop-meta-btn" type="button" data-shop="bought" data-topic="${t.id}" aria-expanded="${showBought}">${showBought ? 'Dölj köpta' : `${bought.length} köpta`}</button>` : ''}
      ${showBought && bought.length && parent ? `<button class="shop-meta-btn" type="button" data-shop="clear" data-topic="${t.id}">Rensa köpta</button>` : ''}
      <button class="shop-meta-btn" type="button" data-shop="chat" data-topic="${t.id}">💬 ${n ? `${n} kommentar${n === 1 ? '' : 'er'}` : 'Kommentarer'}</button>
      ${parent ? `<button class="shop-meta-btn danger" type="button" data-shop="deltopic" data-topic="${t.id}">Ta bort listan</button>` : ''}
    </div>
    <div class="shop-addbar">
      <label class="sr-only" for="shopQa-${t.id}">Lägg till i ${escapeHtml(t.title)}</label>
      <input class="shop-qa" id="shopQa-${t.id}" data-shopqa="${t.id}" type="text" maxlength="80"
        autocomplete="off" enterkeyhint="done" placeholder="${t.owner_id ? 'Lägg till det du saknar…' : 'Lägg till…'}">
      <button class="shop-addbtn" type="button" data-shop="add" data-topic="${t.id}" aria-label="Lägg till">＋</button>
    </div>`;
}

function itemRow(i){
  return `<div class="shop-item${i.bought ? ' bought' : ''}">
      <button class="shop-check" data-shop="toggle" data-item="${i.id}" type="button" role="checkbox" aria-checked="${i.bought}" aria-label="Markera köpt: ${escapeHtml(i.title)}">${i.bought ? '✓' : ''}</button>
      <button class="shop-item-title" type="button" data-shop="item" data-item="${i.id}">${escapeHtml(i.title)}</button>
    </div>`;
}

// Tap an item's name: what you can do with it. Delete is for whoever added it, and parents; saving
// to Julklappar is for parents, and only from the kids' wish list ("Önskelista till jul…").
function openItemSheet(id){
  const it = (state.shopItems || []).find(x => x.id === id);
  const t = it && (state.shopTopics || []).find(x => x.id === it.topic_id);
  if(!it || !t) return;
  const canDelete = it.created_by === me.id || isParent();
  const keepable = isParent() && typeof isWishList === 'function' && isWishList(t);
  const owner = ownerOf(t);
  openSheet(`
    <div class="sheet-in">
      <p class="sheet-who"><span aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>${escapeHtml(t.title)}${owner ? ` · ${escapeHtml(capital(owner.name))}` : ''}</p>
      <h3 class="sheet-title">${escapeHtml(it.title)}</h3>
      <div class="sheet-actions">
        <button class="sheet-btn" type="button" data-sh="tick">${it.bought ? '↺ Inte köpt ändå' : '✓ Markera som köpt'}</button>
        ${keepable ? '<button class="sheet-btn gold" type="button" data-sh="keep">🔒 Spara undan</button>' : ''}
        ${canDelete ? '<button class="sheet-btn danger" type="button" data-sh="del">Ta bort</button>' : ''}
      </div>
    </div>`, (act) => {
    if(act === 'tick') toggleShopItem(id);
    else if(act === 'del') deleteShopItem(id);
    else if(act === 'keep' && typeof openKeepDialog === 'function') openKeepDialog(id);
  });
}

// Inköp always opens on the overview (the lists), not on the list you were in last time.
function resetShopping(){
  if(!shopOpenTopic && !shopReorder) return;
  shopOpenTopic = null;
  shopReorder = false;
  renderShopping();
}

function openTopicPage(id){
  shopOpenTopic = id;
  renderShopping();
  window.scrollTo(0, 0);
}

function onShoppingClick(e){
  const b = e.target.closest('[data-shop]');
  if(!b) return;
  const act = b.dataset.shop, topic = b.dataset.topic, item = b.dataset.item;
  if(act === 'open') openTopicPage(topic);
  else if(act === 'back'){
    const was = shopOpenTopic;
    shopOpenTopic = null;
    renderShopping();
    window.scrollTo(0, 0);
    const row = $('shoppingBoard').querySelector(`[data-topic="${was}"]`);
    if(row) row.focus({ preventScroll: true });
  }
  else if(act === 'order'){
    shopReorder = !shopReorder;
    renderShopping();
    const btn = $('shoppingBoard').querySelector('[data-shop="order"]');
    if(btn) btn.focus();
  }
  else if(act === 'up')   moveTopic(topic, -1);
  else if(act === 'down') moveTopic(topic, 1);
  else if(act === 'bought'){ shopShowBought[topic] = !shopShowBought[topic]; renderShopping(); }
  else if(act === 'clear')    clearBought(topic);
  else if(act === 'deltopic') deleteTopic(topic);
  else if(act === 'toggle')   toggleShopItem(item);
  else if(act === 'item')     openItemSheet(item);
  else if(act === 'chat')     openChat('shopping', topic, chatTitleFor('shopping', topic));
  else if(act === 'add'){
    const inp = $('shopQa-' + topic);
    if(inp) submitShopQa(inp);
  }
}

// Type an item and press Enter (or ＋) to add it to the open list.
function onShoppingKey(e){
  if(e.key !== 'Enter') return;
  const inp = e.target.closest('[data-shopqa]');
  if(!inp) return;
  e.preventDefault();
  submitShopQa(inp);
}
function submitShopQa(inp){
  if(demoBlock()) return;
  const title = inp.value.trim();
  if(!title){ inp.focus(); return; }
  inp.value = '';
  addShopItem(inp.dataset.shopqa, title, inp);
}

async function addShopItem(topicId, title, input){
  try{
    const { data, error } = await sb.from('shopping_items')
      .insert({ topic_id: topicId, title, created_by: me.id })
      .select('id').single();
    if(error) throw error;
    if(data) notify('shopping_item', { itemId: data.id });
    await loadShopItems();
    renderShopping();
    const again = $('shopQa-' + topicId);
    if(again) again.focus();
  }catch(err){
    console.warn('addShopItem', err);
    if(input && !input.value) input.value = title;   // give the text back so it can be retried
    toast('warn', 'Kunde inte spara');
  }
}

// ---- categories (parent) ----
function openTopicDialog(){
  if(demoBlock()) return;
  editingTopicEmoji = '🛒';
  $('shopTopicTitle').value = '';
  // Assign the category to a person (only they + parents will see it) or leave it shared.
  $('shopTopicOwner').innerHTML = '<option value="">Familjen (delad)</option>' +
    state.profiles.map(p => `<option value="${p.id}">${escapeHtml(capital(p.name))}</option>`).join('');
  $('shopTopicOwner').value = '';
  renderEmojiPicker();
  $('shopTopicDialog').showModal();
}

function renderEmojiPicker(){
  $('shopEmojiPicks').innerHTML = SHOP_EMOJI.map(em =>
    `<button type="button" class="shop-emoji-pick${em === editingTopicEmoji ? ' on' : ''}" data-emoji="${em}" aria-label="Ikon ${em}"${em === editingTopicEmoji ? ' aria-pressed="true"' : ''}>${em}</button>`).join('');
}

function onEmojiPickClick(e){
  const b = e.target.closest('[data-emoji]');
  if(!b) return;
  editingTopicEmoji = b.dataset.emoji;
  renderEmojiPicker();
}

async function saveTopic(){
  const title = $('shopTopicTitle').value.trim();
  if(!title){ toast('warn', 'Skriv ett namn'); return; }
  const owner_id = $('shopTopicOwner').value || null;   // null = shared/family
  const row = { title, emoji: editingTopicEmoji, owner_id, created_by: me.id };
  // A new list goes last in the chosen order (only once the sort column exists).
  const topics = state.shopTopics || [];
  if(topics.some(t => 'sort' in t)) row.sort = topics.reduce((m, t) => Math.max(m, t.sort ?? -1), -1) + 1;
  try{
    const { data, error } = await sb.from('shopping_topics')
      .insert(row)
      .select('id').single();
    if(error) throw error;
    // let the assigned person know they have a new list to fill in (shared lists don't notify)
    if(data && owner_id) notify('shopping_topic', { topicId: data.id });
    toast('ok', 'Kategori tillagd');
    await loadShopTopics();
    if(data) shopOpenTopic = data.id;   // straight into the new list, ready to fill
    renderShopping();
  }catch(err){ console.warn('saveTopic', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteTopic(id){
  if(demoBlock()) return;
  const t = (state.shopTopics || []).find(x => x.id === id);
  if(!t) return;
  const n = itemsForTopic(id).length;
  const msg = n
    ? `Ta bort "${t.title}" och ${n} ${n === 1 ? 'sak' : 'saker'}?`
    : `Ta bort "${t.title}"?`;
  if(!(await confirmDialog(msg))) return;
  try{
    const { error } = await sb.from('shopping_topics').delete().eq('id', id);   // items cascade
    if(error) throw error;
    toast('ok', 'Borttagen');
    shopOpenTopic = null;
    await Promise.all([loadShopTopics(), loadShopItems()]);
    renderShopping();
  }catch(err){ console.warn('deleteTopic', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- items ----
async function toggleShopItem(id){
  if(demoBlock()) return;
  const it = (state.shopItems || []).find(x => x.id === id);
  if(!it) return;
  const bought = !it.bought;
  try{
    const { error } = await sb.from('shopping_items')
      .update({ bought, bought_at: bought ? new Date().toISOString() : null, bought_by: bought ? me.id : null })
      .eq('id', id);
    if(error) throw error;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('toggleShopItem', err); toast('warn', 'Kunde inte uppdatera'); }
}

async function deleteShopItem(id){
  if(demoBlock()) return;
  const it = (state.shopItems || []).find(x => x.id === id);
  if(!it) return;
  try{
    const { error } = await sb.from('shopping_items').delete().eq('id', id);
    if(error) throw error;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('deleteShopItem', err); toast('warn', 'Kunde inte ta bort'); }
}

// Parents: clear a category's bought items in one go.
async function clearBought(topicId){
  if(demoBlock()) return;
  const ids = itemsForTopic(topicId).filter(i => i.bought).map(i => i.id);
  if(!ids.length) return;
  if(!(await confirmDialog(`Ta bort ${ids.length} ${ids.length === 1 ? 'köpt sak' : 'köpta saker'}?`, 'Rensa', 'Rensa köpta'))) return;
  try{
    const { error } = await sb.from('shopping_items').delete().in('id', ids);
    if(error) throw error;
    shopShowBought[topicId] = false;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('clearBought', err); toast('warn', 'Kunde inte ta bort'); }
}
