'use strict';
// Chore board: parents post jobs; kids claim + submit; parents approve/reject.
// All state transitions go through SECURITY DEFINER RPCs so a kid can't self-credit.
let editingJob = null;
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
  } else {
    taskSection(board, 'Mina jobb',
      tasks.filter(t => t.claimed_by === me.id && (t.status === 'claimed' || t.status === 'rejected')));
    taskSection(board, 'Väntar på godkännande',
      tasks.filter(t => t.claimed_by === me.id && t.status === 'submitted'));
    taskSection(board, 'Lediga jobb', tasks.filter(t => t.status === 'open'));
  }

  if(!board.children.length){
    board.innerHTML =
      '<div class="placeholder"><div class="ph-emoji">✅</div><h3>Inga jobb än</h3><p>' +
      (isParent() ? 'Lägg upp ett jobb så kan barnen plocka det.' : 'Inga lediga jobb just nu.') +
      '</p></div>';
  }
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
        ? `<button class="btn sm" data-act="submit" data-id="${task.id}">Markera klar</button>` : '';
    case 'rejected':
      return (!isParent() && mine)
        ? `<button class="btn sm" data-act="submit" data-id="${task.id}">Skicka in igen</button>` : '';
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
  switch(btn.dataset.act){
    case 'claim':   taskRpc('claim_task',   { p_task: id }, 'Plockat!'); break;
    case 'submit':  taskRpc('submit_task',  { p_task: id }, 'Inskickat för godkännande'); break;
    case 'approve': taskRpc('approve_task', { p_task: id }, 'Godkänt ⭐'); break;
    case 'reject':  openRejectDialog(id); break;
    case 'editjob': openJobDialog(found()); break;
    case 'deljob':  deleteJob(found()); break;
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
  editingJob = job || null;
  $('jobDlgTitle').textContent = job ? 'Redigera jobb' : 'Nytt jobb';
  $('jobTitle').value  = job ? job.title : '';
  $('jobDesc').value   = job ? (job.description || '') : '';
  $('jobReward').value = job ? job.reward : 10;
  $('jobDialog').showModal();
}

async function saveJobFromDialog(){
  const title = $('jobTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad som ska göras'); return; }
  const reward = Math.max(0, Math.round(Number($('jobReward').value) || 0));
  const description = $('jobDesc').value.trim() || null;
  try{
    let error;
    if(editingJob){
      ({ error } = await sb.from('tasks').update({ title, description, reward }).eq('id', editingJob.id));
    } else {
      ({ error } = await sb.from('tasks').insert({ title, description, reward, created_by: me.id }));
    }
    if(error) throw error;
    toast('ok', editingJob ? 'Uppdaterat' : 'Jobb tillagt');
    await loadTasks();
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
