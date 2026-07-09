'use strict';
// One comment thread system reused for calendar events, jobs, suggestions and shopping
// categories. A thread is identified by (context, parentId); messages live in the unified
// `messages` table and
// inherit the parent's visibility via RLS (private-event threads stay hidden). Optional
// image attachments are downscaled hard in the browser and stored in the 'chat' Storage
// bucket — only a short path is kept on the row, so the DB and realtime stay lean.

const CHAT_IMG_MAX = 800;        // longest side in px after downscale
const CHAT_IMG_QUALITY = 0.6;    // JPEG quality

let chatContext = null;          // 'event' | 'task' | 'suggestion' | 'shopping'
let chatParentId = null;
let chatImageBlob = null;        // pending (already downscaled) attachment, if any
let chatAtBottom = true;         // true while the thread is pinned to the newest message

function messagesFor(context, parentId){
  return (state.messages || [])
    .filter(m => m.context === context && m.parent_id === parentId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function chatCountFor(context, parentId){
  return (state.messages || []).filter(m => m.context === context && m.parent_id === parentId).length;
}
// small chat button (bubble + count) reused on every card/row
function chatButton(context, parentId){
  const n = chatCountFor(context, parentId);
  const bubble = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.1A7.5 7.5 0 1 1 20 11.5z"/></svg>';
  return `<button class="ev-chat" data-chatopen="${context}:${parentId}" type="button" aria-label="Kommentarer">${bubble}${n ? `<span class="n">${n}</span>` : ''}</button>`;
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
  if(context === 'shopping'){
    const t = (state.shopTopics || []).find(x => x.id === parentId);
    return t ? `${t.emoji ? t.emoji + ' ' : ''}${t.title}` : 'Kommentarer';
  }
  const row = context === 'event'      ? (state.events || []).find(e => e.id === parentId)
            : context === 'task'       ? (state.tasks || []).find(t => t.id === parentId)
            : context === 'suggestion' ? (state.suggestions || []).find(s => s.id === parentId)
            : null;
  return row ? row.title : 'Kommentarer';
}

function openChat(context, parentId, titleText){
  chatContext = context;
  chatParentId = parentId;
  chatAtBottom = true;                   // a freshly opened thread starts pinned to the newest message
  clearChatImage();
  $('chatTitle').textContent = titleText || 'Kommentarer';
  $('chatDialog').showModal();          // open before painting — renderChat skips a closed dialog
  renderChat();
  // Deliberately no auto-focus: on iOS focusing the input inside this tap gesture pops the
  // keyboard immediately. The user taps the field when they actually want to type.
  const ln = latestNotisMessage();
  if(ln && ln.context === context && ln.parent_id === parentId) dismissNotis(ln.id);
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
  // Pin to the newest message. Do it after layout (rAF), and again as each image loads —
  // images arrive late and grow the thread, which would otherwise leave us above the bottom.
  if(chatAtBottom){
    requestAnimationFrame(scrollChatToBottom);
    thread.querySelectorAll('img').forEach(img => {
      if(!img.complete) img.addEventListener('load', () => { if(chatAtBottom) scrollChatToBottom(); }, { once: true });
    });
  }
}

function scrollChatToBottom(){
  const t = $('chatThread');
  if(t) t.scrollTop = t.scrollHeight;
}
function chatNearBottom(){
  const t = $('chatThread');
  if(!t) return true;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 60;
}

// The three list views show comment counts, so refresh them after a thread changes.
function renderChatCounts(){
  renderCalendar();
  renderTasks();
  renderSuggestions();
  renderShopping();
}

async function sendChatMessage(){
  if(!chatContext || !chatParentId) return;
  // guard here (not just via the DB) so a demo image isn't uploaded to Storage before the
  // blocked message insert
  if(isDemo()){ toast('', 'Detta är en demo, inget sparas'); return; }
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
    chatAtBottom = true;                 // jump to my just-sent message
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

// ---- "Ny kommentar" bar on the calendar ------------------------------
// A dismissible banner at the top of the calendar pointing at the newest comment posted by
// someone else. Tapping it opens that thread; the ✕ just dismisses. Which message has been
// seen is remembered per device, so a newer comment brings the bar back on its own.
const NOTIS_SEEN_KEY = 'slayqueens_notis_seen';

function threadExists(context, parentId){
  return context === 'event'      ? (state.events || []).some(e => e.id === parentId)
       : context === 'task'       ? (state.tasks || []).some(t => t.id === parentId)
       : context === 'suggestion' ? (state.suggestions || []).some(s => s.id === parentId)
       : context === 'shopping'   ? (state.shopTopics || []).some(t => t.id === parentId)
       : false;
}
// newest message from someone else, on a thread that still exists (and is visible to me)
function latestNotisMessage(){
  let best = null;
  for(const m of (state.messages || [])){
    if(me && m.author_id === me.id) continue;
    if(!threadExists(m.context, m.parent_id)) continue;
    if(!best || new Date(m.created_at) > new Date(best.created_at)) best = m;
  }
  return best;
}
function getNotisSeen(){ try{ return localStorage.getItem(NOTIS_SEEN_KEY) || ''; }catch(e){ return ''; } }
function dismissNotis(id){ try{ localStorage.setItem(NOTIS_SEEN_KEY, id); }catch(e){} renderNotisBar(); }

function renderNotisBar(){
  const bar = $('notisBar');
  if(!bar) return;
  const m = me ? latestNotisMessage() : null;
  if(!m || m.id === getNotisSeen()){ bar.innerHTML = ''; bar.hidden = true; return; }
  const author = state.profilesById[m.author_id];
  const title = chatTitleFor(m.context, m.parent_id);
  const preview = m.body ? m.body : (m.image_path ? '📷 Bild' : '');
  bar.hidden = false;
  bar.innerHTML =
    `<button class="notis" type="button">
       <span class="notis-ico" aria-hidden="true">💬</span>
       <span class="notis-text"><b>${escapeHtml(author ? capital(author.name) : 'Någon')}</b> skrev i ”${escapeHtml(title)}”${preview ? ` · <span class="notis-preview">${escapeHtml(preview)}</span>` : ''}</span>
       <span class="notis-x" data-dismiss aria-label="Stäng">✕</span>
     </button>`;
  bar.querySelector('.notis').onclick = (e) => {
    if(e.target.closest('[data-dismiss]')){ dismissNotis(m.id); return; }
    dismissNotis(m.id);
    openChat(m.context, m.parent_id, title);
  };
}
