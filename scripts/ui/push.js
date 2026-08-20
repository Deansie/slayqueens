'use strict';
// Web push: register the service worker, ask permission, store the subscription, and
// trigger the notify edge function after actions. iOS only delivers these to the
// installed (Add to Home Screen) PWA.

async function initPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try{ await navigator.serviceWorker.register('sw.js'); }
  catch(e){ console.warn('SW register', e); }
  reflectPushState();
}

async function reflectPushState(){
  const btn = $('pushBtn');
  if(!btn) return;
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined'){
    btn.textContent = 'Stöds inte här'; btn.disabled = true; return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const on = Notification.permission === 'granted' && !!sub;
  btn.dataset.on = on ? '1' : '0';
  btn.textContent = on ? '🔔 På' : '🔕 Av';
}

async function enablePush(){
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ toast('warn', 'Notiser nekades'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY)
      });
    }
    const keys = sub.toJSON().keys;
    const { error } = await sb.from('push_subscriptions').upsert(
      { profile_id: me.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'endpoint' }
    );
    if(error) throw error;
    toast('ok', 'Notiser på');
    reflectPushState();
  }catch(err){ console.warn('enablePush', err); toast('warn', 'Kunde inte slå på notiser'); }
}

async function disablePush(){
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if(sub){
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    toast('ok', 'Notiser av');
    reflectPushState();
  }catch(err){ console.warn('disablePush', err); toast('warn', 'Kunde inte stänga av notiser'); }
}

function togglePush(){
  const btn = $('pushBtn');
  if(btn && btn.dataset.on === '1') disablePush(); else enablePush();
}

// Fire-and-forget: ask the edge function to send a push. `ref` is either a task id
// (back-compat with the original job notifications) or an object with the ids a given
// type needs, e.g. notify('message', { context, parentId }) or notify('recalled', { taskId, toProfile }).
async function notify(type, ref){
  const body = (ref && typeof ref === 'object') ? { type, ...ref } : { type, taskId: ref };
  try{ await sb.functions.invoke('notify', { body }); }
  catch(e){ console.warn('notify', e); }
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
