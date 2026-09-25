// Query tabel ai_edu_documents untuk komponen ai. Dipanggil lewat namespace, misalnya
// `eduDocumentsSql.listByProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,filename,mimetype,media_type,size_bytes,description,created_at FROM ai_edu_documents WHERE account_id=? AND data_profile_id=? ORDER BY position,created_at,id',
    params,
  );
}
export function countUsage(c: Executor, params: SqlValue[], replacing: string | undefined) {
  return c.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n,COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(MAX(position),0) AS last FROM ai_edu_documents WHERE data_profile_id=?' +
      (replacing ? ' AND id<>?' : ''),
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_edu_documents(id,account_id,data_profile_id,filename,mimetype,media_type,size_bytes,description,position) VALUES (?,?,?,?,?,?,?,?,?)',
    params,
  );
}
export function lockFile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT file_id FROM ai_edu_documents WHERE id=? AND account_id=? AND data_profile_id=? FOR UPDATE',
    params,
  );
}
export function replaceFile(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_edu_documents SET file_id=?,filename=?,mimetype=?,media_type=?,size_bytes=? WHERE id=?',
    params,
  );
}
export function updateDescription(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    'UPDATE ai_edu_documents SET description=? WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function deleteById(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_edu_documents WHERE id=?', params);
}
export function findOwned(c: Executor, params: SqlValue[], profile: string | undefined) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,file_id,filename,mimetype,media_type FROM ai_edu_documents WHERE id=? AND account_id=?' +
      (profile ? ' AND data_profile_id=?' : ''),
    params,
  );
}
export function listForCopy(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_edu_documents WHERE account_id=? AND data_profile_id=? ORDER BY position',
    params,
  );
}
export function listFiles(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COALESCE(file_id,id) AS file FROM ai_edu_documents WHERE account_id=? AND data_profile_id=?',
    params,
  );
}
