// Asisten AI Editor profil: memakai tier Cerdas dengan jawaban panjang, membaca panduan skill dan draft, membalas
// jawaban saja atau usulan definisi yang sudah diperiksa, memperbaiki sendiri bila bermasalah, dan tidak menyimpan.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import type { AIConfig, AIMessage, AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
} from '../../../src/components/ai/domain/builder/definition.js';
import {
  diffDefinitions,
  extractAnswer,
  restorePositions,
  runAssistant,
  type AssistantEvent,
} from '../../../src/components/ai/domain/builder/assistant.js';

const actor = randomUUID();
after(async () => {
  await db.execute('DELETE FROM audit_events WHERE account_id=?', [actor]);
  await db.end();
});
// Transport tiruan: mengembalikan jawaban berurutan dan mencatat permintaan.
function fake(answers: string[]) {
  const calls: { config: AIConfig; messages: AIMessage[] }[] = [];
  const transport: AITransport = async (config, messages) => {
    calls.push({ config, messages: [...messages] });
    const next = answers.shift();
    if (next === undefined) throw Error('tidak ada jawaban lagi');
    return next;
  };
  return { transport, calls };
}
const run = async (answers: string[], definition: GraphDefinition, message = 'Tolong ubah') => {
  const events: AssistantEvent[] = [];
  const { transport, calls } = fake(answers);
  const result = await runAssistant(
    actor,
    'g_uji',
    { message, definition, history: [{ role: 'user', content: 'Halo' }] },
    e => events.push(e),
    new AbortController().signal,
    transport,
  );
  return { result, events, calls };
};
// Draft dengan Agent tambahan "penutup" di antara Agent dan Output.
function withClosing(d: GraphDefinition): GraphDefinition {
  const next = structuredClone(d);
  const agent = next.nodes.find(n => n.type === 'agent')!;
  next.nodes.push({ ...agent, id: 'penutup', label: 'Penutup', prompt: 'Tutup percakapan.', x: agent.x + 280 });
  const toOutput = next.edges.find(e => e.source === agent.id)!;
  next.edges.push({ id: 'e_penutup', source: 'penutup', port: 'next', target: toOutput.target });
  toOutput.target = 'penutup';
  return next;
}

test('Answer JSON is extracted from fenced or surrounding text', () => {
  assert.deepEqual(extractAnswer('Berikut:\n```json\n{"reply":"Ok","definition":null}\n```'), {
    reply: 'Ok',
    definition: null,
  });
  assert.equal(extractAnswer('teks {"reply":"Hai"} teks').reply, 'Hai');
  assert.throws(() => extractAnswer('bukan json'), /ai_assistant_invalid_json/);
});

test('A question gets a reply only; smart tier, long answers, guide and draft are sent', async () => {
  const d = blankDefinition('Toko');
  const { result, events, calls } = await run(['{"reply":"Alurnya: Input ke Agent.","definition":null}'], d);
  assert.deepEqual(result, { reply: 'Alurnya: Input ke Agent.', definition: null, issues: [], changes: null });
  assert.deepEqual(
    events.map(e => e.step),
    ['drafting', 'done'],
  );
  const { config, messages } = calls[0];
  assert.equal(config.max_tokens, 16000);
  assert.equal(config.timeout_ms, 180000);
  assert.equal(config.call_role, 'builder_assistant');
  assert.match(messages[0].content, /===== SKILL\.md =====[\s\S]*Cara membalas di Editor profil/);
  assert.deepEqual(messages[1], { role: 'user', content: 'Halo' });
  assert.match(messages[2].content, /Draft profil yang sedang dibuka[\s\S]*"name":"Toko"[\s\S]*Tolong ubah$/);
  // Posisi node urusan tampilan: tidak dikirim ke AI.
  assert.doesNotMatch(messages[2].content, /"x":/);
  const [audit] = await db.execute<import('mysql2/promise').RowDataPacket[]>(
    'SELECT action FROM audit_events WHERE account_id=?',
    [actor],
  );
  assert.equal(audit[0].action, 'graph_assistant:g_uji');
});

test('A change is checked and summarised; issues are sent back for repair; bad JSON is retried', async () => {
  const d = blankDefinition('Toko');
  const good = withClosing(d);
  const broken = structuredClone(good);
  broken.edges = broken.edges.filter(e => e.source !== 'penutup');
  const { result, events, calls } = await run(
    [
      'maaf, belum json',
      JSON.stringify({ reply: 'Menambah Penutup.', definition: broken }),
      '```json\n' + JSON.stringify({ reply: 'Menambah Penutup dan sambungannya.', definition: good }) + '\n```',
    ],
    d,
  );
  assert.deepEqual(
    events.map(e => e.step),
    ['drafting', 'repairing', 'checking', 'repairing', 'checking', 'done'],
  );
  assert.equal(calls.length, 3);
  assert.match(calls[2].messages.at(-1)!.content, /Editor menemukan masalah[\s\S]*penutup/);
  assert.equal(result.reply, 'Menambah Penutup dan sambungannya.');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.changes, {
    added: [{ id: 'penutup', label: 'Penutup', type: 'agent' }],
    removed: [],
    changed: [],
    edges_added: 2,
    edges_removed: 1,
    collections: [],
    profile: false,
  });
  assert.equal(result.definition!.nodes.length, d.nodes.length + 1);
  // Node lama memakai posisinya lagi; node baru tanpa posisi (disusun editor dengan Rapikan).
  for (const n of d.nodes) {
    const back = result.definition!.nodes.find(x => x.id === n.id)!;
    assert.deepEqual([back.x, back.y], [n.x, n.y]);
  }
  const added = result.definition!.nodes.find(n => n.id === 'penutup')!;
  assert.deepEqual([added.x, added.y], [undefined, undefined]);
});

test('After the repair limit the last result is returned with its issues', async () => {
  const d = blankDefinition('Toko');
  const broken = withClosing(d);
  broken.edges = broken.edges.filter(e => e.source !== 'penutup');
  const answer = JSON.stringify({ reply: 'Coba', definition: broken });
  const { result, calls } = await run([answer, answer, answer], d);
  assert.equal(calls.length, 3);
  assert.ok(result.issues.length > 0);
  assert.ok(result.definition);
});

test('Diff ignores position-only moves and reports removals, edits, and collections', () => {
  const d = blankDefinition('Toko');
  const moved = structuredClone(d);
  moved.nodes[0].x += 100;
  assert.deepEqual(diffDefinitions(d, moved).changed, []);
  const edited = structuredClone(d);
  const agent = edited.nodes.find(n => n.type === 'agent')!;
  agent.prompt = 'Baru';
  edited.name = 'Toko 2';
  edited.collections.push({ id: 'produk', name: 'Produk', owner: 'shared', fields: [] } as never);
  const changes = diffDefinitions(d, edited);
  assert.deepEqual(changes.changed, [{ id: agent.id, label: agent.label, type: 'agent' }]);
  assert.deepEqual(changes.collections, ['produk']);
  assert.equal(changes.profile, true);
});

test('Positions are optional in the format; restored by id and never taken from the AI', () => {
  const d = blankDefinition('Toko');
  const bare = { ...d, nodes: d.nodes.map(({ x: _x, y: _y, ...n }) => n) };
  const parsed = parseDefinition(bare);
  assert.equal(parsed.nodes[0].x, undefined);
  assert.deepEqual(validateGraph(parsed), validateGraph(d));
  assert.throws(() => parseDefinition({ ...d, nodes: [{ ...d.nodes[0], x: 10, y: undefined }, ...d.nodes.slice(1)] }));
  const moved = structuredClone(d);
  moved.nodes[0].x = 999;
  moved.nodes.push({ ...d.nodes[0], id: 'baru', label: 'Baru', x: 5, y: 5 });
  const restored = restorePositions(moved, d);
  assert.equal(restored.nodes[0].x, d.nodes[0].x);
  assert.equal(restored.nodes.at(-1)!.x, undefined);
});
