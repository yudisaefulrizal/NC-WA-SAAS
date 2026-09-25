// Query tabel plans untuk komponen account. Dipanggil lewat namespace, misalnya
// `plansSql.listNames(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../../../libraries/db.js';
export function listNames(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT id,name FROM plans');
}
