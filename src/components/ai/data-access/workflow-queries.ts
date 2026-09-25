// Query tabel ai_workflow untuk komponen ai. Dipanggil lewat namespace, misalnya
// `workflowSql.listStates(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listStates(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT profile_type,revision,active_version,published_revision FROM ai_workflow');
}
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_workflow WHERE profile_type=?', params);
}
export function findActive(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT active FROM ai_workflow WHERE profile_type=?', params);
}
export function ensure(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT IGNORE INTO ai_workflow(profile_type,draft,tool_defaults_version,layanan_merge_version,profil_perusahaan_rename_version,profil_perusahaan_narrow_version) VALUES (?,?,2,1,1,1)',
    params,
  );
}
export function lockRevision(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT revision FROM ai_workflow WHERE profile_type=? FOR UPDATE', params);
}
export function publish(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_workflow SET active=draft,active_version=active_version+1,published_revision=revision WHERE profile_type=?',
    params,
  );
}
export function saveDraft(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_workflow SET draft=?,revision=revision+1 WHERE profile_type=?', params);
}
