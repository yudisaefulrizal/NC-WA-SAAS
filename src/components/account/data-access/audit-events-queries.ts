// Query tabel audit_events untuk komponen account. Dipanggil lewat namespace, misalnya
// `auditEventsSql.insertPasswordChanged(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insertPasswordChanged(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'password_changed_self')", params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)', params);
}
// Halaman log audit untuk pemilik: jumlah total, lalu satu halaman event beserta email akunnya.
export const page = {
  count: 'SELECT COUNT(*) AS total FROM audit_events',
  items: (size: number, offset: number) =>
    'SELECT e.id,e.account_id,a.email AS account_email,e.action,e.created_at FROM audit_events e LEFT JOIN accounts a ON a.id=e.account_id ORDER BY e.id DESC LIMIT ' +
    size +
    ' OFFSET ' +
    offset,
};
