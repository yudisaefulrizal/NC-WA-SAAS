// Rute HTTP referral untuk akun dan pemilik.
import express from 'express';
import { referral as defaultReferral } from '../domain/referral.js';
// Kode referral, pendapatan, profil bank, dan pencairan milik akun yang sedang login.
export function referralRoutes(app: express.Express, { referral }: { referral: typeof defaultReferral }) {
  app.get('/api/referral', async (_req, res) => res.json(await referral.overview(res.locals.account.id)));
  app.post('/api/referral/redeem', async (req, res) =>
    res.json(await referral.redeem(res.locals.account.id, req.body)),
  );
  app.get('/api/referral/referrals', async (_req, res) => res.json(await referral.myReferrals(res.locals.account.id)));
  app.get('/api/referral/earnings', async (_req, res) => res.json(await referral.myEarnings(res.locals.account.id)));
  app.get('/api/referral/profile', async (_req, res) => res.json(await referral.profile(res.locals.account.id)));
  app.put('/api/referral/profile', async (req, res) =>
    res.json(await referral.saveProfile(res.locals.account.id, req.body)),
  );
  app.get('/api/referral/payouts', async (_req, res) => res.json(await referral.myPayouts(res.locals.account.id)));
  app.post('/api/referral/payouts', async (req, res) =>
    res.status(201).json(await referral.requestPayout(res.locals.account.id, req.body)),
  );
}
// Halaman pemilik untuk pengaturan referral, pencairan, dan agen.
export function referralAdminRoutes(app: express.Express, { referral }: { referral: typeof defaultReferral }) {
  app.get('/api/admin/referral', async (_req, res) => res.json(await referral.settings()));
  app.put('/api/admin/referral', async (req, res) =>
    res.json(await referral.configure(res.locals.account.id, req.body)),
  );
  app.get('/api/admin/referral/referrals', async (_req, res) => res.json(await referral.adminList()));
  app.get('/api/admin/referral/payouts', async (req, res) =>
    res.json(await referral.adminPayouts(typeof req.query.status === 'string' ? req.query.status : undefined)),
  );
  app.put('/api/admin/referral/payouts/:id', async (req, res) =>
    res.json(await referral.decidePayout(res.locals.account.id, req.params.id, req.body)),
  );
  app.get('/api/admin/referral/agents', async (_req, res) => res.json(await referral.agents()));
  app.put('/api/admin/referral/agents/:id', async (req, res) =>
    res.json(await referral.setAgent(res.locals.account.id, req.params.id, req.body)),
  );
}
