// Mencari akun pemilik sebuah API key atau token sesi login, untuk aliran event dan rute sesi. Dipanggil
// lewat `accessSql.findAccountIdByKeyOrToken(db, [hash], key)`.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findAccountIdByKeyOrToken(c: Executor, params: SqlValue[], key: string | undefined) {
  return c.execute<RowDataPacket[]>(
    key
      ? 'SELECT k.account_id FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE'
      : 'SELECT s.account_id FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',
    params,
  );
}
