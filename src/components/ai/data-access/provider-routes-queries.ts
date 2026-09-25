// Query tabel ai_provider_routes untuk komponen ai. Dipanggil lewat namespace, misalnya
// `providerRoutesSql.listWithProfiles(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listWithProfiles(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT r.tier,p.* FROM ai_provider_routes r JOIN ai_provider_profiles p ON p.id=r.profile_id WHERE p.active=TRUE',
  );
}
export function listAll(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT tier,profile_id FROM ai_provider_routes');
}
export function listTiersOfProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT tier FROM ai_provider_routes WHERE profile_id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_provider_routes(tier,profile_id,model) VALUES (?,?,?) ON DUPLICATE KEY UPDATE profile_id=VALUES(profile_id),model=VALUES(model)',
    params,
  );
}
