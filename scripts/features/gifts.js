'use strict';
// Julklappar: a gift list only the parents can see, kept out of sight because the kids sometimes
// scroll through the app on a parent's phone. There's no menu entry: a parent holds "Inköp" for
// 4 seconds and enters a code (chosen in the app the first time; only its hash is stored, in the
// parents-only gift_settings row). Inside: this Christmas's presents per kid, each kid folded
// into one row with the count and total, a price and a Köpt tick per present. A parent can tap
// a wish in the Inköp list named "Önskelista till jul…" to save a copy here (openKeepDialog);
// the wish is left untouched, so the kids see no sign of it. No other list offers this. The list locks again as soon as you leave it or the app goes to
// the background. RLS keeps the tables parents-only regardless of the code.

const GIFT_HOLD_MS = 4000;
let giftsUnlocked = false;
let giftCodeHash = null;
let giftsOpenKid = null;               // the kid whose page is open (null = the overview)
const giftsShowBought = {};            // kid id → bought presents unfolded
let editingGift = null;                // { mode: 'keep' | 'edit', id?, fromWish? } while the dialog is open
let pinBuffer = '', pinMode = 'enter', pinFirst = '';

const giftYear = () => new Date().getFullYear();
const giftKids = () => (state.profiles || []).filter(p => p.role === 'kid')
  .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
const giftSum = list => list.reduce((s, g) => s + (g.price || 0), 0);

// ---- the way in: hold "Inköp" for 4 seconds (parents only) ----
function initGiftHold(){
  const btn = document.querySelector('#todoSeg [data-todotab="shopping"]');
  if(!btn) return;
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; btn.classList.remove('is-holding'); };
  btn.addEventListener('pointerdown', () => {
    if(!isParent()) return;
    stop();
    btn.classList.add('is-holding');
    timer = setTimeout(() => { stop(); openGiftLock(); }, GIFT_HOLD_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('contextmenu', e => e.preventDefault());   // no long-press menu on phones
}

async function hashGiftCode(code){
  const bytes = new TextEncoder().encode('slayqueens-gifts:' + code);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function openGiftLock(){
  if(!isParent()) return;
  if(!(window.crypto && crypto.subtle)){ toast('warn', 'Kräver en säker anslutning (https)'); return; }
  if(isDemo()){
    giftCodeHash = await hashGiftCode('1234');
  } else {
    const { data, error } = await sb.from('gift_settings').select('code_hash').eq('id', true).maybeSingle();
    if(error){ console.warn('openGiftLock', error); toast('warn', 'Kunde inte öppna'); return; }
    giftCodeHash = (data && data.code_hash) || null;
  }
  pinMode = giftCodeHash ? 'enter' : 'new';
  pinBuffer = ''; pinFirst = '';
  paintPin();
  $('pinDialog').showModal();
}

function paintPin(){
  $('pinTitle').textContent = pinMode === 'enter' ? 'Ange kod' : pinMode === 'new' ? 'Välj en kod' : 'Upprepa koden';
  $('pinSub').textContent = pinMode === 'enter'
    ? (isDemo() ? 'Demo: koden är 1234' : '')
    : 'Fyra siffror som bara ni två vet';
  $('pinDots').querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i < pinBuffer.length));
  $('pinDots').setAttribute('aria-label', `${pinBuffer.length} av 4 siffror`);
}

function wrongPin(){
  const dots = $('pinDots');
  dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
  setTimeout(() => { pinBuffer = ''; paintPin(); }, 420);
}

async function pressPin(key){
  if(key === 'cancel'){ $('pinDialog').close(); return; }
  if(key === 'back'){ pinBuffer = pinBuffer.slice(0, -1); paintPin(); return; }
  if(!/^[0-9]$/.test(key) || pinBuffer.length >= 4) return;
  pinBuffer += key;
  paintPin();
  if(pinBuffer.length < 4) return;
  const code = pinBuffer;
  if(pinMode === 'enter'){
    if(await hashGiftCode(code) === giftCodeHash){ $('pinDialog').close(); openGifts(); }
    else wrongPin();
  } else if(pinMode === 'new'){
    pinFirst = code; pinMode = 'repeat'; pinBuffer = '';
    setTimeout(paintPin, 150);
  } else {
    if(code !== pinFirst){ pinMode = 'new'; pinFirst = ''; paintPin(); wrongPin(); return; }
    const hash = await hashGiftCode(code);
    if(!isDemo()){
      const { error } = await sb.from('gift_settings').upsert({ id: true, code_hash: hash, updated_at: new Date().toISOString() });
      if(error){ console.warn('save gift code', error); toast('warn', 'Kunde inte spara koden'); return; }
    }
    giftCodeHash = hash;
    $('pinDialog').close();
    openGifts();
  }
}
function onPinPadClick(e){
  const b = e.target.closest('[data-pin]');
  if(b) pressPin(b.dataset.pin);
}
function onPinKey(e){
  if(/^[0-9]$/.test(e.key)){ e.preventDefault(); pressPin(e.key); }
  else if(e.key === 'Backspace'){ e.preventDefault(); pressPin('back'); }
}

// ---- open / lock ----
async function openGifts(){
  giftsUnlocked = true;
  giftsOpenKid = null;
  await loadGifts();      // in the demo the stand-in client fails this, so the fixtures stay
  switchView('gifts');
  renderGifts();
}
// Forget everything the moment the list is left (or the app is hidden).
function lockGifts(){
  giftsUnlocked = false;
  if(!isDemo()) state.gifts = [];
  giftsOpenKid = null;
  const box = $('giftsBody');
  if(box) box.innerHTML = '';
}

// ---- the list: same two levels as Inköp — one row per kid, then that kid's page ----
function giftsForKid(id){
  return (state.gifts || []).filter(g => g.year === giftYear() && g.recipient_id === id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function renderGifts(){
  const box = $('giftsBody');
  if(!box || !giftsUnlocked || currentView !== 'gifts') return;
  const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.giftqa
    ? { id: document.activeElement.id, value: document.activeElement.value } : null;
  const kid = giftsOpenKid && giftKids().find(k => k.id === giftsOpenKid);
  box.innerHTML = kid ? giftKidPage(kid) : giftOverview();
  if(typing){ const el = $(typing.id); if(el){ el.value = typing.value; el.focus(); } }
}

function giftOverview(){
  const all = (state.gifts || []).filter(g => g.year === giftYear());
  const rows = giftKids().map(k => {
    const mine = giftsForKid(k.id);
    const total = giftSum(mine);
    const left = mine.filter(g => !g.bought).length;
    const meta = !mine.length ? 'Inget än'
      : `${total ? fmtMoney(total) : ''}${total && left ? ' · ' : ''}${left ? `${left} kvar att köpa` : (total ? '' : 'Allt köpt')}`;
    return `
      <button class="shop-row" type="button" data-gift="kid" data-kid="${k.id}">
        <span class="gf-av">${avatarHtml(profileColor(k), k.name)}</span>
        <span class="shop-row-text"><span class="shop-row-title">${escapeHtml(capital(k.name))}</span></span>
        <span class="shop-count${mine.length && !left ? ' is-clear' : ''}">${escapeHtml(meta)}</span>
        <span class="shop-caret" aria-hidden="true">›</span>
      </button>`;
  }).join('');
  return `
    <div class="shop-page-head">
      <button class="shop-back" type="button" data-gift="back">‹ Inköp</button>
      <h2 class="shop-page-title serif"><span aria-hidden="true">🎁</span>Julklappar ${giftYear()}</h2>
      <p class="shop-page-sub">🔒 Bara för er föräldrar · låses när ni lämnar sidan</p>
    </div>
    <div class="gf-total">
      <span>Totalt <b>${fmtMoney(giftSum(all))}</b></span>
      <span>köpt ${fmtMoney(giftSum(all.filter(g => g.bought)))}</span>
    </div>
    ${rows ? `<div class="shop-acc">${rows}</div>` : '<p class="shop-empty">Inga barn i familjen än.</p>'}
    <p class="gf-tip">Tips: tryck på en önskan i Önskelista till jul (Inköp) och välj 🔒 Spara undan. Det syns inte för barnen.</p>`;
}

function giftKidPage(k){
  const mine = giftsForKid(k.id);
  const open = mine.filter(g => !g.bought), bought = mine.filter(g => g.bought);
  const showBought = !!giftsShowBought[k.id];
  const name = capital(k.name);
  const total = giftSum(mine), paid = giftSum(bought);
  const sub = mine.length
    ? `${mine.length} st · ${fmtMoney(total)}${paid ? ` · köpt ${fmtMoney(paid)}` : ''}`
    : 'Inget planerat än';
  return `
    <div class="shop-page-head">
      <button class="shop-back" type="button" data-gift="overview">‹ Julklappar</button>
      <h2 class="shop-page-title serif"><span class="gf-av lg">${avatarHtml(profileColor(k), k.name)}</span>${escapeHtml(name)}</h2>
      <p class="shop-page-sub">${escapeHtml(sub)}</p>
    </div>
    <div class="shop-list">
      ${open.length ? open.map(giftRow).join('') : `<p class="shop-empty">${mine.length ? 'Allt är köpt 🎉' : 'Skriv en julklapp nedan, gärna med pris.'}</p>`}
      ${showBought ? bought.map(giftRow).join('') : ''}
    </div>
    ${bought.length ? `<div class="shop-meta">
      <button class="shop-meta-btn" type="button" data-gift="bought" data-kid="${k.id}" aria-expanded="${showBought}">${showBought ? 'Dölj köpta' : `${bought.length} köpta`}</button>
    </div>` : ''}
    <div class="shop-addbar">
      <label class="sr-only" for="giftQa-${k.id}">Ny julklapp till ${escapeHtml(name)}</label>
      <input class="shop-qa" id="giftQa-${k.id}" data-giftqa="${k.id}" type="text" maxlength="80"
        autocomplete="off" enterkeyhint="done" placeholder="Lägg till… (t.ex. Lego 449)">
      <button class="shop-addbtn" type="button" data-gift="add" data-kid="${k.id}" aria-label="Lägg till">＋</button>
    </div>`;
}

function giftRow(g){
  return `<div class="shop-item${g.bought ? ' bought' : ''}">
      <button class="shop-check" type="button" data-gift="tick" data-id="${g.id}" role="checkbox" aria-checked="${g.bought}" aria-label="Köpt: ${escapeHtml(g.title)}">${g.bought ? '✓' : ''}</button>
      <button class="shop-item-title" type="button" data-gift="item" data-id="${g.id}">${escapeHtml(g.title)}${g.from_wish ? '<span class="gf-wish">önskad</span>' : ''}</button>
      <span class="gf-price">${g.price != null ? fmtMoney(g.price) : ''}</span>
    </div>`;
}

// Tap a present: Köpt, Ändra (title / kid / price), Ta bort.
function openGiftSheet(id){
  const g = (state.gifts || []).find(x => x.id === id);
  const k = g && state.profilesById[g.recipient_id];
  if(!g) return;
  openSheet(`
    <div class="sheet-in">
      <span class="sheet-grab" aria-hidden="true"></span>
      <p class="sheet-who">🎁 ${k ? `${avatarHtml(profileColor(k), k.name)}${escapeHtml(capital(k.name))}` : ''}</p>
      <h3 class="sheet-title">${escapeHtml(g.title)}</h3>
      <p class="sheet-when">${g.price != null ? fmtMoney(g.price) : 'Inget pris'}${g.from_wish ? ' · från önskelistan' : ''}${g.bought ? ' · köpt' : ''}</p>
      <div class="sheet-actions">
        <button class="sheet-btn" type="button" data-sh="tick">${g.bought ? '↺ Inte köpt ändå' : '✓ Markera som köpt'}</button>
        <button class="sheet-btn" type="button" data-sh="edit">✎ Ändra namn, pris eller barn</button>
        <button class="sheet-btn danger" type="button" data-sh="del">Ta bort</button>
      </div>
    </div>`, (act) => {
    if(act === 'tick') toggleGift(id);
    else if(act === 'edit'){ if(!demoBlock()) openGiftDialog({ mode: 'edit', id: g.id, title: g.title, kidId: g.recipient_id, price: g.price }); }
    else if(act === 'del') deleteGift(id);
  });
}

function onGiftsClick(e){
  const b = e.target.closest('[data-gift]');
  if(!b) return;
  const act = b.dataset.gift;
  if(act === 'back'){ switchView('todos'); setTodoTab('shopping'); }
  else if(act === 'kid'){ giftsOpenKid = b.dataset.kid; renderGifts(); window.scrollTo(0, 0); }
  else if(act === 'overview'){
    const was = giftsOpenKid;
    giftsOpenKid = null;
    renderGifts();
    window.scrollTo(0, 0);
    const row = $('giftsBody').querySelector(`[data-kid="${was}"]`);
    if(row) row.focus({ preventScroll: true });
  }
  else if(act === 'bought'){ giftsShowBought[b.dataset.kid] = !giftsShowBought[b.dataset.kid]; renderGifts(); }
  else if(act === 'tick') toggleGift(b.dataset.id);
  else if(act === 'item') openGiftSheet(b.dataset.id);
  else if(act === 'add'){ const inp = $('giftQa-' + b.dataset.kid); if(inp) submitGiftQa(inp); }
}

// "Lego Duplo 299" → title "Lego Duplo", price 299
function parseGift(raw){
  const m = raw.match(/^(.*?)[\s,]+(\d{1,6})\s*(?:kr|:-)?$/i);
  return m && m[1].trim() ? { title: m[1].trim(), price: Number(m[2]) } : { title: raw, price: null };
}

function onGiftsKey(e){
  if(e.key !== 'Enter') return;
  const inp = e.target.closest('[data-giftqa]');
  if(!inp) return;
  e.preventDefault();
  submitGiftQa(inp);
}
function submitGiftQa(inp){
  if(demoBlock()) return;
  const raw = inp.value.trim();
  if(!raw){ inp.focus(); return; }
  inp.value = '';
  const { title, price } = parseGift(raw);
  addGift({ recipient_id: inp.dataset.giftqa, title, price, from_wish: false }, true, inp, raw);
}

async function addGift(row, refocus, input, raw){
  if(demoBlock()) return false;
  const full = { ...row, year: giftYear(), bought: false, created_by: me.id };
  try{
    const { error } = await sb.from('gifts').insert(full);
    if(error) throw error;
    if(giftsUnlocked) await loadGifts();
  }catch(err){
    console.warn('addGift', err);
    if(input && !input.value && raw) input.value = raw;   // give the text back so it can be retried
    toast('warn', 'Kunde inte spara');
    return false;
  }
  renderGifts();
  if(refocus){ const again = $('giftQa-' + row.recipient_id); if(again) again.focus(); }
  return true;
}

async function toggleGift(id){
  if(demoBlock()) return;
  const g = (state.gifts || []).find(x => x.id === id);
  if(!g) return;
  g.bought = !g.bought;
  renderGifts();
  try{
    const { error } = await sb.from('gifts').update({ bought: g.bought }).eq('id', id);
    if(error) throw error;
  }catch(err){
    console.warn('toggleGift', err);
    g.bought = !g.bought;
    renderGifts();
    toast('warn', 'Kunde inte spara');
  }
}

// ---- the dialog: save a wish from Inköp ("keep"), or change a present ("edit") ----
// If a wish names exactly one kid ("Magnatiles Pelle"), pick that kid and drop the name.
function guessGiftKid(title){
  const hits = giftKids().filter(k => {
    const name = k.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s,.(–-])${name}(?=$|[\\s,.)–-])`, 'i').test(title);
  });
  if(hits.length !== 1) return { title, kidId: null };
  const name = hits[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clean = title.replace(new RegExp(`(^|[\\s,.(–-])${name}(?=$|[\\s,.)–-])`, 'i'), '$1')
    .replace(/[\s,–-]+$/, '').replace(/^[\s,–-]+/, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return { title: clean || title, kidId: hits[0].id };
}

// The one Inköp list presents can be saved from: the kids' wish list, matched by how its name
// starts, whatever comes after ("Önskelista till jul 🎅", "Önskelista till jul 2026"…).
const WISH_LIST_PREFIX = 'önskelista till jul';
function isWishList(topic){
  return !!topic && String(topic.title || '').normalize('NFC').trim().toLowerCase().startsWith(WISH_LIST_PREFIX);
}

function openKeepDialog(itemId){
  if(demoBlock()) return;
  const it = (state.shopItems || []).find(x => x.id === itemId);
  if(!it || !isParent()) return;
  if(!isWishList((state.shopTopics || []).find(t => t.id === it.topic_id))) return;   // only from the wish list
  const guess = guessGiftKid(it.title);
  openGiftDialog({ mode: 'keep', title: guess.title, kidId: guess.kidId, price: null });
}

function openGiftDialog(opts){
  editingGift = { mode: opts.mode, id: opts.id || null };
  $('giftDlgTitle').textContent = opts.mode === 'keep' ? '🔒 Spara undan' : 'Ändra';
  $('giftDlgNote').hidden = opts.mode !== 'keep';
  $('giftTitle').value = opts.title || '';
  $('giftPrice').value = opts.price != null ? opts.price : '';
  $('giftErr').hidden = true;
  $('giftDelete').hidden = opts.mode !== 'edit';
  $('giftKidPicks').innerHTML = giftKids().map(k =>
    `<button class="hw-pick with-av${k.id === opts.kidId ? ' on' : ''}" type="button" data-kid="${k.id}" aria-pressed="${k.id === opts.kidId}">` +
    `${avatarHtml(profileColor(k), k.name)}${escapeHtml(capital(k.name))}</button>`).join('');
  $('giftDialog').showModal();
}
function onGiftKidPick(e){
  const b = e.target.closest('[data-kid]');
  if(!b) return;
  $('giftKidPicks').querySelectorAll('[data-kid]').forEach(x => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', x === b);
  });
  $('giftErr').hidden = true;
}

// Called on submit. Returns false (and keeps the dialog open) when the kid is missing.
function saveGiftDialog(){
  const title = $('giftTitle').value.trim();
  const kidBtn = $('giftKidPicks').querySelector('[data-kid].on');
  if(!title || !kidBtn){ $('giftErr').hidden = false; return false; }
  const raw = $('giftPrice').value.trim();
  const price = raw === '' ? null : Math.max(0, Math.round(Number(raw) || 0));
  const g = editingGift || {};
  if(g.mode === 'edit') updateGift(g.id, { title, price, recipient_id: kidBtn.dataset.kid });
  else addGift({ recipient_id: kidBtn.dataset.kid, title, price, from_wish: true }, false)
    .then(ok => { if(ok) toast('ok', 'Sparad'); });   // a neutral word, in case someone's watching
  return true;
}

async function updateGift(id, fields){
  const g = (state.gifts || []).find(x => x.id === id);
  if(!g) return;
  const before = { title: g.title, price: g.price, recipient_id: g.recipient_id };
  Object.assign(g, fields);
  renderGifts();
  try{
    const { error } = await sb.from('gifts').update(fields).eq('id', id);
    if(error) throw error;
  }catch(err){
    console.warn('updateGift', err);
    Object.assign(g, before);
    renderGifts();
    toast('warn', 'Kunde inte spara');
  }
}

async function deleteGift(id){
  if(demoBlock()) return;
  const g = (state.gifts || []).find(x => x.id === id);
  if(!g) return;
  if(!(await confirmDialog(`Ta bort "${g.title}"?`))) return;
  state.gifts = state.gifts.filter(x => x.id !== g.id);
  renderGifts();
  try{
    const { error } = await sb.from('gifts').delete().eq('id', g.id);
    if(error) throw error;
  }catch(err){
    console.warn('deleteGift', err);
    toast('warn', 'Kunde inte ta bort');
    await loadGifts();
    renderGifts();
  }
}
// The dialog's own "Ta bort" (edit mode).
function deleteGiftFromDialog(){
  const id = editingGift && editingGift.id;
  $('giftDialog').close();
  if(id) deleteGift(id);
}
