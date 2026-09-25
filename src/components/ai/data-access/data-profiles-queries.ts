// Query tabel ai_data_profiles untuk komponen ai. Dipanggil lewat namespace, misalnya
// `dataProfilesSql.lockFaq(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockFaq(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT profil_faq,profile_type FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE',
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM ai_data_profiles WHERE id=? AND account_id=?', params);
}
export function lockType(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT profile_type FROM ai_data_profiles WHERE id=? AND account_id=? FOR UPDATE',
    params,
  );
}
export function bumpRevision(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_data_profiles SET revision=revision+1 WHERE id=?', params);
}
export function findEduContent(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT edu_lembaga,edu_jadwal,profil_faq FROM ai_data_profiles WHERE id=? AND account_id=? AND profile_type='pendidikan'",
    params,
  );
}
export function updateFaq(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_data_profiles SET profil_faq=?,revision=revision+1 WHERE id=? AND account_id=?', params);
}
export function lockNamesByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT name FROM ai_data_profiles WHERE account_id=? FOR UPDATE', params);
}
export function countByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ai_data_profiles WHERE account_id=?', params);
}
export function insert(
  c: Executor,
  params: SqlValue[],
  columns: string[],
  edu: { edu_lembaga: string; edu_jadwal: string },
) {
  return c.execute(
    `INSERT INTO ai_data_profiles(id,account_id,profile_type,name,behavior,fallback_number,fallback_notify,${columns.join(',')},${Object.keys(edu).join(',')}) VALUES (?,?,?,?,?,?,?,${columns.map(() => '?').join(',')},${Object.keys(
      edu,
    )
      .map(() => '?')
      .join(',')})`,
    params,
  );
}
export function findType(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT profile_type FROM ai_data_profiles WHERE id=? AND account_id=?', params);
}
export function listWithCounts(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.id,p.profile_type,p.name,p.updated_at,(SELECT COUNT(*) FROM ai_products x WHERE x.data_profile_id=p.id) AS products,(SELECT COUNT(*) FROM ai_orders o WHERE o.data_profile_id=p.id) AS orders,(SELECT COUNT(*) FROM ai_edu_programs e WHERE e.data_profile_id=p.id) AS programs,(SELECT COUNT(*) FROM ai_edu_documents e WHERE e.data_profile_id=p.id) AS documents,(SELECT COUNT(*) FROM ai_edu_contacts e WHERE e.data_profile_id=p.id) AS contacts FROM ai_data_profiles p WHERE p.account_id=? ORDER BY p.name',
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
export function updateEduField(
  c: Executor,
  params: SqlValue[],
  spec:
    | { readonly column: 'edu_lembaga'; readonly max: 4000; readonly label: 'Profil lembaga' }
    | { readonly column: 'edu_jadwal'; readonly max: 8000; readonly label: 'Jadwal' },
) {
  return c.execute(
    `UPDATE ai_data_profiles SET ${spec.column}=?,revision=revision+1 WHERE id=? AND account_id=?`,
    params,
  );
}
export function updateProfileField(c: Executor, params: SqlValue[], field: string) {
  return c.execute(
    `UPDATE ai_data_profiles SET profil_${field}=?,revision=revision+1 WHERE id=? AND account_id=?`,
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
export function findTypeById(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT profile_type FROM ai_data_profiles WHERE id=?', params);
}
export function updateContent(c: Executor, params: SqlValue[], profileColumns: string[]) {
  return c.execute(
    `UPDATE ai_data_profiles SET behavior=?,fallback_number=?,fallback_notify=?,revision=revision+1,${profileColumns.map(column => column + '=?').join(',')} WHERE id=? AND account_id=?`,
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
