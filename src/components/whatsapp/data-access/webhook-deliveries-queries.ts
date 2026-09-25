// Query tabel webhook_deliveries untuk komponen whatsapp. Dipanggil lewat namespace, misalnya
// `webhookDeliveriesSql.countByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function countByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM webhook_deliveries WHERE account_id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO webhook_deliveries(id,account_id,subscription_id,payload) VALUES (?,?,?,?)', params);
}
export function deleteOlderThanDay(c: Executor, params: SqlValue[], accountScope: string | undefined) {
  return c.execute(
    'DELETE FROM webhook_deliveries WHERE created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)' +
      (accountScope ? ' AND account_id=?' : ''),
    params,
  );
}
export function listDue(c: Executor, params: SqlValue[], accountScope: string | undefined) {
  return c.query<RowDataPacket[]>(
    `SELECT d.id,d.account_id,d.payload,d.attempts,s.url FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.next_at<=UTC_TIMESTAMP() ${accountScope ? 'AND d.account_id=?' : ''} AND d.id=(SELECT d2.id FROM webhook_deliveries d2 WHERE d2.account_id=d.account_id AND d2.next_at<=UTC_TIMESTAMP() ORDER BY d2.created_at,d2.id LIMIT 1) ORDER BY d.next_at LIMIT 4`,
    params,
  );
}
export function deleteById(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM webhook_deliveries WHERE id=?', params);
}
export function scheduleRetry(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE webhook_deliveries SET attempts=?,next_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE id=?',
    params,
  );
}
