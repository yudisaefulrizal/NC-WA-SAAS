import {readFile,appendFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const text=await readFile('.env','utf8');
if(!/^PAYMENT_ENCRYPTION_KEY=.+$/m.test(text)){await appendFile('.env','\nPAYMENT_ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n',{mode:0o600});console.log('Kunci enkripsi pembayaran lokal dibuat.');}
else console.log('Kunci enkripsi pembayaran sudah tersedia; tidak diganti.');
await chmod('.env',0o600);
