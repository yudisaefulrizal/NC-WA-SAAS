import {ApiError} from '../../../libraries/errors.js';

export const fail=(message:string)=>new ApiError(400,'invalid_request',message);
export function integer(value:unknown,min:number,max:number,name:string){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw fail(name+' di luar batas');return Number(value);}
export function text(value:unknown,max:number,name:string){if(typeof value!=='string'||value.length>max)throw fail(name+' tidak valid atau terlalu panjang');return value.trim();}
