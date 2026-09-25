// Uji coba opsional ke provider AI sungguhan. Memori sintetis, tool demo, tanpa WhatsApp dan tanpa menulis data.
import assert from 'node:assert/strict';
import { ai } from '../../src/components/ai/domain/service.js';
import { countWords } from '../../src/components/ai/domain/metering.js';
import { callAI, type AIMessage } from '../../src/components/ai/domain/provider.js';
import { runAgents, type ToolName } from '../../src/components/ai/domain/pipeline/runner.js';
import { db } from '../../src/libraries/db.js';
try {
  const config = await ai.config();
  if (!config.secret) throw Error('Konfigurasi penyedia AI belum tersedia');
  const memory: AIMessage[] = [];
  const turns = [
    ['informasi', 'Apa saja produk frame kacamata beserta harga yang tersedia?'],
    [
      'konsultasi',
      'Saya butuh frame ringan untuk sehari-hari dengan anggaran 200 ribu. Mana yang Anda rekomendasikan?',
    ],
    ['transaksi', 'Saya mau memesan satu Frame Basic untuk Budi. Tolong buat pesanan simulasi sekarang.'],
    ['dukungan', 'Tolong cek status pesanan ORD-1001.'],
  ] as const;
  for (const [index, [expected, input]] of turns.entries()) {
    const invoked: ToolName[] = [];
    const result = await runAgents(
      callAI,
      config,
      [
        { role: 'system', content: 'Anda melayani demo Klinik Kacamata Sehat.' },
        ...memory,
        { role: 'user', content: input },
      ],
      300,
      {
        account: 'live-smoke-only',
        session: 'synthetic',
        customer: '628000000000',
        requestId: 'turn-' + index,
        knowledge: 'Klinik Kacamata Sehat: pemeriksaan dan pembuatan kacamata.',
        behavior: 'Jelaskan semua data dalam uji ini adalah simulasi.',
      },
      {
        async execute(name, query, scope) {
          invoked.push(name);
          if (name === 'get_knowledge') return { knowledge: scope.knowledge };
          if (name === 'get_products')
            return {
              products: [
                {
                  id: 'FRM-001',
                  name: 'Frame Basic',
                  description: 'Frame ringan untuk harian',
                  price: 150000,
                  stock: 10,
                  active: true,
                  type: 'product',
                },
              ],
            };
          return {
            order: {
              id: 'ORD-1001',
              customer: scope.customer,
              items: [{ product_id: 'FRM-001', name: 'Frame Basic', quantity: 1, price: 150000 }],
              total: 150000,
              status: 'baru',
              notes: 'Simulasi',
            },
          };
        },
      },
    );
    assert.equal(result.agent, expected);
    assert.ok(result.answer.trim());
    assert.ok(countWords(result.answer) <= 300);
    if (expected === 'informasi' || expected === 'konsultasi') assert.ok(invoked.includes('get_products'));
    if (expected === 'transaksi') assert.ok(invoked.includes('create_order'));
    if (expected === 'dukungan') assert.ok(invoked.includes('check_order'));
    memory.push({ role: 'user', content: input }, { role: 'assistant', content: result.answer });
    console.log('PASS', expected, 'tools:', invoked.join(', '));
  }
} finally {
  await db.end();
}
