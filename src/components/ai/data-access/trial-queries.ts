// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function lockWalletsBalanceByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=? FOR UPDATE',params);}
export function insertTrialUsage(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,profile_type,data_profile_id) VALUES (?,?,?,'trial','generating',?,?,?,?,?,?,?)",params);}
export function finishTrialUsage(c:Executor,params:SqlValue[]){return c.execute("UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,reserved=0 WHERE account_id=? AND request_id=?",params);}
