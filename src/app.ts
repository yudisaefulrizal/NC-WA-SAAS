import {ai} from './ai.js';
import {studio as defaultStudio} from './ai-studio.js';
import {workflowState,changeWorkflow} from './ai-workflow.js';
import {createKey} from './keys.js';
import {payments as defaultPayments} from './payments.js';
import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {randomBytes,randomUUID} from 'node:crypto';
import type {RowDataPacket,ResultSetHeader} from 'mysql2';
import {db} from './db.js';
import {credentials,digest,hashPassword,verifyPassword} from './security.js';
import {basicWallet,ensureBasic,planInput} from './plans.js';
import {gateway as defaultGateway} from './gateway.js';
import {ApiError} from './engine/sessions.js';
import {referral as defaultReferral} from './referral.js';
export function createApp(gateway=defaultGateway,payments=defaultPayments,studio=defaultStudio,referral=defaultReferral){
const app=express();
const configuredOrigin=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:8067');
if(configuredOrigin.origin!==(process.env.APP_ORIGIN??'http://127.0.0.1:8067')||!['http:','https:'].includes(configuredOrigin.protocol))throw new Error('APP_ORIGIN harus berupa origin HTTP/HTTPS tanpa path');
if(process.env.NODE_ENV==='production'&&configuredOrigin.protocol!=='https:')throw new Error('Produksi memerlukan APP_ORIGIN HTTPS');
if(process.env.TRUST_PROXY_HOPS&&!/^[0-3]$/.test(process.env.TRUST_PROXY_HOPS))throw new Error('TRUST_PROXY_HOPS harus 0–3');
app.disable('x-powered-by');app.set('trust proxy',process.env.TRUST_PROXY_HOPS?Number(process.env.TRUST_PROXY_HOPS):false); app.use(helmet());const normalJson=express.json({limit:'16kb'}),assistantJson=express.json({limit:'64kb'}),studioJson=express.json({limit:'128kb'});app.use((req,res,next)=>(req.path.startsWith('/api/admin/ai/studio')?studioJson:req.method==='PUT'&&/^\/sessions\/[A-Za-z0-9_-]+\/ai$/.test(req.path)?assistantJson:normalJson)(req,res,next));
app.post('/payments/midtrans/notification',rateLimit({windowMs:60000,limit:120}),async(req,res)=>{const result=await payments.notification(req.body);await gateway.refresh();res.json(result);});
app.get('/public/plans',async(_req,res)=>{const [rows]=await db.query('SELECT id,name,price,credits,session_limit FROM plans WHERE active=TRUE');res.json(rows);});
app.get('/public/assets/:token',rateLimit({windowMs:60000,limit:120}),async(req,res)=>{const file=await gateway.shareAssets.getByToken(String(req.params.token));res.set('Content-Type',file.mimetype).set('Content-Disposition','inline').set('Cache-Control','public, max-age=3600').sendFile(file.path);});
const origin=process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
app.use(['/auto-share','/sessions','/stats','/webhooks','/media','/events'],rateLimit({windowMs:60000,limit:120}));
app.use((req,res,next)=>{if(['/stats','/sessions','/webhooks','/events'].includes(req.path)||['/auto-share/','/sessions/','/webhooks/','/media/'].some(prefix=>req.path.startsWith(prefix))){gateway.router(req,res,next);}else next();});
app.use(['/api','/sessions','/stats','/webhooks','/media','/events'],(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
app.use('/api',rateLimit({windowMs:60000,limit:120}));
app.use('/api', (req,res,next)=> {if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==origin){res.status(403).json({error:'invalid_origin'});return;}next();});
app.use('/api/auth',rateLimit({windowMs:900000,limit:20}));
const cookie=(req:express.Request)=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ncwa_session='))?.slice(13)??'';
app.post('/api/auth/register',async(req,res)=>{const input=credentials(req.body);if(!input){res.status(400).json({error:'invalid_request'});return;}try{const id=randomUUID();const hash=await hashPassword(input.password);const connection=await db.getConnection();try{await connection.beginTransaction();await connection.execute('INSERT INTO accounts (id,email,password_hash) VALUES (?,?,?)',[id,input.email,hash]);await ensureBasic(connection,id);await connection.commit();}catch(e){await connection.rollback();throw e;}finally{connection.release();}res.status(201).json({ok:true});}catch(e){if((e as {code:string}).code==='ER_DUP_ENTRY'){res.status(409).json({error:'account_exists'});return;}throw e;}});
app.post('/api/auth/login',async(req,res)=>{const input=credentials(req.body);if(!input){res.status(400).json({error:'invalid_request'});return;}const [rows]=await db.execute<RowDataPacket[]>('SELECT id,password_hash FROM accounts WHERE email=? AND suspended=FALSE',[input.email]);const fallback='00000000000000000000000000000000:'+ '00'.repeat(64);const valid=await verifyPassword(input.password,rows[0]?.password_hash??fallback);if(!valid||!rows[0]){res.status(401).json({error:'unauthorized'});return;}const token=randomBytes(32).toString('hex');await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))',[digest(token),rows[0].id]);res.cookie('ncwa_session',token,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),maxAge:86400000,path:'/'}).json({ok:true});});
// API-key authentication is separate from browser cookies and owner privileges.
app.get('/api/client/me',async(req,res)=>{
 const key=req.get('X-API-Key');
 if(!key){res.status(401).json({error:'unauthorized'});return;}
 const [rows]=await db.execute<RowDataPacket[]>('SELECT a.id,a.email FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',[digest(key)]);
 if(!rows[0]){res.status(401).json({error:'unauthorized'});return;}
 res.json(rows[0]);
});
app.use('/api',async(req,res,next)=>{const [rows]=await db.execute<RowDataPacket[]>('SELECT a.id,a.email,a.role FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',[digest(cookie(req))]);if(!rows[0]){res.status(401).json({error:'unauthorized'});return;}res.locals.account=rows[0];next();});
app.get('/api/me',(_req,res)=>res.json(res.locals.account));
app.post('/api/auth/logout',async(req,res)=>{await db.execute('DELETE FROM login_sessions WHERE token_hash=?',[digest(cookie(req))]);gateway.revoke(res.locals.account.id,digest(cookie(req)));res.clearCookie('ncwa_session',{path:'/'}).json({ok:true});});
app.put('/api/auth/password',async(req,res)=>{
 const currentPassword=req.body?.currentPassword,password=req.body?.password;
 if(typeof currentPassword!=='string'||typeof password!=='string'||password.length<6||password.length>128)throw new ApiError(400,'invalid_request','Password baru harus 6–128 karakter');
 const tokenHash=digest(cookie(req)),c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute<RowDataPacket[]>('SELECT password_hash FROM accounts WHERE id=? FOR UPDATE',[res.locals.account.id]);
  if(!rows[0]||!await verifyPassword(currentPassword,rows[0].password_hash))throw new ApiError(401,'unauthorized','Password saat ini tidak sesuai');
  await c.execute('UPDATE accounts SET password_hash=? WHERE id=?',[await hashPassword(password),res.locals.account.id]);await c.execute('DELETE FROM login_sessions WHERE account_id=? AND token_hash<>?',[res.locals.account.id,tokenHash]);await c.execute("INSERT INTO audit_events(account_id,action) VALUES (?,'password_changed_self')",[res.locals.account.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}res.json({ok:true});
});
app.get('/api/usage',async(_req,res)=>{const [rows]=await db.execute('SELECT r.request_id,r.status,r.created_at,o.message_id FROM credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id WHERE r.account_id=? ORDER BY r.created_at DESC LIMIT 100',[res.locals.account.id]);res.json(rows);});
app.get('/api/keys',async(_req,res)=>{const [rows]=await db.execute('SELECT id,created_at FROM api_keys WHERE account_id=?',[res.locals.account.id]);res.json(rows);});
app.post('/api/keys',async(req,res)=>{const {id,key}=await createKey(res.locals.account.id,digest(cookie(req)));res.status(201).json({id,key});});
app.post('/api/keys/:id/rotate',async(req,res)=>{const {id,key,revokedHash}=await createKey(res.locals.account.id,digest(cookie(req)),req.params.id);if(revokedHash)gateway.revoke(res.locals.account.id,revokedHash);res.json({id,key});});
app.delete('/api/keys/:id',async(req,res)=>{const [keys]=await db.execute<RowDataPacket[]>('SELECT key_hash FROM api_keys WHERE id=? AND account_id=?',[req.params.id,res.locals.account.id]);await db.execute('DELETE FROM api_keys WHERE id=? AND account_id=?',[req.params.id,res.locals.account.id]);if(keys[0])gateway.revoke(res.locals.account.id,keys[0].key_hash);res.json({ok:true});});
app.get('/api/admin/accounts',async(_req,res)=>{if(res.locals.account.role!=='owner'){res.status(403).json({error:'forbidden'});return;}const [rows]=await db.query<RowDataPacket[]>('SELECT id,email,role,suspended,created_at FROM accounts ORDER BY created_at DESC LIMIT 100');
 const [plans]=await db.query<RowDataPacket[]>('SELECT id,name FROM plans');
 const names=new Map(plans.map(plan=>[plan.id,plan.name]));
 const accounts=[];
 for(const account of rows){
  const wallet=await basicWallet(account.id);
  accounts.push({...account,plan_id:wallet.plan_id,plan_name:names.get(wallet.plan_id)??wallet.plan_id,balance:wallet.balance,expires_at:wallet.expires_at});
 }
 res.json(accounts);});
app.get('/api/payments',async(_req,res)=>res.json(await payments.list(res.locals.account.id)));
app.post('/api/payments',async(req,res)=>res.json(await payments.create(res.locals.account.id,req.body?.planId)));
app.get('/api/payments/:id',async(req,res)=>res.json(await payments.order(res.locals.account.id,req.params.id)));
app.post('/api/payments/:id/check',async(req,res)=>{await payments.order(res.locals.account.id,req.params.id);await payments.reconcile(req.params.id);await gateway.refresh();res.json(await payments.order(res.locals.account.id,req.params.id));});
app.post('/api/payments/:id/cancel',async(req,res)=>{const order=await payments.cancel(res.locals.account.id,req.params.id);await gateway.refresh();res.json(order);});
app.get('/api/payments/:id/qr',async(req,res)=>res.set('Content-Type','image/png').set('Cache-Control','private, no-store').send(await payments.qr(res.locals.account.id,req.params.id)));
app.post('/api/ai/payments',async(req,res)=>res.json(await payments.create(res.locals.account.id,'ai-10000','ai',req.body?.units)));
app.get('/api/ai/wallet',async(_req,res)=>res.json(await ai.wallet(res.locals.account.id)));
app.post('/api/ai/trial',rateLimit({windowMs:60000,limit:120}),async(req,res)=>res.json(await ai.trial(res.locals.account.id,req.body)));
app.get('/api/ai/usage',async(req,res)=>res.json(req.query.page===undefined?await ai.usage(res.locals.account.id):await ai.usagePage(res.locals.account.id,req.query.page)));
app.get('/api/wallet',async(_req,res)=>res.json(await basicWallet(res.locals.account.id)));
app.get('/api/plans',async(_req,res)=>{const [plans]=await db.query('SELECT * FROM plans WHERE active=TRUE');res.json(plans);});
app.get('/api/referral',async(_req,res)=>res.json(await referral.overview(res.locals.account.id)));
app.post('/api/referral/redeem',async(req,res)=>res.json(await referral.redeem(res.locals.account.id,req.body)));
app.get('/api/referral/referrals',async(_req,res)=>res.json(await referral.myReferrals(res.locals.account.id)));
app.get('/api/referral/earnings',async(_req,res)=>res.json(await referral.myEarnings(res.locals.account.id)));
app.get('/api/referral/profile',async(_req,res)=>res.json(await referral.profile(res.locals.account.id)));
app.put('/api/referral/profile',async(req,res)=>res.json(await referral.saveProfile(res.locals.account.id,req.body)));
app.get('/api/referral/payouts',async(_req,res)=>res.json(await referral.myPayouts(res.locals.account.id)));
app.post('/api/referral/payouts',async(req,res)=>res.status(201).json(await referral.requestPayout(res.locals.account.id,req.body)));
app.use('/api/admin',(_req,res,next)=>{if(res.locals.account.role!=='owner'){res.status(403).json({error:'forbidden'});return;}next();});
app.get('/api/admin/audit',async(_req,res)=>{const [rows]=await db.query('SELECT e.id,e.account_id,a.email AS account_email,e.action,e.created_at FROM audit_events e LEFT JOIN accounts a ON a.id=e.account_id ORDER BY e.id DESC LIMIT 100');res.json(rows);});
app.get('/api/admin/health',async(_req,res)=>{await db.query('SELECT 1');res.json({database:'ok',engine:gateway.health(),uptime:Math.floor(process.uptime())});});
app.put('/api/admin/accounts/:id/status',async(req,res)=>{
 if(typeof req.body?.suspended!=='boolean')throw new ApiError(400,'invalid_request','Status wajib valid');
 const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute<RowDataPacket[]>('SELECT role FROM accounts WHERE id=? FOR UPDATE',[req.params.id]);
 if(!rows[0])throw new ApiError(404,'account_not_found','Akun tidak ditemukan');if(rows[0].role==='owner')throw new ApiError(409,'owner_protected','Akun pemilik tidak dapat dinonaktifkan');
 await c.execute('UPDATE accounts SET suspended=? WHERE id=?',[req.body.suspended,req.params.id]);await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[res.locals.account.id,(req.body.suspended?'account_suspended:':'account_enabled:')+req.params.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}gateway.revoke(req.params.id);await gateway.refresh();res.json({ok:true});
});
app.put('/api/admin/accounts/:id/password',async(req,res)=>{
 const password=req.body?.password;
 if(typeof password!=='string'||password.length<6||password.length>128)throw new ApiError(400,'invalid_request','Password harus 6–128 karakter');
 const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute<RowDataPacket[]>('SELECT role FROM accounts WHERE id=? FOR UPDATE',[req.params.id]);
  if(!rows[0])throw new ApiError(404,'account_not_found','Akun tidak ditemukan');if(rows[0].role==='owner')throw new ApiError(409,'owner_protected','Password akun pemilik tidak dapat diubah dari halaman ini');
  await c.execute('UPDATE accounts SET password_hash=? WHERE id=?',[await hashPassword(password),req.params.id]);await c.execute('DELETE FROM login_sessions WHERE account_id=?',[req.params.id]);await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[res.locals.account.id,'account_password_changed:'+req.params.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}gateway.revoke(req.params.id);res.json({ok:true});
});
app.post('/api/admin/accounts/:id/credits',async(req,res)=>{
 const {amount,reason,requestId}=req.body??{};
 if(!Number.isSafeInteger(amount)||Math.abs(amount)>100000000||amount===0||typeof reason!=='string'||!reason.trim()||reason.length>200||typeof requestId!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(requestId))throw new ApiError(400,'invalid_request','Jumlah, alasan, dan ID penyesuaian wajib valid');
 const c=await db.getConnection();try{await c.beginTransaction();const wallet=await ensureBasic(c,req.params.id);
 const [old]=await c.execute<RowDataPacket[]>('SELECT amount,reason FROM credit_adjustments WHERE account_id=? AND request_id=?',[req.params.id,requestId]);
 if(old[0]){if(old[0].amount!==amount||old[0].reason!==reason)throw new ApiError(409,'idempotency_conflict','ID penyesuaian sudah digunakan');}
 else{if(wallet.balance+amount<0||wallet.balance+amount>1000000000)throw new ApiError(409,'invalid_balance','Saldo di luar batas');
 await c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?',[amount,req.params.id]);
 await c.execute('INSERT INTO credit_adjustments(account_id,request_id,actor_id,amount,reason) VALUES (?,?,?,?,?)',[req.params.id,requestId,res.locals.account.id,amount,reason]);
 await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[res.locals.account.id,'credit_adjusted:'+req.params.id]);}
 await c.commit();res.json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}
});
app.get('/api/admin/payments',async(_req,res)=>{const [rows]=await db.query('SELECT p.id,p.account_id,a.email AS account_email,p.plan_name,p.total,p.status,p.environment,p.created_at FROM payment_orders p LEFT JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT 100');res.json(rows);});
app.get('/dashboard/admin/ai-studio',(_req,res)=>res.sendFile('ai-studio.html',{root:'public'}));
app.get('/api/admin/ai',async(_req,res)=>res.json(await ai.configuration()));
app.get('/api/admin/ai/studio',async(_req,res)=>res.json({...await workflowState(),models:await ai.configuration()}));
app.put('/api/admin/ai/studio',async(req,res)=>res.json(await changeWorkflow(res.locals.account.id,req.body)));
app.post('/api/admin/ai/studio/publish',async(req,res)=>res.json(await changeWorkflow(res.locals.account.id,req.body,true)));
app.post('/api/admin/ai/studio/run',rateLimit({windowMs:60000,limit:10}),async(req,res)=>{
 const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 await studio.run(res.locals.account.id,req.body,event=>{
  if(res.destroyed)return;
  if(!res.headersSent)res.set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
  res.write(JSON.stringify(event)+'\n');
 },controller.signal);
 res.end();
});
app.get('/api/admin/ai/usage',async(_req,res)=>res.json(await ai.modelUsage()));
app.get('/api/admin/ai/failures',async(_req,res)=>res.json(await ai.agentFailures()));
app.put('/api/admin/ai',async(req,res)=>res.json(await ai.configure(res.locals.account.id,req.body)));
app.post('/api/admin/ai/test',rateLimit({windowMs:60000,limit:5}),async(req,res)=>res.json(await ai.test(req.body?.tier)));
app.post('/api/admin/accounts/:id/ai-credits',async(req,res)=>res.json(await ai.adjust(res.locals.account.id,req.params.id,req.body)));
app.get('/api/admin/midtrans',async(_req,res)=>res.json(await payments.configuration()));
app.put('/api/admin/midtrans',async(req,res)=>res.json(await payments.configure(res.locals.account.id,req.body)));
app.post('/api/admin/midtrans/test',async(_req,res)=>res.json(await payments.test()));
app.get('/api/admin/plans',async(_req,res)=>{const [plans]=await db.query('SELECT * FROM plans');res.json(plans);});
app.delete('/api/admin/plans/:id',async(req,res)=>{
 const id=req.params.id;
 if(!/^[a-zA-Z0-9_-]{1,36}$/.test(id))throw new ApiError(400,'invalid_request','ID paket tidak valid');
 if(id==='basic')throw new ApiError(409,'basic_protected','Paket Basic tidak dapat dihapus');
 const connection=await db.getConnection();
 try{
  await connection.beginTransaction();
  const [result]=await connection.execute<ResultSetHeader>('DELETE FROM plans WHERE id=?',[id]);
  if(!result.affectedRows)throw new ApiError(404,'plan_not_found','Paket tidak ditemukan');
  await connection.execute('INSERT INTO audit_events (account_id,action) VALUES (?,?)',[res.locals.account.id,'plan_deleted:'+id]);
  await connection.commit();res.json({ok:true});
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
});
app.put('/api/admin/plans/:id',async(req,res)=>{
 const input=planInput(req.body);const id=req.params.id;
 if(!input||! /^[a-zA-Z0-9_-]{1,36}$/.test(id)|| (id==='basic'&&(input.price!==0||!input.active))){res.status(400).json({error:'invalid_request'});return;}
 const connection=await db.getConnection();
 try {await connection.beginTransaction();await connection.execute('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),credits=VALUES(credits),session_limit=VALUES(session_limit),active=VALUES(active),max_share_assets=VALUES(max_share_assets),max_share_storage_bytes=VALUES(max_share_storage_bytes)',[id,input.name,input.price,input.credits,input.session_limit,input.active,input.maxShareAssets,input.maxShareStorageBytes]);await connection.execute('INSERT INTO audit_events (account_id,action) VALUES (?,?)',[res.locals.account.id,'plan_updated:'+id]);await connection.commit();res.json({ok:true});}catch(e){await connection.rollback();throw e;}finally{connection.release();}
});
app.get('/api/admin/referral',async(_req,res)=>res.json(await referral.settings()));
app.put('/api/admin/referral',async(req,res)=>res.json(await referral.configure(res.locals.account.id,req.body)));
app.get('/api/admin/referral/referrals',async(_req,res)=>res.json(await referral.adminList()));
app.get('/api/admin/referral/payouts',async(req,res)=>res.json(await referral.adminPayouts(typeof req.query.status==='string'?req.query.status:undefined)));
app.put('/api/admin/referral/payouts/:id',async(req,res)=>res.json(await referral.decidePayout(res.locals.account.id,req.params.id,req.body)));
app.get('/api/admin/referral/agents',async(_req,res)=>res.json(await referral.agents()));
app.put('/api/admin/referral/agents/:id',async(req,res)=>res.json(await referral.setAgent(res.locals.account.id,req.params.id,req.body)));
app.use(express.static('public'));
app.get(['/','/login','/register','/dashboard','/dashboard/ai','/dashboard/auto-share','/dashboard/admin/ai','/dashboard/nomor','/dashboard/integrasi','/dashboard/pemakaian','/dashboard/paket','/dashboard/referral','/dashboard/admin','/dashboard/admin/plans','/dashboard/admin/accounts','/dashboard/admin/settings','/dashboard/admin/payments','/dashboard/admin/health','/dashboard/admin/referral','/dashboard/dokumentasi','/dashboard/uji-pesan'],(_req,res)=>res.sendFile('index.html',{root:'public'}));
app.use((_req,res)=>res.status(404).json({error:'not_found'}));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(res.headersSent){_next(err);return;}if(err instanceof ApiError){res.status(err.status).json({error:err.code,message:err.message});return;}const status=(err as {status?:number}).status;res.status(status===400||status===413?status:500).json({error:status===400||status===413?'invalid_request':'internal_error'});});

return app;
}
export const app=createApp();
