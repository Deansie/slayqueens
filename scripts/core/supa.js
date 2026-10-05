'use strict';
// Supabase client + auth/session helpers. supabase-js loads as a UMD global from the CDN.
let sb = null;       // Supabase client
let session = null;  // current auth session
let me = null;       // current profile: { id, name, role, color }

function initSupabase(){
  if(typeof supabase === 'undefined') return false;   // CDN failed to load (offline?)
  if(!isConfigured()) return false;                    // config.js still has placeholders
  sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return true;
}

async function loadMe(){
  if(!session){ me = null; return null; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if(error) console.warn('loadMe', error);
  me = data || null;
  return me;
}

async function signIn(email, password){
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error) throw error;
}

async function signOut(){
  try{ await sb.auth.signOut(); }catch(e){ console.warn('signOut', e); }
  session = null; me = null;
}

// ---- demo: never talk to the backend ----
// Entering the demo swaps `sb` for this stand-in. Every query, insert, update, delete, RPC,
// upload and push resolves locally with an error (so screens show "Detta är en demo, inget
// sparas" and keep the bundled fixtures), and nothing ever leaves the device. Logging out of
// the demo reloads the page, which brings the real client back.
const DEMO_ERROR = { message: 'demo: read-only showcase', code: 'demo' };
function demoClient(){
  const result = Promise.resolve({ data: null, error: DEMO_ERROR, count: null });
  const chain = () => new Proxy(function(){}, {
    get(_t, prop){
      if(prop === 'then') return result.then.bind(result);
      if(prop === 'catch') return result.catch.bind(result);
      if(prop === 'finally') return result.finally.bind(result);
      return () => chain();                         // .select().eq().order()… all chain
    },
    apply(){ return chain(); }
  });
  const channel = { on(){ return channel; }, subscribe(){ return channel; }, unsubscribe(){} };
  return {
    from: () => chain(),
    rpc: () => chain(),
    functions: { invoke: () => chain() },
    storage: { from: () => ({ upload: () => chain(), remove: () => chain(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    channel: () => channel,
    removeChannel(){},
    realtime: { setAuth(){} },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => { location.reload(); return { error: null }; },
      signInWithPassword: async () => ({ error: DEMO_ERROR }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } })
    }
  };
}
// Call first in any add / tick / delete action: in the demo it explains and stops.
function demoBlock(){
  if(!isDemo()) return false;
  toast('', 'Detta är en demo, inget sparas');
  return true;
}

function isParent(){ return !!(me && me.role === 'parent'); }
// The read-only showcase account. The DB enforces read-only; this just drives the UI.
function isDemo(){ return !!(me && me.is_demo); }
