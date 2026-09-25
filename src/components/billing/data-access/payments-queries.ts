// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectPaymentConfig(c:Executor){return c.query<RowDataPacket[]>('SELECT c.id,c.environment,c.created_at FROM payment_config c JOIN payment_settings s ON s.config_id=c.id WHERE s.id=1');}
export function insertPaymentConfig(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO payment_config(id,environment,secret) VALUES (?,?,?)',params);}
export function upsertPaymentSettings(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO payment_settings VALUES (1,?) ON DUPLICATE KEY UPDATE config_id=VALUES(config_id)',params);}
export function insertAuditEvents(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'payment_config_rotated')",params);}
export function selectPaymentConfigById(c:Executor,params:SqlValue[],id:string | undefined){return c.execute<RowDataPacket[]>(id?'SELECT * FROM payment_config WHERE id=?':'SELECT c.* FROM payment_config c JOIN payment_settings s ON c.id=s.config_id WHERE s.id=1',params);}
export function selectRecentPaymentOrders(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,kind,credits,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? ORDER BY created_at DESC LIMIT 100',params);}
export function selectPaymentOrdersByAccountIdId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,kind,credits,plan_id,plan_name,price,fee,total,status,environment,created_at,activated_at,expires_at,qr_url FROM payment_orders WHERE account_id=? AND id=?',params);}
export function shareAiSettingsCreditPrice(c:Executor){return c.query<RowDataPacket[]>('SELECT credit_price FROM ai_settings WHERE id=1 FOR SHARE');}
export function selectPaymentOrdersIdByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT id FROM payment_orders WHERE account_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP() LIMIT 1",params);}
export function lockAccountsIdById(c:Executor,params:SqlValue[]){return c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',params);}
export function selectOpenPaymentOrder(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT id,plan_id,kind FROM payment_orders WHERE account_id=? AND status IN ('creating','pending','unknown') LIMIT 1",params);}
export function sharePlansById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT * FROM plans WHERE id=? AND active=TRUE AND price>0 FOR SHARE',params);}
export function insertPaymentOrders(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO payment_orders(id,account_id,plan_id,plan_name,price,fee,total,credits,session_limit,config_id,environment,kind) VALUES (?,?,?,?,?,0,?,?,?,?,?,?)',params);}
export function markPaymentDenied(c:Executor,params:SqlValue[]){return c.execute("UPDATE payment_orders SET status='deny' WHERE id=? AND status='creating'",params);}
export function markPaymentUnknown(c:Executor,params:SqlValue[]){return c.execute("UPDATE payment_orders SET status='unknown' WHERE id=? AND status='creating'",params);}
export function selectPaymentOrdersById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=?',params);}
export function markStalePaymentChecked(c:Executor,params:SqlValue[]){return c.execute("UPDATE payment_orders SET checked_at=UTC_TIMESTAMP(),status=IF(created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),'not_found',status) WHERE id=? AND status IN ('creating','unknown')",params);}
export function lockPaymentOrdersById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT * FROM payment_orders WHERE id=? FOR UPDATE',params);}
export function upsertAiWallets(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO ai_wallets VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',params);}
export function updatePaymentOrdersActivatedAtById(c:Executor,params:SqlValue[]){return c.execute('UPDATE payment_orders SET activated_at=UTC_TIMESTAMP() WHERE id=?',params);}
export function updatePaymentFromGateway(c:Executor,params:SqlValue[]){return c.execute('UPDATE payment_orders SET status=?,transaction_id=?,qr_url=?,expires_at=?,checked_at=UTC_TIMESTAMP() WHERE id=?',params);}
export function selectPaymentOrdersId(c:Executor){return c.query<RowDataPacket[]>("SELECT id FROM payment_orders WHERE status IN ('creating','pending','unknown') AND (checked_at IS NULL OR checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)) ORDER BY COALESCE(checked_at,created_at) LIMIT 10");}
export function touchPaymentCheckedAt(c:Executor,params:SqlValue[]){return c.execute('UPDATE payment_orders SET checked_at=UTC_TIMESTAMP() WHERE id=?',params);}
