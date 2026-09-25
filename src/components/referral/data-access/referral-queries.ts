// SQL of this component, one named query per statement. Domain code passes the executor: the pool,
// or the connection of a transaction it has opened.
import type {RowDataPacket} from 'mysql2/promise';
import type {Executor,SqlValue} from '../../../libraries/db.js';
export function selectReferralSettings(c:Executor){return c.query<RowDataPacket[]>('SELECT enabled,commission_percent,referrer_signup_wa_credits,referrer_signup_ai_credits,referee_signup_wa_credits,referee_signup_ai_credits,min_payout_amount FROM referral_settings WHERE id=1');}
export function updateReferralSettingsEnabled(c:Executor,params:SqlValue[]){return c.execute('UPDATE referral_settings SET enabled=?,commission_percent=?,referrer_signup_wa_credits=?,referrer_signup_ai_credits=?,referee_signup_wa_credits=?,referee_signup_ai_credits=?,min_payout_amount=? WHERE id=1',params);}
export function insertReferralSettingsAudit(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_settings_updated')",params);}
export function selectReferralCodesCodeByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=?',params);}
export function lockReferralCodesCodeByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=? FOR UPDATE',params);}
export function insertReferralCodes(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referral_codes(account_id,code) VALUES (?,?)',params);}
export function lockReferralsIdByReferredId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id FROM referrals WHERE referred_id=? FOR UPDATE',params);}
export function lockReferralCodesAccountIdByCode(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT account_id FROM referral_codes WHERE code=? FOR UPDATE',params);}
export function insertReferrals(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referrals(id,referrer_id,referred_id,code) VALUES (?,?,?,?)',params);}
export function insertReferralRedeemedAudit(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_redeemed')",params);}
export function lockPendingReferral(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='pending' FOR UPDATE",params);}
export function insertIgnoreReferralQualifiedNumbers(c:Executor,params:SqlValue[]){return c.execute<import('mysql2/promise').ResultSetHeader>('INSERT IGNORE INTO referral_qualified_numbers(phone_number,referral_id) VALUES (?,?)',params);}
export function updateReferralsStatusById(c:Executor,params:SqlValue[]){return c.execute("UPDATE referrals SET status='qualified',qualified_at=UTC_TIMESTAMP() WHERE id=?",params);}
export function updateWalletsBalanceByAccountId(c:Executor,params:SqlValue[]){return c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?',params);}
export function upsertAiWallets(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO ai_wallets VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',params);}
export function insertReferralQualifiedAudit(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_qualified')",params);}
export function lockQualifiedReferral(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='qualified' FOR UPDATE",params);}
export function selectReferralAgentsCommissionPercentByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT commission_percent FROM referral_agents WHERE account_id=?',params);}
export function insertReferralEarnings(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referral_earnings(id,referrer_id,referral_id,order_id,amount) VALUES (?,?,?,?,?)',params);}
export function countReferralsByReferrerId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COUNT(*) AS total,SUM(status='qualified') AS qualified FROM referrals WHERE referrer_id=?",params);}
export function sumReferralEarnings(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT COALESCE(SUM(amount),0) AS total FROM referral_earnings WHERE referrer_id=?',params);}
export function sumReferralPayouts(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid')",params);}
export function selectReferralsByReferredId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT r.code,r.status,r.qualified_at,a.email AS referrer_email FROM referrals r JOIN accounts a ON a.id=r.referrer_id WHERE r.referred_id=?',params);}
export function selectReferralsByReferrerId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>(`SELECT r.id,a.email,r.status,r.created_at,r.qualified_at,COALESCE(SUM(e.amount),0) AS earnings
   FROM referrals r JOIN accounts a ON a.id=r.referred_id LEFT JOIN referral_earnings e ON e.referral_id=r.id
   WHERE r.referrer_id=? GROUP BY r.id,a.email,r.status,r.created_at,r.qualified_at ORDER BY r.created_at DESC LIMIT 200`,params);}
export function selectReferralEarnings(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>(`SELECT e.id,e.amount,e.created_at,a.email FROM referral_earnings e JOIN referrals r ON r.id=e.referral_id JOIN accounts a ON a.id=r.referred_id WHERE e.referrer_id=? ORDER BY e.created_at DESC LIMIT 200`,params);}
export function selectReferralProfilesByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=?',params);}
export function upsertReferralProfiles(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referral_profiles(account_id,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE bank_name=VALUES(bank_name),bank_account_name=VALUES(bank_account_name),bank_account_number=VALUES(bank_account_number)',params);}
export function selectReferralPayouts(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT id,amount,status,note,created_at,processed_at FROM referral_payouts WHERE referrer_id=? ORDER BY created_at DESC LIMIT 200',params);}
export function lockReferralProfilesByAccountId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>('SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=? FOR UPDATE',params);}
export function lockReferralPayoutsByReferrerId(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid') FOR UPDATE",params);}
export function insertReferralPayouts(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referral_payouts(id,referrer_id,amount,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?,?,?)',params);}
export function insertPayoutRequestedAudit(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_payout_requested')",params);}
export function selectReferralQualifiedNumbers(c:Executor){return c.query<RowDataPacket[]>(`SELECT r.id,ra.email AS referrer_email,re.email AS referred_email,r.code,r.status,r.created_at,r.qualified_at,
   (SELECT phone_number FROM referral_qualified_numbers WHERE referral_id=r.id) AS qualified_number,
   COALESCE((SELECT SUM(amount) FROM referral_earnings WHERE referral_id=r.id),0) AS earnings,
   ag.commission_percent AS agent_commission_percent
   FROM referrals r JOIN accounts ra ON ra.id=r.referrer_id JOIN accounts re ON re.id=r.referred_id
   LEFT JOIN referral_agents ag ON ag.account_id=r.referrer_id
   ORDER BY r.created_at DESC LIMIT 300`);}
export function selectReferralPayoutsByStatus(c:Executor,params:SqlValue[],status:string|undefined,valid:string[]){return c.execute<RowDataPacket[]>('SELECT p.id,p.referrer_id,a.email AS referrer_email,p.amount,p.bank_name,p.bank_account_name,p.bank_account_number,p.status,p.note,p.created_at,p.processed_at FROM referral_payouts p JOIN accounts a ON a.id=p.referrer_id'+(status&&valid.includes(status)?' WHERE p.status=?':'')+' ORDER BY p.created_at ASC LIMIT 300',params);}
export function lockReferralPayoutsStatusById(c:Executor,params:SqlValue[]){return c.execute<RowDataPacket[]>("SELECT status FROM referral_payouts WHERE id=? FOR UPDATE",params);}
export function updateReferralPayoutsStatusById(c:Executor,params:SqlValue[]){return c.execute('UPDATE referral_payouts SET status=?,note=?,processed_at=UTC_TIMESTAMP(),processed_by=? WHERE id=?',params);}
export function insertAuditEvent(c:Executor,params:SqlValue[]){return c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,?)",params);}
export function deleteReferralAgentsByAccountId(c:Executor,params:SqlValue[]){return c.execute('DELETE FROM referral_agents WHERE account_id=?',params);}
export function upsertReferralAgents(c:Executor,params:SqlValue[]){return c.execute('INSERT INTO referral_agents(account_id,commission_percent,note,set_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE commission_percent=VALUES(commission_percent),note=VALUES(note),set_by=VALUES(set_by)',params);}
export function selectReferralAgents(c:Executor){return c.query<RowDataPacket[]>('SELECT ag.account_id,a.email,ag.commission_percent,ag.note,ag.created_at FROM referral_agents ag JOIN accounts a ON a.id=ag.account_id ORDER BY ag.created_at DESC');}
