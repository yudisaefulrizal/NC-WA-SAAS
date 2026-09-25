// npm run bench: mengukur kecepatan operasi kredit dan wallet dengan akun uji, lalu menulis hasilnya ke
// data/benchmark.json. Akun uji dihapus lagi setelahnya.
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { db } from '../../src/libraries/db.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { reserveCredit, settleCredit } from '../../src/components/billing/domain/credits.js';
const accounts: string[] = [];
try {
  for (let i = 0; i < 25; i++) {
    const id = randomUUID();
    accounts.push(id);
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
    ]);
    await basicWallet(id);
  }
  const times: number[] = [];
  const start = performance.now();
  await Promise.all(
    accounts.map(async account => {
      await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const begin = performance.now();
          await reserveCredit(account, 'benchmark-' + i, 'b'.repeat(64));
          await settleCredit(account, 'benchmark-' + i, 'sent');
          times.push(performance.now() - begin);
        }),
      );
    }),
  );
  times.sort((a, b) => a - b);
  const result = {
    kind: 'synthetic-credit-ledger',
    accounts: 25,
    operations: times.length,
    elapsedMs: Math.round(performance.now() - start),
    p50Ms: Math.round(times[Math.floor(times.length * 0.5)]),
    p95Ms: Math.round(times[Math.floor(times.length * 0.95)]),
    note: 'No WhatsApp connections or Midtrans network calls; not a production capacity claim.',
  };
  await mkdir('data', { recursive: true });
  await writeFile('data/benchmark.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const id of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
}
