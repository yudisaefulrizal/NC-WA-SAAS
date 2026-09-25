// Query tabel ai_wallets untuk komponen billing. Dipanggil lewat namespace, misalnya
// `aiWalletsSql.addBalance(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function addBalance(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_wallets VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',
    params,
  );
}
