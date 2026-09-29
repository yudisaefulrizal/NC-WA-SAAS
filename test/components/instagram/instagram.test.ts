// Tes Instagram DM lewat Zernio dengan server Zernio tiruan: akun Zernio per klien (lebih dari satu), alur hubungkan
// Instagram lewat state sekali pakai, DM masuk dijawab AI lewat Zernio, balasan manual menjeda AI, fallback
// diberitahukan ke tim lewat WhatsApp dan jawabannya diteruskan ke DM, tanda tangan webhook, putus, dan hapus akun.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage as HttpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import { type Update } from '../../../src/components/whatsapp/domain/sessions.js';
import { createGateway } from '../../../src/http/gateway.js';
import { createApp } from '../../../src/http/app.js';
import { chatMessages } from '../../../src/components/ai/domain/chat.js';
import { publishGraph, simpleGraph } from '../ai/graph-fixture.js';

// Server Zernio tiruan: hanya kunci yang dikenal yang diterima, dan setiap permintaan dicatat.
const validKeys = new Set(['sk_test_pusat_12345', 'sk_test_cabang_1234']);
const zernio = {
  // Profil adalah milik klien; NC-WA hanya membaca, tidak pernah membuat profil.
  profiles: new Map([
    ['sk_test_pusat_12345', [{ _id: 'prof-pusat_', name: 'Default', isDefault: true }]],
    ['sk_test_cabang_1234', [{ _id: 'prof-cabang', name: 'Default', isDefault: true }]],
  ]),
  instagram: new Map([
    ['sk_test_pusat_12345', [{ _id: 'igacc1', username: 'kopisenja.id', needsReconnection: false }]],
    ['sk_test_cabang_1234', [] as { _id: string; username: string; needsReconnection: boolean }[]],
  ]),
  createdProfiles: 0,
  webhookBodies: [] as Record<string, unknown>[],
  webhooks: new Map<string, { _id: string; url: string; secret: string; isActive: boolean }[]>(),
  redirects: [] as string[],
  sent: [] as { key: string; recipient: string; body: Record<string, unknown> }[],
  deleted: [] as string[],
  sequence: 0,
};
async function body(req: HttpRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
const server = createServer(async (req, res) => {
  const key = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const url = new URL(req.url!, 'http://zernio.test');
  const reply = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (!validKeys.has(key)) return reply(401, { error: 'Unauthorized' });
  const profiles = zernio.profiles.get(key) ?? [];
  const webhooks = zernio.webhooks.get(key) ?? [];
  const route = req.method + ' ' + url.pathname;
  if (route === 'GET /api/v1/profiles') return reply(200, { profiles });
  if (route === 'POST /api/v1/profiles') {
    zernio.createdProfiles++;
    return reply(201, { profile: { _id: 'baru', name: 'baru' } });
  }
  if (route === 'GET /api/v1/webhooks/settings') return reply(200, { webhooks });
  if (route === 'POST /api/v1/webhooks/settings') {
    const input = await body(req);
    zernio.webhookBodies.push(input);
    const webhook = {
      _id: 'wh' + ++zernio.sequence,
      url: String(input.url),
      secret: String(input.secret),
      isActive: true,
    };
    zernio.webhooks.set(key, [...webhooks, webhook]);
    return reply(200, { success: true, webhook: { _id: webhook._id } });
  }
  if (route === 'DELETE /api/v1/webhooks/settings') {
    zernio.deleted.push(url.searchParams.get('webhookId')!);
    zernio.webhooks.set(
      key,
      webhooks.filter(w => w._id !== url.searchParams.get('webhookId')),
    );
    return reply(200, { success: true });
  }
  if (route === 'GET /api/v1/connect/instagram') {
    zernio.redirects.push(url.searchParams.get('redirect_url')!);
    return reply(200, { authUrl: 'https://zernio.test/oauth/instagram', state: 'x' });
  }
  if (route === 'GET /api/v1/accounts')
    return reply(200, {
      accounts: (zernio.instagram.get(key) ?? []).map(a => ({ ...a, platform: 'instagram', isActive: true })),
    });
  const send = url.pathname.match(/^\/api\/v1\/inbox\/conversations\/([^/]+)\/messages$/);
  if (req.method === 'POST' && send) {
    zernio.sent.push({ key, recipient: decodeURIComponent(send[1]), body: await body(req) });
    // mid Instagram sungguhan bisa melewati panjang kolom riwayat chat.
    return reply(200, { success: true, data: { messageId: 'mid.' + ++zernio.sequence + 'x'.repeat(160) } });
  }
  reply(404, { error: 'not found' });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.ZERNIO_API_URL = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';

class FixtureAI extends AIService {
  override async config() {
    return { ...defaults, secret: 'fixture' };
  }
}
// Jawaban AI bisa diganti per tes: jawaban biasa atau fallback ke tim.
let answer: () => string = () => JSON.stringify({ answer: 'Ada kak, kopi susu 25 ribu.' });
const transport: AITransport = async c => {
  if (c.call_role === 'router') return JSON.stringify({ branch: 'info', fallback_terkait: [] });
  if (c.call_role === 'context') return 'Pelanggan menanyakan kopi susu.';
  return answer();
};
const ai = new FixtureAI(transport, async () => {});
// WhatsApp tiruan untuk sesi WhatsApp akun yang sama (tempat notifikasi fallback dikirim).
const whatsapp = new Map<string, (event: Update) => void>();
const whatsappSent: { session: string; jid: string; text: string }[] = [];
const root = await mkdtemp(join(tmpdir(), 'ncwa-instagram-'));
const gateway = createGateway(
  account => async (session, update) => {
    whatsapp.set(account + '/' + session, update);
    update({ status: 'connected', phone: '628111111111' });
    return {
      close() {},
      async logout() {},
      async send(jid, content) {
        whatsappSent.push({ session, jid, text: 'text' in content ? content.text : '' });
        return 'WA' + ++zernio.sequence;
      },
    };
  },
  root,
  ai,
);
const app = createApp(gateway);
const owner = randomUUID(),
  account = randomUUID(),
  token = randomUUID(),
  apiKey = randomUUID();
let graph = '';
const cookie = 'ncwa_session=' + token;
const customer = '17841400000000001';
before(async () => {
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
    owner,
    owner + '@test.invalid',
    'unused',
  ]);
  graph = await publishGraph(owner, simpleGraph('Profil uji Instagram'));
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    account,
  ]);
  await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)', [
    randomUUID(),
    account,
    digest(apiKey),
  ]);
  await basicWallet(account);
  await db.execute('UPDATE wallets SET session_limit=4 WHERE account_id=?', [account]);
  await ai.adjust(owner, account, { amount: 10000, reason: 'fixture', requestId: 'fixture-ig' });
});
after(async () => {
  await gateway.stop();
  await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [graph]);
  await db.execute('DELETE FROM ai_profile_types WHERE id=?', [graph]);
  for (const id of [account, owner]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
  server.close();
  await rm(root, { recursive: true, force: true });
});
async function until(check: () => Promise<boolean> | boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 30));
  }
  assert.fail('Tidak terjadi: ' + label);
}
const api = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(app)[method](path).set('Cookie', cookie).set('Origin', origin);
function webhook(zernioId: string, payload: Record<string, unknown>, secret?: string) {
  const raw = JSON.stringify(payload);
  const key = secret ?? [...zernio.webhooks.values()].flat().find(w => w.url.endsWith(zernioId))!.secret;
  return request(app)
    .post('/zernio/webhook/' + zernioId)
    .set('Content-Type', 'application/json')
    .set('X-Zernio-Signature', createHmac('sha256', key).update(raw).digest('hex'))
    .send(raw);
}
function dm(id: string, text: string, event = 'message.received', extra: Record<string, unknown> = {}) {
  return {
    id,
    event,
    message: {
      id: 'z-' + id,
      conversationId: 'conv1',
      platform: 'instagram',
      platformMessageId: 'mid-in-' + id,
      direction: event === 'message.received' ? 'incoming' : 'outgoing',
      text,
      attachments: [],
      sender: { id: customer, name: 'Nadia', username: 'nadia.rhm' },
      sentAt: new Date().toISOString(),
      isRead: false,
      sentVia: null,
      ...extra,
    },
    conversation: { id: 'conv1', platformConversationId: customer, participantId: customer, status: 'active' },
    account: {
      id: 'igacc1',
      accountId: 'igacc1',
      profileId: 'prof-pusat_',
      platform: 'instagram',
      username: 'kopisenja.id',
    },
    timestamp: new Date().toISOString(),
  };
}
let pusat = '';

test('Zernio accounts: key checked, webhook registered without touching profiles, several per client, duplicates refused', async () => {
  const invalid = await api('post', '/api/instagram/zernio').send({ name: 'Salah', apiKey: 'sk_test_unknown_999' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'zernio_unauthorized');
  pusat = (
    await api('post', '/api/instagram/zernio').send({ name: 'Pusat', apiKey: 'sk_test_pusat_12345' }).expect(200)
  ).body.id;
  await api('post', '/api/instagram/zernio').send({ name: 'Cabang', apiKey: 'sk_test_cabang_1234' }).expect(200);
  const again = await api('post', '/api/instagram/zernio').send({ name: 'Lagi', apiKey: 'sk_test_pusat_12345' });
  assert.equal(again.body.error, 'zernio_exists');
  assert.equal(zernio.createdProfiles, 0);
  assert.ok(zernio.webhookBodies.every(b => b.profileIds === undefined));
  const hook = zernio.webhooks.get('sk_test_pusat_12345')![0];
  assert.equal(hook.url, origin + '/zernio/webhook/' + pusat);
  const list = (await api('get', '/api/instagram/zernio').expect(200)).body;
  assert.deepEqual(
    list.map((z: { name: string; key_hint: string; webhook: boolean }) => [z.name, z.key_hint, z.webhook]),
    [
      ['Pusat', '2345', true],
      ['Cabang', '1234', true],
    ],
  );
  assert.equal(JSON.stringify(list).includes('sk_test'), false);
  // Kunci pengganti dari akun Zernio lain ditolak; webhook yang hilang didaftarkan ulang saat diperiksa.
  const other = await api('put', '/api/instagram/zernio/' + pusat + '/key').send({ apiKey: 'sk_test_cabang_1234' });
  assert.equal(other.body.error, 'zernio_other_account');
  zernio.webhooks.set('sk_test_pusat_12345', []);
  await api('post', '/api/instagram/zernio/' + pusat + '/check').expect(200);
  assert.equal(zernio.webhooks.get('sk_test_pusat_12345')!.length, 1);
});

test('Connect flow: existing Instagram accounts attach directly, new ones log in with a one-time state', async () => {
  await request(app).post('/sessions').set('X-API-Key', apiKey).send({ id: 'wa' }).expect(200);
  const listed = (await api('get', '/api/instagram/zernio/' + pusat + '/instagram').expect(200)).body;
  assert.deepEqual(listed, [{ id: 'igacc1', username: 'kopisenja.id', active: true, session: null }]);
  // Akun yang sudah ada di Zernio dipasang tanpa login ulang.
  const direct = await api('post', '/api/instagram/connect')
    .send({ zernioId: pusat, sessionId: 'ig-shop', instagramId: 'igacc1' })
    .expect(200);
  assert.deepEqual(direct.body, { connected: true, message: '@kopisenja.id terhubung sebagai sesi ig-shop.' });
  assert.equal(zernio.redirects.length, 0);
  const sessions = (await request(app).get('/sessions').set('X-API-Key', apiKey).expect(200)).body;
  const ig = sessions.find((s: { id: string }) => s.id === 'ig-shop');
  assert.equal(ig.channel, 'instagram');
  assert.equal(ig.status, 'connected');
  assert.equal(ig.phone, '@kopisenja.id');
  const duplicate = await api('post', '/api/instagram/connect').send({
    zernioId: pusat,
    sessionId: 'ig-dua',
    instagramId: 'igacc1',
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.message, /sudah terpasang sebagai sesi ig-shop/);
  // Akun baru: login lewat Zernio, lalu dipasang saat dialihkan balik.
  const started = await api('post', '/api/instagram/connect')
    .send({ zernioId: pusat, sessionId: 'ig-baru' })
    .expect(200);
  assert.equal(started.body.authUrl, 'https://zernio.test/oauth/instagram');
  const redirect = new URL(zernio.redirects.at(-1)!);
  assert.equal(redirect.origin + redirect.pathname, origin + '/zernio/callback');
  const state = redirect.searchParams.get('state')!;
  zernio.instagram
    .get('sk_test_pusat_12345')!
    .push({ _id: 'igacc2', username: 'kopisenja.dago', needsReconnection: false });
  // Username dari URL diabaikan; yang dipakai data akun dari API Zernio.
  const back = await request(app)
    .get('/zernio/callback')
    .query({ state, connected: 'instagram', accountId: 'igacc2', username: 'palsu' })
    .expect(200);
  assert.match(back.text, /http-equiv="refresh"/);
  assert.match(decodeURIComponent(back.text.replaceAll('+', ' ')), /@kopisenja\.dago terhubung sebagai sesi ig-baru/);
  const replay = await request(app).get('/zernio/callback').query({ state, accountId: 'igacc2' }).expect(200);
  assert.match(decodeURIComponent(replay.text.replaceAll('+', ' ')), /kedaluwarsa/);
});

test('Incoming DM is answered by AI through Zernio, recorded like a number, and signatures are enforced', async () => {
  const data = await ai.createDataProfile(account, { profile_type: graph, name: 'Kopi Senja' });
  await ai.attachProfile(account, 'ig-shop', { data_profile_id: data.id, enabled: true });
  const forged = await webhook(pusat, dm('forged', 'Halo'), 'bukan-secret');
  assert.equal(forged.status, 401);
  await webhook(pusat, dm('evt-1', 'Kak, kopi susu ada?')).expect(200);
  // Kiriman ulang Zernio dengan id event yang sama tidak diproses dua kali.
  await webhook(pusat, dm('evt-1', 'Kak, kopi susu ada?')).expect(200);
  await until(() => zernio.sent.length === 1, 'balasan AI terkirim ke Zernio');
  assert.deepEqual(zernio.sent[0], {
    key: 'sk_test_pusat_12345',
    recipient: customer,
    body: { accountId: 'igacc1', message: 'Ada kak, kopi susu 25 ribu.' },
  });
  let history: Awaited<ReturnType<typeof chatMessages>>['messages'] = [];
  await until(async () => {
    history = (await chatMessages(account, 'ig-shop', customer)).messages.filter(m => m.direction !== 'note');
    return history.length === 2;
  }, 'riwayat chat tercatat');
  assert.deepEqual(
    history.filter(m => m.direction !== 'note').map(m => [m.direction, m.text]),
    [
      ['in', 'Kak, kopi susu ada?'],
      ['out', 'Ada kak, kopi susu 25 ribu.'],
    ],
  );
  assert.ok(history.every(m => m.id.length <= 128));
  const contacts = (await api('get', '/api/instagram/contacts?session=ig-shop').expect(200)).body;
  assert.deepEqual(contacts, [{ customer, username: 'nadia.rhm', name: 'Nadia' }]);
  // Gema kiriman NC-WA sendiri tidak dianggap balasan manual.
  await webhook(pusat, dm('echo-1', 'Ada kak, kopi susu 25 ribu.', 'message.sent', { sentVia: 'api' })).expect(200);
  const [paused] = await db.execute<any[]>(
    'SELECT paused FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    [account, 'ig-shop', customer],
  );
  assert.equal(Boolean(paused[0].paused), false);
});

test('Fallback from an Instagram DM notifies the team on WhatsApp and relays the answer back to the DM', async () => {
  await ai.saveField(account, 'ig-shop', 'fallback_number', '628999999999');
  await ai.saveField(account, 'ig-shop', 'fallback_notify', true);
  answer = () => JSON.stringify({ fallback: 'Diskon borongan', question: 'Boleh diskon untuk 10 liter?' });
  await webhook(pusat, dm('evt-2', 'Kalau 10 liter bisa diskon?')).expect(200);
  await until(() => whatsappSent.length === 1, 'notifikasi tim lewat WhatsApp');
  assert.equal(whatsappSent[0].session, 'wa');
  assert.equal(whatsappSent[0].jid, '628999999999@s.whatsapp.net');
  assert.match(whatsappSent[0].text, /Nadia \(DM Instagram @kopisenja\.id\)/);
  let tickets: any[] = [];
  await until(async () => {
    [tickets] = await db.execute<any[]>('SELECT * FROM ai_fallbacks WHERE account_id=?', [account]);
    return Boolean(tickets[0]?.notification_message_id);
  }, 'tiket mencatat notifikasi');
  assert.equal(tickets[0].session_id, 'ig-shop');
  assert.equal(tickets[0].notify_session_id, 'wa');
  const before = zernio.sent.length;
  whatsapp.get(account + '/wa')!({
    incoming: {
      messageId: 'team-1',
      from: '628999999999',
      sender: '628999999999',
      isGroup: false,
      groupId: null,
      type: 'text',
      text: 'Boleh, diskon 10%.',
      timestamp: 1,
      quotedMessageId: tickets[0].notification_message_id,
    },
  });
  await until(() => zernio.sent.length === before + 1, 'jawaban tim diteruskan ke DM');
  assert.equal(zernio.sent.at(-1)!.recipient, customer);
  assert.equal(zernio.sent.at(-1)!.body.message, 'Berikut konfirmasi dari tim: Boleh, diskon 10%.');
  await until(async () => {
    const [resolved] = await db.execute<any[]>('SELECT status FROM ai_fallbacks WHERE id=?', [tickets[0].id]);
    return resolved[0].status === 'resolved';
  }, 'tiket selesai');
});

test('Manual reply from the Instagram app pauses AI; disconnect and Zernio account removal clean up', async () => {
  await webhook(pusat, dm('manual-1', 'Saya bantu cek ya kak', 'message.sent', { sentVia: 'human' })).expect(200);
  await until(async () => {
    const [rows] = await db.execute<any[]>(
      'SELECT paused FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
      [account, 'ig-shop', customer],
    );
    return Boolean(rows[0]?.paused);
  }, 'AI dijeda oleh balasan manual');
  await webhook(pusat, {
    id: 'disc-1',
    event: 'account.disconnected',
    account: { accountId: 'igacc1', profileId: 'prof-pusat_', platform: 'instagram', username: 'kopisenja.id' },
  }).expect(200);
  const manager = await gateway.manager(account);
  await until(() => manager.detail('ig-shop').status === 'logged_out', 'sesi terputus');
  // Izin yang kedaluwarsa di Zernio butuh login Instagram lagi; sesi yang sama dipulihkan.
  zernio.instagram.get('sk_test_pusat_12345')![0].needsReconnection = true;
  const login = await api('post', '/api/instagram/connect')
    .send({ zernioId: pusat, sessionId: 'ig-shop', reconnect: true })
    .expect(200);
  assert.ok(login.body.authUrl);
  zernio.instagram.get('sk_test_pusat_12345')![0].needsReconnection = false;
  const state = new URL(zernio.redirects.at(-1)!).searchParams.get('state')!;
  await request(app).get('/zernio/callback').query({ state, accountId: 'igacc1' }).expect(200);
  assert.equal(manager.detail('ig-shop').status, 'connected');
  // Bila akunnya masih aktif di Zernio, hubungkan ulang langsung tanpa login.
  await webhook(pusat, {
    id: 'disc-2',
    event: 'account.disconnected',
    account: { accountId: 'igacc1', profileId: 'prof-pusat_', platform: 'instagram', username: 'kopisenja.id' },
  }).expect(200);
  await until(() => manager.detail('ig-shop').status === 'logged_out', 'sesi terputus lagi');
  const direct = await api('post', '/api/instagram/connect')
    .send({ zernioId: pusat, sessionId: 'ig-shop', reconnect: true })
    .expect(200);
  assert.equal(direct.body.connected, true);
  assert.equal(manager.detail('ig-shop').status, 'connected');
  const webhookId = zernio.webhooks.get('sk_test_pusat_12345')![0]._id;
  await api('delete', '/api/instagram/zernio/' + pusat).expect(200);
  assert.ok(zernio.deleted.includes(webhookId));
  assert.equal(
    manager.list().some(s => s.id === 'ig-shop'),
    false,
  );
  const [left] = await db.execute<any[]>('SELECT COUNT(*) AS n FROM instagram_channels WHERE account_id=?', [account]);
  assert.equal(Number(left[0].n), 0);
  const [assistants] = await db.execute<any[]>(
    'SELECT COUNT(*) AS n FROM ai_assistants WHERE account_id=? AND session_id=?',
    [account, 'ig-shop'],
  );
  assert.equal(Number(assistants[0].n), 0);
});
