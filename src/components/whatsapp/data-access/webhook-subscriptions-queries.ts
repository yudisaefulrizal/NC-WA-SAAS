// Query tabel webhook_subscriptions untuk komponen whatsapp. Dipanggil lewat namespace, misalnya
// `webhookSubscriptionsSql.listByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,url,session_id AS sessionId FROM webhook_subscriptions WHERE account_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO webhook_subscriptions(id,account_id,url,session_id) VALUES (?,?,?,?)', params);
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM webhook_subscriptions WHERE account_id=? AND id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM webhook_subscriptions WHERE account_id=? AND id=?', params);
}
export function listForSession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM webhook_subscriptions WHERE account_id=? AND (session_id IS NULL OR session_id=?)',
    params,
  );
}
