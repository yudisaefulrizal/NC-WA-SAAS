import {db} from './db.js';
import {ensureBasic} from './plans.js';
import type {RowDataPacket} from 'mysql2/promise';

// Internal service: never expose a public endpoint that can mark messages sent/refund credits.
export async function reserveCredit(accountId:string,requestId:string,payloadHash:string,now=new Date()) {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(payloadHash))throw new Error('invalid_request');
 const connection=await db.getConnection();
 try {
  await connection.beginTransaction();
  const wallet=await ensureBasic(connection,accountId,now);
  const [existing]=await connection.execute<RowDataPacket[]>('SELECT status,payload_hash FROM credit_reservations WHERE account_id=? AND request_id=?',[accountId,requestId]);
  if(existing[0]){
   if(existing[0].payload_hash!==payloadHash)throw new Error('idempotency_conflict');
   await connection.commit();return {created:false,status:existing[0].status as string};
  }
  if(wallet.balance<1)throw new Error('insufficient_credits');
  await connection.execute('UPDATE wallets SET balance=balance-1 WHERE account_id=?',[accountId]);
  await connection.execute('INSERT INTO credit_reservations (account_id,request_id,payload_hash,period) VALUES (?,?,?,?)',[accountId,requestId,payloadHash,wallet.period]);
  await connection.commit();return {created:true,status:'reserved'};
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

export async function settleCredit(accountId:string,requestId:string,outcome:'sent'|'failed'|'unknown',now=new Date()) {
 if(!['sent','failed','unknown'].includes(outcome))throw new Error('invalid_outcome');
 const connection=await db.getConnection();
 try {
  await connection.beginTransaction();
  const wallet=await ensureBasic(connection,accountId,now);
  const [rows]=await connection.execute<RowDataPacket[]>('SELECT status,period FROM credit_reservations WHERE account_id=? AND request_id=? FOR UPDATE',[accountId,requestId]);
  const row=rows[0];if(!row)throw new Error('reservation_not_found');
  if(row.status==='sent'||row.status==='failed'){
   if(row.status!==outcome)throw new Error('outcome_conflict');
   await connection.commit();return;
  }
  // Refund only into its original, still-current period. Expired quota stays expired.
  if(outcome==='failed'&&row.period===wallet.period)await connection.execute('UPDATE wallets SET balance=balance+1 WHERE account_id=?',[accountId]);
  await connection.execute('UPDATE credit_reservations SET status=? WHERE account_id=? AND request_id=?',[outcome,accountId,requestId]);
  await connection.commit();
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

export async function validateReservation(accountId:string,requestId:string,now=new Date()){
 const c=await db.getConnection();try{await c.beginTransaction();const wallet=await ensureBasic(c,accountId,now);const [rows]=await c.execute<RowDataPacket[]>('SELECT period,status FROM credit_reservations WHERE account_id=? AND request_id=?',[accountId,requestId]);
 if(!rows[0]||rows[0].period!==wallet.period||rows[0].status!=='reserved')throw new Error('reservation_expired');await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}

export async function recoverReservations(accountId?:string){
 await db.execute("UPDATE credit_reservations r LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=r.request_id SET r.status=IF(o.message_id IS NULL,'unknown','sent') WHERE r.status IN ('reserved','unknown')"+(accountId?' AND r.account_id=?':''),accountId?[accountId]:[]);
}
