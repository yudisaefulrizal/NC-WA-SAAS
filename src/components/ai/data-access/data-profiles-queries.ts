// Query tabel ai_data_profiles untuk komponen ai. Dipanggil lewat namespace, misalnya
// `dataProfilesSql.findOwned(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=?', params);
}
export function countByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ai_data_profiles WHERE account_id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_data_profiles(id,account_id,profile_type,name,behavior,fallback_number,fallback_notify) VALUES (?,?,?,?,?,?,?)',
    params,
  );
}
export function listWithCounts(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.id,p.profile_type,p.name,p.updated_at,(SELECT COUNT(*) FROM ai_data_records r WHERE r.data_profile_id=p.id) AS records FROM ai_data_profiles p WHERE p.account_id=? ORDER BY p.name',
    params,
  );
}
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_data_profiles WHERE id=? AND account_id=?', params);
}
export function share(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_data_profiles WHERE id=? AND account_id=? FOR SHARE', params);
}
export function lockByName(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE account_id=? AND name=? FOR UPDATE', params);
}
export function lockOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE', params);
}
export function findOtherWithName(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE account_id=? AND name=? AND id<>?', params);
}
export function rename(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_data_profiles SET name=? WHERE id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_data_profiles WHERE id=? AND account_id=?', params);
}
export function shareSummary(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,name,profile_type FROM ai_data_profiles WHERE id=? AND account_id=? FOR SHARE',
    params,
  );
}
export function updateBehavior(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_data_profiles SET behavior=?,revision=revision+1 WHERE id=? AND account_id=?', params);
}
export function findFallback(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT fallback_number,fallback_notify FROM ai_data_profiles WHERE id=? AND account_id=?',
    params,
  );
}
export function updateFallback(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_data_profiles SET fallback_number=?,fallback_notify=?,revision=revision+1 WHERE id=? AND account_id=?',
    params,
  );
}
export function listTypesByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT DISTINCT profile_type FROM ai_data_profiles WHERE account_id=?', params);
}
export function countPerType(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT p.profile_type,COUNT(DISTINCT p.id) AS data_profiles,COUNT(a.session_id) AS sessions FROM ai_data_profiles p LEFT JOIN ai_assistants a ON a.data_profile_id=p.id GROUP BY p.profile_type',
  );
}
// Semua data profil (semua akun) yang memakai satu profil AI; dipakai hapus paksa oleh pemilik.
export function listByType(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,account_id FROM ai_data_profiles WHERE profile_type=? ORDER BY account_id,id',
    params,
  );
}
