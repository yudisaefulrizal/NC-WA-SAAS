import {text} from './input.js';

export const countWords=(text:string)=>text.match(/\S+/gu)?.length??0;
export const aiFallback='Maaf, saya sedang mengalami kendala memproses pesan Anda. Silakan coba lagi beberapa saat. Jika terkait pesanan, mohon periksa status pesanan terlebih dahulu sebelum mengulang pemesanan.';
export const creditCost=(input:number,output:number,inputRate:number,outputRate:number)=>input*inputRate+output*outputRate;
