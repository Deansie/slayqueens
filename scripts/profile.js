'use strict';
// "Din profil": each person sets their own display name and colour (RLS allows editing
// your own row; the role guard only blocks role changes, so name/colour are fine).
let pickedColor = null;

function openProfileDialog(){
  if(!me) return;
  pickedColor = profileColor(me);
  renderSwatches();
  reflectPushState();
  $('profileDialog').showModal();
}

function renderSwatches(){
  $('profileSwatches').innerHTML = PALETTE.map(c =>
    `<button type="button" class="swatch${c === pickedColor ? ' active' : ''}" data-color="${c}" style="background:${c}" aria-label="Färg"></button>`
  ).join('');
}

function onSwatchClick(e){
  const b = e.target.closest('[data-color]');
  if(!b) return;
  pickedColor = b.dataset.color;
  renderSwatches();
}

async function saveProfile(){
  try{
    const { error } = await sb.from('profiles').update({ color: pickedColor }).eq('id', me.id);
    if(error) throw error;
    me.color = pickedColor;
    const av = $('meAvatar');
    if(av) av.style.background = profileColor(me);
    await loadProfiles();
    renderCalendar(); renderTasks(); renderCredits(); renderSuggestions(); renderTodos();
    toast('ok', 'Färg sparad');
  }catch(err){
    console.warn('saveProfile', err);
    toast('warn', 'Kunde inte spara');
  }
}
