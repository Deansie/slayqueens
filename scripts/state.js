'use strict';
// In-memory copy of the shared data, plus realtime subscriptions.
const state = { profiles: [], profilesById: {}, events: [], tasks: [], balances: [], ledger: [], payouts: [], templates: [], suggestions: [], votes: [], messages: [], todos: [], meals: [], mealDishes: [], mealWishes: [], shopTopics: [], shopItems: [], behaviors: [], markLedger: [], markBalances: [], markRequests: [] };

async function loadProfiles(){
  const { data, error } = await sb.from('profiles').select('*').order('name');
  if(error){ console.warn('loadProfiles', error); return; }
  state.profiles = data || [];
  state.profilesById = {};
  for(const p of state.profiles) state.profilesById[p.id] = p;
}

async function loadEvents(){
  const { data, error } = await sb.from('calendar_events').select('*').order('starts_at');
  if(error){ console.warn('loadEvents', error); return; }
  state.events = data || [];
}

async function loadTasks(){
  const { data, error } = await sb.from('tasks').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadTasks', error); return; }
  state.tasks = data || [];
}

async function loadBalances(){
  const { data, error } = await sb.from('balances').select('*');
  if(error){ console.warn('loadBalances', error); return; }
  state.balances = data || [];
}

async function loadLedger(){
  const { data, error } = await sb.from('credit_ledger').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadLedger', error); return; }
  state.ledger = data || [];
}

async function loadPayouts(){
  const { data, error } = await sb.from('payout_requests').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadPayouts', error); return; }
  state.payouts = data || [];
}

async function loadTemplates(){
  const { data, error } = await sb.from('task_templates').select('*').order('title');
  if(error){ console.warn('loadTemplates', error); return; }
  state.templates = data || [];
}

async function loadSuggestions(){
  const { data, error } = await sb.from('event_suggestions').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadSuggestions', error); return; }
  state.suggestions = data || [];
}

async function loadVotes(){
  const { data, error } = await sb.from('suggestion_votes').select('*');
  if(error){ console.warn('loadVotes', error); return; }
  state.votes = data || [];
}

async function loadMessages(){
  const { data, error } = await sb.from('messages').select('*').order('created_at');
  if(error){ console.warn('loadMessages', error); return; }
  state.messages = data || [];
}

async function loadTodos(){
  const { data, error } = await sb.from('todos').select('*').order('created_at');
  if(error){ console.warn('loadTodos', error); return; }
  state.todos = data || [];
}

async function loadMeals(){
  const { data, error } = await sb.from('meals').select('*').order('date');
  if(error){ console.warn('loadMeals', error); return; }
  state.meals = data || [];
}

async function loadMealDishes(){
  const { data, error } = await sb.from('meal_dishes').select('*').order('title');
  if(error){ console.warn('loadMealDishes', error); return; }
  state.mealDishes = data || [];
}

async function loadMealWishes(){
  const { data, error } = await sb.from('meal_wishes').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadMealWishes', error); return; }
  state.mealWishes = data || [];
}

async function loadShopTopics(){
  const { data, error } = await sb.from('shopping_topics').select('*').order('created_at');
  if(error){ console.warn('loadShopTopics', error); return; }
  state.shopTopics = data || [];
}

async function loadShopItems(){
  const { data, error } = await sb.from('shopping_items').select('*').order('created_at');
  if(error){ console.warn('loadShopItems', error); return; }
  state.shopItems = data || [];
}

async function loadBehaviors(){
  const { data, error } = await sb.from('behaviors').select('*').order('sort').order('created_at');
  if(error){ console.warn('loadBehaviors', error); return; }
  state.behaviors = data || [];
}

async function loadMarkLedger(){
  const { data, error } = await sb.from('mark_ledger').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadMarkLedger', error); return; }
  state.markLedger = data || [];
}

async function loadMarkBalances(){
  const { data, error } = await sb.from('mark_balances').select('*');
  if(error){ console.warn('loadMarkBalances', error); return; }
  state.markBalances = data || [];
}

async function loadMarkRequests(){
  const { data, error } = await sb.from('mark_requests').select('*').order('created_at', { ascending: false });
  if(error){ console.warn('loadMarkRequests', error); return; }
  state.markRequests = data || [];
}

// Live updates: re-fetch + re-render whenever the shared tables change on any device.
let realtimeChannel = null;
function subscribeRealtime(onChange){
  unsubscribeRealtime();
  // authenticate the realtime socket as the logged-in user so RLS lets row changes through
  try{ if(session && sb.realtime) sb.realtime.setAuth(session.access_token); }catch(e){ console.warn('realtime setAuth', e); }
  realtimeChannel = sb.channel('slayqueens-db')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_ledger' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_requests' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_templates' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_suggestions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'suggestion_votes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_dishes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_wishes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_topics' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'behaviors' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mark_ledger' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mark_requests' }, onChange)
    .subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}
