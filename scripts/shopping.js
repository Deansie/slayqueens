'use strict';
// Shopping board ("Inköp"): categories a parent creates and assigns, each holding what's
// missing. Parents make categories and assign each to a person (or leave it shared); a kid
// sees only their own + shared categories and adds what they need there. Ownership lives on
// the category, so item visibility is inherited (enforced by RLS). Items tick off when bought.

// A small palette of category icons parents can pick from (first one is the default).
const SHOP_EMOJI = ['🛒','👕','🎒','🧴','🍎','🧻','💊','🎮','🏠','✏️','⚽','🐶'];

let editingTopicEmoji = '🛒';   // emoji chosen in the category dialog
let addItemTopicId = null;      // category an item is being added to

function itemsForTopic(id){ return (state.shopItems || []).filter(i => i.topic_id === id); }

function renderShopping(){
  const box = $('shoppingBoard');
  if(!box || !me) return;
  const topics = state.shopTopics || [];
  const parent = isParent();

  if(!topics.length){
    box.innerHTML = `<div class="placeholder mini"><div class="ph-emoji">🛒</div>
        <h3>Inga inköpskategorier</h3>
        <p>${parent
          ? 'Tryck ＋ Ny kategori för att skapa en (t.ex. Kläder) — sen kan alla fylla i vad som saknas.'
          : 'Föräldrarna lägger till kategorier här, sen kan du fylla i vad du behöver.'}</p>
      </div>`;
    return;
  }
  box.innerHTML = topics.map(topicCard).join('');
}

function topicCard(t){
  const parent = isParent();
  const items = itemsForTopic(t.id);
  // still-needed first (oldest first), then bought (most recently bought first, dimmed)
  const open   = items.filter(i => !i.bought).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const bought = items.filter(i =>  i.bought).sort((a, b) => new Date(b.bought_at || b.created_at) - new Date(a.bought_at || a.created_at));
  const rows = open.concat(bought).map(itemRow).join('');
  const owner = t.owner_id ? state.profilesById[t.owner_id] : null;
  // parents see whose category it is (to manage assignments); a kid only ever sees their own +
  // shared categories, so a self-label would just be noise — show the chip to parents only.
  const ownerChip = (owner && isParent())
    ? `<span class="shop-owner">${avatarHtml(profileColor(owner), owner.name)}${escapeHtml(capital(owner.name))}</span>`
    : '';
  return `<section class="shop-topic">
      <header class="shop-topic-head">
        <span class="shop-emoji" aria-hidden="true">${escapeHtml(t.emoji || '🛒')}</span>
        <h3 class="shop-topic-name">${escapeHtml(t.title)}</h3>
        ${ownerChip}
        <div class="shop-topic-tools">
          ${chatButton('shopping', t.id)}
          ${parent ? `<button class="icon-btn" data-shop="deltopic" data-topic="${t.id}" aria-label="Ta bort kategori">🗑</button>` : ''}
        </div>
      </header>
      ${t.owner_id ? '<p class="shop-hint">Lägg till det du saknar.</p>' : ''}
      <div class="shop-items">${rows}</div>
      <button class="shop-add" data-shop="additem" data-topic="${t.id}" type="button"><span aria-hidden="true">＋</span> Lägg till</button>
    </section>`;
}

function itemRow(i){
  // items inherit their owner from the category, so a row is just the need itself
  const canDelete = i.created_by === me.id || isParent();
  return `<div class="shop-item${i.bought ? ' bought' : ''}">
      <button class="shop-check" data-shop="toggle" data-item="${i.id}" type="button" role="checkbox" aria-checked="${i.bought}" aria-label="Markera köpt">${i.bought ? '✓' : ''}</button>
      <span class="shop-item-title">${escapeHtml(i.title)}</span>
      ${canDelete ? `<button class="icon-btn" data-shop="delitem" data-item="${i.id}" aria-label="Ta bort">🗑</button>` : ''}
    </div>`;
}

function onShoppingClick(e){
  const b = e.target.closest('[data-shop]');
  if(!b) return;
  const act = b.dataset.shop, topic = b.dataset.topic, item = b.dataset.item;
  if(act === 'deltopic')         deleteTopic(topic);
  else if(act === 'additem')     openItemDialog(topic);
  else if(act === 'toggle')      toggleShopItem(item);
  else if(act === 'delitem')     deleteShopItem(item);
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
  try{
    const { error } = await sb.from('shopping_topics').delete().eq('id', id);   // items cascade
    if(error) throw error;
    toast('ok', 'Borttagen');
    await Promise.all([loadShopTopics(), loadShopItems()]);
    renderShopping();
  }catch(err){ console.warn('deleteTopic', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- items (anyone) ----
function openItemDialog(topicId){
  addItemTopicId = topicId;
  const t = (state.shopTopics || []).find(x => x.id === topicId);
  $('shopItemDlgTitle').textContent = t ? `${t.emoji || '🛒'} ${capital(t.title)}` : 'Lägg till';
  $('shopItemTitle').value = '';
  $('shopItemDialog').showModal();
}

async function saveItem(){
  const title = $('shopItemTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad som saknas'); return; }
  if(!addItemTopicId) return;
  try{
    const { error } = await sb.from('shopping_items').insert({ topic_id: addItemTopicId, title, created_by: me.id });
    if(error) throw error;
    toast('ok', 'Tillagd');
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('saveItem', err); toast('warn', 'Kunde inte spara'); }
}

async function toggleShopItem(id){
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
  const it = (state.shopItems || []).find(x => x.id === id);
  if(!it) return;
  try{
    const { error } = await sb.from('shopping_items').delete().eq('id', id);
    if(error) throw error;
    await loadShopItems();
    renderShopping();
  }catch(err){ console.warn('deleteShopItem', err); toast('warn', 'Kunde inte ta bort'); }
}

