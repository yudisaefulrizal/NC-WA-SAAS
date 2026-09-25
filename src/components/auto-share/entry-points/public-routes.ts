// Media pengiriman terjadwal, diambil WhatsApp lewat token publik.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
export function assetPublicRoutes(
  app: express.Express,
  { gateway }: { gateway: { shareAssets: { getByToken(token: string): Promise<{ path: string; mimetype: string }> } } },
) {
  app.get('/public/assets/:token', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) => {
    const file = await gateway.shareAssets.getByToken(String(req.params.token));
    res
      .set('Content-Type', file.mimetype)
      .set('Content-Disposition', 'inline')
      .set('Cache-Control', 'public, max-age=3600')
      .sendFile(file.path);
  });
}
