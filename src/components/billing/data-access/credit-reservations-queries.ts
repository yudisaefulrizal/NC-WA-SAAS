// Query tabel credit_reservations untuk komponen billing. Dipanggil lewat namespace, misalnya
// `creditReservationsSql.listRecentByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listRecentByAccount(c: Executor, params: SqlValue[]) {
  return c.execute(
    'SELECT r.request_id,r.status,r.created_at,o.message_id FROM credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id WHERE r.account_id=? ORDER BY r.created_at DESC LIMIT 100',
    params,
  );
}
export function countUsed(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS used FROM credit_reservations WHERE account_id=? AND period=? AND status<>'failed'",
    params,
  );
}
export function countOpen(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM credit_reservations WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",
    params,
  );
}
export function moveOpenToPeriod(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE credit_reservations SET period=? WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",
    params,
  );
}
export function findRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT status,payload_hash FROM credit_reservations WHERE account_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO credit_reservations (account_id,request_id,payload_hash,period) VALUES (?,?,?,?)',
    params,
  );
}
export function lockRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT status,period FROM credit_reservations WHERE account_id=? AND request_id=? FOR UPDATE',
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE credit_reservations SET status=? WHERE account_id=? AND request_id=?', params);
}
export function findPeriodStatus(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT period,status FROM credit_reservations WHERE account_id=? AND request_id=?',
    params,
  );
}
// Saat engine start: reservasi yang masih terbuka menjadi 'sent' bila hasil kirimnya tercatat, selain itu
// 'unknown'. Tanpa accountId berlaku untuk semua akun.
export function resolveOpen(c: Executor, params: SqlValue[], accountId: string | undefined) {
  return c.execute(
    "UPDATE credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id SET r.status=IF(o.message_id IS NULL,'unknown','sent') WHERE r.status IN ('reserved','unknown')" +
      (accountId ? ' AND r.account_id=?' : ''),
    params,
  );
}
