import type {Payments} from '../domain/payments.js';
import {paymentsPage} from '../data-access/billing-queries.js';
import {paginate} from '../../../libraries/pagination.js';
import express from 'express';
import {rateLimit} from 'express-rate-limit';
import {db} from '../../../libraries/db.js';
import {basicWallet,ensureBasic,planInput} from '../domain/plans.js';
import {ApiError} from '../../../libraries/errors.js';
import {deletePlansById,insertAuditEvent,insertCreditAdjustments,selectActivePlans,selectAllPlans,selectCreditAdjustmentsAmountReasonByAccountIdRequestId,selectCreditReservationsByAccountId,selectPublicPlans,updateWalletsBalanceByAccountId,upsertPlans} from '../data-access/billing-queries.js';
// Midtrans payment notifications and the public plan list for the landing page.
export function billingPublicRoutes(app:express.Express,{payments,gateway}:{payments:Payments;gateway:{refresh():Promise<void>}}){
app.post('/payments/midtrans/notification',rateLimit({windowMs:60000,limit:120}),async(req,res)=>{const result=await payments.notification(req.body);await gateway.refresh();res.json(result);});
app.get('/public/plans',async(_req,res)=>{const [rows]=await selectPublicPlans(db);res.json(rows);});
}
// WhatsApp credit usage, wallet, plans, and paying for a plan or AI credits.
export function billingRoutes(app:express.Express,{payments,gateway}:{payments:Payments;gateway:{refresh():Promise<void>}}){
app.get('/api/usage',async(_req,res)=>{const [rows]=await selectCreditReservationsByAccountId(db,[res.locals.account.id]);res.json(rows);});
app.get('/api/payments',async(_req,res)=>res.json(await payments.list(res.locals.account.id)));
app.post('/api/payments',async(req,res)=>res.json(await payments.create(res.locals.account.id,req.body?.planId)));
app.get('/api/payments/:id',async(req,res)=>res.json(await payments.order(res.locals.account.id,req.params.id)));
app.post('/api/payments/:id/check',async(req,res)=>{await payments.order(res.locals.account.id,req.params.id);await payments.reconcile(req.params.id);await gateway.refresh();res.json(await payments.order(res.locals.account.id,req.params.id));});
app.post('/api/payments/:id/cancel',async(req,res)=>{const order=await payments.cancel(res.locals.account.id,req.params.id);await gateway.refresh();res.json(order);});
app.get('/api/payments/:id/qr',async(req,res)=>res.set('Content-Type','image/png').set('Cache-Control','private, no-store').send(await payments.qr(res.locals.account.id,req.params.id)));
app.post('/api/ai/payments',async(req,res)=>res.json(await payments.create(res.locals.account.id,'ai-10000','ai',req.body?.units)));
app.get('/api/wallet',async(_req,res)=>res.json(await basicWallet(res.locals.account.id)));
app.get('/api/plans',async(_req,res)=>{const [plans]=await selectActivePlans(db);res.json(plans);});
}
// Owner pages: credit adjustments, all payments, Midtrans settings and the plan catalog.
export function billingAdminRoutes(app:express.Express,{payments}:{payments:Payments}){
app.post('/api/admin/accounts/:id/credits',async(req,res)=>{
 const {amount,reason,requestId}=req.body??{};
 if(!Number.isSafeInteger(amount)||Math.abs(amount)>100000000||amount===0||typeof reason!=='string'||!reason.trim()||reason.length>200||typeof requestId!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(requestId))throw new ApiError(400,'invalid_request','Jumlah, alasan, dan ID penyesuaian wajib valid');
 const c=await db.getConnection();try{await c.beginTransaction();const wallet=await ensureBasic(c,req.params.id);
 const [old]=await selectCreditAdjustmentsAmountReasonByAccountIdRequestId(c,[req.params.id,requestId]);
 if(old[0]){if(old[0].amount!==amount||old[0].reason!==reason)throw new ApiError(409,'idempotency_conflict','ID penyesuaian sudah digunakan');}
 else{if(wallet.balance+amount<0||wallet.balance+amount>1000000000)throw new ApiError(409,'invalid_balance','Saldo di luar batas');
 await updateWalletsBalanceByAccountId(c,[amount,req.params.id]);
 await insertCreditAdjustments(c,[req.params.id,requestId,res.locals.account.id,amount,reason]);
 await insertAuditEvent(c,[res.locals.account.id,'credit_adjusted:'+req.params.id]);}
 await c.commit();res.json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}
});
app.get('/api/admin/payments',async(req,res)=>res.json(await paginate(req.query.page??'1',paymentsPage.count,paymentsPage.items)));
app.get('/api/admin/midtrans',async(_req,res)=>res.json(await payments.configuration()));
app.put('/api/admin/midtrans',async(req,res)=>res.json(await payments.configure(res.locals.account.id,req.body)));
app.post('/api/admin/midtrans/test',async(_req,res)=>res.json(await payments.test()));
app.get('/api/admin/plans',async(_req,res)=>{const [plans]=await selectAllPlans(db);res.json(plans);});
app.delete('/api/admin/plans/:id',async(req,res)=>{
 const id=req.params.id;
 if(!/^[a-zA-Z0-9_-]{1,36}$/.test(id))throw new ApiError(400,'invalid_request','ID paket tidak valid');
 if(id==='basic')throw new ApiError(409,'basic_protected','Paket Basic tidak dapat dihapus');
 const connection=await db.getConnection();
 try{
  await connection.beginTransaction();
  const [result]=await deletePlansById(connection,[id]);
  if(!result.affectedRows)throw new ApiError(404,'plan_not_found','Paket tidak ditemukan');
  await insertAuditEvent(connection,[res.locals.account.id,'plan_deleted:'+id]);
  await connection.commit();res.json({ok:true});
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
});
app.put('/api/admin/plans/:id',async(req,res)=>{
 const input=planInput(req.body);const id=req.params.id;
 if(!input||! /^[a-zA-Z0-9_-]{1,36}$/.test(id)|| (id==='basic'&&(input.price!==0||!input.active))){res.status(400).json({error:'invalid_request'});return;}
 const connection=await db.getConnection();
 try {await connection.beginTransaction();await upsertPlans(connection,[id,input.name,input.price,input.credits,input.session_limit,input.active,input.maxShareAssets,input.maxShareStorageBytes]);await insertAuditEvent(connection,[res.locals.account.id,'plan_updated:'+id]);await connection.commit();res.json({ok:true});}catch(e){await connection.rollback();throw e;}finally{connection.release();}
});
}
