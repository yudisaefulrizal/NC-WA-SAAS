import {Payments} from '../components/billing/index.js';
import {referral} from '../components/referral/index.js';
// Service instances that span components, wired once here so no component imports another component's domain.
// Payments records referral commissions when an order settles.
export const payments=new Payments(undefined,undefined,referral);
