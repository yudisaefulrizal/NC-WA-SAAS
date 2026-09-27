// Perkakas data profil dinamis: koleksi milik pelanggan, filter/urutan/batas (MySQL dan simulasi harus sama),
// operasi Ambil/Ubah/Hapus/Hitung, port Ditemukan/Kosong, Kondisi lengkap, dan variabel sistem.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  ports,
  type Collection,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import {
  ruleMatches,
  conditionMatches,
  systemVariables,
} from '../../../src/components/ai/domain/builder/conditions.js';
import {
  filterGroup,
  sortSpec,
  keywords,
  queryMemory,
  type RecordQuery,
} from '../../../src/components/ai/domain/builder/record-query.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';

const owner = randomUUID(),
  client = randomUUID();
const ids: string[] = [];
const service = new AIService(
  async () => '{"answer":"Selesai"}',
  async () => {},
);
const noModel: AITransport = async () => {
  throw Error('Model tidak boleh dipanggil');
};
const text = (id: string, required = false) => ({
  id,
  label: id,
  type: 'text' as const,
  required,
  options: [],
  collection: '',
});
const layanan: Collection = {
  id: 'layanan',
  name: 'Layanan',
  owner: 'shared',
  fields: [text('nama', true), { ...text('harga'), type: 'number' }],
};
const booking: Collection = {
  id: 'booking',
  name: 'Booking',
  owner: 'customer',
  fields: [
    { ...text('layanan'), type: 'relation', collection: 'layanan' },
    { ...text('tanggal'), type: 'date' },
    { ...text('status'), type: 'choice', options: ['menunggu', 'batal'] },
  ],
};
before(async () => {
  for (const [id, role] of [
    [owner, 'owner'],
    [client, 'user'],
  ])
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
});
after(async () => {
  for (const id of [owner, client]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
});
function node(id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode {
  return { ...blankDefinition().nodes[2], id, type, label: id, value: '', ...extra };
}
// Graf terbit + data profil klien, supaya node Data menulis ke database seperti runtime WhatsApp.
async function published(d: GraphDefinition) {
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const profile = await service.createDataProfile(client, { profile_type: g.id, name: 'Data ' + g.id });
  return { g, profile, active: (await store.findGraph(g.id))!.active! };
}
const run = (d: GraphDefinition, profile: string, customer: string, message = 'halo') =>
  runGraph(d, noModel, { ...defaults }, [{ role: 'user', content: message }], {
    account: client,
    profile,
    session: 'test',
    customer,
    requestId: randomUUID(),
    fallbackEnabled: false,
  });

test('Contract: old Search ports and single conditions normalize; ownership and variables are validated', () => {
  const d = blankDefinition();
  d.collections = [{ ...layanan, owner: undefined } as unknown as Collection];
  d.nodes.splice(
    1,
    1,
    node('cari', 'data_table', { collection: 'layanan', operation: 'search', query: '{{input.message}}' }),
  );
  d.nodes[2].value = '{{nodes.cari.count}}';
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'cari' },
    { id: 'e2', source: 'cari', port: 'next', target: 'output' },
  ];
  const parsed = parseDefinition(d);
  assert.equal(parsed.collections[0].owner, 'shared');
  assert.deepEqual(ports(parsed.nodes.find(n => n.id === 'cari')!), ['found', 'empty']);
  assert.deepEqual(
    parsed.edges.filter(e => e.source === 'cari').map(e => [e.port, e.target]),
    [
      ['found', 'output'],
      ['empty', 'output'],
    ],
  );
  assert.deepEqual(validateGraph(parsed), []);

  const c = blankDefinition();
  c.nodes[1] = { ...c.nodes[1], type: 'condition', field: 'input.message', operator: 'contains', compare: 'ya' };
  const condition = parseDefinition(c).nodes[1];
  assert.deepEqual(condition.rules, [{ field: 'input.message', operator: 'contains', compare: 'ya' }]);

  const shared = {
    ...booking,
    owner: 'shared' as const,
    fields: [{ ...text('x'), type: 'relation' as const, collection: 'b' }],
  };
  assert.throws(
    () => parseDefinition({ ...blankDefinition(), collections: [shared, { ...booking, id: 'b', fields: [] }] }),
    /tidak boleh berelasi/,
  );

  const vars = blankDefinition();
  vars.nodes[2].value = '{{customer.name}} {{service.name}} {{system.today}}';
  assert.deepEqual(validateGraph(parseDefinition(vars)), []);
  vars.nodes[2].value = '{{system.password}}';
  assert.match(validateGraph(parseDefinition(vars))[0].message, /tidak dikenal/);
});

test('Customer-owned collections isolate records per WhatsApp customer; owner sees and filters all', async () => {
  const d = blankDefinition();
  d.collections = [layanan, booking];
  const { profile } = await published(d);
  const gigi = await store.writeRecord(client, profile.id, 'layanan', 'create', { data: { nama: 'Gigi' } });
  const a = { customer: '62811' },
    b = { customer: '62822' };
  const mine = await store.writeRecord(
    client,
    profile.id,
    'booking',
    'create',
    { data: { layanan: gigi.id, tanggal: '2026-09-27', status: 'menunggu' } },
    undefined,
    undefined,
    a,
  );
  assert.equal(mine.customer, '62811');
  assert.equal((await store.queryRecords(client, profile.id, 'booking', {}, a)).records.length, 1);
  assert.equal((await store.queryRecords(client, profile.id, 'booking', {}, b)).records.length, 0);
  assert.equal(await store.getRecord(client, profile.id, 'booking', mine.id, b), null);
  for (const operation of ['update', 'delete'] as const)
    await assert.rejects(
      store.writeRecord(
        client,
        profile.id,
        'booking',
        operation,
        { id: mine.id, data: { status: 'batal' } },
        undefined,
        undefined,
        b,
        { merge: true },
      ),
      { code: 'record_not_found' },
    );
  // Ubah dari node Data menggabungkan field dan membaca revisi terbaru sendiri.
  const merged = await store.writeRecord(
    client,
    profile.id,
    'booking',
    'update',
    { id: mine.id, data: { status: 'batal' } },
    undefined,
    undefined,
    a,
    { merge: true },
  );
  assert.deepEqual(merged.data, { layanan: gigi.id, tanggal: '2026-09-27', status: 'batal' });
  // Dashboard: melihat semua, bisa memfilter nomor, dan wajib menyebut nomor saat membuat record.
  await assert.rejects(
    store.writeRecord(client, profile.id, 'booking', 'create', { data: { tanggal: '2026-09-28' } }),
    { code: 'invalid_customer' },
  );
  await store.writeRecord(client, profile.id, 'booking', 'create', {
    data: { tanggal: '2026-09-28' },
    customer: '62822',
  });
  assert.equal((await store.readRecords(client, profile.id, 'booking')).records.length, 2);
  const filtered = (await store.readRecords(client, profile.id, 'booking', '', 0, '62822')).records;
  assert.deepEqual(
    filtered.map(r => r.customer),
    ['62822'],
  );
  assert.equal((await store.readRecords(client, profile.id, 'layanan')).records[0].customer, undefined);
});

test('Filters, keywords, sorting, and limits give identical results in MySQL and simulation', async () => {
  const item: Collection = {
    id: 'item',
    name: 'Item',
    owner: 'shared',
    fields: [
      text('nama', true),
      { ...text('harga'), type: 'number' },
      { ...text('aktif'), type: 'boolean' },
      { ...text('tanggal'), type: 'date' },
      { ...text('kategori'), type: 'choice', options: ['A', 'B'] },
    ],
  };
  const d = blankDefinition();
  d.collections = [item];
  const { profile } = await published(d);
  const rows = [
    { nama: 'Paket Basic', harga: 50000, aktif: true, tanggal: '2026-09-26', kategori: 'A' },
    { nama: 'Paket Pro', harga: 150000, aktif: true, tanggal: '2026-09-27', kategori: 'B' },
    { nama: 'Premium Plus', harga: 250000, aktif: false, tanggal: '2026-10-01' },
    { nama: 'basic mini', harga: 10000, aktif: false, kategori: 'A' },
    { nama: 'Konsultasi', kategori: 'B' },
    { nama: 'Paket Premium 100%_x', harga: 300000, aktif: true, tanggal: '2026-09-30', kategori: 'B' },
  ];
  for (const data of rows) await store.writeRecord(client, profile.id, 'item', 'create', { data });
  const all = (await store.readRecords(client, profile.id, 'item')).records;
  const group = (filters: unknown[], match: 'all' | 'any' = 'all') => filterGroup(item, filters, match);
  const cases: {
    name: string;
    groups?: RecordQuery['groups'];
    keyword?: string;
    sort?: [string, string];
    limit?: number;
  }[] = [
    {
      name: 'equals text ignores case',
      groups: [group([{ field: 'nama', operator: 'equals', value: 'paket basic' }])],
    },
    { name: 'contains', groups: [group([{ field: 'nama', operator: 'contains', value: 'PAKET' }])] },
    { name: 'contains escapes wildcards', groups: [group([{ field: 'nama', operator: 'contains', value: '%_' }])] },
    { name: 'not equals skips empty', groups: [group([{ field: 'kategori', operator: 'not_equals', value: 'A' }])] },
    { name: 'number greater', groups: [group([{ field: 'harga', operator: 'greater', value: '100000' }])] },
    { name: 'number less equal', groups: [group([{ field: 'harga', operator: 'less_equal', value: '50000' }])] },
    { name: 'number vs text', groups: [group([{ field: 'harga', operator: 'equals', value: 'murah' }])] },
    { name: 'boolean ya', groups: [group([{ field: 'aktif', operator: 'equals', value: 'ya' }])] },
    { name: 'boolean not', groups: [group([{ field: 'aktif', operator: 'not_equals', value: 'true' }])] },
    { name: 'date from', groups: [group([{ field: 'tanggal', operator: 'greater_equal', value: '2026-09-27' }])] },
    { name: 'empty', groups: [group([{ field: 'kategori', operator: 'empty', value: '' }])] },
    { name: 'exists', groups: [group([{ field: 'harga', operator: 'exists', value: '' }])] },
    {
      name: 'any group',
      groups: [
        group(
          [
            { field: 'kategori', operator: 'equals', value: 'A' },
            { field: 'harga', operator: 'greater', value: '200000' },
          ],
          'any',
        ),
      ],
    },
    { name: 'keywords rank', keyword: 'paket premium', sort: ['harga', 'asc'] },
    { name: 'sort desc with missing last', sort: ['harga', 'desc'], limit: 4 },
    { name: 'sort text', sort: ['nama', 'asc'] },
    {
      name: 'keyword and filter',
      keyword: 'paket',
      groups: [group([{ field: 'aktif', operator: 'equals', value: 'true' }])],
      sort: ['tanggal', 'desc'],
    },
  ];
  for (const c of cases) {
    const sort = sortSpec(item, c.sort?.[0] ?? 'harga', c.sort?.[1] ?? 'asc');
    const search = { keyword: c.keyword ?? '', groups: c.groups ?? [], sort, limit: c.limit ?? 100 };
    const sqlIds = (await store.queryRecords(client, profile.id, 'item', search)).records.map(r => r.id);
    const memoryIds = queryMemory(all, {
      keywords: keywords(search.keyword),
      groups: search.groups,
      sort,
      limit: search.limit,
      offset: 0,
    })
      .slice(0, search.limit)
      .map(r => r.id);
    assert.deepEqual(sqlIds, memoryIds, c.name);
  }
  const premium = await store.queryRecords(client, profile.id, 'item', {
    keyword: 'paket premium',
    sort: sortSpec(item, 'harga', 'asc'),
  });
  assert.equal(premium.records[0].data.nama, 'Paket Premium 100%_x');
  const count = await store.countCollection(
    client,
    profile.id,
    'item',
    { groups: [group([{ field: 'aktif', operator: 'equals', value: 'true' }])] },
    'harga',
  );
  assert.deepEqual(count, { count: 3, total: 500000 });
});

test('Data node in a flow: Search routes found/empty, Create and Count stay per customer, Update merges', async () => {
  const d = blankDefinition();
  d.collections = [layanan, booking];
  d.nodes = [
    node('input', 'input'),
    node('cari', 'data_table', {
      collection: 'layanan',
      operation: 'search',
      query: '',
      filters: [{ field: 'nama', operator: 'equals', value: '{{input.message}}' }],
    }),
    node('buat', 'data_table', {
      collection: 'booking',
      operation: 'create',
      value: '{"data":{"layanan":"{{nodes.cari.first.id}}","tanggal":"{{system.tomorrow}}","status":"menunggu"}}',
    }),
    node('hitung', 'data_table', { collection: 'booking', operation: 'count', query: '' }),
    node('mine', 'data_table', { collection: 'booking', operation: 'search', query: '', limit: 1 }),
    node('ubah', 'data_table', {
      collection: 'booking',
      operation: 'update',
      value: '{"id":"{{nodes.mine.first.id}}","data":{"status":"batal"}}',
    }),
    node('output', 'output', {
      value: '{{nodes.hitung.count}}|{{nodes.ubah.data.status}}|{{nodes.ubah.data.tanggal}}',
    }),
    node('kosong', 'output', { value: 'Layanan tidak ada' }),
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'cari' },
    { id: 'e2', source: 'cari', port: 'found', target: 'buat' },
    { id: 'e3', source: 'cari', port: 'empty', target: 'kosong' },
    { id: 'e4', source: 'buat', port: 'next', target: 'hitung' },
    { id: 'e5', source: 'hitung', port: 'next', target: 'mine' },
    { id: 'e6', source: 'mine', port: 'found', target: 'ubah' },
    { id: 'e7', source: 'mine', port: 'empty', target: 'kosong' },
    { id: 'e8', source: 'ubah', port: 'next', target: 'output' },
  ];
  assert.deepEqual(validateGraph(parseDefinition(d)), []);
  const { profile, active } = await published(d);
  await store.writeRecord(client, profile.id, 'layanan', 'create', { data: { nama: 'Gigi', harga: 150000 } });
  const tomorrow = systemVariables().tomorrow;
  assert.equal((await run(active, profile.id, '62811', 'Mata')).answer, 'Layanan tidak ada');
  assert.equal((await run(active, profile.id, '62811', 'gigi')).answer, `1|batal|${tomorrow}`);
  assert.equal((await run(active, profile.id, '62811', 'Gigi')).answer, `2|batal|${tomorrow}`);
  assert.equal((await run(active, profile.id, '62899', 'Gigi')).answer, `1|batal|${tomorrow}`);

  // Ambil dan Hapus memakai ID dari variabel; Hapus pelanggan lain ditolak oleh batas kepemilikan.
  const [target] = (await store.queryRecords(client, profile.id, 'booking', {}, { customer: '62899' })).records;
  const g = parseDefinition(d);
  g.nodes = [
    node('input', 'input'),
    node('ambil', 'data_table', { collection: 'booking', operation: 'get', query: '{{input.message}}' }),
    node('hapus', 'data_table', { collection: 'booking', operation: 'delete', query: '{{nodes.ambil.first.id}}' }),
    node('output', 'output', { value: 'terhapus {{nodes.hapus.deleted}}' }),
    node('kosong', 'output', { value: 'tidak ditemukan' }),
  ];
  g.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'ambil' },
    { id: 'e2', source: 'ambil', port: 'found', target: 'hapus' },
    { id: 'e3', source: 'ambil', port: 'empty', target: 'kosong' },
    { id: 'e4', source: 'hapus', port: 'next', target: 'output' },
  ];
  g.collections = active.collections;
  assert.equal((await run(g, profile.id, '62811', target.id)).answer, 'tidak ditemukan');
  assert.equal((await run(g, profile.id, '62899', target.id)).answer, 'terhapus true');
});

test('Condition rules: operators, groups, missing values, and WIB system variables', () => {
  const wib = systemVariables(new Date('2026-09-26T17:30:00Z'));
  assert.deepEqual(wib, {
    today: '2026-09-27',
    tomorrow: '2026-09-28',
    now: '2026-09-27 00:30',
    time: '00:30',
    weekday: 'Minggu',
  });
  const yes: [unknown, Parameters<typeof ruleMatches>[1], string][] = [
    ['Gigi', 'equals', ' gigi '],
    ['Gigi', 'not_equals', 'Umum'],
    ['Mau periksa GIGI', 'contains', 'gigi'],
    ['Halo', 'not_contains', 'batal'],
    [10, 'greater', '9'],
    ['3', 'less', '4'],
    ['2026-09-26', 'date_before', '2026-09-27'],
    ['2026-09-27T10:00', 'date_on_or_after', '2026-09-27'],
    ['2026-09-27', 'weekday_is', 'Sabtu, minggu'],
    ['Senin', 'weekday_is', 'senin'],
    ['10.30', 'time_between', '08.00-16.00'],
    ['23:15', 'time_between', '22.00 – 06.00'],
    ['b', 'one_of', 'A, B'],
    [[1, 2], 'count_greater', '1'],
    [undefined, 'empty', ''],
    [[], 'empty', ''],
    ['x', 'exists', ''],
  ];
  for (const [value, operator, compare] of yes) assert.equal(ruleMatches(value, operator, compare), true, operator);
  for (const [value, operator, compare] of [
    [undefined, 'not_equals', 'x'],
    [undefined, 'not_contains', 'x'],
    ['abc', 'greater', '1'],
    ['2026-13', 'date_before', '2027-01-01'],
    ['16.01', 'time_between', '08.00-16.00'],
    ['kemarin', 'date_on_or_after', '2026-01-01'],
  ] as const)
    assert.equal(ruleMatches(value, operator, compare), false, operator + ' ' + String(value));
  const values: Record<string, unknown> = { 'nodes.isian.tanggal': '2026-09-28', 'nodes.isian.layanan': 'Mata' };
  const n = {
    ...node('cek', 'condition'),
    match: 'all' as const,
    rules: [
      { field: 'nodes.isian.tanggal', operator: 'date_on_or_after' as const, compare: '{{system.today}}' },
      {
        match: 'any' as const,
        rules: [
          { field: 'nodes.isian.layanan', operator: 'equals' as const, compare: 'Gigi' },
          { field: 'nodes.isian.layanan', operator: 'equals' as const, compare: 'Mata' },
        ],
      },
    ],
  };
  const check = () =>
    conditionMatches(
      n,
      f => values[f],
      c => c.replace('{{system.today}}', '2026-09-27'),
    );
  assert.equal(check(), true);
  values['nodes.isian.layanan'] = 'Kulit';
  assert.equal(check(), false);
});

test('Simulation keeps customer-owned samples private and Data node writes stay in sandbox records', async () => {
  const d = blankDefinition();
  d.collections = [layanan, booking];
  d.nodes = [
    node('input', 'input'),
    node('cari', 'data_table', { collection: 'booking', operation: 'search', query: '' }),
    node('ada', 'output', { value: 'ada {{nodes.cari.count}}' }),
    node('buat', 'data_table', {
      collection: 'booking',
      operation: 'create',
      value: '{"data":{"tanggal":"{{system.today}}","status":"menunggu"}}',
    }),
    node('dibuat', 'output', { value: 'dibuat' }),
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'cari' },
    { id: 'e2', source: 'cari', port: 'found', target: 'ada' },
    { id: 'e3', source: 'cari', port: 'empty', target: 'buat' },
    { id: 'e4', source: 'buat', port: 'next', target: 'dibuat' },
  ];
  let output: any;
  const emit = (e: any) => {
    if (e.state === 'completed') output = e.output;
  };
  await simulate(
    owner,
    {
      definition: d,
      message: 'halo',
      records: { booking: [{ tanggal: '2026-09-27', status: 'menunggu', customer: '62899' }] },
    },
    emit,
    new AbortController().signal,
    noModel,
  );
  assert.equal(output.answer, 'dibuat');
  assert.equal(output.records.booking.length, 2);
  assert.equal(output.records.booking[1].customer, '628000000001');
  await simulate(
    owner,
    { definition: d, message: 'lagi', records: output.records },
    emit,
    new AbortController().signal,
    noModel,
  );
  assert.equal(output.answer, 'ada 1');
});

test('Duplicating a data profile copies customer records only when the client chooses to', async () => {
  const d = blankDefinition();
  d.collections = [layanan, booking];
  const { profile } = await published(d);
  const gigi = await store.writeRecord(client, profile.id, 'layanan', 'create', { data: { nama: 'Gigi' } });
  await store.writeRecord(client, profile.id, 'booking', 'create', {
    data: { layanan: gigi.id, tanggal: '2026-09-27' },
    customer: '62811',
  });
  const plain = await service.createDataProfile(client, { name: 'Tanpa pelanggan', copy_from: profile.id });
  assert.equal((await store.readRecords(client, plain.id, 'layanan')).records.length, 1);
  assert.equal((await store.readRecords(client, plain.id, 'booking')).records.length, 0);
  const full = await service.createDataProfile(client, {
    name: 'Dengan pelanggan',
    copy_from: profile.id,
    copy_customer_records: true,
  });
  const [copied] = (await store.readRecords(client, full.id, 'booking')).records;
  const [copiedLayanan] = (await store.readRecords(client, full.id, 'layanan')).records;
  assert.equal(copied.customer, '62811');
  assert.equal(copied.data.layanan, copiedLayanan.id);
  await assert.rejects(
    service.createDataProfile(client, { name: 'Salah', copy_from: profile.id, copy_customer_records: 'ya' }),
    /tidak valid/,
  );
});

test('Publishing cannot flip ownership of a collection that still holds records', async () => {
  const d = blankDefinition();
  d.collections = [layanan, booking];
  const { g, profile } = await published(d);
  await store.writeRecord(client, profile.id, 'layanan', 'create', { data: { nama: 'Gigi' } });
  await store.writeRecord(client, profile.id, 'booking', 'create', { data: {}, customer: '62811' });
  for (const [collection, ownerValue] of [
    ['booking', 'shared'],
    ['layanan', 'customer'],
  ] as const) {
    const state = await store.graphState(g.id);
    const next = structuredClone(state.active!);
    next.collections.find(c => c.id === collection)!.owner = ownerValue;
    if (collection === 'layanan') next.collections.find(c => c.id === 'booking')!.fields.splice(0, 1);
    const saved = await store.saveGraph(owner, g.id, { revision: state.revision, definition: next });
    await assert.rejects(store.saveGraph(owner, g.id, { revision: saved.revision }, true), { code: 'schema_conflict' });
  }
});
