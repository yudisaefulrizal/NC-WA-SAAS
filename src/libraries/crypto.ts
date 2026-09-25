import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ApiError} from './errors.js';
// AES-256-GCM for secrets stored in the database (provider keys, endpoint tokens, payment credentials).
function encryptionKey(){const key=process.env.PAYMENT_ENCRYPTION_KEY;if(!key||! /^[a-f0-9]{64}$/i.test(key))throw new ApiError(503,'payment_not_configured','Kunci enkripsi pembayaran belum dikonfigurasi');return Buffer.from(key,'hex');}
export function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(v=>v.toString('hex')).join(':');}
export function decrypt(value:string){const [iv,tag,body]=value.split(':').map(v=>Buffer.from(v,'hex'));const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');}
