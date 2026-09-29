// Tes kredit WhatsApp hasil beli: dipakai setelah kredit paket habis, tidak ikut reset bulanan, refund kembali ke
// wadah asalnya, dan tidak memengaruhi hitungan kuota paket dasar maupun perpindahan ke paket berbayar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../../src/libraries/db.js';
import { activatePackage, basicWallet } from '../../../src/components/billing/domain/plans.js';
import { reserveCredit, settleCredit, validateReservation } from '../../../src/components/billing/domain/credits.js';
import * as walletsSql from '../../../src/components/billing/data-access/wallets-queries.js';

const ids: string[] = [];
const hash = 'a'.repeat(64);
async function account(now: Date, purchased: number, planLeft: number) {
  const id = randomUUID();
  ids.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  await basicWallet(id, now);
  await db.execute('UPDATE wallets SET balance=?,purchased=? WHERE account_id=?', [planLeft, purchased, id]);
  return id;
}
async function raw(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT balance,purchased FROM wallets WHERE account_id=?', [id]);
  return rows[0];
}
after(async () => {
  for (const id of ids) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
});

test('Usage takes package credit first, then purchased credit; refunds return to the bucket they came from', async () => {
  const now = new Date('2026-08-10T00:00:00Z'),
    id = await account(now, 10, 1);
  assert.equal((await basicWallet(id, now)).balance, 11);
  await reserveCredit(id, 'r1', hash, now);
  assert.deepEqual(await raw(id), { balance: 0, purchased: 10 });
  await reserveCredit(id, 'r2', hash, now);
  assert.deepEqual(await raw(id), { balance: 0, purchased: 9 });
  // Kirim gagal: r2 (dari saldo beli) kembali ke saldo beli, r1 (dari paket) kembali ke kredit paket.
  await settleCredit(id, 'r2', 'failed', now);
  assert.deepEqual(await raw(id), { balance: 0, purchased: 10 });
  await settleCredit(id, 'r1', 'failed', now);
  assert.deepEqual(await raw(id), { balance: 1, purchased: 10 });
  await settleCredit(id, 'r1', 'failed', now);
  assert.deepEqual(await raw(id), { balance: 1, purchased: 10 }, 'refund yang diulang tidak menambah lagi');
  // Total habis: tidak bisa memesan.
  await db.execute('UPDATE wallets SET balance=0,purchased=0 WHERE account_id=?', [id]);
  await assert.rejects(reserveCredit(id, 'r3', hash, now), { message: 'insufficient_credits' });
});

test('Purchased credit survives the monthly reset and does not reduce the new basic quota', async () => {
  const now = new Date('2026-08-10T00:00:00Z'),
    id = await account(now, 0, 100),
    [plans] = await db.query<RowDataPacket[]>("SELECT credits FROM plans WHERE id='basic'"),
    quota = plans[0].credits;
  await db.execute('UPDATE wallets SET balance=0,purchased=5 WHERE account_id=?', [id]);
  // Habis kredit paket: pesan ini dibayar dari saldo beli dan tidak dihitung sebagai pemakaian kuota bulan itu.
  await reserveCredit(id, 'p1', hash, now);
  await settleCredit(id, 'p1', 'sent', now);
  assert.deepEqual(await raw(id), { balance: 0, purchased: 4 });
  const next = new Date('2026-08-31T17:00:00Z');
  const wallet = await basicWallet(id, next);
  assert.equal(wallet.plan_balance, quota, 'kuota bulan baru penuh');
  assert.equal(wallet.purchased, 4);
  assert.equal(wallet.balance, quota + 4);
  // Reservasi dari saldo beli tetap sah setelah reset, dan refund-nya kembali ke saldo beli.
  await reserveCredit(id, 'p2', hash, next);
  await db.execute('UPDATE wallets SET balance=0 WHERE account_id=?', [id]);
  await reserveCredit(id, 'p3', hash, next);
  const afterReset = new Date('2026-09-30T17:00:00Z');
  await basicWallet(id, afterReset);
  await validateReservation(id, 'p3', afterReset);
  await settleCredit(id, 'p3', 'failed', afterReset);
  assert.equal((await raw(id)).purchased, 4);
  await assert.rejects(validateReservation(id, 'p2', afterReset), { message: 'reservation_expired' });
});

test('Purchased credit stays when a package is activated; only the package bucket is transferred', async () => {
  const now = new Date(),
    id = await account(now, 7, 20);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await activatePackage(c, id, 'pay-' + randomUUID(), { id: 'fixture-paid', credits: 500, session_limit: 3 }, now);
    await c.commit();
  } finally {
    c.release();
  }
  const wallet = await basicWallet(id, now);
  assert.equal(wallet.purchased, 7);
  assert.equal(wallet.plan_balance, 500 + 20 - 0, 'sisa kredit paket dasar ikut pindah');
  assert.equal(wallet.balance, wallet.plan_balance + 7);
  const [result] = await walletsSql.find(db, [id]);
  assert.equal(result[0].purchased, 7);
});
