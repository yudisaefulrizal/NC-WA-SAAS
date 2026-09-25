// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectRecentUsage(c:Executor,params:SqlValue[]){return c.execute('SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC LIMIT 100',params);}
export function countUsageByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_usage WHERE account_id=?',params);}
export function selectUsagePage(c:Executor,params:SqlValue[],size:number,page:number){return c.execute('SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC,request_id DESC LIMIT '+size+' OFFSET '+((page-1)*size),params);}
export function selectAdjustmentsAmountReasonByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT amount,reason FROM ai_adjustments WHERE account_id=? AND request_id=?',params);}
export function insertAdjustments(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO ai_adjustments(account_id,request_id,actor_id,amount,reason) VALUES (?,?,?,?,?)',params);}
export function insertAuditEvent(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',params);}
