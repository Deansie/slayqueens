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

function isParent(){ return !!(me && me.role === 'parent'); }
// The read-only showcase account. The DB enforces read-only; this just drives the UI.
function isDemo(){ return !!(me && me.is_demo); }
