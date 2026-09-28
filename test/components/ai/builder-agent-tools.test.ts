// Agent dengan koleksi: nilai yang jelas maksudnya dirapikan sebelum diperiksa, isi query yang ditolak dan nama tool
// yang salah dikembalikan ke AI sebagai hasil tool (bukan menggagalkan balasan), dan petunjuk tool memuat contoh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import type { AIMessage, AITransport } from '../../../src/components/ai/domain/provider.js';
import type { AITraceEvent } from '../../../src/components/ai/domain/pipeline/models.js';
import {
  blankDefinition,
  parseDefinition,
  type GraphDefinition,
} from '../../../src/components/ai/domain/builder/definition.js';
import { coerceRecordData, recordToolGuide } from '../../../src/components/ai/domain/builder/record-tools.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { firstJsonObject } from '../../../src/components/ai/domain/builder/engine.js';

after(async () => {
  await db.end();
});
// Input → Agent (tool Catat_pesanan: buat record Pesanan) → Output.
function orderGraph(): GraphDefinition {
  const d = blankDefinition('Toko');
  const f = (id: string, label: string, type: string, extra = {}) => ({
    id,
    label,
    type,
    required: false,
    options: [],
    collection: '',
    ...extra,
  });
  d.collections = [
    {
      id: 'pesanan',
      name: 'Pesanan',
      owner: 'shared',
      fields: [
        f('nama_pembeli', 'Nama Pembeli', 'text', { required: true }),
        f('jumlah', 'Jumlah', 'number', { required: true }),
        f('status', 'Status', 'choice', { options: ['Baru', 'Lunas'] }),
        f('jam', 'Jam kirim', 'time'),
        f('tanggal', 'Tanggal', 'date'),
        f('tambahan', 'Tambahan', 'multichoice', { options: ['Sambal', 'Kerupuk'] }),
      ],
    } as never,
  ];
  const agent = d.nodes.find(n => n.type === 'agent')!;
  agent.label = 'Kasir';
  agent.tools = ['catat'];
  agent.prompt = 'Catat pesanan pelanggan.';
  d.nodes.push({
    ...agent,
    id: 'catat',
    label: 'Catat_pesanan',
    type: 'data_table',
    tools: [],
    prompt: '',
    collection: 'pesanan',
    operation: 'create',
    value: '{"data":{}}',
  });
  return parseDefinition(d);
}
async function run(answers: string[]) {
  const seen: AIMessage[][] = [];
  const events: AITraceEvent[] = [];
  const transport: AITransport = async (_c, messages) => {
    seen.push(messages);
    const next = answers.shift();
    if (!next) throw Error('tidak ada jawaban lagi');
    return next;
  };
  await simulate(
    randomUUID(),
    { definition: orderGraph(), message: 'Pesan 2 nasi, atas nama Ani' },
    e => events.push(e),
    new AbortController().signal,
    transport,
  );
  const done = events.find(e => e.node === 'output' && e.state === 'completed')?.output as
    { answer: string; records: Record<string, { data: Record<string, unknown> }[]> } | undefined;
  const failed = events.find(e => e.node === 'execution' && e.state === 'error');
  return { seen, done, failed };
}

test('Obvious values are tidied before checking: labels, numbers, choices, times, dates, lists', () => {
  const c = orderGraph().collections[0];
  assert.deepEqual(
    coerceRecordData(c, {
      'Nama Pembeli': 'Ani',
      jumlah: 'Rp 25.000',
      Status: 'lunas',
      jam: '9.30',
      tanggal: '3/10/2026',
      tambahan: 'sambal, kerupuk',
    }),
    {
      nama_pembeli: 'Ani',
      jumlah: 25000,
      status: 'Lunas',
      jam: '09:30',
      tanggal: '2026-10-03',
      tambahan: ['Sambal', 'Kerupuk'],
    },
  );
  assert.deepEqual(coerceRecordData(c, { jumlah: '2,5' }), { jumlah: 2.5 });
  assert.deepEqual(coerceRecordData(c, { jumlah: '1,250,000' }), { jumlah: 1250000 });
  // Nilai yang meragukan dibiarkan agar pemeriksaan menolaknya.
  assert.deepEqual(coerceRecordData(c, { jumlah: 'dua', status: 'Batal', tanggal: 'besok' }), {
    jumlah: 'dua',
    status: 'Batal',
    tanggal: 'besok',
  });
});

test('A rejected query is returned to the Agent, which fixes it and the record is saved', async () => {
  const { seen, done, failed } = await run([
    '{"tool":"catat","query":{"data":{"nama_pembeli":"Ani","jumlah":"dua"}}}',
    '{"tool":"catat","query":{"data":{"Nama Pembeli":"Ani","jumlah":"2","status":"baru"}}}',
    '{"answer":"Pesanan Ani sudah dicatat."}',
  ]);
  assert.equal(failed, undefined);
  assert.equal(done!.answer, 'Pesanan Ani sudah dicatat.');
  assert.deepEqual(
    done!.records.pesanan.map(r => r.data),
    [{ nama_pembeli: 'Ani', jumlah: 2, status: 'Baru' }],
  );
  // Putaran kedua menerima pesan error dari putaran pertama.
  assert.match(JSON.stringify(seen[1]), /Tipe field Jumlah tidak sesuai.*Perbaiki query/);
});

test('An unknown tool name is returned to the Agent instead of failing the reply', async () => {
  const { seen, done, failed } = await run([
    '{"tool":"simpan_pesanan","query":{"data":{}}}',
    '{"answer":"Maaf, saya coba lagi nanti."}',
  ]);
  assert.equal(failed, undefined);
  assert.equal(done!.answer, 'Maaf, saya coba lagi nanti.');
  assert.match(JSON.stringify(seen[1]), /tidak dikenal. Pakai salah satu id: catat/);
});

test('The tool guide shows an example query with correct value types and the writing rules', () => {
  const d = orderGraph();
  const guide = recordToolGuide(
    d,
    d.nodes.find(n => n.id === 'catat')!,
  ) as {
    contoh: { data: Record<string, unknown> };
    aturan: string;
  };
  assert.deepEqual(guide.contoh.data, {
    nama_pembeli: '…',
    jumlah: 150000,
  });
  assert.match(guide.aturan, /Angka tanpa tanda kutip[\s\S]*jangan dikarang/);
});

test('A tool call followed by a guessed answer, with the query as JSON text, still saves once and answers', async () => {
  const { seen, done, failed } = await run([
    '{"tool":"catat","query":"{\\"data\\":{\\"nama_pembeli\\":\\"Ani\\",\\"jumlah\\":2}}"}\n\n{"answer":"Sudah dicatat (tebakan)."}',
    '{"answer":"Pesanan Ani sudah dicatat."}',
  ]);
  assert.equal(failed, undefined);
  assert.equal(done!.answer, 'Pesanan Ani sudah dicatat.');
  assert.deepEqual(
    done!.records.pesanan.map(r => r.data),
    [{ nama_pembeli: 'Ani', jumlah: 2 }],
  );
  // Permintaan tool dan hasilnya menjadi giliran terakhir percakapan (bukan disisipkan di pesan system).
  assert.deepEqual(
    seen[1].slice(-2).map(m => m.role),
    ['assistant', 'user'],
  );
  assert.match(seen[1].at(-2)!.content, /"tool":"catat"/);
  assert.match(seen[1].at(-1)!.content, /^Hasil catat[\s\S]*BERHASIL disimpan/);
  assert.doesNotMatch(seen[1][0].content, /Hasil tool sejauh ini/);
});

test('firstJsonObject keeps only the first complete object, respecting braces inside strings', () => {
  assert.equal(firstJsonObject('{"a":"}{"} tambahan {"b":1}'), '{"a":"}{"}');
  assert.equal(firstJsonObject('tanpa objek'), 'tanpa objek');
});

test('The Uji trace carries each prompt, the raw answer, why an answer was rejected, and the tool query', async () => {
  const events: AITraceEvent[] = [];
  const answers = [
    '{"jawab":"Salah kunci"}',
    '{"tool":"catat","query":{"data":{"nama_pembeli":"Ani","jumlah":2}}}',
    '{"answer":"Dicatat."}',
  ];
  await simulate(
    randomUUID(),
    { definition: orderGraph(), message: 'Pesan 2' },
    e => events.push(e),
    new AbortController().signal,
    async () => answers.shift()!,
  );
  const responded = events.filter(e => e.state === 'responded');
  assert.equal(responded.length, 3);
  assert.ok(responded.every(e => e.prompt?.some(m => m.role === 'system') && e.prompt.at(-1)!.content));
  assert.equal(responded[0].output, '{"jawab":"Salah kunci"}');
  const rejected = events.find(e => e.state === 'retry')!;
  assert.match(
    rejected.error!,
    /^ai_invalid_structure — kunci jawab atau isinya kosong; yang diterima: answer, tool\+query/,
  );
  assert.deepEqual(events.find(e => e.node === 'catat' && e.state === 'running')?.input, {
    data: { nama_pembeli: 'Ani', jumlah: 2 },
  });
});

test('Identical tool calls are not run again, and an exhausted Agent still answers without tools', async () => {
  const call = '{"tool":"catat","query":{"data":{"nama_pembeli":"Ani","jumlah":2}}}';
  const { seen, done, failed } = await run([call, call, call, call, call, '{"answer":"Pesanan Ani sudah dicatat."}']);
  assert.equal(failed, undefined);
  assert.equal(done!.answer, 'Pesanan Ani sudah dicatat.');
  assert.equal(done!.records.pesanan.length, 1);
  assert.match(seen[1].at(-1)!.content, /BERHASIL/);
  assert.match(seen[2].at(-1)!.content, /sudah dipanggil dengan query yang sama/);
  assert.match(seen[5].at(-1)!.content, /Batas pemanggilan tool tercapai/);
});

test('Each collection schema appears once in the Agent prompt even when several tools use it', async () => {
  const d = orderGraph();
  const agent = d.nodes.find(n => n.type === 'agent')!;
  const catat = d.nodes.find(n => n.id === 'catat')!;
  d.nodes.push({ ...catat, id: 'cari', label: 'Cari_pesanan', operation: 'search', value: '{}' });
  agent.tools = ['catat', 'cari'];
  const seen: AIMessage[][] = [];
  await simulate(
    randomUUID(),
    { definition: d, message: 'halo' },
    () => {},
    new AbortController().signal,
    async (_c, m) => {
      seen.push(m);
      return '{"answer":"Halo"}';
    },
  );
  assert.equal(seen[0][0].content.split('"nama_pembeli","label"').length - 1, 1);
});
