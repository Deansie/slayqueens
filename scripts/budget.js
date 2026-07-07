'use strict';
// ============================================================================
// Budget (parents only) — ported from the standalone budget app and wired to a
// Supabase-backed store instead of OneDrive. Everything lives in one IIFE so the
// port's globals (state, render, helpers…) can't collide with the rest of the app.
//
// Storage: one shared JSON document in the `budget` table (singleton row), RLS
// restricted to parents. Saves do a read-merge-write keyed on each month's
// updatedAt, so two parents editing different months never clobber each other;
// realtime keeps both devices in sync. Mirrors the old OneDrive merge exactly.
// ============================================================================

// Assigned onto window (not `const Budget = …`): a top-level const in a classic script
// is a global binding but NOT a window property, and the rest of the app feature-checks
// `window.Budget` before using it.
window.Budget = (function(){

  // ---- state ----
  let bs = freshDoc();
  let inited = false;
  let editMode = !matchMedia('(max-width:920px)').matches; // editable on desktop, locked on phones
  let pendingFocus = null;

  function freshDoc(){
    const key = monthKeyOf(new Date());
    return { currentMonth: key, months: { [key]: { income:[], expenses:[] } }, deletedMonths: {} };
  }

  // ---- pure helpers ----
  function monthKeyOf(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
  function monthLabelOf(key){
    const [y,m] = (key||'').split('-');
    if(!y || !m) return key;
    return capital(MONTHS_LONG[Number(m)-1] || m) + ' ' + y;
  }
  function ensureMonth(key){ if(!bs.months[key]) bs.months[key] = { income:[], expenses:[] }; }
  function curMonth(){ ensureMonth(bs.currentMonth); return bs.months[bs.currentMonth]; }
  function isGroup(it){ return it && Array.isArray(it.children); }
  function itemAmount(it){ return isGroup(it) ? it.children.reduce((s,c)=>s+itemAmount(c),0) : (Number(it.amount)||0); }
  function sumArr(arr){ return arr.reduce((s,i)=>s+itemAmount(i),0); }
  function countLeaves(arr){ return arr.reduce((n,it)=> n + (isGroup(it) ? countLeaves(it.children) : 1), 0); }
  function monthBalance(key){ const m = bs.months[key]; return m ? sumArr(m.income)-sumArr(m.expenses) : 0; }
  function isEditingBudget(){ const a = document.activeElement; return !!(a && a.classList && a.classList.contains('inp')); }

  // ---- skeleton ----
  const SKELETON = `
  <div class="budget" id="budgetRoot">
    <nav class="month-nav" aria-label="Välj månad"><div class="month-rail" id="monthRail"></div></nav>
    <div class="page-head">
      <div><h2 class="serif" id="monthTitle">—</h2><div class="sub" id="monthSub"></div></div>
      <button class="btn ghost sm" id="editToggle" type="button">✎ Redigera</button>
    </div>
    <section class="top-cards" aria-label="Summering">
      <div class="card"><h3>Intäkter</h3><div class="value" id="incomeTotal">0 kr</div></div>
      <div class="card"><h3>Utgifter</h3><div class="value" id="expenseTotal">0 kr</div></div>
      <div class="card accent"><span class="pill" id="savingsPill">—</span><h3>Kvar</h3><div class="value" id="balanceTotal">0 kr</div></div>
    </section>
    <section class="flowbar" aria-label="Intäkter mot utgifter">
      <div class="fb-head"><span>Använt av intäkterna: <b id="fbSpent">0 kr</b></span><span id="fbPct">0%</span></div>
      <div class="track"><div class="fill" id="fbFill" style="width:0%"></div></div>
      <div class="fb-foot"><span>Intäkter <b id="fbIncome">0 kr</b></span><span id="fbLeftLabel">Kvar 0 kr</span></div>
    </section>
    <section class="section" aria-labelledby="incomeHeading">
      <div class="section-header"><h2 id="incomeHeading">Intäkter</h2><span class="total" id="incomeHeadTotal">0 kr</span></div>
      <div class="col-head"><span></span><span>Namn</span><span class="ch-amt">Belopp</span><span class="ch-del"></span></div>
      <div class="rows" id="incomeRows"></div>
      <div class="add-row"><button class="btn ghost sm" id="addIncomeBtn" type="button">+ Lägg till intäkt</button><button class="btn ghost sm" id="addIncomeGroupBtn" type="button">+ Lägg till grupp</button></div>
    </section>
    <section class="section" aria-labelledby="expenseHeading">
      <div class="section-header"><h2 id="expenseHeading">Utgifter</h2><span class="total" id="expenseHeadTotal">0 kr</span></div>
      <div class="col-head"><span></span><span>Namn</span><span class="ch-amt">Belopp</span><span class="ch-del"></span></div>
      <div class="rows" id="expenseRows"></div>
      <div class="add-row"><button class="btn ghost sm" id="addExpenseBtn" type="button">+ Lägg till utgift</button><button class="btn ghost sm" id="addExpenseGroupBtn" type="button">+ Lägg till grupp</button></div>
    </section>
  </div>`;

  function init(){
    if(inited) return;
    const body = $('budgetBody');
    if(!body) return;
    body.innerHTML = SKELETON;
    $('addIncomeBtn').addEventListener('click', addIncome);
    $('addExpenseBtn').addEventListener('click', addExpense);
    $('addIncomeGroupBtn').addEventListener('click', () => addGroup('income'));
    $('addExpenseGroupBtn').addEventListener('click', () => addGroup('expense'));
    $('editToggle').addEventListener('click', () => { editMode = !editMode; applyEditMode(); });
    inited = true;
    applyEditMode();
    render();
  }

  // ---- render ----
  function render(){
    if(!inited) return;
    renderMonthRail(); renderHead(); renderRows(); renderTotals();
  }
  function sortedKeys(){ return Object.keys(bs.months).sort(); }

  function renderMonthRail(){
    const rail = $('monthRail'); if(!rail) return;
    rail.innerHTML = '';
    let activeChip = null;
    sortedKeys().forEach(k => {
      const chip = document.createElement('button');
      chip.className = 'mchip' + (k === bs.currentMonth ? ' active' : '');
      chip.type = 'button';
      const bal = monthBalance(k);
      chip.innerHTML = `<span class="mc-name">${escapeHtml(monthLabelOf(k))}</span>` +
        `<span class="mc-bal ${bal<0?'neg':'pos'}">${escapeHtml(fmtMoney(bal))}</span>`;
      chip.addEventListener('click', () => { bs.currentMonth = k; saveDebounced(); render(); });
      if(k === bs.currentMonth){
        const del = document.createElement('span');
        del.className = 'mc-del'; del.title = 'Ta bort månad'; del.textContent = '×';
        del.setAttribute('role','button');
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteMonth(k); });
        chip.appendChild(del);
        activeChip = chip;
      }
      rail.appendChild(chip);
    });
    const add = document.createElement('button');
    add.className = 'mchip add'; add.type = 'button'; add.title = 'Ny månad'; add.textContent = '+';
    add.addEventListener('click', newMonth);
    rail.appendChild(add);

    if(activeChip){
      const railRect = rail.getBoundingClientRect();
      const chipRect = activeChip.getBoundingClientRect();
      rail.scrollLeft += (chipRect.left - railRect.left) - (rail.clientWidth - activeChip.offsetWidth) / 2;
    }
  }

  function renderHead(){
    $('monthTitle').textContent = monthLabelOf(bs.currentMonth);
    const m = curMonth();
    const inc = countLeaves(m.income), exp = countLeaves(m.expenses);
    $('monthSub').textContent = (inc + exp) ? `${inc} intäkter · ${exp} utgifter` : 'Inga poster ännu';
  }

  function renderRows(){
    const m = curMonth();
    const totalExp = sumArr(m.expenses);
    fillSection('incomeRows', m.income, 'income', 0);
    fillSection('expenseRows', m.expenses, 'expense', totalExp);
  }
  function fillSection(containerId, list, type, totalExp){
    const c = $(containerId); c.innerHTML = '';
    if(!list.length){
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = type === 'income' ? 'Inga intäkter ännu.' : 'Inga utgifter ännu.';
      c.appendChild(e); return;
    }
    list.forEach(item => c.appendChild(createRow(type, item, list, totalExp)));
  }

  function setBar(fill, label, val, total){
    const pct = total > 0 ? (val/total*100) : 0;
    fill.style.width = pct.toFixed(1) + '%';
    fill.classList.toggle('big', pct >= 33);
    label.textContent = Math.round(pct) + '%';
  }
  function maybeFocus(item, input){
    if(pendingFocus && item === pendingFocus){ pendingFocus = null; requestAnimationFrame(() => input.focus()); }
  }
  function onEnter(input, fn){ input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); fn(); } }); }
  function addAfter(arr, item){
    const it = { name:'', amount:0 };
    const i = arr.indexOf(item);
    arr.splice(i > -1 ? i+1 : arr.length, 0, it);
    pendingFocus = it; markDirty(); render();
  }

  function createRow(type, item, arr, totalExp, isChild){
    return isGroup(item) ? createGroup(type, item, arr, totalExp) : createLeaf(type, item, arr, totalExp, isChild);
  }

  function createLeaf(type, item, arr, totalExp, isChild){
    const wrap = document.createElement('div'); wrap.className = 'item';
    wrap._item = item; wrap._arr = arr; wrap._type = type;
    const row = document.createElement('div'); row.className = 'row';

    const handle = document.createElement('div');
    handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Dra för att flytta';
    handle.setAttribute('aria-label','Flytta rad');
    attachDrag(handle, wrap);

    const name = document.createElement('input');
    name.className = 'inp name'; name.placeholder = 'Namn'; name.value = item.name || '';
    name.setAttribute('aria-label','Namn');
    name.addEventListener('input', e => { item.name = e.target.value; markDirty(); });
    maybeFocus(item, name);

    const amtWrap = document.createElement('div'); amtWrap.className = 'amt-wrap';
    const amt = document.createElement('input');
    amt.className = 'inp amt'; amt.type = 'number'; amt.placeholder = '0'; amt.inputMode = 'numeric';
    if(isChild){
      amt.classList.add('no-step');
      amt.addEventListener('keydown', ev => { if(ev.key === 'ArrowUp' || ev.key === 'ArrowDown') ev.preventDefault(); });
    } else { amt.step = '100'; }
    amt.value = (item.amount != null && item.amount !== 0) ? item.amount : '';
    amt.setAttribute('aria-label','Belopp');
    amt.addEventListener('input', e => { item.amount = Number(e.target.value) || 0; liveRefresh(); markDirty(); });
    const kr = document.createElement('span'); kr.className = 'kr'; kr.textContent = 'kr';
    amtWrap.appendChild(amt); amtWrap.appendChild(kr);

    const addNext = () => addAfter(arr, item);
    onEnter(name, addNext); onEnter(amt, addNext);

    const del = document.createElement('button');
    del.className = 'row-del'; del.type = 'button'; del.title = 'Ta bort'; del.textContent = '×';
    del.addEventListener('click', () => deleteItem(arr, item));

    row.append(handle, name, amtWrap, del);
    wrap.appendChild(row);
    if(type === 'expense' && !isChild) wrap.appendChild(buildBar(wrap, itemAmount(item), totalExp));
    return wrap;
  }

  function createGroup(type, item, arr, totalExp){
    if(!Array.isArray(item.children)) item.children = [];
    const wrap = document.createElement('div'); wrap.className = 'item group';
    if(item.collapsed) wrap.classList.add('collapsed');
    wrap._item = item; wrap._arr = arr; wrap._type = type;
    const row = document.createElement('div'); row.className = 'row';

    const handle = document.createElement('div');
    handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Dra för att flytta';
    handle.setAttribute('aria-label','Flytta grupp');
    attachDrag(handle, wrap);

    const nameCell = document.createElement('div'); nameCell.className = 'name-cell';
    const chev = document.createElement('button');
    chev.className = 'chevron'; chev.type = 'button'; chev.textContent = '▾';
    chev.setAttribute('aria-label','Fäll ihop grupp');
    chev.addEventListener('click', () => {
      item.collapsed = !item.collapsed;
      wrap.classList.toggle('collapsed', item.collapsed);
      saveDebounced();
    });
    const name = document.createElement('input');
    name.className = 'inp name'; name.placeholder = 'Gruppnamn'; name.value = item.name || '';
    name.setAttribute('aria-label','Gruppnamn');
    name.addEventListener('input', e => { item.name = e.target.value; markDirty(); });
    onEnter(name, () => {
      const child = { name:'', amount:0 };
      item.children.push(child); item.collapsed = false;
      pendingFocus = child; markDirty(); render();
    });
    maybeFocus(item, name);
    nameCell.append(chev, name);

    const total = document.createElement('span');
    total.className = 'group-total'; total.textContent = fmtMoney(itemAmount(item));
    wrap._totalEl = total;

    const del = document.createElement('button');
    del.className = 'row-del'; del.type = 'button'; del.title = 'Ta bort grupp'; del.textContent = '×';
    del.addEventListener('click', () => deleteItem(arr, item));

    row.append(handle, nameCell, total, del);
    wrap.appendChild(row);
    if(type === 'expense') wrap.appendChild(buildBar(wrap, itemAmount(item), totalExp));

    const kids = document.createElement('div'); kids.className = 'group-children';
    item.children.forEach(child => kids.appendChild(createLeaf(type, child, item.children, totalExp, true)));
    wrap.appendChild(kids);

    const addWrap = document.createElement('div'); addWrap.className = 'add-sub';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn ghost sm'; addBtn.type = 'button'; addBtn.textContent = '+ Lägg till underpost';
    addBtn.addEventListener('click', () => {
      const child = { name:'', amount:0 };
      item.children.push(child); pendingFocus = child; item.collapsed = false;
      markDirty(); render();
    });
    addWrap.appendChild(addBtn);
    wrap.appendChild(addWrap);
    return wrap;
  }

  function buildBar(wrap, val, total){
    const bar = document.createElement('div'); bar.className = 'item-bar';
    const track = document.createElement('div'); track.className = 'ib-track';
    const fill = document.createElement('div'); fill.className = 'ib-fill';
    track.appendChild(fill);
    const pctLabel = document.createElement('span'); pctLabel.className = 'ib-pct';
    bar.append(track, pctLabel);
    wrap._barFill = fill; wrap._barPct = pctLabel;
    setBar(fill, pctLabel, val, total);
    return bar;
  }

  function attachDrag(handle, wrap){
    handle.addEventListener('pointerdown', (e) => {
      if(e.button != null && e.button !== 0) return;
      e.preventDefault();
      const container = wrap.parentElement;
      try{ handle.setPointerCapture(e.pointerId); }catch(_){}
      document.body.classList.add('dragging-active');
      wrap.classList.add('dragging');
      const move = (ev) => {
        const y = ev.clientY;
        const others = Array.from(container.querySelectorAll(':scope > .item')).filter(n => n !== wrap);
        let placed = false;
        for(const sib of others){
          const r = sib.getBoundingClientRect();
          if(y < r.top + r.height/2){ container.insertBefore(wrap, sib); placed = true; break; }
        }
        if(!placed) container.appendChild(wrap);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging-active');
        wrap.classList.remove('dragging');
        commitOrder(wrap._arr, container);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }
  function commitOrder(arr, container){
    if(!arr) return;
    const newArr = Array.from(container.querySelectorAll(':scope > .item')).map(n => n._item).filter(Boolean);
    arr.length = 0; arr.push.apply(arr, newArr);
    markDirty(); render();
  }

  function liveRefresh(){
    document.querySelectorAll('#incomeRows .item.group, #expenseRows .item.group').forEach(g => {
      if(g._totalEl && g._item) g._totalEl.textContent = fmtMoney(itemAmount(g._item));
    });
    renderTotals(); updateBars();
  }
  function updateBars(){
    const total = sumArr(curMonth().expenses);
    $('expenseRows').querySelectorAll('.item').forEach(el => {
      if(!el._barFill || !el._barPct || !el._item) return;
      setBar(el._barFill, el._barPct, itemAmount(el._item), total);
    });
  }

  function renderTotals(){
    const m = curMonth();
    const income = sumArr(m.income), expenses = sumArr(m.expenses), balance = income - expenses;
    $('incomeTotal').textContent  = fmtMoney(income);
    $('expenseTotal').textContent = fmtMoney(expenses);
    $('balanceTotal').textContent = fmtMoney(balance);
    $('balanceTotal').className   = 'value ' + (balance<0?'neg':'pos');
    $('incomeHeadTotal').textContent  = fmtMoney(income);
    $('expenseHeadTotal').textContent = fmtMoney(expenses);

    const rate = income > 0 ? Math.round(balance/income*100) : 0;
    const pill = $('savingsPill');
    pill.textContent = (rate>=0?'↑ ':'↓ ') + Math.abs(rate) + '% sparkvot';
    pill.className = 'pill ' + (balance<0?'neg':'pos');

    const spentPct = income > 0 ? Math.min(100, expenses/income*100) : (expenses>0?100:0);
    const fill = $('fbFill');
    fill.style.width = spentPct.toFixed(1) + '%';
    fill.classList.toggle('over', expenses>income && income>0);
    $('fbSpent').textContent  = fmtMoney(expenses);
    $('fbIncome').textContent = fmtMoney(income);
    $('fbPct').textContent    = (income>0?Math.round(expenses/income*100):0) + '%';
    $('fbLeftLabel').textContent = (balance<0?'Underskott ':'Kvar ') + fmtMoney(Math.abs(balance));

    const chipBal = document.querySelector('#monthRail .mchip.active .mc-bal');
    if(chipBal){ chipBal.textContent = fmtMoney(balance); chipBal.className = 'mc-bal ' + (balance<0?'neg':'pos'); }
  }

  // ---- actions ----
  function deleteItem(arr, item){
    const idx = arr.indexOf(item);
    if(idx < 0) return;
    arr.splice(idx, 1);
    touch(bs.currentMonth); saveDebounced(); render();
    const label = (item.name && item.name.trim()) ? '"' + item.name.trim() + '"' : (isGroup(item) ? 'gruppen' : 'raden');
    toastAction('Tog bort ' + label, 'Ångra', () => {
      arr.splice(Math.min(idx, arr.length), 0, item);
      touch(bs.currentMonth); saveDebounced(); render();
    });
  }
  function addIncome(){ const it={name:'',amount:0}; curMonth().income.push(it); pendingFocus=it; markDirty(); render(); }
  function addExpense(){ const it={name:'',amount:0}; curMonth().expenses.push(it); pendingFocus=it; markDirty(); render(); }
  function addGroup(type){
    const g = { name:'', children:[{name:'',amount:0}], collapsed:false };
    (type==='income' ? curMonth().income : curMonth().expenses).push(g);
    pendingFocus = g; markDirty(); render();
  }

  function newMonth(){
    const dlg = $('budgetMonthDialog');
    $('budgetMonthInput').value = ''; $('budgetCopyCheck').checked = true;
    dlg.returnValue = '';
    dlg.showModal();
    $('budgetMonthForm').onsubmit = (ev) => {
      const val = (ev.submitter && ev.submitter.value) || 'cancel';
      if(val !== 'ok') return;
      const key = $('budgetMonthInput').value;
      if(!/^\d{4}-\d{2}$/.test(key)){ ev.preventDefault(); toast('warn','Ogiltig månad'); return; }
      if(bs.months[key]){ ev.preventDefault(); toast('warn','Månaden finns redan'); return; }
      bs.months[key] = $('budgetCopyCheck').checked
        ? JSON.parse(JSON.stringify(curMonth())) : { income:[], expenses:[] };
      bs.currentMonth = key;
      markDirty(); render();
      toast('ok','Skapade ' + monthLabelOf(key));
    };
  }

  async function deleteMonth(key){
    if(Object.keys(bs.months).length <= 1){ toast('warn','Du måste ha minst en månad'); return; }
    if(!(await confirmDialog(`Ta bort ${monthLabelOf(key)}? Detta går inte att ångra.`, 'Ta bort'))) return;
    bs.deletedMonths = bs.deletedMonths || {};
    bs.deletedMonths[key] = Date.now();
    delete bs.months[key];
    if(bs.currentMonth === key) bs.currentMonth = Object.keys(bs.months).sort().reverse()[0];
    saveDebounced(); render();
    toast('ok','Tog bort ' + monthLabelOf(key));
  }

  function applyEditMode(){
    const root = $('budgetRoot'); if(!root) return;
    root.classList.toggle('locked', !editMode);
    const b = $('editToggle');
    b.textContent = editMode ? '✓ Klar' : '✎ Redigera';
    b.classList.toggle('on', editMode);
  }

  // ---- persistence (Supabase) ----
  function touch(key){ const m = bs.months[key]; if(m) m.updatedAt = Date.now(); }
  function markDirty(){ touch(bs.currentMonth); saveDebounced(); }

  const saveDebounced = debounceFn(pushBudget, 700);
  function debounceFn(fn, wait){
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, wait); };
    d.flush = () => { if(t){ clearTimeout(t); t = null; fn(); } };
    return d;
  }

  function mergeTombstones(a, b){
    const out = { ...(b||{}) }, x = a || {};
    for(const k in x) out[k] = Math.max(out[k]||0, x[k]);
    return out;
  }
  function monthHasData(m){ return !!m && ((m.updatedAt||0) > 0 || (m.income && m.income.length) || (m.expenses && m.expenses.length)); }
  function mergeMonths(local, cloud, tombstones){
    const out = { ...cloud };
    for(const k in local){
      const l = local[k], c = cloud[k];
      if(c){
        const ln = l.updatedAt||0, cn = c.updatedAt||0;
        if(ln > cn || (ln === cn && monthHasData(l))) out[k] = l;
      } else if(monthHasData(l)){ out[k] = l; }
    }
    if(tombstones){ for(const k in tombstones){ if(out[k] && (out[k].updatedAt||0) <= tombstones[k]) delete out[k]; } }
    return out;
  }
  function mergeCloud(cloud){
    if(!cloud || typeof cloud !== 'object') return;
    if(!cloud.months || typeof cloud.months !== 'object') cloud.months = {};
    bs.deletedMonths = mergeTombstones(bs.deletedMonths, cloud.deletedMonths);
    bs.months = mergeMonths(bs.months, cloud.months, bs.deletedMonths);
    ensureCurrentMonthValid();
  }
  function ensureCurrentMonthValid(){
    const keys = Object.keys(bs.months);
    if(!keys.length){ const k = monthKeyOf(new Date()); bs.months[k] = { income:[], expenses:[] }; bs.currentMonth = k; return; }
    if(!bs.months[bs.currentMonth]) bs.currentMonth = keys.sort().reverse()[0];
  }
  function serialize(){ return { currentMonth: bs.currentMonth, months: bs.months, deletedMonths: bs.deletedMonths || {} }; }

  // fetch + merge the shared doc (called on open and on realtime)
  async function load(){
    init();
    if(isDemo()){                        // read-only showcase: use bundled fixtures, never the DB
      // DEMO_DATA is a top-level `const` (a global lexical binding, NOT a window property),
      // so reference it by bare name — `window.DEMO_DATA` would be undefined here.
      if(typeof DEMO_DATA !== 'undefined' && DEMO_DATA.budget) mergeCloud(JSON.parse(JSON.stringify(DEMO_DATA.budget)));
      render();
      return;
    }
    if(!sb || !isParent()) return;
    try{
      const { data, error } = await sb.from('budget').select('data').eq('id', true).maybeSingle();
      if(error) throw error;
      if(data && data.data) mergeCloud(data.data);
      if(!isEditingBudget()) render();
    }catch(e){ console.warn('budget load', e); }
  }

  // read-merge-write so a save never clobbers a month the other parent changed
  let pushing = false, pushQueued = false;
  async function pushBudget(){
    if(!sb || !isParent()) return;
    if(isDemo()) return;                 // read-only demo: never persist (edits stay local, reset on reload)
    if(pushing){ pushQueued = true; return; }
    pushing = true;
    try{
      const { data: row } = await sb.from('budget').select('data').eq('id', true).maybeSingle();
      if(row && row.data) mergeCloud(row.data);
      const { error } = await sb.from('budget')
        .update({ data: serialize(), updated_at: new Date().toISOString(), updated_by: me ? me.id : null })
        .eq('id', true);
      if(error) throw error;
    }catch(e){ console.warn('budget save', e); toast('warn','Kunde inte spara budget'); }
    finally{
      pushing = false;
      if(pushQueued){ pushQueued = false; pushBudget(); }
    }
  }

  // realtime: another parent changed the doc → re-merge and repaint (unless mid-edit)
  function onExternalChange(payload){
    const doc = payload && payload.new && payload.new.data;
    if(doc){
      const before = JSON.stringify(bs.months);
      mergeCloud(doc);
      if(JSON.stringify(bs.months) !== before && !isEditingBudget()) render();
    } else {
      load();
    }
  }

  function flush(){ saveDebounced.flush(); }

  return { init, load, render, onExternalChange, flush, isEditing: isEditingBudget };
})();
