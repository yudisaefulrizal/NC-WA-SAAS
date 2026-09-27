// Jenis koleksi dan node data: Data tabel (nama lama `tool`), Data teks (paragraf relevan dari satu teks), Data isian
// (baca/ubah satu formulir), variabel {{data.<koleksi>}}, satu record per koleksi teks/isian, dan simulasi.
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
  type Collection,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { textExcerpt } from '../../../src/components/ai/domain/builder/record-tools.js';
import { saveCollectionSource } from '../../../src/components/ai/domain/builder/collection-sources.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';

const owner = randomUUID(),
  client = randomUUID();
const ids: string[] = [];
const service = new AIService(
  async () => '{"answer":"Selesai"}',
  async () => {},
);
const field = (id: string, type: 'text' | 'number' = 'text') => ({
  id,
  label: id,
  type,
  required: false,
  options: [],
  collection: '',
});
const menu: Collection = { id: 'menu', name: 'Menu', owner: 'shared', fields: [field('nama')] };
const sop: Collection = { id: 'sop', name: 'SOP', owner: 'shared', kind: 'text', fields: [] };
const info: Collection = {
  id: 'info',
  name: 'Info usaha',
  owner: 'shared',
  kind: 'form',
  fields: [field('alamat'), field('ongkir', 'number')],
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
// Input → Baca_sop (Data teks, kata kunci pesan) → Ubah_info (Data isian) → Agent (memakai {{data.*}}) → Output.
function graph(): GraphDefinition {
  const d = blankDefinition('Jenis data');
  d.collections = [menu, sop, info];
  const agent = {
    ...d.nodes[1],
    prompt:
      'Alamat {{data.info.alamat}}, ongkir {{data.info.ongkir}}. SOP: {{data.sop}} Kutipan: {{nodes.baca_sop.text}}',
  };
  d.nodes = [
    d.nodes[0],
    node('baca_sop', 'data_text', { collection: 'sop', query: '{{input.message}}', max_chars: 500 }),
    node('ubah_info', 'data_form', { collection: 'info', operation: 'update', value: '{"data":{"ongkir":15000}}' }),
    agent,
    d.nodes[2],
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'baca_sop' },
    { id: 'e2', source: 'baca_sop', port: 'next', target: 'ubah_info' },
    { id: 'e3', source: 'ubah_info', port: 'next', target: 'agent' },
    { id: 'e4', source: 'agent', port: 'next', target: 'output' },
  ];
  return d;
}

test('Contract: tool is read as data_table; kinds, node pairing, and data variables are validated', () => {
  const legacy = blankDefinition();
  legacy.collections = [menu];
  legacy.nodes.push({ ...node('cari', 'data_table', { collection: 'menu' }), type: 'tool' } as unknown as GraphNode);
  assert.equal(parseDefinition(legacy).nodes.find(n => n.id === 'cari')!.type, 'data_table');
  assert.deepEqual(validateGraph(parseDefinition(graph())), []);
  // Koleksi teks tanpa field dan selalu umum; relasi hanya ke tabel.
  assert.throws(
    () => parseDefinition({ ...graph(), collections: [{ ...sop, fields: [field('x')] }] }),
    /tidak memakai field/,
  );
  assert.throws(() => parseDefinition({ ...graph(), collections: [{ ...info, owner: 'customer' }] }), /selalu umum/);
  assert.throws(
    () =>
      parseDefinition({
        ...graph(),
        collections: [sop, { ...menu, fields: [{ ...field('s'), type: 'relation', collection: 'sop' }] }],
      }),
    /Relasi hanya ke koleksi tabel/,
  );
  const wrong = graph();
  wrong.nodes[1].collection = 'menu';
  wrong.nodes[2].operation = 'search';
  wrong.nodes[3].prompt = '{{data.menu}} {{data.info.tidak_ada}}';
  const messages = validateGraph(parseDefinition(wrong)).map(i => i.message);
  assert.ok(messages.includes('Data teks hanya bisa memakai koleksi teks.'));
  assert.ok(messages.includes('Data isian hanya bisa Baca atau Ubah.'));
  assert.ok(messages.includes('Variabel data.menu harus merujuk koleksi teks atau isian.'));
  assert.ok(messages.includes('Variabel data.info.tidak_ada tidak dikenal.'));
});

test('Text excerpts keep only matching paragraphs, or the beginning when nothing matches', () => {
  const text = 'Jam buka 08.00–21.00.\n\nPembayaran lewat transfer atau QRIS.\n\nKeluhan: minta foto produk.';
  assert.deepEqual(textExcerpt(text, 'bayar qris dong', 4000), {
    text: 'Pembayaran lewat transfer atau QRIS.',
    found: true,
  });
  assert.deepEqual(textExcerpt(text, '', 12), { text: 'Jam buka 08.', found: true });
  assert.equal(textExcerpt(text, 'parkir', 4000).found, false);
  assert.equal(textExcerpt('', '', 4000).found, false);
});

test('Runtime reads the text and form, updates the form, and fills data variables; one record per kind', async () => {
  const g = await store.createGraph(owner, graph());
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const profile = (await service.createDataProfile(client, { profile_type: g.id, name: 'Kopi' })).id;
  await store.writeRecord(client, profile, 'sop', 'create', {
    data: { text: 'Jam buka 08.00.\n\nPembayaran lewat QRIS.' },
  });
  await store.writeRecord(client, profile, 'info', 'create', { data: { alamat: 'Jl. Dago 12', ongkir: 10000 } });
  await assert.rejects(store.writeRecord(client, profile, 'sop', 'create', { data: { text: 'Lagi' } }), /satu isian/);
  await assert.rejects(
    store.writeRecord(client, profile, 'sop', 'create', { data: { text: 'x'.repeat(20001) } }),
    /Teks maksimal/,
  );
  await assert.rejects(
    saveCollectionSource(client, profile, 'sop', { mode: 'endpoint', endpoint: 'https://8.8.8.8/x' }),
    /Hanya koleksi tabel/,
  );
  let prompt = '';
  const transport: AITransport = async (_c, messages) => {
    prompt = String(messages[0].content);
    return '{"answer":"Siap"}';
  };
  const d = (await store.findGraph(g.id))!.active!;
  const result = await runGraph(d, transport, { ...defaults }, [{ role: 'user', content: 'bayar pakai qris?' }], {
    account: client,
    profile,
    session: 'test',
    customer: '628001',
    requestId: randomUUID(),
    fallbackEnabled: false,
  });
  assert.equal(result.answer, 'Siap');
  // Variabel data dimuat sebelum node berjalan, jadi ongkir di prompt masih nilai lama; node isian mengubahnya.
  assert.match(prompt, /Alamat Jl\. Dago 12, ongkir 10000\./);
  assert.match(prompt, /SOP: Jam buka 08\.00\.\n\nPembayaran lewat QRIS\./);
  assert.match(prompt, /Kutipan: Pembayaran lewat QRIS\.$/m);
  const saved = await store.readRecords(client, profile, 'info', '', 0);
  assert.deepEqual(
    saved.records.map(r => r.data),
    [{ alamat: 'Jl. Dago 12', ongkir: 15000 }],
  );
});

test('Simulation accepts a string for text and an object for form samples', async () => {
  let output: any;
  let prompt = '';
  await simulate(
    owner,
    {
      definition: graph(),
      message: 'jam buka',
      records: { sop: 'Jam buka 08.00.', info: { alamat: 'Jl. Contoh', ongkir: 5000 } },
    },
    e => {
      if (e.state === 'completed') output = e.output;
    },
    new AbortController().signal,
    async (_c, messages) => {
      prompt = String(messages[0].content);
      return '{"answer":"Ok"}';
    },
  );
  assert.equal(output.answer, 'Ok');
  assert.match(prompt, /Alamat Jl\. Contoh, ongkir 5000\. SOP: Jam buka 08\.00\. Kutipan: Jam buka 08\.00\./);
  assert.equal(output.records.info[0].data.ongkir, 15000);
});
