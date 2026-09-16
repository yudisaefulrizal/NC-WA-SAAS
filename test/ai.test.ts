import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {db} from '../src/db.js';
import {AIService,countWords,creditCost,defaults,chatEndpoint,type AITransport,type AIMessage} from '../src/ai.js';
import {SessionManager,ApiError} from '../src/engine/sessions.js';
import {basicWallet} from '../src/plans.js';
import {digest} from '../src/security.js';
const ids:string[]=[],managers:SessionManager[]=[];
class FixtureAI extends AIService {settings={...defaults,secret:'fixture'};override async config(){return {...this.settings};}}
async function fixture(call:AITransport=async()=> 'Jawaban bisnis',sendFail=false,wait:(ms:number)=>Promise<void>=async()=>{},events:string[]=[],presenceFail=false){
 const id=randomUUID();ids.push(id);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);await basicWallet(id);
 const service=new FixtureAI(call,wait);await service.adjust(id,id,{amount:10000,reason:'fixture',requestId:'fixture'});await service.saveAssistant(id,'shop',{enabled:true,knowledge:'Produk tersedia',behavior:'Gunakan bahasa Indonesia'});
 let sent=0;const manager=new SessionManager(async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){},async exists(){return !sendFail;},async read(jid,messageId){events.push('read:'+jid+':'+messageId);if(presenceFail)throw Error('read unavailable');},async typing(_jid,state){events.push(state);if(presenceFail)throw Error('presence unavailable');},async send(){events.push('send');sent++;return 'reply-'+sent;}};});managers.push(manager);await manager.create('shop');
 const message=(messageId:string,text='Halo pelanggan',from='628123456789')=>({messageId,text,from,sender:from,isGroup:false,groupId:null,type:'text' as const,timestamp:1});
 return {id,service,manager,message,sent:()=>sent};
}
async function rows(id:string){return await db.execute<any[]>('SELECT * FROM ai_usage WHERE account_id=? ORDER BY created_at,request_id',[id]).then(r=>r[0]);}
after(async()=>{for(const m of managers)await m.stop();for(const id of ids){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();});
test('Word billing is deterministic for whitespace, punctuation, URLs, emoji and unspaced language',()=>{
 assert.equal(countWords(' \n\t '),0);assert.equal(countWords('Halo,  dunia!\nhttps://example.com 🙂 中文'),5);
 assert.equal(creditCost(countWords('kata '.repeat(500)),countWords('jawab '.repeat(100)),1,2),700);
 assert.equal(chatEndpoint('https://ai.sumopod.com'),'https://ai.sumopod.com/v1/chat/completions');assert.equal(chatEndpoint('https://ai.sumopod.com/v1/'),'https://ai.sumopod.com/v1/chat/completions');assert.throws(()=>chatEndpoint('http://localhost'));assert.throws(()=>chatEndpoint('https://key@example.com'));
});
test('Duplicate messages charge and send once; rates are snapshotted and latest input appears once',async()=>{
 let seen:AIMessage[]=[];const f=await fixture(async(_config,messages)=>{seen=messages;f.service.settings.input_rate=19;f.service.settings.output_rate=29;return 'Jawaban bisnis';});
 await Promise.all([f.service.incoming(f.id,f.manager,'shop',f.message('one')),f.service.incoming(f.id,f.manager,'shop',f.message('one'))]);
 const usage=await rows(f.id);assert.equal(usage.length,1);assert.equal(f.sent(),1);assert.equal(usage[0].status,'sent');assert.equal(usage[0].input_rate,1);assert.equal(usage[0].output_rate,2);assert.equal(usage[0].input_words,seen.reduce((n,m)=>n+countWords(m.content),0));assert.equal(seen.filter(m=>m.content==='Halo pelanggan').length,1);assert.equal(usage[0].charged,usage[0].input_words+4);assert.equal((await f.service.wallet(f.id)).balance,10000-usage[0].charged);assert.equal((await basicWallet(f.id)).balance,99);
});
test('Memory holds individual messages within the global limit and is isolated by tenant/session/customer',async()=>{
 const calls:AIMessage[][]=[];const f=await fixture(async(_c,m)=>{calls.push(m);return 'Balasan';});
 for(let i=0;i<3;i++)await f.service.incoming(f.id,f.manager,'shop',f.message('m'+i,'Pesan '+i));
 assert.deepEqual(calls[2].filter(m=>m.role!=='system').map(m=>m.content),['Pesan 1','Balasan','Pesan 2']);
 await f.service.incoming(f.id,f.manager,'shop',f.message('new','Pelanggan lain','628999999999'));assert.equal(calls[3].filter(m=>m.role!=='system').length,1);
 await f.manager.create('other');await f.service.saveAssistant(f.id,'other',{enabled:true,knowledge:'',behavior:''});await f.service.incoming(f.id,f.manager,'other',f.message('same','Nomor lain'));assert.equal(calls[4].filter(m=>m.role!=='system').length,1);
 const other=await fixture();assert.equal((await other.service.conversations(other.id,'shop')).length,0);assert.equal((await other.service.assistant(other.id,'other')).enabled,false);
 const [memory]=await db.execute<any[]>('SELECT JSON_LENGTH(messages) AS n FROM ai_conversations WHERE account_id=?',[f.id]);assert.ok(memory.every(m=>m.n<=3));
});
test('WhatsApp failure still charges AI; provider failure and invalid output release the reservation',async()=>{
 const f=await fixture(undefined,true);await f.service.incoming(f.id,f.manager,'shop',f.message('failure'));let usage=await rows(f.id);assert.equal(usage[0].status,'send_failed');assert.ok(usage[0].charged>0);assert.equal((await basicWallet(f.id)).balance,100);
 for(const output of ['', 'kata '.repeat(301), null]){const g=await fixture(async()=>{if(output===null)throw Error('timeout');return output;});await g.service.incoming(g.id,g.manager,'shop',g.message('error'));await g.service.incoming(g.id,g.manager,'shop',g.message('error'));usage=await rows(g.id);assert.equal(usage.length,1);assert.equal(usage[0].status,'provider_failed');assert.equal(usage[0].charged,0);assert.equal(usage[0].reserved,0);assert.equal((await g.service.wallet(g.id)).balance,10000);assert.equal(g.sent(),0);}
});
test('Concurrent customers cannot overspend, groups/media and disabled/paused assistants never invoke AI',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;return 'OK';});await f.service.adjust(f.id,f.id,{amount:-9950,reason:'small budget',requestId:'small'});
 await Promise.all(Array.from({length:5},(_,i)=>f.service.incoming(f.id,f.manager,'shop',f.message('m'+i,'Halo','62812345000'+i))));assert.ok((await f.service.wallet(f.id)).balance>=0);assert.ok(calls<=1);
 await f.service.saveAssistant(f.id,'shop',{enabled:false,knowledge:'',behavior:''});const before=calls;await f.service.incoming(f.id,f.manager,'shop',f.message('off'));await f.service.incoming(f.id,f.manager,'shop',{...f.message('group'),isGroup:true});await f.service.incoming(f.id,f.manager,'shop',{...f.message('image'),type:'image'});assert.equal(calls,before);
 await f.service.saveAssistant(f.id,'shop',{enabled:true,knowledge:'',behavior:''});await f.service.conversation(f.id,'shop','628123456789',{paused:true});await f.service.incoming(f.id,f.manager,'shop',f.message('paused'));assert.equal(calls,before);
});
test('Changes during generation cancel dispatch and context clear is preserved; generated answer stays billed',async()=>{
 const f=await fixture(async()=>{await f.service.conversation(f.id,'shop','628123456789',{paused:true,clear:true});return 'Jawaban';});await f.service.incoming(f.id,f.manager,'shop',f.message('clear'));assert.equal(f.sent(),0);const usage=await rows(f.id);assert.equal(usage[0].status,'cancelled');assert.ok(usage[0].charged>0);const conversations=await f.service.conversations(f.id,'shop') as any[];assert.equal(conversations[0].message_count,0);
});
test('Restart recovery refunds interrupted AI once and never retries a generated WhatsApp send',async()=>{
 const f=await fixture();await db.execute('UPDATE ai_wallets SET balance=balance-600 WHERE account_id=?',[f.id]);await db.execute("INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_rate,output_rate,reserved,model) VALUES (?,?,'shop','628123456789','generating',1,2,600,'fixture')",[f.id,'0'.repeat(64)]);await f.service.recover(f.id);await f.service.recover(f.id);assert.equal((await f.service.wallet(f.id)).balance,10000);assert.equal((await rows(f.id))[0].status,'interrupted');
});
test('AI wallet adjustments are idempotent and HTTP owner configuration is private',async()=>{
 const f=await fixture();await f.service.adjust(f.id,f.id,{amount:10000,reason:'fixture',requestId:'fixture'});assert.equal((await f.service.wallet(f.id)).balance,10000);await assert.rejects(f.service.adjust(f.id,f.id,{amount:1,reason:'fixture',requestId:'fixture'}),{code:'idempotency_conflict'});
 const {createApp}=await import('../src/app.js');const app=createApp(),token=randomUUID();await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(token),f.id]);const cookie='ncwa_session='+token,origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 await request(app).get('/api/admin/ai').set('Cookie',cookie).expect(403);await request(app).put('/api/admin/ai').set('Origin',origin).set('Cookie',cookie).send({}).expect(403);await request(app).get('/api/ai/wallet').expect(401);const w=await request(app).get('/api/ai/wallet').set('Cookie',cookie).expect(200);assert.equal(w.body.balance,10000);assert.equal(w.body.secret,undefined);
});

test('Consecutive customer messages after provider errors trim oldest messages rather than pairs',async()=>{
 const inputs:AIMessage[][]=[];const f=await fixture(async(_c,m)=>{inputs.push(m);throw Error('provider unavailable');});
 for(let i=1;i<=4;i++)await f.service.incoming(f.id,f.manager,'shop',f.message('failure-'+i,'Pelanggan '+i));
 assert.deepEqual(inputs[3].filter(m=>m.role==='user').map(m=>m.content),['Pelanggan 2','Pelanggan 3','Pelanggan 4']);assert.equal((await f.service.wallet(f.id)).balance,10000);
});
test('Gateway assistant routes verify session ownership and account isolation',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const {createGateway}=await import('../src/gateway.js');const {createApp}=await import('../src/app.js');
 const f=await fixture(),g=await fixture(),root=await mkdtemp(join(tmpdir(),'ncwa-ai-test-'));const gateway=createGateway(()=>async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){}};},root,f.service);const app=createApp(gateway);
 try{
 const tokens=[randomUUID(),randomUUID()];for(const [i,account] of [f.id,g.id].entries())await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(tokens[i]),account]);const origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 await request(app).post('/sessions').set('Cookie','ncwa_session='+tokens[0]).set('Origin',origin).send({id:'shop'}).expect(200);
 await request(app).get('/sessions/shop/ai').set('Cookie','ncwa_session='+tokens[1]).expect(404);
 await request(app).post('/sessions').set('Cookie','ncwa_session='+tokens[1]).set('Origin',origin).send({id:'shop'}).expect(200);
 await request(app).put('/sessions/shop/ai').set('Cookie','ncwa_session='+tokens[0]).set('Origin',origin).send({enabled:true,knowledge:'Tenant A only',behavior:'',accountId:g.id}).expect(200);
 const other=await request(app).get('/sessions/shop/ai').set('Cookie','ncwa_session='+tokens[1]).expect(200);assert.equal(other.body.knowledge,'Produk tersedia');
 await request(app).put('/sessions/shop/ai').set('Cookie','ncwa_session='+tokens[0]).send({enabled:false,knowledge:'',behavior:''}).expect(403);
 }finally{await gateway.stop();await rm(root,{recursive:true,force:true});}
});

test('Natural reply reads before AI, composes before random 1–3 second wait, then sends and pauses',async()=>{
 const events:string[]=[];const f=await fixture(async()=>{events.push('generate');return 'Jawaban';},false,async ms=>{assert.ok(Number.isInteger(ms)&&ms>=1000&&ms<=3000);events.push('wait');},events);
 await f.service.incoming(f.id,f.manager,'shop',f.message('natural'));
 assert.deepEqual(events,['read:628123456789@s.whatsapp.net:natural','generate','composing','wait','send','paused']);
 await f.service.incoming(f.id,f.manager,'shop',f.message('natural'));assert.equal(events.length,6);assert.equal((await basicWallet(f.id)).balance,99);
});
test('Typing ends after send failure or cancellation during the delay',async()=>{
 const failed:string[]=[];const f=await fixture(undefined,true,async()=>{},failed);await f.service.incoming(f.id,f.manager,'shop',f.message('failed'));assert.equal(failed.at(-1),'paused');assert.equal((await rows(f.id))[0].status,'send_failed');
 const events:string[]=[];const g=await fixture(undefined,false,async()=>{await g.service.conversation(g.id,'shop','628123456789',{paused:true});},events);await g.service.incoming(g.id,g.manager,'shop',g.message('cancel'));
 assert.deepEqual(events,['read:628123456789@s.whatsapp.net:cancel','composing','paused']);assert.equal(g.sent(),0);assert.equal((await rows(g.id))[0].status,'cancelled');assert.equal((await basicWallet(g.id)).balance,100);
});
test('Read/presence failures do not prevent a reply or change AI billing',async()=>{
 const events:string[]=[];const f=await fixture(undefined,false,async()=>{},events,true);await f.service.incoming(f.id,f.manager,'shop',f.message('presence'));assert.equal(f.sent(),1);assert.equal(events.at(-1),'paused');assert.equal((await rows(f.id))[0].status,'sent');
});

test('Manual reply pauses only its conversation, enters memory, and duplicate events cannot pause again after resume',async()=>{
 const f=await fixture();await f.service.incoming(f.id,f.manager,'shop',f.message('before'));
 const manual=f.message('manual','Saya bantu langsung');await f.service.manualOutgoing(f.id,'shop',manual);
 const [memory]=await db.execute<any[]>('SELECT paused,messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[f.id,'shop',manual.from]);assert.equal(memory[0].paused,1);const messages=typeof memory[0].messages==='string'?JSON.parse(memory[0].messages):memory[0].messages;assert.equal(messages.at(-1).content,'Saya bantu langsung');assert.ok(messages.length<=3);
 const count=f.sent();await f.service.incoming(f.id,f.manager,'shop',f.message('after'));assert.equal(f.sent(),count);
 await f.service.incoming(f.id,f.manager,'shop',f.message('other','Halo','628999999999'));assert.equal(f.sent(),count+1);
 await f.service.conversation(f.id,'shop',manual.from,{paused:false});await f.service.manualOutgoing(f.id,'shop',manual);const conversations=await f.service.conversations(f.id,'shop') as any[];assert.equal(conversations.find(c=>c.customer===manual.from).paused,0);
});
test('Persisted system IDs ignore early echoes and survive service restart; same ID in another account is independent',async()=>{
 const f=await fixture();await f.service.registerSystemMessage(f.id,'shop','system-id');
 const restarted=new FixtureAI(async()=> 'OK',async()=>{});await restarted.manualOutgoing(f.id,'shop',f.message('system-id'));assert.equal((await f.service.conversations(f.id,'shop')).length,0);
 const g=await fixture();await g.service.manualOutgoing(g.id,'shop',g.message('system-id'));const rows=await g.service.conversations(g.id,'shop') as any[];assert.equal(rows[0].paused,1);
});
test('Manual reply during generation cancels AI dispatch but retains the valid generated-answer charge',async()=>{
 const f=await fixture(async()=>{await f.service.manualOutgoing(f.id,'shop',f.message('manual-during','Admin mengambil alih'));return 'Jawaban AI';});
 await f.service.incoming(f.id,f.manager,'shop',f.message('incoming'));assert.equal(f.sent(),0);const usage=await rows(f.id);assert.equal(usage[0].status,'cancelled');assert.ok(usage[0].charged>0);assert.equal((await basicWallet(f.id)).balance,100);
});
test('Manual media pauses conversation, but groups and disabled assistants are ignored',async()=>{
 const f=await fixture();await f.service.manualOutgoing(f.id,'shop',{...f.message('group'),isGroup:true});assert.equal((await f.service.conversations(f.id,'shop')).length,0);
 await f.service.manualOutgoing(f.id,'shop',{...f.message('image','Foto produk'),type:'image'});assert.equal((await f.service.conversations(f.id,'shop') as any[])[0].paused,1);
 await f.service.saveAssistant(f.id,'shop',{enabled:false,knowledge:'',behavior:''});await f.service.manualOutgoing(f.id,'shop',f.message('disabled','Halo','628999999999'));assert.equal((await f.service.conversations(f.id,'shop')).length,1);
});
