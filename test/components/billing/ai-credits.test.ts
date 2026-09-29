// Tes kredit AI di paket: paket dasar mendapat kredit AI tiap bulan, paket berbayar menggantikannya selama aktif,
// pemakaian mengambil kredit paket lebih dulu, refund kembali ke wadah asalnya, dan kredit paket yang hangus tidak
// dihitung. Wadah kedua (hasil beli) tidak pernah hangus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../../src/libraries/db.js';
import {
  activatePackage,
  basicPeriod,
  basicPeriodEnd,
  basicWallet,
  planInput,
} from '../../../src/components/billing/domain/plans.js';
import { planPart, refundSplit } from '../../../src/components/ai/domain/metering.js';
import * as walletsSql from '../../../src/components/ai/data-access/wallets-queries.js';
import { ai } from '../../../src/components/ai/domain/service.js';

const ids: string[] = [];
let originalBasic = 0;
async function account() {
  const id = randomUUID();
  ids.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  return id;
}
async function wallet(id: string) {
  const [rows] = await walletsSql.findBalance(db, [id]);
  return rows[0];
}
async function activate(id: string, payment: string, aiCredits: number, now = new Date()) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await activatePackage(
      c,
      id,
      payment,
      { id: 'fixture-paid', credits: 500, ai_credits: aiCredits, session_limit: 3 },
      now,
    );
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function setPurchased(id: string, purchased: number) {
  await walletsSql.ensure(db, [id]);
  await db.execute('UPDATE ai_wallets SET balance=? WHERE account_id=?', [purchased, id]);
}
async function reserve(id: string, amount: number) {
  const before = await wallet(id);
  const fromPlan = planPart(amount, before.plan_balance);
  await walletsSql.debit(db, [amount, id]);
  return fromPlan;
}
async function finish(id: string, reserved: number, fromPlan: number, charged: number) {
  const back = refundSplit(reserved, fromPlan, reserved - charged);
  await walletsSql.refund(db, [back.toBalance, back.toPlan, id]);
}
test.before(async () => {
  const [rows] = await db.query<RowDataPacket[]>("SELECT ai_credits FROM plans WHERE id='basic'");
  originalBasic = rows[0].ai_credits;
  await db.execute("UPDATE plans SET ai_credits=50 WHERE id='basic'");
});
after(async () => {
  await db.execute("UPDATE plans SET ai_credits=? WHERE id='basic'", [originalBasic]);
  for (const id of ids) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
});

test('Plan input accepts ai_credits, defaults old clients to 0, and rejects invalid amounts', () => {
  const base = { name: 'A', price: 1000, credits: 100, session_limit: 1, active: true };
  const withLimits = { max_share_assets: 20, max_share_storage_bytes: 104857600 };
  assert.equal(planInput({ ...base, ...withLimits, ai_credits: 5000 })!.aiCredits, 5000);
  assert.equal(planInput({ ...base, ...withLimits })!.aiCredits, 0);
  assert.equal(planInput({ ...base, ...withLimits, ai_credits: -1 }), null);
  assert.equal(planInput({ ...base, ...withLimits, ai_credits: 1.5 }), null);
});

test('Basic plan grants AI credits once per WIB month and replaces the remainder', async () => {
  const id = await account(),
    now = new Date();
  // Panggilan paralel memberi kredit sekali; akun tanpa baris ai_wallets dibuat otomatis.
  await Promise.all(Array.from({ length: 6 }, () => basicWallet(id, now)));
  let w = await wallet(id);
  assert.equal(w.plan_balance, 50);
  assert.equal(w.plan_quota, 50);
  assert.equal(w.purchased, 0);
  assert.equal(w.balance, 50);
  assert.equal(new Date(w.plan_expires_at).toISOString(), basicPeriodEnd(basicPeriod(now)).toISOString());
  await reserve(id, 20);
  await basicWallet(id, now);
  assert.equal((await wallet(id)).plan_balance, 30, 'bulan yang sama tidak memberi kredit lagi');
  // Bulan berikutnya: sisa diganti kuota baru (tidak menumpuk).
  await db.execute("UPDATE wallets SET period='2000-01' WHERE account_id=?", [id]);
  await db.execute("UPDATE ai_wallets SET plan_period='2000-01' WHERE account_id=?", [id]);
  await basicWallet(id, now);
  w = await wallet(id);
  assert.equal(w.plan_balance, 50);
});

test('Paid package replaces the basic AI bucket and lasts as long as the package', async () => {
  const id = await account(),
    now = new Date();
  await basicWallet(id, now);
  await setPurchased(id, 200);
  await activate(id, 'pay-' + randomUUID(), 3000, now);
  const w = await wallet(id);
  assert.equal(w.plan_balance, 3000);
  assert.equal(w.purchased, 200);
  assert.equal(w.balance, 3200);
  const [rows] = await db.execute<RowDataPacket[]>('SELECT expires_at FROM wallets WHERE account_id=?', [id]);
  assert.equal(new Date(w.plan_expires_at).getTime(), new Date(rows[0].expires_at).getTime());
  // Aktivasi yang sama diulang tidak memberi kredit dua kali.
  const payment = 'pay-' + randomUUID();
  await activate(id, payment, 1000, now);
  await activate(id, payment, 1000, now);
  assert.equal((await wallet(id)).plan_balance, 1000);
});

test('Usage takes package credit first and refunds go back to the bucket they came from', async () => {
  const id = await account();
  await basicWallet(id);
  await db.execute('UPDATE ai_wallets SET plan_balance=10,plan_quota=10 WHERE account_id=?', [id]);
  await setPurchased(id, 100);
  const reserved = 30,
    fromPlan = await reserve(id, reserved);
  assert.equal(fromPlan, 10);
  let w = await wallet(id);
  assert.deepEqual([w.plan_balance, w.purchased], [0, 80]);
  // Dipakai 5 dari 30: 25 kembali, dan 20 pertama masuk ke saldo beli (bagian yang terakhir diambil).
  await finish(id, reserved, fromPlan, 5);
  w = await wallet(id);
  assert.deepEqual([w.plan_balance, w.purchased], [5, 100]);
  // Pemakaian yang lebih kecil dari kredit paket hanya menyentuh kredit paket.
  const small = await reserve(id, 3);
  assert.equal(small, 3);
  await finish(id, 3, small, 3);
  w = await wallet(id);
  assert.deepEqual([w.plan_balance, w.purchased], [2, 100]);
});

test('Expired package credit is ignored, never refunded, and never exceeds the quota', async () => {
  const id = await account();
  await basicWallet(id);
  await db.execute('UPDATE ai_wallets SET plan_balance=40,plan_quota=40 WHERE account_id=?', [id]);
  await setPurchased(id, 60);
  assert.equal((await wallet(id)).balance, 100);
  // Kredit paket hangus di tengah reservasi: bagian itu tidak dikembalikan, dan tidak menjadi saldo beli.
  const fromPlan = await reserve(id, 50);
  assert.equal(fromPlan, 40);
  await db.execute(
    'UPDATE ai_wallets SET plan_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE account_id=?',
    [id],
  );
  await finish(id, 50, fromPlan, 0);
  let w = await wallet(id);
  assert.equal(w.plan_balance, 0);
  assert.equal(w.purchased, 60, 'hanya bagian saldo beli yang kembali; bagian paket yang hangus hilang');
  assert.equal(w.balance, w.purchased);
  // Setelah hangus, pemakaian mengambil saldo beli saja.
  const next = await reserve(id, 20);
  assert.equal(next, 0);
  assert.equal((await wallet(id)).purchased, w.purchased - 20);
  // Refund ke kredit paket yang aktif tidak melewati kuota.
  await db.execute(
    'UPDATE ai_wallets SET plan_balance=8,plan_quota=10,plan_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE account_id=?',
    [id],
  );
  await walletsSql.refund(db, [0, 50, id]);
  w = await wallet(id);
  assert.equal(w.plan_balance, 10);
});

test('Owner adjustments only change the purchased bucket, and the summary shows both buckets', async () => {
  const id = await account();
  await basicWallet(id);
  await setPurchased(id, 100);
  const service = ai;
  const before = await service.wallet(id);
  assert.deepEqual([before.balance, before.plan_balance, before.purchased], [150, 50, 100]);
  const after = await service.adjust(id, id, {
    amount: -100,
    reason: 'koreksi',
    requestId: 'adj-' + randomUUID().slice(0, 8),
  });
  assert.deepEqual([after.balance, after.plan_balance, after.purchased], [50, 50, 0]);
  await assert.rejects(
    service.adjust(id, id, { amount: -1, reason: 'terlalu banyak', requestId: 'adj2-' + randomUUID().slice(0, 8) }),
  );
});
