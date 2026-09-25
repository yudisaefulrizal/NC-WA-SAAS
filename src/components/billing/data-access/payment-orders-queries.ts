// Query tabel payment_orders untuk komponen billing. Dipanggil lewat namespace, misalnya
// `paymentOrdersSql.page(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
// Halaman semua pembayaran untuk pemilik: jumlah total, lalu satu halaman order beserta email akunnya.
export const page = {
  count: 'SELECT COUNT(*) AS total FROM payment_orders',
  items: (size: number, offset: number) =>
    'SELECT p.id,p.account_id,a.email AS account_email,p.plan_name,p.total,p.status,p.environment,p.created_at FROM payment_orders p LEFT JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT ' +
    size +
    ' OFFSET ' +
    offset,
};
export function listRecentByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,kind,credits,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? ORDER BY created_at DESC LIMIT 100',
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,kind,credits,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? AND id=?',
    params,
  );
}
export function findExpiredPending(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id FROM payment_orders WHERE account_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP() LIMIT 1",
    params,
  );
}
export function findOpen(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id,plan_id,kind FROM payment_orders WHERE account_id=? AND status IN ('creating','pending','unknown') LIMIT 1",
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO payment_orders(id,account_id,plan_id,plan_name,price,fee,total,credits,session_limit,config_id,environment,kind) VALUES (?,?,?,?,?,0,?,?,?,?,?,?)',
    params,
  );
}
export function markDenied(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE payment_orders SET status='deny' WHERE id=? AND status='creating'", params);
}
export function markUnknown(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE payment_orders SET status='unknown' WHERE id=? AND status='creating'", params);
}
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=?', params);
}
export function markStaleChecked(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE payment_orders SET checked_at=UTC_TIMESTAMP(),status=IF(created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),'not_found',status) WHERE id=? AND status IN ('creating','unknown')",
    params,
  );
}
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=? FOR UPDATE', params);
}
export function markActivated(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE payment_orders SET activated_at=UTC_TIMESTAMP() WHERE id=?', params);
}
export function updateFromGateway(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE payment_orders SET status=?,transaction_id=?,qr_url=?,expires_at=?,checked_at=UTC_TIMESTAMP() WHERE id=?',
    params,
  );
}
export function listDueForCheck(c: Executor) {
  return c.query<RowDataPacket[]>(
    "SELECT id FROM payment_orders WHERE status IN ('creating','pending','unknown') AND (checked_at IS NULL OR checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)) ORDER BY COALESCE(checked_at,created_at) LIMIT 10",
  );
}
export function touchChecked(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE payment_orders SET checked_at=UTC_TIMESTAMP() WHERE id=?', params);
}
