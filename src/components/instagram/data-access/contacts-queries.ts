// Query tabel instagram_contacts: nama dan @username pelanggan Instagram untuk tampilan Percakapan.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO instagram_contacts(account_id,session_id,customer,username,name) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE username=IF(VALUES(username)='',username,VALUES(username)),name=IF(VALUES(name)='',name,VALUES(name))",
    params,
  );
}
export function listBySession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT customer,username,name FROM instagram_contacts WHERE account_id=? AND session_id=? ORDER BY updated_at DESC LIMIT 5000',
    params,
  );
}
export function deleteBySession(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM instagram_contacts WHERE account_id=? AND session_id=?', params);
}
