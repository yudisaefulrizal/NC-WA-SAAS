import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../src/gateway.js';
import {ApiError} from '../src/engine/sessions.js';
import {db} from '../src/db.js';
import {digest} from '../src/security.js';
const root=await mkdtemp(join(tmpdir(),'ncwa-gateway-'));const accounts:string[]=[];
const service=createGateway(()=>async(_id,update)=>{update({status:'qr_required',qr:'data:image/png;base64,AA=='});return {close(){},async logout(){}};},root);
const app=express();app.use(express.json());app.use(service.router);app.use((e:Error,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof ApiError?e.status:500).json({error:e instanceof ApiError?e.code:'internal_error'}));
after(async()=>{await service.stop();for(const id of accounts)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await db.end();await rm(root,{recursive:true,force:true});});
async function user(){const id=randomUUID();accounts.push(id);const key=randomUUID();await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,`${id}@test.invalid`,'unused']);await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[randomUUID(),id,digest(key)]);return key;}
test('Tenant sessions and QR isolated; shared IDs allowed; concurrent creation respects limit',async()=>{const a=await user(),b=await user();await request(app).get('/stats').expect(401);await request(app).post('/sessions').set('X-API-Key',a).send({id:'shop'}).expect(200);await request(app).get('/sessions/shop/qr').set('X-API-Key',b).expect(404);await request(app).delete('/sessions/shop').set('X-API-Key',b).expect(404);await request(app).post('/sessions').set('X-API-Key',b).send({id:'shop'}).expect(200);assert.equal((await request(app).get('/stats').set('X-API-Key',a)).body.sessions.total,1);await request(app).get('/sessions/shop/qr').set('X-API-Key',a).expect(200);const c=await user();const results=await Promise.all(['one','two'].map(id=>request(app).post('/sessions').set('X-API-Key',c).send({id})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);});

test('Startup restores tenants once without requests and preserves logged-out sessions',async()=>{
 const {SessionStore}=await import('../src/engine/store.js');
 const saved=await mkdtemp(join(tmpdir(),'ncwa-restore-'));
 const a=await user();const accountA=accounts.at(-1)!;
 const b=await user();const accountB=accounts.at(-1)!;
 const orphan=randomUUID();
 const {basicWallet}=await import('../src/plans.js');
 for(const account of [accountA,accountB]){await basicWallet(account);await db.execute('UPDATE wallets SET session_limit=2 WHERE account_id=?',[account]);}
 for(const id of [accountA,accountB,orphan]){
  const store=new SessionStore(join(saved,id));
  await store.save({id:'shop',status:'connected',phone:null,filter:id===accountA?'private':'group'});
  await store.save({id:'offline',status:'logged_out',phone:null,filter:'all'});
 }
 const opened:string[]=[];let closed=0;
 const restored=createGateway(account=>async(id,update)=>{
  opened.push(`${account}/${id}`);update({status:'connected'});
  return {close(){closed++;},async logout(){}};
 },saved);
 const api=express();api.use(restored.router);
 try{
  await Promise.all([restored.restore(),restored.restore()]);
  assert.deepEqual(opened.sort(),[`${accountA}/shop`,`${accountB}/shop`].sort());
  for(const [key,filter] of [[a,'private'],[b,'group']]){
   const response=await request(api).get('/sessions').set('X-API-Key',key!).expect(200);
   assert.equal(response.body.find((s:{id:string})=>s.id==='shop').filter,filter);
   assert.equal(response.body.find((s:{id:string})=>s.id==='offline').status,'logged_out');
  }
  assert.equal(opened.length,2);
 }finally{await restored.stop();await rm(saved,{recursive:true,force:true});}
 assert.equal(closed,2);
});

test('Startup accepts a missing auth directory',async()=>{
 const service=createGateway(()=>async()=>{throw new Error('Must not connect');},join(root,'missing'));
 try{await service.restore();}finally{await service.stop();}
});
