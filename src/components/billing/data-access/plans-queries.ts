// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function lockAccountsIdById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? FOR UPDATE',params);}
export function lockWalletsByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT * FROM wallets WHERE account_id=? FOR UPDATE',params);}
export function selectPlansCreditsSessionLimit(c:Executor){return c.query<RowDataPacket[]>("SELECT credits,session_limit FROM plans WHERE id='basic'");}
export function insertIgnoreCreditEvents(c:Executor,params:SqlValue[]){return c.execute("INSERT IGNORE INTO credit_events (account_id,period,reason,amount) VALUES (?,?,'basic_grant',?)",params);}
export function selectCreditEventsByAccountIdPeriod(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS credits FROM credit_events WHERE account_id=? AND period=? AND reason IN ('basic_grant','basic_transfer')",params);}
export function countUsedReservations(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COUNT(*) AS used FROM credit_reservations WHERE account_id=? AND period=? AND status<>'failed'",params);}
export function upsertWallets(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO wallets (account_id,period,balance,quota,session_limit,plan_id,expires_at) VALUES (?,?,?,?,?,'basic',NULL) ON DUPLICATE KEY UPDATE period=VALUES(period),balance=VALUES(balance),quota=VALUES(quota),session_limit=VALUES(session_limit),plan_id='basic',expires_at=NULL",params);}
export function selectWalletsByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT period,balance,quota,session_limit,plan_id,expires_at FROM wallets WHERE account_id=?',params);}
export function selectPackageActivationsIdById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM package_activations WHERE id=?',params);}
export function countOpenReservations(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_reservations WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",params);}
export function upsertCreditEvents(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO credit_events(account_id,period,reason,amount) VALUES (?,?,'basic_transfer',?) ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount)",params);}
export function updateCreditReservationsPeriodByAccountIdPeriod(c:Executor,params:SqlValue[]){return c.execute("UPDATE credit_reservations SET period=? WHERE account_id=? AND period=? AND status IN ('reserved','unknown')",params);}
export function insertPackageActivations(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO package_activations VALUES (?,?,?,?,?,?,?)',params);}
export function updateWalletsPeriodByAccountId(c:Executor,params:SqlValue[]){return c.execute('UPDATE wallets SET period=?,balance=balance+?,quota=?,session_limit=?,plan_id=?,expires_at=? WHERE account_id=?',params);}
