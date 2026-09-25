// Tes reservasi kredit WhatsApp: kiriman bersamaan, idempotensi, hasil tidak pasti, pergantian periode, dan restart.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';
import { reserveCredit, settleCredit } from '../../../src/components/billing/domain/credits.js';
const accounts: string[] = [];
const hash = 'a'.repeat(64);
const now = new Date('2026-04-10T00:00:00Z');
async function account() {
  const id = randomUUID();
  accounts.push(id);
  await db.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)', [
    id,
    `${id}@test.invalid`,
    'unused',
  ]);
  await basicWallet(id, now);
  return id;
}
after(async () => {
  for (const id of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
});
test('Concurrent sends cannot spend the same last credit', async () => {
  const id = await account();
  await db.execute('UPDATE wallets SET balance=1 WHERE account_id=?', [id]);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => reserveCredit(id, `send_${i}`, hash, now)),
  );
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await basicWallet(id, now)).balance, 0);
});
test('Same request reserves once, different payload rejected; refund once', async () => {
  const id = await account();
  const start = (await basicWallet(id, now)).balance;
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveCredit(id, 'same', hash, now)));
  assert.equal(results.filter(r => r.created).length, 1);
  await assert.rejects(reserveCredit(id, 'same', 'b'.repeat(64), now), /idempotency_conflict/);
  await Promise.all(Array.from({ length: 8 }, () => settleCredit(id, 'same', 'failed', now)));
  assert.equal((await basicWallet(id, now)).balance, start);
  assert.equal((await reserveCredit(id, 'same', hash, now)).created, false);
});
test('Unknown holds credit; accepted message cannot be refunded', async () => {
  const id = await account();
  const start = (await basicWallet(id, now)).balance;
  await reserveCredit(id, 'send', hash, now);
  await settleCredit(id, 'send', 'unknown', now);
  assert.equal((await basicWallet(id, now)).balance, start - 1);
  await settleCredit(id, 'send', 'sent', now);
  await assert.rejects(settleCredit(id, 'send', 'failed', now), /outcome_conflict/);
  const other = await account();
  await assert.rejects(settleCredit(other, 'send', 'failed', now), /reservation_not_found/);
});
test('Late failure from expired period does not inflate new quota', async () => {
  const id = await account();
  await reserveCredit(id, 'late', hash, now);
  const next = new Date('2026-05-01T00:00:00Z');
  const fresh = await basicWallet(id, next);
  await settleCredit(id, 'late', 'failed', next);
  assert.equal((await basicWallet(id, next)).balance, fresh.quota);
});

test('Queued reservations cannot dispatch after their reset boundary', async () => {
  const { validateReservation } = await import('../../../src/components/billing/domain/credits.js');
  const id = await account();
  await reserveCredit(id, 'queued', hash, now);
  await validateReservation(id, 'queued', now);
  const next = new Date('2026-05-01T00:00:00Z');
  await assert.rejects(validateReservation(id, 'queued', next), /reservation_expired/);
  await settleCredit(id, 'queued', 'failed', next);
  const wallet = await basicWallet(id, next);
  assert.equal(wallet.balance, wallet.quota);
});

test('Restart retains ambiguous sends and restores persisted receipts without spending again', async () => {
  const { recoverReservations } = await import('../../../src/components/billing/domain/credits.js');
  const id = await account();
  const initial = (await basicWallet(id, now)).balance;
  await reserveCredit(id, 'unknown_after_crash', hash, now);
  await reserveCredit(id, 'receipt_after_crash', hash, now);
  await db.execute('INSERT INTO outbound_results VALUES (?,?,?,?)', [
    id,
    'receipt_after_crash',
    'fixture-id',
    '628123@s.whatsapp.net',
  ]);
  await recoverReservations(id);
  await recoverReservations(id);
  assert.equal((await reserveCredit(id, 'unknown_after_crash', hash, now)).status, 'unknown');
  assert.equal((await reserveCredit(id, 'receipt_after_crash', hash, now)).status, 'sent');
  assert.equal((await basicWallet(id, now)).balance, initial - 2);
});
