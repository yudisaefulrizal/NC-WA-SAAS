import {ai} from './ai.js';
import {recoverReservations} from './credits.js';
import {gateway} from './gateway.js';
import {app} from './app.js';
import {db} from './db.js';
import {startBasicScheduler} from './scheduler.js';
import {payments} from './payments.js';
import {acquireEngineLock} from './runtime.js';
const lock=await acquireEngineLock();
try {
 await recoverReservations();await ai.recover();
 await gateway.restore();gateway.start();
}catch{console.error('Pemulihan engine gagal; periksa metadata dan penyimpanan.');await gateway.stop();await lock.release();await db.end();process.exit(1);}
const stopScheduler=startBasicScheduler();
let paymentWork:Promise<void>|undefined;
const tick=()=>{paymentWork??=payments.sweep().catch(()=>console.error('Rekonsiliasi pembayaran gagal.')).finally(()=>{paymentWork=undefined;});};
const paymentTimer=setInterval(tick,30000).unref();tick();
const server=app.listen(Number(process.env.PORT??8067),process.env.HOST??'127.0.0.1',()=>console.log('NC-WA SaaS siap pada port '+(process.env.PORT??8067)));
let stopping=false;
async function stop(code=0){
 if(stopping)return;stopping=true;clearInterval(paymentTimer);
 const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeIdleConnections();
 try{await stopScheduler();await gateway.stop();await closed;await paymentWork;await lock.release();await db.end();process.exit(code);}
 catch{console.error('Penghentian engine gagal.');process.exit(1);}
}
lock.connection.on('error',()=>{console.error('Kunci kepemilikan engine terputus.');void stop(1);});
server.on('error',()=>{console.error('Server gagal membuka port.');void stop(1);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void stop());
