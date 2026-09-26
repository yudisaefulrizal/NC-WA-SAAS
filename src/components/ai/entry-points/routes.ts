// Rute HTTP Asisten AI di router gateway: pengaturan per sesi, data profil dan isinya (produk dan pesanan CS;
// program, kontak, dan dokumen CS Lembaga Pendidikan), tiket fallback, dan tampilan Percakapan. Router sudah
// terautentikasi: res.locals berisi accountId dan SessionManager akun itu.
import express from 'express';
import { Readable } from 'node:stream';
import { ApiError } from '../../../libraries/errors.js';
import { record } from '../../../libraries/validation.js';
import type { SessionManager } from '../../whatsapp/index.js';
import type { AIService } from '../domain/service.js';
import { aiData, orderInput, customerNumber } from '../domain/profiles/cs/store.js';
import type { ProductImageStore } from '../domain/profiles/cs/product-images.js';
import { eduData } from '../domain/profiles/pendidikan/tools.js';
import { clientProfiles } from '../domain/profiles/registry.js';
import { chatMessages, listChats } from '../domain/chat.js';
export function aiRoutes(
  router: express.Router,
  { ai, productImages }: { ai: AIService; productImages: ProductImageStore },
) {
  router.get('/sessions/:id/ai', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.assistant(res.locals.accountId, req.params.id));
  });
  router.put('/sessions/:id/ai', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.saveAssistant(res.locals.accountId, req.params.id, req.body));
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
  // Produk, foto, dan pesanan milik data profil. Disediakan di bawah data profil dan, untuk integrasi yang ditulis
  // sebelum ada profil, di bawah sesi (diarahkan ke data profil yang dijalankannya; penulisan pada sesi tanpa data
  // profil membuat dan memasang "CS – <sesi>").
  type Scope = { profile: string | null; session: string };
  function dataRoutes(
    base: string,
    scope: (req: express.Request, res: express.Response, write: boolean) => Promise<Scope>,
  ) {
    const required = (profile: string | null) => {
      if (!profile) throw new ApiError(404, 'not_found', 'Data tidak ditemukan');
      return profile;
    };
    // Produk dan pesanan adalah data CS Usaha; data profil milik profil lain tidak pernah menerimanya.
    const cs = async (res: express.Response, profile: string | null) => {
      const id = required(profile);
      if ((await ai.profileType(res.locals.accountId, id)) !== 'cs')
        throw new ApiError(409, 'profile_mismatch', 'Produk dan pesanan hanya untuk profil CS Usaha.');
      return id;
    };
    router.get(base + '/products', async (req, res) => {
      const { profile } = await scope(req, res, false);
      res.json(profile ? await aiData.products(res.locals.accountId, profile) : []);
    });
    router.put(base + '/products/:product', async (req, res) => {
      const { profile } = await scope(req, res, true);
      const { product, replacedImageId } = await aiData.saveProduct(
        res.locals.accountId,
        await cs(res, profile),
        String(req.params.product),
        record(req.body),
      );
      if (replacedImageId) await productImages.remove(res.locals.accountId, replacedImageId).catch(() => {});
      res.json(product);
    });
    router.post(base + '/products', async (req, res) => {
      const { profile } = await scope(req, res, true);
      const { product } = await aiData.saveProduct(res.locals.accountId, await cs(res, profile), '', record(req.body));
      res.json(product);
    });
    router.post(base + '/products-image', express.raw({ type: '*/*', limit: '12mb' }), async (req, res) => {
      const { profile } = await scope(req, res, true);
      const filename = (req.get('X-Filename') ?? 'photo').slice(0, 255);
      res.json(
        await productImages.save(res.locals.accountId, await cs(res, profile), filename, Readable.from(req.body)),
      );
    });
    router.get(base + '/products-image/:image', async (req, res) => {
      await scope(req, res, false);
      const file = await productImages.get(res.locals.accountId, String(req.params.image));
      res.set('Content-Type', file.mimetype).set('Cache-Control', 'private, max-age=3600').sendFile(file.path);
    });
    router.get(base + '/orders', async (req, res) => {
      const { profile } = await scope(req, res, false);
      res.json(profile ? await aiData.orders(res.locals.accountId, profile) : []);
    });
    router.post(base + '/orders', async (req, res) => {
      const input = record(req.body),
        key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9_-]{1,100}$/.test(key))
        throw new ApiError(400, 'invalid_request', 'Idempotency-Key wajib diisi');
      const { profile, session } = await scope(req, res, true);
      res.json(
        await aiData.createOrder(
          {
            account: res.locals.accountId,
            profile: await cs(res, profile),
            session,
            customer: customerNumber(input.customer),
            requestId: 'manual_' + key,
            knowledge: '',
          },
          orderInput({ items: input.items, notes: input.notes }),
        ),
      );
    });
    router.put(base + '/orders/:order', async (req, res) => {
      const { profile } = await scope(req, res, false);
      res.json(await aiData.updateOrder(res.locals.accountId, required(profile), String(req.params.order), req.body));
    });
    router.delete(base + '/orders/:order', async (req, res) => {
      const { profile } = await scope(req, res, false);
      res.json(await aiData.deleteOrder(res.locals.accountId, required(profile), String(req.params.order)));
    });
  }
  // CS Lembaga Pendidikan: program, kontak, dan dokumen sebuah data profil, atau milik data profil yang dijalankan
  // sesi. Baca dan tulis tidak pernah membuat data profil; sesi tanpa data profil tidak punya apa pun untuk ditampilkan.
  const header = (req: express.Request, name: string) => {
    const value = req.get(name) ?? '';
    try {
      return decodeURIComponent(value);
    } catch {
      throw new ApiError(400, 'invalid_request', 'Header ' + name + ' tidak valid');
    }
  };
  function eduRoutes(base: string, scope: (req: express.Request, res: express.Response) => Promise<string | null>) {
    const target = async (req: express.Request, res: express.Response) => {
      const profile = await scope(req, res);
      if (!profile) throw new ApiError(404, 'data_profile_not_found', 'Sesi ini belum memakai data profil');
      return profile;
    };
    const store = eduData.store;
    router.get(base + '/programs', async (req, res) => {
      const profile = await scope(req, res);
      res.json(profile ? await store.programs(res.locals.accountId, profile) : []);
    });
    router.post(base + '/programs', async (req, res) =>
      res.status(201).json(await store.saveProgram(res.locals.accountId, await target(req, res), null, req.body)),
    );
    router.put(base + '/programs/:program', async (req, res) =>
      res.json(
        await store.saveProgram(res.locals.accountId, await target(req, res), String(req.params.program), req.body),
      ),
    );
    router.delete(base + '/programs/:program', async (req, res) =>
      res.json(await store.deleteProgram(res.locals.accountId, await target(req, res), String(req.params.program))),
    );
    router.get(base + '/contacts', async (req, res) => {
      const profile = await scope(req, res);
      res.json(profile ? await store.contacts(res.locals.accountId, profile) : []);
    });
    router.post(base + '/contacts', async (req, res) =>
      res.status(201).json(await store.saveContact(res.locals.accountId, await target(req, res), null, req.body)),
    );
    router.put(base + '/contacts/:contact', async (req, res) =>
      res.json(
        await store.saveContact(res.locals.accountId, await target(req, res), String(req.params.contact), req.body),
      ),
    );
    router.delete(base + '/contacts/:contact', async (req, res) =>
      res.json(await store.deleteContact(res.locals.accountId, await target(req, res), String(req.params.contact))),
    );
    router.get(base + '/documents', async (req, res) => {
      const profile = await scope(req, res);
      res.json(profile ? await store.documents(res.locals.accountId, profile) : []);
    });
    // Filenya adalah body mentah; nama dan deskripsinya dikirim ter-URI-encode di X-Filename dan X-Description.
    router.post(base + '/documents', express.raw({ type: '*/*', limit: '11mb' }), async (req, res) => {
      const profile = await target(req, res);
      if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'invalid_request', 'File wajib dikirim');
      res
        .status(201)
        .json(
          await store.saveDocument(
            res.locals.accountId,
            profile,
            header(req, 'X-Filename'),
            header(req, 'X-Description'),
            Readable.from([req.body]),
          ),
        );
    });
    router.put(base + '/documents/:document/file', express.raw({ type: '*/*', limit: '11mb' }), async (req, res) => {
      const profile = await target(req, res);
      if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'invalid_request', 'File wajib dikirim');
      res.json(
        await store.replaceDocumentFile(
          res.locals.accountId,
          profile,
          String(req.params.document),
          header(req, 'X-Filename'),
          Readable.from([req.body]),
        ),
      );
    });
    router.patch(base + '/documents/:document', async (req, res) =>
      res.json(
        await store.describeDocument(
          res.locals.accountId,
          await target(req, res),
          String(req.params.document),
          req.body,
        ),
      ),
    );
    router.delete(base + '/documents/:document', async (req, res) =>
      res.json(await store.deleteDocument(res.locals.accountId, await target(req, res), String(req.params.document))),
    );
    router.get(base + '/documents/:document/file', async (req, res) => {
      const file = await store.file(res.locals.accountId, String(req.params.document), await target(req, res));
      const inline = file.media_type === 'image' || file.mimetype === 'application/pdf';
      res
        .set('Content-Type', file.mimetype)
        .set(
          'Content-Disposition',
          (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.filename),
        )
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'private, no-store')
        .sendFile(file.path);
    });
  }
  eduRoutes('/sessions/:id/ai', async (req, res) => {
    const session = String(req.params.id);
    (res.locals.manager as SessionManager).detail(session);
    return ai.sessionProfile(res.locals.accountId, session);
  });
  eduRoutes('/ai/data-profiles/:profile', async (req, res) =>
    ai.ownedDataProfile(res.locals.accountId, req.params.profile),
  );
  dataRoutes('/sessions/:id/ai', async (req, res, write) => {
    const session = String(req.params.id);
    (res.locals.manager as SessionManager).detail(session);
    return {
      session,
      profile: write
        ? await ai.ensureSessionProfile(res.locals.accountId, session)
        : await ai.sessionProfile(res.locals.accountId, session),
    };
  });
  dataRoutes('/ai/data-profiles/:profile', async (req, res) => ({
    session: '',
    profile: await ai.ownedDataProfile(res.locals.accountId, req.params.profile),
  }));
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
  router.post('/sessions/:id/ai/fallbacks/:fallback/knowledge', async (req, res) => {
    res.locals.manager.detail(req.params.id);
    res.json(await ai.applyFallbackKnowledge(res.locals.accountId, req.params.id, req.params.fallback, req.body));
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
