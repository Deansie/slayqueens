'use strict';
// A bottom sheet for "what do you want to do with this?": tap an event or a shopping item and
// its details + actions open here instead of every row carrying its own buttons. One shared
// <dialog id="sheetDialog">. Any element with data-sh="name" closes the sheet and calls the
// handler given to openSheet(html, handler) as handler(name, element).

let sheetHandler = null;

function openSheet(html, handler){
  sheetHandler = handler || null;
  $('sheetBody').innerHTML = html;
  const dlg = $('sheetDialog');
  if(!dlg.open) dlg.showModal();
}
function closeSheet(){
  const dlg = $('sheetDialog');
  if(dlg.open) dlg.close();
}

function initSheet(){
  const dlg = $('sheetDialog');
  dlg.addEventListener('click', (e) => {
    if(e.target === dlg){ closeSheet(); return; }          // tap on the dimmed backdrop
    const b = e.target.closest('[data-sh]');
    if(!b) return;
    const h = sheetHandler;
    closeSheet();
    if(h) h(b.dataset.sh, b);
  });
  dlg.addEventListener('close', () => { sheetHandler = null; });
}
