// Siklus draft (simpan otomatis), impor/ekspor, struktur koleksi, pengaturan, dan uji coba. Kanvas dan inspector
// berbagi state editor ini.
const base = '/api/admin/ai/builder';
const profilesPage = '/dashboard/admin/profiles';
// [nama, keterangan, kategori, kata kunci pencarian]
const kinds = {
  input: ['Input', 'Pesan masuk dari pelanggan', 'flow', 'mulai awal pesan masuk'],
  memory: ['Memori percakapan', 'Riwayat pesan untuk node AI', 'data', 'riwayat history ingat memori percakapan'],
  context_memory: ['Memori konteks', 'Ringkasan S-P-O, ditulis Context', 'data', 'konteks spo ringkasan memori'],
  router: ['Router', 'Pilih jalur berdasarkan maksud', 'ai', 'cabang intent maksud pilih jalur'],
  agent: ['Agent', 'Susun jawaban dengan AI', 'ai', 'jawab balas ai llm model'],
  condition: ['Kondisi', 'Cabang ya / tidak dari nilai', 'logic', 'jika cabang aturan syarat if'],
  data_table: [
    'Data tabel',
    'Cari, ambil, ubah, atau hitung baris tabel',
    'data',
    'simpan cari ambil ubah hapus tabel baris record',
  ],
  data_text: ['Data teks', 'Baca teks panjang: SOP, syarat, FAQ', 'data', 'teks sop faq aturan dokumen baca paragraf'],
  data_form: [
    'Data isian',
    'Baca atau ubah satu isian: alamat, jam buka',
    'data',
    'isian formulir info alamat jam rekening',
  ],
  context: ['Context', 'Ringkas konteks percakapan', 'ai', 'ringkas konteks spo ringkasan'],
  output: ['Output', 'Kirim jawaban', 'flow', 'jawaban kirim akhir selesai'],
  fallback: ['Fallback', 'Teruskan ke manusia', 'flow', 'manusia tim cs admin petugas teruskan'],
  extract: ['Ekstrak', 'Kalimat pelanggan jadi isian terstruktur', 'ai', 'ambil isian struktur form field'],
  compute: ['Set / Hitung', 'Olah nilai dengan aturan pasti, tanpa AI', 'logic', 'hitung set rumus angka tanggal'],
  media: ['Kirim media', 'Gambar atau dokumen ke pelanggan', 'media', 'gambar dokumen kirim foto brosur file'],
  receive: ['Terima media', 'Simpan lampiran dari pelanggan', 'media', 'lampiran bukti upload terima gambar file'],
};
// Urutan kelompok di popover Tambah node.
const paletteGroups = [
  ['AI', ['agent', 'router', 'extract', 'context']],
  ['Logika', ['condition', 'compute']],
  ['Data', ['data_table', 'data_text', 'data_form']],
  ['Memori', ['context_memory', 'memory']],
  ['Media', ['media', 'receive']],
  ['Alur', ['input', 'output', 'fallback']],
];
// Warna ikon node; Fallback memakai warna peringatan agar jalurnya ke manusia mudah dikenali.
const nodeColor = type => (type === 'fallback' ? 'logic' : type === 'context_memory' ? 'ctx' : kinds[type][2]);
// Node yang bisa membaca Shared Memory; sama dengan memoryConsumers di definition.ts.
const memoryConsumers = ['router', 'agent', 'context', 'extract'];
const tierLabels = {
  cheap: 'Murah',
  medium: 'Sedang',
  smart: 'Cerdas',
  structured: 'Terstruktur',
  decision: 'Keputusan',
};
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

// Ikon garis 24×24; isinya konstanta statis, bukan data pengguna.
const icons = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  layout:
    '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  restart: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clip: '<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.3 3.3 0 014.7 4.7L9 17.3a1.7 1.7 0 01-2.4-2.4L14 7.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  braces:
    '<path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2.5-2 3 1 .5 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v2c0 2-1 3-3 3"/>',
  input: '<path d="M4 5h16v11H9l-5 4z"/>',
  memory: '<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
  router: '<path d="M4 12h6l4-6h6M10 12l4 6h6"/>',
  agent: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  condition: '<path d="M12 3l9 9-9 9-9-9z"/>',
  context: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  output: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  fallback: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  extract: '<path d="M8 4H5v16h3M16 4h3v16h-3"/><path d="M9 12h6"/>',
  compute: '<path d="M18 5H6l6 7-6 7h12"/>',
  media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  receive: '<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
};
icons.context_memory = '<path d="M4 6h16M4 12h11M4 18h7"/><circle cx="19" cy="16" r="2.5"/>';
icons.data_table = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>';
icons.data_text = '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/>';
icons.data_form = '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>';
// Node data dan jenis koleksi pasangannya; sama dengan dataNodeKinds di definition.ts.
const dataKinds = { data_table: 'list', data_text: 'text', data_form: 'form' };
const isDataNode = n => Object.hasOwn(dataKinds, n.type);
const kindOf = c => c?.kind ?? 'list';
const kindLabels = { list: 'Tabel', text: 'Teks', form: 'Isian' };
function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = icons[name] ?? '';
  return svg;
}
// Ilustrasi node gaya A (katalog desain): satu ilustrasi per jenis node, digambar di kotak 64×64. Isinya konstanta
// statis, bukan data pengguna.
const illustrations = {
  input:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#EEF7F1"/><path d="M14 20c0-4 3-7 7-7h22c4 0 7 3 7 7v14c0 4-3 7-7 7H27l-9 7v-7h1c-3 0-5-3-5-7z" fill="#fff" stroke="#3E8E6D" stroke-width="2.4" stroke-linejoin="round"/><path d="M22 24h20M22 31h13" stroke="#8CC4A8" stroke-width="2.4" stroke-linecap="round"/>',
  output:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#EEF7F1"/><path d="M50 20c0-4-3-7-7-7H21c-4 0-7 3-7 7v14c0 4 3 7 7 7h16l9 7v-7h-1c3 0 5-3 5-7z" fill="#CDEBD9" stroke="#3E8E6D" stroke-width="2.4" stroke-linejoin="round"/><path d="M22 28l4 4 7-8M30 30l2 2 7-8" stroke="#2F7A5B" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  fallback:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#FFF3E2"/><circle cx="40" cy="24" r="7" fill="#F6C99A"/><path d="M28 50c1-8 6-12 12-12s11 4 12 12z" fill="#D98B2B"/><path d="M10 34h16m-5-5l5 5-5 5" stroke="#C27A1A" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20c0-3 2-5 5-5h6" stroke="#E6B878" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  router:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#F1EEFC"/><rect x="30" y="12" width="4" height="42" rx="2" fill="#6B5BC9"/><path d="M34 16h16l5 5-5 5H34z" fill="#8E7FE0"/><path d="M30 30H14l-5 5 5 5h16z" fill="#B5ABEA"/><path d="M34 42h13l4 4-4 4H34z" fill="#8E7FE0"/><rect x="24" y="52" width="16" height="4" rx="2" fill="#6B5BC9"/>',
  condition:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#FBF3E4"/><path d="M32 54V34M32 34L18 20M32 34l14-14" stroke="#B7791F" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="16" cy="17" r="7" fill="#DDF1E5" stroke="#2F7A5B" stroke-width="2"/><path d="M13 17l2 2 4-4" stroke="#2F7A5B" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="48" cy="17" r="7" fill="#FBE3E6" stroke="#B42335" stroke-width="2"/><path d="M45 14l6 6M51 14l-6 6" stroke="#B42335" stroke-width="2" stroke-linecap="round"/>',
  agent:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#F1EEFC"/><circle cx="32" cy="26" r="9" fill="#FCE3CC"/><path d="M23 24c0-6 4-10 9-10s9 4 9 10c-3-3-6-4-9-4s-6 1-9 4z" fill="#4A3F7A"/><path d="M16 52c2-9 8-14 16-14s14 5 16 14z" fill="#8E7FE0"/><path d="M20 26a12 12 0 0124 0" fill="none" stroke="#2E2A45" stroke-width="2.2"/><rect x="18" y="24" width="5" height="8" rx="2.5" fill="#2E2A45"/><rect x="41" y="24" width="5" height="8" rx="2.5" fill="#2E2A45"/>',
  context:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#F1EEFC"/><path d="M14 14h32v26L36 50H14z" fill="#FFF3B8" stroke="#C9A93A" stroke-width="2" stroke-linejoin="round"/><path d="M36 50V40h10" fill="#F1DE8C" stroke="#C9A93A" stroke-width="2" stroke-linejoin="round"/><path d="M20 22h20M20 29h16" stroke="#C9A93A" stroke-width="2.2" stroke-linecap="round"/><path d="M44 30l10-10 4 4-10 10-5 1z" fill="#8E7FE0" stroke="#5A48C2" stroke-width="1.6" stroke-linejoin="round"/>',
  extract:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#F1EEFC"/><path d="M10 14c0-3 2-5 5-5h18c3 0 5 2 5 5v9c0 3-2 5-5 5H20l-6 5v-5c-2 0-4-2-4-5z" fill="#fff" stroke="#6B5BC9" stroke-width="2" stroke-linejoin="round"/><path d="M16 16h16M16 21h10" stroke="#B5ABEA" stroke-width="2" stroke-linecap="round"/><path d="M40 20c6 0 9 4 9 9" stroke="#8E7FE0" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M45 26l4 4 4-4" stroke="#8E7FE0" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="18" y="36" width="36" height="8" rx="3" fill="#fff" stroke="#6B5BC9" stroke-width="1.8"/><rect x="18" y="47" width="36" height="8" rx="3" fill="#fff" stroke="#6B5BC9" stroke-width="1.8"/><rect x="20" y="38" width="10" height="4" rx="1.5" fill="#8E7FE0"/><rect x="20" y="49" width="7" height="4" rx="1.5" fill="#8E7FE0"/><path d="M34 40h14M31 51h10" stroke="#CFC7F2" stroke-width="2" stroke-linecap="round"/>',
  compute:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#FBF3E4"/><rect x="16" y="10" width="32" height="44" rx="6" fill="#fff" stroke="#B7791F" stroke-width="2.2"/><rect x="21" y="15" width="22" height="9" rx="2" fill="#2E3A33"/><path d="M34 19.5h6" stroke="#C8F0D4" stroke-width="2" stroke-linecap="round"/><g fill="#E8C58F"><rect x="21" y="29" width="6" height="5" rx="1.5"/><rect x="29" y="29" width="6" height="5" rx="1.5"/><rect x="37" y="29" width="6" height="5" rx="1.5"/><rect x="21" y="37" width="6" height="5" rx="1.5"/><rect x="29" y="37" width="6" height="5" rx="1.5"/><rect x="21" y="45" width="6" height="5" rx="1.5"/><rect x="29" y="45" width="6" height="5" rx="1.5"/></g><rect x="37" y="37" width="6" height="13" rx="1.5" fill="#B7791F"/>',
  data_table:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#EAF1FB"/><rect x="12" y="14" width="40" height="36" rx="4" fill="#fff" stroke="#3F6FB5" stroke-width="2.2"/><rect x="12" y="14" width="40" height="9" rx="4" fill="#9DB9E0"/><path d="M12 32h40M12 41h40M25 23v27M38 23v27" stroke="#C6D7EF" stroke-width="2"/>',
  data_text:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#EAF1FB"/><path d="M18 10h20l10 10v34H18z" fill="#fff" stroke="#3F6FB5" stroke-width="2.4" stroke-linejoin="round"/><path d="M38 10v10h10" fill="#D6E3F6" stroke="#3F6FB5" stroke-width="2.4" stroke-linejoin="round"/><path d="M24 28h18M24 35h18M24 42h12" stroke="#9DB9E0" stroke-width="2.4" stroke-linecap="round"/>',
  data_form:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#EAF1FB"/><rect x="12" y="12" width="40" height="40" rx="6" fill="#fff" stroke="#3F6FB5" stroke-width="2.2"/><path d="M18 22h8M18 32h8M18 42h8" stroke="#3F6FB5" stroke-width="2.2" stroke-linecap="round"/><rect x="30" y="18" width="16" height="8" rx="2" fill="#EAF1FB" stroke="#9DB9E0" stroke-width="1.6"/><rect x="30" y="28" width="16" height="8" rx="2" fill="#EAF1FB" stroke="#9DB9E0" stroke-width="1.6"/><rect x="30" y="38" width="16" height="8" rx="2" fill="#EAF1FB" stroke="#9DB9E0" stroke-width="1.6"/>',
  memory:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#F1EEFC"/><rect x="12" y="12" width="28" height="12" rx="6" fill="#E4E0F7"/><rect x="24" y="27" width="28" height="12" rx="6" fill="#CDEBD9"/><rect x="12" y="42" width="28" height="12" rx="6" fill="#E4E0F7"/><circle cx="48" cy="48" r="9" fill="#fff" stroke="#6B5BC9" stroke-width="2.2"/><path d="M48 43v5l3 2" stroke="#6B5BC9" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  context_memory:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#E6F6F2"/><path d="M14 18h36v30H14z" fill="#fff" stroke="#1F7A6D" stroke-width="2.2" stroke-linejoin="round" transform="rotate(-4 32 33)"/><path d="M20 30h24M20 37h16" stroke="#7CC5B8" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="16" r="5.5" fill="#E0655A"/><circle cx="30.5" cy="14.5" r="1.8" fill="#F3A49C"/>',
  media:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#FBEFF5"/><rect x="10" y="16" width="26" height="22" rx="3" fill="#fff" stroke="#B0467F" stroke-width="2" transform="rotate(-8 23 27)"/><circle cx="18" cy="23" r="2.6" fill="#F2B9D3"/><path d="M13 35l7-6 5 4 7-6" stroke="#E2A9C6" stroke-width="2" fill="none" transform="rotate(-8 23 27)"/><path d="M24 22h14l6 6v20H24z" fill="#fff" stroke="#B0467F" stroke-width="2" stroke-linejoin="round"/><path d="M38 22v6h6" fill="#F6D9E7" stroke="#B0467F" stroke-width="2"/><rect x="27" y="34" width="12" height="6" rx="1.5" fill="#B0467F"/><path d="M29 37h8" stroke="#fff" stroke-width="1.6"/><path d="M40 46l16-8-5 16-4-5z" fill="#B0467F" stroke="#8C2F62" stroke-width="1.4" stroke-linejoin="round"/><path d="M47 49l9-11" stroke="#fff" stroke-width="1.4"/>',
  receive:
    '<rect x="4" y="4" width="56" height="56" rx="16" fill="#FBEFF5"/><rect x="22" y="10" width="20" height="16" rx="3" fill="#fff" stroke="#B0467F" stroke-width="2"/><circle cx="28" cy="16" r="2" fill="#E2A9C6"/><path d="M24 24l6-5 4 3 6-5" stroke="#E2A9C6" stroke-width="2" fill="none"/><path d="M32 28v8m-4-4l4 4 4-4" stroke="#B0467F" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 38h12l3 6h14l3-6h12v14H10z" fill="#fff" stroke="#B0467F" stroke-width="2.2" stroke-linejoin="round"/>',
};
function nodeIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'node-illustration');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = illustrations[type] ?? '';
  return svg;
}
function iconButton(name, label, fn, className = 'icon-btn ghost') {
  const b = btn('', fn, className);
  b.append(svgIcon(name));
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}
for (const node of document.querySelectorAll('[data-icon]')) node.prepend(svgIcon(node.dataset.icon));

const state = {
  id: null,
  document: null,
  active: null,
  revision: 0,
  published: 0,
  issues: [],
  selected: null,
  dirty: false,
  saveState: 'saved',
  savedAt: null,
  saveError: '',
  undo: [],
  redo: [],
  pan: { x: 25, y: 15 },
  zoom: 0.85,
  pending: null,
  trace: {},
  traceSteps: {},
  history: [],
  context: null,
  controller: null,
  side: 'inspector',
  collection: 0,
  openField: -1,
};
let pendingImport;
function snapshot() {
  return JSON.stringify(state.document);
}
// Perbandingan tanpa peduli urutan kunci: server menormalkan definisi, jadi urutan kunci bisa berbeda dari klien.
function canonical(value) {
  const sort = v =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sort(v[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}
function checkpoint() {
  state.undo.push(snapshot());
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
}
function changed() {
  state.dirty = true;
  state.saveState = 'dirty';
  renderStatus();
  scheduleSave();
}
function mutate(fn) {
  checkpoint();
  fn();
  changed();
  renderCanvas();
}
const unpublished = () => !state.active || canonical(state.document) !== canonical(state.active);
function renderStatus() {
  if (!state.document) return;
  $('profile-title').textContent = state.document.name;
  $('revision').textContent = state.published ? 'Terbit v' + state.published : 'Belum diterbitkan';
  $('revision').className = 'chip' + (state.published ? ' ok' : '');
  $('unpublished').hidden = !state.published || !unpublished();
  const status = $('dirty');
  status.className = 'save-state ' + state.saveState;
  status.replaceChildren();
  if (state.saveState === 'saved') status.append(svgIcon('check'));
  if (state.saveState === 'error') status.append(svgIcon('alert'));
  status.append(
    {
      saved:
        'Tersimpan' + (state.savedAt ? ' ' + state.savedAt.toLocaleTimeString('id-ID', { timeStyle: 'short' }) : ''),
      dirty: 'Belum disimpan',
      saving: 'Menyimpan…',
      error: 'Gagal menyimpan',
    }[state.saveState],
  );
  status.title = state.saveError;
  $('undo').disabled = !state.undo.length;
  $('redo').disabled = !state.redo.length;
  const publish = $('publish');
  publish.disabled = state.issues.length > 0 || !unpublished();
  publish.textContent = state.published && !unpublished() ? 'Sudah terbit' : 'Terbitkan';
  publish.title = state.issues.length ? 'Perbaiki ' + state.issues.length + ' masalah sebelum menerbitkan.' : '';
}
// Harus sama dengan ports() di server (definition.ts).
function nodePorts(n) {
  if (['output', 'fallback', 'memory'].includes(n.type)) return [];
  if (n.type === 'router') return n.branches.map(b => b.id);
  if (n.type === 'agent' && n.fallback) return ['next', 'fallback'];
  if (n.type === 'condition') return ['yes', 'no'];
  if (n.type === 'data_table' && ['search', 'get'].includes(n.operation)) return ['found', 'empty'];
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
const portLabel = (n, port) => n.branches.find(b => b.id === port)?.label || portLabels[port] || port;
const nodeLabel = id => state.document?.nodes.find(n => n.id === id)?.label ?? id;
function uid(prefix) {
  return prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 8);
}
// Nama node unik, tanpa spasi (spasi otomatis menjadi _), dan ID-nya dibentuk dari nama, supaya nama dan variabel
// hampir sama, misalnya Layanan_pelanggan → {{nodes.layanan_pelanggan.answer}}.
const nodeName = text => text.replace(/\s/g, '_');
const labelKey = label =>
  label
    .trim()
    .replace(/[\s_]+/g, '_')
    .toLowerCase();
const duplicateLabel = (n, nodes = state.document.nodes) =>
  nodes.some(x => x !== n && labelKey(x.label) === labelKey(n.label));
function uniqueLabel(base, nodes) {
  let label = base;
  for (let i = 2; nodes.some(n => labelKey(n.label) === labelKey(label)); i++) label = base + '_' + i;
  return label;
}
const nodeIdFor = (label, type, nodes) =>
  slugId(
    label,
    nodes.map(n => n.id),
    type,
  );
// Mengganti nama node sekaligus ID-nya; koneksi, tool Agent, memori, dan variabel {{nodes.<id>...}} ikut diganti.
function renameNode(n, label) {
  n.label = label;
  const next = nodeIdFor(
    label,
    n.type,
    state.document.nodes.filter(x => x !== n),
  );
  if (next === n.id) return;
  const old = n.id;
  for (const e of state.document.edges) {
    if (e.source === old) e.source = next;
    if (e.target === old) e.target = next;
  }
  for (const x of state.document.nodes) {
    x.tools = x.tools.map(t => (t === old ? next : t));
    if (x.memory === old) x.memory = next;
    if (x.context_memory === old) x.context_memory = next;
  }
  rewriteVariables(new RegExp('(nodes\\.)' + old + '(?![\\w])', 'g'), '$1' + next);
  n.id = next;
  if (state.selected === old) state.selected = next;
  for (const map of [state.trace, state.traceSteps])
    if (old in map) {
      map[next] = map[old];
      delete map[old];
    }
}
// Saat profil dibuka: spasi di nama lama diganti _ (ID tetap), dan ID acak dari versi editor sebelumnya (misalnya
// agent_85314d14) diganti ID dari nama.
function readableNodeIds() {
  let changed = 0;
  for (const n of state.document.nodes) {
    const label = nodeName(n.label.trim());
    if (/^[a-z]+_[0-9a-f]{8}$/.test(n.id)) {
      const before = [n.id, n.label];
      renameNode(n, label);
      if (n.id !== before[0] || n.label !== before[1]) changed++;
    } else if (label !== n.label) {
      n.label = label;
      changed++;
    }
  }
  return changed;
}
function newNode(type, x = 120, y = 140, nodes = state.document?.nodes ?? []) {
  const label = uniqueLabel(nodeName(type === 'compute' ? 'Hitung' : kinds[type][0]), nodes);
  return {
    id: nodeIdFor(label, type, nodes),
    type,
    label,
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
    collection: dataKinds[type] ? state.document?.collections.find(c => kindOf(c) === dataKinds[type])?.id || '' : '',
    operation: type === 'data_table' ? 'search' : 'get',
    value: type === 'output' ? '{{input.message}}' : type === 'fallback' ? '{{input.message}}' : '{"data":{}}',
    query: '{{input.message}}',
    field: 'input.message',
    operator: 'equals',
    compare: '',
    ...(type === 'data_table' ? { filters: [], match: 'all', limit: 10 } : {}),
    ...(type === 'data_text' ? { max_chars: 4000 } : {}),
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

// Halaman tanpa ?profile= hanya untuk membuat profil; daftar profil ada di halaman Profil AI dashboard.
async function create(d) {
  const result = await api(base, 'POST', d);
  await openProfile(result.id, true);
  notice('Profil dibuat sebagai draft.');
}
function applyProfile(p) {
  state.document = p.draft;
  state.id = p.id;
  state.revision = p.revision;
  state.published = p.published_revision;
  state.active = p.active;
  state.issues = p.issues;
  state.dirty = false;
  state.saveState = 'saved';
  state.savedAt = null;
  state.saveError = '';
  state.selected = null;
  state.undo = [];
  state.redo = [];
  state.pending = null;
  state.collection = 0;
  state.openField = -1;
  resetTest();
  $('samples').value = '{}';
  $('profile-name').value = p.draft.name;
  $('profile-description').value = p.draft.description;
  renderStatus();
  renderCanvas();
  renderInspector();
  renderCollections();
  renderIssues();
}
async function openProfile(id, skipConfirm = false) {
  if (!skipConfirm && state.dirty && !confirm('Draft belum tersimpan. Tinggalkan perubahan?')) return;
  const p = await api(base + '/' + encodeURIComponent(id));
  applyProfile(p);
  const renamed = readableNodeIds();
  if (renamed) {
    checkpoint();
    changed();
    renderAll();
    notice(renamed + ' nama/ID node dirapikan (tanpa spasi, ID mengikuti nama). Draft disimpan otomatis.');
  }
  $('library').hidden = true;
  $('editor').hidden = false;
  $('tabs').hidden = false;
  $('editor-actions').hidden = false;
  $('revision').hidden = false;
  history.replaceState(null, '', '?profile=' + id);
  showTab('flow');
  showSide('inspector');
  requestAnimationFrame(fitCanvas);
}
function issueText(issue) {
  return (issue.node ? nodeLabel(issue.node) + ': ' : '') + issue.message;
}
function openIssue(issue) {
  $('issues-menu').hidePopover?.();
  showTab('flow');
  if (issue.node) {
    showSide('inspector');
    selectNode(issue.node);
  }
}
// Masalah dari validasi server tampil di tiga tempat: tombol di bilah atas, daftar di Pengaturan, dan node terkait.
function renderIssues() {
  const issues = state.issues;
  const button = $('issues-button');
  button.hidden = !issues.length;
  button.replaceChildren(svgIcon('alert'), issues.length + ' masalah');
  $('issues-list').replaceChildren(
    ...issues.map(issue => {
      const item = el('button', undefined, 'menu-item');
      item.type = 'button';
      item.append(svgIcon('alert'), el('span', issueText(issue)));
      item.onclick = () => openIssue(issue);
      return item;
    }),
  );
  const list = el('div', undefined, 'issue-list');
  if (!issues.length) {
    const ok = el('div', undefined, 'issue success');
    ok.append(svgIcon('check'), el('span', 'Alur valid untuk diterbitkan. Tetap uji hasil percakapannya.'));
    list.append(ok);
  }
  for (const issue of issues) {
    const row = el('div', undefined, 'issue');
    row.append(svgIcon('alert'), el('span', issueText(issue)));
    if (issue.node) row.append(btn('Buka node', () => openIssue(issue), 'btn small'));
    list.append(row);
  }
  $('issues').replaceChildren(list);
  renderStatus();
}

// Simpan otomatis: setiap perubahan menjadwalkan simpan draft setelah jeda singkat; Ctrl+S menyimpan seketika.
let saving = null,
  saveTimer,
  lastSaveError = '';
async function save() {
  if (saving) return saving;
  const before = snapshot(),
    id = state.id,
    revision = state.revision;
  state.saveState = 'saving';
  renderStatus();
  saving = (async () => {
    const p = await api(base + '/' + id, 'PUT', { revision, definition: JSON.parse(before) });
    if (state.id !== id) return p;
    state.revision = p.revision;
    state.published = p.published_revision;
    state.active = p.active;
    state.issues = p.issues;
    if (snapshot() === before) {
      state.dirty = false;
      // Hanya ganti dokumen bila server menormalkan isinya, supaya ketikan di inspector tidak terganggu.
      if (canonical(p.draft) !== canonical(state.document)) {
        state.document = p.draft;
        keepFocus(renderAll);
      }
    }
    state.saveState = state.dirty ? 'dirty' : 'saved';
    state.savedAt = new Date();
    state.saveError = lastSaveError = '';
    renderIssues();
    renderCanvas();
    if (state.dirty) scheduleSave();
    return p;
  })();
  try {
    return await saving;
  } catch (e) {
    state.saveState = 'error';
    state.saveError = e.message;
    renderStatus();
    throw e;
  } finally {
    saving = null;
  }
}
function scheduleSave(delay = 900) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      flushSave().catch(e => {
        if (e.message !== lastSaveError) notice(e.message);
        lastSaveError = e.message;
      }),
    delay,
  );
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (typeof drag !== 'undefined' && drag) return scheduleSave();
  if (saving) await saving.catch(() => {});
  if (!state.id || !state.dirty) return;
  await save();
}
function renderAll() {
  renderCanvas();
  renderInspector();
  renderCollections();
  for (const [id, key] of [
    ['profile-name', 'name'],
    ['profile-description', 'description'],
  ])
    if (document.activeElement !== $(id)) $(id).value = state.document[key];
}
// Menggambar ulang panel sambil mempertahankan kolom yang sedang diketik (dicari lewat aria-label dan urutannya).
function keepFocus(fn) {
  const active = document.activeElement,
    scope = active?.closest?.('#inspector,#collections'),
    label = active?.getAttribute?.('aria-label'),
    same = () =>
      [...(scope?.querySelectorAll('[aria-label]') ?? [])].filter(x => x.getAttribute('aria-label') === label),
    index = scope && label ? same().indexOf(active) : -1,
    range = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  fn();
  if (index < 0) return;
  const next = same()[index];
  if (!next) return;
  next.focus();
  if (range) next.setSelectionRange?.(...range);
}

function showTab(tab) {
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== tab;
  for (const b of document.querySelectorAll('[data-tab]'))
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  if (tab === 'schema') renderCollections();
  if (tab === 'settings') task(loadSettings);
}
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
// Panel samping kanvas: inspector node atau uji coba.
function showSide(mode) {
  state.side = mode;
  $('inspector').hidden = mode !== 'inspector';
  $('tester').hidden = mode !== 'tester';
  $('flow').classList.toggle('testing', mode === 'tester');
  $('test-toggle').setAttribute('aria-pressed', String(mode === 'tester'));
  if (mode === 'tester') {
    showTab('flow');
    $('test-message').focus();
  }
}
$('test-toggle').onclick = () => showSide(state.side === 'tester' ? 'inspector' : 'tester');
$('close-test').onclick = () => showSide('inspector');

$('create').onclick = () =>
  task(async () => {
    const nodes = [];
    for (const [type, x, y] of [
      ['input', 80, 180],
      ['memory', 400, 440],
      ['agent', 400, 180],
      ['output', 720, 180],
    ])
      nodes.push(newNode(type, x, y, nodes));
    const [input, memory, agent, output] = nodes;
    memory.memory_limit = 20;
    agent.memory = memory.id;
    output.value = `{{nodes.${agent.id}.answer}}`;
    await create({
      format: 'ncwa-profile',
      version: 1,
      name: 'Profil baru',
      description: '',
      collections: [],
      nodes,
      edges: [
        { id: uid('edge'), source: input.id, port: 'next', target: agent.id },
        { id: uid('edge'), source: agent.id, port: 'next', target: output.id },
      ],
    });
  }, $('create'));
$('all-profiles').onclick = () =>
  task(async () => {
    if (state.dirty) await flushSave().catch(() => {});
    if (state.dirty && !confirm('Draft belum tersimpan. Tinggalkan perubahan?')) return;
    state.dirty = false;
    location.href = profilesPage;
  });
$('publish').onclick = () =>
  task(async () => {
    await flushSave();
    if (state.dirty) throw Error('Ada perubahan selama penyimpanan. Coba terbitkan lagi.');
    if (state.issues.length) throw Error('Perbaiki masalah alur sebelum menerbitkan.');
    if (
      !confirm('Terbitkan draft ini? Sesi yang memakai profil akan menggunakan versi ini pada percakapan berikutnya.')
    )
      return;
    const p = await api(base + '/' + state.id + '/publish', 'POST', { revision: state.revision });
    state.published = p.published_revision;
    state.active = p.active;
    renderCollections();
    renderStatus();
    if (!$('settings').hidden) await loadSettings();
    notice('Profil diterbitkan. Aktifkan melalui Profil AI di dashboard.');
  }, $('publish'));
$('export').onclick = () => download(state.document.name.replace(/[^a-z0-9_-]/gi, '_') + '.json', state.document);
$('duplicate').onclick = () =>
  task(async () => {
    const d = structuredClone(state.document);
    d.name = d.name.slice(0, 85) + ' (salinan)';
    await flushSave();
    await create(d);
  }, $('duplicate'));
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
    previewImport(JSON.parse(await file.text()));
  });
function previewImport(d) {
  if (d?.format !== 'ncwa-profile' || d.version !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.collections))
    throw Error('Format profil tidak didukung: butuh "format": "ncwa-profile" dan "version": 1.');
  pendingImport = d;
  $('import-summary').replaceChildren(
    el('h3', String(d.name)),
    el('p', `${d.nodes.length} node · ${d.collections.length} koleksi`, 'hint'),
  );
  $('import-preview').showModal();
}
// Tempel JSON: jawaban AI biasanya dibungkus blok ```json atau diapit kalimat; ambil objek JSON terluar saja.
function pastedDefinition(text) {
  const body = text.trim();
  if (body.length > 120000) throw Error('JSON maksimal 120 KB.');
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : body;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{'),
      end = candidate.lastIndexOf('}');
    if (start < 0) throw Error('Tidak ada objek JSON yang bisa dibaca.');
    if (end <= start) throw Error('JSON tidak valid: objek tidak lengkap, mungkin jawaban AI terpotong.');
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (e) {
      throw Error('JSON tidak valid: ' + e.message);
    }
  }
}
$('paste').onclick = () => {
  $('paste-json').value = '';
  $('paste-error').hidden = true;
  $('paste-dialog').showModal();
  $('paste-json').focus();
};
$('cancel-paste').onclick = () => $('paste-dialog').close();
$('confirm-paste').onclick = () => {
  try {
    const d = pastedDefinition($('paste-json').value);
    $('paste-dialog').close();
    previewImport(d);
  } catch (e) {
    $('paste-error').textContent = e.message;
    $('paste-error').hidden = false;
  }
};
$('cancel-import').onclick = () => $('import-preview').close();
$('confirm-import').onclick = () =>
  task(async () => {
    await create(pendingImport);
    $('import-preview').close();
  }, $('confirm-import'));
window.addEventListener('beforeunload', e => {
  if (state.dirty || saving) {
    flushSave().catch(() => {});
    e.preventDefault();
    e.returnValue = '';
  }
});

// Struktur data: daftar koleksi di kiri, satu koleksi terpilih di kanan dengan tabel field.
function usedBy(c) {
  const tools = state.document.nodes.filter(n => isDataNode(n) && n.collection === c.id);
  const agents = state.document.nodes.filter(a => a.type === 'agent' && a.tools.some(t => tools.some(x => x.id === t)));
  const relations = state.document.collections.filter(x => x !== c && x.fields.some(f => f.collection === c.id));
  return { tools, agents, relations };
}
function renderCollections() {
  if (!state.document) return;
  const list = $('collection-list'),
    host = $('collections'),
    collections = state.document.collections;
  state.collection = Math.min(state.collection, collections.length - 1);
  list.replaceChildren(
    ...collections.map((c, i) => {
      const item = el('button', undefined, 'collection-item'),
        use = usedBy(c);
      item.type = 'button';
      item.setAttribute('aria-current', String(i === state.collection));
      item.append(
        el('strong', c.name),
        el(
          'small',
          kindLabels[kindOf(c)] +
            (kindOf(c) === 'list' ? ' · ' + (c.owner === 'customer' ? 'milik pelanggan' : 'umum') : '') +
            (kindOf(c) === 'text' ? '' : ' · ' + c.fields.length + ' field') +
            ' · ' +
            use.tools.length +
            ' node',
        ),
      );
      item.onclick = () => {
        state.collection = i;
        state.openField = -1;
        renderCollections();
      };
      return item;
    }),
  );
  host.replaceChildren();
  const c = collections[state.collection];
  if (!c) {
    host.append(el('div', 'Belum ada koleksi. Tambahkan misalnya Produk, Program, atau Pendaftaran.', 'empty'));
    return;
  }
  const card = el('section', undefined, 'collection'),
    head = el('div', undefined, 'collection-head');
  head.append(
    field('Nama koleksi', c.name, v => {
      mutate(() => renameCollection(c, v));
      list.children[state.collection]?.firstChild?.replaceWith(el('strong', c.name));
    }),
    el('span', undefined, 'spacer'),
    iconButton('trash', 'Hapus koleksi ' + c.name, () => {
      if (!confirm('Hapus definisi koleksi ' + c.name + '?')) return;
      mutate(() => (state.document.collections = state.document.collections.filter(x => x !== c)));
      state.collection = Math.max(0, state.collection - 1);
      renderCollections();
    }),
  );
  const locked = Boolean(publishedCollection(c.id)),
    note = el('p', undefined, 'id-note');
  note.append(
    'ID ',
    el('span', c.id, 'mono'),
    locked ? ' · terkunci karena sudah diterbitkan' : ' · mengikuti nama sampai diterbitkan',
  );
  card.append(head, note);
  // Jenis koleksi: Tabel (banyak baris), Teks (satu teks panjang), atau Isian (satu formulir). Teks dan isian selalu
  // umum; teks tidak memakai field.
  const kinds = el('fieldset', undefined, 'owner-choice kind-choice');
  kinds.append(el('legend', 'Jenis koleksi'));
  for (const [value, title, text] of [
    ['list', 'Tabel', 'Banyak baris berfield: produk, jadwal, booking. Dibaca node Data tabel.'],
    ['text', 'Teks', 'Satu teks panjang, maks 20.000 karakter: SOP, syarat, FAQ bebas. Dibaca node Data teks.'],
    ['form', 'Isian', 'Satu formulir berfield tetap: alamat, jam buka, rekening. Dibaca node Data isian.'],
  ]) {
    const option = el('label', undefined, 'owner-card'),
      radio = el('input'),
      copy = el('span');
    radio.type = 'radio';
    radio.name = 'kind-' + state.collection;
    radio.checked = kindOf(c) === value;
    radio.onchange = () => {
      if (
        value === 'text' &&
        c.fields.length &&
        !confirm('Koleksi teks tidak memakai field. Hapus ' + c.fields.length + ' field?')
      ) {
        renderCollections();
        return;
      }
      mutate(() => {
        if (value === 'list') delete c.kind;
        else {
          c.kind = value;
          c.owner = 'shared';
        }
        if (value === 'text') c.fields = [];
      });
      renderCollections();
    };
    copy.append(el('strong', title), el('small', text));
    option.append(radio, copy);
    kinds.append(option);
  }
  card.append(kinds);
  const owner = el('fieldset', undefined, 'owner-choice');
  owner.append(el('legend', 'Kepemilikan data'));
  for (const [value, title, text] of [
    ['shared', 'Umum', 'Satu isi untuk semua pelanggan. Cocok untuk katalog, jadwal, atau FAQ.'],
    [
      'customer',
      'Milik pelanggan',
      'Setiap record terikat ke nomor pengirim. Cocok untuk booking, pesanan, atau pendaftaran.',
    ],
  ]) {
    const option = el('label', undefined, 'owner-card'),
      radio = el('input'),
      copy = el('span');
    radio.type = 'radio';
    radio.name = 'owner-' + state.collection;
    radio.checked = (c.owner || 'shared') === value;
    radio.onchange = () => {
      mutate(() => (c.owner = value));
      renderCollections();
    };
    copy.append(el('strong', title), el('small', text));
    option.append(radio, copy);
    owner.append(option);
  }
  if (kindOf(c) !== 'list')
    card.append(
      el(
        'p',
        kindOf(c) === 'text'
          ? 'Setiap akun mengisi satu teks di Asisten AI › Knowledge. Dipakai lewat node Data teks atau variabel {{data.' +
              c.id +
              '}}.'
          : 'Setiap akun mengisi satu formulir di Asisten AI › Knowledge. Dipakai lewat node Data isian atau variabel {{data.' +
              c.id +
              '.<field>}}.',
        'hint',
      ),
    );
  else
    card.append(
      owner,
      el(
        'p',
        c.owner === 'customer'
          ? 'Nomor pelanggan diisi otomatis oleh sistem. AI hanya bisa mencari, mengubah, dan menghapus record milik pelanggan yang sedang chat. Kepemilikan tidak bisa diubah selama koleksi berisi data.'
          : 'Semua pelanggan bisa membaca isi koleksi ini melalui AI.',
        'hint',
      ),
    );
  const use = usedBy(c),
    used = el('div', undefined, 'used-by');
  used.append('Dipakai oleh');
  const pill = (icon, text, fn) => {
    const b = el('button', undefined, 'pill');
    b.type = 'button';
    b.append(svgIcon(icon), text);
    b.onclick = fn;
    return b;
  };
  const openNode = id => () => {
    showTab('flow');
    showSide('inspector');
    selectNode(id);
  };
  for (const t of use.tools) used.append(pill(t.type, t.label, openNode(t.id)));
  for (const a of use.agents) used.append(pill('agent', a.label + ' (lewat tool)', openNode(a.id)));
  for (const x of use.relations)
    used.append(
      pill('data', 'Relasi dari ' + x.name, () => {
        state.collection = state.document.collections.indexOf(x);
        renderCollections();
      }),
    );
  if (!use.tools.length && !use.relations.length) used.append(el('span', '— belum dipakai node mana pun'));
  card.append(used);
  if (kindOf(c) !== 'text') card.append(fieldsTable(c));
  host.append(card);
}
function fieldsTable(c) {
  const table = el('div', undefined, 'fields-table'),
    head = el('div', undefined, 'fields-head');
  for (const text of ['Nama', 'ID', 'Jenis', 'Wajib', 'Unik', 'Keterangan', '']) head.append(el('span', text));
  table.append(head);
  if (!c.fields.length) table.append(el('div', 'Belum ada field.', 'empty-fields'));
  c.fields.forEach((f, i) => {
    const open = state.openField === i,
      row = el('div', undefined, 'field-grid' + (open ? ' open' : '')),
      main = el('div', undefined, 'field-main');
    main.append(
      compact(field('Nama field', f.label, v => mutate(() => renameField(c, f, v)))),
      el('span', f.id, 'field-id'),
      compact(
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
            if (['choice', 'multichoice', 'relation'].includes(v)) state.openField = i;
            renderCollections();
          },
          'select',
          Object.entries(fieldTypeLabels).map(([value, label]) => ({ value, label })),
        ),
      ),
      compact(field('Wajib', f.required, v => mutate(() => (f.required = v)), 'checkbox')),
      uniqueFieldTypes.includes(f.type)
        ? compact(
            field(
              'Unik',
              Boolean(f.unique),
              v =>
                mutate(() => {
                  if (v) f.unique = true;
                  else delete f.unique;
                }),
              'checkbox',
            ),
          )
        : el('span'),
      el('span', fieldSummary(f), 'summary'),
    );
    const actions = el('div', undefined, 'cell-actions'),
      toggle = iconButton(open ? 'up' : 'down', (open ? 'Tutup' : 'Buka') + ' detail field ' + f.label, () => {
        state.openField = open ? -1 : i;
        renderCollections();
      });
    toggle.setAttribute('aria-expanded', String(open));
    actions.append(
      toggle,
      iconButton('trash', 'Hapus field ' + f.label, () => {
        mutate(() => (c.fields = c.fields.filter(x => x !== f)));
        state.openField = -1;
        renderCollections();
      }),
    );
    main.append(actions);
    row.append(main);
    if (open) {
      const detail = el('div', undefined, 'field-detail');
      if (f.type === 'choice' || f.type === 'multichoice')
        detail.append(
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
      if (f.type === 'relation')
        detail.append(
          field(
            'Koleksi tujuan',
            f.collection,
            v => mutate(() => (f.collection = v)),
            'select',
            // Koleksi umum tidak boleh menunjuk data milik pelanggan.
            state.document.collections
              .filter(t => kindOf(t) === 'list' && (c.owner === 'customer' || t.owner !== 'customer'))
              .map(t => ({ value: t.id, label: t.name + (t.owner === 'customer' ? ' (milik pelanggan)' : '') })),
          ),
        );
      if (!['relation', 'file'].includes(f.type)) detail.append(defaultField(f));
      if (f.type === 'file') detail.append(el('p', 'Diisi dari unggahan dashboard atau node Terima media.', 'hint'));
      row.append(detail);
    }
    table.append(row);
  });
  const foot = el('div', undefined, 'fields-foot'),
    add = btn(
      'Tambah field',
      () => {
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
        state.openField = c.fields.length - 1;
        renderCollections();
      },
      'btn ghost accent-text',
    );
  add.prepend(svgIcon('plus'));
  foot.append(add);
  table.append(foot);
  return table;
}
// Label kolom tabel disembunyikan secara visual di layar lebar (judul kolom sudah ada), tetap terbaca pembaca layar.
function compact(wrap) {
  const text = wrap.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) text.replaceWith(el('span', text.textContent));
  return wrap;
}
function fieldSummary(f) {
  const parts = [];
  if (['choice', 'multichoice'].includes(f.type)) parts.push(f.options.length + ' opsi');
  if (f.type === 'relation')
    parts.push('→ ' + (state.document.collections.find(t => t.id === f.collection)?.name ?? 'pilih koleksi'));
  if (f.default !== undefined) parts.push('bawaan "' + [].concat(f.default).join(', ') + '"');
  return parts.join(' · ') || '—';
}
// ID koleksi dan field dibuat dari namanya. Selama belum pernah diterbitkan, ID ikut nama; setelah terbit ID dikunci
// karena record klien tersimpan memakai ID itu.
function slugId(text, taken, fallback) {
  let base = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
  rewriteVariables(new RegExp('((?<![.\\w])data\\.)' + c.id + '(?![\\w])', 'g'), '$1' + next);
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
  const tools = state.document.nodes.filter(n => isDataNode(n) && n.collection === c.id);
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
  // Variabel isian: {{data.<koleksi>.<field>}}.
  rewriteVariables(new RegExp('((?<![.\\w])data\\.' + c.id + '\\.)' + f.id + '(?![\\w])', 'g'), '$1' + next);
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
  state.collection = state.document.collections.length - 1;
  state.openField = -1;
  renderCollections();
};

// Pengaturan: status di klien dan riwayat versi dimuat setiap tab dibuka.
async function loadSettings() {
  const id = state.id;
  if (!id) return;
  const [versions, profiles] = await Promise.all([
    api(base + '/' + id + '/versions'),
    api('/api/admin/ai/profiles').catch(() => []),
  ]);
  if (state.id !== id) return;
  const info = profiles.find(p => p.id === id),
    stat = (label, value, ok) => {
      const box = el('div', undefined, 'stat');
      box.append(el('small', label), el('strong', String(value), ok ? 'ok' : ''));
      return box;
    };
  $('client-status').replaceChildren(
    stat('Status', info?.enabled ? 'Aktif' : state.published ? 'Nonaktif' : 'Belum terbit', info?.enabled),
    stat('Data profil', info?.data_profiles ?? 0),
    stat('Sesi', info?.sessions ?? 0),
  );
  const inUse = Number(info?.data_profiles ?? 0) > 0;
  $('delete-profile').disabled = inUse;
  $('delete-note').textContent = inUse
    ? 'Tidak bisa dihapus: masih dipakai ' + info.data_profiles + ' data profil.'
    : 'Versi terbit dan draft ikut dihapus.';
  const item = (className, title, sub, extra) => {
    const row = el('div', undefined, 'version ' + className),
      rail = el('div', undefined, 'rail'),
      body = el('div', undefined, 'body'),
      text = el('div');
    rail.append(el('i'), el('b'));
    text.append(title, el('small', sub));
    body.append(text);
    if (extra) body.append(extra);
    row.append(rail, body);
    return row;
  };
  const title = (text, chip) => {
    const t = el('div');
    t.append(el('strong', text));
    if (chip) t.append(' ', el('span', chip, 'chip ok'));
    return t;
  };
  const rows = [
    item(
      'draft',
      title('Draft'),
      !state.published
        ? 'Belum pernah diterbitkan'
        : unpublished()
          ? 'Berbeda dari versi terbit'
          : 'Sama dengan versi terbit',
    ),
  ];
  for (const v of [...versions].sort((a, b) => b.revision - a.revision)) {
    const live = v.revision === state.published;
    rows.push(
      item(
        live ? 'live' : '',
        title('v' + v.revision, live ? (info?.enabled ? 'Dipakai klien' : 'Versi terbit') : ''),
        'Terbit ' + new Date(v.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
        live
          ? null
          : btn(
              'Pulihkan ke draft',
              async () => {
                if (
                  !confirm(
                    'Ganti draft dengan versi ' +
                      v.revision +
                      '? Versi terbit tetap berlaku sampai Anda menerbitkan lagi.',
                  )
                )
                  return;
                const d = await api(base + '/' + id + '/versions/' + v.revision);
                mutate(() => (state.document = d));
                state.selected = null;
                renderAll();
                notice('Versi dipulihkan ke draft. Uji sebelum diterbitkan.');
              },
              'btn small',
            ),
      ),
    );
  }
  $('versions').replaceChildren(...rows);
}
$('delete-profile').onclick = () =>
  task(async () => {
    if (!confirm('Hapus profil ' + state.document.name + ' beserta seluruh versi definisinya?')) return;
    clearTimeout(saveTimer);
    await api(base + '/' + state.id, 'DELETE', { revision: state.revision });
    state.dirty = false;
    location.href = profilesPage;
  });

// Uji coba: percakapan simulasi dengan jejak per jawaban; langkah yang dijalankan disorot di kanvas.
const traceErrors = {
  ai_graph_missing_edge: 'Port keluar belum terhubung.',
  ai_output_limit: 'Jawaban kosong atau terlalu panjang.',
  ai_fallback_disabled: 'Fallback tidak aktif.',
  ai_retry_limit: 'Batas waktu atau jumlah panggilan model terlampaui.',
  ai_tool_result_limit: 'Hasil node terlalu besar.',
  ai_graph_step_limit: 'Alur melewati batas langkah.',
  ai_invalid_context: 'Ringkasan konteks tidak valid.',
  ai_graph_failed: 'Langkah gagal dijalankan.',
};
const errorText = code => traceErrors[code] ?? code;
function resetTest() {
  state.controller?.abort();
  state.history = [];
  state.context = null;
  state.trace = {};
  state.traceSteps = {};
  $('chat').replaceChildren($('chat').firstElementChild);
  renderTraceBanner();
}
$('reset-test').onclick = () => {
  resetTest();
  renderCanvas();
};
$('samples-toggle').onclick = () => {
  const open = $('samples-box').hidden;
  $('samples-box').hidden = !open;
  $('samples-toggle').setAttribute('aria-expanded', String(open));
};
$('attachment-toggle').onclick = () => {
  $('attachment-box').hidden = !$('attachment-box').hidden;
  if (!$('attachment-box').hidden) $('test-media-name').focus();
};
$('clear-trace').onclick = () => {
  state.trace = {};
  state.traceSteps = {};
  renderTraceBanner();
  renderCanvas();
};
function renderTraceBanner() {
  const count = Object.keys(state.traceSteps).length;
  $('trace-banner').hidden = !count;
  $('trace-banner-text').textContent = 'Jalur pesan terakhir · ' + count + ' langkah';
}
$('test-form').onsubmit = e => {
  e.preventDefault();
  task(runTest);
};
$('test-message').onkeydown = e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('test-form').requestSubmit();
  }
};
$('stop-test').onclick = () => state.controller?.abort();
const seconds = ms =>
  ms < 1000 ? ms + ' ms' : (ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' dtk';
// Satu giliran uji: langkah per node dalam urutan jalan. Node Data yang dipanggil Agent menjadi sublangkah Agent itu.
function traceStep(turn, event) {
  const node = state.document.nodes.find(n => n.id === event.node);
  let step = turn.steps.find(s => s.node === event.node);
  if (!step && !node) {
    // Panggilan model yang tidak bertanda node dicatat pada langkah yang sedang berjalan.
    step = turn.steps.findLast(s => s.state === 'running');
    if (step) step.events.push(event);
    return;
  }
  if (!step) {
    const parent = isDataNode(node)
      ? turn.steps.findLast(s => s.state === 'running' && s.type === 'agent' && !s.parent)
      : undefined;
    step = { node: event.node, type: node.type, state: 'running', events: [], parent: parent?.node };
    turn.steps.push(step);
  }
  step.events.push(event);
  if (['running', 'done', 'error'].includes(event.state)) step.state = event.state;
  if (event.state === 'done') {
    step.output = event.output;
    step.duration = event.duration_ms ?? step.events.reduce((t, e) => t + (e.duration_ms ?? 0), 0);
  }
  if (event.state === 'error') step.error = event.error;
  if (event.input !== undefined) step.input ??= event.input;
}
function stepNumbers(turn) {
  const numbers = {};
  let top = 0;
  const children = {};
  for (const s of turn.steps) {
    if (s.parent) {
      children[s.parent] = (children[s.parent] ?? 0) + 1;
      numbers[s.node] = numbers[s.parent] + '.' + children[s.parent];
    } else numbers[s.node] = String(++top);
  }
  return numbers;
}
function stepWhat(s) {
  const n = state.document.nodes.find(x => x.id === s.node);
  if (s.state === 'error') return 'gagal';
  if (s.state === 'running') return 'berjalan…';
  if (s.type === 'router' && s.output?.branch) return '→ ' + portLabel(n, s.output.branch);
  if (s.type === 'data_table' || s.type === 'data_form') return operationLabel(n?.operation);
  if (s.type === 'data_text') return s.output?.found === false ? 'tidak ada yang cocok' : 'baca teks';
  if (s.output?.fallback) return 'diteruskan ke tim';
  return n?.tier && memoryConsumers.includes(n.type) ? tierLabels[n.tier] : (kinds[s.type]?.[0] ?? '');
}
function renderTrace(turn) {
  const numbers = stepNumbers(turn),
    box = turn.trace,
    summary = el('summary'),
    total = turn.finished ? turn.finished - turn.started : Date.now() - turn.started;
  summary.append(
    el('strong', 'Jejak'),
    el(
      'span',
      turn.steps.length +
        ' langkah · ' +
        seconds(total) +
        ' · ' +
        turn.calls +
        ' panggilan model' +
        (turn.error ? ' · gagal' : ''),
    ),
  );
  box.replaceChildren(summary);
  for (const s of turn.steps) {
    const row = el('button', undefined, 'trace-step ' + s.state + (s.parent ? ' child' : ''));
    row.type = 'button';
    row.setAttribute('aria-expanded', String(turn.open === s.node));
    row.append(el('span', numbers[s.node], 'num'), el('span', nodeLabel(s.node)), el('span', stepWhat(s), 'what'));
    if (s.duration !== undefined) row.append(el('span', seconds(s.duration), 'dur'));
    row.onclick = () => {
      turn.open = turn.open === s.node ? null : s.node;
      state.selected = s.node;
      renderTrace(turn);
      renderCanvas();
    };
    box.append(row);
    if (turn.open === s.node) box.append(traceDetail(s));
  }
  if (turn.error && !turn.steps.some(s => s.error)) {
    const detail = el('div', undefined, 'trace-detail error');
    detail.append(el('div', errorText(turn.error), 'error-text'));
    box.append(detail);
  }
}
function traceDetail(s) {
  const detail = el('div', undefined, 'trace-detail' + (s.error ? ' error' : ''));
  if (s.error) detail.append(el('div', errorText(s.error), 'error-text'));
  const models = [...new Set(s.events.filter(e => e.model).map(e => e.model))];
  if (models.length) detail.append(el('div', 'Model: ' + models.join(', '), 'hint'));
  const json = {};
  if (s.input !== undefined) json.input = s.input;
  if (s.output !== undefined) json.output = s.output;
  for (const [key, value] of Object.entries(json))
    detail.append(el('h4', key === 'input' ? 'Input' : 'Hasil'), el('pre', JSON.stringify(value, null, 2)));
  const actions = el('div', undefined, 'row');
  actions.append(
    btn(
      'Buka node',
      () => {
        showSide('inspector');
        selectNode(s.node);
      },
      'btn small',
    ),
    btn(
      'Salin JSON',
      async () => {
        await navigator.clipboard.writeText(JSON.stringify({ node: s.node, ...json, error: s.error }, null, 2));
        notice('JSON langkah disalin.');
      },
      'btn ghost small',
    ),
  );
  detail.append(actions);
  return detail;
}
function applyTraceToCanvas(turn) {
  state.trace = {};
  for (const s of turn.steps) state.trace[s.node] = s.state;
  state.traceSteps = stepNumbers(turn);
  renderTraceBanner();
  renderCanvas();
}
async function runTest() {
  if (state.controller) return;
  const message = $('test-message').value.trim();
  if (!message) return;
  const records = JSON.parse($('samples').value || '{}');
  const mediaName = $('attachment-box').hidden ? '' : $('test-media-name').value.trim();
  const controller = new AbortController();
  state.controller = controller;
  $('run-test').disabled = true;
  $('stop-test').hidden = false;
  for (const old of $('chat').querySelectorAll('.trace[open]')) old.open = false;
  const pending = el('div', 'Memproses…', 'bubble assistant pending');
  const turn = {
    steps: [],
    calls: 0,
    started: Date.now(),
    finished: null,
    error: '',
    open: null,
    trace: el('details', undefined, 'trace'),
  };
  turn.trace.open = true;
  $('chat').append(
    el('div', message + (mediaName ? '\nLampiran: ' + mediaName : ''), 'bubble user'),
    pending,
    turn.trace,
  );
  $('test-message').value = '';
  const scroll = () => ($('chat').scrollTop = $('chat').scrollHeight);
  scroll();
  const mediaBubble = m =>
    el('div', 'Media: ' + m.filename + (m.caption ? ' — ' + m.caption : ''), 'bubble assistant media');
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
        media: mediaName ? { filename: mediaName, type: $('test-media-type').value } : null,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const d = await r.json();
      throw Error(d.message || d.error);
    }
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.state === 'completed' && event.output?.records) {
        const result = event.output;
        turn.finished = Date.now();
        state.context = result.context;
        state.history.push(
          { role: 'user', content: message },
          { role: 'assistant', content: result.answer || '[Diteruskan ke manusia]' },
        );
        state.history = state.history.slice(-60);
        // Simulasi tidak mengirim WhatsApp; media dari node Kirim media hanya ditampilkan namanya.
        const media = result.media ?? [];
        pending.replaceWith(
          ...media.filter(m => m.when === 'before').map(mediaBubble),
          el('div', result.answer || 'Percakapan diteruskan ke manusia.', 'bubble assistant'),
          ...media.filter(m => m.when === 'after').map(mediaBubble),
        );
        $('samples').value = JSON.stringify(result.records, null, 2);
      } else if (event.node === 'execution' && event.state === 'error') {
        turn.error = event.error;
        turn.finished = Date.now();
        pending.className = 'bubble assistant failed';
        pending.textContent = errorText(event.error);
      } else {
        if (event.state === 'responded') turn.calls++;
        if (event.state === 'error') {
          turn.error ||= event.error;
          turn.open ??= event.node;
        }
        if (event.state !== 'read') traceStep(turn, event);
      }
      renderTrace(turn);
      applyTraceToCanvas(turn);
      scroll();
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
  } catch (e) {
    pending.className = 'bubble assistant failed';
    pending.textContent = e.name === 'AbortError' ? 'Pengujian dihentikan.' : e.message;
    if (e.name !== 'AbortError') throw e;
  } finally {
    if (pending.isConnected && pending.classList.contains('pending')) {
      pending.className = 'bubble assistant failed';
      pending.textContent = turn.error ? errorText(turn.error) : 'Tidak ada jawaban.';
    }
    turn.finished ??= Date.now();
    renderTrace(turn);
    state.controller = null;
    $('run-test').disabled = false;
    $('stop-test').hidden = true;
  }
}

task(async () => {
  const id = new URLSearchParams(location.search).get('profile');
  if (id) await openProfile(id);
  else {
    $('library').hidden = false;
    $('profile-title').textContent = 'Profil baru';
  }
});
