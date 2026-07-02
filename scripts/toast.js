'use strict';
// Lightweight toast: toast('ok'|'warn'|'', message). Tap to dismiss.
function toast(kind, msg, ms){
  const wrap = $('toasts');
  if(!wrap) return;
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
