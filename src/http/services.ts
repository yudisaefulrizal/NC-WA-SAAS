// Instans layanan yang melintasi komponen, disambungkan sekali di sini supaya tidak ada komponen yang mengimpor
// domain komponen lain. Payments mencatat komisi referral saat order lunas.
import { Payments } from '../components/billing/index.js';
import { referral } from '../components/referral/index.js';
export const payments = new Payments(undefined, undefined, referral);
