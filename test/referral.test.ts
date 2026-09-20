import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {db} from '../src/db.js';
import {basicWallet} from '../src/plans.js';
import {ReferralService} from '../src/referral.js';
import {Payments,encrypt} from '../src/payments.js';

process.env.PAYMENT_ENCRYPTION_KEY??='11'.repeat(32);
const accounts:string[]=[];
async function account(){const id=randomUUID();accounts.push(id);await db.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)',[id,`${id}@test.invalid`,'unused']);await basicWallet(id);return id;}
async function enableReferral(actor:string,overrides:Record<string,unknown> = {}){
 const service=new ReferralService();
 await service.configure(actor,{enabled:true,commission_percent:10,referrer_signup_wa_credits:50,referrer_signup_ai_credits:100,referee_signup_wa_credits:20,referee_signup_ai_credits:0,min_payout_amount:0,...overrides});
 return service;
}
after(async()=>{
 for(const id of accounts){await db.execute('DELETE FROM referral_earnings WHERE referrer_id=?',[id]);await db.execute('DELETE FROM referral_payouts WHERE referrer_id=?',[id]);await db.execute('DELETE FROM referral_agents WHERE account_id=?',[id]);await db.execute('DELETE FROM referral_profiles WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}
 await db.execute("UPDATE referral_settings SET enabled=TRUE,commission_percent=10,referrer_signup_wa_credits=0,referrer_signup_ai_credits=0,referee_signup_wa_credits=0,referee_signup_ai_credits=0,min_payout_amount=0 WHERE id=1");
 await db.end();
});

test('Redeem creates a pending referral; self-code and reuse are rejected',async()=>{
 const service=await enableReferral(await account());
 const referrer=await account(),referred=await account();
 const code=await service.code(referrer);
 await assert.rejects(service.redeem(referrer,{code}),{code:'referral_self'});
 const overview=await service.redeem(referred,{code});
 assert.equal(overview.usedReferral?.status,'pending');
 await assert.rejects(service.redeem(referred,{code}),{code:'referral_already_used'});
 await assert.rejects(service.redeem(await account(),{code:'DOES-NOT-EXIST'}),{code:'referral_code_not_found'});
});

test('Qualification grants WhatsApp and AI credit to both sides exactly once, even if the same number fires twice',async()=>{
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{referrer_signup_wa_credits:50,referrer_signup_ai_credits:100,referee_signup_wa_credits:20,referee_signup_ai_credits:10});
 const code=await service.code(referrer);
 await service.redeem(referred,{code});
 const referrerWallet=(await basicWallet(referrer)).balance,referredWallet=(await basicWallet(referred)).balance;
 await service.qualify(referred,'6281200000001');
 await service.qualify(referred,'6281200000001'); // duplicate event must not double-pay
 assert.equal((await basicWallet(referrer)).balance,referrerWallet+50);
 assert.equal((await basicWallet(referred)).balance,referredWallet+20);
 const [[referrerAI]]=await db.execute<any[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[referrer]);
 const [[referredAI]]=await db.execute<any[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[referred]);
 assert.equal(referrerAI.balance,100);assert.equal(referredAI.balance,10);
 const overview=await service.overview(referrer);assert.equal(overview.qualifiedReferrals,1);
});

test('A phone number can only ever qualify one referral system-wide, even across different referrers',async()=>{
 const service=await enableReferral(await account(),{referrer_signup_wa_credits:50});
 const referrerA=await account(),referredA=await account();
 const codeA=await service.code(referrerA);
 await service.redeem(referredA,{code:codeA});
 await service.qualify(referredA,'6281299999999');
 assert.equal((await service.overview(referrerA)).qualifiedReferrals,1);

 // A second, unrelated referral tries to reuse the SAME phone number.
 const referrerB=await account(),referredB=await account();
 const codeB=await service.code(referrerB);
 await service.redeem(referredB,{code:codeB});
 const beforeB=(await basicWallet(referrerB)).balance;
 await service.qualify(referredB,'6281299999999');
 assert.equal((await service.overview(referrerB)).qualifiedReferrals,0,'reused number must not qualify a second referral');
 assert.equal((await basicWallet(referrerB)).balance,beforeB,'no bonus paid for a reused number');
});

test('Redeeming after already having a qualifying number qualifies immediately',async()=>{
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{referrer_signup_wa_credits:50});
 service.currentNumbersProvider=async(id)=>id===referred?['6281255500001']:[];
 const code=await service.code(referrer);
 const overview=await service.redeem(referred,{code});
 assert.equal(overview.usedReferral?.status,'qualified');
});

test('Purchase commission is recorded once per order, respects agent override, and never double-charges',async()=>{
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{commission_percent:10});
 const code=await service.code(referrer);
 await service.redeem(referred,{code});
 await service.qualify(referred,'6281277700001');
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  await service.recordPurchaseCommission(c,referred,'order-1',100000);
  await service.recordPurchaseCommission(c,referred,'order-1',100000); // duplicate order_id must be ignored
  await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
 let overview=await service.overview(referrer);
 assert.equal(overview.totalEarnings,10000);

 // Recurring: a second purchase earns commission again.
 await db.getConnection().then(async c2=>{try{await c2.beginTransaction();await service.recordPurchaseCommission(c2,referred,'order-2',50000);await c2.commit();}catch(e){await c2.rollback();throw e;}finally{c2.release();}});
 overview=await service.overview(referrer);assert.equal(overview.totalEarnings,15000);

 // Agent override changes the rate for future orders.
 await service.setAgent(referrer,referrer,{commission_percent:50,note:'test agent'});
 await db.getConnection().then(async c3=>{try{await c3.beginTransaction();await service.recordPurchaseCommission(c3,referred,'order-3',100000);await c3.commit();}catch(e){await c3.rollback();throw e;}finally{c3.release();}});
 overview=await service.overview(referrer);assert.equal(overview.totalEarnings,15000+50000);
});

test('Purchase settlement through Payments.apply() records commission end-to-end',async()=>{
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{commission_percent:10});
 const code=await service.code(referrer);
 await service.redeem(referred,{code});
 await service.qualify(referred,'6281288800001');

 const configId=randomUUID(),planId='test-'+randomUUID().slice(0,20);
 await db.execute("INSERT INTO payment_config(id,environment,secret) VALUES (?,'sandbox',?)",[configId,encrypt('fixture-key')]);
 await db.execute('INSERT INTO plans VALUES (?,?,10000,500,3,TRUE,20,104857600)',[planId,'Fixture plan']);
 let order='';
 const call=async(_env:string,_key:string,path:string,body?:unknown)=>{
  if(body)order=(body as any).transaction_details.order_id;
  return {order_id:order,transaction_id:'tx-'+order,payment_type:'qris',currency:'IDR',gross_amount:'10000.00',transaction_status:'settlement',status_code:path.endsWith('/charge')?'201':'200',fraud_status:'accept'};
 };
 const payments=new Payments(call as any,configId,service);
 const created=await payments.create(referred,planId);
 await payments.reconcile(created.id);
 const overview=await service.overview(referrer);
 assert.equal(overview.totalEarnings,1000); // 10% of 10000
 await db.execute('DELETE FROM payment_orders WHERE plan_id=?',[planId]);
 await db.execute('DELETE FROM plans WHERE id=?',[planId]);
 await db.execute('DELETE FROM payment_config WHERE id=?',[configId]);
});

test('Payout request requires a complete profile, respects available balance, and locks reserved funds',async()=>{
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{commission_percent:10,min_payout_amount:5000});
 const code=await service.code(referrer);
 await service.redeem(referred,{code});
 await service.qualify(referred,'6281266600001');
 const c=await db.getConnection();
 try{await c.beginTransaction();await service.recordPurchaseCommission(c,referred,'order-payout',200000);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
 await assert.rejects(service.requestPayout(referrer,{amount:10000}),{code:'referral_profile_incomplete'});
 await service.saveProfile(referrer,{bank_name:'BCA',bank_account_name:'Referrer Test',bank_account_number:'1234567890'});
 await assert.rejects(service.requestPayout(referrer,{amount:1000}),{code:'payout_below_minimum'});
 await assert.rejects(service.requestPayout(referrer,{amount:999999}),{code:'insufficient_balance'});
 const payout=await service.requestPayout(referrer,{amount:20000});
 assert.equal(payout.status,'requested');
 const overview=await service.overview(referrer);
 assert.equal(overview.availableBalance,20000-20000);
 await service.decidePayout(referrer,payout.id,{status:'paid'});
 await assert.rejects(service.decidePayout(referrer,payout.id,{status:'paid'}),{code:'payout_already_processed'});
});

test('HTTP: redeem endpoint works through the authenticated app router',async()=>{
 const {createApp}=await import('../src/app.js');const {digest}=await import('../src/security.js');
 const {default:request}=await import('supertest');
 const referrer=await account(),referred=await account();
 const service=await enableReferral(referrer,{referrer_signup_wa_credits:0});
 const code=await service.code(referrer);
 const app=createApp(undefined,undefined,undefined,service);
 const token=randomUUID();await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(token),referred]);
 const origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 const response=await request(app).post('/api/referral/redeem').set('Origin',origin).set('Cookie','ncwa_session='+token).send({code}).expect(200);
 assert.equal(response.body.usedReferral.code,code);
 await request(app).get('/api/referral').set('Cookie','ncwa_session='+token).expect(200);
});
