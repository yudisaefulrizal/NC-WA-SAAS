// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectCreditReservationsStatusPayloadHashByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT status,payload_hash FROM credit_reservations WHERE account_id=? AND request_id=?',params);}
export function debitWalletOneCredit(c:Executor,params:SqlValue[]){return c.execute('UPDATE wallets SET balance=balance-1 WHERE account_id=?',params);}
export function insertCreditReservations(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO credit_reservations (account_id,request_id,payload_hash,period) VALUES (?,?,?,?)',params);}
export function lockCreditReservationsStatusPeriodByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT status,period FROM credit_reservations WHERE account_id=? AND request_id=? FOR UPDATE',params);}
export function refundWalletOneCredit(c:Executor,params:SqlValue[]){return c.execute('UPDATE wallets SET balance=balance+1 WHERE account_id=?',params);}
export function updateCreditReservationsStatusByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute('UPDATE credit_reservations SET status=? WHERE account_id=? AND request_id=?',params);}
export function selectCreditReservationsPeriodStatusByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT period,status FROM credit_reservations WHERE account_id=? AND request_id=?',params);}
export function updateCreditReservationsStatusByAccountId(c:Executor,params:SqlValue[],accountId:string | undefined){return c.execute("UPDATE credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id SET r.status=IF(o.message_id IS NULL,'unknown','sent') WHERE r.status IN ('reserved','unknown')"+(accountId?' AND r.account_id=?':''),params);}
