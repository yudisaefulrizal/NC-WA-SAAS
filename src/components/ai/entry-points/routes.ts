// Rute HTTP Asisten AI di router gateway: pengaturan per sesi, data profil, tiket fallback, dan tampilan
// Percakapan. Record koleksi data profil ada di builder-routes.ts. Router sudah terautentikasi: res.locals berisi
// accountId dan SessionManager akun itu.
import express from 'express';
import { ApiError } from '../../../libraries/errors.js';
import type { AIService } from '../domain/service.js';
import { clientProfiles } from '../domain/profiles/registry.js';
import { chatMessages, listChats } from '../domain/chat.js';
export function aiRoutes(router: express.Router, { ai }: { ai: AIService }) {
  router.get('/sessions/:id/ai', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.assistant(res.locals.accountId, req.params.id));
  });
  router.patch('/sessions/:id/ai/enabled', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    if (typeof req.body?.enabled !== 'boolean')
      throw new ApiError(400, 'invalid_request', 'Status asisten wajib valid');
    res.json(await ai.setEnabled(res.locals.accountId, req.params.id, req.body.enabled));
  });
  router.patch('/sessions/:id/ai/field', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    if (typeof req.body?.field !== 'string') throw new ApiError(400, 'invalid_request', 'Bidang wajib diisi');
    res.json(await ai.saveField(res.locals.accountId, req.params.id, req.body.field, req.body.value));
  });
  router.get('/ai/profile-types', async (_req, res) => res.json(await clientProfiles(res.locals.accountId)));
  router.get('/ai/data-profiles', async (_req, res) => res.json(await ai.dataProfiles(res.locals.accountId)));
  router.post('/ai/data-profiles', async (req, res) =>
    res.status(201).json(await ai.createDataProfile(res.locals.accountId, req.body)),
  );
  router.get('/ai/data-profiles/:profile', async (req, res) =>
    res.json(await ai.dataProfile(res.locals.accountId, req.params.profile)),
  );
  router.patch('/ai/data-profiles/:profile', async (req, res) =>
    res.json(await ai.renameDataProfile(res.locals.accountId, req.params.profile, req.body)),
  );
  router.patch('/ai/data-profiles/:profile/field', async (req, res) => {
    if (typeof req.body?.field !== 'string') throw new ApiError(400, 'invalid_request', 'Bidang wajib diisi');
    res.json(await ai.saveDataProfileField(res.locals.accountId, req.params.profile, req.body.field, req.body.value));
  });
  router.delete('/ai/data-profiles/:profile', async (req, res) =>
    res.json(await ai.deleteDataProfile(res.locals.accountId, req.params.profile)),
  );
  router.put('/sessions/:id/ai/profile', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.attachProfile(res.locals.accountId, req.params.id, req.body));
  });
  router.get('/sessions/:id/ai/conversations', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.conversations(res.locals.accountId, req.params.id));
  });
  router.get('/sessions/:id/ai/fallbacks', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.fallbacks(res.locals.accountId, req.params.id, req.query.page ?? '1'));
  });
  router.post('/sessions/:id/ai/fallbacks/:fallback/answer', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(
      await ai.answerFallback(res.locals.accountId, res.locals.manager, req.params.id, req.params.fallback, req.body),
    );
  });
  router.delete('/sessions/:id/ai/fallbacks/:fallback', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.removeFallback(res.locals.accountId, req.params.id, req.params.fallback));
  });
  router.get('/sessions/:id/ai/chats', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await listChats(res.locals.accountId, req.params.id));
  });
  router.get('/sessions/:id/ai/chats/:customer/messages', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await chatMessages(res.locals.accountId, req.params.id, req.params.customer, req.query.before));
  });
  router.post('/sessions/:id/ai/chats/:customer/messages', async (req, res) => {
    res.json(
      await ai.dashboardReply(
        res.locals.accountId,
        res.locals.manager,
        req.params.id,
        req.params.customer,
        req.body,
        req.get('Idempotency-Key'),
      ),
    );
  });
  router.put('/sessions/:id/ai/conversations/:customer', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.conversation(res.locals.accountId, req.params.id, req.params.customer, req.body));
  });
}
