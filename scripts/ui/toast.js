'use strict';
// Lightweight toast: toast('ok'|'warn'|'', message). Tap to dismiss.
// In the read-only demo, a blocked write comes back as a generic "Kunde inte …" warning (the
// DB rejects it). Rewrite those to a clear demo message. Genuinely client-side failures
// (image read, geolocation, initial load) keep their own text.
const DEMO_KEEP = new Set(['Kunde inte läsa bilden', 'Kunde inte hämta plats', 'Kunde inte ladda appen']);

function toast(kind, msg, ms){
  const wrap = $('toasts');
  if(!wrap) return;
  if(kind === 'warn' && typeof isDemo === 'function' && isDemo()
     && /^(Kunde inte|Något gick fel)/.test(msg) && !DEMO_KEEP.has(msg)){
    kind = ''; msg = 'Detta är en demo, inget sparas';
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const timer = setTimeout(close, ms || 2600);
  function close(){
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }
  el.addEventListener('click', close);
}

// Toast with an inline action button (e.g. "Ångra"). Stays up a bit longer.
function toastAction(msg, actionLabel, onAction, ms){
  const wrap = $('toasts');
  if(!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span'); span.textContent = msg;
  const btn = document.createElement('button'); btn.className = 'toast-action'; btn.type = 'button'; btn.textContent = actionLabel;
  el.append(span, btn);
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const timer = setTimeout(close, ms || 5000);
  function close(){
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); close(); try{ onAction(); }catch(err){ console.warn('toast action', err); } });
  el.addEventListener('click', close);
}
