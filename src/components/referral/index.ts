// Komponen referral: kode, komisi, dan pencairan. Komponen lain dan src/http hanya memakai nama yang
// diekspor di sini.
export { migrateReferral } from './data-access/schema.js';
export { referral } from './domain/referral.js';
export { referralAdminRoutes, referralRoutes } from './entry-points/routes.js';
