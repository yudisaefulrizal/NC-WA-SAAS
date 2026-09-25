import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createGateway} from '../../../src/http/gateway.js';
import {type Update} from '../../../src/components/whatsapp/domain/sessions.js';
import {ApiError} from '../../../src/libraries/errors.js';
import {AIService} from '../../../src/components/ai/domain/service.js';
import {defaults,type AITransport} from '../../../src/components/ai/domain/provider.js';
import {adminProfiles,setProfileEnabled,clientProfiles,workflowState} from '../../../src/components/ai/domain/profiles/registry.js';
import {chatMessages} from '../../../src/components/ai/domain/chat.js';
import {db} from '../../../src/libraries/db.js';
import {digest} from '../../../src/libraries/security.js';
import {basicWallet} from '../../../src/components/billing/domain/plans.js';

const root=await mkdtemp(join(tmpdir(),'ncwa-profiles-'));const accounts:string[]=[];
// The AI answers every message; the Router always routes to profil_perusahaan, which answers directly.
const transport:AITransport=async(config,messages)=>{
 if(config.call_role==='router')return JSON.stringify({s_p_o_konteks:'pelanggan bertanya',sub_agent:'profil_perusahaan',isi_pesan:messages.filter(m=>m.role==='user').at(-1)!.content});
 if(config.call_role==='context')return 'pelanggan-menunggu-jawaban';
 return JSON.stringify({answer:'Jawaban AI'});
};
class FixtureAI extends AIService {override async config(){return {...defaults,secret:'fixture',memory_limit:60};}}
const service=new FixtureAI(transport,async()=>{});
const updates=new Map<string,(event:Update)=>void>();let sequence=0;
const gateway=createGateway(account=>async(session,update)=>{updates.set(account+'/'+session,update);update({status:'connected'});return {close(){},async logout(){},async typing(){},async read(){},async send(){const id='OUT'+(++sequence);await service.registerSystemMessage(account,session,id);return id;}};},root,service);
const app=express();app.use(express.json());app.use(gateway.router);app.use((e:Error,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof ApiError?e.status:500).json({error:e instanceof ApiError?e.code:'internal_error',message:e.message}));
const owner=randomUUID();accounts.push(owner);
await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')",[owner,owner+'@test.invalid','unused']);
after(async()=>{await setProfileEnabled(owner,'cs',true);await gateway.stop();for(const id of accounts){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();await rm(root,{recursive:true,force:true});});
const customer='628123456789';
async function tenant(sessions=['shop']){
 const id=randomUUID(),key=randomUUID();accounts.push(id);
 await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);
 await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[randomUUID(),id,digest(key)]);
 await basicWallet(id);await db.execute('UPDATE wallets SET session_limit=5 WHERE account_id=?',[id]);
 await service.adjust(id,id,{amount:100000,reason:'fixture',requestId:'fixture'});
 const api=(method:'get'|'post'|'put'|'patch'|'delete',path:string)=>request(app)[method](path).set('X-API-Key',key);
 for(const session of sessions)await api('post','/sessions').send({id:session}).expect(200);
 const send=(session:string,messageId:string,text:string,from=customer)=>updates.get(id+'/'+session)!({incoming:{messageId,text,from,sender:from,isGroup:false,groupId:null,type:'text',timestamp:1}});
 return {id,api,send};
}
async function eventually<T>(read:()=>Promise<T>,ok:(value:T)=>boolean){for(let i=0;i<150;i++){const value=await read();if(ok(value))return value;await new Promise(r=>setTimeout(r,20));}return read();}
const answers=async(account:string,session:string)=>(await chatMessages(account,session,customer)).messages.filter(m=>m.origin==='ai').length;
const memory=async(account:string,session:string)=>{const [rows]=await db.execute<any[]>('SELECT messages,router_context FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[account,session,customer]);const messages=rows[0]?(typeof rows[0].messages==='string'?JSON.parse(rows[0].messages):rows[0].messages):[];return {count:messages.length,context:rows[0]?.router_context??null};};
const product={name:'Kopi Susu',type:'product',description:'Gelas',price:20000,stock:10,active:true};

test('A data profile is created, shared by two sessions, collects their orders, and keeps AI memory per session',async()=>{
 const t=await tenant(['shop','cabang']);
 assert.deepEqual((await t.api('get','/ai/profile-types').expect(200)).body.map((p:any)=>[p.id,p.name,p.tabs,p.enabled]),[['cs','CS Usaha',['knowledge','orders','usage','trial'],true]]);
 await t.api('post','/ai/data-profiles').send({profile_type:'unknown',name:'X'}).expect(404);
 await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:''}).expect(400);
 const created=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Toko Kopi Senja'}).expect(201)).body;
 assert.deepEqual([created.name,created.profile_type,created.sessions,created.knowledge],['Toko Kopi Senja','cs',[],'']);
 await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'toko kopi senja'}).expect(409);
 const base='/ai/data-profiles/'+created.id;
 await t.api('patch',base+'/field').send({field:'usaha',value:'Toko Kopi Senja, Bandung'}).expect(200);
 await t.api('patch',base+'/field').send({field:'fallback_number',value:'628111222333'}).expect(200);
 await t.api('post',base+'/products').send(product).expect(200);
 // Both sessions run the same data profile: the same knowledge and catalog, each with the AI switched on.
 for(const session of ['shop','cabang']){const attached=(await t.api('put','/sessions/'+session+'/ai/profile').send({data_profile_id:created.id,enabled:true}).expect(200)).body;assert.deepEqual([attached.enabled,attached.data_profile.name,attached.profile.usaha,attached.fallback_number],[true,'Toko Kopi Senja','Toko Kopi Senja, Bandung','628111222333']);}
 assert.deepEqual((await t.api('get','/sessions/cabang/ai/products').expect(200)).body.map((p:any)=>p.name),['Kopi Susu']);
 const listed=(await t.api('get','/sessions').expect(200)).body;assert.deepEqual(listed.map((s:any)=>[s.id,s.aiEnabled,s.aiProfile?.name]).sort(),[['cabang',true,'Toko Kopi Senja'],['shop',true,'Toko Kopi Senja']]);
 // Orders from either session land in the one data profile, remembering where they came from.
 const order=(session:string,key:string)=>t.api('post','/sessions/'+session+'/ai/orders').set('Idempotency-Key',key).send({customer,items:[{product_name:'Kopi Susu',quantity:1}]}).expect(200);
 await order('shop','order-shop');await order('cabang','order-cabang');await t.api('post',base+'/orders').set('Idempotency-Key','order-page').send({customer,items:[{product_name:'Kopi Susu',quantity:2}]}).expect(200);
 assert.deepEqual((await t.api('get',base+'/orders').expect(200)).body.map((o:any)=>o.session_id).sort(),['cabang','shop',null].sort());
 assert.equal((await t.api('get','/sessions/shop/ai/orders').expect(200)).body.length,3);
 const summary=(await t.api('get','/ai/data-profiles').expect(200)).body;assert.deepEqual(summary.map((p:any)=>[p.name,p.sessions,p.products,p.orders]),[['Toko Kopi Senja',['cabang','shop'],1,3]]);
 // One customer writes to both numbers: each session answers and keeps its own memory.
 t.send('shop','S1','Halo toko');t.send('cabang','C1','Halo cabang');
 await eventually(async()=>[(await memory(t.id,'shop')).count,(await memory(t.id,'cabang')).count],v=>v[0]===2&&v[1]===2);
 assert.deepEqual([await answers(t.id,'shop'),await answers(t.id,'cabang')],[1,1]);
 const [usage]=await db.execute<any[]>('SELECT session_id,profile_type,data_profile_id FROM ai_usage WHERE account_id=? ORDER BY session_id',[t.id]);
 assert.deepEqual(usage.map(u=>[u.session_id,u.profile_type,u.data_profile_id]),[['cabang','cs',created.id],['shop','cs',created.id]]);
 // An attached data profile cannot be deleted; removing a session leaves the data profile and its orders.
 await t.api('delete',base).expect(409);
 await t.api('delete','/sessions/cabang').expect(200);
 const after=(await t.api('get',base).expect(200)).body;assert.deepEqual(after.sessions,['shop']);assert.equal((await t.api('get',base+'/orders').expect(200)).body.length,3);
});

test('Switching or detaching a data profile empties the session AI memory, leaves notes, and stops a detached session',async()=>{
 const t=await tenant();
 const first=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Pertama'}).expect(201)).body,second=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Kedua'}).expect(201)).body;
 await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:first.id,enabled:true}).expect(200);
 // The answer is saved to AI memory right after it is sent, so wait for memory rather than the chat history.
 t.send('shop','M1','Halo');await eventually(()=>memory(t.id,'shop'),m=>m.count===2);assert.equal((await memory(t.id,'shop')).context,'pelanggan-menunggu-jawaban');
 // Re-sending the same choice changes nothing.
 await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:first.id}).expect(200);assert.equal((await memory(t.id,'shop')).count,2);
 const switched=(await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:second.id}).expect(200)).body;
 assert.deepEqual([switched.enabled,switched.data_profile.name],[true,'Kedua']);assert.deepEqual(await memory(t.id,'shop'),{count:0,context:null});
 t.send('shop','M2','Masih buka?');await eventually(()=>memory(t.id,'shop'),m=>m.count===2);assert.equal(await answers(t.id,'shop'),2);
 const detached=(await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:null}).expect(200)).body;
 assert.deepEqual([detached.enabled,detached.data_profile,detached.knowledge],[false,null,'']);
 t.send('shop','M3','Halo lagi');
 const history=await eventually(async()=>(await chatMessages(t.id,'shop',customer)).messages,m=>m.some(x=>x.id==='M3'));
 await new Promise(r=>setTimeout(r,200));assert.equal(await answers(t.id,'shop'),2);
 assert.deepEqual(history.filter(m=>m.direction==='note').map(m=>m.text),['Profil diganti ke Kedua; memori AI dikosongkan','Profil AI dicabut; AI berhenti membalas']);
 // A detached data profile can be deleted.
 await t.api('delete','/ai/data-profiles/'+first.id).expect(200);await t.api('delete','/ai/data-profiles/'+first.id).expect(404);
});

test('Data profiles stay inside their account',async()=>{
 const a=await tenant(),b=await tenant();
 const mine=(await a.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Milik A'}).expect(201)).body,base='/ai/data-profiles/'+mine.id;
 await a.api('post',base+'/products').send(product).expect(200);
 for(const [method,path,body] of [['get',base,undefined],['patch',base,{name:'Curian'}],['patch',base+'/field',{field:'usaha',value:'x'}],['delete',base,undefined],['get',base+'/products',undefined],['post',base+'/products',product],['get',base+'/orders',undefined]] as const){const call=b.api(method,path);await (body?call.send(body):call).expect(404);}
 await b.api('put','/sessions/shop/ai/profile').send({data_profile_id:mine.id}).expect(404);
 await b.api('post','/ai/data-profiles').send({name:'Salinan',copy_from:mine.id}).expect(404);
 assert.deepEqual((await b.api('get','/ai/data-profiles').expect(200)).body,[]);
 await a.api('get','/ai/data-profiles/not-an-id').expect(404);
});

test('Integrations written before profiles still configure a session, which gets its own CS data profile',async()=>{
 const t=await tenant();
 assert.deepEqual((await t.api('get','/sessions/shop/ai').expect(200)).body.data_profile,null);
 assert.deepEqual((await t.api('get','/sessions/shop/ai/products').expect(200)).body,[]);
 const saved=(await t.api('put','/sessions/shop/ai').send({enabled:true,profile:{usaha:'Laundry Bersih'},behavior:'Ramah'}).expect(200)).body;
 assert.deepEqual([saved.enabled,saved.data_profile.name,saved.profile.usaha,saved.behavior],[true,'CS – shop','Laundry Bersih','Ramah']);
 await t.api('post','/sessions/shop/ai/products').send(product).expect(200);
 assert.deepEqual((await t.api('get','/ai/data-profiles/'+saved.data_profile.id+'/products').expect(200)).body.map((p:any)=>p.name),['Kopi Susu']);
 // After detaching, a legacy write attaches a fresh data profile with the next free name and the AI off.
 await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:null}).expect(200);
 const again=(await t.api('patch','/sessions/shop/ai/field').send({field:'faq',value:'Buka 24 jam'}).expect(200)).body;
 assert.deepEqual([again.enabled,again.data_profile.name,again.profile.faq],[false,'CS – shop (2)','Buka 24 jam']);
 await t.api('patch','/ai/data-profiles/'+saved.data_profile.id).send({name:'CS – shop (2)'}).expect(409);
 assert.equal((await t.api('patch','/ai/data-profiles/'+saved.data_profile.id).send({name:'Laundry'}).expect(200)).body.name,'Laundry');
});

test('Duplicating a data profile copies content, sources and its own photo files; photos never cross data profiles',async()=>{
 const t=await tenant();
 const original=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Asli'}).expect(201)).body,base='/ai/data-profiles/'+original.id;
 await t.api('patch',base+'/field').send({field:'behavior',value:'Formal'}).expect(200);
 const png=await sharp({create:{width:20,height:20,channels:3,background:{r:1,g:2,b:3}}}).png().toBuffer();
 const photo=(await t.api('post',base+'/products-image').set('X-Filename','p.png').set('Content-Type','application/octet-stream').send(png).expect(200)).body;
 await t.api('post',base+'/products').send({...product,image_id:photo.id}).expect(200);
 const other=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Lain'}).expect(201)).body;
 await t.api('post','/ai/data-profiles/'+other.id+'/products').send({...product,image_id:photo.id}).expect(400);
 const copy=(await t.api('post','/ai/data-profiles').send({name:'Salinan',copy_from:original.id}).expect(201)).body;
 assert.deepEqual([copy.behavior,copy.profile_type,copy.sessions],['Formal','cs',[]]);
 const copied=(await t.api('get','/ai/data-profiles/'+copy.id+'/products').expect(200)).body[0];
 assert.ok(copied.image_id&&copied.image_id!==photo.id);
 await t.api('delete',base).expect(200);
 await assert.rejects(stat(join(root,'_product-images',t.id,photo.id)));
 await t.api('get','/ai/data-profiles/'+copy.id+'/products-image/'+copied.image_id).expect(200).expect('Content-Type','image/jpeg');
});

test('The owner switches a profile off for everyone: clients cannot pick it and attached sessions stop answering',async()=>{
 const t=await tenant();
 const profile=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Toko'}).expect(201)).body;
 await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:profile.id,enabled:true}).expect(200);
 const listed=(await adminProfiles()).find(p=>p.id==='cs')!;assert.equal(listed.enabled,true);assert.ok(listed.sessions>=1&&listed.data_profiles>=1);assert.equal(listed.nodes,8);
 try{
  await setProfileEnabled(owner,'cs',false);
  // Still listed for an account that uses it, but no longer pickable; an account that never used it sees nothing.
  assert.deepEqual((await clientProfiles(t.id)).map(p=>[p.id,p.enabled]),[['cs',false]]);assert.deepEqual(await clientProfiles(randomUUID()),[]);assert.equal((await workflowState('cs')).enabled,false);
  await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Baru'}).expect(409);
  await t.api('put','/sessions/shop/ai/profile').send({data_profile_id:profile.id}).expect(409);
  assert.equal((await t.api('get','/sessions/shop/ai').expect(200)).body.profile_enabled,false);
  t.send('shop','OFF1','Halo');await eventually(async()=>(await chatMessages(t.id,'shop',customer)).messages.length,n=>n===1);
  await new Promise(r=>setTimeout(r,200));assert.equal(await answers(t.id,'shop'),0);
 }finally{await setProfileEnabled(owner,'cs',true);}
 t.send('shop','ON1','Halo lagi');await eventually(()=>answers(t.id,'shop'),n=>n===1);
 await assert.rejects(setProfileEnabled(owner,'unknown',true),{code:'profile_not_found'});
 const [audit]=await db.execute<any[]>("SELECT action FROM audit_events WHERE account_id=? AND action LIKE 'ai_profile_%' ORDER BY id",[owner]);
 assert.deepEqual(audit.slice(-2).map(a=>a.action),['ai_profile_disabled:cs','ai_profile_enabled:cs']);
});

test('Uji Coba runs a data profile directly, even one not attached to any session',async()=>{
 const t=await tenant();
 const profile=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Belum dipasang'}).expect(201)).body;
 const result=await service.trial(t.id,{question:'Apa saja produknya?',data_profile:profile.id});
 assert.equal(result.answer,'Jawaban AI');
 const [usage]=await db.execute<any[]>("SELECT session_id,profile_type,data_profile_id FROM ai_usage WHERE account_id=? AND customer='trial'",[t.id]);
 assert.deepEqual(usage.map(u=>[u.session_id,u.profile_type,u.data_profile_id]),[['','cs',profile.id]]);
 await assert.rejects(service.trial(t.id,{question:'Halo',session:'shop'}),{code:'no_profile'});
 await assert.rejects(service.trial(t.id,{question:'Halo',data_profile:randomUUID()}),{code:'data_profile_not_found'});
});
