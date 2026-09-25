import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createGateway} from '../../../src/http/gateway.js';
import {type Update} from '../../../src/components/whatsapp/domain/sessions.js';
import {ApiError} from '../../../src/libraries/errors.js';
import type {Outbound} from '../../../src/components/whatsapp/domain/messages.js';
import {AIService} from '../../../src/components/ai/domain/service.js';
import {defaults,type AITransport,type AIMessage} from '../../../src/components/ai/domain/provider.js';
import {setProfileEnabled,clientProfiles,workflowState,changeWorkflow} from '../../../src/components/ai/domain/profiles/registry.js';
import {AIStudio} from '../../../src/components/ai/domain/studio.js';
import {eduTool} from '../../../src/components/ai/domain/profiles/pendidikan/tools.js';
import {documentType} from '../../../src/components/ai/domain/profiles/pendidikan/store.js';
import {chatMessages} from '../../../src/components/ai/domain/chat.js';
import {db} from '../../../src/libraries/db.js';
import {digest} from '../../../src/libraries/security.js';
import {basicWallet} from '../../../src/components/billing/domain/plans.js';

const root=await mkdtemp(join(tmpdir(),'ncwa-edu-'));const accounts:string[]=[];
// Router sends everything to Program; Program sends the brochure once, then answers. Every call is kept.
const calls:{role?:string;messages:AIMessage[]}[]=[];
const transport:AITransport=async(config,messages)=>{
 calls.push({role:config.call_role,messages});
 const latest=messages.filter(m=>m.role==='user').at(-1)!.content;
 if(config.call_role==='router')return JSON.stringify({s_p_o_konteks:'wali menanyakan program',sub_agent:'program',isi_pesan:latest});
 if(config.call_role==='context')return 'wali-menanyakan-brosur-program';
 const results=messages.filter(m=>m.role==='system'&&m.content.startsWith('Tool result kirim_dokumen'));
 if(results.length)return JSON.stringify({answer:results.at(-1)!.content.includes('"available":true')?'Ini brosurnya.':'Brosurnya sudah dikirim di atas.'});
 return JSON.stringify({tool:'kirim_dokumen',query:'brosur.pdf'});
};
class FixtureAI extends AIService {override async config(){return {...defaults,secret:'fixture',memory_limit:60};}}
const service=new FixtureAI(transport,async()=>{});
const updates=new Map<string,(event:Update)=>void>(),sent:{account:string;content:Outbound;file?:Buffer}[]=[];let sequence=0;
const gateway=createGateway(account=>async(session,update)=>{updates.set(account+'/'+session,update);update({status:'connected'});return {close(){},async logout(){},async typing(){},async read(){},async send(_jid:string,content:Outbound){const id='OUT'+(++sequence);sent.push({account,content,file:'url' in content?await readFile(content.url):undefined});await service.registerSystemMessage(account,session,id);return id;}};},root,service);
const app=express();app.use(express.json({limit:'64kb'}));app.use(gateway.router);app.use((e:Error,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof ApiError?e.status:(e as {status?:number}).status??500).json({error:e instanceof ApiError?e.code:'internal_error',message:e.message}));
const owner=randomUUID();accounts.push(owner);
await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')",[owner,owner+'@test.invalid','unused']);
const [before]=await db.query<any[]>("SELECT enabled FROM ai_profile_types WHERE id='pendidikan'");
const [workflowBefore]=await db.query<any[]>("SELECT * FROM ai_workflow WHERE profile_type='pendidikan'");
after(async()=>{
 await setProfileEnabled(owner,'pendidikan',Boolean(before[0]?.enabled));
 if(!workflowBefore[0])await db.query("DELETE FROM ai_workflow WHERE profile_type='pendidikan'");
 await gateway.stop();for(const id of accounts){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();await rm(root,{recursive:true,force:true});
});
const customer='628123456789';
async function tenant(sessions=['psb']){
 const id=randomUUID(),key=randomUUID();accounts.push(id);
 await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);
 await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)',[randomUUID(),id,digest(key)]);
 await basicWallet(id);await db.execute('UPDATE wallets SET session_limit=5 WHERE account_id=?',[id]);
 await service.adjust(id,id,{amount:100000,reason:'fixture',requestId:'fixture'});
 const api=(method:'get'|'post'|'put'|'patch'|'delete',path:string)=>request(app)[method](path).set('X-API-Key',key);
 for(const session of sessions)await api('post','/sessions').send({id:session}).expect(200);
 const send=(session:string,messageId:string,text:string)=>updates.get(id+'/'+session)!({incoming:{messageId,text,from:customer,sender:customer,isGroup:false,groupId:null,type:'text',timestamp:1}});
 return {id,api,send};
}
async function eventually<T>(read:()=>Promise<T>,ok:(value:T)=>boolean){for(let i=0;i<150;i++){const value=await read();if(ok(value))return value;await new Promise(r=>setTimeout(r,20));}return read();}
const pdf=Buffer.from('%PDF-1.4\n% brosur uji\n%%EOF\n');
const upload=(t:Awaited<ReturnType<typeof tenant>>,path:string,file:Buffer,name:string,description:string,method:'post'|'put'='post')=>t.api(method,path).set('Content-Type','application/octet-stream').set('X-Filename',encodeURIComponent(name)).set('X-Description',encodeURIComponent(description)).send(file);
const files=async(account:string)=>(await readdir(join(root,'_ai-documents',account)).catch(()=>[] as string[])).filter(f=>!f.endsWith('.part'));

test('CS Lembaga Pendidikan starts switched off; once on, clients create data profiles with the institution kind',async()=>{
 const t=await tenant();
 await setProfileEnabled(owner,'pendidikan',false);
 assert.deepEqual((await clientProfiles(t.id)).map(p=>p.id),['cs']);
 await t.api('post','/ai/data-profiles').send({profile_type:'pendidikan',name:'Sekolah A'}).expect(409);
 await setProfileEnabled(owner,'pendidikan',true);
 const types=(await t.api('get','/ai/profile-types').expect(200)).body;
 assert.deepEqual(types.find((p:any)=>p.id==='pendidikan').tabs,['knowledge','usage','trial']);
 const created=(await t.api('post','/ai/data-profiles').send({profile_type:'pendidikan',name:"Ma'had Darul Ilmi"}).expect(201)).body;
 assert.deepEqual([created.profile_type,created.knowledge,created.edu],['pendidikan','',{lembaga:'',jadwal:''}]);
 // Text fields: each profile accepts only its own; FAQ is longer for an institution than for CS.
 const base='/ai/data-profiles/'+created.id;
 await t.api('patch',base+'/field').send({field:'edu_lembaga',value:'Pesantren di Lembang.'}).expect(200);
 await t.api('patch',base+'/field').send({field:'edu_jadwal',value:'J'.repeat(8000)}).expect(200);
 await t.api('patch',base+'/field').send({field:'edu_jadwal',value:'J'.repeat(8001)}).expect(400);
 await t.api('patch',base+'/field').send({field:'faq',value:'F'.repeat(4000)}).expect(200);
 await t.api('patch',base+'/field').send({field:'edu_kind',value:'kampus'}).expect(400);
 await t.api('patch',base+'/field').send({field:'edu_peserta',value:'mahasantri'}).expect(400);
 const updated=(await t.api('patch',base+'/field').send({field:'behavior',value:'Sebut peserta didik sebagai mahasantri.'}).expect(200)).body;
 assert.deepEqual([updated.behavior,updated.edu.lembaga,updated.profile.faq.length],['Sebut peserta didik sebagai mahasantri.','Pesantren di Lembang.',4000]);
 await t.api('patch',base+'/field').send({field:'usaha',value:'Toko'}).expect(400);
 await t.api('patch',base+'/field').send({field:'products_source',value:{mode:'builtin'}}).expect(400);
 const cs=(await t.api('post','/ai/data-profiles').send({profile_type:'cs',name:'Kantin'}).expect(201)).body;
 await t.api('patch','/ai/data-profiles/'+cs.id+'/field').send({field:'edu_jadwal',value:'x'}).expect(400);
 await t.api('patch','/ai/data-profiles/'+cs.id+'/field').send({field:'faq',value:'F'.repeat(2001)}).expect(400);
 // Products and orders stay CS data; education data stays education data.
 await t.api('post',base+'/products').send({name:'Buku',type:'product',description:'',price:1,stock:1,active:true}).expect(409);
 await t.api('post','/ai/data-profiles/'+cs.id+'/programs').send({name:'Tahfidz',description:''}).expect(409);
 await t.api('put','/sessions/psb/ai/profile').send({data_profile_id:created.id}).expect(200);
 await t.api('put','/sessions/psb/ai').send({enabled:true,profile:{},behavior:''}).expect(409);
 const summary=(await t.api('get','/ai/data-profiles').expect(200)).body.find((p:any)=>p.id===created.id);
 assert.deepEqual([summary.profile_name,summary.programs,summary.documents,summary.contacts,summary.sessions],['CS Lembaga Pendidikan',0,0,0,['psb']]);
});

test('Programs, contacts and documents are kept per data profile with limits, and never leak across accounts',async()=>{
 const t=await tenant(),other=await tenant(['lain']);
 const profile=(await t.api('post','/ai/data-profiles').send({profile_type:'pendidikan',name:'SMA Uji'}).expect(201)).body,base='/ai/data-profiles/'+profile.id;
 const program=(await t.api('post',base+'/programs').send({name:'IPA',description:'Biaya Rp 500.000 per bulan.'}).expect(201)).body;
 await t.api('post',base+'/programs').send({name:'ipa',description:''}).expect(409);
 await t.api('post',base+'/programs').send({name:'',description:''}).expect(400);
 await t.api('post',base+'/programs').send({name:'IPS',description:'D'.repeat(4001)}).expect(400);
 await t.api('put',base+'/programs/'+program.id).send({name:'IPA Unggulan',description:'Biaya Rp 600.000.'}).expect(200);
 await t.api('post',base+'/programs').send({name:'IPS',description:''}).expect(201);
 assert.deepEqual((await t.api('get',base+'/programs').expect(200)).body.map((p:any)=>p.name),['IPA Unggulan','IPS']);
 await other.api('get',base+'/programs').expect(404);
 await other.api('put',base+'/programs/'+program.id).send({name:'X',description:''}).expect(404);
 const contact=(await t.api('post',base+'/contacts').send({bagian:'Keuangan',kontak:'0812-7000-5566',deskripsi:'Pembayaran SPP'}).expect(201)).body;
 await t.api('post',base+'/contacts').send({bagian:'Pendaftaran',kontak:'',deskripsi:''}).expect(400);
 await t.api('put',base+'/contacts/'+contact.id).send({bagian:'Keuangan',kontak:'0812-7000-0000',deskripsi:'SPP dan keringanan biaya'}).expect(200);
 assert.deepEqual((await t.api('get',base+'/contacts').expect(200)).body.map((c:any)=>[c.bagian,c.kontak]),[['Keuangan','0812-7000-0000']]);
 // Documents: real type from the bytes, image up to 5 MB, other files up to 10 MB, a description required.
 const brochure=(await upload(t,base+'/documents',pdf,'brosur.pdf','Brosur umum').expect(201)).body;
 assert.deepEqual([brochure.media_type,brochure.mimetype,brochure.filename],['document','application/pdf','brosur.pdf']);
 const png=await sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).png().toBuffer();
 const image=(await upload(t,base+'/documents',png,'denah.png','Denah lokasi').expect(201)).body;
 assert.deepEqual([image.media_type,image.mimetype],['image','image/png']);
 const zip=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(40)]);
 assert.equal((await upload(t,base+'/documents',zip,'formulir.docx','Formulir').expect(201)).body.mimetype,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 await upload(t,base+'/documents',zip,'arsip.zip','Arsip').expect(400);
 await upload(t,base+'/documents',Buffer.from('halo'),'catatan.txt','Catatan').expect(400);
 await upload(t,base+'/documents',pdf,'tanpa.pdf','').expect(400);
 await upload(t,base+'/documents',Buffer.concat([pdf,Buffer.alloc(10*1024*1024)]),'besar.pdf','Terlalu besar').expect(413);
 assert.equal((await files(t.id)).length,3);
 // Ganti file keeps the document and its description; the old file is removed.
 const replaced=(await upload(t,base+'/documents/'+brochure.id+'/file',png,'brosur-baru.png','','put').expect(200)).body;
 assert.deepEqual([replaced.id,replaced.filename,replaced.media_type],[brochure.id,'brosur-baru.png','image']);
 assert.equal((await files(t.id)).length,3);
 await t.api('patch',base+'/documents/'+brochure.id).send({description:'Brosur PSB 2027'}).expect(200);
 const download=await t.api('get',base+'/documents/'+brochure.id+'/file').expect(200);
 assert.deepEqual([download.headers['content-type'],download.headers['content-disposition']],['image/png',"inline; filename*=UTF-8''brosur-baru.png"]);
 await other.api('get',base+'/documents/'+brochure.id+'/file').expect(404);
 const listed=(await t.api('get',base+'/documents').expect(200)).body;assert.deepEqual(listed.map((d:any)=>[d.filename,d.description]),[['brosur-baru.png','Brosur PSB 2027'],['denah.png','Denah lokasi'],['formulir.docx','Formulir']]);
 // The same data is reachable through a session that runs this data profile.
 await t.api('put','/sessions/psb/ai/profile').send({data_profile_id:profile.id}).expect(200);
 assert.equal((await t.api('get','/sessions/psb/ai/documents').expect(200)).body.length,3);
 // Duplicating copies every file separately; deleting either data profile keeps the other's files.
 const copy=(await t.api('post','/ai/data-profiles').send({name:'Salinan SMA',copy_from:profile.id}).expect(201)).body;
 assert.deepEqual([(await t.api('get','/ai/data-profiles/'+copy.id+'/programs').expect(200)).body.length,(await t.api('get','/ai/data-profiles/'+copy.id+'/contacts').expect(200)).body.length,(await t.api('get','/ai/data-profiles/'+copy.id+'/documents').expect(200)).body.length],[2,1,3]);
 assert.equal((await files(t.id)).length,6);
 await t.api('delete','/ai/data-profiles/'+copy.id).expect(200);
 assert.equal((await files(t.id)).length,3);
 await t.api('delete',base+'/documents/'+image.id).expect(200);
 assert.equal((await files(t.id)).length,2);
 await t.api('delete',base+'/programs/'+program.id).expect(200);await t.api('delete',base+'/contacts/'+contact.id).expect(200);
 // At most 20 documents and 100 MB per data profile; a refused upload leaves no file behind.
 const limited=(await t.api('post','/ai/data-profiles').send({profile_type:'pendidikan',name:'Batas Dokumen'}).expect(201)).body,limitBase='/ai/data-profiles/'+limited.id,before=(await files(t.id)).length;
 await db.execute('INSERT INTO ai_edu_documents(id,account_id,data_profile_id,filename,mimetype,media_type,size_bytes,description,position) VALUES (?,?,?,?,?,?,?,?,1)',[randomUUID(),t.id,limited.id,'besar.pdf','application/pdf','document',100*1024*1024-10,'Isian kuota']);
 await upload(t,limitBase+'/documents',pdf,'lebih.pdf','Melewati kuota').expect(409);
 await db.execute('DELETE FROM ai_edu_documents WHERE data_profile_id=?',[limited.id]);
 for(let i=0;i<20;i++)await db.execute('INSERT INTO ai_edu_documents(id,account_id,data_profile_id,filename,mimetype,media_type,size_bytes,description,position) VALUES (?,?,?,?,?,?,?,?,?)',[randomUUID(),t.id,limited.id,'d'+i+'.pdf','application/pdf','document',1,'Isian',i]);
 await upload(t,limitBase+'/documents',pdf,'ke21.pdf','Dokumen ke-21').expect(409);
 assert.equal((await files(t.id)).length,before);
});

test('A session on CS Lembaga Pendidikan answers from live data, sends a document once, then the text answer',async()=>{
 const t=await tenant();
 const profile=(await t.api('post','/ai/data-profiles').send({profile_type:'pendidikan',name:'Pesantren Uji'}).expect(201)).body,base='/ai/data-profiles/'+profile.id;
 await t.api('post',base+'/programs').send({name:'Tahfidz',description:'Biaya Rp 1.250.000 per bulan.'}).expect(201);
 await upload(t,base+'/documents',pdf,'brosur.pdf','Brosur program tahfidz').expect(201);
 await t.api('put','/sessions/psb/ai/profile').send({data_profile_id:profile.id,enabled:true}).expect(200);
 calls.length=0;const before=sent.filter(s=>s.account===t.id).length;
 t.send('psb','E1','Ada brosur tahfidz?');
 const mine=()=>Promise.resolve(sent.filter(s=>s.account===t.id).slice(before));
 const out=await eventually(mine,v=>v.length===2);
 // The document goes first, as a file with its name, then the answer.
 const [document,answer]=out;
 assert.deepEqual('type' in document.content?[document.content.type,document.content.filename,document.content.mimetype]:[],['document','brosur.pdf','application/pdf']);
 assert.deepEqual(document.file,pdf);
 assert.deepEqual('text' in answer.content?answer.content.text:'','Ini brosurnya.');
 // Router and specialist are told who they speak for and how to address people.
 assert.ok(calls.find(c=>c.role==='router')!.messages[0].content.includes('Anda melayani lembaga pendidikan "Pesantren Uji".'));
 assert.ok(calls.find(c=>c.role==='program')!.messages.some(m=>m.role==='system'&&m.content.includes('Tools tersedia: get_program, get_dokumen, kirim_dokumen')));
 const history=await eventually(()=>chatMessages(t.id,'psb',customer),h=>h.messages.filter(m=>m.origin==='ai').length===2);
 assert.deepEqual(history.messages.filter(m=>m.origin==='ai').map(m=>[m.type,m.text]),[['document','brosur.pdf'],['text','Ini brosurnya.']]);
 const readMemory=async()=>{const [conversation]=await db.execute<any[]>('SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',[t.id,'psb',customer]);return (typeof conversation[0].messages==='string'?JSON.parse(conversation[0].messages):conversation[0].messages).map((m:AIMessage)=>m.content) as string[];};
 const memory=await eventually(readMemory,m=>m.length===3);
 assert.deepEqual(memory,['Ada brosur tahfidz?','[Dokumen terkirim: brosur.pdf]','Ini brosurnya.']);
 const [usage]=await db.execute<any[]>('SELECT profile_type,data_profile_id,status FROM ai_usage WHERE account_id=?',[t.id]);
 assert.deepEqual(usage.map(u=>[u.profile_type,u.data_profile_id,u.status]),[['pendidikan',profile.id,'sent']]);
 // Asking again: the tool refuses the repeat, so only the text answer goes out.
 t.send('psb','E2','Kirim brosurnya lagi dong');
 const again=await eventually(mine,v=>v.length===3);
 assert.deepEqual(again.slice(2).map(s=>'text' in s.content?s.content.text:s.content.type),['Brosurnya sudah dikirim di atas.']);
 // Uji Coba lists the document it would send and sends nothing.
 const trial=await service.trial(t.id,{data_profile:profile.id,question:'Minta brosur'});
 assert.deepEqual([trial.answer,trial.documents],['Ini brosurnya.',['brosur.pdf']]);
 assert.equal((await mine()).length,3);
 // The owner switching the profile off stops the AI; the data profile stays.
 await setProfileEnabled(owner,'pendidikan',false);
 t.send('psb','E3','Halo');await new Promise(r=>setTimeout(r,300));
 assert.equal((await mine()).length,3);
 await setProfileEnabled(owner,'pendidikan',true);
});

test('Education tools answer from the data they are given and limit what reaches the model',()=>{
 const data={lembaga:'Profil',faq:'',jadwal:'Tes Sabtu',programs:[{name:'Tahfidz Putra',description:'Biaya A '+'x'.repeat(300)},{name:'MA',description:''}],contacts:[{bagian:'Keuangan',kontak:'0812',deskripsi:'SPP'}],documents:[{id:'d1',filename:'brosur.pdf',media_type:'document' as const,description:'Brosur'}]};
 assert.deepEqual(eduTool('get_program','tahfidz putra',data),{program:[{nama:'Tahfidz Putra',deskripsi:data.programs[0].description}]});
 const list=eduTool('get_program','',data) as any;assert.equal(list.daftar_program[0].ringkasan.length,160);assert.equal(list.daftar_program[1].nama,'MA');
 assert.deepEqual((eduTool('get_jadwal','',data) as any).jadwal,'Tes Sabtu');
 assert.deepEqual(eduTool('get_dokumen','',data,['brosur.pdf']),{dokumen:[{nama_file:'brosur.pdf',jenis:'dokumen',deskripsi:'Brosur',sudah_dikirim:true}]});
 assert.deepEqual(eduTool('kirim_dokumen','brosur.pdf',data),{available:true,nama_file:'brosur.pdf',document_id:'d1',jenis:'dokumen'});
 assert.equal((eduTool('kirim_dokumen','brosur.pdf',data,['brosur.pdf']) as any).available,false);
 assert.equal((eduTool('kirim_dokumen','lain.pdf',data) as any).available,false);
 const ole=Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1,0,0]);
 assert.deepEqual(documentType(ole,'formulir.doc'),{media_type:'document',mimetype:'application/msword'});
 assert.throws(()=>documentType(ole,'formulir.exe'));
});

test('The education pipeline has its own workflow and AI Studio simulation',async()=>{
 const state=await workflowState('pendidikan');
 assert.deepEqual(Object.keys(state.draft.nodes).sort(),['context','jadwal','kontak','lainnya','pembuka','penutup','profil_lembaga','program','router'].sort());
 assert.deepEqual(state.allowedTools.kontak,['get_kontak']);
 assert.deepEqual((state.routerSchema.properties.sub_agent as {enum:string[]}).enum,['pembuka','profil_lembaga','program','jadwal','kontak','penutup','lainnya']);
 const draft=structuredClone(state.draft);draft.nodes.kontak.tools=['get_products'];
 await assert.rejects(changeWorkflow(owner,'pendidikan',{revision:state.revision,draft}),/Tool node kontak/);
 draft.nodes.kontak.tools=['get_kontak'];draft.nodes.program.prompt='Program uji khusus.';
 const saved=await changeWorkflow(owner,'pendidikan',{revision:state.revision,draft});
 const events:any[]=[];
 const studio=new AIStudio(transport,async()=>({...defaults,secret:'studio'}),async()=>{});
 const edu={name:'Pesantren Sim',lembaga:'Profil',jadwal:'',faq:'',programs:[{name:'Tahfidz',description:'Biaya'}],contacts:[],documents:[{nama_file:'brosur.pdf',jenis:'dokumen',deskripsi:'Brosur'}]};
 await studio.run(owner,{message:'Minta brosur',revision:saved.revision,profile_type:'pendidikan',edu,behavior:''},event=>events.push(event));
 const output=events.find(e=>e.node==='output');
 assert.deepEqual([output.state,output.output.answer,output.output.documents],['done','Ini brosurnya.',['brosur.pdf']]);
 assert.ok(events.some(e=>e.node==='kirim_dokumen'&&e.state==='done'));
 assert.ok(calls.at(-2)!.messages.some(m=>m.content.startsWith('Program uji khusus.')));
 // The same sandbox conversation remembers the sent document.
 events.length=0;await studio.run(owner,{message:'Lagi',session:output.session,revision:saved.revision,profile_type:'pendidikan',edu,behavior:''},event=>events.push(event));
 assert.deepEqual(events.find(e=>e.node==='output').output.documents,[]);
 await assert.rejects(studio.run(owner,{message:'x',revision:saved.revision,profile_type:'pendidikan',edu:{...edu,documents:[{nama_file:'a.pdf'},{nama_file:'a.pdf'}]},behavior:''},()=>{}),/unik/);
});
