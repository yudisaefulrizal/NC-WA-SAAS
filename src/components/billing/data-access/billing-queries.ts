// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {ResultSetHeader,RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectPublicPlans(c:Executor){return c.query('SELECT id,name,price,credits,session_limit FROM plans WHERE active=TRUE');}
export function selectCreditReservationsByAccountId(c:Executor,params:SqlValue[]){return c.execute('SELECT r.request_id,r.status,r.created_at,o.message_id FROM credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id WHERE r.account_id=? ORDER BY r.created_at DESC LIMIT 100',params);}
export function selectActivePlans(c:Executor){return c.query('SELECT * FROM plans WHERE active=TRUE');}
export function selectCreditAdjustmentsAmountReasonByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT amount,reason FROM credit_adjustments WHERE account_id=? AND request_id=?',params);}
export function updateWalletsBalanceByAccountId(c:Executor,params:SqlValue[]){return c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?',params);}
export function insertCreditAdjustments(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO credit_adjustments(account_id,request_id,actor_id,amount,reason) VALUES (?,?,?,?,?)',params);}
export function insertAuditEvent(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',params);}
export function selectAllPlans(c:Executor){return c.query('SELECT * FROM plans');}
export function deletePlansById(c:Executor,params:SqlValue[]){return c.execute<ResultSetHeader>('DELETE FROM plans WHERE id=?',params);}
export function upsertPlans(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),credits=VALUES(credits),session_limit=VALUES(session_limit),active=VALUES(active),max_share_assets=VALUES(max_share_assets),max_share_storage_bytes=VALUES(max_share_storage_bytes)',params);}
// All payments page for the owner: count, then one page of orders with the account email.
export const paymentsPage={count:'SELECT COUNT(*) AS total FROM payment_orders',items:(size:number,offset:number)=>'SELECT p.id,p.account_id,a.email AS account_email,p.plan_name,p.total,p.status,p.environment,p.created_at FROM payment_orders p LEFT JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT '+size+' OFFSET '+offset};
