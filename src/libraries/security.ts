import {randomBytes,scrypt as derive,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(derive);
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password:string){ const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64) as Buffer; return `${salt}:${key.toString('hex')}`; }
export async function verifyPassword(password:string,encoded:string){const [salt,hex]=encoded.split(':'); if(!salt||!hex)return false;const actual=await scrypt(password,salt,64) as Buffer; const expected=Buffer.from(hex,'hex');return expected.length===actual.length&&timingSafeEqual(actual,expected);}
export function credentials(body:unknown):{email:string,password:string}|null { if(!body||typeof body!=='object')return null;const {email,password}=body as Record<string,unknown>;if(typeof email!=='string'||typeof password!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||password.length<6||password.length>128)return null;return {email:email.trim().toLowerCase(),password}; }
