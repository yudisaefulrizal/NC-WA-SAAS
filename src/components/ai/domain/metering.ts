// Penghitungan kredit AI (per kata masuk dan keluar) dan balasan cadangan saat AI gagal.
import { text } from './input-validation.js';

export const countWords = (text: string) => text.match(/\S+/gu)?.length ?? 0;
export const aiFallback =
  'Maaf, saya sedang mengalami kendala memproses pesan Anda. Silakan coba lagi beberapa saat. Jika terkait pesanan, mohon periksa status pesanan terlebih dahulu sebelum mengulang pemesanan.';
export const creditCost = (input: number, output: number, inputRate: number, outputRate: number) =>
  input * inputRate + output * outputRate;
// Reservasi mengambil kredit paket lebih dulu; bagian itu dicatat supaya refund kembali ke wadah asalnya.
export const planPart = (reserved: number, planAvailable: number) => Math.min(reserved, Math.max(0, planAvailable));
// Refund mengembalikan bagian yang terakhir diambil lebih dulu: saldo hasil beli, lalu kredit paket.
export function refundSplit(reserved: number, planTaken: number, refund: number) {
  const toBalance = Math.min(refund, reserved - planTaken);
  return { toBalance, toPlan: refund - toBalance };
}
