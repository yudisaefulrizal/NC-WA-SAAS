// Query tabel accounts untuk komponen account. Dipanggil lewat namespace, misalnya
// `accountsSql.findSuspended(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findSuspended(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=?', params);
}
export function findActive(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? AND suspended=FALSE', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)', params);
}
export function findLoginByEmail(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id,password_hash FROM accounts WHERE email=? AND suspended=FALSE', params);
}
export function lockPasswordHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT password_hash FROM accounts WHERE id=? FOR UPDATE', params);
}
export function updatePasswordHash(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE accounts SET password_hash=? WHERE id=?', params);
}
export function listLatest(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT id,email,role,suspended,created_at FROM accounts ORDER BY created_at DESC LIMIT 100',
  );
}
export function lockRole(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT role FROM accounts WHERE id=? FOR UPDATE', params);
}
export function updateSuspended(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE accounts SET suspended=? WHERE id=?', params);
}
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE', params);
}
