// Pengaturan node dan pemetaan variabel; perubahan dicatat agar dapat diurungkan.
function removeNode(id) {
  if (!confirm('Hapus node beserta koneksinya?')) return;
  mutate(() => {
    state.document.nodes = state.document.nodes.filter(n => n.id !== id);
    state.document.edges = state.document.edges.filter(e => e.source !== id && e.target !== id);
    for (const n of state.document.nodes) {
      n.tools = n.tools.filter(t => t !== id);
      if (n.memory === id) n.memory = '';
    }
  });
  state.selected = null;
  renderInspector();
}
function renderInspector() {
  const host = $('inspector'),
    n = state.document?.nodes.find(n => n.id === state.selected);
  host.replaceChildren();
  if (!n) {
    const empty = el('div', undefined, 'empty');
    empty.append(
      el('span', '◇', 'large-icon'),
      el('h3', 'Atur langkah alur'),
      el('p', 'Pilih node di kanvas untuk mengatur perilaku dan keluarannya.'),
    );
    host.append(empty);
    return;
  }
  const head = el('div', undefined, 'inspector-title');
  head.append(
    el('h2', kinds[n.type][0] + ' ' + kinds[n.type][1]),
    btn('×', () => {
      state.selected = null;
      renderInspector();
      renderCanvas();
    }),
  );
  host.append(head, el('p', kinds[n.type][2], 'hint'));
  const edit = (key, label, type = 'text', options = []) =>
    field(label, n[key], v => mutate(() => (n[key] = v)), type, options);
  host.append(edit('label', 'Nama node'), el('p', 'ID variabel: ' + n.id, 'hint'));
  if (memoryConsumers.includes(n.type)) {
    host.append(
      field(
        'Shared Memory',
        n.memory ?? '',
        id => {
          mutate(() => (n.memory = id));
          renderInspector();
        },
        'select',
        [
          { value: '', label: 'Tidak terhubung' },
          ...state.document.nodes.filter(m => m.type === 'memory').map(m => ({ value: m.id, label: m.label })),
        ],
      ),
      el(
        'p',
        'Hanya node yang terhubung yang membaca riwayat dan ringkasan percakapan. Lepaskan koneksi untuk menjalankannya tanpa memori.',
        'hint',
      ),
    );

    host.append(
      edit('tier', 'Tier model', 'select', [
        { value: 'cheap', label: 'Murah' },
        { value: 'medium', label: 'Sedang' },
        { value: 'smart', label: 'Cerdas' },
        { value: 'structured', label: 'Terstruktur' },
        ...(n.type === 'router' ? [{ value: 'decision', label: 'Keputusan' }] : []),
      ]),
      edit('model', 'Model khusus (opsional)'),
      edit('prompt', n.type === 'extract' ? 'Instruksi tambahan (opsional)' : 'Instruksi', 'textarea'),
    );
  }
  if (n.type === 'extract') renderExtract(host, n);
  if (n.type === 'compute') renderCompute(host, n);
  if (n.type === 'media') renderMedia(host, n);
  if (n.type === 'context')
    host.append(
      field('Format konteks', n.context_format || 'text', v => mutate(() => (n.context_format = v)), 'select', [
        { value: 'text', label: 'Ringkasan bebas' },
        { value: 'spo', label: 'S-P-O (seperti CS bawaan)' },
      ]),
      el(
        'p',
        'S-P-O meringkas riwayat dari memori yang terhubung, pesan terbaru, dan jawaban Agent terakhir. Format diperiksa dan diperbaiki satu kali jika tidak valid.',
        'hint',
      ),
    );
  if (n.type === 'memory') {
    host.append(
      field('Pesan sebelumnya (0–60)', n.memory_limit ?? 20, v => mutate(() => (n.memory_limit = v)), 'number'),
      el(
        'p',
        'Hubungkan ke satu atau beberapa Router, Agent, atau Context melalui port Memori. Data tetap terpisah per akun, sesi WhatsApp, dan pelanggan.',
        'hint',
      ),
      el(
        'p',
        '0 hanya meneruskan pesan terbaru dan ringkasan. Batas penyimpanan sesi tetap mengikuti pengaturan memori AI. Context yang terhubung memperbarui ringkasan; riwayat disimpan otomatis setelah balasan.',
        'hint',
      ),
    );
    host.append(el('h3', 'Node yang memakai memori'));
    for (const consumer of state.document.nodes.filter(x => memoryConsumers.includes(x.type)))
      host.append(
        field(
          consumer.label,
          consumer.memory === n.id,
          on => {
            mutate(() => (consumer.memory = on ? n.id : ''));
            renderInspector();
          },
          'checkbox',
        ),
      );
    const limit = host.querySelector('input[type=number]');
    limit.min = '0';
    limit.max = '60';
    limit.step = '1';
  }
  if (n.type === 'router') {
    host.append(el('h3', 'Cabang keputusan'));
    for (const b of n.branches) {
      const box = el('div', undefined, 'branch');
      box.append(
        field('ID port', b.id, v =>
          mutate(() => {
            for (const e of state.document.edges.filter(e => e.source === n.id && e.port === b.id)) e.port = v;
            b.id = v;
          }),
        ),
        field('Label', b.label, v => mutate(() => (b.label = v))),
        field('Kapan dipilih?', b.description, v => mutate(() => (b.description = v)), 'textarea'),
        btn(
          'Hapus cabang',
          () => {
            mutate(() => {
              n.branches = n.branches.filter(x => x !== b);
              state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === b.id));
            });
            renderInspector();
          },
          'danger',
        ),
      );
      host.append(box);
    }
    host.append(
      btn('＋ Cabang', () => {
        mutate(() => n.branches.push({ id: uid('branch'), label: 'Cabang baru', description: '' }));
        renderInspector();
      }),
    );
  }
  if (n.type === 'agent') {
    host.append(
      field(
        'Aktifkan port Fallback ke petugas',
        Boolean(n.fallback),
        v => {
          mutate(() => {
            n.fallback = v;
            if (!v)
              state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === 'fallback'));
          });
          renderInspector();
        },
        'checkbox',
      ),
    );
    host.append(el('h3', 'Tool yang boleh dipakai'));
    for (const id of n.tools.filter(id => !state.document.nodes.some(t => t.id === id && t.type === 'tool')))
      host.append(el('div', 'Tool belum tersedia: ' + id, 'issue'));
    const tools = state.document.nodes.filter(t => t.type === 'tool');
    if (!tools.length) host.append(el('p', 'Tambahkan node Data, lalu pilih di sini.', 'hint'));
    for (const t of tools)
      host.append(
        field(
          t.label,
          n.tools.includes(t.id),
          v => mutate(() => (n.tools = v ? [...new Set([...n.tools, t.id])] : n.tools.filter(id => id !== t.id))),
          'checkbox',
        ),
      );
  }
  if (n.type === 'condition') renderRules(host, n);
  if (n.type === 'tool') {
    host.append(
      field(
        'Jenis',
        n.capability || '',
        v => {
          mutate(() => {
            if (v) n.capability = v;
            else delete n.capability;
            if (v === 'create_order') n.tier = 'structured';
          });
          renderInspector();
        },
        'select',
        [
          { value: '', label: 'Data koleksi' },
          { value: 'get_knowledge', label: 'Bisnis: baca profil usaha' },
          { value: 'get_products', label: 'Bisnis: cari produk katalog' },
          { value: 'check_order', label: 'Bisnis: periksa pesanan pelanggan' },
          { value: 'create_order', label: 'Bisnis: buat pesanan tervalidasi' },
          { value: 'send_product_image', label: 'Bisnis: kirim foto produk' },
        ],
      ),
    );
    if (n.capability) {
      host.append(
        edit('query', 'Parameter / variabel (diisi Agent bila dipanggil)'),
        el(
          'p',
          'Data bisnis dikelola per Data Profil melalui menu usaha, produk, dan pesanan. Identitas pelanggan berasal dari sesi. Sandbox memakai data contoh bisnis.',
          'hint',
        ),
      );
      if (n.capability === 'create_order')
        host.append(
          edit('tier', 'Tier ekstraksi Pesanan', 'select', [
            { value: 'cheap', label: 'Murah' },
            { value: 'medium', label: 'Sedang' },
            { value: 'smart', label: 'Cerdas' },
            { value: 'structured', label: 'Terstruktur' },
          ]),
          edit('model', 'Model ekstraksi (opsional)'),
          edit('prompt', 'Instruksi ekstraksi (kosong untuk bawaan)', 'textarea'),
        );
    } else renderRecordTool(host, n);
  }
  if (['output', 'fallback'].includes(n.type))
    host.append(edit('value', n.type === 'output' ? 'Jawaban / variabel hasil' : 'Pesan untuk petugas', 'textarea'));
  if (n.type === 'input')
    host.append(el('p', 'Menyediakan input.message, input.context, dan input.history dari percakapan.', 'hint'));
  if (nodePorts(n).length) {
    host.append(el('h3', 'Tujuan koneksi'));
    for (const port of nodePorts(n)) {
      const current = state.document.edges.find(e => e.source === n.id && e.port === port);
      host.append(
        field(
          n.branches.find(b => b.id === port)?.label || port,
          current?.target || '',
          target => {
            if (!target) {
              mutate(
                () =>
                  (state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === port))),
              );
              return;
            }
            state.pending = { source: n.id, port };
            connect(target);
          },
          'select',
          [
            { value: '', label: 'Belum terhubung' },
            ...state.document.nodes
              .filter(t => t.id !== n.id && !['input', 'memory'].includes(t.type))
              .map(t => ({ value: t.id, label: t.label })),
          ],
        ),
      );
    }
  }
  const variables = el('details');
  variables.append(
    el('summary', 'Variabel yang tersedia'),
    el('p', 'Salin ke instruksi atau pemetaan. Node sumber harus sudah berjalan pada jalur yang sama.', 'hint'),
  );
  for (const path of [
    'input.message',
    'input.context',
    'input.history',
    ...Object.entries(contextVariables).flatMap(([root, keys]) => keys.map(key => root + '.' + key)),
    ...state.document.nodes
      .filter(
        x =>
          x.id !== n.id &&
          (x.type === 'memory'
            ? x.id === n.memory
            : ['agent', 'context', 'router', 'tool', 'extract', 'compute', 'media'].includes(x.type)),
      )
      .flatMap(x =>
        (x.type === 'memory'
          ? ['history', 'context']
          : x.type === 'tool'
            ? x.capability
              ? {
                  get_knowledge: ['knowledge'],
                  get_products: ['products'],
                  check_order: ['order'],
                  create_order: ['order'],
                  send_product_image: ['available', 'product_name', 'image_id'],
                }[x.capability]
              : recordOutputs(x)
            : x.type === 'extract'
              ? [...(x.fields ?? []).map(f => f.id), 'missing']
              : x.type === 'compute'
                ? (x.steps ?? []).map(step => step.name)
                : x.type === 'media'
                  ? ['files', 'count', 'skipped']
                  : [{ agent: 'answer', context: 'context', router: 'branch' }[x.type]]
        ).map(key => 'nodes.' + x.id + '.' + key),
      ),
  ])
    variables.append(el('pre', '{{' + path + '}}'));
  host.append(variables);
  const actions = el('div', undefined, 'actions');
  actions.append(
    btn('Duplikat', () => {
      const copy = structuredClone(n);
      copy.id = uid(n.type);
      copy.x += 40;
      copy.y += 140;
      mutate(() => state.document.nodes.push(copy));
      selectNode(copy.id);
    }),
    btn('Hapus', () => removeNode(n.id), 'danger'),
  );
  host.append(actions);
}

// Variabel yang disediakan runtime; sama dengan contextVariables di definition.ts.
const contextVariables = {
  system: ['today', 'tomorrow', 'now', 'time', 'weekday'],
  customer: ['name', 'phone'],
  service: ['name'],
};
const operations = [
  ['search', 'Cari'],
  ['get', 'Ambil'],
  ['create', 'Buat'],
  ['update', 'Ubah'],
  ['delete', 'Hapus'],
  ['count', 'Hitung'],
];
const filterOperators = [
  ['equals', 'sama dengan'],
  ['not_equals', 'tidak sama dengan'],
  ['contains', 'mengandung'],
  ['not_contains', 'tidak mengandung'],
  ['greater', 'lebih besar dari'],
  ['greater_equal', 'lebih besar/sama'],
  ['less', 'lebih kecil dari'],
  ['less_equal', 'lebih kecil/sama'],
  ['exists', 'terisi'],
  ['empty', 'kosong'],
];
const conditionOperators = [
  ['equals', 'sama dengan'],
  ['not_equals', 'tidak sama dengan'],
  ['contains', 'mengandung'],
  ['not_contains', 'tidak mengandung'],
  ['exists', 'terisi'],
  ['empty', 'kosong'],
  ['greater', 'lebih besar'],
  ['less', 'lebih kecil'],
  ['date_before', 'tanggal sebelum'],
  ['date_on_or_after', 'tanggal sama/setelah'],
  ['weekday_is', 'hari adalah'],
  ['time_between', 'jam antara'],
  ['one_of', 'salah satu dari'],
  ['count_greater', 'jumlah item lebih dari'],
];
const noCompare = ['exists', 'empty'];
const comparePlaceholder = {
  weekday_is: 'Senin, Selasa',
  time_between: '08.00-16.00',
  one_of: 'nilai1, nilai2',
  date_before: '{{system.today}}',
  date_on_or_after: '{{system.today}}',
};
function recordOutputs(x) {
  if (['search', 'get'].includes(x.operation)) {
    const c = state.document.collections.find(c => c.id === x.collection);
    return ['records', 'count', 'first.id', ...(c?.fields.map(f => 'first.data.' + f.id) ?? []), 'has_more'];
  }
  if (x.operation === 'count') return ['count', 'total'];
  if (x.operation === 'delete') return ['id', 'deleted'];
  return ['id', 'data', 'revision'];
}
function options(pairs) {
  return pairs.map(([value, label]) => ({ value, label }));
}
// Mengganti operasi mengubah daftar port; koneksi lama dipindah ke port yang setara supaya alur tidak putus.
function syncPorts(n, before) {
  const after = nodePorts(n);
  const edges = state.document.edges.filter(e => e.source === n.id);
  if (before.includes('next') && after.includes('found')) {
    const old = edges.find(e => e.port === 'next');
    if (old) {
      old.port = 'found';
      state.document.edges.push({ id: uid('edge'), source: n.id, port: 'empty', target: old.target });
    }
  } else if (before.includes('found') && after.includes('next')) {
    const found = edges.find(e => e.port === 'found');
    if (found) found.port = 'next';
  }
  state.document.edges = state.document.edges.filter(e => e.source !== n.id || after.includes(e.port));
}
function renderRecordTool(host, n) {
  const collection = state.document.collections.find(c => c.id === n.collection);
  const agents = state.document.nodes.filter(a => a.type === 'agent');
  const users = agents.filter(a => a.tools.includes(n.id));
  const inFlow = state.document.edges.some(e => e.source === n.id || e.target === n.id);
  const byAgent = users.length > 0 && !inFlow;
  host.append(
    field(
      'Koleksi',
      n.collection,
      v => {
        mutate(() => {
          n.collection = v;
          n.filters = [];
          n.sort_field = '';
          n.sum_field = '';
        });
        renderInspector();
      },
      'select',
      [
        { value: '', label: 'Pilih koleksi' },
        ...state.document.collections.map(c => ({
          value: c.id,
          label: c.name + (c.owner === 'customer' ? ' · milik pelanggan' : ' · umum'),
        })),
      ],
    ),
  );
  if (collection?.owner === 'customer')
    host.append(
      el('p', 'Milik pelanggan: otomatis hanya membaca dan mengubah record pelanggan yang sedang chat.', 'hint'),
    );
  const ops = el('div', undefined, 'segmented operations');
  ops.setAttribute('role', 'radiogroup');
  ops.setAttribute('aria-label', 'Operasi');
  for (const [value, label] of operations) {
    const b = btn(label, () => {
      const before = nodePorts(n);
      mutate(() => {
        n.operation = value;
        syncPorts(n, before);
        if (['create', 'update'].includes(value) && !n.value.trim().startsWith('{')) n.value = '{"data":{}}';
        if (value === 'update' && n.value === '{"data":{}}') n.value = '{"id":"","data":{}}';
      });
      renderInspector();
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(n.operation === value));
    if (n.operation === value) b.classList.add('active');
    ops.append(b);
  }
  host.append(el('h3', 'Operasi'), ops);

  const mode = el('div', undefined, 'segmented');
  mode.setAttribute('role', 'radiogroup');
  mode.setAttribute('aria-label', 'Cara dijalankan');
  for (const [value, label] of [
    ['flow', 'Di alur'],
    ['agent', 'Dipanggil Agent'],
  ]) {
    const b = btn(label, () => {
      mutate(() => {
        if (value === 'flow') for (const a of agents) a.tools = a.tools.filter(id => id !== n.id);
        else {
          state.document.edges = state.document.edges.filter(e => e.source !== n.id && e.target !== n.id);
          if (!agents.some(a => a.tools.includes(n.id)) && agents[0]) agents[0].tools.push(n.id);
        }
      });
      renderInspector();
    });
    const on = (value === 'agent') === byAgent;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    if (on) b.classList.add('active');
    mode.append(b);
  }
  host.append(
    el('h3', 'Cara dijalankan'),
    mode,
    el(
      'p',
      byAgent
        ? 'Agent memutuskan kapan memakai node ini dan mengisi kata kunci, filter tambahan, atau data yang ditulis.'
        : 'Selalu dijalankan saat alur melewati node ini. Nilai boleh memakai variabel.',
      'hint',
    ),
  );
  if (byAgent)
    for (const a of agents)
      host.append(
        field(
          'Dipakai ' + a.label,
          a.tools.includes(n.id),
          v => {
            mutate(() => (a.tools = v ? [...new Set([...a.tools, n.id])] : a.tools.filter(id => id !== n.id)));
            renderInspector();
          },
          'checkbox',
        ),
      );
  if (!collection) return;
  const fieldOptions = collection.fields.map(f => ({ value: f.id, label: f.label + ' (' + f.id + ')' }));
  if (['search', 'count'].includes(n.operation)) {
    host.append(el('h3', 'Filter'));
    const filters = n.filters ?? [];
    if (filters.length > 1)
      host.append(
        field('Cocok bila', n.match || 'all', v => mutate(() => (n.match = v)), 'select', [
          { value: 'all', label: 'semua filter terpenuhi' },
          { value: 'any', label: 'salah satu filter terpenuhi' },
        ]),
      );
    filters.forEach((f, i) => {
      const row = el('div', undefined, 'rule-row');
      row.append(
        field('Field', f.field, v => mutate(() => (f.field = v)), 'select', fieldOptions),
        field(
          'Operator',
          f.operator,
          v => {
            mutate(() => (f.operator = v));
            renderInspector();
          },
          'select',
          options(filterOperators),
        ),
      );
      if (!noCompare.includes(f.operator)) row.append(field('Nilai', f.value, v => mutate(() => (f.value = v))));
      const remove = btn('×', () => {
        mutate(() => n.filters.splice(i, 1));
        renderInspector();
      });
      remove.setAttribute('aria-label', 'Hapus filter');
      row.append(remove);
      host.append(row);
    });
    host.append(
      btn('＋ Filter', () => {
        mutate(() => {
          n.filters ??= [];
          n.filters.push({ field: collection.fields[0]?.id ?? '', operator: 'equals', value: '' });
        });
        renderInspector();
      }),
      nodeField(n, 'query', byAgent ? 'Kata kunci awal (diganti Agent)' : 'Kata kunci (opsional)'),
      el('p', 'Record yang memuat salah satu kata ditampilkan, paling cocok lebih dulu.', 'hint'),
    );
  }
  if (n.operation === 'search') {
    const sort = el('div', undefined, 'rule-row');
    sort.append(
      field('Urutkan', n.sort_field || 'created_at', v => mutate(() => (n.sort_field = v)), 'select', [
        { value: 'created_at', label: 'Waktu dibuat' },
        ...fieldOptions,
      ]),
      field('Arah', n.sort_direction || 'asc', v => mutate(() => (n.sort_direction = v)), 'select', [
        { value: 'asc', label: 'Naik' },
        { value: 'desc', label: 'Turun' },
      ]),
      field(
        'Batas',
        n.limit ?? 10,
        v => mutate(() => (n.limit = Math.min(100, Math.max(1, Math.round(v) || 1)))),
        'number',
      ),
    );
    host.append(sort);
  }
  if (n.operation === 'count')
    host.append(
      field('Jumlahkan field (opsional)', n.sum_field || '', v => mutate(() => (n.sum_field = v)), 'select', [
        { value: '', label: 'Hanya hitung jumlah record' },
        ...collection.fields.filter(f => f.type === 'number').map(f => ({ value: f.id, label: f.label })),
      ]),
    );
  if (['get', 'delete'].includes(n.operation))
    host.append(
      nodeField(n, 'query', byAgent ? 'ID record (diisi Agent)' : 'ID record, misalnya {{nodes.cari.first.id}}'),
    );
  if (['create', 'update'].includes(n.operation))
    host.append(
      nodeField(
        n,
        'value',
        n.operation === 'create'
          ? 'Data record: {"data":{"field":"nilai"}}'
          : 'Perubahan: {"id":"…","data":{"field":"nilai"}}',
        'textarea',
      ),
      el(
        'p',
        (n.operation === 'update' ? 'Hanya field yang dikirim yang diubah; null mengosongkan field. ' : '') +
          'Field: ' +
          collection.fields.map(f => f.id + (f.required ? '*' : '')).join(', '),
        'hint',
      ),
    );
  if (nodePorts(n).includes('found'))
    host.append(el('p', 'Jalur Ditemukan bila ada hasil, Kosong bila tidak ada.', 'hint'));
}
function nodeField(n, key, label, type = 'text') {
  return field(label, n[key], v => mutate(() => (n[key] = v)), type);
}
function renderRules(host, n) {
  n.rules ??= [{ field: n.field, operator: n.operator, compare: n.compare }];
  host.append(
    field('Cocok bila', n.match || 'all', v => mutate(() => (n.match = v)), 'select', [
      { value: 'all', label: 'semua syarat terpenuhi' },
      { value: 'any', label: 'salah satu syarat terpenuhi' },
    ]),
  );
  const leaf = (list, r, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nilai yang diperiksa', r.field, v => mutate(() => (r.field = v))),
      field(
        'Operator',
        r.operator,
        v => {
          mutate(() => (r.operator = v));
          renderInspector();
        },
        'select',
        options(conditionOperators),
      ),
    );
    if (!noCompare.includes(r.operator)) {
      const compare = field('Pembanding', r.compare, v => mutate(() => (r.compare = v)));
      compare.querySelector('input').placeholder = comparePlaceholder[r.operator] ?? '';
      box.append(compare);
    }
    const remove = btn('Hapus syarat', () => {
      mutate(() => list.splice(i, 1));
      renderInspector();
    });
    box.append(remove);
    return box;
  };
  n.rules.forEach((r, i) => {
    if (!r.rules) {
      host.append(leaf(n.rules, r, i));
      return;
    }
    const group = el('div', undefined, 'rule-group');
    group.append(
      field('Grup cocok bila', r.match, v => mutate(() => (r.match = v)), 'select', [
        { value: 'all', label: 'semua syarat grup' },
        { value: 'any', label: 'salah satu syarat grup' },
      ]),
    );
    r.rules.forEach((x, j) => group.append(leaf(r.rules, x, j)));
    group.append(
      btn('＋ Syarat grup', () => {
        mutate(() => r.rules.push({ field: 'input.message', operator: 'contains', compare: '' }));
        renderInspector();
      }),
      btn(
        'Hapus grup',
        () => {
          mutate(() => n.rules.splice(i, 1));
          renderInspector();
        },
        'danger',
      ),
    );
    host.append(group);
  });
  host.append(
    btn('＋ Syarat', () => {
      mutate(() => n.rules.push({ field: 'input.message', operator: 'contains', compare: '' }));
      renderInspector();
    }),
    btn('＋ Grup DAN/ATAU', () => {
      mutate(() =>
        n.rules.push({ match: 'any', rules: [{ field: 'input.message', operator: 'contains', compare: '' }] }),
      );
      renderInspector();
    }),
    el(
      'p',
      'Nilai yang diperiksa berupa path variabel, misalnya nodes.isian.tanggal atau system.weekday. Pembanding boleh memakai {{variabel}}.',
      'hint',
    ),
  );
}

const extractTypes = ['text', 'number', 'boolean', 'date', 'time', 'datetime', 'choice', 'multichoice', 'phone'];
function renderExtract(host, n) {
  n.fields ??= [];
  host.append(
    el('h3', 'Field yang diambil'),
    el(
      'p',
      'Model mengisi null bila pelanggan tidak menyebutkannya. Field wajib yang kosong masuk ke missing. Tanggal relatif seperti "besok" diubah memakai tanggal hari ini (WIB).',
      'hint',
    ),
  );
  n.fields.forEach((f, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('ID field', f.id, v => mutate(() => (f.id = v))),
      field('Label', f.label, v => mutate(() => (f.label = v))),
      field(
        'Tipe',
        f.type,
        v => {
          mutate(() => {
            f.type = v;
            if (['choice', 'multichoice'].includes(v) && !f.options.length) f.options = ['Pilihan 1'];
          });
          renderInspector();
        },
        'select',
        extractTypes.map(t => ({ value: t, label: fieldTypeLabels[t] })),
      ),
      field('Wajib', f.required, v => mutate(() => (f.required = v)), 'checkbox'),
      field('Petunjuk untuk AI', f.hint, v => mutate(() => (f.hint = v))),
    );
    if (['choice', 'multichoice'].includes(f.type))
      box.append(
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
    box.append(
      btn('Hapus field', () => {
        mutate(() => n.fields.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  host.append(
    btn('＋ Field', () => {
      mutate(() =>
        n.fields.push({
          id: 'field_' + (n.fields.length + 1),
          label: 'Field baru',
          type: 'text',
          required: false,
          hint: '',
          options: [],
        }),
      );
      renderInspector();
    }),
  );
  // Menyalin field koleksi yang bisa diambil dari teks; relasi dan file dilewati.
  const collections = state.document.collections.filter(c => c.fields.some(f => extractTypes.includes(f.type)));
  if (collections.length)
    host.append(
      field(
        'Salin field dari koleksi',
        '',
        id => {
          const c = state.document.collections.find(c => c.id === id);
          if (!c) return;
          mutate(() => {
            for (const f of c.fields.filter(f => extractTypes.includes(f.type) && !n.fields.some(x => x.id === f.id)))
              n.fields.push({
                id: f.id,
                label: f.label,
                type: f.type,
                required: f.required,
                hint: '',
                options: [...f.options],
              });
          });
          renderInspector();
        },
        'select',
        [{ value: '', label: 'Pilih koleksi' }, ...collections.map(c => ({ value: c.id, label: c.name }))],
      ),
    );
}
const computeOps = [
  ['value', 'Ambil nilai', ['Nilai']],
  ['add', 'Tambah', ['Angka', 'Ditambah']],
  ['subtract', 'Kurang', ['Angka', 'Dikurangi']],
  ['multiply', 'Kali', ['Angka', 'Dikali']],
  ['divide', 'Bagi', ['Angka', 'Dibagi']],
  ['round', 'Bulatkan', ['Angka', 'Jumlah desimal (0–6)']],
  ['format_rupiah', 'Format rupiah', ['Angka']],
  ['concat', 'Gabung teks', ['Templat teks']],
  ['truncate', 'Potong teks', ['Teks', 'Maksimal karakter']],
  ['add_days', 'Tambah hari', ['Tanggal', 'Jumlah hari (boleh negatif)']],
  ['days_between', 'Selisih hari', ['Dari tanggal', 'Sampai tanggal']],
  ['format_date', 'Format tanggal', ['Tanggal']],
  ['length', 'Jumlah item', ['Daftar atau teks']],
  ['item_at', 'Ambil item ke-', ['Daftar', 'Urutan (mulai 1)']],
];
function renderCompute(host, n) {
  n.steps ??= [];
  host.append(
    el('h3', 'Langkah · dijalankan berurutan'),
    el(
      'p',
      'Setiap hasil dibaca sebagai {{nodes.' +
        n.id +
        '.nama_hasil}} dan boleh dipakai langkah sesudahnya. Nilai yang tidak sesuai menghentikan alur dan tercatat di jejak.',
      'hint',
    ),
  );
  n.steps.forEach((step, i) => {
    const [, , labels] = computeOps.find(([op]) => op === step.op) ?? computeOps[0];
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nama hasil', step.name, v => mutate(() => (step.name = v))),
      field(
        'Operasi',
        step.op,
        v => {
          const arity = computeOps.find(([op]) => op === v)[2].length;
          mutate(() => {
            step.op = v;
            step.args = [...step.args, '', ''].slice(0, arity);
          });
          renderInspector();
        },
        'select',
        computeOps.map(([value, label]) => ({ value, label })),
      ),
      ...labels.map((label, j) => field(label, step.args[j] ?? '', v => mutate(() => (step.args[j] = v)))),
      btn('Hapus langkah', () => {
        mutate(() => n.steps.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  host.append(
    btn('＋ Langkah', () => {
      mutate(() => n.steps.push({ name: 'hasil_' + (n.steps.length + 1), op: 'value', args: [''] }));
      renderInspector();
    }),
  );
}
function renderMedia(host, n) {
  host.append(
    nodeField(n, 'value', 'File yang dikirim', 'textarea'),
    el(
      'p',
      'Isi dengan variabel field File/gambar, misalnya {{nodes.cari.first.data.brosur}}, URL HTTPS dari koleksi API, atau daftar keduanya. Nilai kosong berarti tidak ada file yang dikirim.',
      'hint',
    ),
    nodeField(n, 'caption', 'Keterangan (opsional)'),
    field('Waktu kirim', n.send_when || 'before', v => mutate(() => (n.send_when = v)), 'select', [
      { value: 'before', label: 'Sebelum jawaban teks' },
      { value: 'after', label: 'Sesudah jawaban teks' },
    ]),
    field('Kirim sebagai', n.media_as || 'auto', v => mutate(() => (n.media_as = v)), 'select', [
      { value: 'auto', label: 'Otomatis (gambar tampil sebagai foto)' },
      { value: 'image', label: 'Gambar' },
      { value: 'document', label: 'Dokumen' },
    ]),
    el(
      'p',
      'Dikirim setelah alur selesai dan tidak dikirim bila percakapan diteruskan ke tim. Maksimal 3 file per balasan, 1 kredit WhatsApp per file. Simulasi dan Uji Coba hanya menampilkan daftarnya.',
      'hint',
    ),
  );
}
