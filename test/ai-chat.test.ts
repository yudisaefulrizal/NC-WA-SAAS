import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../src/gateway.js';
import {ApiError,type Update} from '../src/engine/sessions.js';
import {ai} from '../src/ai.js';
import {db} from '../src/db.js';
import {digest} from '../src/security.js';
import {basicWallet} from '../src/plans.js';
import {recordOutgoing,chatMessages} from '../src/ai-chat.js';

const root=await mkdtemp(join(tmpdir(),'ncwa-chat-'));const accounts:string[]=[];
// Fake WhatsApp: remembers each session's update callback and, like the Baileys connector, registers
// every send as a system message before "dispatching" it.
const updates=new Map<string,(event:Update)=>void>();let sequence=0;
const gateway=createGateway(account=>async(session,update)=>{updates.set(account+'/'+session,update);update({status:'connected'});return {close(){},async logout(){},async typing(){},async read(){},async send(){const id='OUT'+(++sequence);await ai.registerSystemMessage(account,session,id);return id;}};},root);
const app=express();app.use(express.json());app.use(gateway.router);app.use((e:Error,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof ApiError?e.status:500).json({error:e instanceof ApiError?e.code:'internal_error'}));
after(async()=>{await gateway.stop();for(const id of accounts){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();await rm(root,{recursive:true,force:true});});
const customer='628123456789';
async function tenant(){
 const id=randomUUID(),key=randomUUID();accounts.push(id);
 await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);
 await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[randomUUID(),id,digest(key)]);await basicWallet(id);
 await request(app).post('/sessions').set('X-API-Key',key).send({id:'shop'}).expect(200);
 await ai.saveAssistant(id,'shop',{enabled:true,profile:{},behavior:''});
 const send=(event:Update)=>updates.get(id+'/shop')!(event);
 const history=async()=>(await chatMessages(id,'shop',customer)).messages;
 return {id,key,send,history};
}
const incoming=(messageId:string,text:string,extra:Record<string,unknown>={})=>({messageId,text,from:customer,sender:customer,isGroup:false,groupId:null,type:'text' as const,timestamp:1,...extra});
async function eventually<T>(read:()=>Promise<T>,ok:(value:T)=>boolean){for(let i=0;i<100;i++){const value=await read();if(ok(value))return value;await new Promise(r=>setTimeout(r,20));}return read();}

test('Incoming, API, phone and dashboard messages form one ordered history with origins, receipts and notes',async()=>{
 const t=await tenant();
 t.send({incoming:incoming('IN1','Halo kak, mau pesan')});
 t.send({incoming:incoming('IN2','',{type:'image'})});
 let messages=await eventually(t.history,m=>m.length===2);
 assert.deepEqual(messages.map(m=>[m.id,m.direction,m.origin,m.text]),[['IN1','in','customer','Halo kak, mau pesan'],['IN2','in','customer','[Gambar]']]);

 // An API send is recorded once; its echo from the phone is known as a system send, not a manual reply.
 const sent=(await request(app).post('/sessions/shop/messages/text').set('X-API-Key',t.key).send({to:customer,text:'Promo hari ini'}).expect(200)).body;
 t.send({outgoing:incoming(sent.messageId,'Promo hari ini')});
 messages=await eventually(t.history,m=>m.length===3);
 assert.deepEqual(messages.slice(-1).map(m=>[m.id,m.direction,m.origin,m.status]),[[sent.messageId,'out','api','sent']]);
 assert.equal((await db.execute<any[]>('SELECT paused FROM ai_conversations WHERE account_id=? AND customer=?',[t.id,customer]))[0][0]?.paused??0,0);

 // Receipts only move forward.
 t.send({receipt:{messageId:sent.messageId,to:customer,status:'delivered'}});
 await eventually(t.history,m=>m.at(-1)?.status==='delivered');
 t.send({receipt:{messageId:sent.messageId,to:customer,status:'sent'}});t.send({receipt:{messageId:sent.messageId,to:customer,status:'read'}});
 assert.equal((await eventually(t.history,m=>m.at(-1)?.status==='read')).at(-1)?.status,'read');

 // A reply typed on the phone is manual, pauses the AI and leaves a note.
 t.send({outgoing:incoming('PHONE1','Sebentar kak saya cek')});
 messages=await eventually(t.history,m=>m.length===5);
 assert.deepEqual(messages.slice(-2).map(m=>[m.direction,m.origin,m.text]),[['out','manual','Sebentar kak saya cek'],['note','system','AI dijeda karena ada balasan manual']]);

 // Admin resumes, then replies from the dashboard: billed once, manual, AI paused again, retry-safe.
 await request(app).put('/sessions/shop/ai/conversations/'+customer).set('X-API-Key',t.key).send({paused:false,full_auto:false}).expect(200);
 const before=(await basicWallet(t.id)).balance;
 await request(app).post('/sessions/shop/ai/chats/'+customer+'/messages').set('X-API-Key',t.key).send({text:'Sudah siap kak'}).expect(400);
 const reply=(await request(app).post('/sessions/shop/ai/chats/'+customer+'/messages').set('X-API-Key',t.key).set('Idempotency-Key','reply-1').send({text:'Sudah siap kak'}).expect(200)).body;
 const again=(await request(app).post('/sessions/shop/ai/chats/'+customer+'/messages').set('X-API-Key',t.key).set('Idempotency-Key','reply-1').send({text:'Sudah siap kak'}).expect(200)).body;
 assert.equal(again.messageId,reply.messageId);assert.equal((await basicWallet(t.id)).balance,before-1);
 messages=await eventually(t.history,m=>m.some(x=>x.id===reply.messageId&&x.origin==='manual')&&m.at(-1)?.direction==='note');
 assert.deepEqual(messages.slice(-3).map(m=>[m.direction,m.origin,m.text]),[['note','system','AI dilanjutkan oleh admin'],['out','manual','Sudah siap kak'],['note','system','AI dijeda karena ada balasan manual']]);
 const [conversation]=await db.execute<any[]>('SELECT paused,messages FROM ai_conversations WHERE account_id=? AND customer=?',[t.id,customer]);
 assert.equal(conversation[0].paused,1);
 const memory=typeof conversation[0].messages==='string'?JSON.parse(conversation[0].messages):conversation[0].messages;
 assert.equal(memory.filter((m:any)=>m.content==='Sudah siap kak').length,1);

 // Full auto and clearing context are noted too; clearing the AI memory keeps the chat history.
 await request(app).put('/sessions/shop/ai/conversations/'+customer).set('X-API-Key',t.key).send({paused:false,full_auto:true}).expect(200);
 await request(app).put('/sessions/shop/ai/conversations/'+customer).set('X-API-Key',t.key).send({paused:false,clear:true}).expect(200);
 messages=await t.history();
 assert.deepEqual(messages.filter(m=>m.direction==='note').slice(-3).map(m=>m.text),['AI dilanjutkan oleh admin','Full auto diaktifkan','Konteks AI dihapus; riwayat chat tetap tersimpan']);
 assert.ok(messages.some(m=>m.id==='IN1'));
});

test('Chat list orders by latest activity, pages history, and stays inside its tenant',async()=>{
 const t=await tenant(),other=await tenant();
 t.send({incoming:{...incoming('A1','Pesan lama'),from:'628111111111',sender:'628111111111'}});
 await eventually(async()=>(await chatMessages(t.id,'shop','628111111111')).messages,m=>m.length===1);
 t.send({incoming:incoming('B1','Pesan terbaru')});
 await eventually(t.history,m=>m.length===1);
 // Groups never enter the history.
 t.send({incoming:{...incoming('G1','Pesan grup'),isGroup:true,groupId:'123@g.us'}});
 const list=(await request(app).get('/sessions/shop/ai/chats').set('X-API-Key',t.key).expect(200)).body;
 assert.deepEqual(list.map((c:any)=>[c.customer,c.last.text]),[[customer,'Pesan terbaru'],['628111111111','Pesan lama']]);
 assert.equal(list[0].paused,false);
 assert.deepEqual((await request(app).get('/sessions/shop/ai/chats').set('X-API-Key',other.key).expect(200)).body,[]);
 assert.deepEqual((await request(app).get('/sessions/shop/ai/chats/'+customer+'/messages').set('X-API-Key',other.key).expect(200)).body.messages,[]);

 for(let i=0;i<104;i++)await db.execute("INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,text,created_at) VALUES (?,?,?,?,'in','customer',?,DATE_SUB(NOW(3),INTERVAL ? SECOND))",[t.id,'shop',customer,'OLD'+String(i).padStart(3,'0'),'Lama '+i,200-i]);
 const first=(await request(app).get('/sessions/shop/ai/chats/'+customer+'/messages').set('X-API-Key',t.key).expect(200)).body;
 assert.equal(first.messages.length,100);assert.equal(first.messages.at(-1).id,'B1');assert.ok(first.before);
 const second=(await request(app).get('/sessions/shop/ai/chats/'+customer+'/messages?before='+encodeURIComponent(first.before)).set('X-API-Key',t.key).expect(200)).body;
 assert.equal(second.messages.length,5);assert.equal(second.before,null);
 assert.equal(new Set([...first.messages,...second.messages].map((m:any)=>m.id)).size,105);
 assert.deepEqual(second.messages.map((m:any)=>m.id),['OLD000','OLD001','OLD002','OLD003','OLD004']);
 await request(app).get('/sessions/shop/ai/chats/'+customer+'/messages?before=rusak').set('X-API-Key',t.key).expect(400);
 await request(app).get('/sessions/shop/ai/chats/abc/messages').set('X-API-Key',t.key).expect(400);
});

test('A known origin is never downgraded by the generic send record, in either order',async()=>{
 const t=await tenant();
 await recordOutgoing(t.id,'shop',{customer,messageId:'X1',origin:'ai',text:'Jawaban AI'});
 await recordOutgoing(t.id,'shop',{customer,messageId:'X1',origin:'api',text:'Jawaban AI'});
 await recordOutgoing(t.id,'shop',{customer,messageId:'X2',origin:'api',text:'Balasan'});
 await recordOutgoing(t.id,'shop',{customer,messageId:'X2',origin:'manual',text:'Balasan'});
 assert.deepEqual((await t.history()).map(m=>[m.id,m.origin]),[['X1','ai'],['X2','manual']]);
});
