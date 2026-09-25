// Query tabel auto_share_jobs untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `jobsSql.lockOwned(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=? FOR UPDATE', params);
}
export function updateRotation(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE auto_share_jobs SET rotation_index=? WHERE id=?', params);
}
export function listTemplateIds(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT template_ids FROM auto_share_jobs WHERE account_id=?', params);
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM auto_share_jobs WHERE account_id=? ORDER BY created_at DESC',
    params,
  );
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE auto_share_jobs SET name=?,session_id=?,contacts=?,groups_json=?,template_ids=?,rotation_index=?,enabled=?,next_at=?,interval_minutes=? WHERE account_id=? AND id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO auto_share_jobs(name,session_id,contacts,groups_json,template_ids,rotation_index,enabled,next_at,interval_minutes,account_id,id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM auto_share_jobs WHERE account_id=? AND id=?', params);
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM auto_share_jobs WHERE account_id=? AND id=?', params);
}
export function listDue(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT t.id,t.account_id FROM auto_share_jobs t JOIN accounts a ON a.id=t.account_id WHERE t.enabled=TRUE AND t.next_at<=UTC_TIMESTAMP(3) AND a.suspended=FALSE ORDER BY t.next_at LIMIT 100',
  );
}
export function updateSchedule(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE auto_share_jobs SET next_at=?,enabled=? WHERE id=?', params);
}
