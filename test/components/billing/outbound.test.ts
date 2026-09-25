import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {db} from '../../../src/libraries/db.js';
import {digest} from '../../../src/libraries/security.js';
import {basicWallet} from '../../../src/components/billing/domain/plans.js';
import {createGateway} from '../../../src/http/gateway.js';
import {ApiError} from '../../../src/libraries/errors.js';
import {MediaStore} from '../../../src/components/whatsapp/data-access/media-store.js';
import {Readable} from 'node:stream';
const root=await mkdtemp(join(tmpdir(),'ncwa-outbound-')),ids:string[]=[];let sends=0,uncertain=false,exists=true;
const service=createGateway(()=>async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){},async typing(){},async read(){},async exists(){return exists;},async send(){sends++;if(uncertain)throw Error('timeout');return 'fixture-'+sends;}};},root);
const app=express();app.use(express.json());app.use(service.router);app.use((e:Error,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof ApiError?e.status:500).json({error:e instanceof ApiError?e.code:'internal_error'}));
async function user(){const id=randomUUID(),key=randomUUID();ids.push(id);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[randomUUID(),id,digest(key)]);return {id,key};}
after(async()=>{await service.stop();for(const id of ids)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await db.end();await rm(root,{recursive:true,force:true});});
test('n8n text/read/typing contract, single charge on concurrent retry, conflict and tenant isolation',async()=>{
 const a=await user(),b=await user();await request(app).post('/sessions').set('X-API-Key',a.key).send({id:'shop'}).expect(200);const initial=(await basicWallet(a.id)).balance;
 const send=()=>request(app).post('/sessions/shop/messages/text').set('X-API-Key',a.key).set('Idempotency-Key','same').send({to:'628123456789',text:'fixture'});
 const results=await Promise.all([send(),send(),send()]);assert.equal(sends,1);assert.ok(results.some(r=>r.status===200));const repeat=await send().expect(200);assert.equal(repeat.body.messageId,'fixture-1');assert.equal(repeat.body.to,'628123456789@s.whatsapp.net');assert.equal((await basicWallet(a.id)).balance,initial-1);
 await request(app).post('/sessions/shop/messages/text').set('X-API-Key',a.key).set('Idempotency-Key','same').send({to:'628123456789',text:'different'}).expect(409);
 await request(app).post('/sessions/shop/messages/text').set('X-API-Key',b.key).send({to:'628123456789',text:'fixture'}).expect(404);
 await request(app).post('/sessions/shop/read').set('X-API-Key',a.key).send({to:'123@g.us',messageId:'message',sender:'628123456789'}).expect(200);
 await request(app).post('/sessions/shop/typing').set('X-API-Key',a.key).send({to:'628123456789',state:'composing'}).expect(200);assert.equal((await basicWallet(a.id)).balance,initial-1);
});
test('Known pre-send rejection refunds; transport uncertainty holds credit and never retries',async()=>{
 const a=await user();await request(app).post('/sessions').set('X-API-Key',a.key).send({id:'shop'}).expect(200);const initial=(await basicWallet(a.id)).balance;
 exists=false;await request(app).post('/sessions/shop/messages/text').set('X-API-Key',a.key).send({to:'628123456789',text:'fixture'}).expect(400);exists=true;assert.equal((await basicWallet(a.id)).balance,initial);
 uncertain=true;const before=sends;const send=()=>request(app).post('/sessions/shop/messages/text').set('X-API-Key',a.key).set('Idempotency-Key','unknown').send({to:'628123456789',text:'fixture'});
 assert.equal((await send().expect(502)).body.error,'send_unknown');await send().expect(409);uncertain=false;assert.equal(sends,before+1);assert.equal((await basicWallet(a.id)).balance,initial-1);
 await request(app).post('/sessions/shop/messages/media').set('X-API-Key',a.key).send({to:'628123456789',type:'image',url:'http://127.0.0.1/private'}).expect(400);assert.equal((await basicWallet(a.id)).balance,initial-1);
});
test('Media paths require account credentials and reject cross-account access/traversal',async()=>{
 const a=await user(),b=await user();const store=new MediaStore(join(root,'files','media',a.id),'http://gateway.invalid');
 const media=await store.save('shop',{messageId:'one',from:'628123',sender:'628123',isGroup:false,groupId:null,type:'image',text:'',timestamp:1,mimetype:'image/png',download:async()=>Readable.from(['fixture-image'])});
 const path=new URL(media!.url).pathname;await request(app).get(path).expect(401);await request(app).get(path).set('X-API-Key',b.key).expect(404);await request(app).get(path).set('X-API-Key',a.key).expect(200);
 await request(app).get('/media/..%2F..%2F.env').set('X-API-Key',a.key).expect(404);
 await request(app).post('/sessions').set('X-API-Key',a.key).send({id:'../other'}).expect(400);
});

test('Existing n8n node executes text and read against SaaS; trigger registers and removes tenant webhook',async()=>{
 const {NcWa}=await import('../../../../n8n-nc-wa/nodes/NcWa/NcWa.node.js');const {NcWaTrigger}=await import('../../../../n8n-nc-wa/nodes/NcWaTrigger/NcWaTrigger.node.js');
 const a=await user();await request(app).post('/sessions').set('X-API-Key',a.key).send({id:'shop'}).expect(200);
 const state:Record<string,unknown>={};let params:Record<string,unknown>={resource:'message',operation:'sendText',sessionId:'shop',to:'628123456789',text:'from n8n'};
 const context:any={getInputData:()=>[{json:{}}],getCredentials:async()=>({baseUrl:'http://gateway.invalid',apiKey:a.key}),getNodeParameter:(name:string)=>params[name],continueOnFail:()=>false,getWorkflowStaticData:()=>state,getNodeWebhookUrl:()=> 'https://8.8.8.8/n8n',helpers:{requestWithAuthentication:async(_name:string,options:any)=>{const method=String(options.method).toLowerCase();const response=await (request(app) as any)[method](new URL(options.uri).pathname).set('X-API-Key',a.key).send(options.body);assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}}};
 assert.ok((await new NcWa().execute.call(context))[0][0].json.messageId);
 params={resource:'message',operation:'read',sessionId:'shop',from:'628123456789',messageId:'fixture',readOptions:{}};await new NcWa().execute.call(context);
 params={options:{sessionId:'shop'}};const trigger=new NcWaTrigger();await trigger.webhookMethods.default.create.call(context);assert.ok(state.webhookId);assert.equal((await request(app).get('/webhooks').set('X-API-Key',a.key)).body.length,1);await trigger.webhookMethods.default.delete.call(context);assert.equal((await request(app).get('/webhooks').set('X-API-Key',a.key)).body.length,0);
});

test('Media with caption uses one credit and incoming messages leave wallet unchanged',async()=>{
 const {sendBilled}=await import('../../../src/components/billing/domain/outbound.js');const {SessionManager}=await import('../../../src/components/whatsapp/domain/sessions.js');
 const a=await user();let content:any,update:any;const manager=new SessionManager(async(_id,cb)=>{update=cb;cb({status:'connected'});return {close(){},async logout(){},async send(_jid,value){content=value;return 'media-receipt';}};});
 let cleanup=0;try{await manager.create('shop');const initial=(await basicWallet(a.id)).balance;
 await sendBilled(a.id,manager,'shop','media',{to:'123@g.us',type:'image',url:'https://fixture.invalid/image',caption:'Caption'},'caption',async()=>({path:'/fixture/image',mimetype:'image/png',cleanup:async()=>{cleanup++;}}));
 assert.equal(content.caption,'Caption');assert.equal(cleanup,1);assert.equal((await basicWallet(a.id)).balance,initial-1);
 update({incoming:{messageId:'incoming',from:'628123',sender:'628123',isGroup:false,groupId:null,type:'text',text:'fixture',timestamp:1}});assert.equal((await basicWallet(a.id)).balance,initial-1);
 }finally{await manager.stop();}
});
