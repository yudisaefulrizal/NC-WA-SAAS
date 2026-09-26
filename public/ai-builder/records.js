// Formulir data per koleksi, relasi, pencarian, pagination, dan revisi untuk mencegah penimpaan perubahan.
const profileId = new URLSearchParams(location.search).get('profile');
const recordsBase = '/api/ai/records/' + encodeURIComponent(profileId || '');
let definition,
  page = 0,
  editing = null;
function collection() {
  return definition.collections.find(c => c.id === $('collection').value);
}
async function loadRecords() {
  const c = collection();
  if (!c) {
    $('records').textContent = 'Profil ini belum memiliki koleksi.';
    $('new-record').disabled = true;
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
  const table = el('table'),
    head = el('tr');
  for (const label of [...(owned ? ['Pelanggan'] : []), ...c.fields.map(f => f.label), 'Dibuat', 'Tindakan'])
    head.append(el('th', label));
  table.append(head);
  for (const r of result.records) {
    const row = el('tr');
    if (owned) row.append(el('td', r.customer || '—'));
    for (const f of c.fields)
      row.append(
        el('td', typeof r.data[f.id] === 'boolean' ? (r.data[f.id] ? 'Ya' : 'Tidak') : String(r.data[f.id] ?? '—')),
      );
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
  $('page').textContent = 'Halaman ' + (page + 1);
  $('prev').disabled = page === 0;
  $('next').disabled = !result.has_more;
}
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
    const wrap = field(
        f.label + (f.required ? ' *' : ''),
        row?.data[f.id] ?? '',
        () => {},
        f.type === 'choice' || f.type === 'relation'
          ? 'select'
          : f.type === 'boolean'
            ? 'checkbox'
            : f.type === 'number'
              ? 'number'
              : f.type === 'date'
                ? 'date'
                : 'text',
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
    for (const f of c.fields) {
      const input = $('record-form').elements.namedItem(f.id);
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
  $('data-title').textContent = definition.name;
  for (const c of definition.collections) {
    const option = el('option', c.name);
    option.value = c.id;
    $('collection').append(option);
  }
  await loadRecords();
});
