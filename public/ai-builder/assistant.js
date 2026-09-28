// Asisten AI di editor: owner menulis perintah, server (penyedia AI NC-WA, tier Cerdas) membalas penjelasan dan
// usulan definisi. Usulan ditampilkan sebagai pratinjau di kanvas (node baru/diubah disorot) sampai owner memilih
// Terapkan (disimpan seperti perubahan biasa dan bisa di-Urungkan) atau Tolak. Selama pratinjau, draft tidak diubah.
const assistant = { history: [], controller: null, proposals: [] };
const assistantSteps = {
  drafting: 'Menyusun jawaban…',
  checking: 'Memeriksa usulan…',
  repairing: 'Memperbaiki masalah otomatis…',
};
const assistantErrors = {
  ai_assistant_invalid_json: 'Jawaban AI tidak bisa dibaca. Coba ulangi perintahnya.',
  ai_response_limit: 'Jawaban AI terlalu panjang.',
  ai_retry_limit: 'Penyedia AI tidak menjawab tepat waktu.',
  ai_provider_failed: 'Penyedia AI gagal dihubungi.',
};
const assistantError = code =>
  assistantErrors[code] ??
  (/^ai_provider_http_/.test(code) ? 'Penyedia AI menolak permintaan (' + code.slice(17) + ').' : code);
const scrollAssistant = () => ($('assistant-chat').scrollTop = $('assistant-chat').scrollHeight);

// Ringkasan perubahan dari server menjadi daftar baris +/~/−.
function changeRows(changes) {
  const rows = [];
  const row = (sign, text) => {
    const item = el('li', undefined, 'change ' + sign);
    item.append(el('span', { add: '+', edit: '~', remove: '−' }[sign], 'change-sign'), el('span', text));
    rows.push(item);
  };
  for (const n of changes.added) row('add', n.label + ' · ' + (kinds[n.type]?.[0] ?? n.type));
  for (const n of changes.changed) row('edit', n.label + ' · diubah');
  for (const n of changes.removed) row('remove', n.label + ' · dihapus');
  if (changes.edges_added || changes.edges_removed)
    row(
      changes.edges_removed && !changes.edges_added ? 'remove' : 'add',
      [
        changes.edges_added ? changes.edges_added + ' sambungan baru' : '',
        changes.edges_removed ? changes.edges_removed + ' sambungan dilepas' : '',
      ]
        .filter(Boolean)
        .join(', '),
    );
  for (const c of changes.collections) row('edit', 'Koleksi ' + c);
  if (changes.profile) row('edit', 'Nama atau deskripsi profil');
  if (!rows.length) row('edit', 'Hanya posisi node');
  return rows;
}
function previewProposal(p) {
  if (state.preview && state.preview.proposal !== p) cancelPreview();
  if (state.preview) return;
  state.preview = { original: snapshot(), proposal: p };
  state.highlight = {
    added: new Set(p.changes.added.map(n => n.id)),
    changed: new Set(p.changes.changed.map(n => n.id)),
  };
  // AI tidak menulis posisi: node lama sudah memakai posisinya lagi, node baru membuat alur disusun dengan Rapikan.
  state.document = structuredClone(p.definition);
  if (!state.document.nodes.some(n => n.id === state.selected)) state.selected = null;
  showTab('flow');
  arrangeUnplaced();
  renderAll();
  renderProposalBar();
}
function cancelPreview() {
  if (!state.preview) return;
  state.document = JSON.parse(state.preview.original);
  state.preview = null;
  state.highlight = null;
  if (!state.document.nodes.some(n => n.id === state.selected)) state.selected = null;
  renderAll();
  renderProposalBar();
}
function applyProposal(p) {
  previewProposal(p);
  const next = state.document;
  p.before = state.preview.original;
  state.document = JSON.parse(p.before);
  state.preview = null;
  mutate(() => (state.document = next));
  p.after = snapshot();
  p.status = 'applied';
  renderAll();
  renderProposalBar();
  renderProposalCard(p);
}
function rejectProposal(p) {
  if (state.preview?.proposal === p) cancelPreview();
  p.status = 'rejected';
  renderProposalCard(p);
}
// Mengembalikan draft ke keadaan tepat sebelum usulan diterapkan (juga bisa di-Urungkan lagi).
function undoProposal(p) {
  if (
    snapshot() !== p.after &&
    !confirm('Draft sudah diubah lagi setelah usulan diterapkan. Kembalikan ke sebelum usulan?')
  )
    return;
  mutate(() => (state.document = JSON.parse(p.before)));
  state.highlight = null;
  p.status = 'undone';
  renderAll();
  renderProposalCard(p);
}
function renderProposalBar() {
  const bar = $('proposal-bar'),
    p = state.preview?.proposal;
  bar.hidden = !p;
  if (!p) return;
  const c = p.changes;
  $('proposal-summary').textContent =
    'Pratinjau usulan AI · belum disimpan · ' +
    [
      c.added.length ? c.added.length + ' node baru' : '',
      c.changed.length ? c.changed.length + ' diubah' : '',
      c.removed.length ? c.removed.length + ' dihapus' : '',
    ]
      .filter(Boolean)
      .join(', ');
  $('proposal-apply').onclick = () => applyProposal(p);
  $('proposal-reject').onclick = () => rejectProposal(p);
}
function renderProposalCard(p) {
  const card = p.card;
  card.replaceChildren();
  const head = el('div', undefined, 'proposal-head');
  head.append(el('strong', 'Usulan perubahan'));
  head.append(
    p.issues.length ? el('span', p.issues.length + ' masalah', 'chip warn') : el('span', '0 masalah', 'chip ok'),
  );
  const list = el('ul', undefined, 'changes');
  list.append(...changeRows(p.changes));
  card.append(head, list);
  if (p.issues.length) {
    const issues = el('ul', undefined, 'proposal-issues');
    for (const i of p.issues.slice(0, 5)) issues.append(el('li', i.message));
    card.append(issues);
  }
  if (p.stale && p.status === 'pending')
    card.append(el('p', 'Draft berubah sejak perintah dikirim; Terapkan akan mengganti perubahan itu.', 'hint warn'));
  const actions = el('div', undefined, 'proposal-actions');
  if (p.status === 'pending') {
    const view = btn('Lihat di kanvas', () => previewProposal(p), 'btn small ghost'),
      reject = btn('Tolak', () => rejectProposal(p)),
      apply = btn('Terapkan', () => applyProposal(p), 'btn small primary');
    actions.append(view, el('span', undefined, 'spacer'), reject, apply);
  } else if (p.status === 'applied') {
    actions.append(el('span', 'Diterapkan sebagai draft', 'proposal-state ok'), el('span', undefined, 'spacer'));
    actions.append(btn('Urungkan', () => undoProposal(p)));
  } else actions.append(el('span', p.status === 'undone' ? 'Diurungkan' : 'Ditolak', 'proposal-state'));
  card.append(actions);
}

async function askAssistant(message) {
  if (assistant.controller || !message) return;
  const controller = new AbortController();
  assistant.controller = controller;
  $('assistant-send').disabled = true;
  $('assistant-stop').hidden = false;
  const reply = el('div', undefined, 'bubble assistant pending'),
    status = el('div', assistantSteps.drafting, 'assistant-status');
  reply.append(status);
  $('assistant-chat').append(el('div', message, 'bubble user'), reply);
  $('assistant-message').value = '';
  scrollAssistant();
  const sent = snapshot(),
    started = Date.now();
  const tick = setInterval(() => (status.dataset.elapsed = Math.round((Date.now() - started) / 1000) + ' detik'), 1000);
  try {
    const r = await fetch(base + '/' + state.id + '/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: assistant.history.slice(-20), definition: state.document }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw Error(d.message || d.error || 'Permintaan gagal.');
    }
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '',
      result = null;
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.step === 'error') throw Error(assistantError(event.error));
      if (event.step === 'done') result = event.result;
      else
        status.textContent =
          assistantSteps[event.step] +
          (event.issues?.length ? ' (' + event.issues.length + ' masalah)' : '') +
          (event.attempt ? ' · percobaan ' + event.attempt : '');
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    consume(buffer + decoder.decode());
    if (!result) throw Error('Asisten tidak memberi jawaban.');
    reply.className = 'bubble assistant';
    reply.replaceChildren(el('div', result.reply || (result.definition ? 'Usulan perubahan siap.' : 'Selesai.')));
    assistant.history.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply || '' });
    if (result.definition) {
      const p = {
        definition: result.definition,
        changes: result.changes,
        issues: result.issues,
        status: 'pending',
        stale: snapshot() !== sent,
        card: el('div', undefined, 'proposal'),
      };
      assistant.proposals.push(p);
      reply.append(p.card);
      renderProposalCard(p);
      previewProposal(p);
    }
  } catch (e) {
    reply.className = 'bubble assistant failed';
    reply.textContent = e.name === 'AbortError' ? 'Dihentikan.' : e.message;
  } finally {
    clearInterval(tick);
    assistant.controller = null;
    $('assistant-send').disabled = false;
    $('assistant-stop').hidden = true;
    scrollAssistant();
  }
}
$('assistant-form').onsubmit = e => {
  e.preventDefault();
  void askAssistant($('assistant-message').value.trim());
};
$('assistant-message').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('assistant-form').requestSubmit();
  }
};
$('assistant-stop').onclick = () => assistant.controller?.abort();
for (const chip of document.querySelectorAll('[data-assistant-prompt]'))
  chip.onclick = () => {
    $('assistant-message').value = chip.dataset.assistantPrompt;
    $('assistant-message').focus();
  };
$('assistant-new').onclick = () => {
  assistant.controller?.abort();
  cancelPreview();
  assistant.history = [];
  assistant.proposals = [];
  $('assistant-chat').replaceChildren($('assistant-chat').firstElementChild);
};
$('assistant-toggle').onclick = () => showSide(state.side === 'assistant' ? 'inspector' : 'assistant');
$('close-assistant').onclick = () => showSide('inspector');
