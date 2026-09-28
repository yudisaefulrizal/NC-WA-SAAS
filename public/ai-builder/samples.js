// Data contoh koleksi (khusus owner, hanya untuk Uji di editor): diisi manual di Struktur data atau dibuat untuk semua
// koleksi sekaligus oleh penyedia AI NC-WA. Disimpan di draft (`collections[].samples`) dan menjadi data awal panel Uji;
// tidak pernah dipakai klien atau WhatsApp. Setiap baris tabel punya `_id` (misalnya `layanan_1`) yang dipakai field
// relasi koleksi lain; field file berisi nama file contoh.
const sampleLimit = 10;
const emptySample = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
// Baris contoh yang cocok dengan field saat ini; kunci field yang sudah dihapus dibuang, `_id` dipertahankan.
function cleanSampleRow(c, row) {
  const keys = kindOf(c) === 'text' ? ['text'] : ['_id', ...c.fields.map(f => f.id)];
  return Object.fromEntries(Object.entries(row ?? {}).filter(([k, v]) => keys.includes(k) && !emptySample(v)));
}
// Bentuk data contoh yang dipakai simulasi: tabel = daftar baris, isian = satu objek, teks = string.
function sampleRecords() {
  const out = {};
  for (const c of state.document?.collections ?? []) {
    const rows = (c.samples ?? []).map(r => cleanSampleRow(c, r)).filter(r => Object.keys(r).some(k => k !== '_id'));
    if (!rows.length) continue;
    out[c.id] = kindOf(c) === 'text' ? rows[0].text : kindOf(c) === 'form' ? rows[0] : rows;
  }
  return out;
}
// Panel Uji memakai data contoh sebagai data awal; percakapan yang sedang berjalan tidak diganggu kecuali dipaksa.
function syncTestSamples(force = false) {
  if (force || !state.history.length) $('samples').value = JSON.stringify(sampleRecords(), null, 2);
}
// `_id` baris baru: <id koleksi>_<nomor> yang belum dipakai.
function nextSampleId(c) {
  const used = new Set((c.samples ?? []).map(r => r._id));
  let n = 1;
  while (used.has(c.id + '_' + n)) n++;
  return c.id + '_' + n;
}
function setSample(c, index, key, value) {
  mutate(() => {
    c.samples ??= [];
    const row = (c.samples[index] ??= kindOf(c) === 'list' ? { _id: nextSampleId(c) } : {});
    if (emptySample(value)) delete row[key];
    else row[key] = value;
  });
  syncTestSamples();
}
// Nama baris contoh untuk pilihan relasi: isi teks pertama, atau `_id`-nya.
function sampleLabel(c, row) {
  const text = c.fields.find(f => f.type === 'text' && typeof row[f.id] === 'string' && row[f.id]);
  return text ? row[text.id] : row._id;
}
// Isian satu nilai sesuai tipe field.
function sampleInput(c, f, index, label) {
  const value = c.samples?.[index]?.[f.id],
    set = v => setSample(c, index, f.id, v);
  if (f.type === 'boolean') return field(label, Boolean(value), set, 'checkbox');
  if (f.type === 'choice') return field(label, value ?? '', set, 'select', [{ value: '', label: '—' }, ...f.options]);
  if (f.type === 'relation') {
    const target = state.document.collections.find(x => x.id === f.collection);
    const rows = (target?.samples ?? []).filter(r => r._id);
    return field(label, value ?? '', set, 'select', [
      { value: '', label: rows.length ? '—' : 'Isi data contoh ' + (target?.name ?? f.collection) + ' dulu' },
      ...rows.map(r => ({ value: r._id, label: sampleLabel(target, r) })),
    ]);
  }
  if (f.type === 'multichoice')
    return field(label, (value ?? []).join(', '), v =>
      set(
        v
          .split(',')
          .map(x => f.options.find(o => o.toLowerCase() === x.trim().toLowerCase()))
          .filter(Boolean),
      ),
    );
  if (f.type === 'number') {
    const wrap = field(label, value ?? '', v => set(v.trim() === '' || !Number.isFinite(Number(v)) ? '' : Number(v)));
    wrap.querySelector('input').inputMode = 'decimal';
    return wrap;
  }
  const type = { date: 'date', time: 'time', datetime: 'datetime-local' }[f.type] ?? 'text';
  const wrap = field(label, value ?? '', set, type);
  if (f.type === 'file') wrap.querySelector('input').placeholder = 'nama file, mis. brosur.pdf';
  return wrap;
}
// Semua koleksi dibuat sekaligus supaya relasi antarkoleksi saling cocok.
async function autoSamples() {
  if (
    state.document.collections.some(c => c.samples?.length) &&
    !confirm('Ganti semua data contoh dengan data buatan AI?')
  )
    return;
  const r = await api(base + '/' + state.id + '/samples', 'POST', { definition: state.document });
  mutate(() => {
    for (const c of state.document.collections) c.samples = r.samples[c.id] ?? [];
  });
  syncTestSamples();
  renderCollections();
  const count = Object.values(r.samples).reduce((sum, rows) => sum + rows.length, 0);
  notice('Data contoh dibuat: ' + count + ' baris untuk ' + Object.keys(r.samples).length + ' koleksi.');
}
function samplesSection(c) {
  const box = el('section', undefined, 'samples-card'),
    title = el('div');
  title.append(
    el('h3', 'Data contoh'),
    el(
      'p',
      'Hanya untuk Uji di editor; tidak dipakai klien maupun WhatsApp. Buat untuk semua koleksi lewat tombol Buat data contoh.',
      'hint',
    ),
  );
  box.append(title);
  const kind = kindOf(c);
  if (kind === 'text') {
    box.append(
      field('Isi teks contoh ' + c.name, c.samples?.[0]?.text ?? '', v => setSample(c, 0, 'text', v), 'textarea'),
    );
    return box;
  }
  const columns = c.fields;
  if (!columns.length) {
    box.append(el('p', 'Tambahkan field untuk mengisi data contoh.', 'hint'));
    return box;
  }
  if (kind === 'form') {
    const grid = el('div', undefined, 'samples-form');
    for (const f of columns) grid.append(sampleInput(c, f, 0, f.label));
    box.append(grid);
    return box;
  }
  const rows = c.samples ?? [],
    table = el('div', undefined, 'samples-table');
  table.style.setProperty('--sample-columns', String(columns.length));
  const headRow = el('div', undefined, 'samples-row head');
  for (const f of columns) headRow.append(el('span', f.label + (f.required ? ' *' : '')));
  headRow.append(el('span'));
  table.append(headRow);
  if (!rows.length) table.append(el('p', 'Belum ada data contoh. Tambah baris atau Buat data contoh.', 'empty-fields'));
  rows.forEach((_, i) => {
    const row = el('div', undefined, 'samples-row');
    for (const f of columns) row.append(compact(sampleInput(c, f, i, f.label + ' baris ' + (i + 1))));
    row.append(
      iconButton('trash', 'Hapus baris contoh ' + (i + 1), () => {
        mutate(() => c.samples.splice(i, 1));
        syncTestSamples();
        renderCollections();
      }),
    );
    table.append(row);
  });
  box.append(table);
  const add = btn(
    '+ Baris',
    () => {
      mutate(() => (c.samples ??= []).push({ _id: nextSampleId(c) }));
      renderCollections();
    },
    'btn small ghost',
  );
  add.disabled = rows.length >= sampleLimit;
  box.append(add);
  return box;
}
$('samples-all').onclick = () => task(autoSamples, $('samples-all'));
