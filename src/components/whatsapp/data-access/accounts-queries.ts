// Query tabel accounts untuk komponen whatsapp. Dipanggil lewat namespace, misalnya
// `accountsSql.lock(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE', params);
}
