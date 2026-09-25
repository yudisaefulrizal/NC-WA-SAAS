// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function lockAccountsIdById(c:Executor,params:SqlValue[]){return c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',params);}
export function selectLoginSessionsAccountIdByTokenHashAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT account_id FROM login_sessions WHERE token_hash=? AND account_id=? AND expires_at>UTC_TIMESTAMP()',params);}
export function selectApiKeysIdKeyHashByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,key_hash FROM api_keys WHERE account_id=?',params);}
export function deleteApiKeysByAccountIdId(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM api_keys WHERE account_id=? AND id=?',params);}
export function insertApiKeys(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',params);}
export function insertAuditEvents(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',params);}
