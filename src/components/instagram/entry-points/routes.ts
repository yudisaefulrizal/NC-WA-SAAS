// Rute HTTP Instagram DM: pengelolaan akun Zernio dan alur hubungkan untuk dashboard (login cookie, akun dari
// res.locals.account), serta webhook dan pengalihan balik dari Zernio yang publik.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Instagram } from '../domain/instagram.js';

// Didaftarkan sebelum parser JSON global: tanda tangan webhook dihitung dari body mentah.
export function instagramPublicRoutes(app: express.Express, { instagram }: { instagram: Instagram }) {
  app.post(
    '/zernio/webhook/:id',
    rateLimit({ windowMs: 60000, limit: 600 }),
    express.raw({ type: '*/*', limit: '256kb' }),
    async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await instagram.receiveWebhook(req.params.id as string, raw, req.get('X-Zernio-Signature'));
      res.json({ ok: true });
    },
  );
  // Cookie login SameSite=strict tidak ikut pada pengalihan dari zernio.com, jadi halaman ini hanya meneruskan
  // hasilnya ke dashboard lewat meta refresh; navigasi berikutnya berasal dari situs sendiri dan membawa cookie.
  app.get('/zernio/callback', rateLimit({ windowMs: 60000, limit: 60 }), async (req, res) => {
    const result = await instagram.finishConnect(req.query as Record<string, unknown>);
    const target =
      '/dashboard/nomor?' + new URLSearchParams({ instagram: result.ok ? 'ok' : 'gagal', pesan: result.message });
    const escaped = target.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    res
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><title>NC-WA</title><a href="${escaped}">Kembali ke dashboard</a>`,
      );
  });
}
export function instagramRoutes(app: express.Express, { instagram }: { instagram: Instagram }) {
  app.get('/api/instagram/zernio', async (_req, res) =>
    res.json(await instagram.zernioAccounts(res.locals.account.id)),
  );
  app.post('/api/instagram/zernio', async (req, res) =>
    res.json(await instagram.addZernioAccount(res.locals.account.id, req.body)),
  );
  app.post('/api/instagram/zernio/:id/check', async (req, res) =>
    res.json(await instagram.checkZernioAccount(res.locals.account.id, req.params.id)),
  );
  app.put('/api/instagram/zernio/:id/key', async (req, res) =>
    res.json(await instagram.replaceZernioKey(res.locals.account.id, req.params.id, req.body)),
  );
  app.delete('/api/instagram/zernio/:id', async (req, res) =>
    res.json(await instagram.deleteZernioAccount(res.locals.account.id, req.params.id)),
  );
  app.post('/api/instagram/connect', async (req, res) =>
    res.json(await instagram.startConnect(res.locals.account.id, req.body)),
  );
  app.get('/api/instagram/contacts', async (req, res) =>
    res.json(await instagram.contacts(res.locals.account.id, req.query.session)),
  );
}
