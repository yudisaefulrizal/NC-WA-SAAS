// Asisten AI › Knowledge › koleksi: sub-menu per koleksi data profil, tabel record dengan pencarian, filter pelanggan,
// dan halaman, panel tambah/ubah record (revisi mencegah penimpaan), serta dialog sumber data (tabel aplikasi atau API
// milik klien). Data profil yang disunting mengikuti aiTarget(); state bersama ada di `knowledge` (ai.js).
const recordsBase = (profile = knowledge.profile) => '/api/ai/records/' + encodeURIComponent(profile);
const sourcesBase = (profile = knowledge.profile) => '/api/ai/record-sources/' + encodeURIComponent(profile);
const filesBase = (profile = knowledge.profile) => '/api/ai/record-files/' + encodeURIComponent(profile);
const ownerIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
const records = { collection: '', page: 0, editing: null, sourceMode: 'builtin', load: 0 };
const currentCollection = () => knowledge.collections.find(c => c.id === records.collection);
const sourceOf = c =>
  knowledge.sources.find(s => s.collection === c?.id) ?? { mode: 'builtin', endpoint: '', has_token: false };
const usesApi = c => sourceOf(c).mode === 'endpoint';

// Dipanggil setiap data profil yang disunting berganti atau dimuat ulang (loadAssistant). Profil yang belum terbit
// atau data profil tanpa koleksi hanya menampilkan Perilaku AI dan Fallback Tim.
async function loadKnowledgeCollections() {
  const target = aiTarget(),
    generation = ++records.load;
  let definition = { collections: [], counts: {} },
    sources = [];
  if (target)
    try {
      [definition, sources] = await Promise.all([api(recordsBase(target)), api(sourcesBase(target))]);
    } catch (e) {
      if (![404, 409].includes(e.status)) throw e;
    }
  if (generation !== records.load) return;
  const changed = knowledge.profile !== target;
  Object.assign(knowledge, {
    profile: target,
    collections: definition.collections,
    counts: definition.counts ?? {},
    sources,
  });
  renderKnowledgeCollections();
  if ($('ai-tab-knowledge').hidden) return;
  // Data profil lain: mulai dari koleksi pertama. Data profil sama: tetap di bagian yang sedang dibuka.
  knowledgeTab(changed ? defaultKnowledgeTab() : knowledge.current);
}
function renderKnowledgeCollections() {
  $('ai-knowledge-data').hidden = !knowledge.collections.length;
  $('ai-knowledge-collections').replaceChildren(
    ...knowledge.collections.map(c => {
      const b = document.createElement('button'),
        count = knowledge.counts[c.id];
      b.type = 'button';
      b.dataset.knowledgeTab = 'c:' + c.id;
      b.setAttribute('aria-pressed', String(knowledge.current === 'c:' + c.id));
      if (c.owner === 'customer') {
        b.insertAdjacentHTML('beforeend', ownerIcon);
        b.title = 'Milik pelanggan';
      }
      b.append(c.name);
      if (kindOf(c) === 'list' && !usesApi(c) && count !== undefined) {
        const badge = document.createElement('span');
        badge.className = 'ai-knowledge-count';
        badge.textContent = count;
        b.append(badge);
      }
      b.onclick = () => knowledgeTab('c:' + c.id);
      return b;
    }),
  );
}
// Membuka koleksi: pencarian, filter, halaman, dan panel record dimulai dari awal.
function showCollection(id) {
  if (records.collection !== id) {
    records.collection = id;
    records.page = 0;
    $('ai-records-search').value = '';
    $('ai-records-customer').value = '';
  }
  closeRecordPanel();
  void run(loadRecords);
}
async function refreshCounts() {
  const definition = await api(recordsBase());
  knowledge.counts = definition.counts ?? {};
  renderKnowledgeCollections();
}
async function loadRecords() {
  const c = currentCollection();
  if (!c) return;
  $('ai-records-title').textContent = c.name;
  // Koleksi teks/isian tampil tanpa bingkai tabel.
  $('ai-records').classList.toggle('table-wrap', kindOf(c) === 'list');
  if (kindOf(c) !== 'list') return loadSingle(c);
  $('ai-records-source').hidden = false;
  const api_ = usesApi(c),
    owned = c.owner === 'customer';
  $('ai-records-title').textContent = c.name;
  $('ai-records-meta').textContent =
    (owned ? 'Milik pelanggan · dibuat AI dari chat' : 'Umum · dibaca AI untuk semua pelanggan') +
    ' · sumber: ' +
    (api_ ? 'API sendiri' : 'Tabel aplikasi');
  $('ai-records-new').hidden = api_;
  // Pencarian dan filter hanya untuk tabel aplikasi; data koleksi API dicari di sistem klien.
  $('ai-records-search-label').hidden = api_;
  $('ai-records-customer-label').hidden = api_ || !owned;
  $('ai-records-owner-note').hidden = api_ || !owned;
  $('ai-records-pager').hidden = api_;
  if (api_) {
    const p = document.createElement('p');
    p.className = 'ai-helper ai-records-empty';
    p.textContent = 'Data koleksi ini ada di sistem Anda. Buka Sumber data lalu Uji API untuk melihat contoh balasan.';
    $('ai-records').replaceChildren(p);
    return;
  }
  const customer = owned ? $('ai-records-customer').value.trim() : '',
    search = $('ai-records-search').value;
  const result = await api(
    recordsBase() +
      '/' +
      c.id +
      '?page=' +
      records.page +
      '&q=' +
      encodeURIComponent(search) +
      (customer ? '&customer=' + encodeURIComponent(customer) : ''),
  );
  if (currentCollection() !== c) return;
  renderRecordTable(c, result, true);
  const total = knowledge.counts[c.id];
  $('ai-records-page').textContent =
    'Halaman ' + (records.page + 1) + (!search && !customer && total !== undefined ? ' · ' + total + ' record' : '');
  $('ai-records-prev').disabled = records.page === 0;
  $('ai-records-next').disabled = !result.has_more;
}
// editable=false untuk contoh balasan API: tanpa tombol ubah/hapus.
function renderRecordTable(c, result, editable) {
  const owned = c.owner === 'customer',
    table = document.createElement('table'),
    head = document.createElement('thead'),
    headRow = document.createElement('tr'),
    body = document.createElement('tbody');
  const columns = [...(owned ? ['Pelanggan'] : []), ...c.fields.map(f => f.label), ...(editable ? ['Dibuat', ''] : [])];
  for (const label of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    if (!label) th.innerHTML = '<span class="sr-only">Tindakan</span>';
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head, body);
  for (const r of result.records) {
    const row = document.createElement('tr'),
      td = (label, content) => {
        const cell = document.createElement('td');
        cell.dataset.label = label;
        if (content instanceof Node) cell.append(content);
        else cell.textContent = content;
        row.append(cell);
      };
    if (owned) td('Pelanggan', r.customer || '—');
    for (const f of c.fields) td(f.label, recordValue(f, r.data[f.id], result.files ?? {}));
    if (editable) {
      td('Dibuat', r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '—');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        button('Ubah', () => openRecordPanel(r)),
        button('Hapus', () => deleteRecord(c, r)),
      );
      actions.lastChild.classList.add('danger');
      td('', actions);
    }
    body.append(row);
  }
  if (!result.records.length) {
    const p = document.createElement('p');
    p.className = 'ai-helper ai-records-empty';
    p.textContent = editable ? 'Belum ada data yang sesuai.' : 'API tidak mengembalikan record.';
    $('ai-records').replaceChildren(p);
    return;
  }
  $('ai-records').replaceChildren(table);
}
// Isi sel sesuai tipe field; file tampil sebagai tautan unduh.
function recordValue(f, v, files) {
  if (v === undefined || v === null || v === '') return '—';
  if (f.type === 'boolean') return v ? 'Ya' : 'Tidak';
  if (Array.isArray(v)) return v.join(', ');
  if (f.type === 'datetime') return String(v).replace('T', ' ');
  if (f.type === 'file') {
    const a = document.createElement('a');
    a.textContent = files[v]?.filename ?? 'File';
    a.href = filesBase() + '/' + encodeURIComponent(v);
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  return String(v);
}
async function deleteRecord(c, r) {
  if (!confirm('Hapus record ini?')) return;
  await api(recordsBase() + '/' + c.id, 'DELETE', { id: r.id, revision: r.revision });
  if (records.editing?.id === r.id) closeRecordPanel();
  await Promise.all([loadRecords(), refreshCounts()]);
}

// Koleksi teks dan isian: satu isi per data profil, dikelola langsung tanpa tabel. Teks tersimpan otomatis; isian
// disimpan dengan tombol Simpan. Record pertama dibuat saat disimpan pertama kali.
const kindOf = c => c?.kind ?? 'list';
let singleSaveTimer;
async function saveSingle(c, data) {
  const row = records.single;
  const saved = await api(recordsBase() + '/' + c.id, row ? 'PUT' : 'POST', {
    data,
    ...(row ? { id: row.id, revision: row.revision } : {}),
  });
  if (currentCollection() === c) records.single = saved;
  return saved;
}
async function loadSingle(c) {
  for (const id of [
    'ai-records-search-label',
    'ai-records-customer-label',
    'ai-records-owner-note',
    'ai-records-pager',
    'ai-records-new',
    'ai-records-source',
  ])
    $(id).hidden = true;
  $('ai-records-meta').textContent =
    kindOf(c) === 'text'
      ? 'Teks · dibaca AI lewat node Data teks · tersimpan otomatis'
      : 'Isian · satu formulir untuk semua pelanggan';
  const result = await api(recordsBase() + '/' + c.id + '?page=0');
  if (currentCollection() !== c) return;
  records.single = result.records[0] ?? null;
  const host = $('ai-records');
  if (kindOf(c) === 'text') {
    const wrap = document.createElement('div'),
      area = document.createElement('textarea'),
      status = document.createElement('div');
    wrap.className = 'ai-single-text';
    area.id = 'ai-single-text';
    area.maxLength = 20000;
    area.rows = 16;
    area.setAttribute('aria-label', 'Isi ' + c.name);
    area.value = records.single?.data.text ?? '';
    status.className = 'ai-single-status';
    const count = () => (status.textContent = area.value.length.toLocaleString('id-ID') + ' / 20.000 karakter');
    count();
    area.oninput = () => {
      count();
      clearTimeout(singleSaveTimer);
      singleSaveTimer = setTimeout(
        () =>
          run(async () => {
            await saveSingle(c, { text: area.value });
            status.textContent = 'Tersimpan · ' + area.value.length.toLocaleString('id-ID') + ' / 20.000 karakter';
          }),
        800,
      );
    };
    wrap.append(area, status);
    host.replaceChildren(wrap);
    return;
  }
  const form = document.createElement('form');
  form.id = 'ai-single-form';
  form.className = 'ai-record-form ai-single-form';
  await appendRecordFields(form, c, records.single ?? null);
  const actions = document.createElement('div'),
    save = document.createElement('button');
  actions.className = 'ai-record-actions';
  save.textContent = 'Simpan';
  const spacer = document.createElement('span');
  spacer.className = 'ai-spacer';
  actions.append(spacer, save);
  form.append(actions);
  form.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      save.disabled = true;
      try {
        await saveSingle(c, await recordFormData(form, c));
        save.textContent = 'Tersimpan';
        setTimeout(() => (save.textContent = 'Simpan'), 1500);
      } finally {
        save.disabled = false;
      }
    });
  };
  host.replaceChildren(form);
}

// Panel tambah/ubah record di samping tabel.
const recordInputTypes = {
  boolean: 'checkbox',
  number: 'number',
  date: 'date',
  time: 'time',
  datetime: 'datetime-local',
  phone: 'tel',
};
function recordLabel(text, control) {
  const label = document.createElement('label');
  if (control.type === 'checkbox') label.append(control, ' ' + text);
  else label.append(text, control);
  return label;
}
function closeRecordPanel() {
  records.editing = null;
  $('ai-record-panel').hidden = true;
  $('ai-tab-knowledge').classList.remove('ai-record-open');
}
$('ai-record-close').onclick = closeRecordPanel;
// Kontrol isian per field koleksi; dipakai panel record (tabel) dan formulir koleksi isian.
async function appendRecordFields(form, c, row) {
  for (const f of c.fields) {
    // Record baru memakai nilai bawaan field; server juga mengisinya bila isian dikosongkan.
    const value = row ? row.data[f.id] : f.default,
      label = f.label + (f.required ? ' *' : '');
    if (f.type === 'multichoice') {
      const group = document.createElement('fieldset');
      group.className = 'ai-record-choices';
      const legend = document.createElement('legend');
      legend.textContent = label;
      group.append(legend);
      for (const option of f.options) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = f.id;
        box.value = option;
        box.checked = Array.isArray(value) && value.includes(option);
        group.append(recordLabel(option, box));
      }
      form.append(group);
      continue;
    }
    if (f.type === 'file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.name = f.id;
      input.accept = 'image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
      input.dataset.current = value ?? '';
      input.required = f.required && !value;
      const wrap = recordLabel(label, input);
      if (value) {
        const hint = document.createElement('small');
        hint.textContent = 'File sekarang tetap dipakai bila tidak memilih file baru.';
        wrap.append(hint);
      }
      form.append(wrap);
      continue;
    }
    let control;
    if (f.type === 'choice' || f.type === 'relation') {
      control = document.createElement('select');
      const options =
        f.type === 'relation'
          ? await relationOptions(f, value)
          : [{ value: '', label: 'Pilih' }, ...f.options.map(o => ({ value: o, label: o }))];
      for (const o of options) {
        const option = document.createElement('option');
        option.value = o.value;
        option.textContent = o.label;
        control.append(option);
      }
      control.value = value ?? '';
    } else {
      control = document.createElement('input');
      control.type = recordInputTypes[f.type] ?? 'text';
      if (f.type === 'boolean') control.checked = Boolean(value);
      else control.value = value ?? '';
      if (f.type === 'number') control.step = 'any';
    }
    control.name = f.id;
    control.required = f.required && f.type !== 'boolean';
    form.append(recordLabel(label, control));
  }
}
async function openRecordPanel(row = null) {
  const c = currentCollection(),
    form = $('ai-record-form');
  records.editing = row;
  form.replaceChildren();
  $('ai-record-title').textContent = row ? 'Ubah record' : 'Tambah ' + c.name.toLowerCase();
  $('ai-record-sub').textContent = row
    ? (row.customer ? row.customer + ' · ' : '') +
      'dibuat ' +
      (row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '—')
    : c.name;
  // Record milik pelanggan dari dashboard wajib menyebut nomor pelanggannya; nomor tidak bisa diubah sesudahnya.
  if (c.owner === 'customer') {
    const input = document.createElement('input');
    input.name = '__customer';
    input.required = true;
    input.pattern = '[0-9]{5,20}';
    input.inputMode = 'numeric';
    input.value = row?.customer ?? '';
    input.readOnly = Boolean(row);
    form.append(recordLabel('Nomor pelanggan *', input));
  }
  await appendRecordFields(form, c, row);
  const actions = document.createElement('div');
  actions.className = 'ai-record-actions';
  if (row) {
    const remove = button('Hapus', () => deleteRecord(c, row));
    remove.className = 'secondary danger';
    actions.append(remove);
  }
  const spacer = document.createElement('span'),
    cancel = document.createElement('button'),
    save = document.createElement('button');
  spacer.className = 'ai-spacer';
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Batal';
  cancel.onclick = closeRecordPanel;
  save.textContent = 'Simpan';
  actions.append(spacer, cancel, save);
  form.append(actions);
  $('ai-record-panel').hidden = false;
  $('ai-tab-knowledge').classList.add('ai-record-open');
  form.querySelector('input:not([readonly]),select')?.focus();
}
async function relationOptions(f, value) {
  const rows = [];
  for (let index = 0, more = true; more && index < 10; index++) {
    const r = await api(recordsBase() + '/' + f.collection + '?page=' + index);
    rows.push(...r.records);
    more = r.has_more;
  }
  const options = [
    { value: '', label: 'Pilih record' },
    ...rows.map(r => ({
      value: r.id,
      label:
        Object.values(r.data)
          .filter(v => typeof v === 'string')
          .slice(0, 2)
          .join(' · ') || r.id,
    })),
  ];
  if (value && !options.some(o => o.value === value)) options.push({ value, label: value });
  return options;
}
// Nilai formulir record sesuai tipe field; file yang dipilih diunggah dulu dan record menyimpan ID filenya.
async function recordFormData(form, c) {
  const data = {};
  for (const f of c.fields) {
    if (f.type === 'multichoice') {
      const picked = [...form.querySelectorAll('input[name="' + f.id + '"]:checked')].map(x => x.value);
      if (picked.length) data[f.id] = picked;
      continue;
    }
    const input = form.elements.namedItem(f.id);
    if (f.type === 'file') {
      // File dipilih diunggah dulu; record kemudian menyimpan ID file itu.
      const file = input.files[0];
      if (file) data[f.id] = (await uploadRecordFile(file)).id;
      else if (input.dataset.current) data[f.id] = input.dataset.current;
      continue;
    }
    if (f.type === 'boolean') data[f.id] = input.checked;
    else if (input.value !== '') data[f.id] = f.type === 'number' ? Number(input.value) : input.value;
  }
  return data;
}
$('ai-record-form').onsubmit = e => {
  e.preventDefault();
  const save = $('ai-record-form').querySelector('.ai-record-actions button:last-child');
  run(async () => {
    save.disabled = true;
    try {
      const c = currentCollection(),
        form = $('ai-record-form'),
        editing = records.editing,
        data = await recordFormData(form, c);
      await api(recordsBase() + '/' + c.id, editing ? 'PUT' : 'POST', {
        data,
        ...(editing ? { id: editing.id, revision: editing.revision } : {}),
        ...(!editing && c.owner === 'customer' ? { customer: form.elements.namedItem('__customer').value.trim() } : {}),
      });
      closeRecordPanel();
      await Promise.all([loadRecords(), refreshCounts()]);
    } finally {
      save.disabled = false;
    }
  });
};
async function uploadRecordFile(file) {
  const r = await fetch(filesBase(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'File gagal diunggah.');
  return d;
}
$('ai-records-new').onclick = () => run(() => openRecordPanel());
const reloadRecords = () => {
  records.page = 0;
  void run(loadRecords);
};
for (const id of ['ai-records-search', 'ai-records-customer'])
  $(id).onkeydown = e => {
    if (e.key === 'Enter') reloadRecords();
  };
$('ai-records-search').onsearch = reloadRecords;
$('ai-records-prev').onclick = () => {
  records.page--;
  void run(loadRecords);
};
$('ai-records-next').onclick = () => {
  records.page++;
  void run(loadRecords);
};

// Dialog sumber data: koleksi memakai tabel aplikasi atau API milik klien. Koleksi API tidak punya record di NC-WA.
function setSourceMode(mode) {
  records.sourceMode = mode;
  for (const b of document.querySelectorAll('#ai-source-mode [data-mode]'))
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  $('ai-source-api').hidden = mode !== 'endpoint';
  $('ai-source-hint').textContent =
    mode === 'endpoint'
      ? 'Semua operasi koleksi ini (cari, ambil, hitung, buat, ubah, hapus) dikirim ke API Anda.'
      : 'Data disimpan dan dikelola di NC-WA melalui tabel koleksi.';
}
for (const b of document.querySelectorAll('#ai-source-mode [data-mode]'))
  b.onclick = () => setSourceMode(b.dataset.mode);
$('ai-records-source').onclick = () => {
  const c = currentCollection(),
    source = sourceOf(c);
  $('ai-source-title').textContent = 'Sumber data · ' + c.name;
  setSourceMode(source.mode);
  $('ai-source-test').hidden = source.mode !== 'endpoint';
  $('ai-source-endpoint').value = source.endpoint;
  $('ai-source-token').value = '';
  $('ai-source-clear-token').checked = false;
  $('ai-source-token-status').textContent = source.has_token ? 'Token tersimpan.' : 'Belum ada token.';
  $('ai-source-dialog').showModal();
};
$('ai-source-form').onsubmit = e => {
  e.preventDefault();
  run(async () => {
    const c = currentCollection(),
      mode = records.sourceMode;
    const saved = await api(sourcesBase() + '/' + c.id, 'PUT', {
      mode,
      ...(mode === 'endpoint'
        ? {
            endpoint: $('ai-source-endpoint').value.trim(),
            ...($('ai-source-token').value ? { token: $('ai-source-token').value } : {}),
            clear_token: $('ai-source-clear-token').checked,
          }
        : {}),
    });
    knowledge.sources = [...knowledge.sources.filter(s => s.collection !== c.id), saved];
    $('ai-source-dialog').close();
    records.page = 0;
    renderKnowledgeCollections();
    await loadRecords();
  });
};
$('ai-source-test').onclick = () =>
  run(async () => {
    const c = currentCollection();
    const result = await api(sourcesBase() + '/' + c.id + '/test', 'POST', {});
    $('ai-source-dialog').close();
    renderRecordTable(c, { ...result, files: {} }, false);
    $('ai-records-meta').textContent = 'Contoh balasan API: ' + result.records.length + ' record';
  });
