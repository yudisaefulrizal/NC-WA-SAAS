// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectAccountsSuspendedById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=?',params);}
export function selectApiKeysIdByKeyHash(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT k.account_id AS id FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',params);}
export function selectLoginSessionsIdByTokenHash(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT s.account_id AS id FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',params);}
export function selectAccountsIdById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? AND suspended=FALSE',params);}
