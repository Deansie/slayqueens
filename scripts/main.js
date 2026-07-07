'use strict';
// Startup, event wiring, view routing, FAB, profile menu, and shared dialogs.

let currentView = 'calendar';

// Which "+" action the floating button performs per view (null = no button here).
const FAB_ACTIONS = {
  calendar:    { label: 'Ny händelse', run: () => openEventDialog(null) },
  todos:       { label: 'Att göra',    run: () => openTodoDialog() },
  tasks:       { label: 'Nytt jobb',   run: () => openJobDialog(null), parentOnly: true },
  suggestions: { label: 'Ny idé',      run: () => openSuggestionDialog() },
  matsedel:    { label: 'Önska',       run: () => openWishDialog() },
  budget:      null,
  credits:     null
};

document.addEventListener('DOMContentLoaded', () => {
  // Bottom nav
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchView(t.dataset.view)));

  // Floating add button
  $('fab').addEventListener('click', () => {
    const cfg = FAB_ACTIONS[currentView];
    if(cfg && cfg.run) cfg.run();
  });

  // Login / logout
  $('loginForm').addEventListener('submit', handleLogin);
  $('demoBtn').addEventListener('click', enterDemo);   // read-only showcase, no account needed

  // Profile menu (opens from the "me" pill)
  $('meChip').addEventListener('click', (e) => { e.stopPropagation(); toggleProfileMenu(); });
  $('profileMenu').addEventListener('click', onProfileMenuClick);
  document.addEventListener('click', (e) => {
    const m = $('profileMenu');
    if(!m || m.hidden) return;
    if(e.target.closest('#profileMenu') || e.target.closest('#meChip')) return;
    closeProfileMenu();
  });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeProfileMenu(); });

  // Weather location picker
  $('weather').addEventListener('click', openWeatherDialog);
  $('weatherForm').addEventListener('submit', (e) => e.preventDefault());   // Enter must not close the dialog
  $('wxSearch').addEventListener('input', onWeatherSearchInput);
  $('wxResults').addEventListener('click', onWeatherResultsClick);
  $('wxGeo').addEventListener('click', useMyLocation);
  $('wxOff').addEventListener('click', turnWeatherOff);
  $('wxCancel').addEventListener('click', () => $('weatherDialog').close());

  // Calendar
  $('catFilter').addEventListener('click', onCatFilterClick);
  $('eventForm').addEventListener('submit', (e) => {
    if(e.submitter && e.submitter.value === 'ok') saveEventFromDialog();
  });
  $('evCancel').addEventListener('click', () => $('eventDialog').close());
  $('evAllDay').addEventListener('change', toggleTime);

  // Tasks
  $('taskBoard').addEventListener('click', onTaskBoardClick);
  $('jobForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveJobFromDialog(); });
  $('jobCancel').addEventListener('click', () => $('jobDialog').close());
  $('rejectForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') confirmReject(); });
  $('rejectCancel').addEventListener('click', () => $('rejectDialog').close());

  // Credits
  $('creditsBody').addEventListener('click', onCreditsClick);
  $('adjustForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveAdjust(); });
  $('adjustCancel').addEventListener('click', () => $('adjustDialog').close());

  // Profile dialog
  $('profileSwatches').addEventListener('click', onSwatchClick);
  $('profileForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveProfile(); });
  $('profileCancel').addEventListener('click', () => $('profileDialog').close());
  $('pushBtn').addEventListener('click', togglePush);

  // Suggestions
  $('suggestionList').addEventListener('click', onSuggestionClick);
  $('suggestionForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveSuggestion(); });
  $('sgCancel').addEventListener('click', () => $('suggestionDialog').close());

  // Todos
  $('todoList').addEventListener('click', onTodoListClick);
  $('todoForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveTodo(); });
  $('todoCancel').addEventListener('click', () => $('todoDialog').close());

  // Matsedel
  $('matsedelBody').addEventListener('click', onMatsedelClick);
  $('mealForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveMeal(); });
  $('mealCancel').addEventListener('click', () => $('mealDialog').close());
  $('mealClear').addEventListener('click', clearMeal);
  $('mealDishPicks').addEventListener('click', onMealPickClick);
  $('mealWishPicks').addEventListener('click', onMealPickClick);
  $('mealDishList').addEventListener('click', onMealDishListClick);
  $('mealDishClose').addEventListener('click', () => $('mealDishDialog').close());
  $('addMealDish').addEventListener('click', addMealDish);
  $('wishForm').addEventListener('submit', (e) => { if(e.submitter && e.submitter.value === 'ok') saveWish(); });
  $('wishCancel').addEventListener('click', () => $('wishDialog').close());

  // Chat (events, jobs, suggestions)
  document.addEventListener('click', onChatOpenClick);   // delegated chat buttons on every card
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChatMessage(); });
  $('chatClose').addEventListener('click', () => $('chatDialog').close());
  $('chatThread').addEventListener('click', onChatThreadClick);
  $('chatThread').addEventListener('scroll', () => { chatAtBottom = chatNearBottom(); });
  $('chatFile').addEventListener('change', onChatFileChange);
  $('chatImageClear').addEventListener('click', clearChatImage);

  reflectTheme();

  // When the app returns to the foreground or regains network, refresh the auth token
  // (a backgrounded PWA lets it expire → requests would otherwise fall back to the anon
  // key and get denied) and re-sync, since the realtime socket may also have dropped.
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){ if(window.Budget) Budget.flush(); }
    else refreshAndResync();
  });
  window.addEventListener('pagehide', () => { if(window.Budget) Budget.flush(); });
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
      closeProfileMenu();
      showLogin();
    }
  });
}

function switchView(view){
  if(!view) return;
  currentView = view;
  closeProfileMenu();
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => {
    const on = v.id === 'view-' + view;
    v.classList.toggle('active', on);
    v.hidden = !on;
  });
  updateFab();
  if(view === 'budget' && window.Budget) Budget.load();
  window.scrollTo(0, 0);
}

function updateFab(){
  const fab = $('fab');
  if(!fab) return;
  const cfg = FAB_ACTIONS[currentView];
  const show = !!cfg && (!cfg.parentOnly || isParent());
  fab.hidden = !show;
  if(show) $('fabLabel').textContent = cfg.label;
}

// ---- profile menu ----
function openProfileMenu(){
  const m = $('profileMenu');
  if(!m) return;
  updateMenuBalance();
  m.hidden = false;
  $('meChip').setAttribute('aria-expanded', 'true');
}
function closeProfileMenu(){
  const m = $('profileMenu');
  if(m) m.hidden = true;
  const c = $('meChip');
  if(c) c.setAttribute('aria-expanded', 'false');
}
function toggleProfileMenu(){
  const m = $('profileMenu');
  if(!m) return;
  if(m.hidden) openProfileMenu(); else closeProfileMenu();
}
function updateMenuBalance(){
  const box = $('mpBal');
  if(!box) return;
  if(!isParent() && me){
    box.textContent = 'Ditt saldo: ' + fmtMoney(balanceOf(me.id));
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}
function onProfileMenuClick(e){
  const b = e.target.closest('[data-menu]');
  if(!b) return;
  const act = b.dataset.menu;
  closeProfileMenu();
  if(act === 'credits') switchView('credits');
  else if(act === 'budget') switchView('budget');
  else if(act === 'profile') openProfileDialog();
  else if(act === 'weather') openWeatherDialog();
  else if(act === 'theme') toggleTheme();
  else if(act === 'logout'){ unsubscribeRealtime(); signOut(); }
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
  if(t === 'budget'){ if(window.Budget) Budget.onExternalChange(payload); return; }
  if(t === 'profiles') await loadProfiles();
  else if(t === 'calendar_events') await loadEvents();
  else if(t === 'tasks') await loadTasks();
  else if(t === 'credit_ledger'){ await loadLedger(); await loadBalances(); }
  else if(t === 'payout_requests') await loadPayouts();
  else if(t === 'task_templates') await loadTemplates();
  else if(t === 'event_suggestions') await loadSuggestions();
  else if(t === 'suggestion_votes') await loadVotes();
  else if(t === 'messages') await loadMessages();
  else if(t === 'todos') await loadTodos();
  else if(t === 'meals') await loadMeals();
  else if(t === 'meal_dishes') await loadMealDishes();
  else if(t === 'meal_wishes') await loadMealWishes();
  renderCalendar();
  renderTasks();
  renderCredits();
  renderSuggestions();
  renderTodos();
  renderMatsedel();
  renderChat();
  if($('mealDishDialog').open) renderMealDishList();
}

// Full reload + repaint, used when the app resumes and may have missed live updates.
async function resync(){
  if(!sb || !session) return;
  await Promise.all([loadProfiles(), loadEvents(), loadTasks(), loadBalances(), loadLedger(), loadPayouts(), loadTemplates(), loadSuggestions(), loadVotes(), loadMessages(), loadTodos(), loadMeals(), loadMealDishes(), loadMealWishes()]);
  renderCalendar();
  renderTasks();
  renderCredits();
  renderSuggestions();
  renderTodos();
  renderMatsedel();
  renderChat();
  if(isParent() && window.Budget) Budget.load();
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
  initWeather();
  subscribeRealtime(onRealtime);
}
