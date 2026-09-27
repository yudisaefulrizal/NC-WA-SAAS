// Siklus draft, impor/ekspor, koleksi, dan simulasi. Kanvas dan inspector berbagi state editor ini.
const base = '/api/admin/ai/builder';
const kinds = {
  input: ['↳', 'Input', 'Pesan masuk'],
  memory: ['▤', 'Shared Memory', 'Hubungkan riwayat ke node yang dipilih'],
  router: ['⑂', 'Router', 'Pilih jalur berdasarkan intent'],
  agent: ['✦', 'Agent', 'Susun jawaban dengan AI'],
  condition: ['◇', 'Kondisi', 'Cabang berdasarkan nilai'],
  tool: ['⛁', 'Data', 'Cari, ambil, ubah, atau hitung isi koleksi'],
  context: ['≋', 'Context', 'Ringkas konteks percakapan'],
  output: ['↗', 'Output', 'Kirim jawaban'],
  fallback: ['⇥', 'Fallback', 'Teruskan ke manusia'],
  extract: ['⌗', 'Ekstrak', 'Ubah kalimat pelanggan menjadi isian terstruktur'],
  compute: ['∑', 'Set / Hitung', 'Olah nilai dengan aturan pasti, tanpa AI'],
  media: ['▣', 'Kirim media', 'Kirim gambar atau dokumen ke pelanggan'],
  receive: ['⇩', 'Terima media', 'Simpan gambar atau dokumen dari pelanggan'],
};
// Node yang bisa membaca Shared Memory; sama dengan memoryConsumers di definition.ts.
const memoryConsumers = ['router', 'agent', 'context', 'extract'];
const fieldTypeLabels = {
  text: 'Teks',
  number: 'Angka',
  boolean: 'Ya / Tidak',
  date: 'Tanggal',
  time: 'Jam',
  datetime: 'Tanggal-jam',
  choice: 'Pilihan',
  multichoice: 'Pilihan ganda',
  phone: 'Telepon',
  relation: 'Relasi ke koleksi',
  file: 'File / gambar',
};
const uniqueFieldTypes = ['text', 'number', 'date', 'time', 'datetime', 'choice', 'phone'];
const state = {
  id: null,
  document: null,
  revision: 0,
  published: 0,
  selected: null,
  dirty: false,
  undo: [],
  redo: [],
  pan: { x: 25, y: 15 },
  zoom: 0.85,
  pending: null,
  trace: {},
  history: [],
  context: null,
  controller: null,
};
let pendingImport;
function snapshot() {
  return JSON.stringify(state.document);
}
function checkpoint() {
  state.undo.push(snapshot());
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
}
function changed() {
  state.dirty = true;
  renderStatus();
}
function mutate(fn) {
  checkpoint();
  fn();
  changed();
  renderCanvas();
}
function renderStatus() {
  $('dirty').textContent = state.dirty ? 'Belum disimpan' : 'Tersimpan';
  $('revision').textContent =
    `Draft v${state.revision} · ${state.published ? 'Terbit v' + state.published : 'Belum diterbitkan'}`;
  $('profile-title').textContent = state.document.name;
  $('undo').disabled = !state.undo.length;
  $('redo').disabled = !state.redo.length;
}
// Harus sama dengan ports() di server (definition.ts).
function nodePorts(n) {
  if (['output', 'fallback', 'memory'].includes(n.type)) return [];
  if (n.type === 'router') return n.branches.map(b => b.id);
  if (n.type === 'agent' && n.fallback) return ['next', 'fallback'];
  if (n.type === 'condition') return ['yes', 'no'];
  if (n.type === 'tool' && ['search', 'get'].includes(n.operation)) return ['found', 'empty'];
  if (n.type === 'receive') return ['received', 'none'];
  return ['next'];
}
const portLabels = {
  next: 'Lanjut',
  yes: 'Ya',
  no: 'Tidak',
  found: 'Ditemukan',
  empty: 'Kosong',
  fallback: 'Fallback',
  received: 'Diterima',
  none: 'Tidak ada',
};
// Kelompok palet; urutan di sini urutan tampil.
const paletteGroups = [
  ['Alur', ['input', 'router', 'condition', 'output', 'fallback']],
  ['AI', ['agent', 'extract', 'context']],
  ['Data', ['tool', 'compute', 'memory']],
  ['Media', ['receive', 'media']],
];
function uid(prefix) {
  return prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 8);
}
function newNode(type, x = 120, y = 140) {
  return {
    id: uid(type),
    type,
    label: kinds[type][1],
    x,
    y,
    prompt:
      type === 'agent'
        ? 'Jawab ramah dan ringkas berdasarkan data yang tersedia.'
        : type === 'context'
          ? 'Ringkas konteks percakapan menjadi Subjek-Predikat-Objek.'
          : '',
    tier: type === 'router' ? 'decision' : type === 'extract' ? 'structured' : 'medium',
    model: '',
    tools: [],
    branches:
      type === 'router'
        ? [
            { id: 'layanan', label: 'Layanan', description: 'Pertanyaan atau permintaan tentang layanan.' },
            { id: 'lainnya', label: 'Lainnya', description: 'Pesan lainnya.' },
          ]
        : [],
    collection: state.document?.collections[0]?.id || '',
    operation: 'search',
    value: type === 'output' ? '{{input.message}}' : type === 'fallback' ? '{{input.message}}' : '{"data":{}}',
    query: '{{input.message}}',
    field: 'input.message',
    operator: 'equals',
    compare: '',
    ...(type === 'tool' ? { filters: [], match: 'all', limit: 10 } : {}),
    ...(type === 'condition'
      ? { match: 'all', rules: [{ field: 'input.message', operator: 'contains', compare: '' }] }
      : {}),
    ...(type === 'extract'
      ? { fields: [{ id: 'nama', label: 'Nama', type: 'text', required: true, hint: '', options: [] }] }
      : {}),
    ...(type === 'compute' ? { steps: [{ name: 'hasil', op: 'value', args: ['{{input.message}}'] }] } : {}),
    ...(type === 'media' ? { value: '', caption: '', send_when: 'before', media_as: 'auto' } : {}),
    ...(type === 'receive' ? { accept: ['image', 'document'] } : {}),
  };
}
async function loadLibrary() {
  const [profiles, templates] = await Promise.all([api(base), api(base + '/templates')]);
  $('profiles').replaceChildren();
  $('templates').replaceChildren();
  for (const template of templates) {
    const card = el('article', undefined, 'card');
    card.append(
      el('span', '✦', 'icon'),
      el('h3', template.definition.name),
      el('p', template.definition.description || 'Alur siap disesuaikan.'),
      btn('Gunakan template', () => create(template.definition)),
    );
    $('templates').append(card);
  }
  for (const p of profiles) {
    const card = el('article', undefined, 'card');
    card.append(
      el('span', '⑂', 'icon'),
      el('h3', p.draft.name),
      el('span', p.active ? 'Terbit · v' + p.published_revision : 'Draft', 'badge'),
      el('p', `${p.draft.nodes.length} node · ${p.draft.collections.length} koleksi`),
      btn('Buka editor', () => openProfile(p.id)),
    );
    $('profiles').append(card);
  }
  if (!profiles.length)
    $('profiles').append(el('p', 'Belum ada profil. Mulai dari template atau buat alur baru.', 'muted'));
}
async function create(d) {
  const result = await api(base, 'POST', d);
  await openProfile(result.id);
  notice('Profil dibuat sebagai draft.');
}
function applyProfile(p) {
  state.document = p.draft;
  state.id = p.id;
  state.revision = p.revision;
  state.published = p.published_revision;
  state.active = p.active;
  state.dirty = false;
  state.selected = null;
  state.undo = [];
  state.redo = [];
  state.pending = null;
  state.trace = {};
  state.history = [];
  state.context = null;
  $('chat').replaceChildren();
  $('trace').replaceChildren();
  $('samples').value = '{}';
  $('profile-name').value = p.draft.name;
  $('profile-description').value = p.draft.description;
  renderStatus();
  renderCanvas();
  renderInspector();
  renderCollections();
  renderIssues(p.issues);
  task(loadVersions);
}
async function openProfile(id) {
  if (state.dirty && !confirm('Draft belum disimpan. Tinggalkan perubahan?')) return;
  const p = await api(base + '/' + encodeURIComponent(id));
  applyProfile(p);
  $('library').hidden = true;
  $('editor').hidden = false;
  history.replaceState(null, '', '?profile=' + id);
  showTab('flow');
  requestAnimationFrame(fitCanvas);
}
function renderIssues(issues = []) {
  $('issues').replaceChildren();
  if (!issues.length) {
    $('issues').append(el('div', 'Alur valid untuk diterbitkan. Tetap uji hasil percakapannya.', 'issue success'));
    return;
  }
  for (const issue of issues) {
    const row = el('div', (issue.node ? issue.node + ': ' : '') + issue.message, 'issue');
    if (issue.node)
      row.append(
        btn('Buka node', () => {
          showTab('flow');
          selectNode(issue.node);
        }),
      );
    $('issues').append(row);
  }
}

let saving;
async function save() {
  if (saving) return saving;
  const before = snapshot(),
    id = state.id,
    revision = state.revision;
  saving = (async () => {
    const p = await api(base + '/' + id, 'PUT', { revision, definition: JSON.parse(before) });
    if (state.id !== id) return p;
    state.revision = p.revision;
    state.published = p.published_revision;
    state.active = p.active;
    if (snapshot() === before) {
      state.document = p.draft;
      state.dirty = false;
      renderCanvas();
      renderInspector();
      renderCollections();
    }
    renderStatus();
    renderIssues(p.issues);
    return p;
  })();
  try {
    return await saving;
  } finally {
    saving = null;
  }
}

function showTab(tab) {
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'schema') renderCollections();
  if (tab === 'settings') task(loadVersions);
}
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
$('create').onclick = () =>
  task(async () => {
    const input = newNode('input', 80, 180),
      memory = { ...newNode('memory', 400, 440), memory_limit: 20 },
      agent = newNode('agent', 640, 180),
      output = newNode('output', 920, 180);
    agent.memory = memory.id;
    output.value = `{{nodes.${agent.id}.answer}}`;
    await create({
      format: 'ncwa-profile',
      version: 1,
      name: 'Profil baru',
      description: '',
      collections: [],
      nodes: [input, memory, agent, output],
      edges: [
        { id: uid('edge'), source: input.id, port: 'next', target: agent.id },
        { id: uid('edge'), source: agent.id, port: 'next', target: output.id },
      ],
    });
  });
$('all-profiles').onclick = () =>
  task(async () => {
    if (state.dirty && !confirm('Draft belum disimpan. Tinggalkan perubahan?')) return;
    state.dirty = false;
    state.id = null;
    $('editor').hidden = true;
    $('library').hidden = false;
    history.replaceState(null, '', location.pathname);
    await loadLibrary();
  });
$('save').onclick = () =>
  task(async () => {
    await save();
    notice('Draft tersimpan.');
  }, $('save'));
$('publish').onclick = () =>
  task(async () => {
    await save();
    if (state.dirty) throw Error('Ada perubahan selama penyimpanan. Simpan kembali sebelum menerbitkan.');
    if (
      !confirm('Terbitkan draft ini? Sesi yang memakai profil akan menggunakan versi ini pada percakapan berikutnya.')
    )
      return;
    const p = await api(base + '/' + state.id + '/publish', 'POST', { revision: state.revision });
    state.published = p.published_revision;
    state.active = p.active;
    renderCollections();
    renderStatus();
    notice('Profil diterbitkan. Aktifkan melalui Profil AI di dashboard.');
  }, $('publish'));
$('export').onclick = () => download(state.document.name.replace(/[^a-z0-9_-]/gi, '_') + '.json', state.document);
$('duplicate').onclick = () =>
  task(async () => {
    const d = structuredClone(state.document);
    d.name = d.name.slice(0, 85) + ' (salinan)';
    await save();
    await create(d);
  });
$('profile-name').oninput = () => {
  mutate(() => (state.document.name = $('profile-name').value));
};
$('profile-description').oninput = () => {
  mutate(() => (state.document.description = $('profile-description').value));
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = () =>
  task(async () => {
    const file = $('import-file').files[0];
    if (!file) return;
    $('import-file').value = '';
    if (file.size > 120000) throw Error('File maksimal 120 KB.');
    const d = JSON.parse(await file.text());
    if (d.format !== 'ncwa-profile' || d.version !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.collections))
      throw Error('Format profil tidak didukung.');
    pendingImport = d;
    $('import-summary').replaceChildren(
      el('h3', String(d.name)),
      el('p', `${d.nodes.length} node · ${d.collections.length} koleksi`),
    );
    $('import-preview').showModal();
    $('import-file').value = '';
  });
$('cancel-import').onclick = () => $('import-preview').close();
$('confirm-import').onclick = () =>
  task(async () => {
    await create(pendingImport);
    $('import-preview').close();
  });
window.addEventListener('beforeunload', e => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
function renderCollections() {
  const host = $('collections');
  host.replaceChildren();
  if (!state.document.collections.length)
    host.append(el('div', 'Belum ada koleksi. Tambahkan misalnya Produk, Program, atau Pendaftaran.', 'empty'));
  for (const c of state.document.collections) {
    const card = el('section', undefined, 'collection'),
      head = el('div', undefined, 'collection-head');
    head.append(
      field('Nama koleksi', c.name, v => mutate(() => renameCollection(c, v))),
      btn(
        'Hapus',
        () => {
          if (confirm('Hapus definisi koleksi ' + c.name + '?')) {
            mutate(() => (state.document.collections = state.document.collections.filter(x => x !== c)));
            renderCollections();
          }
        },
        'danger',
      ),
    );
    card.append(
      head,
      field(
        'Kepemilikan data',
        c.owner || 'shared',
        v => {
          mutate(() => (c.owner = v));
          renderCollections();
        },
        'select',
        [
          { value: 'shared', label: 'Umum — dibaca semua pelanggan (katalog, jadwal, layanan)' },
          { value: 'customer', label: 'Milik pelanggan — terikat ke nomor pengirim (booking, pendaftaran)' },
        ],
      ),
      el(
        'p',
        c.owner === 'customer'
          ? 'Nomor pelanggan diisi otomatis oleh sistem. AI hanya bisa mencari, mengubah, dan menghapus record milik pelanggan yang sedang chat. Kepemilikan tidak bisa diubah selama koleksi berisi data.'
          : 'Semua pelanggan bisa membaca isi koleksi ini melalui AI.',
        'hint',
      ),
    );
    for (const f of c.fields) {
      const row = el('div', undefined, 'field-grid');
      row.append(
        field('Nama field', f.label, v => mutate(() => renameField(c, f, v))),
        field(
          'Tipe',
          f.type,
          v => {
            mutate(() => {
              f.type = v;
              if (['choice', 'multichoice'].includes(v) && !f.options.length) f.options = ['Pilihan 1'];
              if (v === 'relation') f.collection = c.id;
              if (!uniqueFieldTypes.includes(v)) delete f.unique;
              delete f.default;
            });
            renderCollections();
          },
          'select',
          Object.entries(fieldTypeLabels).map(([value, label]) => ({ value, label })),
        ),
        field('Wajib', f.required, v => mutate(() => (f.required = v)), 'checkbox'),
      );
      // Satu baris per field: Nama, Tipe, Wajib, Unik, Opsi/Koleksi tujuan, Nilai bawaan, Hapus.
      row.append(
        uniqueFieldTypes.includes(f.type)
          ? field(
              'Unik',
              Boolean(f.unique),
              v =>
                mutate(() => {
                  if (v) f.unique = true;
                  else delete f.unique;
                }),
              'checkbox',
            )
          : el('span'),
      );
      if (f.type === 'choice' || f.type === 'multichoice')
        row.append(
          field('Opsi (pisahkan koma)', f.options.join(', '), v =>
            mutate(
              () =>
                (f.options = v
                  .split(',')
                  .map(x => x.trim())
                  .filter(Boolean)),
            ),
          ),
        );
      else if (f.type === 'relation')
        row.append(
          field(
            'Koleksi tujuan',
            f.collection,
            v => mutate(() => (f.collection = v)),
            'select',
            // Koleksi umum tidak boleh menunjuk data milik pelanggan.
            state.document.collections
              .filter(t => c.owner === 'customer' || t.owner !== 'customer')
              .map(t => ({ value: t.id, label: t.name + (t.owner === 'customer' ? ' (milik pelanggan)' : '') })),
          ),
        );
      else row.append(el('span'));
      row.append(['relation', 'file'].includes(f.type) ? el('span') : defaultField(f));
      const remove = btn(
        '×',
        () => {
          mutate(() => (c.fields = c.fields.filter(x => x !== f)));
          renderCollections();
        },
        'danger',
      );
      remove.setAttribute('aria-label', 'Hapus field ' + f.label);
      row.append(remove);
      card.append(row);
    }
    card.append(
      btn('＋ Field', () => {
        mutate(() =>
          c.fields.push({
            id: slugId(
              'Field baru',
              c.fields.map(x => x.id),
              'field',
            ),
            label: 'Field baru',
            type: 'text',
            required: false,
            options: [],
            collection: '',
          }),
        );
        renderCollections();
      }),
    );
    host.append(card);
  }
}
// ID koleksi dan field dibuat dari namanya dan tidak ditampilkan. Selama belum pernah diterbitkan, ID ikut nama;
// setelah terbit ID dikunci karena record klien tersimpan memakai ID itu.
function slugId(text, taken, fallback) {
  let base = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 26);
  if (!/^[a-z]/.test(base)) base = (fallback + '_' + base).replace(/_+$/, '').slice(0, 26);
  if (['constructor', 'prototype', 'missing'].includes(base)) base = fallback + '_' + base;
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = base + '_' + i;
  return id;
}
const publishedCollection = id => state.active?.collections.find(c => c.id === id);
// Mengganti path variabel di semua teks node, misalnya nodes.cari.first.data.nama menjadi ...data.nama_produk.
function rewriteVariables(pattern, replace) {
  const fix = v => (typeof v === 'string' ? v.replace(pattern, replace) : v);
  for (const n of state.document.nodes) {
    for (const key of ['prompt', 'value', 'query', 'compare', 'caption', 'field']) n[key] = fix(n[key]);
    for (const f of n.filters ?? []) f.value = fix(f.value);
    for (const r of n.rules ?? []) {
      for (const x of r.rules ?? [r]) {
        x.field = fix(x.field);
        x.compare = fix(x.compare);
      }
    }
    for (const s of n.steps ?? []) s.args = s.args.map(fix);
  }
}
function renameCollection(c, name) {
  c.name = name;
  if (publishedCollection(c.id)) return;
  const next = slugId(
    name,
    state.document.collections.filter(x => x !== c).map(x => x.id),
    'koleksi',
  );
  if (next === c.id) return;
  for (const n of state.document.nodes) if (n.collection === c.id) n.collection = next;
  for (const x of state.document.collections) for (const f of x.fields) if (f.collection === c.id) f.collection = next;
  c.id = next;
}
function renameField(c, f, label) {
  f.label = label;
  if (publishedCollection(c.id)?.fields.some(x => x.id === f.id)) return;
  const next = slugId(
    label,
    c.fields.filter(x => x !== f).map(x => x.id),
    'field',
  );
  if (next === f.id) return;
  const tools = state.document.nodes.filter(n => n.type === 'tool' && n.collection === c.id);
  for (const n of tools) {
    for (const x of n.filters ?? []) if (x.field === f.id) x.field = next;
    if (n.sort_field === f.id) n.sort_field = next;
    if (n.sum_field === f.id) n.sum_field = next;
  }
  if (tools.length)
    rewriteVariables(
      new RegExp('(nodes\\.(?:' + tools.map(n => n.id).join('|') + ')\\.[\\w.]*?data\\.)' + f.id + '\\b', 'g'),
      '$1' + next,
    );
  f.id = next;
}
// Nilai bawaan diisi saat record baru dibuat tanpa nilai; bentuk isiannya mengikuti tipe field.
function defaultField(f) {
  const set = v =>
    mutate(() => {
      if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete f.default;
      else f.default = v;
    });
  const value = Array.isArray(f.default) ? f.default.join(', ') : (f.default ?? '');
  if (f.type === 'boolean')
    return field('Nilai bawaan', value === '' ? '' : String(value), v => set(v === '' ? '' : v === 'true'), 'select', [
      { value: '', label: 'Tidak ada' },
      { value: 'true', label: 'Ya' },
      { value: 'false', label: 'Tidak' },
    ]);
  if (f.type === 'choice')
    return field('Nilai bawaan', value, set, 'select', [{ value: '', label: 'Tidak ada' }, ...f.options]);
  if (f.type === 'multichoice')
    return field('Nilai bawaan (pisahkan koma)', value, v =>
      set(
        v
          .split(',')
          .map(x => x.trim())
          .filter(Boolean),
      ),
    );
  const type = { number: 'number', date: 'date', time: 'time', datetime: 'datetime-local' }[f.type] || 'text';
  const wrap = field('Nilai bawaan', value, v => set(f.type === 'number' ? (v === '' ? '' : Number(v)) : v), type);
  if (f.type === 'number') wrap.querySelector('input').step = 'any';
  return wrap;
}
$('add-collection').onclick = () => {
  mutate(() =>
    state.document.collections.push({
      id: slugId(
        'Koleksi baru',
        state.document.collections.map(c => c.id),
        'koleksi',
      ),
      name: 'Koleksi baru',
      owner: 'shared',
      fields: [],
    }),
  );
  renderCollections();
};
$('test-form').onsubmit = e => {
  e.preventDefault();
  task(runTest);
};
$('stop-test').onclick = () => state.controller?.abort();
$('reset-test').onclick = () => {
  state.controller?.abort();
  state.history = [];
  state.context = null;
  state.trace = {};
  $('chat').replaceChildren();
  $('trace').replaceChildren();
  renderCanvas();
};
async function runTest() {
  if (state.controller) return;
  const message = $('test-message').value.trim();
  if (!message) return;
  const records = JSON.parse($('samples').value || '{}');
  const controller = new AbortController();
  state.controller = controller;
  $('run-test').disabled = true;
  $('stop-test').hidden = false;
  state.trace = {};
  $('trace').replaceChildren();
  $('chat').append(el('div', message, 'bubble user'));
  try {
    const r = await fetch(base + '/' + state.id + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: state.document,
        message,
        history: state.history,
        records,
        context: state.context,
        media: $('test-media-name').value.trim()
          ? { filename: $('test-media-name').value.trim(), type: $('test-media-type').value }
          : null,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const d = await r.json();
      throw Error(d.message || d.error);
    }
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      state.trace[event.node] = event.state;
      renderCanvas();
      const detail = el('details'),
        summary = el(
          'summary',
          `${event.node} · ${event.state}${event.duration_ms ? ' · ' + event.duration_ms + ' ms' : ''}`,
        );
      detail.append(summary, el('pre', JSON.stringify(event, null, 2)));
      $('trace').append(detail);
      if (event.state === 'error') notice(event.error || event.output?.error || 'Eksekusi gagal.');
      if (event.node === 'output' && event.state === 'completed') {
        const result = event.output;
        state.context = result.context;
        state.history.push(
          { role: 'user', content: message },
          { role: 'assistant', content: result.answer || '[Diteruskan ke manusia]' },
        );
        state.history = state.history.slice(-60);
        // Simulasi tidak mengirim WhatsApp; media dari node Kirim media ditampilkan sebagai daftar.
        for (const m of (result.media ?? []).filter(m => m.when === 'before'))
          $('chat').append(
            el('div', '▣ ' + m.filename + (m.caption ? ' — ' + m.caption : ''), 'bubble assistant media'),
          );
        $('chat').append(el('div', result.answer || 'Percakapan diteruskan ke manusia.', 'bubble assistant'));
        for (const m of (result.media ?? []).filter(m => m.when === 'after'))
          $('chat').append(
            el('div', '▣ ' + m.filename + (m.caption ? ' — ' + m.caption : ''), 'bubble assistant media'),
          );
        $('samples').value = JSON.stringify(result.records, null, 2);
        $('test-message').value = '';
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, index));
        pending = pending.slice(index + 1);
      }
    }
    consume(pending + decoder.decode());
  } catch (e) {
    if (e.name === 'AbortError') notice('Pengujian dihentikan.');
    else throw e;
  } finally {
    state.controller = null;
    $('run-test').disabled = false;
    $('stop-test').hidden = true;
  }
}
task(async () => {
  await loadLibrary();
  const id = new URLSearchParams(location.search).get('profile');
  if (id) await openProfile(id);
});

$('profile-search').oninput = () => {
  const q = $('profile-search').value.toLowerCase();
  for (const card of $('profiles').children) card.hidden = !card.textContent.toLowerCase().includes(q);
};
async function loadVersions() {
  const id = state.id;
  if (!id) return;
  const versions = await api(base + '/' + id + '/versions');
  if (state.id !== id) return;
  $('versions').replaceChildren();
  if (!versions.length) $('versions').append(el('p', 'Belum ada versi terbit.', 'muted'));
  for (const v of versions) {
    const row = el('div', undefined, 'actions');
    row.append(
      el('p', 'Versi ' + v.revision + ' · ' + new Date(v.created_at).toLocaleString('id-ID')),
      btn('Pulihkan ke draft', async () => {
        if (
          !confirm(
            'Ganti draft dengan versi ' + v.revision + '? Versi terbit tetap berlaku sampai Anda menerbitkan lagi.',
          )
        )
          return;
        const d = await api(base + '/' + id + '/versions/' + v.revision);
        mutate(() => (state.document = d));
        $('profile-name').value = d.name;
        $('profile-description').value = d.description;
        renderCollections();
        renderInspector();
        notice('Versi dipulihkan ke draft. Simpan dan uji sebelum diterbitkan.');
      }),
    );
    $('versions').append(row);
  }
}

$('delete-profile').onclick = () =>
  task(async () => {
    if (!confirm('Hapus profil ' + state.document.name + ' beserta seluruh versi definisinya?')) return;
    await api(base + '/' + state.id, 'DELETE', { revision: state.revision });
    state.dirty = false;
    state.id = null;
    $('editor').hidden = true;
    $('library').hidden = false;
    history.replaceState(null, '', location.pathname);
    await loadLibrary();
    notice('Profil dihapus.');
  });
