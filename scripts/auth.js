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
    $('meName').textContent = capital(me.name);
    $('meDot').style.background = profileColor(me);
    await Promise.all([loadProfiles(), loadEvents(), loadTasks(), loadBalances(), loadLedger(), loadPayouts(), loadTemplates(), loadSuggestions(), loadVotes(), loadEventMessages(), loadTodos()]);
    renderCalendar();
    renderTasks();
    renderCredits();
    renderSuggestions();
    renderTodos();
    subscribeRealtime(onRealtime);
    initPush();
    showApp();
    switchView('calendar');
  }catch(err){
    console.warn('enterApp', err);
    toast('warn', 'Kunde inte ladda appen');
  }
}
