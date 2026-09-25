// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function insertAccounts(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)',params);}
export function selectAccountsIdPasswordHashByEmail(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,password_hash FROM accounts WHERE email=? AND suspended=FALSE',params);}
export function insertLoginSessions(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))',params);}
export function selectApiKeysIdEmailByKeyHash(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT a.id,a.email FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',params);}
export function selectLoginSessionsByTokenHash(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT a.id,a.email,a.role FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',params);}
export function deleteLoginSessionsByTokenHash(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM login_sessions WHERE token_hash=?',params);}
export function lockAccountsPasswordHashById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT password_hash FROM accounts WHERE id=? FOR UPDATE',params);}
export function updateAccountsPasswordHashById(c:Executor,params:SqlValue[]){return c.execute('UPDATE accounts SET password_hash=? WHERE id=?',params);}
export function deleteLoginSessionsByAccountIdTokenHash(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM login_sessions WHERE account_id=? AND token_hash<>?',params);}
export function insertPasswordChangedAudit(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'password_changed_self')",params);}
export function selectApiKeysIdCreatedAtByAccountId(c:Executor,params:SqlValue[]){return c.execute('SELECT id,created_at FROM api_keys WHERE account_id=?',params);}
export function selectApiKeysKeyHashByIdAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT key_hash FROM api_keys WHERE id=? AND account_id=?',params);}
export function deleteApiKeysByIdAccountId(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM api_keys WHERE id=? AND account_id=?',params);}
export function selectAccounts(c:Executor){return c.query<RowDataPacket[]>('SELECT id,email,role,suspended,created_at FROM accounts ORDER BY created_at DESC LIMIT 100');}
export function selectPlansIdName(c:Executor){return c.query<RowDataPacket[]>('SELECT id,name FROM plans');}
export function selectRows(c:Executor){return c.query('SELECT 1');}
export function lockAccountsRoleById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT role FROM accounts WHERE id=? FOR UPDATE',params);}
export function updateAccountsSuspendedById(c:Executor,params:SqlValue[]){return c.execute('UPDATE accounts SET suspended=? WHERE id=?',params);}
export function insertAuditEvent(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',params);}
export function deleteLoginSessionsByAccountId(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM login_sessions WHERE account_id=?',params);}
// Audit log page for the owner: count, then one page of events with the account email.
export const auditPage={count:'SELECT COUNT(*) AS total FROM audit_events',items:(size:number,offset:number)=>'SELECT e.id,e.account_id,a.email AS account_email,e.action,e.created_at FROM audit_events e LEFT JOIN accounts a ON a.id=e.account_id ORDER BY e.id DESC LIMIT '+size+' OFFSET '+offset};
