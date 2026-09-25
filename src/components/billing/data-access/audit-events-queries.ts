// Query tabel audit_events untuk komponen billing. Dipanggil lewat namespace, misalnya
// `auditEventsSql.insert(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)', params);
}
export function insertPaymentConfigRotated(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'payment_config_rotated')", params);
}
