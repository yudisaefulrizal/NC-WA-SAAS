// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectAccountsIdByIdPeriodExpiresAt(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>(`SELECT a.id FROM accounts a LEFT JOIN wallets w ON w.account_id=a.id WHERE a.id>? AND (w.account_id IS NULL OR (w.plan_id='basic' AND w.period<?) OR w.expires_at<=?) ORDER BY a.id LIMIT 100`,params);}
