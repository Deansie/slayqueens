'use strict';
// Förslag: anyone proposes an outing; the family votes 👍/👎; parents can promote a
// favourite into a real calendar event. Votes are managed directly (RLS: own row only).

function votesFor(suggestionId){
  const rows = (state.votes || []).filter(v => v.suggestion_id === suggestionId);
  const up = rows.filter(v => v.vote === 1).length;
  const down = rows.filter(v => v.vote === -1).length;
  const mine = me ? ((rows.find(v => v.profile_id === me.id) || {}).vote || 0) : 0;
  return { up, down, mine };
}

// The people behind a given vote direction (1 = 👍, -1 = 👎), as profile objects.
function votersFor(suggestionId, vote){
  return (state.votes || [])
    .filter(v => v.suggestion_id === suggestionId && v.vote === vote)
    .map(v => state.profilesById[v.profile_id])
    .filter(Boolean);
}

function renderSuggestions(){
  const box = $('suggestionList');
  if(!box || !me) return;
  const list = (state.suggestions || []).slice();
  const score = {};
  for(const s of list){ const v = votesFor(s.id); score[s.id] = v.up - v.down; }
  list.sort((a, b) => (score[b.id] - score[a.id]) || (new Date(b.created_at) - new Date(a.created_at)));

  if(!list.length){
    box.innerHTML = '<div class="placeholder"><div class="ph-emoji">💡</div><h3>Inga förslag än</h3><p>Föreslå något kul att göra tillsammans!</p></div>';
    return;
  }
  box.innerHTML = '';
  for(const s of list) box.appendChild(suggestionCard(s));
}

function suggestionCard(s){
  const by = state.profilesById[s.created_by];
  const { up, down, mine } = votesFor(s.id);
  const canDelete = (me && s.created_by === me.id) || isParent();
  const voterLine = (emoji, list) => list.length
    ? `<div class="voter-line"><span class="voter-emoji">${emoji}</span>${list.map(p =>
        `<span class="voter-chip"><span class="dot" style="background:${profileColor(p)}"></span>${escapeHtml(capital(p.name))}</span>`).join('')}</div>`
    : '';
  const voters = voterLine('👍', votersFor(s.id, 1)) + voterLine('👎', votersFor(s.id, -1));
  const el = document.createElement('div');
  el.className = 'suggestion';
  el.innerHTML = `
    <div class="sg-title">${escapeHtml(s.title)}</div>
    ${s.notes ? `<div class="sg-notes">${escapeHtml(s.notes)}</div>` : ''}
    <div class="sg-foot">
      <div class="vote-row">
        <button class="vote up${mine === 1 ? ' on' : ''}" data-vote="1" data-id="${s.id}" type="button">👍 ${up}</button>
        <button class="vote down${mine === -1 ? ' on' : ''}" data-vote="-1" data-id="${s.id}" type="button">👎 ${down}</button>
        <span class="sg-by">av ${escapeHtml(by ? capital(by.name) : '—')} · ${escapeHtml(fmtWhen(s.created_at))}</span>
      </div>
      <div class="sg-actions">
        ${chatButton('suggestion', s.id)}
        ${isParent() ? `<button class="btn ghost sm" data-promote="${s.id}" type="button">Lägg i kalender</button>` : ''}
        ${canDelete ? `<button class="icon-btn" data-delsg="${s.id}" aria-label="Ta bort">🗑</button>` : ''}
      </div>
    </div>
    ${voters ? `<div class="sg-voters">${voters}</div>` : ''}`;
  return el;
}

function onSuggestionClick(e){
  const voteBtn = e.target.closest('[data-vote]');
  if(voteBtn){ castVote(voteBtn.dataset.id, Number(voteBtn.dataset.vote)); return; }
  const promoteBtn = e.target.closest('[data-promote]');
  if(promoteBtn){ promoteSuggestion((state.suggestions || []).find(s => s.id === promoteBtn.dataset.promote)); return; }
  const delBtn = e.target.closest('[data-delsg]');
  if(delBtn){ deleteSuggestion((state.suggestions || []).find(s => s.id === delBtn.dataset.delsg)); }
}

async function castVote(id, vote){
  try{
    let error;
    if(votesFor(id).mine === vote){
      ({ error } = await sb.from('suggestion_votes').delete().eq('suggestion_id', id).eq('profile_id', me.id));
    } else {
      ({ error } = await sb.from('suggestion_votes')
        .upsert({ suggestion_id: id, profile_id: me.id, vote }, { onConflict: 'suggestion_id,profile_id' }));
    }
    if(error) throw error;
    await loadVotes();
    renderSuggestions();
  }catch(err){ console.warn('castVote', err); toast('warn', 'Kunde inte rösta'); }
}

function openSuggestionDialog(){
  $('sgTitle').value = '';
  $('sgNotes').value = '';
  $('suggestionDialog').showModal();
}

async function saveSuggestion(){
  const title = $('sgTitle').value.trim();
  if(!title){ toast('warn', 'Skriv ett förslag'); return; }
  const notes = $('sgNotes').value.trim() || null;
  try{
    const { data, error } = await sb.from('event_suggestions').insert({ title, notes, created_by: me.id }).select('id').single();
    if(error) throw error;
    toast('ok', 'Förslag tillagt');
    if(data) notify('suggestion', { suggestionId: data.id });
    await loadSuggestions();
    renderSuggestions();
  }catch(err){ console.warn('saveSuggestion', err); toast('warn', 'Kunde inte spara'); }
}

async function deleteSuggestion(s){
  if(!s) return;
  if(!(await confirmDialog(`Ta bort förslaget "${s.title}"?`))) return;
  try{
    const { error } = await sb.from('event_suggestions').delete().eq('id', s.id);
    if(error) throw error;
    toast('ok', 'Borttaget');
    await Promise.all([loadSuggestions(), loadVotes()]);
    renderSuggestions();
  }catch(err){ console.warn('deleteSuggestion', err); toast('warn', 'Kunde inte ta bort'); }
}

// Parent: open the event dialog pre-filled from the suggestion (they pick date/time and save).
function promoteSuggestion(s){
  if(!s) return;
  openEventDialog(null);
  $('evTitle').value = s.title;
  $('evNotes').value = s.notes || '';
  $('evCategory').value = 'familj';
}
