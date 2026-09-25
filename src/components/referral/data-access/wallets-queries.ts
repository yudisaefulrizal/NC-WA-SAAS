// Query tabel wallets untuk komponen referral. Dipanggil lewat namespace, misalnya
// `walletsSql.addBalance(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function addBalance(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?', params);
}
