'use strict';
// Startup, event wiring, view routing, and shared dialogs.

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchView(t.dataset.view)));

  // Login / logout
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutBtn').addEventListener('click', async () => {
    unsubscribeRealtime();
    await signOut();
  });

  // Calendar
  $('addEventBtn').addEventListener('click', () => openEventDialog(null));
  $('catFilter').addEventListener('click', onCatFilterClick);
  $('eventForm').addEventListener('submit', (e) => {
    if(e.submitter && e.submitter.value === 'ok') saveEventFromDialog();
  });
  $('evCancel').addEventListener('click', () => $('eventDialog').close());
  $('evAllDay').addEventListener('change', toggleTime);

  // Tasks
  $('addTaskBtn').addEventListener('click', () => openJobDialog(null));
  $('taskBoard').addEventListener('click', onTaskBoardClick);
  $('jobForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveJobFromDialog(); });
  $('jobCancel').addEventListener('click', () => $('jobDialog').close());
  $('rejectForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') confirmReject(); });
  $('rejectCancel').addEventListener('click', () => $('rejectDialog').close());

  // Credits
  $('creditsBody').addEventListener('click', onCreditsClick);
  $('adjustForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveAdjust(); });
  $('adjustCancel').addEventListener('click', () => $('adjustDialog').close());

  // Profile
  $('meChip').addEventListener('click', openProfileDialog);
  $('profileSwatches').addEventListener('click', onSwatchClick);
  $('profileForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveProfile(); });
  $('profileCancel').addEventListener('click', () => $('profileDialog').close());
  $('pushBtn').addEventListener('click', togglePush);

  // Suggestions
  $('addSuggestionBtn').addEventListener('click', openSuggestionDialog);
  $('suggestionList').addEventListener('click', onSuggestionClick);
  $('suggestionForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveSuggestion(); });
  $('sgCancel').addEventListener('click', () => $('suggestionDialog').close());

  // Todos
  $('addTodoBtn').addEventListener('click', openTodoDialog);
  $('todoList').addEventListener('click', onTodoListClick);
  $('todoForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveTodo(); });
  $('todoCancel').addEventListener('click', () => $('todoDialog').close());

  // Event chat
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendEventMessage(); });
  $('chatClose').addEventListener('click', () => $('eventChatDialog').close());
  $('chatThread').addEventListener('click', onChatThreadClick);

  // Theme
  $('themeToggle').addEventListener('click', toggleTheme);
  reflectTheme();

  // When the app returns to the foreground or regains network, refresh the auth token
  // (a backgrounded PWA lets it expire → requests would otherwise fall back to the anon
  // key and get denied) and re-sync, since the realtime socket may also have dropped.
  document.addEventListener('visibilitychange', () => { if(!document.hidden) refreshAndResync(); });
  window.addEventListener('online', refreshAndResync);

  startApp();
});

function startApp(){
  if(!initSupabase()){
    $('configBanner').hidden = false;
    showLogin();
    $('loginBtn').disabled = true;
    return;
  }
  // onAuthStateChange is the single source of truth: it fires immediately with the
  // stored session (or null), and again on sign in / sign out.
  sb.auth.onAuthStateChange((_event, s) => {
    session = s;
    if(s && s.user){
      if(enteredUserId !== s.user.id){ enteredUserId = s.user.id; enterApp(); }
    } else {
      enteredUserId = null;
      showLogin();
    }
  });
}

function switchView(view){
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => {
    const on = v.id === 'view-' + view;
    v.classList.toggle('active', on);
    v.hidden = !on;
  });
}

// Promise-based confirm using the shared <dialog>.
function confirmDialog(text, okLabel){
  return new Promise(resolve => {
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel || 'Ta bort';
    const dlg = $('confirmDialog');
    dlg.showModal();
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

// A shared table changed somewhere — refresh and repaint.
async function onRealtime(payload){
  const t = payload && payload.table;
  if(t === 'profiles') await loadProfiles();
  else if(t === 'calendar_events') await loadEvents();
  else if(t === 'tasks') await loadTasks();
  else if(t === 'credit_ledger'){ await loadLedger(); await loadBalances(); }
  else if(t === 'payout_requests') await loadPayouts();
  else if(t === 'task_templates') await loadTemplates();
  else if(t === 'event_suggestions') await loadSuggestions();
  else if(t === 'suggestion_votes') await loadVotes();
  else if(t === 'event_messages') await loadEventMessages();
  else if(t === 'todos') await loadTodos();
  renderCalendar();
  renderTasks();
  renderCredits();
  renderSuggestions();
  renderTodos();
  renderEventChat();
}

// Full reload + repaint, used when the app resumes and may have missed live updates.
async function resync(){
  if(!sb || !session) return;
  await Promise.all([loadProfiles(), loadEvents(), loadTasks(), loadBalances(), loadLedger(), loadPayouts(), loadTemplates(), loadSuggestions(), loadVotes(), loadEventMessages(), loadTodos()]);
  renderCalendar();
  renderTasks();
  renderCredits();
  renderSuggestions();
  renderTodos();
  renderEventChat();
}

// Ensure a fresh access token before re-syncing, so requests never fall back to anon.
async function refreshAndResync(){
  if(!sb) return;
  try{
    let { data } = await sb.auth.getSession();
    session = data.session || null;
    if(session && session.expires_at && (session.expires_at * 1000 - Date.now() < 60000)){
      const r = await sb.auth.refreshSession();
      session = r.data.session || session;
    }
  }catch(e){ console.warn('session refresh', e); }
  if(!session) return;   // onAuthStateChange will show the login screen if truly signed out
  try{ if(sb.realtime) sb.realtime.setAuth(session.access_token); }catch(e){}
  await resync();
  subscribeRealtime(onRealtime);
}
