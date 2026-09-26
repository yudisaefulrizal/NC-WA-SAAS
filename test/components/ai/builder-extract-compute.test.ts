// Node Ekstrak dan Set / Hitung: kontrak dan validasi, normalisasi hasil model, Structured Outputs beserta fallback,
// operasi hitung, serta alur Ekstrak → Kondisi → Hitung → Data yang tidak memanggil model selain Ekstrak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { compute } from '../../../src/components/ai/domain/builder/compute.js';
import { systemVariables } from '../../../src/components/ai/domain/builder/conditions.js';

const scope = {
  account: randomUUID(),
  profile: 'simulation',
  session: 'test',
  customer: '62811',
  customerName: 'Rina',
  requestId: randomUUID(),
  knowledge: '',
  fallbackEnabled: false,
};
function node(id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode {
  return { ...blankDefinition().nodes[2], id, type, label: id, value: '', ...extra };
}
const fields = [
  { id: 'layanan', label: 'Layanan', type: 'choice' as const, required: true, hint: '', options: ['Gigi', 'Umum'] },
  { id: 'tanggal', label: 'Tanggal', type: 'date' as const, required: true, hint: 'Pahami besok', options: [] },
  { id: 'jam', label: 'Jam', type: 'time' as const, required: true, hint: '', options: [] },
  { id: 'sesi', label: 'Jumlah sesi', type: 'number' as const, required: false, hint: '', options: [] },
];
function booking(tier: GraphNode['tier'] = 'structured'): GraphDefinition {
  const d = blankDefinition();
  d.nodes = [
    node('input', 'input'),
    node('memory', 'memory', { memory_limit: 4 }),
    node('isian', 'extract', { fields, tier, memory: 'memory', prompt: 'Layanan klinik {{service.name}}' }),
    node('lengkap', 'condition', { rules: [{ field: 'nodes.isian.missing', operator: 'empty', compare: '' }] }),
    node('hitung', 'compute', {
      steps: [
        { name: 'sesi', op: 'value', args: ['{{nodes.isian.sesi}}'] },
        { name: 'total', op: 'multiply', args: ['150000', '{{nodes.hitung.sesi}}'] },
        { name: 'rupiah', op: 'format_rupiah', args: ['{{nodes.hitung.total}}'] },
        { name: 'ingat', op: 'add_days', args: ['{{nodes.isian.tanggal}}', '-1'] },
        { name: 'teks', op: 'concat', args: ['{{customer.name}}: {{nodes.isian.layanan}} {{nodes.isian.jam}}'] },
      ],
    }),
    node('output', 'output', { value: '{{nodes.hitung.teks}} | {{nodes.hitung.rupiah}} | {{nodes.hitung.ingat}}' }),
    node('kurang', 'output', { value: 'Kurang: {{nodes.isian.missing}}' }),
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'isian' },
    { id: 'e2', source: 'isian', port: 'next', target: 'lengkap' },
    { id: 'e3', source: 'lengkap', port: 'yes', target: 'hitung' },
    { id: 'e4', source: 'lengkap', port: 'no', target: 'kurang' },
    { id: 'e5', source: 'hitung', port: 'next', target: 'output' },
  ];
  return d;
}

test('Contract: Extract and Compute validate fields, arity, reserved names, and step order', () => {
  const d = booking();
  assert.deepEqual(validateGraph(parseDefinition(d)), []);
  const parsed = parseDefinition(d);
  assert.equal(parsed.nodes.find(n => n.id === 'isian')!.memory, 'memory');
  const reversed = structuredClone(d);
  const steps = reversed.nodes.find(n => n.id === 'hitung')!.steps!;
  steps.splice(0, 2, steps[1], steps[0]);
  assert.match(
    validateGraph(parseDefinition(reversed))
      .map(i => i.message)
      .join(),
    /belum dihitung pada langkah sebelumnya/,
  );
  const reserved = structuredClone(d);
  reserved.nodes.find(n => n.id === 'isian')!.fields![0].id = 'missing';
  assert.match(
    validateGraph(parseDefinition(reserved))
      .map(i => i.message)
      .join(),
    /dipakai sistem/,
  );
  const unknown = structuredClone(d);
  unknown.nodes.find(n => n.id === 'output')!.value = '{{nodes.isian.alamat}}';
  assert.match(
    validateGraph(parseDefinition(unknown))
      .map(i => i.message)
      .join(),
    /tidak dikenal/,
  );
  assert.throws(
    () =>
      parseDefinition({
        ...d,
        nodes: d.nodes.map(n => (n.id === 'hitung' ? { ...n, steps: [{ name: 'x', op: 'add', args: ['1'] }] } : n)),
      }),
    /membutuhkan 2 nilai/,
  );
});

test('Extract reads history, sends a JSON schema on the structured tier, normalizes values, and flows into Compute', async () => {
  const d = parseDefinition(booking());
  const tomorrow = systemVariables().tomorrow;
  const calls: { format: unknown; messages: string }[] = [];
  const transport: AITransport = async (c, m) => {
    calls.push({ format: c.response_format, messages: JSON.stringify(m) });
    return JSON.stringify({ layanan: 'gigi', tanggal: tomorrow, jam: '9.30', sesi: '2' });
  };
  const result = await runGraph(
    d,
    transport,
    { ...defaults },
    [
      { role: 'user', content: 'Mau periksa gigi' },
      { role: 'assistant', content: 'Kapan?' },
      { role: 'user', content: 'besok jam 9.30, 2 sesi' },
    ],
    { ...scope, serviceName: 'Klinik Sehat' },
    null,
  );
  assert.equal(calls.length, 1);
  assert.equal((calls[0].format as any).json_schema.schema.required.length, 4);
  assert.match(calls[0].messages, /Mau periksa gigi/);
  assert.match(calls[0].messages, /Klinik Sehat/);
  assert.match(calls[0].messages, new RegExp(systemVariables().today));
  const ingat = new Date(Date.parse(tomorrow + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  assert.equal(result.answer, `Rina: Gigi 09:30 | Rp300.000 | ${ingat}`);
});

test('Extract marks missing required values, drops invalid ones, and retries without schema when unsupported', async () => {
  const d = parseDefinition(booking());
  const formats: unknown[] = [];
  const transport: AITransport = async c => {
    formats.push(c.response_format);
    if (c.response_format) throw Error('ai_provider_http_400');
    return '```json\n{"layanan":"Mata","tanggal":"2026-02-30","jam":null,"sesi":"banyak"}\n```';
  };
  const result = await runGraph(d, transport, { ...defaults }, [{ role: 'user', content: 'halo' }], scope, null);
  assert.equal(formats.length, 2);
  assert.equal(formats[1], undefined);
  assert.equal(result.answer, 'Kurang: ["layanan","tanggal","jam"]');
  // Tier selain Terstruktur tidak pernah mengirim JSON Schema.
  const plain = parseDefinition(booking('medium'));
  const seen: unknown[] = [];
  await runGraph(
    plain,
    async c => {
      seen.push(c.response_format);
      return '{}';
    },
    { ...defaults },
    [{ role: 'user', content: 'halo' }],
    scope,
    null,
  );
  assert.deepEqual(seen, [undefined]);
});

test('Compute operations and failures', () => {
  const cases: [Parameters<typeof compute>[0], unknown[], unknown][] = [
    ['value', [[1, 2]], [1, 2]],
    ['add', ['0.1', 0.2], 0.3],
    ['subtract', [10, '2.5'], 7.5],
    ['multiply', [150000, 3], 450000],
    ['divide', [10, 4], 2.5],
    ['round', [2.456, '1'], 2.5],
    ['round', [2.5, ''], 3],
    ['format_rupiah', [1250000.5], 'Rp1.250.000,5'],
    ['concat', [{ a: 1 }], '{"a":1}'],
    ['truncate', ['Assalamu’alaikum', 5], 'Assal'],
    ['add_days', ['2026-12-31', 1], '2027-01-01'],
    ['add_days', ['2026-03-01T10:00', -1], '2026-02-28'],
    ['days_between', ['2026-09-27', '2026-10-01'], 4],
    ['format_date', ['2026-09-27'], '27 September 2026'],
    ['length', [['a', 'b']], 2],
    ['length', ['halo'], 4],
    ['item_at', [['a', 'b'], 2], 'b'],
    ['item_at', [['a'], 3], null],
  ];
  for (const [op, args, expected] of cases) assert.deepEqual(compute(op, args), expected, op);
  for (const [op, args] of [
    ['divide', [1, 0]],
    ['add', ['satu', 1]],
    ['add', ['', 1]],
    ['round', [1, '7']],
    ['add_days', ['2026-02-30', 1]],
    ['truncate', ['x', -1]],
    ['length', [5]],
    ['item_at', ['abc', 1]],
  ] as const)
    assert.throws(() => compute(op, [...args]), /ai_compute_failed/, op);
});
