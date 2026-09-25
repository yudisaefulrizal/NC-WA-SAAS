// Query tabel ai_message_origins untuk komponen ai. Dipanggil lewat namespace, misalnya
// `messageOriginsSql.insertSystem(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insertSystem(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_message_origins(account_id,session_id,message_id,origin) VALUES (?,?,?,'system')",
    params,
  );
}
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT origin FROM ai_message_origins WHERE account_id=? AND session_id=? AND message_id=?',
    params,
  );
}
export function insertManual(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_message_origins(account_id,session_id,message_id,origin) VALUES (?,?,?,'manual')",
    params,
  );
}
