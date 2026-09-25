// Asisten AI, tab Percakapan: daftar percakapan di kiri, riwayat gaya WhatsApp di kanan, balasan manual, dan
// pembaruan realtime.
const chat = {
  id: '',
  list: [],
  contacts: new Map(),
  saved: new Set(),
  filter: 'all',
  search: '',
  active: '',
  messages: [],
  before: null,
  loading: false,
  sending: false,
  refresh: undefined,
};
const chatTick = {
  sent: '<path d="M3 12.5 7.5 17 17 7"/>',
  delivered: '<path d="M1.5 12.5 6 17 15.5 7"/><path d="M9 16.5 9.5 17 19 7"/>',
};
const chatOrigins = { ai: 'AI', manual: 'Manual', api: 'API', system: 'Sistem' };
// Nomor Indonesia ditampilkan sebagai +62 812-3456-7890; nomor lain apa adanya.
function chatNumber(customer) {
  if (!customer.startsWith('62')) return customer;
  const rest = customer.slice(2);
  return '+62 ' + [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)].filter(Boolean).join('-');
}
function chatName(customer) {
  return chat.contacts.get(customer) || chatNumber(customer);
}
function chatInitials(customer) {
  const name = chat.contacts.get(customer);
  return name
    ? name
        .split(/\s+/)
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '#';
}
function chatState(entry) {
  if ($('ai-session-enabled-field').value !== 'on') return ['off', 'AI nonaktif'];
  return entry.paused ? ['paused', 'Dijeda'] : entry.full_auto ? ['full', 'Full auto'] : ['ai', 'AI aktif'];
}
function chatDay(value) {
  const date = new Date(value),
    today = new Date();
  const start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86400000);
  return days === 0
    ? 'Hari ini'
    : days === 1
      ? 'Kemarin'
      : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
function chatClock(value) {
  return new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
function chatListTime(value) {
  if (!value) return '';
  const days = chatDay(value);
  return days === 'Hari ini'
    ? chatClock(value)
    : days === 'Kemarin'
      ? 'Kemarin'
      : new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
}
async function loadConversations() {
  const id = $('ai-session').value,
    generation = assistantLoad;
  if (!id || aiView !== 'sessions') return;
  const [rows, savedContacts] = await Promise.all([
    api('/sessions/' + encodeURIComponent(id) + '/ai/chats'),
    api('/auto-share/contacts'),
  ]);
  if (id !== $('ai-session').value || generation !== assistantLoad) return;
  if (chat.id !== id) {
    chat.active = '';
    chat.messages = [];
    chat.before = null;
  }
  chat.id = id;
  chat.list = rows;
  const number = c => String(c.nomor).replace(/@s\.whatsapp\.net$/, '');
  chat.saved = new Set(savedContacts.map(number));
  chat.contacts = new Map(savedContacts.filter(c => c.nama).map(c => [number(c), c.nama]));
  renderChatList();
  if (chat.active) await loadChatMessages();
  else renderChatView();
}
function renderChatList() {
  const counts = { all: chat.list.length, ai: 0, paused: 0, full: 0 };
  for (const entry of chat.list) counts[chatState(entry)[0]] = (counts[chatState(entry)[0]] || 0) + 1;
  for (const b of document.querySelectorAll('[data-chat-filter]')) {
    const key = b.dataset.chatFilter;
    b.textContent =
      { all: 'Semua', ai: 'AI aktif', paused: 'Dijeda', full: 'Full auto' }[key] + ' ' + (counts[key] || 0);
    b.setAttribute('aria-pressed', String(chat.filter === key));
  }
  const query = chat.search.trim().toLowerCase();
  const shown = chat.list.filter(
    entry =>
      (chat.filter === 'all' || chatState(entry)[0] === chat.filter) &&
      (!query ||
        entry.customer.includes(query.replace(/\D/g, '') || '\u0000') ||
        chatName(entry.customer).toLowerCase().includes(query)),
  );
  const list = $('chat-list');
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-list-empty';
    empty.textContent = chat.list.length
      ? 'Tidak ada percakapan yang cocok.'
      : 'Belum ada percakapan. Pesan pribadi yang masuk ke sesi ini akan tampil di sini.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...shown.map(entry => {
      const item = document.createElement('button'),
        avatar = document.createElement('span'),
        body = document.createElement('span'),
        top = document.createElement('span'),
        name = document.createElement('strong'),
        time = document.createElement('span'),
        bottom = document.createElement('span'),
        preview = document.createElement('span'),
        badge = document.createElement('span');
      const [state, label] = chatState(entry),
        last = entry.last;
      item.type = 'button';
      item.className = 'chat-item' + (entry.customer === chat.active ? ' active' : '');
      item.setAttribute('aria-current', String(entry.customer === chat.active));
      avatar.className = 'chat-avatar';
      avatar.textContent = chatInitials(entry.customer);
      avatar.setAttribute('aria-hidden', 'true');
      name.textContent = chatName(entry.customer);
      time.className = 'chat-item-time';
      time.textContent = chatListTime(last?.at);
      preview.className = 'chat-item-preview';
      preview.textContent = last
        ? (last.direction === 'out' ? (last.origin === 'ai' ? 'AI: ' : 'Anda: ') : '') + last.text
        : 'Belum ada riwayat chat';
      badge.className = 'chat-badge ' + state;
      badge.textContent = label;
      top.append(name, time);
      bottom.append(preview, badge);
      body.className = 'chat-item-body';
      body.append(top, bottom);
      item.append(avatar, body);
      item.onclick = () =>
        run(async () => {
          chat.active = entry.customer;
          chat.messages = [];
          chat.before = null;
          renderChatList();
          $('chat-shell').classList.add('chat-open');
          await loadChatMessages();
          // Di ponsel chat berada di bawah pemilih sesi; seluruh chat, termasuk kolom ketik, digulir ke layar.
          if (matchMedia('(max-width:760px)').matches) $('chat-shell').scrollIntoView({ block: 'start' });
          else $('chat-text').focus({ preventScroll: true });
        });
      return item;
    }),
  );
}
async function loadChatMessages(older = false) {
  const id = chat.id,
    customer = chat.active;
  if (!id || !customer) return;
  const query = older && chat.before ? '?before=' + encodeURIComponent(chat.before) : '';
  const page = await api(
    '/sessions/' + encodeURIComponent(id) + '/ai/chats/' + encodeURIComponent(customer) + '/messages' + query,
  );
  if (id !== chat.id || customer !== chat.active) return;
  const box = $('chat-messages'),
    nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80,
    previousHeight = box.scrollHeight;
  if (older) {
    chat.messages = [...page.messages, ...chat.messages];
  } else {
    chat.messages = page.messages;
  }
  chat.before = page.before;
  renderChatView();
  if (older) box.scrollTop = box.scrollHeight - previousHeight;
  else if (nearBottom || !box.dataset.opened || box.dataset.opened !== customer) {
    box.scrollTop = box.scrollHeight;
    box.dataset.opened = customer;
  }
}
function renderChatView() {
  const entry = chat.list.find(e => e.customer === chat.active);
  $('chat-empty').hidden = Boolean(chat.active);
  $('chat-view').hidden = !chat.active;
  if (!chat.active) {
    $('chat-shell').classList.remove('chat-open');
    return;
  }
  const current = entry ?? {
    customer: chat.active,
    paused: false,
    full_auto: false,
    message_count: 0,
    router_context: null,
  };
  const [state, label] = chatState(current);
  $('chat-avatar').textContent = chatInitials(current.customer);
  $('chat-name').textContent = chatName(current.customer);
  $('chat-meta').textContent =
    (chat.contacts.has(current.customer) ? chatNumber(current.customer) + ' · ' : '') +
    current.message_count +
    ' pesan di memori AI';
  $('chat-status').className = 'chat-status ' + state;
  $('chat-status').textContent = label;
  $('chat-pause').textContent = current.paused ? 'Lanjutkan AI' : 'Jeda AI';
  $('chat-full-auto').checked = Boolean(current.full_auto);
  $('chat-save-contact').hidden = chat.saved.has(current.customer);
  $('chat-context').hidden = !current.router_context;
  $('chat-context-value').textContent = current.router_context || '';
  const nodes = [];
  if (chat.before) {
    const more = button('Muat pesan sebelumnya', () => loadChatMessages(true));
    more.className = 'secondary chat-more';
    nodes.push(more);
  }
  if (!chat.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-note';
    empty.textContent = 'Belum ada riwayat chat yang tersimpan untuk pelanggan ini.';
    nodes.push(empty);
  }
  let day = '';
  for (const m of chat.messages) {
    const label = chatDay(m.at);
    if (label !== day) {
      day = label;
      const divider = document.createElement('div');
      divider.className = 'chat-day';
      divider.textContent = label;
      nodes.push(divider);
    }
    if (m.direction === 'note') {
      const note = document.createElement('div');
      note.className = 'chat-note';
      note.textContent = m.text + ' · ' + chatClock(m.at);
      nodes.push(note);
      continue;
    }
    const bubble = document.createElement('div'),
      text = document.createElement('span'),
      meta = document.createElement('span');
    bubble.className = 'chat-bubble ' + (m.direction === 'in' ? 'in' : 'out ' + m.origin);
    text.className = 'chat-text';
    text.textContent = m.text;
    meta.className = 'chat-bubble-meta';
    if (m.direction === 'out') {
      const tag = document.createElement('span');
      tag.className = 'chat-tag ' + m.origin;
      tag.textContent = chatOrigins[m.origin] || m.origin;
      meta.append(tag);
    }
    meta.append(document.createTextNode(chatClock(m.at)));
    if (m.direction === 'out' && m.status) {
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tick.setAttribute('viewBox', '0 0 20 20');
      tick.setAttribute('width', '16');
      tick.setAttribute('height', '16');
      tick.setAttribute('class', 'chat-tick ' + m.status);
      tick.setAttribute('role', 'img');
      tick.setAttribute('aria-label', { sent: 'Terkirim', delivered: 'Diterima', read: 'Dibaca' }[m.status]);
      tick.innerHTML = m.status === 'sent' ? chatTick.sent : chatTick.delivered;
      meta.append(tick);
    }
    bubble.append(text, meta);
    nodes.push(bubble);
  }
  $('chat-messages').replaceChildren(...nodes);
}
async function updateChatConversation(body) {
  await api(
    '/sessions/' + encodeURIComponent(chat.id) + '/ai/conversations/' + encodeURIComponent(chat.active),
    'PUT',
    body,
  );
  await loadConversations();
}
$('chat-pause').onclick = () =>
  run(async () => {
    const entry = chat.list.find(e => e.customer === chat.active);
    await updateChatConversation({ paused: !entry?.paused, full_auto: false });
  });
$('chat-full-auto').onchange = e =>
  run(async () => {
    try {
      await updateChatConversation({ paused: false, full_auto: e.target.checked });
    } catch (error) {
      e.target.checked = !e.target.checked;
      throw error;
    }
  });
$('chat-clear').onclick = () =>
  run(async () => {
    if (!confirm('Hapus memori AI pelanggan ini? Riwayat chat tetap tersimpan.')) return;
    const entry = chat.list.find(e => e.customer === chat.active);
    await updateChatConversation({ paused: Boolean(entry?.paused), clear: true });
  });
$('chat-save-contact').onclick = () =>
  run(async () => {
    await loadAutoShare();
    openShareContact({ nomor: chat.active });
  });
$('chat-back').onclick = () => {
  $('chat-shell').classList.remove('chat-open');
};
$('chat-refresh').onclick = () => run(loadConversations);
$('chat-search').oninput = e => {
  chat.search = e.target.value;
  renderChatList();
};
for (const b of document.querySelectorAll('[data-chat-filter]'))
  b.onclick = () => {
    chat.filter = b.dataset.chatFilter;
    renderChatList();
  };
// Satu Idempotency-Key per pesan yang diketik, supaya kirim ganda atau pengulangan tidak pernah mengirim dua kali.
let chatPending = { text: '', key: '' };
$('chat-text').oninput = e => {
  e.target.style.height = '46px';
  e.target.style.height = Math.min(Math.max(e.target.scrollHeight, 46), 140) + 'px';
};
$('chat-text').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('chat-composer').requestSubmit();
  }
};
$('chat-composer').onsubmit = e => {
  e.preventDefault();
  const input = $('chat-text'),
    text = input.value.trim();
  if (!text || chat.sending || !chat.active) return;
  if (chatPending.text !== text) chatPending = { text, key: crypto.randomUUID() };
  void run(async () => {
    chat.sending = true;
    e.currentTarget.querySelector('.chat-send').disabled = true;
    try {
      await api(
        '/sessions/' + encodeURIComponent(chat.id) + '/ai/chats/' + encodeURIComponent(chat.active) + '/messages',
        'POST',
        { text },
        { 'Idempotency-Key': chatPending.key },
      );
      input.value = '';
      input.style.height = '46px';
      chatPending = { text: '', key: '' };
      await loadConversations();
      await wallet();
    } finally {
      chat.sending = false;
      $('chat-composer').querySelector('.chat-send').disabled = false;
    }
  });
};
// Realtime: setiap perubahan chat di sesi yang terbuka menyegarkan daftar dan, bila sedang dibuka, percakapannya.
function chatRealtime(data) {
  if (data.event !== 'chat.updated' || data.sessionId !== chat.id || $('ai-tab-conversations').hidden) return;
  clearTimeout(chat.refresh);
  chat.refresh = setTimeout(() => {
    void run(loadConversations);
  }, 400);
}
