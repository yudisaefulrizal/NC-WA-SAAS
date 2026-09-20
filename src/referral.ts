import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {ApiError} from './engine/sessions.js';
import {object} from './engine/messages.js';
import {ensureBasic} from './plans.js';

const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion when shared aloud/typed
function generateCode(){let out='';for(const byte of randomBytes(8))out+=CODE_ALPHABET[byte%CODE_ALPHABET.length];return out;}
function fail(message:string){return new ApiError(400,'invalid_request',message);}
function text(value:unknown,max:number,name:string){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(name+' wajib diisi');return value.trim();}
async function transaction<T>(fn:(c:PoolConnection)=>Promise<T>){const c=await db.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}}

export interface ReferralSettings {enabled:boolean;commission_percent:number;referrer_signup_wa_credits:number;referrer_signup_ai_credits:number;referee_signup_wa_credits:number;referee_signup_ai_credits:number;min_payout_amount:number}

export class ReferralService {
 async settings():Promise<ReferralSettings>{
  const [rows]=await db.query<RowDataPacket[]>('SELECT enabled,commission_percent,referrer_signup_wa_credits,referrer_signup_ai_credits,referee_signup_wa_credits,referee_signup_ai_credits,min_payout_amount FROM referral_settings WHERE id=1');
  const row=rows[0];
  return {enabled:Boolean(row?.enabled),commission_percent:Number(row?.commission_percent??0),referrer_signup_wa_credits:Number(row?.referrer_signup_wa_credits??0),referrer_signup_ai_credits:Number(row?.referrer_signup_ai_credits??0),referee_signup_wa_credits:Number(row?.referee_signup_wa_credits??0),referee_signup_ai_credits:Number(row?.referee_signup_ai_credits??0),min_payout_amount:Number(row?.min_payout_amount??0)};
 }
 async configure(actor:string,body:unknown){
  const input=object(body);
  if(typeof input.enabled!=='boolean')throw fail('Status aktif wajib valid');
  const fields=['commission_percent','referrer_signup_wa_credits','referrer_signup_ai_credits','referee_signup_wa_credits','referee_signup_ai_credits','min_payout_amount'] as const;
  const values:Record<string,number>={};
  for(const field of fields){const value=input[field];if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>100000000)throw fail('Nilai '+field+' tidak valid');values[field]=Number(value);}
  if(values.commission_percent>100)throw fail('Persentase komisi maksimal 100');
  await transaction(async c=>{
   await c.execute('UPDATE referral_settings SET enabled=?,commission_percent=?,referrer_signup_wa_credits=?,referrer_signup_ai_credits=?,referee_signup_wa_credits=?,referee_signup_ai_credits=?,min_payout_amount=? WHERE id=1',[input.enabled,values.commission_percent,values.referrer_signup_wa_credits,values.referrer_signup_ai_credits,values.referee_signup_wa_credits,values.referee_signup_ai_credits,values.min_payout_amount] as any[]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_settings_updated')",[actor]);
  });
  return this.settings();
 }

 // Every account gets a stable code, created lazily on first use.
 // Accepts an existing connection so callers already inside a transaction don't open a second one.
 async code(accountId:string,external?:PoolConnection){
  const reader=external??db;
  const [existing]=await reader.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=?',[accountId]);
  if(existing[0])return existing[0].code as string;
  const run=async(c:PoolConnection)=>{
   const [rows]=await c.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=? FOR UPDATE',[accountId]);
   if(rows[0])return rows[0].code as string;
   for(let attempt=0;attempt<5;attempt++){
    const code=generateCode();
    try{await c.execute('INSERT INTO referral_codes(account_id,code) VALUES (?,?)',[accountId,code]);return code;}
    catch(e){if((e as {code?:string}).code!=='ER_DUP_ENTRY')throw e;}
   }
   throw new ApiError(503,'referral_code_unavailable','Gagal membuat kode referral, coba lagi');
  };
  return external?run(external):transaction(run);
 }

 // Redeem happens after login from the referral page, never at registration.
 async redeem(accountId:string,body:unknown){
  const input=object(body),code=text(input.code,16,'Kode referral').toUpperCase();
  const settings=await this.settings();
  if(!settings.enabled)throw new ApiError(409,'referral_disabled','Program referral sedang tidak aktif');
  return transaction(async c=>{
   const [existing]=await c.execute<RowDataPacket[]>('SELECT id FROM referrals WHERE referred_id=? FOR UPDATE',[accountId]);
   if(existing[0])throw new ApiError(409,'referral_already_used','Anda sudah menggunakan kode referral');
   const [owner]=await c.execute<RowDataPacket[]>('SELECT account_id FROM referral_codes WHERE code=? FOR UPDATE',[code]);
   if(!owner[0])throw new ApiError(404,'referral_code_not_found','Kode referral tidak ditemukan');
   if(owner[0].account_id===accountId)throw new ApiError(409,'referral_self','Tidak dapat menggunakan kode referral milik sendiri');
   const id=randomUUID();
   await c.execute('INSERT INTO referrals(id,referrer_id,referred_id,code) VALUES (?,?,?,?)',[id,owner[0].account_id,accountId,code]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_redeemed')",[accountId]);
   // The account may already have a qualifying WhatsApp number from before it redeemed a code.
   await this.tryQualifyExisting(c,accountId);
   return this.overview(accountId,c);
  });
 }

 // Called after redeem (existing numbers) and after every successful pairing (new numbers).
 // Idempotent: a phone number can only ever qualify one referral, system-wide, forever.
 async qualify(referredAccountId:string,phoneNumber:string){
  if(!phoneNumber)return;
  await transaction(c=>this.qualifyWithConnection(c,referredAccountId,phoneNumber));
 }
 private async qualifyWithConnection(c:PoolConnection,referredAccountId:string,phoneNumber:string){
  const [rows]=await c.execute<RowDataPacket[]>("SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='pending' FOR UPDATE",[referredAccountId]);
  const referral=rows[0];if(!referral)return;
  const settings=await this.settings();if(!settings.enabled)return;
  let inserted:number;
  try{const [result]=await c.execute<import('mysql2/promise').ResultSetHeader>('INSERT IGNORE INTO referral_qualified_numbers(phone_number,referral_id) VALUES (?,?)',[phoneNumber,referral.id]);inserted=result.affectedRows;}
  catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY')return;throw e;}
  if(!inserted)return; // number already used to qualify a referral before (this one or another)
  await c.execute("UPDATE referrals SET status='qualified',qualified_at=UTC_TIMESTAMP() WHERE id=?",[referral.id]);
  if(settings.referrer_signup_wa_credits||settings.referee_signup_wa_credits){
   await ensureBasic(c,referral.referrer_id);await ensureBasic(c,referredAccountId);
   if(settings.referrer_signup_wa_credits)await c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?',[settings.referrer_signup_wa_credits,referral.referrer_id]);
   if(settings.referee_signup_wa_credits)await c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?',[settings.referee_signup_wa_credits,referredAccountId]);
  }
  if(settings.referrer_signup_ai_credits){await c.execute('INSERT INTO ai_wallets VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',[referral.referrer_id,settings.referrer_signup_ai_credits]);}
  if(settings.referee_signup_ai_credits){await c.execute('INSERT INTO ai_wallets VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',[referredAccountId,settings.referee_signup_ai_credits]);}
  await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_qualified')",[referredAccountId]);
 }
 // An account that redeems a code after already pairing WhatsApp earlier can still qualify,
 // provided that number was never used to qualify a referral anywhere in the system.
 private async tryQualifyExisting(c:PoolConnection,referredAccountId:string){
  const numbers=await this.currentNumbers(referredAccountId);
  for(const number of numbers)await this.qualifyWithConnection(c,referredAccountId,number);
 }
 // Reads currently-known WhatsApp numbers for an account from its live session state.
 // Injected by the gateway wiring (auth-state has no DB record of phone numbers).
 currentNumbersProvider:(accountId:string)=>Promise<string[]> = async()=>[];
 private async currentNumbers(accountId:string){try{return await this.currentNumbersProvider(accountId);}catch{return [];}}

 // Called from payments.apply() once an order reaches settlement. Idempotent via order_id UNIQUE.
 async recordPurchaseCommission(c:PoolConnection,accountId:string,orderId:string,amount:number){
  const [rows]=await c.execute<RowDataPacket[]>("SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='qualified' FOR UPDATE",[accountId]);
  const referral=rows[0];if(!referral)return;
  const settings=await this.settings();if(!settings.enabled)return;
  const [agents]=await c.execute<RowDataPacket[]>('SELECT commission_percent FROM referral_agents WHERE account_id=?',[referral.referrer_id]);
  const percent=Number(agents[0]?.commission_percent??settings.commission_percent);
  if(!percent)return;
  const commission=Math.floor(amount*percent/100);if(!commission)return;
  try{await c.execute('INSERT INTO referral_earnings(id,referrer_id,referral_id,order_id,amount) VALUES (?,?,?,?,?)',[randomUUID(),referral.referrer_id,referral.id,orderId,commission]);}
  catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY')return;throw e;}
 }

 // --- Account-facing dashboard ---
 async overview(accountId:string,c:PoolConnection|typeof db=db){
  const code=await this.code(accountId,c===db?undefined:c as PoolConnection);
  const [[counts],[earnings],[payouts],[myReferral]]=await Promise.all([
   c.execute<RowDataPacket[]>("SELECT COUNT(*) AS total,SUM(status='qualified') AS qualified FROM referrals WHERE referrer_id=?",[accountId]),
   c.execute<RowDataPacket[]>('SELECT COALESCE(SUM(amount),0) AS total FROM referral_earnings WHERE referrer_id=?',[accountId]),
   c.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid')",[accountId]),
   c.execute<RowDataPacket[]>('SELECT r.code,r.status,r.qualified_at,a.email AS referrer_email FROM referrals r JOIN accounts a ON a.id=r.referrer_id WHERE r.referred_id=?',[accountId]),
  ]);
  const totalEarnings=Number(earnings[0].total),reserved=Number(payouts[0].total);
  return {
   code,
   totalReferrals:Number(counts[0].total),
   qualifiedReferrals:Number(counts[0].qualified??0),
   totalEarnings,
   availableBalance:Math.max(0,totalEarnings-reserved),
   usedReferral:myReferral[0]?{code:myReferral[0].code,status:myReferral[0].status,qualifiedAt:myReferral[0].qualified_at,referrerEmail:maskEmail(myReferral[0].referrer_email)}:null,
  };
 }
 async myReferrals(accountId:string){
  const [rows]=await db.execute<RowDataPacket[]>(`SELECT r.id,a.email,r.status,r.created_at,r.qualified_at,COALESCE(SUM(e.amount),0) AS earnings
   FROM referrals r JOIN accounts a ON a.id=r.referred_id LEFT JOIN referral_earnings e ON e.referral_id=r.id
   WHERE r.referrer_id=? GROUP BY r.id,a.email,r.status,r.created_at,r.qualified_at ORDER BY r.created_at DESC LIMIT 200`,[accountId]);
  return rows.map(r=>({id:r.id,email:maskEmail(String(r.email)),status:r.status,createdAt:r.created_at,qualifiedAt:r.qualified_at,earnings:Number(r.earnings)}));
 }
 async myEarnings(accountId:string){
  const [rows]=await db.execute<RowDataPacket[]>(`SELECT e.id,e.amount,e.created_at,a.email FROM referral_earnings e JOIN referrals r ON r.id=e.referral_id JOIN accounts a ON a.id=r.referred_id WHERE e.referrer_id=? ORDER BY e.created_at DESC LIMIT 200`,[accountId]);
  return rows.map(r=>({id:r.id,amount:Number(r.amount),createdAt:r.created_at,email:maskEmail(String(r.email))}));
 }
 async profile(accountId:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=?',[accountId]);
  return rows[0]??null;
 }
 async saveProfile(accountId:string,body:unknown){
  const input=object(body);
  const bankName=text(input.bank_name,100,'Nama bank'),accountName=text(input.bank_account_name,150,'Nama pemilik rekening'),accountNumber=text(input.bank_account_number,50,'Nomor rekening');
  if(!/^[0-9-]{4,50}$/.test(accountNumber))throw fail('Nomor rekening tidak valid');
  await db.execute('INSERT INTO referral_profiles(account_id,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE bank_name=VALUES(bank_name),bank_account_name=VALUES(bank_account_name),bank_account_number=VALUES(bank_account_number)',[accountId,bankName,accountName,accountNumber]);
  return this.profile(accountId);
 }
 async myPayouts(accountId:string){
  const [rows]=await db.execute<RowDataPacket[]>('SELECT id,amount,status,note,created_at,processed_at FROM referral_payouts WHERE referrer_id=? ORDER BY created_at DESC LIMIT 200',[accountId]);
  return rows;
 }
 async requestPayout(accountId:string,body:unknown){
  const input=object(body),amount=Number(input.amount);
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000000)throw fail('Jumlah pencairan tidak valid');
  const settings=await this.settings();
  if(amount<settings.min_payout_amount)throw new ApiError(409,'payout_below_minimum','Nominal di bawah batas minimum pencairan');
  return transaction(async c=>{
   const [profiles]=await c.execute<RowDataPacket[]>('SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=? FOR UPDATE',[accountId]);
   const profile=profiles[0];if(!profile)throw new ApiError(409,'referral_profile_incomplete','Lengkapi profil rekening terlebih dahulu');
   const [[earnings],[reserved]]=await Promise.all([
    c.execute<RowDataPacket[]>('SELECT COALESCE(SUM(amount),0) AS total FROM referral_earnings WHERE referrer_id=?',[accountId]),
    c.execute<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid') FOR UPDATE",[accountId]),
   ]);
   const available=Number(earnings[0].total)-Number(reserved[0].total);
   if(amount>available)throw new ApiError(409,'insufficient_balance','Saldo referral tidak mencukupi');
   const id=randomUUID();
   await c.execute('INSERT INTO referral_payouts(id,referrer_id,amount,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?,?,?)',[id,accountId,amount,profile.bank_name,profile.bank_account_name,profile.bank_account_number]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'referral_payout_requested')",[accountId]);
   return {id,amount,status:'requested'};
  });
 }

 // --- Admin ---
 async adminList(){
  const [rows]=await db.query<RowDataPacket[]>(`SELECT r.id,ra.email AS referrer_email,re.email AS referred_email,r.code,r.status,r.created_at,r.qualified_at,
   (SELECT phone_number FROM referral_qualified_numbers WHERE referral_id=r.id) AS qualified_number,
   COALESCE((SELECT SUM(amount) FROM referral_earnings WHERE referral_id=r.id),0) AS earnings,
   ag.commission_percent AS agent_commission_percent
   FROM referrals r JOIN accounts ra ON ra.id=r.referrer_id JOIN accounts re ON re.id=r.referred_id
   LEFT JOIN referral_agents ag ON ag.account_id=r.referrer_id
   ORDER BY r.created_at DESC LIMIT 300`);
  return rows.map(r=>({...r,earnings:Number(r.earnings)}));
 }
 async adminPayouts(status?:string){
  const valid=['requested','paid','rejected'];
  const [rows]=await db.execute<RowDataPacket[]>('SELECT p.id,p.referrer_id,a.email AS referrer_email,p.amount,p.bank_name,p.bank_account_name,p.bank_account_number,p.status,p.note,p.created_at,p.processed_at FROM referral_payouts p JOIN accounts a ON a.id=p.referrer_id'+(status&&valid.includes(status)?' WHERE p.status=?':'')+' ORDER BY p.created_at ASC LIMIT 300',status&&valid.includes(status)?[status]:[]);
  return rows;
 }
 async decidePayout(actor:string,id:string,body:unknown){
  const input=object(body),decision=input.status;
  if(decision!=='paid'&&decision!=='rejected')throw fail('Keputusan tidak valid');
  const note=input.note===undefined?null:text(input.note,500,'Catatan');
  await transaction(async c=>{
   const [rows]=await c.execute<RowDataPacket[]>("SELECT status FROM referral_payouts WHERE id=? FOR UPDATE",[id]);
   if(!rows[0])throw new ApiError(404,'payout_not_found','Pengajuan pencairan tidak ditemukan');
   if(rows[0].status!=='requested')throw new ApiError(409,'payout_already_processed','Pengajuan sudah diproses');
   await c.execute('UPDATE referral_payouts SET status=?,note=?,processed_at=UTC_TIMESTAMP(),processed_by=? WHERE id=?',[decision,note,actor,id]);
   await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,?)",[actor,'referral_payout_'+decision+':'+id]);
  });
  return {ok:true};
 }
 async setAgent(actor:string,accountId:string,body:unknown){
  const input=object(body);
  if(input.remove===true){await db.execute('DELETE FROM referral_agents WHERE account_id=?',[accountId]);await db.execute("INSERT INTO audit_events(account_id,action) VALUES (?,?)",[actor,'referral_agent_removed:'+accountId]);return {ok:true};}
  const percent=Number(input.commission_percent);
  if(!Number.isSafeInteger(percent)||percent<0||percent>100)throw fail('Persentase komisi tidak valid');
  const note=input.note===undefined||input.note===''?null:text(input.note,300,'Catatan');
  await db.execute('INSERT INTO referral_agents(account_id,commission_percent,note,set_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE commission_percent=VALUES(commission_percent),note=VALUES(note),set_by=VALUES(set_by)',[accountId,percent,note,actor]);
  await db.execute("INSERT INTO audit_events(account_id,action) VALUES (?,?)",[actor,'referral_agent_set:'+accountId]);
  return {ok:true};
 }
 async agents(){
  const [rows]=await db.query<RowDataPacket[]>('SELECT ag.account_id,a.email,ag.commission_percent,ag.note,ag.created_at FROM referral_agents ag JOIN accounts a ON a.id=ag.account_id ORDER BY ag.created_at DESC');
  return rows;
 }
}
function maskEmail(email:string){const [user,domain]=email.split('@');if(!domain)return email;const visible=user.slice(0,2);return visible+'*'.repeat(Math.max(1,user.length-visible.length))+'@'+domain;}
export const referral=new ReferralService();
