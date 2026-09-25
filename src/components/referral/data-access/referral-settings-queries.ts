// Query tabel referral_settings untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralSettingsSql.find(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT enabled,commission_percent,referrer_signup_wa_credits,referrer_signup_ai_credits,referee_signup_wa_credits,referee_signup_ai_credits,min_payout_amount FROM referral_settings WHERE id=1',
  );
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE referral_settings SET enabled=?,commission_percent=?,referrer_signup_wa_credits=?,referrer_signup_ai_credits=?,referee_signup_wa_credits=?,referee_signup_ai_credits=?,min_payout_amount=? WHERE id=1',
    params,
  );
}
