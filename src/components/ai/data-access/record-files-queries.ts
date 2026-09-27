// File field File/gambar koleksi profil; semua query dibatasi akun dan data profil.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
const columns = 'id,record_id,filename,mimetype,media_type,size_bytes';
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_record_files(id,account_id,data_profile_id,record_id,filename,mimetype,media_type,size_bytes) VALUES (?,?,?,?,?,?,?,?)',
    p,
  );
}
export function find(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT ${columns} FROM ai_record_files WHERE account_id=? AND data_profile_id=? AND id=?`,
    p,
  );
}
export function lock(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT ${columns} FROM ai_record_files WHERE account_id=? AND data_profile_id=? AND id=? FOR UPDATE`,
    p,
  );
}
export function listByIds(c: Executor, account: string, profile: string, ids: string[]) {
  if (!ids.length) return Promise.resolve([[] as RowDataPacket[]] as const);
  return c.query<RowDataPacket[]>(
    `SELECT ${columns} FROM ai_record_files WHERE account_id=? AND data_profile_id=? AND id IN (?)`,
    [account, profile, ids],
  );
}
export function listByRecord(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT ${columns} FROM ai_record_files WHERE account_id=? AND data_profile_id=? AND record_id=? FOR UPDATE`,
    p,
  );
}
export function attach(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_record_files SET record_id=? WHERE account_id=? AND data_profile_id=? AND id=?', p);
}
export function deleteById(c: Executor, p: SqlValue[]) {
  return c.execute('DELETE FROM ai_record_files WHERE account_id=? AND data_profile_id=? AND id=?', p);
}
export function sumBytes(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM ai_record_files WHERE account_id=? AND data_profile_id=?',
    p,
  );
}
// Unggahan yang tidak pernah disimpan ke record (misalnya formulir dibatalkan) dibersihkan setelah sehari.
export function lockStalePending(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM ai_record_files WHERE account_id=? AND record_id IS NULL AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) FOR UPDATE',
    p,
  );
}
export function deleteStalePending(c: Executor, p: SqlValue[]) {
  return c.execute(
    'DELETE FROM ai_record_files WHERE account_id=? AND record_id IS NULL AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)',
    p,
  );
}
export function listByProfile(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT ${columns} FROM ai_record_files WHERE account_id=? AND data_profile_id=?`,
    p,
  );
}
