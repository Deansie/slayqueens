'use strict';
// Veckans matsedel: a weekly dinner plan (one dish per day). Parents set the plan and manage
// week templates; anyone (kids included) can add "önskemål" — meal wishes — that parents can
// drop into a day. All plan writes are parent-only (RLS); kids get a read-only menu + wishes.

let mealWeekOffset = 0;      // 0 = current week, ±1 = neighbouring weeks
let editingMealDate = null;  // 'YYYY-MM-DD' being edited in the meal dialog

function currentWeekDays(){
  const mon = mondayOfWeek(mealWeekOffset);
  return [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
}
function mealForDate(k){ return (state.meals || []).find(m => m.date === k) || null; }

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
        <button class="btn ghost sm" data-ms="templates" type="button">🍽 Mallar</button>
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
    if(act.dataset.ms === 'templates') openMealTemplates();
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
  const wishes = state.mealWishes || [];
  const wrap = $('mealWishWrap'), picks = $('mealWishPicks');
  if(wishes.length){
    picks.innerHTML = wishes.map(w =>
      `<button type="button" class="ms-pick" data-pick="${escapeHtml(w.title)}">${escapeHtml(w.title)}</button>`).join('');
    wrap.hidden = false;
  } else { picks.innerHTML = ''; wrap.hidden = true; }
  $('mealClear').hidden = !meal;       // nothing to clear on an empty day
  $('mealDialog').showModal();
}

function onMealWishPickClick(e){
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
    toast('ok', 'Sparad');
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

// ---- templates (parent) ----
function openMealTemplates(){
  $('mealTemplateName').value = '';
  renderMealTemplateList();
  $('mealTemplateDialog').showModal();
}

function renderMealTemplateList(){
  const box = $('mealTemplateList');
  const tpls = state.mealTemplates || [];
  if(!tpls.length){
    box.innerHTML = '<div class="ms-wish-empty">Inga mallar än. Bygg en vecka och spara den nedan.</div>';
    return;
  }
  box.innerHTML = tpls.map(t => {
    const items = Array.isArray(t.items) ? t.items.filter(Boolean) : [];
    const preview = items.slice(0, 3).join(' · ') + (items.length > 3 ? ' …' : '');
    return `<div class="ms-tpl">
        <div class="ms-tpl-main">
          <div class="ms-tpl-name">${escapeHtml(t.name)}</div>
          ${preview ? `<div class="ms-tpl-items">${escapeHtml(preview)}</div>` : ''}
        </div>
        <button class="btn sm" data-activate="${t.id}" type="button">Aktivera</button>
        <button class="icon-btn" data-deltpl="${t.id}" type="button" aria-label="Ta bort">🗑</button>
      </div>`;
  }).join('');
}

function onMealTemplateListClick(e){
  const a = e.target.closest('[data-activate]');
  if(a){ activateMealTemplate(a.dataset.activate); return; }
  const d = e.target.closest('[data-deltpl]');
  if(d){ deleteMealTemplate(d.dataset.deltpl); }
}

async function activateMealTemplate(id){
  const t = (state.mealTemplates || []).find(x => x.id === id);
  if(!t) return;
  if(!(await confirmDialog(`Aktivera "${t.name}" och ersätta veckans måltider?`, 'Aktivera'))) return;
  const items = Array.isArray(t.items) ? t.items : [];
  const rows = [], clears = [];
  currentWeekDays().forEach((d, i) => {
    const k = dateKey(d), dish = (items[i] || '').trim();
    if(dish) rows.push({ date: k, title: dish, created_by: me.id, updated_at: new Date().toISOString() });
    else clears.push(k);
  });
  try{
    if(clears.length){ const { error } = await sb.from('meals').delete().in('date', clears); if(error) throw error; }
    if(rows.length){ const { error } = await sb.from('meals').upsert(rows, { onConflict: 'date' }); if(error) throw error; }
    $('mealTemplateDialog').close();
    toast('ok', `${t.name} aktiverad`);
    await loadMeals(); renderMatsedel();
  }catch(err){ console.warn('activateMealTemplate', err); toast('warn', 'Kunde inte aktivera'); }
}

async function deleteMealTemplate(id){
  const t = (state.mealTemplates || []).find(x => x.id === id);
  if(!t) return;
  if(!(await confirmDialog(`Ta bort mallen "${t.name}"?`))) return;
  try{
    const { error } = await sb.from('meal_templates').delete().eq('id', id);
    if(error) throw error;
    await loadMealTemplates(); renderMealTemplateList();
  }catch(err){ console.warn('deleteMealTemplate', err); toast('warn', 'Kunde inte ta bort'); }
}

async function saveWeekAsTemplate(){
  const name = $('mealTemplateName').value.trim();
  if(!name){ toast('warn', 'Ge mallen ett namn'); return; }
  const items = currentWeekDays().map(d => { const m = mealForDate(dateKey(d)); return (m && m.title) ? m.title : ''; });
  if(!items.some(Boolean)){ toast('warn', 'Veckan är tom'); return; }
  try{
    const { error } = await sb.from('meal_templates').insert({ name, items, created_by: me.id });
    if(error) throw error;
    $('mealTemplateName').value = '';
    toast('ok', 'Mall sparad');
    await loadMealTemplates(); renderMealTemplateList();
  }catch(err){ console.warn('saveWeekAsTemplate', err); toast('warn', 'Kunde inte spara'); }
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
