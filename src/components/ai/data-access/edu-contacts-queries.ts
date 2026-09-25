// Query tabel ai_edu_contacts untuk komponen ai. Dipanggil lewat namespace, misalnya
// `eduContactsSql.listByProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,bagian,kontak,deskripsi FROM ai_edu_contacts WHERE account_id=? AND data_profile_id=? ORDER BY position,created_at,id',
    params,
  );
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'UPDATE ai_edu_contacts SET bagian=?,kontak=?,deskripsi=? WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function countAndLastPosition(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n,COALESCE(MAX(position),0) AS last FROM ai_edu_contacts WHERE data_profile_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_edu_contacts(id,account_id,data_profile_id,bagian,kontak,deskripsi,position) VALUES (?,?,?,?,?,?,?)',
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'DELETE FROM ai_edu_contacts WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function copyToProfile(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_edu_contacts(id,account_id,data_profile_id,bagian,kontak,deskripsi,position) SELECT UUID(),account_id,?,bagian,kontak,deskripsi,position FROM ai_edu_contacts WHERE account_id=? AND data_profile_id=?',
    params,
  );
}
