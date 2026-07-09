'use strict';
// Login screen, session entry, and role gating.
let enteredUserId = null;   // guards against re-entering on token refresh

function showLogin(){ $('appScreen').hidden = true;  $('loginScreen').hidden = false; }
function showApp(){   $('loginScreen').hidden = true; $('appScreen').hidden = false;  }

async function handleLogin(e){
  e.preventDefault();
  $('loginError').textContent = '';
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'Loggar in…';
  try{
    await signIn(email, password);   // onAuthStateChange drives the rest
  }catch(err){
    console.warn('login', err);
    $('loginError').textContent = 'Fel e-post eller lösenord.';
  }finally{
    btn.disabled = false; btn.textContent = 'Logga in';
  }
}

function applyRole(){
  document.body.classList.toggle('is-parent', isParent());
  document.body.classList.toggle('is-kid', !isParent());
}

// Called once a valid session exists: load data, wire realtime, show the app.
async function enterApp(){
  try{
    await loadMe();
    if(!me){ toast('warn', 'Kontot saknar en profil'); await signOut(); return; }
    applyRole();
    const av = $('meAvatar');
    if(av){ av.textContent = initialOf(me.name); av.style.background = profileColor(me); }
    $('meName').textContent = capital(me.name);
    const demoBar = $('demoBanner');
    if(demoBar) demoBar.hidden = !isDemo();
    await Promise.all([loadProfiles(), loadEvents(), loadTasks(), loadBalances(), loadLedger(), loadPayouts(), loadTemplates(), loadSuggestions(), loadVotes(), loadMessages(), loadTodos(), loadMeals(), loadMealDishes(), loadMealWishes(), loadShopTopics(), loadShopItems()]);
    renderHeader();
    renderCalendar();
    renderTasks();
    renderCredits();
    renderSuggestions();
    renderTodos();
    renderShopping();
    renderMatsedel();
    if(isParent() && window.Budget){ Budget.init(); Budget.load(); }
    subscribeRealtime(onRealtime);
    initPush();
    initWeather();
    showApp();
    switchView('calendar');
  }catch(err){
    console.warn('enterApp', err);
    toast('warn', 'Kunde inte ladda appen');
  }
}

// Read-only showcase: load bundled fixtures into state and render, without ever touching
// Supabase. Writes still route through sb (unauthenticated → denied) and surface the demo
// toast; nothing can change the real database.
function enterDemo(){
  session = null;
  Object.assign(state, DEMO_DATA.state);
  state.profilesById = {};
  for(const p of state.profiles) state.profilesById[p.id] = p;
  me = state.profilesById[DEMO_DATA.meId];
  me.is_demo = true;
  applyRole();
  const av = $('meAvatar');
  if(av){ av.textContent = initialOf(me.name); av.style.background = profileColor(me); }
  $('meName').textContent = capital(me.name);
  const demoBar = $('demoBanner');
  if(demoBar) demoBar.hidden = false;
  renderHeader();
  renderCalendar();
  renderTasks();
  renderCredits();
  renderSuggestions();
  renderTodos();
  renderShopping();
  renderMatsedel();
  if(window.Budget){ Budget.init(); Budget.load(); }
  initWeather();
  showApp();
  switchView('calendar');
  $('loginEmail').value = ''; $('loginPassword').value = '';
}
