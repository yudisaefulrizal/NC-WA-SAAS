// Node Buat file (JSON, Markdown): kontrak, isi dari template dan variabel (tanda kutip jawaban AI tidak merusak JSON),
// nama file, file tersimpan di data profil dan bisa dikirim lewat Kirim media, serta simulasi tanpa file sungguhan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../../../src/libraries/db.js';
import { storagePaths } from '../../../src/libraries/storage.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  outputFields,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { previewMedia } from '../../../src/components/ai/domain/builder/media.js';
import { buildFile, generatedName, previewFiles } from '../../../src/components/ai/domain/builder/generated-files.js';
import { recordFilePath } from '../../../src/components/ai/domain/builder/record-files.js';
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
// Input → Buat file → Kirim media → Output.
function graph(type: 'file_json' | 'file_md', value: string, extra: Partial<GraphNode> = {}): GraphDefinition {
  const d = blankDefinition();
  const base = d.nodes[2];
  d.nodes = [
    d.nodes[0],
    { ...base, id: 'berkas', type, label: 'Berkas', value, ...extra },
    { ...base, id: 'kirim', type: 'media', label: 'Kirim', value: '{{nodes.berkas.file}}' },
    { ...base, id: 'output', label: 'output', value: '{{nodes.berkas.filename}} {{nodes.berkas.size}}' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'berkas' },
    { id: 'e2', source: 'berkas', port: 'next', target: 'kirim' },
    { id: 'e3', source: 'kirim', port: 'next', target: 'output' },
  ];
  return d;
}

test('Contract: file nodes need a template, JSON must parse, and expose file, filename, size', () => {
  assert.deepEqual(validateGraph(parseDefinition(graph('file_md', '# {{input.message}}'))), []);
  assert.deepEqual(validateGraph(parseDefinition(graph('file_json', '{"pesan":"{{input.message}}"}'))), []);
  assert.match(validateGraph(parseDefinition(graph('file_md', ' ')))[0].message, /Isi template file wajib/);
  assert.match(
    validateGraph(parseDefinition(graph('file_json', '{pesan: 1}')))[0].message,
    /Template JSON tidak valid/,
  );
  const parsed = parseDefinition(graph('file_md', 'x', { filename: 'artikel-{{input.message}}' })).nodes[1];
  assert.equal(parsed.filename, 'artikel-{{input.message}}');
  assert.deepEqual(outputFields(parsed), ['file', 'filename', 'size']);
});

test('Content comes from variables; AI quotes stay valid JSON and names are safe with the right extension', () => {
  const state = { answer: 'Kata "promo" 50%', list: [{ nama: 'Kopi' }], judul: 'Menu Baru' };
  const fill = (v: unknown): unknown =>
    typeof v === 'string'
      ? v === '{{list}}'
        ? state.list
        : v.replace('{{answer}}', state.answer).replace('{{judul}}', state.judul)
      : Array.isArray(v)
        ? v.map(fill)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
          : v;
  const json = buildFile(
    { ...graph('file_json', '{"isi":"{{answer}}","produk":"{{list}}"}').nodes[1], filename: '{{judul}}' } as never,
    fill,
    'Berkas',
  );
  assert.deepEqual(JSON.parse(json.content.toString()), { isi: 'Kata "promo" 50%', produk: [{ nama: 'Kopi' }] });
  assert.equal(json.filename, 'Menu Baru.json');
  assert.equal(json.mimetype, 'application/json');
  const md = buildFile(graph('file_md', '# {{judul}}\n\n{{answer}}').nodes[1] as never, fill, 'Artikel');
  assert.equal(md.content.toString(), '# Menu Baru\n\nKata "promo" 50%\n');
  assert.equal(md.filename, 'Artikel.md');
  assert.equal(generatedName('../rahasia/a.md', 'x', 'file_md'), '.._rahasia_a.md');
  assert.equal(generatedName('laporan.JSON', 'x', 'file_json'), 'laporan.json');
  assert.throws(() => buildFile(graph('file_md', '{{kosong}}').nodes[1] as never, () => '', 'x'), /ai_file_empty/);
});

test('Generated files are stored in the data profile and sent by Kirim media; simulation writes nothing', async () => {
  const d = blankDefinition();
  d.collections = [];
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const profile = await service.createDataProfile(client, { profile_type: g.id, name: 'Berkas' });
  const scope = {
    account: client,
    profile: profile.id,
    session: 'wa',
    customer: '62811',
    requestId: randomUUID(),
    fallbackEnabled: false,
  };
  const md = await runGraph(
    graph('file_md', '# Artikel\n\n{{input.message}}', { filename: 'artikel-{{customer.phone}}' }),
    noModel,
    { ...defaults },
    [{ role: 'user', content: 'Isi "artikel" hari ini' }],
    scope,
    null,
  );
  assert.equal(md.answer, 'artikel-62811.md 34');
  assert.equal(md.media?.length, 1);
  const sent = md.media![0];
  assert.deepEqual([sent.kind, sent.type, sent.filename], ['file', 'document', 'artikel-62811.md']);
  const stored = await recordFilePath(client, profile.id, sent.ref);
  assert.equal(stored.mimetype, 'text/markdown');
  assert.equal(await readFile(stored.path, 'utf8'), '# Artikel\n\nIsi "artikel" hari ini\n');

  const json = await runGraph(
    graph('file_json', '{"pesan":"{{input.message}}","pelanggan":"{{customer.phone}}"}'),
    noModel,
    { ...defaults },
    [{ role: 'user', content: 'Kirim "data"' }],
    scope,
    null,
  );
  const saved = await recordFilePath(client, profile.id, json.media![0].ref);
  assert.equal(saved.filename, 'Berkas.json');
  assert.deepEqual(JSON.parse(await readFile(saved.path, 'utf8')), { pesan: 'Kirim "data"', pelanggan: '62811' });

  const preview = await runGraph(
    graph('file_md', '{{input.message}}'),
    noModel,
    { ...defaults },
    [{ role: 'user', content: 'halo' }],
    { ...scope, profile: 'simulation' },
    null,
    undefined,
    300,
    previewMedia,
    previewFiles,
  );
  assert.deepEqual([preview.media![0].kind, preview.media![0].filename], ['preview', 'Berkas.md']);
});
