'use strict';
// Shopping board ("Inköp"): categories a parent creates and assigns, each holding what's
// missing. Parents make categories and assign each to a person (or leave it shared); a kid
// sees only their own + shared categories and adds what they need there. Ownership lives on
// the category, so item visibility is inherited (enforced by RLS). Items tick off when bought.
//
// Laid out as an accordion: one compact row per category (icon, name, who it's for, how many
// are left) and only one open at a time. An open list has a type-and-Enter field, bought items
// fold away under "Köpta (n)", and ✕ only appears in "Redigera". A parent can tap an item to
// save a copy in the locked gift list (gifts.js); the item itself is left untouched.

// A small palette of category icons parents can pick from (first one is the default).
const SHOP_EMOJI = ['🛒','👕','🎒','🧴','🍎','🧻','💊','🎮','🏠','✏️','⚽','🐶','🎄'];

let editingTopicEmoji = '🛒';      // emoji chosen in the category dialog
let shopOpenTopic = null;          // the one open category (remembered per device)
try{ shopOpenTopic = localStorage.getItem('slayqueens_shopopen'); }catch(e){}
let shopEditing = false;           // "Redigera": ✕ on items, and "Ta bort listan" for parents
const shopShowBought = {};         // category id → bought items unfolded

function itemsForTopic(id){ return (state.shopItems || []).filter(i => i.topic_id === id); }

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

  // Keep a half-typed item (and the cursor) when a live update repaints the board.
  const active = document.activeElement;
  const typing = active && active.dataset && active.dataset.shopqa ? { id: active.id, value: active.value } : null;
  box.innerHTML = `<div class="shop-acc">${topics.map(topicRow).join('')}</div>`;
  if(typing){ const el = $(typing.id); if(el){ el.value = typing.value; el.focus(); } }
}

function topicRow(t){
  const items = itemsForTopic(t.id);
  const left = items.filter(i => !i.bought).length;
  const isOpen = shopOpenTopic === t.id;
  // parents see whose category it is (to manage assignments); a kid only ever sees their own +
  // shared categories, so a self-label would just be noise — show the chip to parents only.
  const owner = (t.owner_id && isParent()) ? state.profilesById[t.owner_id] : null;
  const count = left
    ? `<span class="shop-count">${left}</span>`
    : (items.length ? '<span class="shop-count is-clear" aria-label="allt köpt">✓</span>' : '');
  return `
    <button class="shop-row" type="button" data-shop="open" data-topic="${t.id}" aria-expanded="${isOpen}">
      <span class="shop-emoji" aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>
      <span class="shop-row-title">${escapeHtml(t.title)}</span>
      ${owner ? `<span class="shop-owner">${avatarHtml(profileColor(owner), owner.name)}${escapeHtml(capital(owner.name))}</span>` : ''}
      ${count}
      <span class="shop-caret" aria-hidden="true">›</span>
    </button>
    ${isOpen ? topicBody(t, items) : ''}`;
}

function topicBody(t, items){
  const parent = isParent();
  // still-needed first (oldest first), then bought (most recently bought first)
  const open   = items.filter(i => !i.bought).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const bought = items.filter(i =>  i.bought).sort((a, b) => new Date(b.bought_at || b.created_at) - new Date(a.bought_at || a.created_at));
  const showBought = !!shopShowBought[t.id];
  return `
    <div class="shop-body">
      <div class="shop-tools">
        <button class="shop-edit" type="button" data-shop="edit" aria-pressed="${shopEditing}">${shopEditing ? 'Klar' : 'Redigera'}</button>
        ${chatButton('shopping', t.id)}
      </div>
      <label class="sr-only" for="shopQa-${t.id}">Lägg till i ${escapeHtml(t.title)}</label>
      <input class="shop-qa" id="shopQa-${t.id}" data-shopqa="${t.id}" type="text" maxlength="80"
        autocomplete="off" enterkeyhint="done" placeholder="${t.owner_id ? 'Lägg till det du saknar…' : 'Lägg till…'}">
      ${open.length ? `<div class="shop-items">${open.map(itemRow).join('')}</div>` : '<p class="shop-empty">Inget som saknas just nu.</p>'}
      ${bought.length ? `
        <div class="shop-bought">
          <button class="shop-bought-toggle" type="button" data-shop="bought" data-topic="${t.id}" aria-expanded="${showBought}">${showBought ? '▾' : '▸'} Köpta (${bought.length})</button>
          ${showBought && parent ? `<button class="shop-clear" type="button" data-shop="clear" data-topic="${t.id}">Rensa</button>` : ''}
        </div>
        ${showBought ? `<div class="shop-items">${bought.map(itemRow).join('')}</div>` : ''}` : ''}
      ${shopEditing && parent ? `<button class="shop-deltopic" type="button" data-shop="deltopic" data-topic="${t.id}">🗑 Ta bort listan</button>` : ''}
    </div>`;
}

function itemRow(i){
  // items inherit their owner from the category, so a row is just the need itself
  const canDelete = i.created_by === me.id || isParent();
  // A parent can tap an item to save a copy in the locked gift list; nothing on the item changes.
  const title = isParent()
    ? `<button class="shop-item-title" type="button" data-shop="keep" data-item="${i.id}">${escapeHtml(i.title)}</button>`
    : `<span class="shop-item-title">${escapeHtml(i.title)}</span>`;
  return `<div class="shop-item${i.bought ? ' bought' : ''}">
      <button class="shop-check" data-shop="toggle" data-item="${i.id}" type="button" role="checkbox" aria-checked="${i.bought}" aria-label="Markera köpt: ${escapeHtml(i.title)}">${i.bought ? '✓' : ''}</button>
      ${title}
      ${shopEditing && canDelete ? `<button class="shop-del" data-shop="delitem" data-item="${i.id}" type="button" aria-label="Ta bort ${escapeHtml(i.title)}">✕</button>` : ''}
    </div>`;
}

function onShoppingClick(e){
  const b = e.target.closest('[data-shop]');
  if(!b) return;
  const act = b.dataset.shop, topic = b.dataset.topic, item = b.dataset.item;
  if(act === 'open'){
    shopOpenTopic = shopOpenTopic === topic ? null : topic;
    shopEditing = false;
    try{ localStorage.setItem('slayqueens_shopopen', shopOpenTopic || ''); }catch(err){}
    renderShopping();
  }
  else if(act === 'edit'){ shopEditing = !shopEditing; renderShopping(); }
  else if(act === 'bought'){ shopShowBought[topic] = !shopShowBought[topic]; renderShopping(); }
  else if(act === 'clear')    clearBought(topic);
  else if(act === 'deltopic') deleteTopic(topic);
  else if(act === 'toggle')   toggleShopItem(item);
  else if(act === 'delitem')  deleteShopItem(item);
  else if(act === 'keep' && typeof openKeepDialog === 'function') openKeepDialog(item);
}

// Type an item and press Enter to add it to the open category.
function onShoppingKey(e){
  if(e.key !== 'Enter') return;
  const inp = e.target.closest('[data-shopqa]');
  if(!inp) return;
  e.preventDefault();
  const title = inp.value.trim();
  if(!title) return;
  inp.value = '';
  addShopItem(inp.dataset.shopqa, title, inp);
}

async function addShopItem(topicId, title, input){
  if(isDemo()){
    // Demo: keep it on this device only, like the budget does; nothing is saved.
    state.shopItems.push({ id: 'demo-' + Date.now(), topic_id: topicId, title, bought: false,
      created_by: me.id, created_at: new Date().toISOString() });
    renderShopping();
    const again = $('shopQa-' + topicId);
    if(again) again.focus();
    return;
  }
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
  try{
    const { data, error } = await sb.from('shopping_topics')
      .insert({ title, emoji: editingTopicEmoji, owner_id, created_by: me.id })
      .select('id').single();
    if(error) throw error;
    // let the assigned person know they have a new list to fill in (shared lists don't notify)
    if(data && owner_id) notify('shopping_topic', { topicId: data.id });
    toast('ok', 'Kategori tillagd');
    if(data){ shopOpenTopic = data.id; try{ localStorage.setItem('slayqueens_shopopen', data.id); }catch(err){} }
    await loadShopTopics();
    renderShopping();
  }catch(err){ console.warn('saveTopic', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteTopic(id){
  const t = (state.shopTopics || []).find(x => x.id === id);
  if(!t) return;
  const n = itemsForTopic(id).length;
  const msg = n
    ? `Ta bort "${t.title}" och ${n} ${n === 1 ? 'sak' : 'saker'}?`
    : `Ta bort "${t.title}"?`;
  if(!(await confirmDialog(msg))) return;
  if(isDemo()){
    state.shopTopics = state.shopTopics.filter(x => x.id !== id);
    state.shopItems = state.shopItems.filter(i => i.topic_id !== id);
    shopEditing = false;
    renderShopping();
    return;
  }
  try{
    const { error } = await sb.from('shopping_topics').delete().eq('id', id);   // items cascade
    if(error) throw error;
    toast('ok', 'Borttagen');
    shopEditing = false;
    await Promise.all([loadShopTopics(), loadShopItems()]);
    renderShopping();
  }catch(err){ console.warn('deleteTopic', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- items ----
async function toggleShopItem(id){
  const it = (state.shopItems || []).find(x => x.id === id);
  if(!it) return;
  const bought = !it.bought;
  if(isDemo()){
    Object.assign(it, { bought, bought_at: bought ? new Date().toISOString() : null, bought_by: bought ? me.id : null });
    renderShopping();
    return;
  }
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
  const it = (state.shopItems || []).find(x => x.id === id);
  if(!it) return;
  if(isDemo()){ state.shopItems = state.shopItems.filter(x => x.id !== id); renderShopping(); return; }
  try{
    const { error } = await sb.from('shopping_items').delete().eq('id', id);
    if(error) throw error;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('deleteShopItem', err); toast('warn', 'Kunde inte ta bort'); }
}

// Parents: clear a category's bought items in one go.
async function clearBought(topicId){
  const ids = itemsForTopic(topicId).filter(i => i.bought).map(i => i.id);
  if(!ids.length) return;
  if(!(await confirmDialog(`Ta bort ${ids.length} ${ids.length === 1 ? 'köpt sak' : 'köpta saker'}?`, 'Rensa', 'Rensa köpta'))) return;
  if(isDemo()){
    state.shopItems = state.shopItems.filter(i => !ids.includes(i.id));
    shopShowBought[topicId] = false;
    renderShopping();
    return;
  }
  try{
    const { error } = await sb.from('shopping_items').delete().in('id', ids);
    if(error) throw error;
    shopShowBought[topicId] = false;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('clearBought', err); toast('warn', 'Kunde inte ta bort'); }
}
