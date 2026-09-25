// Query tabel ai_edu_programs untuk komponen ai. Dipanggil lewat namespace, misalnya
// `eduProgramsSql.listByProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,name,description FROM ai_edu_programs WHERE account_id=? AND data_profile_id=? ORDER BY position,created_at,id',
    params,
  );
}
export function findOtherWithName(c: Executor, params: SqlValue[], id: string | null) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM ai_edu_programs WHERE data_profile_id=? AND name=?' + (id ? ' AND id<>?' : ''),
    params,
  );
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'UPDATE ai_edu_programs SET name=?,description=? WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function countAndLastPosition(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n,COALESCE(MAX(position),0) AS last FROM ai_edu_programs WHERE data_profile_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_edu_programs(id,account_id,data_profile_id,name,description,position) VALUES (?,?,?,?,?,?)',
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'DELETE FROM ai_edu_programs WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function copyToProfile(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_edu_programs(id,account_id,data_profile_id,name,description,position) SELECT UUID(),account_id,?,name,description,position FROM ai_edu_programs WHERE account_id=? AND data_profile_id=?',
    params,
  );
}
