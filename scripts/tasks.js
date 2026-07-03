'use strict';
// Chore board: parents post jobs; kids claim + submit; parents approve/reject.
// All state transitions go through SECURITY DEFINER RPCs so a kid can't self-credit.
let editingJob = null;
let editingTemplate = null;
let jobDialogMode = 'job';
let rejectingTaskId = null;

function renderTasks(){
  const board = $('taskBoard');
  if(!board || !me) return;
  board.innerHTML = '';
  const tasks = state.tasks || [];

  if(isParent()){
    taskSection(board, 'Att godkänna', tasks.filter(t => t.status === 'submitted'));
    taskSection(board, 'Lediga',       tasks.filter(t => t.status === 'open'));
    taskSection(board, 'Pågående',      tasks.filter(t => t.status === 'claimed'));
    if(!board.children.length){
      const hint = document.createElement('div');
      hint.className = 'placeholder';
      hint.innerHTML = '<div class="ph-emoji">✅</div><h3>Inga aktiva jobb</h3><p>Lägg upp ett jobb eller aktivera en mall nedan.</p>';
      board.appendChild(hint);
    }
    renderTemplates(board);
  } else {
    taskSection(board, 'Mina jobb',
      tasks.filter(t => t.claimed_by === me.id && (t.status === 'claimed' || t.status === 'rejected')));
    taskSection(board, 'Väntar på godkännande',
      tasks.filter(t => t.claimed_by === me.id && t.status === 'submitted'));
    taskSection(board, 'Lediga jobb', tasks.filter(t => t.status === 'open'));
    if(!board.children.length){
      board.innerHTML =
        '<div class="placeholder"><div class="ph-emoji">✅</div><h3>Inga jobb än</h3><p>Inga lediga jobb just nu.</p></div>';
    }
  }
}

function renderTemplates(board){
  const templates = state.templates || [];
  const head = document.createElement('div');
  head.className = 'section-title tpl-head';
  head.innerHTML = '<span>Mallar</span><button class="btn ghost sm" data-act="newtpl" type="button">+ Ny mall</button>';
  board.appendChild(head);
  if(!templates.length){
    const empty = document.createElement('div');
    empty.className = 'placeholder mini';
    empty.innerHTML = '<p>Spara återkommande jobb som mallar och aktivera dem med ett tryck.</p>';
    board.appendChild(empty);
    return;
  }
  for(const tpl of templates) board.appendChild(templateCard(tpl));
}

function templateCard(tpl){
  const el = document.createElement('div');
  el.className = 'task';
  el.innerHTML = `
    <div class="task-main">
      <div class="task-title">${escapeHtml(tpl.title)}</div>
      ${tpl.description ? `<div class="task-desc">${escapeHtml(tpl.description)}</div>` : ''}
      <div class="task-meta"><span class="reward">${escapeHtml(fmtMoney(tpl.reward))}</span></div>
    </div>
    <div class="task-actions">
      <button class="btn sm" data-act="activatetpl" data-id="${tpl.id}">Aktivera</button>
      <button class="icon-btn" data-act="edittpl" data-id="${tpl.id}" aria-label="Redigera">✎</button>
      <button class="icon-btn" data-act="deltpl" data-id="${tpl.id}" aria-label="Ta bort">🗑</button>
    </div>`;
  return el;
}

function taskSection(board, title, list){
  if(!list.length) return;
  const h = document.createElement('div');
  h.className = 'section-title';
  h.textContent = title;
  board.appendChild(h);
  for(const t of list) board.appendChild(taskCard(t));
}

function taskCard(task){
  const claimer = task.claimed_by ? state.profilesById[task.claimed_by] : null;
  const who = claimer
    ? `<span class="task-who"><span class="dot" style="background:${profileColor(claimer)}"></span>${escapeHtml(capital(claimer.name))}</span>`
    : '';
  const el = document.createElement('div');
  el.className = 'task';
  el.innerHTML = `
    <div class="task-main">
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
      ${task.status === 'rejected' && task.reject_reason ? `<div class="task-reject">↩︎ ${escapeHtml(task.reject_reason)}</div>` : ''}
      <div class="task-meta">
        <span class="reward">${escapeHtml(fmtMoney(task.reward))}</span>
        ${who}
      </div>
    </div>
    <div class="task-actions">${taskActions(task)}</div>`;
  return el;
}

function taskActions(task){
  const mine = me && task.claimed_by === me.id;
  switch(task.status){
    case 'open':
      return isParent()
        ? `<button class="icon-btn" data-act="editjob" data-id="${task.id}" aria-label="Redigera">✎</button>
           <button class="icon-btn" data-act="deljob" data-id="${task.id}" aria-label="Ta bort">🗑</button>`
        : `<button class="btn sm" data-act="claim" data-id="${task.id}">Plocka</button>`;
    case 'claimed':
      return (!isParent() && mine)
        ? `<button class="btn sm" data-act="submit" data-id="${task.id}">Markera klar</button>
           <button class="btn ghost sm" data-act="abort" data-id="${task.id}">Släpp</button>` : '';
    case 'rejected':
      return (!isParent() && mine)
        ? `<button class="btn sm" data-act="submit" data-id="${task.id}">Skicka in igen</button>
           <button class="btn ghost sm" data-act="abort" data-id="${task.id}">Släpp</button>` : '';
    case 'submitted':
      return isParent()
        ? `<button class="btn sm" data-act="approve" data-id="${task.id}">Godkänn</button>
           <button class="btn ghost sm" data-act="reject" data-id="${task.id}">Neka</button>`
        : `<span class="task-wait">Inväntar godkännande</span>`;
    default:
      return '';
  }
}

function onTaskBoardClick(e){
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const found = () => state.tasks.find(t => t.id === id);
  const tpl = () => (state.templates || []).find(t => t.id === id);
  switch(btn.dataset.act){
    case 'claim':   taskRpc('claim_task',   { p_task: id }, 'Plockat!'); break;
    case 'submit':  taskRpc('submit_task',  { p_task: id }, 'Inskickat för godkännande'); break;
    case 'approve': taskRpc('approve_task', { p_task: id }, 'Godkänt ⭐'); break;
    case 'abort':   taskRpc('abort_task',   { p_task: id }, 'Jobbet släpptes'); break;
    case 'reject':  openRejectDialog(id); break;
    case 'editjob': openJobDialog(found()); break;
    case 'deljob':  deleteJob(found()); break;
    case 'newtpl':      openTemplateDialog(null); break;
    case 'activatetpl': activateTemplate(tpl()); break;
    case 'edittpl':     openTemplateDialog(tpl()); break;
    case 'deltpl':      deleteTemplate(tpl()); break;
  }
}

async function taskRpc(fn, args, okMsg){
  try{
    const { error } = await sb.rpc(fn, args);
    if(error) throw error;
    toast('ok', okMsg);
    await Promise.all([loadTasks(), loadBalances(), loadLedger()]);
    renderTasks();
    renderCredits();
  }catch(err){
    console.warn(fn, err);
    toast('warn', 'Något gick fel');
  }
}

// Create / edit job (parent) -------------------------------------------
function openJobDialog(job){
  jobDialogMode = 'job';
  editingJob = job || null;
  $('jobDlgTitle').textContent = job ? 'Redigera jobb' : 'Nytt jobb';
  $('jobTitle').value  = job ? job.title : '';
  $('jobDesc').value   = job ? (job.description || '') : '';
  $('jobReward').value = job ? job.reward : 10;
  $('jobDialog').showModal();
}

function openTemplateDialog(tpl){
  jobDialogMode = 'template';
  editingTemplate = tpl || null;
  $('jobDlgTitle').textContent = tpl ? 'Redigera mall' : 'Ny mall';
  $('jobTitle').value  = tpl ? tpl.title : '';
  $('jobDesc').value   = tpl ? (tpl.description || '') : '';
  $('jobReward').value = tpl ? tpl.reward : 10;
  $('jobDialog').showModal();
}

async function activateTemplate(tpl){
  if(!tpl) return;
  try{
    const { error } = await sb.from('tasks').insert({ title: tpl.title, description: tpl.description, reward: tpl.reward, created_by: me.id });
    if(error) throw error;
    toast('ok', 'Jobb upplagt');
    await loadTasks();
    renderTasks();
  }catch(err){ console.warn('activateTemplate', err); toast('warn', 'Kunde inte aktivera'); }
}

async function deleteTemplate(tpl){
  if(!tpl) return;
  if(!(await confirmDialog(`Ta bort mallen "${tpl.title}"?`))) return;
  try{
    const { error } = await sb.from('task_templates').delete().eq('id', tpl.id);
    if(error) throw error;
    toast('ok', 'Mall borttagen');
    await loadTemplates();
    renderTasks();
  }catch(err){ console.warn('deleteTemplate', err); toast('warn', 'Kunde inte ta bort'); }
}

async function saveJobFromDialog(){
  const title = $('jobTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad som ska göras'); return; }
  const reward = Math.max(0, Math.round(Number($('jobReward').value) || 0));
  const description = $('jobDesc').value.trim() || null;
  try{
    let error;
    if(jobDialogMode === 'template'){
      if(editingTemplate){
        ({ error } = await sb.from('task_templates').update({ title, description, reward }).eq('id', editingTemplate.id));
      } else {
        ({ error } = await sb.from('task_templates').insert({ title, description, reward, created_by: me.id }));
      }
      if(error) throw error;
      toast('ok', editingTemplate ? 'Mall uppdaterad' : 'Mall sparad');
      await loadTemplates();
    } else {
      if(editingJob){
        ({ error } = await sb.from('tasks').update({ title, description, reward }).eq('id', editingJob.id));
      } else {
        ({ error } = await sb.from('tasks').insert({ title, description, reward, created_by: me.id }));
      }
      if(error) throw error;
      toast('ok', editingJob ? 'Uppdaterat' : 'Jobb tillagt');
      await loadTasks();
    }
    renderTasks();
  }catch(err){
    console.warn('saveJob', err);
    toast('warn', 'Kunde inte spara');
  }
}

async function deleteJob(job){
  if(!job) return;
  if(!(await confirmDialog(`Ta bort jobbet "${job.title}"?`))) return;
  try{
    const { error } = await sb.from('tasks').delete().eq('id', job.id);
    if(error) throw error;
    toast('ok', 'Borttaget');
    await loadTasks();
    renderTasks();
  }catch(err){
    console.warn('deleteJob', err);
    toast('warn', 'Kunde inte ta bort');
  }
}

// Reject (parent) ------------------------------------------------------
function openRejectDialog(id){
  rejectingTaskId = id;
  $('rejectReason').value = '';
  $('rejectDialog').showModal();
}

async function confirmReject(){
  try{
    const reason = $('rejectReason').value.trim() || null;
    const { error } = await sb.rpc('reject_task', { p_task: rejectingTaskId, p_reason: reason });
    if(error) throw error;
    toast('ok', 'Nekat');
    await loadTasks();
    renderTasks();
  }catch(err){
    console.warn('reject', err);
    toast('warn', 'Kunde inte neka');
  }
}
