'use strict';
// Städschema — a recurring weekly cleaning schedule inside "Att göra" (beside Att göra + Inköp).
// Parents pin chores to a weekday; the whole family ticks them off through the week. Completions
// are tracked per week (week_start = this week's Monday), so the schedule resets every Monday.
// Shared: anyone ticks, no owner. Editing the schedule is parent-only.

const CLEAN_WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
let editingCleaningId = null;

function weekStartKey(){ return dateKey(mondayOfWeek(0)); }          // Monday of the current week
function todayWeekdayIdx(){ return (new Date().getDay() + 6) % 7; }  // Mon=0 … Sun=6
function cleaningDoneRow(taskId){
  const wk = weekStartKey();
  return (state.cleaningDone || []).find(d => d.task_id === taskId && d.week_start === wk) || null;
}

function renderCleaning(){
  const box = $('cleaningBoard');
  if(!box || !me) return;
  const tasks = state.cleaningTasks || [];
  const parent = isParent();

  if(!tasks.length){
    box.innerHTML = `<div class="placeholder"><div class="ph-emoji">🧽</div><h3>Inget städschema än</h3>` +
      `<p>${parent ? 'Lägg till städuppgifter och fördela dem över veckan.' : 'Föräldrarna har inte lagt upp något schema.'}</p></div>`;
    return;
  }

  const todayIdx = todayWeekdayIdx();
  const total = tasks.length;
  const done = tasks.filter(t => cleaningDoneRow(t.id)).length;
  const overdue = tasks.filter(t => t.weekday < todayIdx && !cleaningDoneRow(t.id)).length;

  let nudge, tone;
  if(done === total){ nudge = 'Allt klart denna vecka! 🎉'; tone = 'good'; }
  else if(overdue){ nudge = `${overdue} ${overdue === 1 ? 'uppgift släpar' : 'uppgifter släpar'} efter — ta ${overdue === 1 ? 'den' : 'dem'} idag 💪`; tone = 'late'; }
  else { nudge = 'Bra tempo — håll det uppe! ✨'; tone = 'ok'; }

  const pct = Math.round((done / total) * 100);
  const wk = isoWeek(mondayOfWeek(0));

  const days = [];
  for(let wd = 0; wd < 7; wd++){
    const dayTasks = tasks.filter(t => t.weekday === wd);
    const isToday = wd === todayIdx;
    const isPast = wd < todayIdx;
    const rows = dayTasks.length
      ? dayTasks.map(t => cleaningTaskRow(t, isPast)).join('')
      : '<div class="cl-day-empty">Inget inplanerat</div>';
    days.push(`
      <section class="cl-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}">
        <div class="cl-day-head">
          <span class="cl-day-name serif">${CLEAN_WEEKDAYS[wd]}</span>
          ${isToday ? '<span class="cl-today-badge">Idag</span>' : ''}
        </div>
        ${rows}
      </section>`);
  }

  box.innerHTML = `
    <div class="cl-progress">
      <div class="cl-progress-top">
        <span class="cl-progress-count"><b>${done}</b> av ${total} klara denna vecka</span>
        <span class="cl-progress-week">v.${wk}</span>
      </div>
      <div class="cl-bar"><div class="cl-bar-fill" style="width:${pct}%"></div></div>
      <div class="cl-nudge ${tone}">${escapeHtml(nudge)}</div>
    </div>
    <div class="cl-week">${days.join('')}</div>`;
}

function cleaningTaskRow(t, dayIsPast){
  const doneRow = cleaningDoneRow(t.id);
  const isDone = !!doneRow;
  const overdue = dayIsPast && !isDone;
  const by = doneRow && doneRow.done_by ? state.profilesById[doneRow.done_by] : null;
  let meta = '';
  if(isDone && by) meta = `<div class="cl-task-meta">klarad av ${escapeHtml(capital(by.name))}</div>`;
  else if(overdue) meta = `<div class="cl-task-meta late">Släpar efter</div>`;
  return `
    <div class="cl-task${isDone ? ' done' : ''}${overdue ? ' overdue' : ''}">
      <button class="cl-check" data-toggle="${t.id}" type="button" role="checkbox" aria-checked="${isDone}" aria-label="Klarmarkera">${isDone ? '✓' : ''}</button>
      <div class="cl-task-main">
        <div class="cl-task-title">${escapeHtml(t.title)}</div>
        ${meta}
      </div>
      ${isParent() ? `<button class="icon-btn" data-editclean="${t.id}" type="button" aria-label="Redigera">✎</button>` : ''}
    </div>`;
}

function onCleaningClick(e){
  const toggle = e.target.closest('[data-toggle]');
  if(toggle){ toggleCleaningDone(toggle.dataset.toggle); return; }
  const edit = e.target.closest('[data-editclean]');
  if(edit){ openCleaningDialog((state.cleaningTasks || []).find(t => t.id === edit.dataset.editclean)); }
}

async function toggleCleaningDone(taskId){
  const existing = cleaningDoneRow(taskId);
  try{
    if(existing){
      const { error } = await sb.from('cleaning_done').delete().eq('id', existing.id);
      if(error) throw error;
    } else {
      const { error } = await sb.from('cleaning_done')
        .insert({ task_id: taskId, week_start: weekStartKey(), done_by: me.id });
      if(error) throw error;
    }
    await loadCleaningDone();
    renderCleaning();
    renderToday();   // the agenda's "Städning idag" reflects the same ticks
  }catch(err){ console.warn('toggleCleaningDone', err); toast('warn', 'Kunde inte uppdatera'); }
}

// ---- schedule editor (parent) ----
function openCleaningDialog(task){
  editingCleaningId = task ? task.id : null;
  $('cleaningDlgTitle').textContent = task ? 'Redigera städuppgift' : 'Ny städuppgift';
  $('cleaningWeekday').innerHTML = CLEAN_WEEKDAYS
    .map((w, i) => `<option value="${i}">${w}</option>`).join('');
  $('cleaningTitle').value = task ? task.title : '';
  $('cleaningWeekday').value = String(task ? task.weekday : todayWeekdayIdx());
  $('cleaningDelete').hidden = !task;
  $('cleaningDialog').showModal();
}

async function saveCleaning(){
  const title = $('cleaningTitle').value.trim();
  if(!title){ toast('warn', 'Skriv en uppgift'); return; }
  const weekday = Number($('cleaningWeekday').value);
  try{
    if(editingCleaningId){
      const { error } = await sb.from('cleaning_tasks').update({ title, weekday }).eq('id', editingCleaningId);
      if(error) throw error;
    } else {
      const { error } = await sb.from('cleaning_tasks').insert({ title, weekday, created_by: me.id });
      if(error) throw error;
    }
    toast('ok', 'Sparad');
    await loadCleaningTasks();
    renderCleaning();
  }catch(err){ console.warn('saveCleaning', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteCleaning(){
  if(!editingCleaningId) return;
  const t = (state.cleaningTasks || []).find(x => x.id === editingCleaningId);
  if(!(await confirmDialog(`Ta bort "${t ? t.title : ''}"?`))) return;
  try{
    const { error } = await sb.from('cleaning_tasks').delete().eq('id', editingCleaningId);
    if(error) throw error;
    $('cleaningDialog').close();
    toast('ok', 'Borttagen');
    await loadCleaningTasks(); await loadCleaningDone();
    renderCleaning();
  }catch(err){ console.warn('deleteCleaning', err); toast('warn', 'Kunde inte ta bort'); }
}
