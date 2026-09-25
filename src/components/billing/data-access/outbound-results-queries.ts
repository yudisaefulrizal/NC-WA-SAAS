// Query tabel outbound_results untuk komponen billing. Dipanggil lewat namespace, misalnya
// `outboundResultsSql.findRequest(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT message_id,recipient FROM outbound_results WHERE account_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO outbound_results(account_id,request_id,message_id,recipient) VALUES (?,?,?,?)', params);
}
