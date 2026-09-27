// Asisten AI › Knowledge › koleksi: sub-menu per koleksi data profil, tabel record inline dengan pencarian, filter
// pelanggan, dan halaman (revisi mencegah penimpaan), serta dialog sumber data (tabel aplikasi atau API
// milik klien). Data profil yang disunting mengikuti aiTarget(); state bersama ada di `knowledge` (ai.js).
const recordsBase = (profile = knowledge.profile) => '/api/ai/records/' + encodeURIComponent(profile);
const sourcesBase = (profile = knowledge.profile) => '/api/ai/record-sources/' + encodeURIComponent(profile);
const filesBase = (profile = knowledge.profile) => '/api/ai/record-files/' + encodeURIComponent(profile);
const ownerIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
const records = { collection: '', page: 0, sourceMode: 'builtin', load: 0 };
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
  await renderRecordTable(c, result, true);
  const total = knowledge.counts[c.id];
  $('ai-records-page').textContent =
    'Halaman ' + (records.page + 1) + (!search && !customer && total !== undefined ? ' · ' + total + ' record' : '');
  $('ai-records-prev').disabled = records.page === 0;
  $('ai-records-next').disabled = !result.has_more;
}
// Tabel inline koleksi jenis tabel: kolom dibentuk dari field dan cara mengisi sel mengikuti tipe field. Perubahan sel
// ditampung per baris lalu disimpan saat fokus meninggalkan baris atau Enter; baris kosong di bawah dipakai menambah
// record. Field wajib dicek per sel, dan pesan server (misalnya nilai unik) ditampilkan di baris itu.
// editable=false untuk koleksi API dan contoh balasan API: tabel yang sama tanpa mode ubah.
const grid = { collection: null, rows: [], files: {}, relations: {}, editable: false, pop: null };
const fieldTypeLabels = {
  text: 'teks',
  number: 'angka',
  boolean: 'ya/tidak',
  date: 'tanggal',
  time: 'jam',
  datetime: 'tanggal & jam',
  choice: 'pilihan',
  multichoice: 'multi pilihan',
  phone: 'telepon',
  relation: 'relasi',
  file: 'file',
};
const emptyValue = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const statusIcons = {
  saved:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/></svg>',
  dirty: '<span class="ai-grid-dot" aria-hidden="true"></span>',
  saving: '<span class="ai-grid-dot saving" aria-hidden="true"></span>',
};
const statusText = { saved: 'Tersimpan', dirty: 'Belum disimpan', saving: 'Menyimpan', error: 'Gagal disimpan' };
const blankRow = c => ({
  record: null,
  customer: '',
  data: Object.fromEntries(c.fields.filter(f => !emptyValue(f.default)).map(f => [f.id, f.default])),
  status: '',
  message: '',
  invalid: new Set(),
});

async function renderRecordTable(c, result, editable) {
  closeCellPopover(false);
  grid.collection = c;
  grid.editable = editable;
  grid.files = { ...(result.files ?? {}) };
  grid.rows = result.records.map(r => ({
    record: r,
    customer: r.customer ?? '',
    data: { ...r.data },
    status: '',
    message: '',
    invalid: new Set(),
  }));
  if (editable) grid.rows.push(blankRow(c));
  if (!grid.rows.length) {
    const p = document.createElement('p');
    p.className = 'ai-helper ai-records-empty';
    p.textContent = 'API tidak mengembalikan record.';
    $('ai-records').replaceChildren(p);
    return;
  }
  // Relasi tampil sebagai nama record tujuan, bukan ID.
  grid.relations = {};
  for (const f of c.fields.filter(f => f.type === 'relation'))
    grid.relations[f.id] = editable ? await relationOptions(f) : [];
  if (grid.collection !== c) return;
  const owned = c.owner === 'customer',
    table = document.createElement('table'),
    headRow = document.createElement('tr'),
    body = document.createElement('tbody'),
    th = (text, className = '') => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.className = className;
      cell.textContent = text;
      headRow.append(cell);
      return cell;
    };
  table.className = 'ai-grid';
  th('#', 'ai-grid-no');
  if (owned) th('Pelanggan', 'ai-grid-locked');
  for (const f of c.fields) {
    const cell = th(f.label, f.type === 'number' ? 'ai-grid-num' : '');
    if (f.required) {
      const star = document.createElement('span');
      star.className = 'ai-grid-required';
      star.textContent = ' *';
      cell.append(star);
    }
    const hint = document.createElement('small');
    hint.textContent = fieldTypeLabels[f.type] ?? f.type;
    cell.append(hint);
  }
  if (editable) {
    th('Dibuat', 'ai-grid-locked');
    th('', 'ai-grid-status').innerHTML = '<span class="sr-only">Status</span>';
    th('', 'ai-grid-actions').innerHTML = '<span class="sr-only">Tindakan</span>';
  }
  const head = document.createElement('thead');
  head.append(headRow);
  table.append(head, body);
  grid.rows.forEach((row, index) => body.append(gridRow(row, index)));
  const note = document.createElement('p');
  note.id = 'ai-grid-note';
  note.className = 'ai-grid-note';
  note.setAttribute('aria-live', 'polite');
  $('ai-records').replaceChildren(table, note);
}
const gridColumns = () => [
  ...(grid.collection.owner === 'customer' ? [{ id: '__customer' }] : []),
  ...grid.collection.fields,
];
function gridRow(row, index) {
  const tr = document.createElement('tr'),
    c = grid.collection,
    fresh = !row.record;
  tr.dataset.row = index;
  tr.classList.toggle('ai-grid-new', fresh);
  const no = document.createElement('td');
  no.className = 'ai-grid-no';
  no.textContent = fresh ? '+' : String(index + 1);
  tr.append(no);
  for (const col of gridColumns()) {
    const td = document.createElement('td');
    td.dataset.col = col.id;
    td.dataset.label = col.label ?? 'Pelanggan';
    tr.append(td);
    paintCell(td, row, col);
  }
  if (grid.editable) {
    const created = document.createElement('td'),
      status = document.createElement('td'),
      actions = document.createElement('td');
    created.className = 'ai-grid-locked';
    created.dataset.label = 'Dibuat';
    created.textContent = row.record?.created_at ? new Date(row.record.created_at).toLocaleString('id-ID') : '';
    status.className = 'ai-grid-status';
    actions.className = 'ai-grid-actions';
    if (row.record) {
      const remove = button('', () => deleteRecord(c, row.record));
      remove.className = 'ai-grid-remove';
      remove.setAttribute('aria-label', 'Hapus baris ' + (index + 1));
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
      actions.append(remove);
    }
    tr.append(created, status, actions);
    paintStatus(tr, row);
    // Baris disimpan saat fokus meninggalkannya (bukan ke popover sel baris ini).
    tr.addEventListener('focusout', () =>
      setTimeout(() => {
        if (!tr.isConnected || tr.contains(document.activeElement)) return;
        if (grid.pop?.tr === tr) return;
        void saveGridRow(row);
      }),
    );
  }
  return tr;
}
function paintStatus(tr, row) {
  const cell = tr.querySelector('.ai-grid-status');
  if (!cell) return;
  cell.dataset.status = row.status;
  cell.innerHTML = row.status ? statusIcons[row.status] : '';
  cell.title = row.message || statusText[row.status] || '';
  if (row.status) {
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = cell.title;
    cell.append(label);
  }
  tr.classList.toggle('ai-grid-dirty', row.status === 'dirty' || row.status === 'error');
  for (const td of tr.querySelectorAll('td[data-col]')) td.classList.toggle('invalid', row.invalid.has(td.dataset.col));
}
const cellEditable = (row, col) => grid.editable && (col.id !== '__customer' || !row.record);
function paintCell(td, row, col) {
  const editable = cellEditable(row, col),
    fresh = !row.record,
    empty = text => {
      const span = document.createElement('span');
      span.className = 'ai-grid-empty';
      span.textContent = text;
      return span;
    };
  td.className = '';
  td.classList.toggle('ai-grid-locked', !editable && col.id === '__customer');
  td.classList.toggle('ai-grid-num', col.type === 'number');
  td.classList.toggle('invalid', row.invalid.has(col.id));
  td.tabIndex = editable ? 0 : -1;
  if (col.id === '__customer') {
    td.replaceChildren(row.customer || (fresh ? empty('Nomor pelanggan') : '—'));
    return;
  }
  const v = row.data[col.id];
  if (col.type === 'boolean') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(v);
    box.disabled = !editable;
    box.tabIndex = -1;
    box.setAttribute('aria-label', col.label);
    box.onchange = () => {
      setCell(row, col, box.checked, td.closest('tr'));
      if (row.record) void saveGridRow(row);
    };
    td.replaceChildren(box);
    return;
  }
  if (col.type === 'file') {
    const parts = [];
    if (!emptyValue(v)) {
      const a = document.createElement('a');
      a.textContent = grid.files[v]?.filename ?? 'File';
      a.href = filesBase() + '/' + encodeURIComponent(v);
      a.target = '_blank';
      a.rel = 'noopener';
      a.tabIndex = -1;
      parts.push(a);
    }
    if (editable) {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'ai-grid-upload';
      pick.tabIndex = -1;
      pick.textContent = emptyValue(v) ? '+ Unggah' : 'Ganti';
      pick.onclick = () => pickCellFile(td, row, col);
      parts.push(pick);
    }
    td.replaceChildren(...(parts.length ? parts : [empty('Kosong')]));
    return;
  }
  if (emptyValue(v)) {
    td.replaceChildren(fresh && col === grid.collection.fields[0] ? empty('Ketik untuk menambah baris…') : empty(''));
    return;
  }
  if (col.type === 'choice' || col.type === 'multichoice') {
    td.replaceChildren(
      ...[v].flat().map(x => {
        const chip = document.createElement('span');
        chip.className = col.type === 'choice' ? 'ai-grid-pill' : 'ai-grid-chip';
        chip.textContent = x;
        return chip;
      }),
    );
    return;
  }
  const text =
    col.type === 'number'
      ? Number(v).toLocaleString('id-ID')
      : col.type === 'relation'
        ? (grid.relations[col.id]?.find(o => o.value === v)?.label ?? v)
        : col.type === 'datetime'
          ? String(v).replace('T', ' ')
          : String(v);
  const span = document.createElement('span');
  span.className = 'ai-grid-text';
  span.textContent = text;
  td.replaceChildren(span);
}
function setCell(row, col, value, tr) {
  const key = col.id,
    before = key === '__customer' ? row.customer : row.data[key];
  if (JSON.stringify(before ?? null) === JSON.stringify(emptyValue(value) ? null : value)) return;
  if (key === '__customer') row.customer = value;
  else if (emptyValue(value)) delete row.data[key];
  else row.data[key] = value;
  row.invalid.delete(key);
  row.status = 'dirty';
  row.message = '';
  if (tr) paintStatus(tr, row);
}
function cellParts(td) {
  const tr = td.closest('tr'),
    row = grid.rows[Number(tr.dataset.row)],
    col = gridColumns().find(x => x.id === td.dataset.col);
  return { tr, row, col };
}
// Mode ubah sel: kontrol sesuai tipe field. Teks panjang dan multi pilihan memakai popover.
// replace=true: mulai dari kosong karena pengguna langsung mengetik di sel (huruf pertama masuk ke input).
async function editCell(td, replace = false) {
  const { tr, row, col } = cellParts(td);
  if (!cellEditable(row, col) || td.classList.contains('editing')) return;
  if (col.type === 'boolean') {
    const box = td.querySelector('input');
    box.checked = !box.checked;
    box.onchange();
    return;
  }
  if (col.type === 'file') return pickCellFile(td, row, col);
  const value = col.id === '__customer' ? row.customer : row.data[col.id];
  if (
    col.type === 'multichoice' ||
    (col.type === 'text' && (String(value ?? '').length > 40 || /\n/.test(value ?? '')))
  )
    return openCellPopover(td, tr, row, col, value);
  let control;
  if (col.type === 'choice' || col.type === 'relation') {
    control = document.createElement('select');
    const options =
      col.type === 'relation'
        ? grid.relations[col.id]
        : [{ value: '', label: 'Pilih' }, ...col.options.map(o => ({ value: o, label: o }))];
    for (const o of options) control.append(new Option(o.label, o.value));
    control.value = value ?? '';
  } else {
    control = document.createElement('input');
    control.type = col.id === '__customer' ? 'text' : (recordInputTypes[col.type] ?? 'text');
    if (col.id === '__customer') control.inputMode = 'numeric';
    if (col.type === 'number') control.step = 'any';
    control.value = replace ? '' : (value ?? '');
  }
  control.className = 'ai-grid-input';
  control.setAttribute('aria-label', col.label ?? 'Nomor pelanggan');
  let done = false;
  const finish = (commit, move) => {
    if (done) return;
    done = true;
    if (commit) {
      const raw = control.value;
      setCell(row, col, col.type === 'number' && raw !== '' ? Number(raw) : raw, tr);
    }
    td.classList.remove('editing');
    paintCell(td, row, col);
    if (move) moveFrom(td, move);
    else td.focus();
  };
  control.onblur = () => {
    if (done) return;
    done = true;
    const raw = control.value;
    setCell(row, col, col.type === 'number' && raw !== '' ? Number(raw) : raw, tr);
    td.classList.remove('editing');
    paintCell(td, row, col);
  };
  control.onkeydown = e => {
    if (e.key === 'Escape') finish(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      finish(true, 'down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(true, e.shiftKey ? 'left' : 'right');
    } else return;
    e.stopPropagation();
  };
  if (col.type === 'choice' || col.type === 'relation') control.onchange = () => finish(true);
  td.classList.add('editing');
  td.replaceChildren(control);
  control.focus();
  if (!replace) control.select?.();
}
function openCellPopover(td, tr, row, col, value) {
  closeCellPopover(true);
  const pop = document.createElement('div'),
    actions = document.createElement('div'),
    cancel = document.createElement('button'),
    save = document.createElement('button');
  pop.className = 'ai-grid-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', col.label);
  let read;
  if (col.type === 'multichoice') {
    const picked = new Set(Array.isArray(value) ? value : []);
    const boxes = col.options.map(option => {
      const label = document.createElement('label'),
        box = document.createElement('input');
      box.type = 'checkbox';
      box.value = option;
      box.checked = picked.has(option);
      label.append(box, ' ' + option);
      pop.append(label);
      return box;
    });
    read = () => boxes.filter(b => b.checked).map(b => b.value);
  } else {
    const area = document.createElement('textarea');
    area.rows = 5;
    area.value = value ?? '';
    area.setAttribute('aria-label', col.label);
    pop.append(area);
    read = () => area.value;
  }
  cancel.type = save.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Batal';
  save.textContent = 'Simpan';
  cancel.onclick = () => closeCellPopover(false);
  save.onclick = () => closeCellPopover(true);
  actions.className = 'ai-grid-pop-actions';
  actions.append(cancel, save);
  pop.append(actions);
  pop.onkeydown = e => {
    if (e.key === 'Escape') closeCellPopover(false);
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeCellPopover(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.body.append(pop);
  const box = td.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(box.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top =
    (box.bottom + pop.offsetHeight + 8 > innerHeight ? Math.max(8, box.top - pop.offsetHeight - 4) : box.bottom + 4) +
    'px';
  td.classList.add('editing');
  grid.pop = { pop, td, tr, row, col, read };
  pop.querySelector('textarea,input')?.focus();
}
function closeCellPopover(commit) {
  const p = grid.pop;
  if (!p) return;
  grid.pop = null;
  p.pop.remove();
  if (commit) setCell(p.row, p.col, p.read(), p.tr);
  p.td.classList.remove('editing');
  if (!p.td.isConnected) return;
  paintCell(p.td, p.row, p.col);
  p.td.focus();
}
document.addEventListener('mousedown', e => {
  if (grid.pop && !grid.pop.pop.contains(e.target) && !grid.pop.td.contains(e.target)) closeCellPopover(true);
});
function pickCellFile(td, row, col) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
  input.onchange = () =>
    run(async () => {
      const file = input.files[0];
      if (!file) return;
      td.replaceChildren('Mengunggah…');
      try {
        const saved = await uploadRecordFile(file);
        grid.files[saved.id] = { filename: saved.filename ?? file.name };
        setCell(row, col, saved.id, td.closest('tr'));
      } finally {
        paintCell(td, row, col);
      }
      if (row.record) await saveGridRow(row);
    });
  input.click();
}
// Pindah fokus antarsel: kanan/kiri membuka sel berikutnya, bawah ke kolom sama di baris berikutnya.
function moveFrom(td, direction) {
  const tr = td.closest('tr'),
    cells = [...tr.querySelectorAll('td[tabindex="0"]')],
    index = cells.indexOf(td);
  if (direction === 'down') {
    const rowIndex = Number(tr.dataset.row);
    void saveGridRow(grid.rows[rowIndex]).then(() => {
      const next = document.querySelector(
        '#ai-records tr[data-row="' + (rowIndex + 1) + '"] td[data-col="' + td.dataset.col + '"]',
      );
      (next ?? td).focus();
    });
    return;
  }
  const next = cells[index + (direction === 'right' ? 1 : -1)];
  if (next) {
    if (next.dataset.col && gridColumns().find(x => x.id === next.dataset.col)?.type === 'boolean') next.focus();
    else void editCell(next);
  } else td.focus();
}
$('ai-records').addEventListener('click', e => {
  const td = e.target.closest('#ai-records td[tabindex="0"]');
  if (!td || e.target.closest('a,button,input[type=checkbox]')) return;
  void editCell(td);
});
$('ai-records').addEventListener('keydown', e => {
  const td = e.target;
  if (!(td instanceof HTMLTableCellElement) || td.tabIndex !== 0) return;
  if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ') {
    e.preventDefault();
    void editCell(td);
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const { col } = cellParts(td);
    const short = String(cellParts(td).row.data[col.id] ?? '').length <= 40;
    if (['number', 'phone'].includes(col.type) || (col.type === 'text' && short) || col.id === '__customer')
      void editCell(td, true);
  }
});
// Simpan baris: cek field wajib di browser dulu, lalu kirim. Baris baru yang tidak diisi apa pun diabaikan.
async function saveGridRow(row) {
  if (!row || row.status !== 'dirty') return;
  const c = grid.collection,
    index = grid.rows.indexOf(row),
    tr = document.querySelector('#ai-records tr[data-row="' + index + '"]'),
    note = $('ai-grid-note'),
    defaults = blankRow(c);
  if (!row.record && !row.customer && JSON.stringify(row.data) === JSON.stringify(defaults.data)) {
    row.status = '';
    if (tr) paintStatus(tr, row);
    return;
  }
  row.invalid = new Set(
    c.fields.filter(f => f.required && f.type !== 'boolean' && emptyValue(row.data[f.id])).map(f => f.id),
  );
  if (c.owner === 'customer' && !row.record && !/^[0-9]{5,20}$/.test(row.customer)) row.invalid.add('__customer');
  const fail = message => {
    row.status = 'error';
    row.message = message;
    if (tr) paintStatus(tr, row);
    if (note) note.textContent = (row.record ? 'Baris ' + (index + 1) : 'Baris baru') + ': ' + message;
  };
  if (row.invalid.size) {
    const labels = [...row.invalid].map(id =>
      id === '__customer' ? 'Nomor pelanggan' : c.fields.find(f => f.id === id).label,
    );
    return fail(labels.join(', ') + ' wajib diisi.');
  }
  row.status = 'saving';
  if (tr) paintStatus(tr, row);
  try {
    const saved = await api(recordsBase() + '/' + c.id, row.record ? 'PUT' : 'POST', {
      data: row.data,
      ...(row.record ? { id: row.record.id, revision: row.record.revision } : {}),
      ...(!row.record && c.owner === 'customer' ? { customer: row.customer } : {}),
    });
    if (grid.collection !== c) return;
    if (note) note.textContent = '';
    if (!row.record) {
      // Baris baru tersimpan: muat ulang agar urutan, nomor, dan jumlah record sesuai server.
      await Promise.all([loadRecords(), refreshCounts()]);
      document.querySelector('#ai-records tr.ai-grid-new td[tabindex="0"]')?.focus();
      return;
    }
    row.record = saved;
    row.data = { ...saved.data };
    row.status = 'saved';
    if (tr) paintStatus(tr, row);
  } catch (e) {
    // Pesan nilai unik diawali label field: tandai selnya.
    const field = c.fields.find(f => e.message.startsWith(f.label + ' '));
    if (field) row.invalid.add(field.id);
    fail(e.message);
  }
}
async function deleteRecord(c, r) {
  if (!confirm('Hapus record ini?')) return;
  await api(recordsBase() + '/' + c.id, 'DELETE', { id: r.id, revision: r.revision });
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

// Kontrol formulir koleksi isian.
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
// Kontrol isian per field koleksi isian.
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
async function relationOptions(f, value = '') {
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
$('ai-records-new').onclick = () =>
  void editCell(document.querySelector('#ai-records tr.ai-grid-new td[tabindex="0"]'));
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
    await renderRecordTable(c, { ...result, files: {} }, false);
    $('ai-records-meta').textContent = 'Contoh balasan API: ' + result.records.length + ' record';
  });
