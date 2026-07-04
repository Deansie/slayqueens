'use strict';
// In-memory copy of the shared data, plus realtime subscriptions.
const state = { profiles: [], profilesById: {}, events: [], tasks: [], balances: [], ledger: [], payouts: [], templates: [], suggestions: [], votes: [], eventMessages: [], todos: [] };

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

async function loadEventMessages(){
  const { data, error } = await sb.from('event_messages').select('*').order('created_at');
  if(error){ console.warn('loadEventMessages', error); return; }
  state.eventMessages = data || [];
}

async function loadTodos(){
  const { data, error } = await sb.from('todos').select('*').order('created_at');
  if(error){ console.warn('loadTodos', error); return; }
  state.todos = data || [];
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, onChange)
    .subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}
