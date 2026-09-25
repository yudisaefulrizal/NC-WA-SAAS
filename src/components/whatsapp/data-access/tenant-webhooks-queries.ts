// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectWebhookSubscriptionsByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,url,session_id AS sessionId FROM webhook_subscriptions WHERE account_id=?',params);}
export function lockAccountsIdById(c:Executor,params:SqlValue[]){return c.execute('SELECT id FROM accounts WHERE id=? FOR UPDATE',params);}
export function insertWebhookSubscriptions(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO webhook_subscriptions(id,account_id,url,session_id) VALUES (?,?,?,?)',params);}
export function selectWebhookSubscriptionsIdByAccountIdId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM webhook_subscriptions WHERE account_id=? AND id=?',params);}
export function deleteWebhookSubscriptionsByAccountIdId(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM webhook_subscriptions WHERE account_id=? AND id=?',params);}
export function countWebhookDeliveriesByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM webhook_deliveries WHERE account_id=?',params);}
export function selectWebhookSubscriptionsIdByAccountIdSessionId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM webhook_subscriptions WHERE account_id=? AND (session_id IS NULL OR session_id=?)',params);}
export function insertWebhookDeliveries(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO webhook_deliveries(id,account_id,subscription_id,payload) VALUES (?,?,?,?)',params);}
export function deleteWebhookDeliveriesByAccountId(c:Executor,params:SqlValue[],accountScope:string | undefined){return c.execute('DELETE FROM webhook_deliveries WHERE created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)'+(accountScope?' AND account_id=?':''),params);}
export function selectWebhookDeliveries(c:Executor,params:SqlValue[],accountScope:string | undefined){return c.query<RowDataPacket[]>(`SELECT d.id,d.account_id,d.payload,d.attempts,s.url FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.next_at<=UTC_TIMESTAMP() ${accountScope?'AND d.account_id=?':''} AND d.id=(SELECT d2.id FROM webhook_deliveries d2 WHERE d2.account_id=d.account_id AND d2.next_at<=UTC_TIMESTAMP() ORDER BY d2.created_at,d2.id LIMIT 1) ORDER BY d.next_at LIMIT 4`,params);}
export function deleteWebhookDeliveriesById(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM webhook_deliveries WHERE id=?',params);}
export function updateWebhookDeliveriesAttemptsById(c:Executor,params:SqlValue[]){return c.execute('UPDATE webhook_deliveries SET attempts=?,next_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE id=?',params);}
