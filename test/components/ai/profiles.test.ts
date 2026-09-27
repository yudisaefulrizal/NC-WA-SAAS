// Tes multi-profil: data profil dipakai bersama beberapa sesi, ganti/cabut, isolasi akun, sesi tanpa data profil,
// menggandakan, profil yang dimatikan pemilik, dan graf terbit yang dijalankan WhatsApp.
import { blankDefinition } from '../../../src/components/ai/domain/builder/definition.js';
import { createGraph, saveGraph } from '../../../src/components/ai/domain/builder/store.js';
import { uploadRecordFile } from '../../../src/components/ai/domain/builder/record-files.js';
import * as recordStore from '../../../src/components/ai/domain/builder/store.js';
import { storagePaths } from '../../../src/libraries/storage.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { createGateway } from '../../../src/http/gateway.js';
import { type Update } from '../../../src/components/whatsapp/domain/sessions.js';
import { ApiError } from '../../../src/libraries/errors.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import {
  adminProfiles,
  setProfileEnabled,
  clientProfiles,
} from '../../../src/components/ai/domain/profiles/registry.js';
import { chatMessages } from '../../../src/components/ai/domain/chat.js';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';
import { publishGraph, routedGraph } from './graph-fixture.js';

const root = await mkdtemp(join(tmpdir(), 'ncwa-profiles-'));
const accounts: string[] = [];
const graphs: string[] = [];
// AI menjawab setiap pesan: Router graf uji selalu memilih agent "info", yang langsung menjawab.
const transport: AITransport = async config => {
  if (config.call_role === 'router') return JSON.stringify({ branch: 'info', fallback_terkait: [] });
  if (config.call_role === 'context') return 'pelanggan-menunggu-jawaban';
  return JSON.stringify({ answer: 'Jawaban AI' });
};
class FixtureAI extends AIService {
  override async config() {
    return { ...defaults, secret: 'fixture', memory_limit: 60 };
  }
}
const service = new FixtureAI(transport, async () => {});
const updates = new Map<string, (event: Update) => void>();
// Isi setiap kiriman engine tiruan, berurutan, untuk memeriksa urutan media dan teks.
const outbox: { to: string; content: any }[] = [];
let sequence = 0;
const gateway = createGateway(
  account => async (session, update) => {
    updates.set(account + '/' + session, update);
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async typing() {},
      async read() {},
      async send(to: string, content: unknown) {
        outbox.push({ to, content });
        const id = 'OUT' + ++sequence;
        await service.registerSystemMessage(account, session, id);
        return id;
      },
    };
  },
  root,
  service,
);
const app = express();
app.use(express.json());
app.use(gateway.router);
app.use((e: Error, _q: express.Request, r: express.Response, _n: express.NextFunction) =>
  r
    .status(e instanceof ApiError ? e.status : 500)
    .json({ error: e instanceof ApiError ? e.code : 'internal_error', message: e.message }),
);
const owner = randomUUID();
accounts.push(owner);
await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
  owner,
  owner + '@test.invalid',
  'unused',
]);
// Profil yang dipakai tes data profil: graf berjalur yang diterbitkan dan dinyalakan pemilik.
let profile = '';
before(async () => {
  profile = await publishGraph(owner, routedGraph('Toko uji'));
  graphs.push(profile);
});
after(async () => {
  await gateway.stop();
  for (const id of accounts) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of graphs) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
  await rm(root, { recursive: true, force: true });
});
const customer = '628123456789';
async function tenant(sessions = ['shop']) {
  const id = randomUUID(),
    key = randomUUID();
  accounts.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)', [randomUUID(), id, digest(key)]);
  await basicWallet(id);
  await db.execute('UPDATE wallets SET session_limit=5 WHERE account_id=?', [id]);
  await service.adjust(id, id, { amount: 100000, reason: 'fixture', requestId: 'fixture' });
  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
    request(app)[method](path).set('X-API-Key', key);
  for (const session of sessions) await api('post', '/sessions').send({ id: session }).expect(200);
  const send = (session: string, messageId: string, text: string, from = customer) =>
    updates.get(id + '/' + session)!({
      incoming: { messageId, text, from, sender: from, isGroup: false, groupId: null, type: 'text', timestamp: 1 },
    });
  return { id, api, send };
}
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise(r => setTimeout(r, 20));
  }
  return read();
}
const answers = async (account: string, session: string) =>
  (await chatMessages(account, session, customer)).messages.filter(m => m.origin === 'ai').length;
const memory = async (account: string, session: string) => {
  const [rows] = await db.execute<any[]>(
    'SELECT messages,router_context FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    [account, session, customer],
  );
  const messages = rows[0]
    ? typeof rows[0].messages === 'string'
      ? JSON.parse(rows[0].messages)
      : rows[0].messages
    : [];
  return { count: messages.length, context: rows[0]?.router_context ?? null };
};

test('A data profile is created, shared by two sessions, and keeps AI memory per session', async () => {
  const t = await tenant(['shop', 'cabang']);
  const listed = (await t.api('get', '/ai/profile-types').expect(200)).body.find((p: any) => p.id === profile);
  assert.deepEqual([listed.name, listed.nodes, listed.enabled], ['Toko uji', 8, true]);
  await t.api('post', '/ai/data-profiles').send({ profile_type: 'cs', name: 'X' }).expect(404);
  await t.api('post', '/ai/data-profiles').send({ profile_type: 'g_tidakada', name: 'X' }).expect(404);
  await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: '' }).expect(400);
  const created = (
    await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Toko Kopi Senja' }).expect(201)
  ).body;
  assert.deepEqual(
    [created.name, created.profile_type, created.profile_name, created.sessions, created.behavior],
    ['Toko Kopi Senja', profile, 'Toko uji', [], ''],
  );
  await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'toko kopi senja' }).expect(409);
  const base = '/ai/data-profiles/' + created.id;
  await t
    .api('patch', base + '/field')
    .send({ field: 'behavior', value: 'Ramah dan singkat' })
    .expect(200);
  await t
    .api('patch', base + '/field')
    .send({ field: 'fallback_number', value: '628111222333' })
    .expect(200);
  // Bidang isi profil CS lama tidak diterima lagi.
  for (const field of ['usaha', 'faq', 'products_source', 'edu_lembaga'])
    await t
      .api('patch', base + '/field')
      .send({ field, value: 'x' })
      .expect(400);
  // Kedua sesi menjalankan data profil yang sama, masing-masing dengan AI menyala.
  for (const session of ['shop', 'cabang']) {
    const attached = (
      await t
        .api('put', '/sessions/' + session + '/ai/profile')
        .send({ data_profile_id: created.id, enabled: true })
        .expect(200)
    ).body;
    assert.deepEqual(
      [attached.enabled, attached.data_profile.name, attached.behavior, attached.fallback_number],
      [true, 'Toko Kopi Senja', 'Ramah dan singkat', '628111222333'],
    );
  }
  const sessions = (await t.api('get', '/sessions').expect(200)).body;
  assert.deepEqual(sessions.map((s: any) => [s.id, s.aiEnabled, s.aiProfile?.name]).sort(), [
    ['cabang', true, 'Toko Kopi Senja'],
    ['shop', true, 'Toko Kopi Senja'],
  ]);
  const summary = (await t.api('get', '/ai/data-profiles').expect(200)).body;
  assert.deepEqual(
    summary.map((p: any) => [p.name, p.sessions, p.records]),
    [['Toko Kopi Senja', ['cabang', 'shop'], 0]],
  );
  // Satu pelanggan menulis ke kedua nomor: setiap sesi menjawab dan menyimpan memorinya sendiri.
  t.send('shop', 'S1', 'Halo toko');
  t.send('cabang', 'C1', 'Halo cabang');
  await eventually(
    async () => [(await memory(t.id, 'shop')).count, (await memory(t.id, 'cabang')).count],
    v => v[0] === 2 && v[1] === 2,
  );
  assert.deepEqual([await answers(t.id, 'shop'), await answers(t.id, 'cabang')], [1, 1]);
  const [usage] = await db.execute<any[]>(
    'SELECT session_id,profile_type,data_profile_id,agent FROM ai_usage WHERE account_id=? ORDER BY session_id',
    [t.id],
  );
  assert.deepEqual(
    usage.map(u => [u.session_id, u.profile_type, u.data_profile_id, u.agent]),
    [
      ['cabang', profile, created.id, 'info'],
      ['shop', profile, created.id, 'info'],
    ],
  );
  // Data profil yang terpasang tidak bisa dihapus; menghapus sesi tetap menyimpan data profilnya.
  await t.api('delete', base).expect(409);
  await t.api('delete', '/sessions/cabang').expect(200);
  const after = (await t.api('get', base).expect(200)).body;
  assert.deepEqual(after.sessions, ['shop']);
});

test('Switching or detaching a data profile empties the session AI memory, leaves notes, and stops a detached session', async () => {
  const t = await tenant();
  const first = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Pertama' }).expect(201))
      .body,
    second = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Kedua' }).expect(201)).body;
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: first.id, enabled: true }).expect(200);
  // Jawaban disimpan ke memori AI tepat setelah dikirim, jadi yang ditunggu memorinya, bukan riwayat chat.
  t.send('shop', 'M1', 'Halo');
  await eventually(
    () => memory(t.id, 'shop'),
    m => m.count === 2,
  );
  assert.equal((await memory(t.id, 'shop')).context, 'pelanggan-menunggu-jawaban');
  // Mengirim pilihan yang sama lagi tidak mengubah apa pun.
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: first.id }).expect(200);
  assert.equal((await memory(t.id, 'shop')).count, 2);
  const switched = (await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: second.id }).expect(200))
    .body;
  assert.deepEqual([switched.enabled, switched.data_profile.name], [true, 'Kedua']);
  assert.deepEqual(await memory(t.id, 'shop'), { count: 0, context: null });
  t.send('shop', 'M2', 'Masih buka?');
  await eventually(
    () => memory(t.id, 'shop'),
    m => m.count === 2,
  );
  assert.equal(await answers(t.id, 'shop'), 2);
  const detached = (await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: null }).expect(200)).body;
  assert.deepEqual([detached.enabled, detached.data_profile, detached.behavior], [false, null, '']);
  t.send('shop', 'M3', 'Halo lagi');
  const history = await eventually(
    async () => (await chatMessages(t.id, 'shop', customer)).messages,
    m => m.some(x => x.id === 'M3'),
  );
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await answers(t.id, 'shop'), 2);
  assert.deepEqual(
    history.filter(m => m.direction === 'note').map(m => m.text),
    ['Profil diganti ke Kedua; memori AI dikosongkan', 'Profil AI dicabut; AI berhenti membalas'],
  );
  // Data profil yang sudah dicabut bisa dihapus.
  await t.api('delete', '/ai/data-profiles/' + first.id).expect(200);
  await t.api('delete', '/ai/data-profiles/' + first.id).expect(404);
});

test('Data profiles stay inside their account', async () => {
  const a = await tenant(),
    b = await tenant();
  const mine = (await a.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Milik A' }).expect(201))
      .body,
    base = '/ai/data-profiles/' + mine.id;
  for (const [method, path, body] of [
    ['get', base, undefined],
    ['patch', base, { name: 'Curian' }],
    ['patch', base + '/field', { field: 'behavior', value: 'x' }],
    ['delete', base, undefined],
  ] as const) {
    const call = b.api(method, path);
    await (body ? call.send(body) : call).expect(404);
  }
  await b.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: mine.id }).expect(404);
  await b.api('post', '/ai/data-profiles').send({ name: 'Salinan', copy_from: mine.id }).expect(404);
  assert.deepEqual((await b.api('get', '/ai/data-profiles').expect(200)).body, []);
  await a.api('get', '/ai/data-profiles/not-an-id').expect(404);
});

test('A session without a data profile cannot switch AI on or save fields, and nothing is created for it', async () => {
  const t = await tenant();
  assert.deepEqual((await t.api('get', '/sessions/shop/ai').expect(200)).body.data_profile, null);
  await t.api('patch', '/sessions/shop/ai/enabled').send({ enabled: true }).expect(409);
  await t.api('patch', '/sessions/shop/ai/field').send({ field: 'behavior', value: 'Ramah' }).expect(409);
  // Rute isi profil CS lama sudah tidak ada.
  for (const path of ['/sessions/shop/ai/products', '/sessions/shop/ai/orders', '/sessions/shop/ai/programs'])
    await t.api('get', path).expect(404);
  await t.api('put', '/sessions/shop/ai').send({ enabled: true }).expect(404);
  assert.deepEqual((await t.api('get', '/ai/data-profiles').expect(200)).body, []);
  // Setelah data profil dipasang, bidangnya bisa disimpan lewat sesi dan nama data profil tetap unik.
  const p = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Laundry' }).expect(201))
    .body;
  const other = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Cadangan' }).expect(201))
    .body;
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: p.id }).expect(200);
  const saved = (
    await t.api('patch', '/sessions/shop/ai/field').send({ field: 'behavior', value: 'Ramah' }).expect(200)
  ).body;
  assert.deepEqual([saved.enabled, saved.data_profile.name, saved.behavior], [false, 'Laundry', 'Ramah']);
  await t.api('patch', '/sessions/shop/ai/enabled').send({ enabled: true }).expect(200);
  await t
    .api('patch', '/ai/data-profiles/' + other.id)
    .send({ name: 'Laundry' })
    .expect(409);
});

test('Duplicating a data profile copies its behavior and fallback settings into a separate data profile', async () => {
  const t = await tenant();
  const original = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Asli' }).expect(201))
      .body,
    base = '/ai/data-profiles/' + original.id;
  await t
    .api('patch', base + '/field')
    .send({ field: 'behavior', value: 'Formal' })
    .expect(200);
  await t
    .api('patch', base + '/field')
    .send({ field: 'fallback_number', value: '628111222333' })
    .expect(200);
  const copy = (await t.api('post', '/ai/data-profiles').send({ name: 'Salinan', copy_from: original.id }).expect(201))
    .body;
  assert.deepEqual(
    [copy.behavior, copy.fallback_number, copy.profile_type, copy.sessions],
    ['Formal', '628111222333', profile, []],
  );
  await t.api('delete', base).expect(200);
  assert.equal((await t.api('get', '/ai/data-profiles/' + copy.id).expect(200)).body.behavior, 'Formal');
});

test('The owner switches a profile off for everyone: clients cannot pick it and attached sessions stop answering', async () => {
  const t = await tenant();
  const p = (await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Toko' }).expect(201)).body;
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: p.id, enabled: true }).expect(200);
  const listed = (await adminProfiles()).find(x => x.id === profile)!;
  assert.deepEqual([listed.enabled, listed.published, listed.nodes], [true, true, 8]);
  assert.ok(listed.sessions >= 1 && listed.data_profiles >= 1);
  try {
    await setProfileEnabled(owner, profile, false);
    // Tetap terdaftar untuk akun yang memakainya, tapi tidak bisa dipilih lagi; akun yang belum pernah memakainya tidak
    // melihatnya.
    assert.deepEqual(
      (await clientProfiles(t.id)).filter(x => x.id === profile).map(x => x.enabled),
      [false],
    );
    assert.deepEqual(
      (await clientProfiles(randomUUID())).filter(x => x.id === profile),
      [],
    );
    await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Baru' }).expect(409);
    await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: p.id }).expect(409);
    assert.equal((await t.api('get', '/sessions/shop/ai').expect(200)).body.profile_enabled, false);
    t.send('shop', 'OFF1', 'Halo');
    await eventually(
      async () => (await chatMessages(t.id, 'shop', customer)).messages.length,
      n => n === 1,
    );
    await new Promise(r => setTimeout(r, 200));
    assert.equal(await answers(t.id, 'shop'), 0);
  } finally {
    await setProfileEnabled(owner, profile, true);
  }
  t.send('shop', 'ON1', 'Halo lagi');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 1,
  );
  await assert.rejects(setProfileEnabled(owner, 'unknown', true), { code: 'profile_not_found' });
  await assert.rejects(setProfileEnabled(owner, 'cs', true), { code: 'profile_not_found' });
  const [audit] = await db.execute<any[]>(
    "SELECT action FROM audit_events WHERE account_id=? AND action LIKE 'ai_profile_%' ORDER BY id",
    [owner],
  );
  assert.deepEqual(
    audit.slice(-2).map(a => a.action),
    ['ai_profile_disabled:' + profile, 'ai_profile_enabled:' + profile],
  );
});

test('Uji Coba runs a data profile directly, even one not attached to any session', async () => {
  const t = await tenant();
  const p = (
    await t.api('post', '/ai/data-profiles').send({ profile_type: profile, name: 'Belum dipasang' }).expect(201)
  ).body;
  const result = await service.trial(t.id, { question: 'Apa saja produknya?', data_profile: p.id });
  assert.deepEqual([result.answer, result.agent], ['Jawaban AI', 'info']);
  const [usage] = await db.execute<any[]>(
    "SELECT session_id,profile_type,data_profile_id FROM ai_usage WHERE account_id=? AND customer='trial'",
    [t.id],
  );
  assert.deepEqual(
    usage.map(u => [u.session_id, u.profile_type, u.data_profile_id]),
    [['', profile, p.id]],
  );
  await assert.rejects(service.trial(t.id, { question: 'Halo', session: 'shop' }), { code: 'no_profile' });
  await assert.rejects(service.trial(t.id, { question: 'Halo', data_profile: randomUUID() }), {
    code: 'data_profile_not_found',
  });
});

test('A WhatsApp session executes the published dynamic graph, ignores draft edits and switches on publication', async () => {
  const t = await tenant();
  const d = blankDefinition('Graph WhatsApp');
  d.nodes = d.nodes.filter(n => n.type !== 'agent');
  d.nodes[1].value = 'Jawaban dari graf terbit';
  d.edges = [{ id: 'e1', source: 'input', port: 'next', target: 'output' }];
  const g = await createGraph(owner, d);
  graphs.push(g.id);
  await saveGraph(owner, g.id, { revision: 1 }, true);
  await setProfileEnabled(owner, g.id, true);
  const p = await service.createDataProfile(t.id, { profile_type: g.id, name: 'Graf sesi' });
  await service.attachProfile(t.id, 'shop', { data_profile_id: p.id, enabled: true });
  const draft = structuredClone(d);
  draft.nodes[1].value = 'Jawaban versi berikutnya';
  const saved = await saveGraph(owner, g.id, { revision: 1, definition: draft });
  t.send('shop', 'GRAPH1', 'Halo');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 1,
  );
  const first = (await chatMessages(t.id, 'shop', customer)).messages.filter(m => m.origin === 'ai');
  assert.equal(first.length, 1);
  assert.equal(first[0].text, 'Jawaban dari graf terbit');
  await saveGraph(owner, g.id, { revision: saved.revision }, true);
  t.send('shop', 'GRAPH2', 'Lanjut');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 2,
  );
  const second = (await chatMessages(t.id, 'shop', customer)).messages.filter(m => m.origin === 'ai');
  assert.equal(second.length, 2);
  assert.equal(second.at(-1)!.text, 'Jawaban versi berikutnya');
});

test('Kirim media sends a collection file before the text answer and skips it when the flow falls back', async () => {
  const t = await tenant();
  const d = blankDefinition('Graph media');
  d.collections = [
    {
      id: 'katalog',
      name: 'Katalog',
      owner: 'shared',
      fields: [
        { id: 'nama', label: 'Nama', type: 'text', required: true, options: [], collection: '' },
        { id: 'foto', label: 'Foto', type: 'file', required: false, options: [], collection: '' },
      ],
    },
  ];
  const base = d.nodes[2];
  d.nodes = [
    d.nodes[0],
    {
      ...base,
      id: 'cari',
      label: 'cari',
      type: 'data_table',
      collection: 'katalog',
      operation: 'search',
      query: '',
      value: '',
    },
    {
      ...base,
      id: 'kirim',
      type: 'media',
      value: '{{nodes.cari.first.data.foto}}',
      caption: '{{nodes.cari.first.data.nama}}',
    },
    { ...base, id: 'output', label: 'output', value: 'Ini fotonya' },
    { ...base, id: 'tim', label: 'tim', type: 'fallback', value: 'Tidak ada katalog' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'cari' },
    { id: 'e2', source: 'cari', port: 'found', target: 'kirim' },
    { id: 'e3', source: 'cari', port: 'empty', target: 'tim' },
    { id: 'e4', source: 'kirim', port: 'next', target: 'output' },
  ];
  const g = await createGraph(owner, d);
  graphs.push(g.id);
  await saveGraph(owner, g.id, { revision: 1 }, true);
  await setProfileEnabled(owner, g.id, true);
  const p = await service.createDataProfile(t.id, { profile_type: g.id, name: 'Graf media' });
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: p.id, enabled: true }).expect(200);
  await t
    .api('patch', '/ai/data-profiles/' + p.id + '/field')
    .send({ field: 'fallback_number', value: '628111222333' });
  // Tanpa katalog alur berakhir di Fallback: tidak ada media yang dikirim.
  const before = outbox.length;
  t.send('shop', 'MEDIA0', 'Ada foto?');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 1,
  );
  assert.equal(
    outbox.slice(before).some(o => o.content.type),
    false,
  );
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0a0' } })
    .png()
    .toBuffer();
  const file = await uploadRecordFile(t.id, p.id, 'kopi.png', png);
  await recordStore.writeRecord(t.id, p.id, 'katalog', 'create', { data: { nama: 'Kopi Susu', foto: file.id } });
  const start = outbox.length;
  t.send('shop', 'MEDIA1', 'Ada foto?');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 3,
  );
  const sentNow = outbox.slice(start).filter(o => o.to.startsWith(customer));
  assert.deepEqual(
    sentNow.map(o => o.content.type ?? 'text'),
    ['image', 'text'],
  );
  assert.equal(sentNow[0].content.caption, 'Kopi Susu');
  assert.equal(sentNow[1].content.text, 'Ini fotonya');
  const ai = (await chatMessages(t.id, 'shop', customer)).messages.filter(m => m.origin === 'ai');
  assert.ok(ai.some(m => m.type === 'image' && m.text === 'Kopi Susu'));
  await rm(join(storagePaths().recordFiles, t.id), { recursive: true, force: true });
});

test('Terima media stores a customer image into a record; profiles without the node ignore images', async () => {
  const t = await tenant(['shop', 'lain']);
  const d = blankDefinition('Graph terima');
  d.collections = [
    {
      id: 'bukti',
      name: 'Bukti',
      owner: 'customer',
      fields: [
        { id: 'foto', label: 'Foto', type: 'file', required: true, options: [], collection: '' },
        { id: 'catatan', label: 'Catatan', type: 'text', required: false, options: [], collection: '' },
      ],
    },
  ];
  const base = d.nodes[2];
  d.nodes = [
    d.nodes[0],
    { ...base, id: 'terima', label: 'terima', type: 'receive', accept: ['image'], value: '' },
    {
      ...base,
      id: 'simpan',
      type: 'data_table',
      collection: 'bukti',
      operation: 'create',
      value: '{"data":{"foto":"{{nodes.terima.file}}","catatan":"{{nodes.terima.caption}}"}}',
    },
    { ...base, id: 'ok', label: 'ok', value: 'Bukti diterima' },
    { ...base, id: 'minta', label: 'minta', value: 'Silakan kirim foto bukti' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'terima' },
    { id: 'e2', source: 'terima', port: 'received', target: 'simpan' },
    { id: 'e3', source: 'terima', port: 'none', target: 'minta' },
    { id: 'e4', source: 'simpan', port: 'next', target: 'ok' },
  ];
  const g = await createGraph(owner, d);
  graphs.push(g.id);
  await saveGraph(owner, g.id, { revision: 1 }, true);
  await setProfileEnabled(owner, g.id, true);
  const p = await service.createDataProfile(t.id, { profile_type: g.id, name: 'Graf terima' });
  await t.api('put', '/sessions/shop/ai/profile').send({ data_profile_id: p.id, enabled: true }).expect(200);
  // Sesi lain memakai profil tanpa node Terima media: gambar diabaikan.
  const plain = blankDefinition('Graph tanpa terima');
  plain.nodes = plain.nodes.filter(n => n.type !== 'agent');
  plain.nodes[1].value = 'Teks saja';
  plain.edges = [{ id: 'e1', source: 'input', port: 'next', target: 'output' }];
  const other = await createGraph(owner, plain);
  graphs.push(other.id);
  await saveGraph(owner, other.id, { revision: 1 }, true);
  await setProfileEnabled(owner, other.id, true);
  const q = await service.createDataProfile(t.id, { profile_type: other.id, name: 'Graf teks' });
  await t.api('put', '/sessions/lain/ai/profile').send({ data_profile_id: q.id, enabled: true }).expect(200);

  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00a' } })
    .png()
    .toBuffer();
  const image = (session: string, messageId: string) =>
    updates.get(t.id + '/' + session)!({
      incoming: {
        messageId,
        text: 'transfer BCA',
        from: customer,
        sender: customer,
        isGroup: false,
        groupId: null,
        type: 'image',
        mimetype: 'image/png',
        timestamp: 1,
        download: async () => Readable.from([png]),
      },
    });
  image('lain', 'IMG0');
  t.send('lain', 'TXT0', 'Halo');
  await eventually(
    () => answers(t.id, 'lain'),
    n => n === 1,
  );
  assert.equal(await answers(t.id, 'lain'), 1);

  t.send('shop', 'TXT1', 'Sudah transfer');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 1,
  );
  image('shop', 'IMG1');
  await eventually(
    () => answers(t.id, 'shop'),
    n => n === 2,
  );
  const texts = (await chatMessages(t.id, 'shop', customer)).messages.filter(m => m.origin === 'ai').map(m => m.text);
  assert.deepEqual(texts, ['Silakan kirim foto bukti', 'Bukti diterima']);
  const [saved] = (await recordStore.readRecords(t.id, p.id, 'bukti')).records;
  assert.equal(saved.customer, customer);
  assert.equal(saved.data.catatan, 'transfer BCA');
  const listed = await recordStore.readRecords(t.id, p.id, 'bukti');
  assert.equal(listed.files[String(saved.data.foto)].mimetype, 'image/png');
  const [mem] = (
    await db.execute<any[]>(
      'SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
      [t.id, 'shop', customer],
    )
  )[0];
  const history = typeof mem.messages === 'string' ? JSON.parse(mem.messages) : mem.messages;
  assert.ok(history.some((m: any) => m.role === 'user' && m.content === '[Gambar] transfer BCA'));
  await rm(join(storagePaths().recordFiles, t.id), { recursive: true, force: true });
});
