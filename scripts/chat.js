'use strict';
// One comment thread system reused for calendar events, jobs and suggestions. A thread is
// identified by (context, parentId); messages live in the unified `messages` table and
// inherit the parent's visibility via RLS (private-event threads stay hidden). Optional
// image attachments are downscaled hard in the browser and stored in the 'chat' Storage
// bucket — only a short path is kept on the row, so the DB and realtime stay lean.

const CHAT_IMG_MAX = 800;        // longest side in px after downscale
const CHAT_IMG_QUALITY = 0.6;    // JPEG quality

let chatContext = null;          // 'event' | 'task' | 'suggestion'
let chatParentId = null;
let chatImageBlob = null;        // pending (already downscaled) attachment, if any

function messagesFor(context, parentId){
  return (state.messages || [])
    .filter(m => m.context === context && m.parent_id === parentId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function chatCountFor(context, parentId){
  return (state.messages || []).filter(m => m.context === context && m.parent_id === parentId).length;
}
// small 💬 button (with count) reused on every card/row
function chatButton(context, parentId){
  const n = chatCountFor(context, parentId);
  return `<button class="ev-chat" data-chatopen="${context}:${parentId}" type="button" aria-label="Kommentarer">💬${n ? `<span class="ev-chat-n">${n}</span>` : ''}</button>`;
}

function chatImageUrl(path){
  return sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
}

// Delegated on document: any 💬 button carries data-chatopen="context:parentId".
function onChatOpenClick(e){
  const b = e.target.closest('[data-chatopen]');
  if(!b) return;
  const sep = b.dataset.chatopen.indexOf(':');
  const context = b.dataset.chatopen.slice(0, sep);
  const parentId = b.dataset.chatopen.slice(sep + 1);
  openChat(context, parentId, chatTitleFor(context, parentId));
}

function chatTitleFor(context, parentId){
  const row = context === 'event'      ? (state.events || []).find(e => e.id === parentId)
            : context === 'task'       ? (state.tasks || []).find(t => t.id === parentId)
            : context === 'suggestion' ? (state.suggestions || []).find(s => s.id === parentId)
            : null;
  return row ? row.title : 'Kommentarer';
}

function openChat(context, parentId, titleText){
  chatContext = context;
  chatParentId = parentId;
  clearChatImage();
  $('chatTitle').textContent = titleText || 'Kommentarer';
  $('chatDialog').showModal();          // open before painting — renderChat skips a closed dialog
  renderChat();
  $('chatInput').focus();
}

function renderChat(){
  const dlg = $('chatDialog');
  if(!dlg || !dlg.open || !chatContext) return;      // only paint the open thread
  const thread = $('chatThread');
  const msgs = messagesFor(chatContext, chatParentId);
  if(!msgs.length){
    thread.innerHTML = '<div class="chat-empty">Inga kommentarer än. Skriv den första!</div>';
    return;
  }
  thread.innerHTML = msgs.map(m => {
    const a = state.profilesById[m.author_id];
    const mine = me && m.author_id === me.id;
    const canDelete = mine || isParent();
    const img = m.image_path
      ? `<a class="msg-img-link" href="${escapeHtml(chatImageUrl(m.image_path))}" target="_blank" rel="noopener"><img class="msg-img" src="${escapeHtml(chatImageUrl(m.image_path))}" alt="Bild" loading="lazy" /></a>`
      : '';
    const text = m.body ? `<div class="msg-body">${escapeHtml(m.body)}</div>` : '';
    return `
      <div class="msg${mine ? ' mine' : ''}">
        <div class="msg-head">
          <span class="dot" style="background:${a ? profileColor(a) : 'var(--faint)'}"></span>
          ${escapeHtml(a ? capital(a.name) : '—')}
          <span class="msg-time">${escapeHtml(fmtWhen(m.created_at))} ${escapeHtml(fmtTime(m.created_at))}</span>
          ${canDelete ? `<button class="msg-del" data-delmsg="${m.id}" type="button" aria-label="Ta bort">✕</button>` : ''}
        </div>
        ${text}
        ${img}
      </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

// The three list views show comment counts, so refresh them after a thread changes.
function renderChatCounts(){
  renderCalendar();
  renderTasks();
  renderSuggestions();
}

async function sendChatMessage(){
  if(!chatContext || !chatParentId) return;
  const input = $('chatInput');
  const body = input.value.trim();
  if(!body && !chatImageBlob) return;              // nothing to send
  const pendingBlob = chatImageBlob;
  input.value = '';
  clearChatImage();
  try{
    let image_path = null;
    if(pendingBlob) image_path = await uploadChatImage(pendingBlob);
    const { error } = await sb.from('messages').insert({
      context: chatContext, parent_id: chatParentId, author_id: me.id,
      body: body || null, image_path
    });
    if(error) throw error;
    await loadMessages();
    renderChat();
    renderChatCounts();
    notify('message', { context: chatContext, parentId: chatParentId });
  }catch(err){
    console.warn('sendChatMessage', err);
    toast('warn', 'Kunde inte skicka');
    if(body) input.value = body;                   // give the text back (image must be re-picked)
  }
}

function onChatThreadClick(e){
  const del = e.target.closest('[data-delmsg]');
  if(del) deleteChatMessage(del.dataset.delmsg);
}

async function deleteChatMessage(id){
  const m = (state.messages || []).find(x => x.id === id);
  try{
    const { error } = await sb.from('messages').delete().eq('id', id);
    if(error) throw error;
    if(m && m.image_path){
      try{ await sb.storage.from('chat').remove([m.image_path]); }catch(e){ console.warn('img remove', e); }
    }
    await loadMessages();
    renderChat();
    renderChatCounts();
  }catch(err){
    console.warn('deleteChatMessage', err);
    toast('warn', 'Kunde inte ta bort');
  }
}

// ---- image attachment ----
function onChatFileChange(e){
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                               // allow re-picking the same file
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('warn', 'Välj en bild'); return; }
  downscaleImage(file, CHAT_IMG_MAX, CHAT_IMG_QUALITY)
    .then(blob => {
      chatImageBlob = blob;
      const img = $('chatPreviewImg');
      if(img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      $('chatPreview').hidden = false;
    })
    .catch(err => { console.warn('downscale', err); toast('warn', 'Kunde inte läsa bilden'); });
}

function clearChatImage(){
  chatImageBlob = null;
  const img = $('chatPreviewImg');
  if(img && img.src){ URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
  const box = $('chatPreview');
  if(box) box.hidden = true;
}

// Draw the picture onto a canvas at reduced size and re-encode as a low-quality JPEG.
function downscaleImage(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('image load failed')); };
    img.src = URL.createObjectURL(file);
  });
}

async function uploadChatImage(blob){
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('chat').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if(error) throw error;
  return path;
}
