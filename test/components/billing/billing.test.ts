import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../../../src/libraries/db.js';
import {activatePackage,basicWallet,nextMonth} from '../../../src/components/billing/domain/plans.js';
import {reserveCredit,settleCredit} from '../../../src/components/billing/domain/credits.js';
const ids:string[]=[];
async function account(now:Date){const id=randomUUID();ids.push(id);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);await basicWallet(id,now);return id;}
async function activate(id:string,payment:string,now:Date,credits=500,limit=3){const c=await db.getConnection();try{await c.beginTransaction();await activatePackage(c,id,payment,{id:'fixture-paid',credits,session_limit:limit},now);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
after(async()=>{for(const id of ids)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await db.end();});
test('WIB month clamp preserves local time across leap year and year boundary',()=>{assert.equal(nextMonth(new Date('2028-01-31T08:00:00Z')).toISOString(),'2028-02-29T08:00:00.000Z');assert.equal(nextMonth(new Date('2026-01-31T08:00:00Z')).toISOString(),'2026-02-28T08:00:00.000Z');assert.equal(nextMonth(new Date('2026-12-31T18:00:00Z')).toISOString(),'2027-01-31T18:00:00.000Z');});
test('Parallel activation adds credits once; pending reservations move with renewal and refund once',async()=>{
 const now=new Date('2026-06-10T00:00:00Z'),id=await account(now),initial=(await basicWallet(id,now)).balance;
 await reserveCredit(id,'pending','a'.repeat(64),now);const order=randomUUID();await Promise.all(Array.from({length:8},()=>activate(id,order,now)));
 let wallet=await basicWallet(id,now);assert.equal(wallet.balance,initial-1+500);assert.equal(wallet.session_limit,3);
 await Promise.all(Array.from({length:4},()=>settleCredit(id,'pending','failed',now)));assert.equal((await basicWallet(id,now)).balance,initial+500);
 await activate(id,randomUUID(),new Date('2026-06-20T00:00:00Z'),200,1);wallet=await basicWallet(id,now);assert.equal(wallet.balance,initial+700);assert.equal(wallet.session_limit,1);assert.equal(wallet.expires_at.toISOString(),'2026-07-20T00:00:00.000Z');
});
test('Expiry burns paid balance, grants basic once, and old failures cannot inflate the new period',async()=>{
 const now=new Date('2026-06-10T00:00:00Z'),id=await account(now);await activate(id,randomUUID(),now);await reserveCredit(id,'old','a'.repeat(64),now);
 const expired=new Date('2026-07-10T00:00:00Z');const fresh=await basicWallet(id,expired);assert.equal(fresh.plan_id,'basic');assert.equal(fresh.balance,fresh.quota);
 await settleCredit(id,'old','failed',expired);assert.equal((await basicWallet(id,expired)).balance,fresh.quota);
 await activate(id,randomUUID(),expired);await db.execute('UPDATE wallets SET expires_at=? WHERE account_id=?',[expired,id]);
 assert.equal((await basicWallet(id,expired)).balance,0);
});
