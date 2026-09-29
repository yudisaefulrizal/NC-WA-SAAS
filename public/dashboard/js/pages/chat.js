// Halaman Chat: kotak masuk gabungan semua sesi (WhatsApp dan Instagram). Setiap percakapan menunjukkan sesi dan
// akun tempat pesan masuk; balasan manual selalu dikirim dari sesi itu. Tampilan chat memakai gaya Percakapan di
// Asisten AI, tetapi status dan kodenya terpisah supaya halaman itu tidak berubah.
const inbox = {
  list: [],
  sessions: [],
  names: new Map(),
  handles: new Map(),
  session: '',
  filter: 'all',
  search: '',
  active: null,
  messages: [],
  before: null,
  sending: false,
  pending: { text: '', key: '' },
  refresh: undefined,
};
const inboxKey = entry => entry.session + '\u0000' + entry.customer;
async function loadInbox() {
  const [rows, sessionRows, contacts] = await Promise.all([
    api('/ai/chats'),
    api('/sessions'),
    api('/auto-share/contacts'),
  ]);
  inbox.sessions = sessionRows;
  // Nama pelanggan: kontak Auto Share untuk WhatsApp, nama/@username dari Instagram untuk sesi Instagram.
  const number = c => String(c.nomor).replace(/@s\.whatsapp\.net$/, '');
  inbox.names = new Map(contacts.filter(c => c.nama).map(c => ['wa\u0000' + number(c), c.nama]));
  inbox.handles = new Map();
  const instagram = sessionRows.filter(s => s.channel === 'instagram');
  const lists = await Promise.all(
    instagram.map(s => api('/api/instagram/contacts?session=' + encodeURIComponent(s.id))),
  );
  instagram.forEach((s, index) => {
    for (const c of lists[index]) {
      if (c.username) inbox.handles.set(s.id + '\u0000' + c.customer, '@' + c.username);
      if (c.name || c.username) inbox.names.set(s.id + '\u0000' + c.customer, c.name || '@' + c.username);
    }
  });
  inbox.list = rows;
  renderInboxSessions();
  renderInboxList();
  if (inbox.active) await loadInboxMessages();
  else renderInboxView();
}
function inboxSession(id) {
  return inbox.sessions.find(s => s.id === id);
}
function inboxInstagram(entry) {
  return inboxSession(entry.session)?.channel === 'instagram';
}
function inboxName(entry) {
  const key = inboxInstagram(entry) ? inboxKey(entry) : 'wa\u0000' + entry.customer;
  return inbox.names.get(key) || inboxNumber(entry);
}
function inboxNumber(entry) {
  if (inboxInstagram(entry)) return inbox.handles.get(inboxKey(entry)) || 'Pengguna Instagram';
  const customer = entry.customer;
  if (!customer.startsWith('62')) return customer;
  const rest = customer.slice(2);
  return '+62 ' + [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)].filter(Boolean).join('-');
}
// Pelanggan tanpa nama tersimpan ditandai "#", sama seperti di Percakapan Asisten AI.
function inboxInitials(entry) {
  const key = inboxInstagram(entry) ? inboxKey(entry) : 'wa\u0000' + entry.customer;
  const name = inbox.names.get(key);
  if (!name) return '#';
  return (
    name
      .replace(/^@/, '')
      .split(/\s+/)
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '#'
  );
}
// Label asal percakapan: nama sesi dan akunnya (nomor WhatsApp atau @username Instagram).
function inboxSource(entry) {
  const s = inboxSession(entry.session);
  return entry.session + (s?.phone ? ' · ' + s.phone : '');
}
function inboxState(entry) {
  if (!inboxSession(entry.session)?.aiEnabled) return ['off', 'AI nonaktif'];
  return entry.paused ? ['paused', 'Dijeda'] : entry.full_auto ? ['full', 'Full auto'] : ['ai', 'AI aktif'];
}
function renderInboxSessions() {
  const select = $('inbox-session');
  select.replaceChildren(
    new Option('Semua sesi (' + inbox.sessions.length + ')', ''),
    ...inbox.sessions.map(s => new Option(s.id + ' · ' + (s.channel === 'instagram' ? 'Instagram' : 'WhatsApp'), s.id)),
  );
  if (inbox.session && !inboxSession(inbox.session)) inbox.session = '';
  select.value = inbox.session;
}
function renderInboxList() {
  const scoped = inbox.list.filter(e => !inbox.session || e.session === inbox.session);
  const counts = { all: scoped.length, ai: 0, paused: 0, full: 0 };
  for (const entry of scoped) counts[inboxState(entry)[0]] = (counts[inboxState(entry)[0]] || 0) + 1;
  for (const b of document.querySelectorAll('[data-inbox-filter]')) {
    const key = b.dataset.inboxFilter;
    b.textContent =
      { all: 'Semua', ai: 'AI aktif', paused: 'Dijeda', full: 'Full auto' }[key] + ' ' + (counts[key] || 0);
    b.setAttribute('aria-pressed', String(inbox.filter === key));
  }
  $('inbox-count').textContent = scoped.length + ' percakapan';
  const query = inbox.search.trim().toLowerCase();
  const shown = scoped.filter(
    entry =>
      (inbox.filter === 'all' || inboxState(entry)[0] === inbox.filter) &&
      (!query ||
        entry.customer.includes(query.replace(/\D/g, '') || '\u0000') ||
        inboxName(entry).toLowerCase().includes(query) ||
        inboxNumber(entry).toLowerCase().includes(query)),
  );
  const list = $('inbox-list');
  if (!shown.length) {
    list.replaceChildren(
      element(
        'p',
        'chat-list-empty',
        scoped.length
          ? 'Tidak ada percakapan yang cocok.'
          : 'Belum ada percakapan. Pesan pribadi yang masuk ke sesi mana pun akan tampil di sini.',
      ),
    );
    return;
  }
  list.replaceChildren(
    ...shown.map(entry => {
      const item = document.createElement('button'),
        avatar = element('span', 'chat-avatar inbox-avatar', inboxInitials(entry)),
        platform = element('span', 'inbox-platform ' + (inboxInstagram(entry) ? 'instagram' : 'whatsapp')),
        body = element('span', 'chat-item-body'),
        top = element('span'),
        middle = element('span'),
        bottom = element('span', 'inbox-item-meta');
      const [state, label] = inboxState(entry),
        last = entry.last,
        active = inbox.active && inboxKey(inbox.active) === inboxKey(entry);
      item.type = 'button';
      item.className = 'chat-item inbox-item' + (active ? ' active' : '');
      item.setAttribute('aria-current', String(Boolean(active)));
      avatar.setAttribute('aria-hidden', 'true');
      platform.title = inboxInstagram(entry) ? 'Instagram' : 'WhatsApp';
      avatar.append(platform);
      top.append(element('strong', '', inboxName(entry)), element('span', 'chat-item-time', chatListTime(last?.at)));
      middle.append(
        element(
          'span',
          'chat-item-preview',
          last
            ? (last.direction === 'out' ? (last.origin === 'ai' ? 'AI: ' : 'Anda: ') : '') + last.text
            : 'Belum ada riwayat chat',
        ),
      );
      bottom.append(
        element('span', 'inbox-source-tag', inboxSource(entry)),
        entry.waiting
          ? element('span', 'chat-badge inbox-waiting', 'Menunggu tim')
          : element('span', 'chat-badge ' + state, label),
      );
      body.append(top, middle, bottom);
      item.append(avatar, body);
      item.onclick = () =>
        run(async () => {
          inbox.active = { session: entry.session, customer: entry.customer };
          inbox.messages = [];
          inbox.before = null;
          renderInboxList();
          $('inbox-shell').classList.add('chat-open');
          await loadInboxMessages();
          if (matchMedia('(max-width:760px)').matches) $('inbox-shell').scrollIntoView({ block: 'start' });
          else $('inbox-text').focus({ preventScroll: true });
        });
      return item;
    }),
  );
}
function inboxBase() {
  return (
    '/sessions/' +
    encodeURIComponent(inbox.active.session) +
    '/ai/chats/' +
    encodeURIComponent(inbox.active.customer) +
    '/messages'
  );
}
async function loadInboxMessages(older = false) {
  const active = inbox.active;
  if (!active) return;
  const query = older && inbox.before ? '?before=' + encodeURIComponent(inbox.before) : '';
  const page = await api(inboxBase() + query);
  if (inbox.active !== active) return;
  const box = $('inbox-messages'),
    nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80,
    previousHeight = box.scrollHeight;
  inbox.messages = older ? [...page.messages, ...inbox.messages] : page.messages;
  inbox.before = page.before;
  renderInboxView();
  if (older) box.scrollTop = box.scrollHeight - previousHeight;
  else if (nearBottom || box.dataset.opened !== inboxKey(active)) {
    box.scrollTop = box.scrollHeight;
    box.dataset.opened = inboxKey(active);
  }
}
function renderInboxView() {
  $('inbox-empty').hidden = Boolean(inbox.active);
  $('inbox-view').hidden = !inbox.active;
  if (!inbox.active) {
    $('inbox-shell').classList.remove('chat-open');
    return;
  }
  const entry = inbox.list.find(e => inboxKey(e) === inboxKey(inbox.active)) ?? {
    ...inbox.active,
    paused: false,
    full_auto: false,
    message_count: 0,
    router_context: null,
  };
  const session = inboxSession(entry.session),
    instagram = inboxInstagram(entry),
    [state, label] = inboxState(entry);
  $('inbox-avatar').textContent = inboxInitials(entry);
  $('inbox-name').textContent = inboxName(entry);
  $('inbox-meta').textContent =
    (inboxName(entry) !== inboxNumber(entry) ? inboxNumber(entry) + ' · ' : '') +
    (instagram ? 'pelanggan Instagram' : 'pelanggan WhatsApp');
  $('inbox-status').className = 'chat-status ' + state;
  $('inbox-status').textContent = label;
  $('inbox-pause').textContent = entry.paused ? 'Lanjutkan AI' : 'Jeda AI';
  $('inbox-full-auto').checked = Boolean(entry.full_auto);
  // Asal percakapan: sesi, platform, akun, dan data profil yang menjawab.
  const source = $('inbox-source');
  source.className = 'inbox-source ' + (instagram ? 'instagram' : 'whatsapp');
  const origin = element('span');
  origin.append(
    document.createTextNode('Masuk lewat '),
    element('strong', '', entry.session),
    document.createTextNode(
      ' · ' + (instagram ? 'Instagram DM' : 'WhatsApp') + (session?.phone ? ' · ' + session.phone : ''),
    ),
  );
  source.replaceChildren(
    element('span', 'inbox-platform-inline ' + (instagram ? 'instagram' : 'whatsapp')),
    origin,
    element(
      'span',
      'field-hint',
      session?.aiProfile ? 'Data profil: ' + session.aiProfile.name : 'Belum ada data profil',
    ),
  );
  if (session && session.status !== 'connected') source.append(element('span', 'chat-badge paused', 'Sesi terputus'));
  $('inbox-context').hidden = !entry.router_context;
  $('inbox-context-value').textContent = entry.router_context || '';
  $('inbox-text').placeholder = 'Balas manual lewat ' + entry.session + '…';
  $('inbox-composer-hint').textContent =
    'Dikirim dari ' +
    entry.session +
    ', memakai 1 kredit, dan menjeda AI untuk pelanggan ini kecuali Full auto aktif.' +
    (instagram ? ' Instagram hanya menerima balasan dalam 24 jam sejak pesan terakhir pelanggan.' : '');
  const nodes = [];
  if (inbox.before) {
    const more = button('Muat pesan sebelumnya', () => loadInboxMessages(true));
    more.className = 'secondary chat-more';
    nodes.push(more);
  }
  if (!inbox.messages.length)
    nodes.push(element('p', 'chat-note', 'Belum ada riwayat chat yang tersimpan untuk pelanggan ini.'));
  let day = '';
  for (const m of inbox.messages) {
    const dayLabel = chatDay(m.at);
    if (dayLabel !== day) {
      day = dayLabel;
      nodes.push(element('div', 'chat-day', dayLabel));
    }
    if (m.direction === 'note') {
      nodes.push(element('div', 'chat-note', m.text + ' · ' + chatClock(m.at)));
      continue;
    }
    const bubble = element('div', 'chat-bubble ' + (m.direction === 'in' ? 'in' : 'out ' + m.origin)),
      meta = element('span', 'chat-bubble-meta');
    if (m.direction === 'out') meta.append(element('span', 'chat-tag ' + m.origin, chatOrigins[m.origin] || m.origin));
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
    bubble.append(element('span', 'chat-text', m.text), meta);
    nodes.push(bubble);
  }
  $('inbox-messages').replaceChildren(...nodes);
}
async function updateInboxConversation(body) {
  await api(
    '/sessions/' +
      encodeURIComponent(inbox.active.session) +
      '/ai/conversations/' +
      encodeURIComponent(inbox.active.customer),
    'PUT',
    body,
  );
  await loadInbox();
}
$('inbox-pause').onclick = () =>
  run(async () => {
    const entry = inbox.list.find(e => inboxKey(e) === inboxKey(inbox.active));
    await updateInboxConversation({ paused: !entry?.paused, full_auto: false });
  });
$('inbox-full-auto').onchange = e =>
  run(async () => {
    try {
      await updateInboxConversation({ paused: false, full_auto: e.target.checked });
    } catch (error) {
      e.target.checked = !e.target.checked;
      throw error;
    }
  });
$('inbox-back').onclick = () => $('inbox-shell').classList.remove('chat-open');
$('inbox-refresh').onclick = () => run(loadInbox);
$('inbox-search').oninput = e => {
  inbox.search = e.target.value;
  renderInboxList();
};
$('inbox-session').onchange = e => {
  inbox.session = e.target.value;
  renderInboxList();
};
for (const b of document.querySelectorAll('[data-inbox-filter]'))
  b.onclick = () => {
    inbox.filter = b.dataset.inboxFilter;
    renderInboxList();
  };
$('inbox-text').oninput = e => {
  e.target.style.height = '46px';
  e.target.style.height = Math.min(Math.max(e.target.scrollHeight, 46), 140) + 'px';
};
$('inbox-text').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('inbox-composer').requestSubmit();
  }
};
// Satu Idempotency-Key per pesan yang diketik, supaya kirim ganda atau pengulangan tidak mengirim dua kali.
$('inbox-composer').onsubmit = e => {
  e.preventDefault();
  const input = $('inbox-text'),
    text = input.value.trim();
  if (!text || inbox.sending || !inbox.active) return;
  if (inbox.pending.text !== text) inbox.pending = { text, key: crypto.randomUUID() };
  void run(async () => {
    inbox.sending = true;
    $('inbox-composer').querySelector('.chat-send').disabled = true;
    try {
      await api(inboxBase(), 'POST', { text }, { 'Idempotency-Key': inbox.pending.key });
      input.value = '';
      input.style.height = '46px';
      inbox.pending = { text: '', key: '' };
      await loadInbox();
      await wallet();
    } finally {
      inbox.sending = false;
      $('inbox-composer').querySelector('.chat-send').disabled = false;
    }
  });
};
// Realtime: perubahan chat di sesi mana pun menyegarkan kotak masuk selama halaman Chat terbuka.
function inboxRealtime(data) {
  if (data.event !== 'chat.updated' || $('chat').hidden) return;
  clearTimeout(inbox.refresh);
  inbox.refresh = setTimeout(() => void run(loadInbox), 400);
}
