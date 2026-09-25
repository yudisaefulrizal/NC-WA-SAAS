// Query tabel credit_events untuk komponen billing. Dipanggil lewat namespace, misalnya
// `creditEventsSql.insertBasicGrant(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insertBasicGrant(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT IGNORE INTO credit_events (account_id,period,reason,amount) VALUES (?,?,'basic_grant',?)",
    params,
  );
}
export function sumBasicCredits(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COALESCE(SUM(amount),0) AS credits FROM credit_events WHERE account_id=? AND period=? AND reason IN ('basic_grant','basic_transfer')",
    params,
  );
}
export function upsertBasicTransfer(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO credit_events(account_id,period,reason,amount) VALUES (?,?,'basic_transfer',?) ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount)",
    params,
  );
}
