// Reservasi kredit WhatsApp: kredit dipesan dulu dengan idempotency key sebelum pesan dikirim, lalu
// diselesaikan (terkirim, dikembalikan, atau tidak pasti) setelah hasil kirim diketahui.
import { db } from '../../../libraries/db.js';
import { ensureBasic } from './plans.js';
import * as creditReservationsSql from '../data-access/credit-reservations-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';
// Layanan internal: jangan pernah membuka endpoint publik yang bisa menandai pesan terkirim atau
// mengembalikan kredit.
export async function reserveCredit(accountId: string, requestId: string, payloadHash: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(payloadHash))
    throw new Error('invalid_request');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await ensureBasic(connection, accountId, now);
    const [existing] = await creditReservationsSql.findRequest(connection, [accountId, requestId]);
    if (existing[0]) {
      if (existing[0].payload_hash !== payloadHash) throw new Error('idempotency_conflict');
      await connection.commit();
      return { created: false, status: existing[0].status as string };
    }
    if (wallet.balance < 1) throw new Error('insufficient_credits');
    await walletsSql.debitOne(connection, [accountId]);
    await creditReservationsSql.insert(connection, [accountId, requestId, payloadHash, wallet.period]);
    await connection.commit();
    return { created: true, status: 'reserved' };
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

export async function settleCredit(
  accountId: string,
  requestId: string,
  outcome: 'sent' | 'failed' | 'unknown',
  now = new Date(),
) {
  if (!['sent', 'failed', 'unknown'].includes(outcome)) throw new Error('invalid_outcome');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await ensureBasic(connection, accountId, now);
    const [rows] = await creditReservationsSql.lockRequest(connection, [accountId, requestId]);
    const row = rows[0];
    if (!row) throw new Error('reservation_not_found');
    if (row.status === 'sent' || row.status === 'failed') {
      if (row.status !== outcome) throw new Error('outcome_conflict');
      await connection.commit();
      return;
    }
    // Pengembalian hanya ke periode asalnya yang masih berlaku. Kuota yang sudah kedaluwarsa tetap hangus.
    if (outcome === 'failed' && row.period === wallet.period) await walletsSql.refundOne(connection, [accountId]);
    await creditReservationsSql.updateStatus(connection, [outcome, accountId, requestId]);
    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

export async function validateReservation(accountId: string, requestId: string, now = new Date()) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const wallet = await ensureBasic(c, accountId, now);
    const [rows] = await creditReservationsSql.findPeriodStatus(c, [accountId, requestId]);
    if (!rows[0] || rows[0].period !== wallet.period || rows[0].status !== 'reserved')
      throw new Error('reservation_expired');
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

export async function recoverReservations(accountId?: string) {
  await creditReservationsSql.resolveOpen(db, accountId ? [accountId] : [], accountId);
}
