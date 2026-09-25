// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function lockAccountsIdSuspendedById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,suspended FROM accounts WHERE id=? FOR UPDATE',params);}
export function updateConversationMemory(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?',params);}
export function insertIgnoreWallets(c:Executor,params:SqlValue[]){return c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)',params);}
export function debitAIWallet(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?',params);}
export function creditAIWallet(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?',params);}
export function selectWalletsBalanceByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',params);}
export function updateDataProfilesProfilFaqByIdAccountId(c:Executor,params:SqlValue[]){return c.execute('UPDATE ai_data_profiles SET profil_faq=?,revision=revision+1 WHERE id=? AND account_id=?',params);}
export function shareSettingsMemoryLimit(c:Executor){return c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');}
export function insertIgnoreConversations(c:Executor,params:SqlValue[]){return c.execute("INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",params);}
