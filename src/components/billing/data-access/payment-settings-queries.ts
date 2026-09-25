// Query tabel payment_settings untuk komponen billing. Dipanggil lewat namespace, misalnya
// `paymentSettingsSql.setActiveConfig(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function setActiveConfig(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO payment_settings VALUES (1,?) ON DUPLICATE KEY UPDATE config_id=VALUES(config_id)',
    params,
  );
}
