// Query tabel package_activations untuk komponen billing. Dipanggil lewat namespace, misalnya
// `packageActivationsSql.find(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM package_activations WHERE id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO package_activations VALUES (?,?,?,?,?,?,?)', params);
}
