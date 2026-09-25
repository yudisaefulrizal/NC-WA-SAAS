import {db} from '../../../libraries/db.js';
import {ensureBasic} from './plans.js';
import {debitWalletOneCredit,insertCreditReservations,lockCreditReservationsStatusPeriodByAccountIdRequestId,refundWalletOneCredit,selectCreditReservationsPeriodStatusByAccountIdRequestId,selectCreditReservationsStatusPayloadHashByAccountIdRequestId,updateCreditReservationsStatusByAccountId,updateCreditReservationsStatusByAccountIdRequestId} from '../data-access/credits-queries.js';
// Internal service: never expose a public endpoint that can mark messages sent/refund credits.
export async function reserveCredit(accountId:string,requestId:string,payloadHash:string,now=new Date()) {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(payloadHash))throw new Error('invalid_request');
 const connection=await db.getConnection();
 try {
  await connection.beginTransaction();
  const wallet=await ensureBasic(connection,accountId,now);
  const [existing]=await selectCreditReservationsStatusPayloadHashByAccountIdRequestId(connection,[accountId,requestId]);
  if(existing[0]){
   if(existing[0].payload_hash!==payloadHash)throw new Error('idempotency_conflict');
   await connection.commit();return {created:false,status:existing[0].status as string};
  }
  if(wallet.balance<1)throw new Error('insufficient_credits');
  await debitWalletOneCredit(connection,[accountId]);
  await insertCreditReservations(connection,[accountId,requestId,payloadHash,wallet.period]);
  await connection.commit();return {created:true,status:'reserved'};
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

export async function settleCredit(accountId:string,requestId:string,outcome:'sent'|'failed'|'unknown',now=new Date()) {
 if(!['sent','failed','unknown'].includes(outcome))throw new Error('invalid_outcome');
 const connection=await db.getConnection();
 try {
  await connection.beginTransaction();
  const wallet=await ensureBasic(connection,accountId,now);
  const [rows]=await lockCreditReservationsStatusPeriodByAccountIdRequestId(connection,[accountId,requestId]);
  const row=rows[0];if(!row)throw new Error('reservation_not_found');
  if(row.status==='sent'||row.status==='failed'){
   if(row.status!==outcome)throw new Error('outcome_conflict');
   await connection.commit();return;
  }
  // Refund only into its original, still-current period. Expired quota stays expired.
  if(outcome==='failed'&&row.period===wallet.period)await refundWalletOneCredit(connection,[accountId]);
  await updateCreditReservationsStatusByAccountIdRequestId(connection,[outcome,accountId,requestId]);
  await connection.commit();
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

export async function validateReservation(accountId:string,requestId:string,now=new Date()){
 const c=await db.getConnection();try{await c.beginTransaction();const wallet=await ensureBasic(c,accountId,now);const [rows]=await selectCreditReservationsPeriodStatusByAccountIdRequestId(c,[accountId,requestId]);
 if(!rows[0]||rows[0].period!==wallet.period||rows[0].status!=='reserved')throw new Error('reservation_expired');await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}

export async function recoverReservations(accountId?:string){
 await updateCreditReservationsStatusByAccountId(db,accountId?[accountId]:[],accountId);
}
