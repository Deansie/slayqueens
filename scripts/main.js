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

  // Theme
  $('themeToggle').addEventListener('click', toggleTheme);
  reflectTheme();

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
    if(okLabel) $('confirmOk').textContent = okLabel;
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
  renderCalendar();
  renderTasks();
  renderCredits();
}
