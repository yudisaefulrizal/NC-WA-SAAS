import {ai} from './components/ai/index.js';
import {recoverReservations} from './components/billing/index.js';
import {gateway} from './http/gateway.js';
import {app} from './http/app.js';
import {db} from './libraries/db.js';
import {startBasicScheduler} from './components/billing/index.js';
import {payments} from './http/services.js';
import {acquireEngineLock} from './libraries/runtime-lock.js';
import {moveLegacyStorage} from './libraries/storage.js';

const lock=await acquireEngineLock();
// Before anything reads sessions or files: an install still on the old auth/ directory moves into storage/.
try{const moved=await moveLegacyStorage();if(moved)console.log(`Penyimpanan lama auth/ dipindah ke storage/ (${moved} folder).`);}
catch(error){console.error('Pemindahan auth/ ke storage/ gagal; server tidak dijalankan agar sesi tidak tampak hilang.',error instanceof Error?error.message:'');await lock.release();await db.end();process.exit(1);}
try {
 await recoverReservations();await ai.recover();
 await gateway.restore();await gateway.autoShare.recover();gateway.start();
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
