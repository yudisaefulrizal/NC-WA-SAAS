// Query tabel audit_events untuk komponen referral. Dipanggil lewat namespace, misalnya
// `auditEventsSql.insertSettingsUpdated(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insertSettingsUpdated(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_settings_updated')", params);
}
export function insertRedeemed(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_redeemed')", params);
}
export function insertQualified(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_qualified')", params);
}
export function insertPayoutRequested(c: Executor, params: SqlValue[]) {
  return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_payout_requested')", params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)', params);
}
