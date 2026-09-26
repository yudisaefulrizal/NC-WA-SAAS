// Formulir data per koleksi, relasi, pencarian, pagination, dan revisi untuk mencegah penimpaan perubahan.
const profileId = new URLSearchParams(location.search).get('profile');
const recordsBase = '/api/ai/records/' + encodeURIComponent(profileId || '');
const filesBase = '/api/ai/record-files/' + encodeURIComponent(profileId || '');
let definition,
  sources = [],
  sourceMode = 'builtin',
  page = 0,
  editing = null;
function collection() {
  return definition.collections.find(c => c.id === $('collection').value);
}
// Panel sumber: koleksi memakai tabel aplikasi atau API milik klien. Koleksi API tidak punya record di NC-WA.
function renderSource() {
  const c = collection(),
    source = sources.find(s => s.collection === c?.id) ?? { mode: 'builtin', endpoint: '', has_token: false };
  sourceMode = source.mode;
  for (const b of document.querySelectorAll('#source-mode [data-mode]')) {
    const on = b.dataset.mode === sourceMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('source-api').hidden = sourceMode !== 'endpoint';
  $('source-test').hidden = source.mode !== 'endpoint';
  $('source-endpoint').value = source.endpoint;
  $('source-token').value = '';
  $('source-clear-token').checked = false;
  $('source-token-status').textContent = source.has_token ? 'Token tersimpan.' : 'Belum ada token.';
  $('source-hint').textContent =
    sourceMode === 'endpoint'
      ? 'Semua operasi koleksi ini (cari, ambil, hitung, buat, ubah, hapus) dikirim ke API Anda.'
      : 'Data disimpan dan dikelola di NC-WA melalui tabel di bawah.';
}
for (const b of document.querySelectorAll('#source-mode [data-mode]'))
  b.onclick = () => {
    sourceMode = b.dataset.mode;
    for (const x of document.querySelectorAll('#source-mode [data-mode]')) {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-checked', String(x === b));
    }
    $('source-api').hidden = sourceMode !== 'endpoint';
  };
$('source-save').onclick = () =>
  task(async () => {
    const c = collection();
    const saved = await api('/api/ai/record-sources/' + encodeURIComponent(profileId) + '/' + c.id, 'PUT', {
      mode: sourceMode,
      ...(sourceMode === 'endpoint'
        ? {
            endpoint: $('source-endpoint').value.trim(),
            ...($('source-token').value ? { token: $('source-token').value } : {}),
            clear_token: $('source-clear-token').checked,
          }
        : {}),
    });
    sources = [...sources.filter(s => s.collection !== c.id), saved];
    page = 0;
    await loadRecords();
    notice(
      saved.mode === 'endpoint' ? 'Koleksi ini sekarang memakai API Anda.' : 'Koleksi ini memakai tabel aplikasi.',
    );
  }, $('source-save'));
$('source-test').onclick = () =>
  task(async () => {
    const c = collection();
    const result = await api(
      '/api/ai/record-sources/' + encodeURIComponent(profileId) + '/' + c.id + '/test',
      'POST',
      {},
    );
    renderTable(c, { ...result, files: {} }, false);
    notice('API membalas ' + result.records.length + ' record.');
  }, $('source-test'));
async function loadRecords() {
  const c = collection();
  if (!c) {
    $('records').textContent = 'Profil ini belum memiliki koleksi.';
    $('new-record').disabled = true;
    $('source-panel').hidden = true;
    return;
  }
  renderSource();
  const usesApi = sources.find(s => s.collection === c.id)?.mode === 'endpoint';
  $('new-record').hidden = usesApi;
  // Pencarian hanya untuk tabel aplikasi; data koleksi API dicari di sistem klien.
  $('search-label').hidden = usesApi;
  $('search-button').hidden = usesApi;
  if (usesApi) {
    $('owner-note').hidden = true;
    $('customer-filter-label').hidden = true;
    $('records').replaceChildren(
      el('p', 'Data koleksi ini ada di sistem Anda. Tekan Uji API untuk melihat contoh balasan API.', 'muted'),
    );
    $('prev').disabled = $('next').disabled = true;
    return;
  }
  const owned = c.owner === 'customer';
  $('owner-note').hidden = !owned;
  $('customer-filter-label').hidden = !owned;
  const customer = owned ? $('customer-filter').value.trim() : '';
  const result = await api(
    recordsBase +
      '/' +
      c.id +
      '?page=' +
      page +
      '&q=' +
      encodeURIComponent($('search').value) +
      (customer ? '&customer=' + encodeURIComponent(customer) : ''),
  );
  renderTable(c, result, true);

  $('page').textContent = 'Halaman ' + (page + 1);
  $('prev').disabled = page === 0;
  $('next').disabled = !result.has_more;
}
// editable=false untuk contoh dari API: tanpa tombol ubah/hapus.
function renderTable(c, result, editable) {
  const owned = c.owner === 'customer';
  const table = el('table'),
    head = el('tr');
  for (const label of [
    ...(owned ? ['Pelanggan'] : []),
    ...c.fields.map(f => f.label),
    ...(editable ? ['Dibuat', 'Tindakan'] : []),
  ])
    head.append(el('th', label));
  table.append(head);
  for (const r of result.records) {
    const row = el('tr');
    if (owned) row.append(el('td', r.customer || '—'));
    for (const f of c.fields) row.append(cell(f, r.data[f.id], result.files ?? {}));
    if (!editable) {
      table.append(row);
      continue;
    }
    row.append(el('td', r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '—'));
    const actions = el('td');
    actions.append(
      btn('Ubah', () => edit(r)),
      btn(
        'Hapus',
        async () => {
          if (!confirm('Hapus record ini?')) return;
          await api(recordsBase + '/' + c.id, 'DELETE', { id: r.id, revision: r.revision });
          await loadRecords();
        },
        'danger',
      ),
    );
    row.append(actions);
    table.append(row);
  }
  $('records').replaceChildren(result.records.length ? table : el('p', 'Belum ada data yang sesuai.', 'muted'));
}
// Isi sel tabel sesuai tipe field; file tampil sebagai tautan unduh.
function cell(f, v, files) {
  if (v === undefined || v === null || v === '') return el('td', '—');
  if (f.type === 'boolean') return el('td', v ? 'Ya' : 'Tidak');
  if (Array.isArray(v)) return el('td', v.join(', '));
  if (f.type === 'datetime') return el('td', String(v).replace('T', ' '));
  if (f.type === 'file') {
    const td = el('td'),
      a = el('a', files[v]?.filename ?? 'File');
    a.href = filesBase + '/' + encodeURIComponent(v);
    a.target = '_blank';
    a.rel = 'noopener';
    td.append(a);
    return td;
  }
  return el('td', String(v));
}
const inputTypes = {
  boolean: 'checkbox',
  number: 'number',
  date: 'date',
  time: 'time',
  datetime: 'datetime-local',
  phone: 'tel',
};
async function edit(row = null) {
  editing = row;
  const form = $('record-form'),
    c = collection();
  form.replaceChildren();
  $('record-title').textContent = row ? 'Ubah record' : 'Record baru';
  // Record milik pelanggan dari dashboard wajib menyebut nomor pelanggannya; nomor tidak bisa diubah sesudahnya.
  if (c.owner === 'customer') {
    const wrap = field('Nomor pelanggan *', row?.customer ?? '', () => {}),
      input = wrap.querySelector('input');
    input.name = '__customer';
    input.required = true;
    input.pattern = '[0-9]{5,20}';
    input.inputMode = 'numeric';
    input.disabled = Boolean(row);
    form.append(wrap);
  }
  for (const f of c.fields) {
    let options = f.options;
    if (f.type === 'relation') {
      const records = [];
      let more = true,
        index = 0;
      while (more && index < 10) {
        const r = await api(recordsBase + '/' + f.collection + '?page=' + index++);
        records.push(...r.records);
        more = r.has_more;
      }
      options = [
        { value: '', label: 'Pilih record' },
        ...records.map(r => ({
          value: r.id,
          label:
            Object.values(r.data)
              .filter(v => typeof v === 'string')
              .slice(0, 2)
              .join(' · ') || r.id,
        })),
      ];
      if (row?.data[f.id] && !options.some(o => o.value === row.data[f.id]))
        options.push({ value: row.data[f.id], label: row.data[f.id] });
    } else if (f.type === 'choice') options = [{ value: '', label: 'Pilih' }, ...f.options];
    // Record baru memakai nilai bawaan field; server juga mengisinya bila isian dikosongkan.
    const value = row ? row.data[f.id] : f.default;
    if (f.type === 'multichoice') {
      const group = el('fieldset', undefined, 'choice-group');
      group.append(el('legend', f.label + (f.required ? ' *' : '')));
      for (const option of f.options) {
        const label = el('label', option),
          box = el('input');
        box.type = 'checkbox';
        box.name = f.id;
        box.value = option;
        box.checked = Array.isArray(value) && value.includes(option);
        label.prepend(box);
        group.append(label);
      }
      form.append(group);
      continue;
    }
    if (f.type === 'file') {
      const wrap = field(f.label + (f.required ? ' *' : ''), '', () => {}, 'file'),
        input = wrap.querySelector('input');
      input.name = f.id;
      input.accept = 'image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
      input.dataset.current = value ?? '';
      input.required = f.required && !value;
      if (value) wrap.append(el('small', 'File sekarang tetap dipakai bila tidak memilih file baru.', 'hint'));
      form.append(wrap);
      continue;
    }
    const wrap = field(
        f.label + (f.required ? ' *' : ''),
        value ?? '',
        () => {},
        f.type === 'choice' || f.type === 'relation' ? 'select' : (inputTypes[f.type] ?? 'text'),
        options,
      ),
      input = wrap.querySelector('input,select');
    input.name = f.id;
    input.required = f.required && f.type !== 'boolean';
    if (f.type === 'number') input.step = 'any';
    form.append(wrap);
  }
  const actions = el('div', undefined, 'actions');
  const save = el('button', 'Simpan', 'primary');
  save.type = 'submit';
  actions.append(
    btn('Batal', () => $('record-dialog').close()),
    save,
  );
  form.append(actions);
  $('record-dialog').showModal();
}
$('record-form').onsubmit = e => {
  e.preventDefault();
  task(async () => {
    const c = collection(),
      data = {};
    const form = $('record-form');
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
        if (file) data[f.id] = (await uploadFile(file)).id;
        else if (input.dataset.current) data[f.id] = input.dataset.current;
        continue;
      }
      if (f.type === 'boolean') data[f.id] = input.checked;
      else if (input.value !== '') data[f.id] = f.type === 'number' ? Number(input.value) : input.value;
    }
    await api(recordsBase + '/' + c.id, editing ? 'PUT' : 'POST', {
      data,
      ...(editing ? { id: editing.id, revision: editing.revision } : {}),
      ...(!editing && c.owner === 'customer'
        ? { customer: $('record-form').elements.namedItem('__customer').value.trim() }
        : {}),
    });
    $('record-dialog').close();
    await loadRecords();
    notice('Record tersimpan.');
  }, $('record-form').querySelector('[type=submit]'));
};
$('new-record').onclick = () => task(() => edit());
$('collection').onchange = () => {
  page = 0;
  task(loadRecords);
};
$('search-button').onclick = () => {
  page = 0;
  task(loadRecords);
};
$('customer-filter').onkeydown = e => {
  if (e.key === 'Enter') {
    page = 0;
    task(loadRecords);
  }
};
$('search').onkeydown = e => {
  if (e.key === 'Enter') {
    page = 0;
    task(loadRecords);
  }
};
$('prev').onclick = () => {
  page--;
  task(loadRecords);
};
$('next').onclick = () => {
  page++;
  task(loadRecords);
};
task(async () => {
  if (!profileId) throw Error('Pilih data profil melalui halaman Asisten AI.');
  definition = await api(recordsBase);
  sources = await api('/api/ai/record-sources/' + encodeURIComponent(profileId));
  $('data-title').textContent = definition.name;
  for (const c of definition.collections) {
    const option = el('option', c.name);
    option.value = c.id;
    $('collection').append(option);
  }
  await loadRecords();
});
async function uploadFile(file) {
  const r = await fetch(filesBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'File gagal diunggah.');
  return d;
}
