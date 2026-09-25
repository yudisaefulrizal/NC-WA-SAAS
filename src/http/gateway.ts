// Gateway untuk klien API dan dashboard: SessionManager per akun, autentikasi lewat API key atau cookie, rute sesi,
// AI, dan Auto Share, serta penyambungan event WhatsApp ke riwayat chat, webhook, AI, dan Auto Share.
import {
  sessionRoutes,
  sessionDetailRoutes,
  TenantWebhooks,
  MediaStore,
  EventStream,
  SessionManager,
  type Connector,
  SessionStore,
  baileysConnector,
} from '../components/whatsapp/index.js';
import {
  aiRoutes,
  ai as defaultAI,
  ProductImageStore,
  customerOf,
  onChatChange,
  recordIncoming,
  recordOutgoing,
  updateStatus,
  eduData,
} from '../components/ai/index.js';
import { autoShareRouter, createAutoShare, AssetStore } from '../components/auto-share/index.js';
import { record } from '../libraries/validation.js';
import express from 'express';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../libraries/db.js';
import { digest } from '../libraries/security.js';
import { storagePaths, storageRoot } from '../libraries/storage.js';
import { basicWallet } from '../components/billing/index.js';
import { ApiError } from '../libraries/errors.js';
import { referral as defaultReferral } from '../components/referral/index.js';
import { accountByApiKeyHash, accountByLoginToken, accountStatus, activeAccount } from '../components/account/index.js';

export function createGateway(
  connector?: (accountId: string, store: SessionStore) => Connector,
  root = storageRoot,
  ai = defaultAI,
  referral = defaultReferral,
) {
  const paths = storagePaths(root);
  const hooks = new TenantWebhooks();
  referral.currentNumbersProvider = async (accountId: string) => {
    const pending = managers.get(accountId);
    if (!pending) return [];
    const m = await pending;
    return m
      .list()
      .filter(s => s.status === 'connected' && s.phone)
      .map(s => s.phone as string);
  };
  const media = new Map<string, MediaStore>();
  const streams = new Map<string, EventStream>();
  const pending = new Map<string, number>();
  const managers = new Map<string, Promise<SessionManager>>();
  onChatChange((account, sessionId, customer) =>
    streams.get(account)?.push({ event: 'chat.updated', sessionId, customer }),
  );
  // Riwayat chat hanya tampilan; gagal mencatatnya tidak pernah menahan pengiriman, balasan AI, atau webhook.
  const history = (work: Promise<unknown>) =>
    work.catch(error => console.error('Riwayat chat gagal dicatat.', error instanceof Error ? error.message : error));
  async function manager(id: string) {
    if (!managers.has(id))
      managers.set(
        id,
        (async () => {
          const store = new SessionStore(join(paths.whatsapp, id));
          const result = new SessionManager(
            connector
              ? connector(id, store)
              : baileysConnector(store, (session, messageId) => ai.registerSystemMessage(id, session, messageId)),
            store,
          );
          const files = new MediaStore(join(paths.media, id), process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067');
          const events = new EventStream();
          media.set(id, files);
          streams.set(id, events);
          result.onEvent = async event => {
            events.push(event);
            await hooks.enqueue(id, event);
            if (
              event.event === 'session.status' &&
              event.status === 'connected' &&
              typeof event.phone === 'string' &&
              event.phone
            )
              await referral.qualify(id, event.phone).catch(() => {});
          };
          result.onBeforeSend = async () => {
            const [accounts] = await accountStatus(id);
            if (!accounts[0] || accounts[0].suspended) {
              await result.applyLimit(0);
              throw new ApiError(403, 'account_suspended', 'Akun dinonaktifkan');
            }
            await result.applyLimit((await basicWallet(id)).session_limit);
          };
          result.onOutgoing = async (session, message) => {
            const { download, ...data } = message;
            events.push({ event: 'message', direction: 'outgoing', sessionId: session.id, ...data, media: null });
            // Gema kiriman API/AI/Auto Share sudah didaftarkan sebagai 'system' sebelum dikirim dan dicatat oleh onSent.
            if (!message.isGroup)
              await history(
                (async () => {
                  if ((await ai.knownOrigin(id, session.id, message.messageId)) !== 'system')
                    await recordOutgoing(id, session.id, {
                      customer: message.from,
                      messageId: message.messageId,
                      origin: 'manual',
                      type: message.type,
                      text: message.text,
                    });
                })(),
              );
            await ai.manualOutgoing(id, session.id, message);
            const added = await autoShare.listen(id, message, true);
            if (added) events.push({ event: 'auto_share.contact_added', sessionId: session.id, ...added });
          };
          result.onSent = async (session, message) => {
            const content = message.content,
              text = 'text' in content ? content.text : (content.caption ?? `[Pesan ${content.type}]`);
            const customer = customerOf(message.to);
            if (customer)
              await history(
                recordOutgoing(id, session.id, {
                  customer,
                  messageId: message.messageId,
                  origin: 'api',
                  type: 'text' in content ? 'text' : content.type,
                  text: 'text' in content ? content.text : (content.caption ?? content.filename ?? ''),
                }),
              );
            events.push({
              event: 'message',
              direction: 'outgoing',
              sessionId: session.id,
              messageId: message.messageId,
              from: message.to,
              sender: message.to,
              isGroup: message.to.endsWith('@g.us'),
              groupId: message.to.endsWith('@g.us') ? message.to : null,
              type: 'text' in content ? 'text' : content.type,
              text,
              timestamp: Math.floor(Date.now() / 1000),
              media: null,
            });
          };
          result.onReceipt = async (session, receipt) => {
            await history(updateStatus(id, session.id, receipt.messageId, receipt.status));
          };
          result.onIncoming = async (session, message) => {
            await result.onBeforeSend!();
            if (result.detail(session.id).serviceActive === false) return;
            await history(recordIncoming(id, session.id, message));
            const { download, ...data } = message;
            const stored = await files.save(session.id, message);
            const event = { event: 'message', sessionId: session.id, direction: 'incoming', ...data, media: stored };
            events.push(event);
            await hooks.enqueue(id, event);
            await ai.incoming(id, result, session.id, message);
          };
          try {
            await files.prune();
            await result.restore((await basicWallet(id)).session_limit);
            return result;
          } catch (error) {
            await result.stop();
            throw error;
          }
        })().catch(e => {
          managers.delete(id);
          throw e;
        }),
      );
    return managers.get(id)!;
  }
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.use(async (req, res, next) => {
    const key = req.get('X-API-Key');
    let rows: RowDataPacket[];
    if (key) {
      [rows] = await accountByApiKeyHash(digest(key));
    } else {
      const token =
        req.headers.cookie
          ?.split(';')
          .map(v => v.trim())
          .find(v => v.startsWith('ncwa_session='))
          ?.slice(13) ?? '';
      if (
        !['GET', 'HEAD'].includes(req.method) &&
        req.get('origin') !== (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067')
      ) {
        res.status(403).json({ error: 'invalid_origin' });
        return;
      }
      [rows] = await accountByLoginToken(digest(token));
    }
    if (!rows[0]) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.locals.accountId = rows[0].id;
    res.locals.manager = await manager(rows[0].id);
    await (res.locals.manager as SessionManager).onBeforeSend!();
    next();
  });
  const shareAssets = new AssetStore(paths.shareAssets, db);
  const productImages = new ProductImageStore(paths.productImages);
  ai.productImages = productImages;
  // Dokumen CS Lembaga Pendidikan disimpan di samping foto produk, di bawah folder penyimpanan gateway ini.
  eduData.store.root = paths.aiDocuments;
  const autoShare = createAutoShare(manager, shareAssets);
  router.use('/auto-share', autoShareRouter(autoShare));
  const routeContext = { pending, hooks, media, streams, ai };
  sessionRoutes(router, routeContext);
  aiRoutes(router, { ai, productImages });
  sessionDetailRoutes(router, routeContext);
  let maintenance: ReturnType<typeof setInterval> | undefined;
  let refreshing: Promise<void> | undefined;
  async function refresh() {
    for (const [id, pending] of managers) {
      const m = await pending;
      const [rows] = await accountStatus(id);
      await m.applyLimit(!rows[0] || rows[0].suspended ? 0 : (await basicWallet(id)).session_limit);
      await media.get(id)?.prune();
    }
  }
  async function restore() {
    maintenance ??= setInterval(() => {
      refreshing ??= refresh()
        .catch(() => console.error('Penyegaran hak session gagal.'))
        .finally(() => {
          refreshing = undefined;
        });
    }, 30000).unref();

    // Hanya folder tersimpan milik akun yang masih ada yang boleh membuka koneksi.
    const entries = await readdir(paths.whatsapp, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name)) continue;
      const [rows] = await activeAccount(entry.name);
      if (rows[0]) await manager(rows[0].id);
    }
  }
  return {
    router,
    restore,
    autoShare,
    shareAssets,
    start: () => {
      hooks.start();
      autoShare.start();
    },
    refresh,
    health: () => ({ loadedAccounts: managers.size, pendingSends: [...pending.values()].reduce((a, b) => a + b, 0) }),
    revoke: (account: string, tag?: string) => {
      const stream = streams.get(account);
      if (tag) stream?.revoke(tag);
      else stream?.stop();
    },
    stop: async () => {
      clearInterval(maintenance);
      await refreshing;
      await autoShare.stop();
      await hooks.stop();
      await ai.stop();
      for (const stream of streams.values()) stream.stop();
      for (const pending of managers.values()) await (await pending).stop();
      for (const files of media.values()) await files.flush();
      managers.clear();
    },
  };
}
export const gateway = createGateway();
