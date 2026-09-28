// Memori percakapan (riwayat) dan memori konteks (ringkasan S-P-O) terpisah: node membaca sesuai sambungannya,
// hanya Context yang menulis konteks, dan profil tanpa Memori konteks memakai cara lama.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaults, type AIMessage } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { contextInstruction } from '../../../src/components/ai/domain/pipeline/context.js';

function node(id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode {
  return { ...blankDefinition().nodes[1], id, type, label: id, prompt: 'Tugas ' + id, ...extra };
}
// Input → Router (konteks saja) → Agent (konteks saja) → Context (riwayat + tulis konteks) → Output.
function graph(): GraphDefinition {
  const d = blankDefinition('Dua memori');
  d.nodes = [
    d.nodes[0],
    node('riwayat', 'memory', { memory_limit: 20, prompt: '' }),
    node('konteks', 'context_memory', { prompt: '' }),
    node('router', 'router', {
      tier: 'cheap',
      context_memory: 'konteks',
      branches: [
        { id: 'info', label: 'Info', description: 'Informasi' },
        { id: 'lain', label: 'Lain', description: 'Lainnya' },
      ],
    }),
    node('info', 'agent', { context_memory: 'konteks' }),
    node('ringkas', 'context', { context_format: 'spo', memory: 'riwayat', context_memory: 'konteks' }),
    { ...d.nodes[2], value: '' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'router' },
    { id: 'e2', source: 'router', port: 'info', target: 'info' },
    { id: 'e3', source: 'router', port: 'lain', target: 'info' },
    { id: 'e4', source: 'info', port: 'next', target: 'ringkas' },
    { id: 'e5', source: 'ringkas', port: 'next', target: 'output' },
  ];
  return d;
}
const scope = {
  account: randomUUID(),
  profile: 'simulation',
  session: 'test',
  customer: '628001',
  requestId: randomUUID(),
  fallbackEnabled: false,
};

test('Context memory: one per profile, only memory consumers read it, and Context must write to it', () => {
  assert.deepEqual(validateGraph(parseDefinition(graph())), []);
  const two = graph();
  two.nodes.push(node('konteks_2', 'context_memory', { prompt: '' }));
  assert.ok(validateGraph(parseDefinition(two)).some(i => i.message === 'Hanya boleh satu Memori konteks.'));
  const unsaved = graph();
  delete unsaved.nodes.find(n => n.id === 'ringkas')!.context_memory;
  assert.ok(
    validateGraph(parseDefinition(unsaved)).some(i => i.message.startsWith('Hubungkan Context ke Memori konteks')),
  );
  const wrong = graph();
  wrong.nodes.find(n => n.id === 'info')!.context_memory = 'riwayat';
  assert.ok(validateGraph(parseDefinition(wrong)).some(i => i.message.startsWith('Sambungan konteks harus')));
  const edge = graph();
  edge.edges.push({ id: 'e9', source: 'router', port: 'lain', target: 'konteks' });
  assert.ok(validateGraph(parseDefinition(edge)).length > 0);
});

test('Router and Agent read only the summary; Context reads the last exchange and writes the next summary', async () => {
  const seen: Record<string, AIMessage[]> = {};
  const config = { ...defaults };
  const history: AIMessage[] = [
    { role: 'user', content: 'Paket basic berapa?' },
    { role: 'assistant', content: 'Rp150.000.' },
  ];
  const result = await runGraph(
    graph(),
    async (c, messages) => {
      seen[c.call_role!] = messages;
      if (c.call_role === 'router') return '{"branch":"info","fallback_terkait":[]}';
      return c.call_role === 'ringkas' ? '"Pelanggan memilih\npaket basic."' : '{"answer":"Siap"}';
    },
    config,
    [...history, { role: 'user', content: '1 aja' }],
    scope,
    'pelanggan-bertanya-harga_paket',
    undefined,
    100,
  );
  assert.equal(result.answer, 'Siap');
  // Router: ringkasan dan pesan terbaru, tanpa riwayat.
  const router = JSON.stringify(seen.router);
  assert.match(router, /pelanggan-bertanya-harga_paket/);
  assert.doesNotMatch(router, /Rp150\.000/);
  // Agent nyambung lewat ringkasan tanpa riwayat: hanya pesan sistem dan pesan terbaru yang dikirim.
  assert.deepEqual(
    seen.info.filter(m => m.role !== 'system').map(m => m.content),
    ['1 aja'],
  );
  // Context hanya menerima instruksi global dan transkrip pesan terakhir, bukan riwayat; hasilnya satu kalimat
  // (baris digabung, kutip pembungkus dibuang, tanda baca boleh) dan hanya Context yang menulis konteks.
  assert.deepEqual(seen.ringkas, [
    // Instruksi global dari sistem, bukan prompt node Context di profil ("Tugas ringkas").
    { role: 'system', content: contextInstruction },
    { role: 'user', content: 'Pelanggan: 1 aja\n\nAI: Siap' },
  ]);
  assert.equal(config.graph_context, 'Pelanggan memilih paket basic.');
});

test('Profiles without a context memory keep the old behaviour through Shared Memory', async () => {
  const d = graph();
  d.nodes = d.nodes.filter(n => n.type !== 'context_memory');
  for (const n of d.nodes) {
    delete n.context_memory;
    if (['router', 'agent', 'context'].includes(n.type)) n.memory = 'riwayat';
  }
  assert.deepEqual(validateGraph(parseDefinition(d)), []);
  const config = { ...defaults };
  let router = '';
  await runGraph(
    d,
    async (c, messages) => {
      if (c.call_role === 'router') {
        router = JSON.stringify(messages);
        return '{"branch":"info","fallback_terkait":[]}';
      }
      return c.call_role === 'ringkas' ? 'pelanggan-selesai-bertanya' : '{"answer":"Siap"}';
    },
    config,
    [{ role: 'user', content: 'halo' }],
    scope,
    'pelanggan-menyapa-admin',
    undefined,
    100,
  );
  assert.match(router, /pelanggan-menyapa-admin/);
  assert.equal(config.graph_context, 'pelanggan-selesai-bertanya');
});

test('A failed summary keeps the previous context and still sends the answer', async () => {
  const config = { ...defaults };
  const result = await runGraph(
    graph(),
    async c => {
      if (c.call_role === 'router') return '{"branch":"info","fallback_terkait":[]}';
      if (c.call_role === 'ringkas') throw Error('ai_provider_http_500');
      return '{"answer":"Siap"}';
    },
    config,
    [{ role: 'user', content: '1 aja' }],
    scope,
    'Pelanggan bertanya harga paket.',
    undefined,
    100,
  );
  assert.equal(result.answer, 'Siap');
  assert.equal(config.graph_context, 'Pelanggan bertanya harga paket.');
});

test('Context needs no prompt: an empty prompt is not an issue', () => {
  const d = graph();
  d.nodes.find(n => n.id === 'ringkas')!.prompt = '';
  assert.equal(
    validateGraph(parseDefinition(d)).some(i => i.node === 'ringkas' && i.message === 'Prompt wajib diisi.'),
    false,
  );
});
