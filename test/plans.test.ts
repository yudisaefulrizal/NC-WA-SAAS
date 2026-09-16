import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2';
import request from 'supertest';
import {app} from '../src/app.js';
import {db} from '../src/db.js';
import {basicPeriod,basicWallet,planInput} from '../src/plans.js';
const ids:string[]=[];
after(async()=>{for(const id of ids)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await db.end();});
test('WIB reset boundary and plan validation',()=>{assert.equal(basicPeriod(new Date('2026-09-30T16:59:59Z')),'2026-09');assert.equal(basicPeriod(new Date('2026-09-30T17:00:00Z')),'2026-10');assert.equal(planInput({name:'A',price:-1,credits:100,session_limit:1,active:true}),null);assert.equal(planInput({name:'A',price:0,credits:0.5,session_limit:1,active:true}),null);});
test('Concurrent grants/reset happen once and replace remaining balance',async()=>{
 const id=randomUUID();ids.push(id);await db.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)',[id,`test-${id}@example.test`,'unused']);
 const now=new Date('2026-08-10T00:00:00Z');
 const [plans]=await db.query<RowDataPacket[]>("SELECT * FROM plans WHERE id='basic'");const quota=plans[0].credits;
 const initial=await Promise.all(Array.from({length:8},()=>basicWallet(id,now)));assert.ok(initial.every(w=>w.balance===quota));
 await db.execute('UPDATE wallets SET balance=1 WHERE account_id=?',[id]);
 assert.equal((await basicWallet(id,now)).balance,1);
 const next=new Date('2026-08-31T17:00:00Z');const wallets=await Promise.all(Array.from({length:8},()=>basicWallet(id,next)));assert.ok(wallets.every(w=>w.balance===quota));
 const [events]=await db.execute<RowDataPacket[]>('SELECT * FROM credit_events WHERE account_id=?',[id]);assert.equal(events.length,2);
});
test('Registration grants current basic quota and denies plan administration',async()=>{
 const email=`test-${randomUUID()}@example.test`,password='test-password-long-123',origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 await request(app).post('/api/auth/register').set('Origin',origin).send({email,password}).expect(201);
 const [rows]=await db.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE email=?',[email]);ids.push(rows[0].id);
 const a=request.agent(app);await a.post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200);
 const wallet=(await a.get('/api/wallet').expect(200)).body;assert.equal(wallet.balance,wallet.quota);
 await a.get('/api/admin/plans').expect(403);
 await a.delete('/api/admin/plans/basic').set('Origin',origin).expect(403);
 await a.put('/api/admin/plans/basic').set('Origin',origin).send({name:'hacked',price:0,credits:999999,session_limit:99,active:true}).expect(403);
});

test('Owner manages catalog, basic cannot be disabled, changes do not mutate wallets',async()=>{
 const id=randomUUID();ids.push(id);const planId='test_'+randomUUID().replaceAll('-','').slice(0,24);
 const email=`test-${id}@example.test`,password='test-password-long-123';
 const {hashPassword}=await import('../src/security.js');
 await db.execute("INSERT INTO accounts (id,email,password_hash,role) VALUES (?,?,?,'owner')",[id,email,await hashPassword(password)]);
 const wallet=await basicWallet(id);const a=request.agent(app),origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 try{
 await a.post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200);
 await a.put('/api/admin/plans/'+planId).set('Origin',origin).send({name:'Test',price:100,credits:50,session_limit:2,active:true}).expect(200);
 assert.ok((await a.get('/api/plans')).body.some((p:{id:string})=>p.id===planId));
 await a.put('/api/admin/plans/'+planId).set('Origin',origin).send({name:'Test',price:200,credits:80,session_limit:2,active:false}).expect(200);
 assert.equal((await a.get('/api/plans')).body.some((p:{id:string})=>p.id===planId),false);
 await a.put('/api/admin/plans/basic').set('Origin',origin).send({name:'Basic',price:0,credits:100,session_limit:1,active:false}).expect(400);
 await a.delete('/api/admin/plans/basic').set('Origin',origin).expect(409);
 await db.execute('UPDATE wallets SET plan_id=?,expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE account_id=?',[planId,id]);
 await a.delete('/api/admin/plans/'+planId).set('Origin',origin).expect(200);
 assert.equal((await a.get('/api/admin/plans')).body.some((p:{id:string})=>p.id===planId),false);
 await a.delete('/api/admin/plans/'+planId).set('Origin',origin).expect(404);
 const [audit]=await db.execute<RowDataPacket[]>('SELECT action FROM audit_events WHERE account_id=? AND action=?',[id,'plan_deleted:'+planId]);assert.equal(audit.length,1);
 assert.equal((await basicWallet(id)).plan_id,planId);
 assert.equal((await basicWallet(id)).balance,wallet.balance);
 }finally{await db.execute('DELETE FROM plans WHERE id=?',[planId]);await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);}
});
