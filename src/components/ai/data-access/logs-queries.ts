// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectUsage(c:Executor){return c.query('SELECT account_id,session_id,request_id,status,agent,model_calls,created_at FROM ai_usage ORDER BY created_at DESC LIMIT 100');}
export function countAgentFailures(c:Executor){return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_agent_failures');}
export function selectAgentFailures(c:Executor,size:number,page:number){return c.query('SELECT id,account_id,session_id,request_id,agent,error,message,model,created_at FROM ai_agent_failures ORDER BY created_at DESC,id DESC LIMIT '+size+' OFFSET '+((page-1)*size));}
export function selectAgentFailuresById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT prompt,raw_output,router_context FROM ai_agent_failures WHERE id=?',params);}
export function countTraceRequests(c:Executor){return c.execute<RowDataPacket[]>('SELECT COUNT(DISTINCT request_id) AS total FROM ai_trace_log');}
export function selectTraceRequestsPage(c:Executor,size:number,page:number){return c.query('SELECT request_id,account_id,session_id,MIN(created_at) AS started_at,COUNT(*) AS event_count FROM ai_trace_log GROUP BY request_id,account_id,session_id ORDER BY started_at DESC LIMIT '+size+' OFFSET '+((page-1)*size));}
export function selectTraceLogByRequestId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT node,state,model,attempt,duration_ms,input,output,error,created_at FROM ai_trace_log WHERE request_id=? ORDER BY id',params);}
