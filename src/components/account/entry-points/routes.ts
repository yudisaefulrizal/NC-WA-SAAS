import {createKey} from '../domain/keys.js';
import {auditPage} from '../data-access/account-queries.js';
import {paginate} from '../../../libraries/pagination.js';
import express from 'express';
import {randomBytes,randomUUID} from 'node:crypto';
import {db} from '../../../libraries/db.js';
import {credentials,digest,hashPassword,verifyPassword} from '../../../libraries/security.js';
import {basicWallet,ensureBasic} from '../../billing/index.js';
import {ApiError} from '../../../libraries/errors.js';
import {deleteApiKeysByIdAccountId,deleteLoginSessionsByAccountId,deleteLoginSessionsByAccountIdTokenHash,deleteLoginSessionsByTokenHash,insertAccounts,insertAuditEvent,insertLoginSessions,insertPasswordChangedAudit,lockAccountsPasswordHashById,lockAccountsRoleById,selectAccounts,selectAccountsIdPasswordHashByEmail,selectApiKeysIdCreatedAtByAccountId,selectApiKeysIdEmailByKeyHash,selectApiKeysKeyHashByIdAccountId,selectLoginSessionsByTokenHash,selectPlansIdName,selectRows,updateAccountsPasswordHashById,updateAccountsSuspendedById} from '../data-access/account-queries.js';

const origin=process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
// The session cookie set at login; also read by the gateway to authorise browser calls.
export const cookie=(req:express.Request)=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ncwa_session='))?.slice(13)??'';

// Registration and login, and the API-key identity check; none of these need a session.
export function publicAccountRoutes(app:express.Express,{}:{}){
app.post('/api/auth/register',async(req,res)=>{const input=credentials(req.body);if(!input){res.status(400).json({error:'invalid_request'});return;}try{const id=randomUUID();const hash=await hashPassword(input.password);const connection=await db.getConnection();try{await connection.beginTransaction();await insertAccounts(connection,[id,input.email,hash]);await ensureBasic(connection,id);await connection.commit();}catch(e){await connection.rollback();throw e;}finally{connection.release();}res.status(201).json({ok:true});}catch(e){if((e as {code:string}).code==='ER_DUP_ENTRY'){res.status(409).json({error:'account_exists'});return;}throw e;}});
app.post('/api/auth/login',async(req,res)=>{const input=credentials(req.body);if(!input){res.status(400).json({error:'invalid_request'});return;}const [rows]=await selectAccountsIdPasswordHashByEmail(db,[input.email]);const fallback='00000000000000000000000000000000:'+ '00'.repeat(64);const valid=await verifyPassword(input.password,rows[0]?.password_hash??fallback);if(!valid||!rows[0]){res.status(401).json({error:'unauthorized'});return;}const token=randomBytes(32).toString('hex');await insertLoginSessions(db,[digest(token),rows[0].id]);res.cookie('ncwa_session',token,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),maxAge:86400000,path:'/'}).json({ok:true});});
// API-key authentication is separate from browser cookies and owner privileges.
app.get('/api/client/me',async(req,res)=>{
 const key=req.get('X-API-Key');
 if(!key){res.status(401).json({error:'unauthorized'});return;}
 const [rows]=await selectApiKeysIdEmailByKeyHash(db,[digest(key)]);
 if(!rows[0]){res.status(401).json({error:'unauthorized'});return;}
 res.json(rows[0]);
});
}
// Every /api route after this needs a valid login session; the account lands in res.locals.account.
export function sessionAuth(app:express.Express,{}:{}){
app.use('/api',async(req,res,next)=>{const [rows]=await selectLoginSessionsByTokenHash(db,[digest(cookie(req))]);if(!rows[0]){res.status(401).json({error:'unauthorized'});return;}res.locals.account=rows[0];next();});
}
// The signed-in account: identity, logout, password and API keys.
export function accountRoutes(app:express.Express,{gateway}:{gateway:{revoke(account:string,tag?:string):void}}){
app.get('/api/me',(_req,res)=>res.json(res.locals.account));
app.post('/api/auth/logout',async(req,res)=>{await deleteLoginSessionsByTokenHash(db,[digest(cookie(req))]);gateway.revoke(res.locals.account.id,digest(cookie(req)));res.clearCookie('ncwa_session',{path:'/'}).json({ok:true});});
app.put('/api/auth/password',async(req,res)=>{
 const currentPassword=req.body?.currentPassword,password=req.body?.password;
 if(typeof currentPassword!=='string'||typeof password!=='string'||password.length<6||password.length>128)throw new ApiError(400,'invalid_request','Password baru harus 6–128 karakter');
 const tokenHash=digest(cookie(req)),c=await db.getConnection();try{await c.beginTransaction();const [rows]=await lockAccountsPasswordHashById(c,[res.locals.account.id]);
  if(!rows[0]||!await verifyPassword(currentPassword,rows[0].password_hash))throw new ApiError(401,'unauthorized','Password saat ini tidak sesuai');
  await updateAccountsPasswordHashById(c,[await hashPassword(password),res.locals.account.id]);await deleteLoginSessionsByAccountIdTokenHash(c,[res.locals.account.id,tokenHash]);await insertPasswordChangedAudit(c,[res.locals.account.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}res.json({ok:true});
});
app.get('/api/keys',async(_req,res)=>{const [rows]=await selectApiKeysIdCreatedAtByAccountId(db,[res.locals.account.id]);res.json(rows);});
app.post('/api/keys',async(req,res)=>{const {id,key}=await createKey(res.locals.account.id,digest(cookie(req)));res.status(201).json({id,key});});
app.post('/api/keys/:id/rotate',async(req,res)=>{const {id,key,revokedHash}=await createKey(res.locals.account.id,digest(cookie(req)),req.params.id);if(revokedHash)gateway.revoke(res.locals.account.id,revokedHash);res.json({id,key});});
app.delete('/api/keys/:id',async(req,res)=>{const [keys]=await selectApiKeysKeyHashByIdAccountId(db,[req.params.id,res.locals.account.id]);await deleteApiKeysByIdAccountId(db,[req.params.id,res.locals.account.id]);if(keys[0])gateway.revoke(res.locals.account.id,keys[0].key_hash);res.json({ok:true});});
}
// Owner pages for accounts: list, audit log, service health, suspension and password reset.
export function accountAdminRoutes(app:express.Express,{gateway}:{gateway:{revoke(account:string,tag?:string):void;refresh():Promise<void>;health():unknown}}){
app.get('/api/admin/accounts',async(_req,res)=>{if(res.locals.account.role!=='owner'){res.status(403).json({error:'forbidden'});return;}const [rows]=await selectAccounts(db);
 const [plans]=await selectPlansIdName(db);
 const names=new Map(plans.map(plan=>[plan.id,plan.name]));
 const accounts=[];
 for(const account of rows){
  const wallet=await basicWallet(account.id);
  accounts.push({...account,plan_id:wallet.plan_id,plan_name:names.get(wallet.plan_id)??wallet.plan_id,balance:wallet.balance,expires_at:wallet.expires_at});
 }
 res.json(accounts);});
app.get('/api/admin/audit',async(req,res)=>res.json(await paginate(req.query.page??'1',auditPage.count,auditPage.items)));
app.get('/api/admin/health',async(_req,res)=>{await selectRows(db);res.json({database:'ok',engine:gateway.health(),uptime:Math.floor(process.uptime())});});
app.put('/api/admin/accounts/:id/status',async(req,res)=>{
 if(typeof req.body?.suspended!=='boolean')throw new ApiError(400,'invalid_request','Status wajib valid');
 const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await lockAccountsRoleById(c,[req.params.id]);
 if(!rows[0])throw new ApiError(404,'account_not_found','Akun tidak ditemukan');if(rows[0].role==='owner')throw new ApiError(409,'owner_protected','Akun pemilik tidak dapat dinonaktifkan');
 await updateAccountsSuspendedById(c,[req.body.suspended,req.params.id]);await insertAuditEvent(c,[res.locals.account.id,(req.body.suspended?'account_suspended:':'account_enabled:')+req.params.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}gateway.revoke(req.params.id);await gateway.refresh();res.json({ok:true});
});
app.put('/api/admin/accounts/:id/password',async(req,res)=>{
 const password=req.body?.password;
 if(typeof password!=='string'||password.length<6||password.length>128)throw new ApiError(400,'invalid_request','Password harus 6–128 karakter');
 const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await lockAccountsRoleById(c,[req.params.id]);
  if(!rows[0])throw new ApiError(404,'account_not_found','Akun tidak ditemukan');if(rows[0].role==='owner')throw new ApiError(409,'owner_protected','Password akun pemilik tidak dapat diubah dari halaman ini');
  await updateAccountsPasswordHashById(c,[await hashPassword(password),req.params.id]);await deleteLoginSessionsByAccountId(c,[req.params.id]);await insertAuditEvent(c,[res.locals.account.id,'account_password_changed:'+req.params.id]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}gateway.revoke(req.params.id);res.json({ok:true});
});
}
