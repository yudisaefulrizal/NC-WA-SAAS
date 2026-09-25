// Rute HTTP Auto Share: galeri aset, kontak, pengaturan, template (dengan uji sumber langsung), jadwal
// pengiriman, dan riwayatnya. Dipasang di router gateway yang terautentikasi, di bawah /auto-share.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { sniffMediaType } from '../../../libraries/media-type.js';
import { decrypt } from '../../../libraries/crypto.js';
import { tidyMessage } from '../domain/tidy.js';
import {
  decodeHeaders,
  maxSourceMediaBytes,
  mediaVariable,
  renderTemplate,
  validateHeaders,
  validateSourceData,
  validateSourceMedia,
  type SourceHeaders,
} from '../domain/source.js';
import { accountLock, lockJob, enqueue, type createAutoShare } from '../domain/auto-share.js';
import { invalid, jsonArray, expose } from '../domain/inputs.js';
import * as daftarKontakSql from '../data-access/daftar-kontak-queries.js';
import * as deliveriesSql from '../data-access/deliveries-queries.js';
import * as jobsSql from '../data-access/jobs-queries.js';
import * as runsSql from '../data-access/runs-queries.js';
import * as settingsSql from '../data-access/settings-queries.js';
import * as shareAssetsSql from '../data-access/share-assets-queries.js';
import * as templatesSql from '../data-access/templates-queries.js';
export function autoShareRouter(share: ReturnType<typeof createAutoShare>) {
  const { assets, getManager, prefetchSource, quota, saveContact, saveTemplate, saveJob, source, download, aiConfig } =
    share;
  const router = express.Router();
  router.post('/assets', express.raw({ type: '*/*', limit: '32mb' }), async (req, res) => {
    const account = res.locals.accountId;
    const filename = (req.get('X-Filename') ?? 'asset').slice(0, 255);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw invalid('Isi file kosong atau tidak terbaca');
    const saved = await assets.save(account, filename, Readable.from(req.body), await quota(account));
    res.status(201).json({
      id: saved.id,
      filename: saved.filename,
      mimetype: saved.mimetype,
      media_type: saved.mediaType,
      size_bytes: saved.sizeBytes,
    });
  });
  router.get('/assets', async (req, res) => {
    const account = res.locals.accountId;
    const [rows] = await shareAssetsSql.listByAccount(db, [account]);
    const [[usage]] = await shareAssetsSql.countUsage(db, [account]);
    const limit = await quota(account);
    res.json({
      assets: rows,
      used_count: Number(usage.count),
      used_bytes: Number(usage.bytes),
      max_count: limit.maxCount,
      max_bytes: limit.maxBytes,
    });
  });
  router.get('/assets/:id/file', async (req, res) => {
    const file = await assets.get(res.locals.accountId, req.params.id);
    res
      .set('Content-Type', file.mimetype)
      .set('Content-Disposition', 'inline')
      .set('Cache-Control', 'private, no-store')
      .sendFile(file.path);
  });
  router.put('/assets/:id/public', async (req, res) => {
    const isPublic = object(req.body).public;
    if (typeof isPublic !== 'boolean') throw invalid('Status publik tidak valid');
    const token = await assets.setPublic(res.locals.accountId, req.params.id, isPublic);
    res.json({ public_token: token });
  });
  router.delete('/assets/:id', async (req, res) => {
    const account = res.locals.accountId;
    const [used] = await templatesSql.listUsingAsset(db, [account, req.params.id]);
    if (used.length)
      throw new ApiError(
        409,
        'asset_in_use',
        'Asset masih digunakan oleh template. Hapus dari template terlebih dahulu.',
      );
    const [rows] = await shareAssetsSql.findOwned(db, [account, req.params.id]);
    if (!rows.length) throw new ApiError(404, 'asset_not_found', 'Asset tidak ditemukan');
    await assets.remove(account, req.params.id);
    await shareAssetsSql.deleteOwned(db, [account, req.params.id]);
    res.json({ ok: true });
  });
  router.get('/contacts', async (_req, res) => {
    const [rows] = await daftarKontakSql.listSorted(db, [res.locals.accountId]);
    res.json(rows);
  });
  router.post('/contacts', async (req, res) =>
    res.status(201).json(await saveContact(res.locals.accountId, randomUUID(), req.body, false)),
  );
  router.put('/contacts/:id', async (req, res) =>
    res.json(await saveContact(res.locals.accountId, req.params.id, req.body, true)),
  );
  router.delete('/contacts/:id', async (req, res) => {
    await daftarKontakSql.deleteOwned(db, [res.locals.accountId, req.params.id]);
    res.json({ ok: true });
  });
  router.get('/settings', async (_req, res) => {
    const [rows] = await settingsSql.findAutoAdd(db, [res.locals.accountId]);
    res.json({ auto_add_enabled: !!rows[0]?.auto_add_enabled });
  });
  router.put('/settings', async (req, res) => {
    const input = object(req.body);
    if (typeof input.auto_add_enabled !== 'boolean') throw invalid('Status tambah kontak otomatis tidak valid');
    await settingsSql.upsert(db, [res.locals.accountId, input.auto_add_enabled]);
    res.json({ auto_add_enabled: input.auto_add_enabled });
  });
  router.get('/templates', async (_req, res) => {
    const [rows] = await templatesSql.listByAccount(db, [res.locals.accountId]);
    // Nilai header tidak pernah keluar dari server; form hanya butuh namanya untuk menampilkan baris.
    res.json(
      rows.map(({ source_secret, ...t }) => ({
        ...t,
        source_header_names: Object.keys(decodeHeaders(source_secret ? decrypt(source_secret as string) : '')),
      })),
    );
  });
  // Memperlihatkan variabel apa saja yang benar-benar dikirim endpoint, supaya tidak perlu menebak nama.
  router.post('/templates/test-source', async (req, res) => {
    const b = object(req.body),
      account = res.locals.accountId;
    const endpoint = requiredString(b.source_endpoint, 'Endpoint', 512);
    const typed = validateHeaders(b.source_headers);
    let stored: SourceHeaders = {};
    if (typeof b.template_id === 'string' && b.template_id) {
      const [rows] = await templatesSql.findSource(db, [account, b.template_id]);
      if (rows[0]?.source_secret && rows[0].source_endpoint === endpoint)
        stored = decodeHeaders(decrypt(rows[0].source_secret as string));
    }
    // Nilai kosong memakai secret yang tersimpan, jadi uji bisa jalan tanpa mengetik ulang.
    const headers: SourceHeaders = {};
    for (const [name, value] of Object.entries(typed)) if (value || stored[name]) headers[name] = value || stored[name];
    const body = await source(endpoint, headers);
    const variables = validateSourceData(body);
    let media = null;
    if (b.media_source === 'endpoint') {
      const found = await validateSourceMedia(variables, mediaVariable(b.media_variable));
      const file = await download(found.url, { maxBytes: maxSourceMediaBytes });
      try {
        const head = await readFile(file.path);
        const sniffed = sniffMediaType(head.subarray(0, 64), found.filename ?? new URL(found.url).pathname);
        if (!sniffed) throw invalid('Jenis media dari sumber data tidak didukung');
        media = { url: found.url, media_type: sniffed.mediaType, size_bytes: head.length };
      } finally {
        await file.cleanup();
      }
    }
    // Body mentah dikembalikan supaya respons yang bentuknya salah terlihat di dialog, dibatasi supaya
    // payload besar tidak membuat form bengkak.
    // Memperlihatkan hasil kirim sebenarnya, termasuk perapian opsional, supaya jadwal tidak pernah
    // dinyalakan untuk hasil yang belum pernah dilihat.
    let preview = null;
    if (typeof b.message === 'string' && b.message.trim()) {
      try {
        const substituted = renderTemplate(b.message, variables);
        const tidy =
          b.tidy === true
            ? await tidyMessage(
                account,
                substituted,
                await aiConfig(),
                undefined,
                typeof b.tidy_note === 'string' ? b.tidy_note : '',
              )
            : { message: substituted, tidied: false, reason: null };
        preview = { message: tidy.message, tidied: tidy.tidied, note: tidy.reason };
      } catch (error) {
        preview = {
          message: null,
          tidied: false,
          note: error instanceof ApiError ? error.message : 'Gagal menyusun pratinjau',
        };
      }
    }
    res.json({ ok: true, variables, media, preview, raw: JSON.stringify(body, null, 1).slice(0, 2000) });
  });
  router.post('/templates', async (req, res) =>
    res.status(201).json(await saveTemplate(res.locals.accountId, randomUUID(), req.body, false)),
  );
  router.put('/templates/:id', async (req, res) =>
    res.json(await saveTemplate(res.locals.accountId, req.params.id, req.body, true)),
  );
  router.delete('/templates/:id', async (req, res) => {
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      await accountLock(c, res.locals.accountId);
      const [jobs] = await jobsSql.listTemplateIds(c, [res.locals.accountId]);
      if (jobs.some(j => jsonArray(j.template_ids).includes(req.params.id)))
        throw new ApiError(
          409,
          'template_in_use',
          'Template masih digunakan oleh pengiriman. Hapus dari pengiriman terlebih dahulu.',
        );
      await templatesSql.deleteOwned(c, [res.locals.accountId, req.params.id]);
      await c.commit();
      res.json({ ok: true });
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  });
  router.get('/jobs', async (_req, res) => {
    const [rows] = await jobsSql.listByAccount(db, [res.locals.accountId]);
    res.json(rows.map(expose));
  });
  router.post('/jobs', async (req, res) =>
    res.status(201).json(await saveJob(res.locals.accountId, randomUUID(), req.body, false)),
  );
  router.put('/jobs/:id', async (req, res) =>
    res.json(await saveJob(res.locals.accountId, req.params.id, req.body, true)),
  );
  router.delete('/jobs/:id', async (req, res) => {
    await jobsSql.deleteOwned(db, [res.locals.accountId, req.params.id]);
    res.json({ ok: true });
  });
  router.post('/jobs/:id/send', async (req, res) => {
    const account = res.locals.accountId,
      templateId = requiredString(object(req.body).template_id, 'Template', 36);
    const [jobs] = await jobsSql.findOwned(db, [account, req.params.id]);
    if (!jobs[0]) throw new ApiError(404, 'not_found', 'Pengiriman tidak ditemukan');
    if (!jsonArray(jobs[0].template_ids).includes(templateId)) throw invalid('Pilih template dari pengiriman ini');
    const resolved = await prefetchSource(account, jobs[0], templateId);
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      await accountLock(c, account);
      const t = await lockJob(c, account, req.params.id);
      (await getManager(t.account_id)).connected(t.session_id);
      const result = await enqueue(c, t, 'manual', templateId, resolved);
      await c.commit();
      res.status(202).json(result);
    } catch (e) {
      await c.rollback();
      if (resolved) await assets.removeRunAssets(resolved.runId).catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });
  router.get('/runs', async (_req, res) => {
    const [rows] = await runsSql.listHistory(db, [res.locals.accountId]);
    res.json(rows);
  });
  router.get('/runs/:id', async (req, res) => {
    const [rows] = await deliveriesSql.listForRun(db, [res.locals.accountId, req.params.id]);
    res.json(rows);
  });
  return router;
}
