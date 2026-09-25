// Rute HTTP AI di luar gateway: wallet dan Uji Coba untuk akun, serta halaman AI untuk pemilik.
import { ai } from '../domain/service.js';
import { studio as defaultStudio } from '../domain/studio.js';
import { workflowState, changeWorkflow, adminProfiles, setProfileEnabled } from '../domain/profiles/registry.js';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
// Wallet kredit AI, Uji Coba, dan riwayat pemakaian milik akun yang sedang login.
export function aiAccountRoutes(app: express.Express, {}: {}) {
  app.get('/api/ai/wallet', async (_req, res) => res.json(await ai.wallet(res.locals.account.id)));
  app.post('/api/ai/trial', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) =>
    res.json(await ai.trial(res.locals.account.id, req.body)),
  );
  app.get('/api/ai/usage', async (req, res) =>
    res.json(
      req.query.page === undefined
        ? await ai.usage(res.locals.account.id)
        : await ai.usagePage(res.locals.account.id, req.query.page),
    ),
  );
}
// Halaman AI untuk pemilik: pengaturan koneksi, profil provider, AI Studio per profil, ketersediaan profil, dan log.
export function aiAdminRoutes(app: express.Express, { studio }: { studio: typeof defaultStudio }) {
  app.get('/api/admin/ai', async (_req, res) => res.json(await ai.configuration()));
  // Setiap profil punya alurnya sendiri; ?profile= memilihnya (CS bila tidak diisi, seperti sebelum ada profil).
  app.get('/api/admin/ai/studio', async (req, res) =>
    res.json({ ...(await workflowState(req.query.profile ?? 'cs')), models: await ai.configuration() }),
  );
  app.put('/api/admin/ai/studio', async (req, res) =>
    res.json(await changeWorkflow(res.locals.account.id, req.query.profile ?? 'cs', req.body)),
  );
  app.post('/api/admin/ai/studio/publish', async (req, res) =>
    res.json(await changeWorkflow(res.locals.account.id, req.query.profile ?? 'cs', req.body, true)),
  );
  app.get('/api/admin/ai/profiles', async (_req, res) => res.json(await adminProfiles()));
  app.put('/api/admin/ai/profiles/:profile', async (req, res) =>
    res.json(await setProfileEnabled(res.locals.account.id, req.params.profile, req.body?.enabled)),
  );
  app.post('/api/admin/ai/studio/run', rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    await studio.run(
      res.locals.account.id,
      req.body,
      event => {
        if (res.destroyed) return;
        if (!res.headersSent)
          res.set({
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
          });
        res.write(JSON.stringify(event) + '\n');
      },
      controller.signal,
    );
    res.end();
  });
  app.get('/api/admin/ai/usage', async (_req, res) => res.json(await ai.modelUsage()));
  app.get('/api/admin/ai/failures', async (req, res) => res.json(await ai.agentFailures(req.query.page ?? '1')));
  app.get('/api/admin/ai/failures/:id', async (req, res) => res.json(await ai.agentFailureDetail(req.params.id)));
  app.get('/api/admin/ai/trace', async (req, res) => res.json(await ai.traceRequests(req.query.page ?? '1')));
  app.get('/api/admin/ai/trace/:requestId', async (req, res) => res.json(await ai.traceLog(req.params.requestId)));
  app.put('/api/admin/ai', async (req, res) => res.json(await ai.configure(res.locals.account.id, req.body)));
  app.get('/api/admin/ai/providers', async (_req, res) => res.json(await ai.providerProfiles()));
  app.post('/api/admin/ai/providers', async (req, res) => res.status(201).json(await ai.saveProviderProfile(req.body)));
  app.delete('/api/admin/ai/providers/:id', async (req, res) =>
    res.json(await ai.deleteProviderProfile(req.params.id)),
  );
  app.put('/api/admin/ai/providers/routes', async (req, res) => res.json(await ai.setProviderRoutes(req.body)));
  app.post('/api/admin/ai/providers/test', async (req, res) => res.json(await ai.testProviderProfile(req.body)));
  app.post('/api/admin/ai/test', rateLimit({ windowMs: 60000, limit: 5 }), async (req, res) =>
    res.json(await ai.test(req.body?.tier)),
  );
  app.post('/api/admin/accounts/:id/ai-credits', async (req, res) =>
    res.json(await ai.adjust(res.locals.account.id, req.params.id, req.body)),
  );
}
