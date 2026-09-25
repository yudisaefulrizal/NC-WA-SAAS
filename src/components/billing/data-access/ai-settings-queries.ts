// Query tabel ai_settings untuk komponen billing. Dipanggil lewat namespace, misalnya
// `aiSettingsSql.shareCreditPrice(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../../../libraries/db.js';
export function shareCreditPrice(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT credit_price FROM ai_settings WHERE id=1 FOR SHARE');
}
