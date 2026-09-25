// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectOutboundResultsMessageIdRecipientByAccountIdRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT message_id,recipient FROM outbound_results WHERE account_id=? AND request_id=?',params);}
export function insertOutboundResults(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO outbound_results(account_id,request_id,message_id,recipient) VALUES (?,?,?,?)',params);}
