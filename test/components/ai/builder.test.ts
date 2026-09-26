// Profil graf: publikasi, isolasi tenant, operasi tool, relasi, revisi, dan eksekusi yang mengikuti koneksi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  assertRunnable,
  validateRecord,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { templates } from '../../../src/components/ai/domain/builder/templates.js';
import { runGraph, interpolate } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { setProfileEnabled, activeWorkflow } from '../../../src/components/ai/domain/profiles/registry.js';
import { runAgents } from '../../../src/components/ai/domain/pipeline/runner.js';
import type { AgentWorkflow } from '../../../src/components/ai/domain/pipeline/models.js';
const owner = randomUUID(),
  client = randomUUID(),
  other = randomUUID(),
  ownerToken = randomUUID(),
  clientToken = randomUUID();
const ids: string[] = [];
const service = new AIService(
  async () => '{"answer":"Selesai"}',
  async () => {},
);
const app = createApp();
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
const scope = {
  account: client,
  profile: 'simulation',
  session: 'test',
  customer: '628001',
  requestId: randomUUID(),
  knowledge: '',
  fallbackEnabled: true,
};
before(async () => {
  for (const [id, role, token] of [
    [owner, 'owner', ownerToken],
    [client, 'user', clientToken],
    [other, 'user', ''],
  ]) {
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
    if (token)
      await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
        digest(token),
        id,
      ]);
  }
});
after(async () => {
  for (const id of [owner, client, other]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
});
async function graph() {
  const d = templates()[0].definition;
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  return g;
}
test('All templates round-trip and validate; cycles, dangling ports, missing variables and code paths fail', () => {
  for (const t of templates()) {
    assertRunnable(t.definition);
    assert.deepEqual(parseDefinition(JSON.parse(JSON.stringify(t.definition))), t.definition);
  }
  const cycle = blankDefinition();
  cycle.edges[1].target = 'agent';
  assert.throws(() => assertRunnable(cycle), /Siklus/);
  const missing = blankDefinition();
  missing.nodes[2].value = '{{nodes.unknown.answer}}';
  assert.throws(() => assertRunnable(missing), /belum tersedia/);
  missing.nodes[2].value = '{{nodes.agent.typo}}';
  assert.throws(() => assertRunnable(missing), /tidak dikenal/);
  assert.throws(() => interpolate('{{input.constructor}}', { input: {} }));
  const d = blankDefinition();
  d.edges = [];
  assert.throws(() => assertRunnable(d), /Hubungkan/);
  assert.throws(() => parseDefinition({ ...d, version: 99 }));
});
test('Field types reject invalid calendar dates, unknown fields and required values', () => {
  const c = {
    id: 'items',
    name: 'Items',
    fields: [{ id: 'day', label: 'Tanggal', type: 'date' as const, required: true, options: [], collection: '' }],
  };
  assert.throws(() => validateRecord(c, { day: '2026-02-30' }));
  assert.throws(() => validateRecord(c, { day: '9999-99-99' }));
  assert.throws(() => validateRecord(c, {}));
  assert.throws(() => validateRecord(c, { day: '2026-01-01', extra: true }));
  assert.deepEqual(validateRecord(c, { day: '2026-01-01' }), { day: '2026-01-01' });
});
test('Draft revision conflicts and immutable published versions protect active execution', async () => {
  const g = await graph();
  const next = structuredClone(g.draft);
  next.name = 'Updated';
  const saved = await store.saveGraph(owner, g.id, { revision: g.revision, definition: next });
  assert.equal((await store.graphState(g.id)).active?.name, g.draft.name);
  await assert.rejects(store.saveGraph(owner, g.id, { revision: g.revision, definition: next }), {
    code: 'workflow_conflict',
  });
  await store.saveGraph(owner, g.id, { revision: saved.revision }, true);
  assert.equal((await store.version(g.id, 1)).name, g.draft.name);
  assert.equal((await store.versions(g.id)).length, 2);
  assert.equal(((await activeWorkflow(g.id)) as AgentWorkflow).graph?.name, 'Updated');
});
test('Unpublished profiles cannot be enabled', async () => {
  const g = await store.createGraph(owner, blankDefinition());
  ids.push(g.id);
  await assert.rejects(setProfileEnabled(owner, g.id, true), { code: 'profile_not_published' });
});
test('Records enforce account scope, optimistic updates and idempotency; schema changes protect saved records', async () => {
  const g = await graph(),
    profile = await service.createDataProfile(client, { profile_type: g.id, name: 'Client data' });
  const first = await store.writeRecord(
    client,
    profile.id,
    'produk',
    'create',
    { data: { nama: 'Basic', biaya: 150000 } },
    'repeat',
  );
  const same = await store.writeRecord(
    client,
    profile.id,
    'produk',
    'create',
    { data: { nama: 'Basic', biaya: 150000 } },
    'repeat',
  );
  assert.equal(first.id, same.id);
  assert.equal((await store.readRecords(client, profile.id, 'produk')).records.length, 1);
  await assert.rejects(store.readRecords(other, profile.id, 'produk'), { code: 'data_profile_not_found' });
  await assert.rejects(store.writeRecord(other, profile.id, 'produk', 'create', { data: { nama: 'Intruder' } }), {
    code: 'data_profile_not_found',
  });
  const updated = await store.writeRecord(client, profile.id, 'produk', 'update', {
    id: first.id,
    revision: 1,
    data: { nama: 'Updated', biaya: 10 },
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    store.writeRecord(client, profile.id, 'produk', 'update', { id: first.id, revision: 1, data: { nama: 'Stale' } }),
    { code: 'record_conflict' },
  );
  const next = structuredClone(g.draft);
  next.collections[0].fields.find(f => f.id === 'biaya')!.type = 'boolean';
  const saved = await store.saveGraph(owner, g.id, { revision: g.revision, definition: next });
  await assert.rejects(store.saveGraph(owner, g.id, { revision: saved.revision }, true), { code: 'schema_conflict' });
  assert.equal((await store.graphState(g.id)).published_revision, 1);
});
test('Relations stay within a data profile; cloning remaps references and delete rejects referenced rows', async () => {
  const d = blankDefinition();
  d.collections = [
    {
      id: 'parents',
      name: 'Parents',
      fields: [{ id: 'nama', label: 'Nama', type: 'text', required: true, options: [], collection: '' }],
    },
    {
      id: 'children',
      name: 'Children',
      fields: [{ id: 'parent', label: 'Parent', type: 'relation', required: true, options: [], collection: 'parents' }],
    },
  ];
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: 1 }, true);
  await setProfileEnabled(owner, g.id, true);
  const p = await service.createDataProfile(client, { profile_type: g.id, name: 'Relations' }),
    p2 = await service.createDataProfile(client, { profile_type: g.id, name: 'Other relations' });
  const parent = await store.writeRecord(client, p.id, 'parents', 'create', { data: { nama: 'One' } });
  await assert.rejects(store.writeRecord(client, p2.id, 'children', 'create', { data: { parent: parent.id } }), {
    code: 'invalid_relation',
  });
  await store.writeRecord(client, p.id, 'children', 'create', { data: { parent: parent.id } });
  await assert.rejects(store.writeRecord(client, p.id, 'parents', 'delete', { id: parent.id, revision: 1 }), {
    code: 'record_in_use',
  });
  const copy = await service.createDataProfile(client, { name: 'Copy relations', copy_from: p.id });
  const copiedParent = (await store.readRecords(client, copy.id, 'parents')).records[0],
    copiedChild = (await store.readRecords(client, copy.id, 'children')).records[0];
  assert.notEqual(copiedParent.id, parent.id);
  assert.equal(copiedChild.data.parent, copiedParent.id);
});
test('Runtime executes configured graph instead of legacy router and persists context', async () => {
  const d = blankDefinition();
  const context: GraphNode = { ...d.nodes[1], id: 'context', type: 'context', prompt: 'Ringkas', x: 600 };
  context.memory = 'memory';
  d.nodes.push({ ...d.nodes[0], id: 'memory', type: 'memory' }, context);
  d.edges[1].target = 'context';
  d.edges.push({ id: 'e3', source: 'context', port: 'next', target: 'output' });
  const calls: string[] = [];
  const config = { ...defaults, workflow: { graph: d, nodes: {} } };
  const answer = await runAgents(
    async c => {
      calls.push(c.call_role!);
      return c.call_role === 'context' ? 'pelanggan-selesai-bertanya' : '{"answer":"Baik"}';
    },
    config,
    [{ role: 'user', content: 'Halo' }],
    100,
    scope,
  );
  assert.equal(answer.answer, 'Baik');
  assert.deepEqual(calls, ['agent', 'context']);
  assert.equal(config.graph_context, 'pelanggan-selesai-bertanya');
});
test('JEV router follows choice and invokes only tools granted to the selected agent', async () => {
  const d = templates()[0].definition;
  const router = d.nodes.find(n => n.id === 'router')!;
  router.tier = 'decision';
  router.model = 'typesafe/jev-1.13';
  let calls = 0,
    tools = 0;
  const result = await runGraph(
    d,
    async c => {
      if (c.call_role === 'router') {
        assert.equal(c.decision_request?.questions.branch.type, 'choice');
        return '{"branch":{"choice":"layanan","confidence":1}}';
      }
      calls++;
      return calls === 1 ? '{"tool":"cari_data","query":"basic"}' : '{"answer":"Basic tersedia"}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Cari basic' }],
    scope,
    null,
    async (n, v) => {
      tools++;
      assert.equal(n.id, 'cari_data');
      assert.equal(v, 'basic');
      return { records: [{ data: { nama: 'Basic' } }] };
    },
  );
  assert.equal(result.answer, 'Basic tersedia');
  assert.equal(tools, 1);
  await assert.rejects(
    runGraph(
      d,
      async c => (c.call_role === 'router' ? '{"branch":{"choice":"layanan"}}' : '{"tool":"not_granted","query":""}'),
      { ...defaults },
      [{ role: 'user', content: 'Halo' }],
      scope,
      null,
    ),
    /ai_invalid_tool/,
  );
});
test('Condition branches and abort signal bypass model calls', async () => {
  const d = blankDefinition();
  d.nodes[1] = { ...d.nodes[1], type: 'condition', field: 'input.message', operator: 'contains', compare: 'ya' };
  d.nodes[2].value = 'Benar';
  d.nodes.push({ ...d.nodes[2], id: 'no', value: 'Salah' });
  d.edges[1].port = 'yes';
  d.edges.push({ id: 'e3', source: 'agent', port: 'no', target: 'no' });
  const transport: AITransport = async () => {
    throw Error('Model should not be called');
  };
  assert.equal(
    (await runGraph(d, transport, { ...defaults }, [{ role: 'user', content: 'tidak' }], scope, null)).answer,
    'Salah',
  );
  await assert.rejects(
    runGraph(
      d,
      transport,
      { ...defaults, signal: AbortSignal.abort() },
      [{ role: 'user', content: 'ya' }],
      scope,
      null,
    ),
  );
});
test('Simulation data survives a second turn but never touches client records', async () => {
  const d = templates()[0].definition;
  let output: any;
  const emit = (e: any) => {
    if (e.state === 'completed') output = e.output;
  };
  const transport: AITransport = async c =>
    c.call_role === 'router' ? '{"branch":"layanan"}' : '{"answer":"Selesai"}';
  await simulate(
    owner,
    { definition: d, message: 'basic', records: { produk: [{ nama: 'Basic' }] } },
    emit,
    new AbortController().signal,
    transport,
  );
  const id = output.records.produk[0].id;
  await simulate(
    owner,
    { definition: d, message: 'lagi', records: output.records },
    emit,
    new AbortController().signal,
    transport,
  );
  assert.equal(output.records.produk[0].id, id);
});
test('HTTP protects admin operations and export only includes definition; records use logged-in account', async () => {
  const cookie = (token: string) => 'ncwa_session=' + token;
  const denied = await request(app)
    .post('/api/admin/ai/builder')
    .set('Origin', origin)
    .set('Cookie', cookie(clientToken))
    .send(blankDefinition());
  assert.equal(denied.status, 403);
  const g = await graph();
  const exported = await request(app)
    .get('/api/admin/ai/builder/' + g.id + '/export')
    .set('Cookie', cookie(ownerToken));
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body, g.draft);
  const imported = await request(app)
    .post('/api/admin/ai/builder')
    .set('Origin', origin)
    .set('Cookie', cookie(ownerToken))
    .send({ ...exported.body, secret: 'must-not-persist', records: [{ private: true }] });
  assert.equal(imported.status, 201);
  ids.push(imported.body.id);
  assert.equal(imported.body.active, null);
  assert.equal(JSON.stringify(imported.body).includes('must-not-persist'), false);
  const p = await service.createDataProfile(other, { profile_type: g.id, name: 'Private' });
  assert.equal(
    (
      await request(app)
        .get('/api/ai/records/' + p.id + '/produk')
        .set('Cookie', cookie(clientToken))
    ).status,
    404,
  );
});

test('Agent repairs malformed JSON and repeated identical mutations do not create duplicate records', async () => {
  const d = templates()[0].definition;
  const tool = d.nodes.find(n => n.type === 'tool')!;
  tool.operation = 'create';
  tool.value = '{"data":{"nama":"Basic"}}';
  let calls = 0,
    writes = 0;
  const result = await runGraph(
    d,
    async c => {
      if (c.call_role === 'router') return '{"branch":"layanan"}';
      calls++;
      if (calls === 1) return 'invalid json';
      if (calls < 4) return '{"tool":"cari_data","query":{"data":{"nama":"Basic"}}}';
      return '{"answer":"Berhasil"}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Buat Basic' }],
    scope,
    null,
    async () => {
      writes++;
      return { id: randomUUID(), revision: 1, data: { nama: 'Basic' } };
    },
  );
  assert.equal(result.answer, 'Berhasil');
  assert.equal(writes, 1);
  assert.equal(calls, 4);
});

test('Deleting an unused graph removes versions; graphs with client data are protected', async () => {
  const unused = await graph();
  await assert.rejects(store.deleteGraph(owner, unused.id, { revision: 0 }), { code: 'workflow_conflict' });
  await store.deleteGraph(owner, unused.id, { revision: 1 });
  assert.equal(await store.findGraph(unused.id), null);
  const used = await graph();
  await service.createDataProfile(client, { profile_type: used.id, name: 'Retained profile' });
  await assert.rejects(store.deleteGraph(owner, used.id, { revision: 1 }), { code: 'profile_in_use' });
});

test('Shared Memory exposes the same bounded conversation to downstream agents without model calls of its own', async () => {
  const d = blankDefinition();
  const memory = { ...d.nodes[0], id: 'memory', type: 'memory' as const, memory_limit: 2 };
  const second = { ...d.nodes[1], id: 'second' };
  d.nodes[1].memory = 'memory';
  second.memory = 'memory';
  d.nodes.push(memory, second);
  d.edges = [
    { id: 'm1', source: 'input', port: 'next', target: 'agent' },
    { id: 'm3', source: 'agent', port: 'next', target: 'second' },
    { id: 'm4', source: 'second', port: 'next', target: 'output' },
  ];
  const messages = [
    { role: 'user' as const, content: 'pesan lama di luar batas' },
    { role: 'assistant' as const, content: 'jawaban terakhir' },
    { role: 'user' as const, content: 'kebutuhan sebelumnya' },
    { role: 'user' as const, content: 'lanjutkan' },
  ];
  const seen: string[][] = [];
  const events: any[] = [];
  const transport: AITransport = async (_config, m) => {
    seen.push(m.filter(x => x.role === 'user' || x.role === 'assistant').map(x => x.content));
    assert.equal(JSON.stringify(m).includes('pesan lama di luar batas'), false);
    return '{"answer":"Baik"}';
  };
  await runGraph(
    d,
    transport,
    { ...defaults, onTrace: e => events.push(e) },
    messages,
    scope,
    'pelanggan-memilih-produk',
  );
  assert.deepEqual(seen, [
    ['jawaban terakhir', 'kebutuhan sebelumnya', 'lanjutkan'],
    ['jawaban terakhir', 'kebutuhan sebelumnya', 'lanjutkan'],
  ]);
  const output = events.find(e => e.node === 'memory' && e.state === 'read').output;
  assert.equal(output.context, 'pelanggan-memilih-produk');
  assert.equal(output.history.length, 2);
  second.memory = '';
  seen.length = 0;
  await runGraph(
    d,
    async (c, m) => {
      if (c.call_role === 'second') {
        assert.equal(JSON.stringify(m).includes('kebutuhan sebelumnya'), false);
        assert.equal(JSON.stringify(m).includes('pelanggan-memilih-produk'), false);
      }
      return transport(c, m, 100);
    },
    { ...defaults },
    messages,
    scope,
    'pelanggan-memilih-produk',
  );
  assert.deepEqual(seen, [['jawaban terakhir', 'kebutuhan sebelumnya', 'lanjutkan'], ['lanjutkan']]);
  second.memory = 'memory';
  memory.memory_limit = 0;
  seen.length = 0;
  await runGraph(d, transport, { ...defaults }, messages, scope, null);
  assert.deepEqual(seen, [['lanjutkan'], ['lanjutkan']]);
  memory.memory_limit = 61;
  assert.throws(() => parseDefinition(d), /Shared Memory/);
});

test('Memory resources cannot enter execution flow; missing or incompatible attachments and unconnected references fail', () => {
  const d = blankDefinition();
  d.nodes.push({ ...d.nodes[0], id: 'memory', type: 'memory' });
  assertRunnable(d);
  d.nodes[1].memory = 'missing';
  assert.throws(() => assertRunnable(d), /Sambungan memori/);
  d.nodes[1].memory = 'memory';
  d.nodes[1].prompt = 'Use {{nodes.memory.history}}';
  assertRunnable(d);
  d.nodes[1].memory = '';
  assert.throws(() => assertRunnable(d), /belum tersedia/);
  d.nodes[1].prompt = 'Answer';
  d.edges[0].target = 'memory';
  assert.throws(() => assertRunnable(d), /Port koneksi/);
});
test('Legacy sequential memory imports become resource connections without changing execution order', () => {
  const d = blankDefinition();
  d.nodes.push({ ...d.nodes[0], id: 'memory', type: 'memory', memory_limit: 7 });
  d.edges[0].target = 'memory';
  d.edges.push({ id: 'mem_next', source: 'memory', port: 'next', target: 'agent' });
  const migrated = parseDefinition(d);
  assertRunnable(migrated);
  assert.equal(migrated.nodes.find(n => n.id === 'agent')!.memory, 'memory');
  assert.equal(migrated.edges.find(e => e.source === 'input')!.target, 'agent');
  assert.equal(
    migrated.edges.some(e => e.source === 'memory' || e.target === 'memory'),
    false,
  );
  assert.deepEqual(parseDefinition(migrated), migrated);
});
