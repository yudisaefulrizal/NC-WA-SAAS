// API editor profil bebas, ekspor/impor, simulasi, dan data koleksi milik akun yang login.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import * as builder from '../domain/builder/store.js';
import { templates } from '../domain/builder/templates.js';
import { simulate } from '../domain/builder/simulation.js';
import { uploadRecordFile, recordFilePath } from '../domain/builder/record-files.js';
import {
  listCollectionSources,
  saveCollectionSource,
  testCollectionSource,
} from '../domain/builder/collection-sources.js';
import { ApiError } from '../../../libraries/errors.js';
export function builderAdminRoutes(app: express.Express) {
  const base = '/api/admin/ai/builder';
  app.get(base, async (_req, res) => res.json(await builder.listGraphs()));
  app.get(base + '/templates', (_req, res) => res.json(templates()));
  app.post(base, async (req, res) => res.status(201).json(await builder.createGraph(res.locals.account.id, req.body)));
  app.delete(base + '/:id', async (req, res) =>
    res.json(await builder.deleteGraph(res.locals.account.id, String(req.params.id), req.body)),
  );
  app.get(base + '/:id', async (req, res) => res.json(await builder.graphState(String(req.params.id))));
  app.put(base + '/:id', async (req, res) =>
    res.json(await builder.saveGraph(res.locals.account.id, String(req.params.id), req.body)),
  );
  app.post(base + '/:id/publish', async (req, res) =>
    res.json(await builder.saveGraph(res.locals.account.id, String(req.params.id), req.body, true)),
  );
  app.get(base + '/:id/versions', async (req, res) => res.json(await builder.versions(String(req.params.id))));
  app.get(base + '/:id/versions/:revision', async (req, res) =>
    res.json(await builder.version(String(req.params.id), Number(req.params.revision))),
  );
  app.get(base + '/:id/export', async (req, res) => {
    const state = await builder.graphState(String(req.params.id));
    res.set('Content-Disposition', 'attachment; filename="profile.json"').json(state.draft);
  });
  app.post(base + '/:id/run', rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    await builder.graphState(String(req.params.id));
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const emit = (event: unknown) => {
      if (res.destroyed) return;
      if (!res.headersSent)
        res.set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify(event) + '\n');
    };
    try {
      await simulate(res.locals.account.id, req.body, emit, controller.signal);
    } catch (e) {
      emit({
        node: 'execution',
        state: 'error',
        error:
          e instanceof ApiError
            ? e.message
            : e instanceof Error && /^ai_[a-z_]+$/.test(e.message)
              ? e.message
              : 'Eksekusi gagal.',
      });
    }
    res.end();
  });
}
export function builderAccountRoutes(app: express.Express) {
  // File field File/gambar: body mentah, nama file ter-URI-encode di X-Filename. Data profil harus milik akun login.
  const files = '/api/ai/record-files/:profile';
  app.post(files, express.raw({ type: '*/*', limit: '11mb' }), async (req, res) => {
    await builder.recordDefinition(res.locals.account.id, String(req.params.profile));
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'invalid_request', 'File wajib dikirim');
    let name: string;
    try {
      name = decodeURIComponent(req.get('X-Filename') ?? '');
    } catch {
      throw new ApiError(400, 'invalid_request', 'Nama file tidak valid');
    }
    res.status(201).json(await uploadRecordFile(res.locals.account.id, String(req.params.profile), name, req.body));
  });
  app.get(files + '/:file', async (req, res) => {
    const file = await recordFilePath(res.locals.account.id, String(req.params.profile), String(req.params.file));
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
  // Sumber data per koleksi: tabel aplikasi atau API milik klien.
  const sources = '/api/ai/record-sources/:profile';
  app.get(sources, async (req, res) =>
    res.json(await listCollectionSources(res.locals.account.id, String(req.params.profile))),
  );
  app.put(sources + '/:collection', async (req, res) =>
    res.json(
      await saveCollectionSource(
        res.locals.account.id,
        String(req.params.profile),
        String(req.params.collection),
        req.body,
      ),
    ),
  );
  app.post(sources + '/:collection/test', async (req, res) =>
    res.json(
      await testCollectionSource(res.locals.account.id, String(req.params.profile), String(req.params.collection)),
    ),
  );
  const base = '/api/ai/records/:profile';
  app.get(base, async (req, res) => {
    const d = await builder.recordDefinition(res.locals.account.id, String(req.params.profile));
    res.json({ name: d.name, collections: d.collections });
  });
  app.get(base + '/:collection', async (req, res) =>
    res.json(
      await builder.readRecords(
        res.locals.account.id,
        String(req.params.profile),
        String(req.params.collection),
        String(req.query.q ?? ''),
        Number(req.query.page ?? 0),
        req.query.customer ? String(req.query.customer) : undefined,
      ),
    ),
  );
  app.post(base + '/:collection', async (req, res) =>
    res
      .status(201)
      .json(
        await builder.writeRecord(
          res.locals.account.id,
          String(req.params.profile),
          String(req.params.collection),
          'create',
          req.body,
        ),
      ),
  );
  app.put(base + '/:collection', async (req, res) =>
    res.json(
      await builder.writeRecord(
        res.locals.account.id,
        String(req.params.profile),
        String(req.params.collection),
        'update',
        req.body,
      ),
    ),
  );
  app.delete(base + '/:collection', async (req, res) =>
    res.json(
      await builder.writeRecord(
        res.locals.account.id,
        String(req.params.profile),
        String(req.params.collection),
        'delete',
        req.body,
      ),
    ),
  );
}
