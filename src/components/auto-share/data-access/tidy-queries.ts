// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function insertIgnoreAiWallets(c:Executor,params:SqlValue[]){return c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',params);}
export function lockAiWalletsBalanceByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=? FOR UPDATE',params);}
export function debitAIWallet(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?',params);}
export function insertAiUsage(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,agent) VALUES (?,?,'auto-share','share','generating',?,?,?,?,?,'rapikan')",params);}
export function creditAIWallet(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',params);}
export function updateAiUsageStatusByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_usage SET status=?,output_words=?,charged=? WHERE account_id=? AND request_id=?',params);}
