'use strict';
// Veckans matsedel: a weekly dinner plan (one dish per day). Parents set the plan, picking
// from a growing library of the family's regular dishes ("Rätter"); anyone (kids included)
// can add "önskemål" — meal wishes — that parents can drop into a day. All plan/library
// writes are parent-only (RLS); kids get a read-only menu and can add wishes.

let mealWeekOffset = 0;      // 0 = current week, ±1 = neighbouring weeks
let editingMealDate = null;  // 'YYYY-MM-DD' being edited in the meal dialog

function currentWeekDays(){
  const mon = mondayOfWeek(mealWeekOffset);
  return [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
}
function mealForDate(k){ return (state.meals || []).find(m => m.date === k) || null; }
function dishInLibrary(title){
  const t = title.trim().toLowerCase();
  return (state.mealDishes || []).some(d => (d.title || '').trim().toLowerCase() === t);
}

function renderMatsedel(){
  const box = $('matsedelBody');
  if(!box || !me) return;
  const days = currentWeekDays();
  const mon = days[0];
  const wk = isoWeek(mon);
  const todayK = todayKey();
  const parent = isParent();

  const rows = days.map((d, i) => {
    const k = dateKey(d);
    const meal = mealForDate(k);
    const isToday = k === todayK;
    const dish = (meal && meal.title)
      ? `<div class="ms-dish">${escapeHtml(meal.title)}</div>`
      : `<div class="ms-dish empty">${parent ? 'Lägg till…' : '—'}</div>`;
    const note = (meal && meal.note) ? `<div class="ms-note">${escapeHtml(meal.note)}</div>` : '';
    return `<div class="ms-day${isToday ? ' is-today' : ''}" data-date="${k}"${parent ? ' role="button" tabindex="0"' : ''}>
        <div class="ms-wd">${MEAL_WEEKDAYS[i]}</div>
        <div class="ms-main">${dish}${note}</div>
      </div>`;
  }).join('');

  const wishes = state.mealWishes || [];
  const wishHtml = wishes.length
    ? wishes.map(wishChip).join('')
    : '<div class="ms-wish-empty">Inga önskemål än. Tryck ＋ Önska för att föreslå en måltid.</div>';

  box.innerHTML = `
    <div class="matsedel">
      <div class="ms-cover">
        <div class="ms-eyebrow">Veckans matsedel</div>
        <div class="ms-weeknav">
          <button class="ms-arrow" data-week="-1" type="button" aria-label="Föregående vecka">‹</button>
          <div class="ms-weekno serif">v.${wk}</div>
          <button class="ms-arrow" data-week="1" type="button" aria-label="Nästa vecka">›</button>
        </div>
        <div class="ms-range">${escapeHtml(weekRangeLabel(mon))}</div>
      </div>

      <div class="ms-menu">${rows}</div>

      ${parent ? `<div class="ms-actions">
        <button class="btn ghost sm" data-ms="dishes" type="button">🍽 Rätter</button>
        <button class="btn ghost sm" data-ms="clearweek" type="button">Rensa vecka</button>
      </div>` : ''}

      <div class="ms-wishes">
        <div class="section-title">Barnens önskemål</div>
        <div class="ms-wish-list">${wishHtml}</div>
      </div>
    </div>`;
}

function wishChip(w){
  const by = state.profilesById[w.created_by];
  const canDel = (me && w.created_by === me.id) || isParent();
  return `<span class="ms-wish">
      ${avatarHtml(by ? profileColor(by) : 'var(--faint)', by ? by.name : '?')}
      <span class="ms-wish-t">${escapeHtml(w.title)}</span>
      ${canDel ? `<button class="ms-wish-x" data-delwish="${w.id}" type="button" aria-label="Ta bort">✕</button>` : ''}
    </span>`;
}

function onMatsedelClick(e){
  const wk = e.target.closest('[data-week]');
  if(wk){ mealWeekOffset += Number(wk.dataset.week); renderMatsedel(); return; }
  const del = e.target.closest('[data-delwish]');
  if(del){ deleteWish(del.dataset.delwish); return; }
  const act = e.target.closest('[data-ms]');
  if(act){
    if(act.dataset.ms === 'dishes') openMealDishes();
    else if(act.dataset.ms === 'clearweek') clearWeek();
    return;
  }
  const day = e.target.closest('.ms-day[data-date]');
  if(day && isParent()) openMealDialog(day.dataset.date, mealForDate(day.dataset.date));
}

// ---- meal editor (parent) ----
function openMealDialog(k, meal){
  editingMealDate = k;
  const d = new Date(k + 'T00:00');
  $('mealDlgTitle').textContent = `${capital(WEEKDAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('mealTitle').value = meal ? (meal.title || '') : '';
  $('mealNote').value  = meal ? (meal.note  || '') : '';
  fillPicks('mealDishPicks', 'mealDishWrap', (state.mealDishes || []).map(x => x.title));
  fillPicks('mealWishPicks', 'mealWishWrap', (state.mealWishes || []).map(x => x.title));
  $('mealSaveDish').checked = true;
  $('mealClear').hidden = !meal;       // nothing to clear on an empty day
  $('mealDialog').showModal();
}

// tap-to-fill chips (used for both the dish library and the wishes)
function fillPicks(picksId, wrapId, titles){
  const wrap = $(wrapId), picks = $(picksId);
  const uniq = [...new Set(titles.filter(Boolean))];
  if(uniq.length){
    picks.innerHTML = uniq.map(t => `<button type="button" class="ms-pick" data-pick="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
    wrap.hidden = false;
  } else { picks.innerHTML = ''; wrap.hidden = true; }
}
function onMealPickClick(e){
  const b = e.target.closest('[data-pick]');
  if(b) $('mealTitle').value = b.dataset.pick;
}

async function saveMeal(){
  const title = $('mealTitle').value.trim();
  if(!title){ toast('warn', 'Skriv en rätt'); return; }
  const note = $('mealNote').value.trim() || null;
  try{
    const { error } = await sb.from('meals').upsert(
      { date: editingMealDate, title, note, created_by: me.id, updated_at: new Date().toISOString() },
      { onConflict: 'date' });
    if(error) throw error;
    // remember new dishes in the library so they're a tap away next time
    if($('mealSaveDish').checked && !dishInLibrary(title)){
      const { error: e2 } = await sb.from('meal_dishes').insert({ title, created_by: me.id });
      if(e2) console.warn('add dish', e2); else await loadMealDishes();
    }
    // a wished dish that's now on the menu is fulfilled — remove matching wishes so they
    // don't pile up (a parent can delete any wish per RLS)
    const fulfilled = (state.mealWishes || []).filter(w => (w.title || '').trim().toLowerCase() === title.toLowerCase());
    if(fulfilled.length){
      const { error: e3 } = await sb.from('meal_wishes').delete().in('id', fulfilled.map(w => w.id));
      if(e3) console.warn('consume wish', e3); else await loadMealWishes();
    }
    toast('ok', fulfilled.length ? 'Sparad – önskemål uppfyllt' : 'Sparad');
    await loadMeals(); renderMatsedel();
  }catch(err){ console.warn('saveMeal', err); toast('warn', 'Kunde inte spara'); }
}

async function clearMeal(){
  if(!editingMealDate){ $('mealDialog').close(); return; }
  try{
    const { error } = await sb.from('meals').delete().eq('date', editingMealDate);
    if(error) throw error;
    $('mealDialog').close();
    await loadMeals(); renderMatsedel();
  }catch(err){ console.warn('clearMeal', err); toast('warn', 'Kunde inte ta bort'); }
}

// ---- dish library "Rätter" (parent) ----
function openMealDishes(){
  $('mealDishNew').value = '';
  renderMealDishList();
  $('mealDishDialog').showModal();
}

function renderMealDishList(){
  const box = $('mealDishList');
  const dishes = state.mealDishes || [];
  if(!dishes.length){
    box.innerHTML = '<div class="ms-wish-empty">Inga rätter än. Lägg till dem nedan — de dyker upp som snabbval när du planerar.</div>';
    return;
  }
  box.innerHTML = dishes.map(d =>
    `<div class="ms-lib">
       <div class="ms-lib-name">${escapeHtml(d.title)}</div>
       <button class="icon-btn" data-deldish="${d.id}" type="button" aria-label="Ta bort">🗑</button>
     </div>`).join('');
}

function onMealDishListClick(e){
  const d = e.target.closest('[data-deldish]');
  if(d) deleteMealDish(d.dataset.deldish);
}

async function addMealDish(){
  const title = $('mealDishNew').value.trim();
  if(!title){ toast('warn', 'Skriv en rätt'); return; }
  if(dishInLibrary(title)){ toast('warn', 'Rätten finns redan'); $('mealDishNew').value = ''; return; }
  try{
    const { error } = await sb.from('meal_dishes').insert({ title, created_by: me.id });
    if(error) throw error;
    $('mealDishNew').value = '';
    await loadMealDishes(); renderMealDishList();
  }catch(err){ console.warn('addMealDish', err); toast('warn', 'Kunde inte lägga till'); }
}

async function deleteMealDish(id){
  try{
    const { error } = await sb.from('meal_dishes').delete().eq('id', id);
    if(error) throw error;
    await loadMealDishes(); renderMealDishList();
  }catch(err){ console.warn('deleteMealDish', err); toast('warn', 'Kunde inte ta bort'); }
}

async function clearWeek(){
  if(!(await confirmDialog('Rensa alla måltider den här veckan?', 'Rensa'))) return;
  const keys = currentWeekDays().map(dateKey);
  try{
    const { error } = await sb.from('meals').delete().in('date', keys);
    if(error) throw error;
    toast('ok', 'Veckan rensad');
    await loadMeals(); renderMatsedel();
  }catch(err){ console.warn('clearWeek', err); toast('warn', 'Kunde inte rensa'); }
}

// ---- wishes (anyone) ----
function openWishDialog(){ $('wishTitle').value = ''; $('wishDialog').showModal(); }

async function saveWish(){
  const title = $('wishTitle').value.trim();
  if(!title){ toast('warn', 'Skriv en måltid'); return; }
  try{
    const { error } = await sb.from('meal_wishes').insert({ title, created_by: me.id });
    if(error) throw error;
    toast('ok', 'Önskemål skickat');
    await loadMealWishes(); renderMatsedel();
  }catch(err){ console.warn('saveWish', err); toast('warn', 'Kunde inte skicka'); }
}

async function deleteWish(id){
  try{
    const { error } = await sb.from('meal_wishes').delete().eq('id', id);
    if(error) throw error;
    await loadMealWishes(); renderMatsedel();
  }catch(err){ console.warn('deleteWish', err); toast('warn', 'Kunde inte ta bort'); }
}
