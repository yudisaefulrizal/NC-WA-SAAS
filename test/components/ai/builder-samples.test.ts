// Data contoh koleksi: opsional di format (maksimal 10 baris, tidak diperiksa saat simpan); "Buat data contoh" membuat
// semua koleksi sekaligus dengan tier Murah, urut menurut relasi, dengan `_id` per baris dan relasi yang menunjuk baris
// contoh koleksi tujuan; simulasi menerjemahkan relasi itu dan melewati baris yang tidak valid tanpa menghentikan Uji.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import type { AIConfig, AIMessage, AITransport } from '../../../src/components/ai/domain/provider.js';
import { isJevModel, type AITraceEvent } from '../../../src/components/ai/domain/pipeline/models.js';
import { parseDefinition, type GraphDefinition } from '../../../src/components/ai/domain/builder/definition.js';
import { cleanSample, generateSamples, sampleOrder } from '../../../src/components/ai/domain/builder/samples.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { catalogGraph } from './graph-fixture.js';

const actor = randomUUID();
after(async () => {
  await db.end();
});
// Pendaftaran → Jadwal → Layanan (relasi wajib berantai), ditambah SOP (teks) dan Produk dari fixture katalog.
function clinic(): GraphDefinition {
  const d = catalogGraph();
  const f = (id: string, type: string, extra = {}) => ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    type,
    required: false,
    options: [],
    collection: '',
    ...extra,
  });
  d.collections.push(
    {
      id: 'pendaftaran',
      name: 'Pendaftaran',
      owner: 'shared',
      fields: [
        f('pasien', 'text', { required: true }),
        f('jadwal', 'relation', { required: true, collection: 'jadwal' }),
      ],
    } as never,
    {
      id: 'jadwal',
      name: 'Jadwal',
      owner: 'shared',
      fields: [
        f('dokter', 'text', { required: true }),
        f('layanan', 'relation', { required: true, collection: 'layanan' }),
        f('brosur', 'file'),
      ],
    } as never,
    { id: 'layanan', name: 'Layanan', owner: 'shared', fields: [f('nama', 'text', { required: true })] } as never,
    { id: 'sop', name: 'SOP', owner: 'shared', kind: 'text', fields: [] },
  );
  return parseDefinition(d);
}

test('Samples are optional, limited to ten rows, and kept as written until Uji', () => {
  const d = clinic();
  d.collections[0].samples = [{ nama: 'Kopi', biaya: 'bukan angka' }];
  assert.deepEqual(parseDefinition(d).collections[0].samples, [{ nama: 'Kopi', biaya: 'bukan angka' }]);
  d.collections[0].samples = Array.from({ length: 11 }, () => ({ nama: 'x' }));
  assert.throws(() => parseDefinition(d));
});

test('Relation targets come first, and sample rows keep an _id and only relations to existing sample rows', () => {
  const d = clinic();
  assert.deepEqual(
    sampleOrder(d).map(c => c.id),
    ['produk', 'layanan', 'jadwal', 'pendaftaran', 'sop'],
  );
  const jadwal = d.collections.find(c => c.id === 'jadwal')!;
  const ids = { layanan: ['layanan_1'] };
  assert.deepEqual(
    cleanSample(
      jadwal,
      { _id: 'jadwal_a', dokter: 'dr. Sari', layanan: 'layanan_1', brosur: 'gigi.pdf', x: 1 },
      ids,
      'j',
    ),
    { _id: 'jadwal_a', dokter: 'dr. Sari', layanan: 'layanan_1', brosur: 'gigi.pdf' },
  );
  assert.equal(cleanSample(jadwal, { dokter: 'dr. Sari', layanan: 'layanan_9' }, ids, 'j'), null);
  assert.deepEqual(cleanSample(jadwal, { _id: 'Salah Id', dokter: 'dr. B', layanan: 'layanan_1' }, ids, 'jadwal_2'), {
    _id: 'jadwal_2',
    dokter: 'dr. B',
    layanan: 'layanan_1',
  });
});

test('Buat data contoh fills every collection at once with consistent relations', async () => {
  const calls: { config: AIConfig; messages: AIMessage[] }[] = [];
  const reply =
    (text: string): AITransport =>
    async (config, messages) => {
      calls.push({ config, messages });
      return text;
    };
  const d = clinic();
  const answer = {
    samples: {
      produk: [
        { nama: 'Kopi', biaya: 18000 },
        { nama: 'Teh', biaya: 'x' },
      ],
      layanan: [
        { _id: 'layanan_1', nama: 'Gigi' },
        { _id: 'layanan_2', nama: 'Umum' },
      ],
      jadwal: [
        { _id: 'jadwal_1', dokter: 'dr. Sari', layanan: 'layanan_1' },
        { _id: 'jadwal_2', dokter: 'dr. Bima', layanan: 'layanan_9' },
      ],
      pendaftaran: [
        { _id: 'pendaftaran_1', pasien: 'Ani', jadwal: 'jadwal_1' },
        { _id: 'pendaftaran_2', pasien: 'Budi', jadwal: 'jadwal_2' },
      ],
      sop: [{ text: 'Datang 15 menit lebih awal.' }],
    },
  };
  const result = await generateSamples({ definition: d }, reply('```json\n' + JSON.stringify(answer) + '\n```'));
  assert.deepEqual(result.samples, {
    produk: [{ _id: 'produk_1', nama: 'Kopi', biaya: 18000 }],
    layanan: answer.samples.layanan,
    jadwal: [answer.samples.jadwal[0]],
    // Jadwal_2 dibuang karena layanannya tidak ada, jadi pendaftaran Budi ikut dibuang.
    pendaftaran: [answer.samples.pendaftaran[0]],
    sop: [{ text: 'Datang 15 menit lebih awal.' }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.call_role, 'builder_samples');
  const prompt = calls[0].messages[1].content;
  assert.ok(prompt.indexOf('- layanan') < prompt.indexOf('- jadwal'));
  assert.match(prompt, /layanan \(Layanan, relation, wajib, isi dengan _id baris contoh koleksi layanan\)/);
  await assert.rejects(generateSamples({ definition: d }, reply('tidak ada')), /ai_samples/);
});

test('Uji maps sample _id relations to records and skips invalid sample rows instead of failing', async () => {
  const d = clinic();
  const events: AITraceEvent[] = [];
  // Router katalog memilih Sapaan; Agent menjawab "Halo".
  const transport: AITransport = async c =>
    c.call_role !== 'router'
      ? '{"answer":"Halo"}'
      : isJevModel(c.model)
        ? '{"branch":{"choice":"sapaan"}}'
        : '{"branch":"sapaan","fallback_terkait":[]}';
  await simulate(
    actor,
    {
      definition: d,
      message: 'assalamualaikum',
      records: {
        layanan: [{ _id: 'layanan_1', nama: 'Gigi' }],
        jadwal: [
          { _id: 'jadwal_1', dokter: 'dr. Sari', layanan: 'layanan_1' },
          { _id: 'jadwal_2', dokter: 'dr. Tanpa Layanan' },
        ],
      },
    },
    e => events.push(e),
    new AbortController().signal,
    transport,
  );
  const skipped = events.find(e => e.node === 'samples');
  assert.deepEqual(skipped?.output, [{ collection: 'Jadwal', message: 'baris 2: Layanan wajib diisi.' }]);
  const done = events.find(e => e.node === 'output' && e.state === 'completed')!.output as {
    answer: string;
    records: Record<string, { id: string; data: Record<string, unknown> }[]>;
  };
  assert.equal(done.answer, 'Halo');
  assert.equal(done.records.jadwal.length, 1);
  assert.equal(done.records.jadwal[0].data.layanan, done.records.layanan[0].id);
});
