'use strict';
// Julklappar: a gift list only the parents can see, kept out of sight because the kids sometimes
// scroll through the app on a parent's phone. There's no menu entry: a parent holds "Inköp" for
// 4 seconds and enters a code (chosen in the app the first time; only its hash is stored, in the
// parents-only gift_settings row). Inside: this Christmas's presents per kid, each kid folded
// into one row with the count and total, a price and a Köpt tick per present. A parent can tap
// an item in Inköp to save a copy here (openKeepDialog); the item in Inköp is left untouched, so
// the kids see no sign of it. The list locks again as soon as you leave it or the app goes to
// the background. RLS keeps the tables parents-only regardless of the code.

const GIFT_HOLD_MS = 4000;
let giftsUnlocked = false;
let giftCodeHash = null;
const giftsOpenKids = new Set();       // kid sections unfolded in the gift list
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
  if(!isDemo()) await loadGifts();
  switchView('gifts');
  renderGifts();
}
// Forget everything the moment the list is left (or the app is hidden).
function lockGifts(){
  giftsUnlocked = false;
  state.gifts = isDemo() ? state.gifts : [];
  giftsOpenKids.clear();
  const box = $('giftsBody');
  if(box) box.innerHTML = '';
}

// ---- the list ----
function renderGifts(){
  const box = $('giftsBody');
  if(!box || !giftsUnlocked || currentView !== 'gifts') return;
  const all = (state.gifts || []).filter(g => g.year === giftYear());
  const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.giftqa
    ? { id: document.activeElement.id, value: document.activeElement.value } : null;

  const kidsHtml = giftKids().map(k => {
    const mine = all.filter(g => g.recipient_id === k.id)
      .sort((a, b) => (a.bought - b.bought) || String(a.created_at).localeCompare(String(b.created_at)));
    const open = giftsOpenKids.has(k.id);
    const total = giftSum(mine);
    const meta = mine.length ? `${mine.length} st · ${total ? fmtMoney(total) : '–'}` : 'Inget än';
    return `
      <div class="gf-kid${open ? ' is-open' : ''}">
        <button class="gf-kid-row" type="button" data-gift="kid" data-kid="${k.id}" aria-expanded="${open}">
          ${avatarHtml(profileColor(k), k.name)}
          <span class="gf-kid-name">${escapeHtml(capital(k.name))}</span>
          <span class="gf-kid-meta">${escapeHtml(meta)}</span>
          <span class="gf-caret" aria-hidden="true">›</span>
        </button>
        ${open ? `
          <div class="gf-kid-body">
            ${mine.map(giftRow).join('')}
            <label class="sr-only" for="giftQa-${k.id}">Ny julklapp till ${escapeHtml(capital(k.name))}</label>
            <input class="gf-qa" id="giftQa-${k.id}" data-giftqa="${k.id}" type="text" maxlength="80"
              autocomplete="off" enterkeyhint="done" placeholder="Lägg till… (t.ex. Lego 449)">
          </div>` : ''}
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="gifts">
      <div class="gf-head">
        <button class="gf-back" type="button" data-gift="back">‹ Inköp</button>
        <h2 class="gf-title serif">Julklappar ${giftYear()}</h2>
        <p class="gf-sub">🔒 Bara för er föräldrar. Låses när ni lämnar sidan.</p>
      </div>
      <div class="gf-total">
        <span>Totalt <b>${fmtMoney(giftSum(all))}</b></span>
        <span>köpt ${fmtMoney(giftSum(all.filter(g => g.bought)))}</span>
      </div>
      <div class="gf-kids">${kidsHtml || '<p class="gf-empty">Inga barn i familjen än.</p>'}</div>
      <p class="gf-tip">Tips: tryck på något i Inköp för att spara undan det hit. Det syns inte för barnen.</p>
    </div>`;
  if(typing){ const el = $(typing.id); if(el){ el.value = typing.value; el.focus(); } }
}

function giftRow(g){
  return `
    <div class="gf-row${g.bought ? ' is-bought' : ''}">
      <button class="gf-check" type="button" data-gift="tick" data-id="${g.id}" role="checkbox" aria-checked="${g.bought}" aria-label="Köpt: ${escapeHtml(g.title)}">${g.bought ? '✓' : ''}</button>
      <button class="gf-name" type="button" data-gift="edit" data-id="${g.id}">${escapeHtml(g.title)}${g.from_wish ? '<span class="gf-wish">önskad</span>' : ''}</button>
      <span class="gf-price">${g.price != null ? fmtMoney(g.price) : '–'}</span>
    </div>`;
}

function onGiftsClick(e){
  const b = e.target.closest('[data-gift]');
  if(!b) return;
  const act = b.dataset.gift;
  if(act === 'back'){ switchView('todos'); setTodoTab('shopping'); }
  else if(act === 'kid'){
    const id = b.dataset.kid;
    if(giftsOpenKids.has(id)) giftsOpenKids.delete(id); else giftsOpenKids.add(id);
    renderGifts();
  }
  else if(act === 'tick') toggleGift(b.dataset.id);
  else if(act === 'edit'){
    const g = (state.gifts || []).find(x => x.id === b.dataset.id);
    if(g) openGiftDialog({ mode: 'edit', id: g.id, title: g.title, kidId: g.recipient_id, price: g.price });
  }
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
  const raw = inp.value.trim();
  if(!raw) return;
  inp.value = '';
  const { title, price } = parseGift(raw);
  addGift({ recipient_id: inp.dataset.giftqa, title, price, from_wish: false }, true);
}

async function addGift(row, refocus){
  const full = { ...row, year: giftYear(), bought: false, created_by: me.id };
  if(isDemo()){
    state.gifts.push({ ...full, id: 'demo-' + Date.now() + Math.random(), created_at: new Date().toISOString() });
  } else {
    try{
      const { error } = await sb.from('gifts').insert(full);
      if(error) throw error;
      if(giftsUnlocked) await loadGifts();
    }catch(err){ console.warn('addGift', err); toast('warn', 'Kunde inte spara'); return false; }
  }
  renderGifts();
  if(refocus){ const again = $('giftQa-' + row.recipient_id); if(again) again.focus(); }
  return true;
}

async function toggleGift(id){
  const g = (state.gifts || []).find(x => x.id === id);
  if(!g) return;
  g.bought = !g.bought;
  renderGifts();
  if(isDemo()) return;
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

function openKeepDialog(itemId){
  const it = (state.shopItems || []).find(x => x.id === itemId);
  if(!it || !isParent()) return;
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
  if(isDemo()) return;
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

async function deleteGiftFromDialog(){
  const g = editingGift && (state.gifts || []).find(x => x.id === editingGift.id);
  $('giftDialog').close();
  if(!g) return;
  if(!(await confirmDialog(`Ta bort "${g.title}"?`))) return;
  state.gifts = state.gifts.filter(x => x.id !== g.id);
  renderGifts();
  if(isDemo()) return;
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
