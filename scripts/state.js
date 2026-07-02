'use strict';
// In-memory copy of the shared data, plus realtime subscriptions.
const state = { profiles: [], profilesById: {}, events: [], tasks: [], balances: [], ledger: [] };

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

// Live updates: re-fetch + re-render whenever the shared tables change on any device.
let realtimeChannel = null;
function subscribeRealtime(onChange){
  unsubscribeRealtime();
  realtimeChannel = sb.channel('slayqueens-db')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_ledger' }, onChange)
    .subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}
