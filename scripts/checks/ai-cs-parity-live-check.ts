// Smoke test model terkonfigurasi memakai sandbox dan data dummy; keluaran log hanya metadata, tanpa isi chat/secret.
import { writeFile, mkdir } from 'node:fs/promises';
import { db } from '../../src/libraries/db.js';
import { simulate } from '../../src/components/ai/domain/builder/simulation.js';
import { csTemplate } from '../../src/components/ai/domain/builder/cs-template.js';
import { businessSamples } from './fixtures/cs-business-profile.js';
import type { AITraceEvent } from '../../src/components/ai/domain/pipeline/models.js';
try {
  const results = [];
  for (const [scenario, message, expected] of [
    ['salam', 'Halo, selamat pagi', 'pembuka'],
    ['produk', 'Saya mau cari produk basic, berapa harganya?', 'layanan'],
    ['pesanan', 'Saya konfirmasi pesan 2 pcs Produk Basic. Tolong buatkan pesanannya sekarang.', 'layanan'],
    ['foto', 'Tolong kirim foto Produk Basic.', 'layanan'],
  ]) {
    const started = Date.now(),
      events: AITraceEvent[] = [];
    let failure = '';
    try {
      await simulate(
        'audit-cs-dummy',
        { definition: csTemplate(), message, business: businessSamples },
        e => events.push(e),
        AbortSignal.timeout(90000),
      );
    } catch (e) {
      failure = e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'execution_failed';
    }
    const completion = events.find(e => e.state === 'completed');
    const output = completion?.output as
      | {
          agent?: string;
          answer?: string;
          context?: string;
          business?: { orders: { total: number; customer: string }[] };
          images?: string[];
        }
      | undefined;
    const result = {
      scenario,
      expected_agent: expected,
      actual_agent: output?.agent ?? null,
      completed: !!completion,
      route_matches: output?.agent === expected,
      has_answer: !!output?.answer,
      has_context: !!output?.context,
      product_fact_matches:
        scenario === 'produk'
          ? !!output?.answer && /basic/i.test(output.answer) && output.answer.replace(/[.,\s]/g, '').includes('150000')
          : null,
      business_matches:
        scenario === 'pesanan'
          ? output?.business?.orders.length === 2 &&
            output.business.orders[1].total === 300000 &&
            output.business.orders[1].customer === '628000000001'
          : scenario === 'foto'
            ? output?.images?.length === 1
            : null,
      tools: [
        ...new Set(
          events
            .filter(
              e =>
                e.state === 'done' &&
                ['get_knowledge', 'get_products', 'check_order', 'create_order', 'send_product_image'].includes(e.node),
            )
            .map(e => e.node),
        ),
      ],
      models: [...new Set(events.map(e => e.model).filter(Boolean))],
      duration_ms: Date.now() - started,
      error: failure || null,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await mkdir('docs/examples', { recursive: true });
  await writeFile(
    'docs/examples/cs-parity-live-results.json',
    JSON.stringify(
      { scope: 'Sandbox CS lengkap dengan data bisnis sintetis; tanpa pengiriman WhatsApp', results },
      null,
      2,
    ) + '\n',
  );
  if (
    results.some(
      r =>
        !r.completed ||
        !r.route_matches ||
        !r.has_answer ||
        !r.has_context ||
        r.product_fact_matches === false ||
        r.business_matches === false,
    )
  )
    process.exitCode = 1;
} finally {
  await db.end();
}
