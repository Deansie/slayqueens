'use strict';
// Att göra: a shared family checklist plus each person's private list.
// Shared todos (private=false) are visible to everyone and anyone can tick them off.
// Private todos (private=true, owner = me) show only in my own list (same "hidden from the
// other kids" meaning as a private calendar event). No reward is involved, so a plain
// RLS-guarded update is enough — unlike the chore board.

function renderTodos(){
  const box = $('todoList');
  if(!box || !me) return;
  const all = state.todos || [];
  box.innerHTML = '';
  todoSection(box, 'Familjen', all.filter(t => !t.private));
  todoSection(box, 'Mina egna', all.filter(t => t.private && t.owner_id === me.id));
  if(!box.children.length){
    box.innerHTML =
      '<div class="placeholder"><div class="ph-emoji">📝</div><h3>Inget att göra</h3>' +
      '<p>Lägg till saker familjen behöver komma ihåg.</p></div>';
  }
}

function todoSection(box, title, list){
  if(!list.length) return;
  // open items first (oldest first), then done items (most recently done first, dimmed)
  const open = list.filter(t => !t.done).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const done = list.filter(t => t.done).sort((a, b) => new Date(b.done_at || b.created_at) - new Date(a.done_at || a.created_at));
  const h = document.createElement('div');
  h.className = 'section-title';
  h.textContent = title;
  box.appendChild(h);
  for(const t of open.concat(done)) box.appendChild(todoRow(t));
}

function todoRow(t){
  const by = state.profilesById[t.created_by];
  const doneBy = t.done && t.done_by ? state.profilesById[t.done_by] : null;
  const canDelete = t.created_by === me.id || t.owner_id === me.id || isParent();
  const meta = (t.private ? '🔒 ' : '') + escapeHtml(by ? capital(by.name) : '—') +
    (doneBy ? ' · klarad av ' + escapeHtml(capital(doneBy.name)) : '');
  const el = document.createElement('div');
  el.className = 'todo' + (t.done ? ' done' : '');
  el.innerHTML = `
    <button class="todo-check" data-toggle="${t.id}" type="button" role="checkbox" aria-checked="${t.done}" aria-label="Klarmarkera">${t.done ? '✓' : ''}</button>
    <div class="todo-main">
      <div class="todo-title">${escapeHtml(t.title)}</div>
      <div class="todo-meta">${meta}</div>
    </div>
    ${canDelete ? `<button class="icon-btn" data-deltodo="${t.id}" aria-label="Ta bort">🗑</button>` : ''}`;
  return el;
}

function onTodoListClick(e){
  const toggle = e.target.closest('[data-toggle]');
  if(toggle){ toggleTodo(toggle.dataset.toggle); return; }
  const del = e.target.closest('[data-deltodo]');
  if(del){ deleteTodo((state.todos || []).find(t => t.id === del.dataset.deltodo)); }
}

async function toggleTodo(id){
  const t = (state.todos || []).find(x => x.id === id);
  if(!t) return;
  const done = !t.done;
  try{
    const { error } = await sb.from('todos')
      .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? me.id : null })
      .eq('id', id);
    if(error) throw error;
    await loadTodos();
    renderTodos();
  }catch(err){ console.warn('toggleTodo', err); toast('warn', 'Kunde inte uppdatera'); }
}

function openTodoDialog(){
  $('todoTitle').value = '';
  $('todoPrivate').checked = false;
  $('todoDialog').showModal();
}

async function saveTodo(){
  const title = $('todoTitle').value.trim();
  if(!title){ toast('warn', 'Skriv vad som ska göras'); return; }
  const priv = $('todoPrivate').checked;
  try{
    const { error } = await sb.from('todos')
      .insert({ title, private: priv, owner_id: priv ? me.id : null, created_by: me.id });
    if(error) throw error;
    toast('ok', 'Tillagd');
    await loadTodos();
    renderTodos();
  }catch(err){ console.warn('saveTodo', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteTodo(t){
  if(!t) return;
  if(!(await confirmDialog(`Ta bort "${t.title}"?`))) return;
  try{
    const { error } = await sb.from('todos').delete().eq('id', t.id);
    if(error) throw error;
    toast('ok', 'Borttagen');
    await loadTodos();
    renderTodos();
  }catch(err){ console.warn('deleteTodo', err); toast('warn', 'Kunde inte ta bort'); }
}
