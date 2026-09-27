// Sumber data koleksi: klien memilih tabel aplikasi atau API sendiri per koleksi. Node Data meneruskan semua operasi
// ke API dengan kontrak {action, collection, query, context}; balasan diperiksa terhadap struktur koleksi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  type Collection,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import {
  listCollectionSources,
  saveCollectionSource,
  testCollectionSource,
  useCollectionTransport,
} from '../../../src/components/ai/domain/builder/collection-sources.js';
import type { EndpointTransport } from '../../../src/components/ai/domain/endpoint.js';
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
const order: Collection = {
  id: 'pesanan',
  name: 'Pesanan',
  owner: 'customer',
  fields: [
    { id: 'produk', label: 'Produk', type: 'text', required: true, options: [], collection: '' },
    { id: 'jumlah', label: 'Jumlah', type: 'number', required: false, options: [], collection: '', default: 1 },
    { id: 'status', label: 'Status', type: 'choice', required: false, options: ['baru', 'batal'], collection: '' },
  ],
};
const calls: { payload: any; key: string; source: any }[] = [];
let reply: (payload: any) => unknown = () => ({ records: [] });
const fake: EndpointTransport = async (source, payload, key) => {
  calls.push({ payload, key, source });
  return reply(payload);
};
let restore: EndpointTransport;
before(async () => {
  restore = useCollectionTransport(fake);
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
  useCollectionTransport(restore);
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
async function published() {
  const d = blankDefinition();
  d.collections = [order];
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const profile = await service.createDataProfile(client, { profile_type: g.id, name: 'Data ' + g.id });
  return { profile, active: (await store.findGraph(g.id))!.active! };
}
function flow(active: GraphDefinition, steps: GraphNode[], output: string) {
  const d = structuredClone(active);
  d.nodes = [node('input', 'input'), ...steps, node('output', 'output', { value: output })];
  const chain = ['input', ...steps.map(s => s.id), 'output'];
  d.edges = chain.slice(1).flatMap((target, i) => {
    const source = d.nodes.find(n => n.id === chain[i])!;
    const lookup = source.type === 'tool' && ['search', 'get'].includes(source.operation);
    return lookup
      ? [
          { id: 'f' + i, source: chain[i], port: 'found', target },
          { id: 'x' + i, source: chain[i], port: 'empty', target },
        ]
      : [{ id: 'e' + i, source: chain[i], port: 'next', target }];
  });
  return d;
}
const run = (d: GraphDefinition, profile: string, customer = '62811') =>
  runGraph(d, noModel, { ...defaults }, [{ role: 'user', content: 'halo' }], {
    account: client,
    profile,
    session: 'wa-1',
    customer,
    requestId: randomUUID(),
    fallbackEnabled: false,
  });

test('Clients switch a collection between the app table and their own API; tokens stay private', async () => {
  const { profile } = await published();
  assert.deepEqual(await listCollectionSources(client, profile.id), [
    { collection: 'pesanan', mode: 'builtin', endpoint: '', has_token: false },
  ]);
  for (const endpoint of ['http://8.8.8.8/x', 'https://127.0.0.1/x', 'https://8.8.8.8/x?token=1'])
    await assert.rejects(saveCollectionSource(client, profile.id, 'pesanan', { mode: 'endpoint', endpoint }));
  const saved = await saveCollectionSource(client, profile.id, 'pesanan', {
    mode: 'endpoint',
    endpoint: 'https://8.8.8.8/orders',
    token: 'rahasia',
  });
  assert.deepEqual(saved, {
    collection: 'pesanan',
    mode: 'endpoint',
    endpoint: 'https://8.8.8.8/orders',
    has_token: true,
  });
  const [row] = (
    await db.execute<any[]>('SELECT secret FROM ai_collection_sources WHERE data_profile_id=?', [profile.id])
  )[0];
  assert.equal(String(row.secret).includes('rahasia'), false);
  await assert.rejects(
    store.writeRecord(client, profile.id, 'pesanan', 'create', { data: { produk: 'x' }, customer: '62811' }),
    { code: 'collection_uses_api' },
  );
  // Salinan data profil ikut memakai API yang sama.
  const copy = await service.createDataProfile(client, { name: 'Salinan API', copy_from: profile.id });
  assert.equal((await listCollectionSources(client, copy.id))[0].mode, 'endpoint');
  // Ganti URL tanpa token baru: token lama tidak ikut ke alamat lain.
  const moved = await saveCollectionSource(client, profile.id, 'pesanan', {
    mode: 'endpoint',
    endpoint: 'https://8.8.8.8/other',
  });
  assert.equal(moved.has_token, false);
  assert.equal((await saveCollectionSource(client, profile.id, 'pesanan', { mode: 'builtin' })).mode, 'builtin');
  await store.writeRecord(client, profile.id, 'pesanan', 'create', { data: { produk: 'x' }, customer: '62811' });
});

test('Every Data node operation reaches the client API with collection, query, and context', async () => {
  const { profile, active } = await published();
  await saveCollectionSource(client, profile.id, 'pesanan', {
    mode: 'endpoint',
    endpoint: 'https://8.8.8.8/orders',
    token: 't',
  });
  calls.length = 0;
  reply = p =>
    p.action === 'search'
      ? {
          records: [
            { id: 'A-1', data: { produk: 'Kopi', jumlah: 2, catatan: 'dibuang' }, customer: '62811' },
            { id: 'B-9', data: { produk: 'Teh' }, customer: '62899' },
          ],
        }
      : p.action === 'count'
        ? { count: 3, total: 7 }
        : p.action === 'get'
          ? { records: [{ id: p.query.id, data: { produk: 'Kopi', status: 'baru' } }] }
          : p.action === 'delete'
            ? { ok: true }
            : { id: p.query.id ?? 'A-2', data: { produk: 'Kopi', ...p.query.data } };
  const d = flow(
    active,
    [
      node('cari', 'tool', {
        collection: 'pesanan',
        operation: 'search',
        query: 'kopi',
        filters: [{ field: 'status', operator: 'equals', value: 'BARU' }],
        sort_field: 'jumlah',
        sort_direction: 'desc',
        limit: 5,
      }),
      node('hitung', 'tool', { collection: 'pesanan', operation: 'count', query: '', sum_field: 'jumlah' }),
      node('buat', 'tool', { collection: 'pesanan', operation: 'create', value: '{"data":{"produk":"Kopi"}}' }),
      node('ubah', 'tool', {
        collection: 'pesanan',
        operation: 'update',
        value: '{"id":"{{nodes.cari.first.id}}","data":{"status":"batal"}}',
      }),
      node('ambil', 'tool', { collection: 'pesanan', operation: 'get', query: '{{nodes.buat.id}}' }),
      node('hapus', 'tool', { collection: 'pesanan', operation: 'delete', query: '{{nodes.ambil.first.id}}' }),
    ],
    '{{nodes.cari.count}}|{{nodes.cari.first.data.produk}}|{{nodes.hitung.total}}|{{nodes.buat.data.jumlah}}|{{nodes.ubah.data.status}}|{{nodes.hapus.deleted}}',
  );
  const result = await run(d, profile.id);
  // Record milik pelanggan lain dan field yang tidak dikenal tidak pernah sampai ke alur.
  assert.equal(result.answer, '1|Kopi|7|1|batal|true');
  assert.deepEqual(
    calls.map(c => c.payload.action),
    ['search', 'count', 'create', 'update', 'get', 'delete'],
  );
  const [search, , create, update] = calls.map(c => c.payload);
  assert.deepEqual(search.query, {
    keyword: 'kopi',
    filters: [{ match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'baru' }] }],
    sort: { field: 'jumlah', direction: 'desc' },
    limit: 5,
  });
  assert.equal(search.collection.milik_pelanggan, true);
  assert.equal(search.collection.fields.length, 3);
  assert.deepEqual(search.context, {
    account_id: client,
    data_profile_id: profile.id,
    session_id: 'wa-1',
    customer: '62811',
    request_id: search.context.request_id,
  });
  assert.deepEqual(create.query, { data: { produk: 'Kopi', jumlah: 1 } });
  assert.deepEqual(update.query, { id: 'A-1', data: { status: 'batal' } });
  assert.equal(calls[0].source.endpoint, 'https://8.8.8.8/orders');
  assert.ok(calls.every(c => /^[0-9a-f]{64}$/.test(c.key)));
});

test('Invalid API responses and HTTP errors stop the flow with clear trace codes; dashboard test lists all records', async () => {
  const { profile, active } = await published();
  await saveCollectionSource(client, profile.id, 'pesanan', { mode: 'endpoint', endpoint: 'https://8.8.8.8/orders' });
  const d = flow(
    active,
    [node('cari', 'tool', { collection: 'pesanan', operation: 'search', query: '' })],
    '{{nodes.cari.count}}',
  );
  for (const [response, code] of [
    [{ records: [{ id: 'A', data: { jumlah: 'dua' } }] }, 'ai_endpoint_invalid_record'],
    [{ records: 'bukan daftar' }, 'ai_endpoint_invalid_record'],
    [{ records: [{ data: { produk: 'x' } }] }, 'ai_endpoint_invalid_record'],
  ] as const) {
    reply = () => response;
    await assert.rejects(run(d, profile.id), new RegExp(code));
  }
  reply = () => {
    throw Error('endpoint_http_500');
  };
  await assert.rejects(run(d, profile.id), /ai_endpoint_http_error/);
  reply = () => ({
    records: [
      { id: 'A', data: { produk: 'Kopi' }, customer: '62811' },
      { id: 'B', data: { produk: 'Teh' }, customer: '62899' },
    ],
  });
  const sample = await testCollectionSource(client, profile.id, 'pesanan');
  assert.equal(sample.records.length, 2);
  assert.equal(calls.at(-1)!.payload.context.customer, null);
});

test('Simulation never calls the client API', async () => {
  const { profile, active } = await published();
  await saveCollectionSource(client, profile.id, 'pesanan', { mode: 'endpoint', endpoint: 'https://8.8.8.8/orders' });
  const before = calls.length;
  const d = flow(
    active,
    [node('cari', 'tool', { collection: 'pesanan', operation: 'search', query: '' })],
    '{{nodes.cari.count}}',
  );
  let output: any;
  await simulate(
    owner,
    { definition: d, message: 'halo', records: { pesanan: [{ produk: 'Kopi' }] } },
    e => {
      if (e.state === 'completed') output = e.output;
    },
    new AbortController().signal,
    noModel,
  );
  assert.equal(output.answer, '1');
  assert.equal(calls.length, before);
});
