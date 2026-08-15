'use strict';
// "Din profil": each person sets their own display name and colour (RLS allows editing
// your own row; the role guard only blocks role changes, so name/colour are fine).
let pickedColor = null;

function openProfileDialog(){
  if(!me) return;
  pickedColor = profileColor(me);
  renderSwatches();
  reflectPushState();
  if(isParent()) populateReminderControls();
  $('profileDialog').showModal();
}

// The household's daily cleaning-reminder time (parents only). Stored in app_settings and
// enforced server-side by the notify function; the app just edits the value here.
function populateReminderControls(){
  const sel = $('cleanRemHour');
  if(sel && !sel.options.length){
    let html = '';
    for(let h = 5; h <= 22; h++) html += `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`;
    sel.innerHTML = html;
  }
  const s = state.settings || {};
  $('cleanRemOn').checked = s.cleaning_reminder_enabled !== false;
  if(sel) sel.value = String(s.cleaning_reminder_hour != null ? s.cleaning_reminder_hour : 8);
  reflectReminderRow();
}

function reflectReminderRow(){
  const on = $('cleanRemOn').checked;
  const row = $('cleanRemRow');
  if(row) row.style.opacity = on ? '' : '.45';
  const sel = $('cleanRemHour');
  if(sel) sel.disabled = !on;
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
    if(isParent()) await saveReminderSettings();
    toast('ok', 'Färg sparad');
  }catch(err){
    console.warn('saveProfile', err);
    toast('warn', 'Kunde inte spara');
  }
}

// Persist the household cleaning-reminder setting (parents only). Non-blocking for the profile
// save — a failure here just warns.
async function saveReminderSettings(){
  const enabled = $('cleanRemOn').checked;
  const hour = Number($('cleanRemHour').value);
  try{
    const { error } = await sb.from('app_settings')
      .update({ cleaning_reminder_enabled: enabled, cleaning_reminder_hour: hour }).eq('id', true);
    if(error) throw error;
    state.settings = { ...state.settings, cleaning_reminder_enabled: enabled, cleaning_reminder_hour: hour };
  }catch(err){ console.warn('saveReminderSettings', err); toast('warn', 'Kunde inte spara påminnelsetid'); }
}
