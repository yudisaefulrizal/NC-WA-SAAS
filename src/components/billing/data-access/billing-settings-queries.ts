// Query tabel billing_settings (satu baris, id=1): pengaturan harga milik pemilik. Dipanggil lewat namespace, misalnya
// `billingSettingsSql.find(db)`.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT wa_credit_price FROM billing_settings WHERE id=1');
}
export function shareWaCreditPrice(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT wa_credit_price FROM billing_settings WHERE id=1 FOR SHARE');
}
export function updateWaCreditPrice(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO billing_settings (id,wa_credit_price) VALUES (1,?) ON DUPLICATE KEY UPDATE wa_credit_price=VALUES(wa_credit_price)',
    params,
  );
}
