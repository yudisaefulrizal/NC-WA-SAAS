// Node Kirim media: kontrak, file harus milik data profil sesi, URL HTTPS dari koleksi API, nilai kosong, batas tiga
// file per balasan, dan simulasi yang hanya menampilkan daftar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../../../src/libraries/db.js';
import { storagePaths } from '../../../src/libraries/storage.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { uploadRecordFile } from '../../../src/components/ai/domain/builder/record-files.js';
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
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
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
    await rm(join(storagePaths().recordFiles, id), { recursive: true, force: true });
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
});
function graph(value: string, extra: Partial<GraphNode> = {}): GraphDefinition {
  const d = blankDefinition();
  const base = d.nodes[2];
  d.nodes = [
    d.nodes[0],
    { ...base, id: 'kirim', type: 'media', label: 'Kirim', value, ...extra },
    { ...base, id: 'output', value: 'ok {{nodes.kirim.count}}/{{nodes.kirim.skipped}}' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'kirim' },
    { id: 'e2', source: 'kirim', port: 'next', target: 'output' },
  ];
  return d;
}
const run = (d: GraphDefinition, profile: string, message = 'halo') =>
  runGraph(d, noModel, { ...defaults }, [{ role: 'user', content: message }], {
    account: client,
    profile,
    session: 'wa',
    customer: '62811',
    requestId: randomUUID(),
    knowledge: '',
    fallbackEnabled: false,
  });

test('Contract: Kirim media needs a file value and exposes files, count, skipped', () => {
  assert.deepEqual(validateGraph(parseDefinition(graph('{{input.message}}'))), []);
  assert.match(validateGraph(parseDefinition(graph(' ')))[0].message, /Isi file yang dikirim/);
  const parsed = parseDefinition(graph('x', { caption: 'Brosur', send_when: 'after', media_as: 'document' })).nodes[1];
  assert.deepEqual([parsed.caption, parsed.send_when, parsed.media_as], ['Brosur', 'after', 'document']);
  assert.throws(() => parseDefinition(graph('x', { send_when: 'nanti' as never })));
});

test('Media resolves own files and HTTPS URLs, ignores empty values, and caps at three per reply', async () => {
  const d = blankDefinition();
  d.collections = [];
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const mine = await service.createDataProfile(client, { profile_type: g.id, name: 'Media A' });
  const other = await service.createDataProfile(client, { profile_type: g.id, name: 'Media B' });
  const file = await uploadRecordFile(client, mine.id, 'brosur.png', png);
  const foreign = await uploadRecordFile(client, other.id, 'lain.png', png);

  const own = await run(graph('{{input.message}}', { caption: 'Brosur {{customer.phone}}' }), mine.id, file.id);
  assert.deepEqual(own.media, [
    { kind: 'file', ref: file.id, type: 'image', filename: 'brosur.png', caption: 'Brosur 62811', when: 'before' },
  ]);
  await assert.rejects(run(graph('{{input.message}}'), mine.id, foreign.id), /ai_media_not_found/);
  await assert.rejects(run(graph('{{input.message}}'), mine.id, 'brosur.png'), /ai_media_invalid/);

  const url = await run(
    graph('{{input.message}}', { send_when: 'after' }),
    mine.id,
    'https://cdn.toko.id/katalog/Menu%20Baru.pdf',
  );
  assert.deepEqual(url.media, [
    {
      kind: 'url',
      ref: 'https://cdn.toko.id/katalog/Menu%20Baru.pdf',
      type: 'document',
      filename: 'Menu Baru.pdf',
      caption: '',
      when: 'after',
    },
  ]);
  const empty = await run(graph('{{input.message}}'), mine.id, ' ');
  assert.equal(empty.media, undefined);
  assert.equal(empty.answer, 'ok 0/0');
});

test('Three-file cap applies across nodes and simulation only lists media', async () => {
  const d = graph('{{input.message}}');
  const base = d.nodes[1];
  d.nodes = [
    d.nodes[0],
    ...['a', 'b', 'c', 'd'].map(id => ({
      ...base,
      id,
      send_when: id === 'b' ? ('after' as const) : ('before' as const),
    })),
    {
      ...d.nodes[2],
      value: '{{nodes.a.count}}{{nodes.b.count}}{{nodes.c.count}}{{nodes.d.count}}/{{nodes.d.skipped}}',
    },
  ];
  d.edges = ['input', 'a', 'b', 'c', 'd'].map((source, i) => ({
    id: 'e' + i,
    source,
    port: 'next',
    target: ['a', 'b', 'c', 'd', 'output'][i],
  }));
  let output: any;
  await simulate(
    owner,
    { definition: d, message: 'katalog.pdf' },
    e => {
      if (e.state === 'completed') output = e.output;
    },
    new AbortController().signal,
    noModel,
  );
  assert.equal(output.answer, '1110/1');
  assert.deepEqual(
    output.media.map((m: any) => [m.kind, m.filename, m.type, m.when]),
    [
      ['preview', 'katalog.pdf', 'document', 'before'],
      ['preview', 'katalog.pdf', 'document', 'after'],
      ['preview', 'katalog.pdf', 'document', 'before'],
    ],
  );
});
