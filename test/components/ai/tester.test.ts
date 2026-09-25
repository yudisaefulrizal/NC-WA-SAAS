// Tes profil Tester AI: mulai mati, satu node Pelanggan tanpa router dan context, pesan manual dari HP memulai uji
// tanpa menjeda AI, AI membalas setiap jawaban CS sebagai pelanggan, dan Jeda tetap menghentikannya.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../../../src/http/gateway.js';
import { type Update } from '../../../src/components/whatsapp/domain/sessions.js';
import { ApiError } from '../../../src/libraries/errors.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport, type AIMessage } from '../../../src/components/ai/domain/provider.js';
import {
  adminProfiles,
  setProfileEnabled,
  workflowState,
} from '../../../src/components/ai/domain/profiles/registry.js';
import { chatMessages } from '../../../src/components/ai/domain/chat.js';
import { AIStudio } from '../../../src/components/ai/domain/studio.js';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';

const root = await mkdtemp(join(tmpdir(), 'ncwa-tester-'));
const accounts: string[] = [];
// Setiap panggilan model dicatat: peran node dan pesan yang dikirim.
const calls: { role: string | undefined; messages: AIMessage[] }[] = [];
const transport: AITransport = async (config, messages) => {
  calls.push({ role: config.call_role, messages });
  return JSON.stringify({ answer: 'kak yg 20 cm brp ya?' });
};
const waits: number[] = [];
class FixtureAI extends AIService {
  override async config() {
    return { ...defaults, secret: 'fixture', memory_limit: 60 };
  }
}
const service = new FixtureAI(transport, async ms => {
  waits.push(ms);
});
const updates = new Map<string, (event: Update) => void>();
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
      async send() {
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
after(async () => {
  await setProfileEnabled(owner, 'tester', false);
  await gateway.stop();
  for (const id of accounts) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
  await rm(root, { recursive: true, force: true });
});
// Nomor CS yang diuji; bagi sesi tester, nomor ini adalah "pelanggan" di riwayat chat.
const cs = '628123456789';
const message = (messageId: string, text: string) => ({
  messageId,
  text,
  from: cs,
  sender: cs,
  isGroup: false,
  groupId: null,
  type: 'text' as const,
  timestamp: 1,
});
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise(r => setTimeout(r, 20));
  }
  return read();
}
const history = async (account: string) => (await chatMessages(account, 'tester', cs)).messages;
const conversation = async (account: string) => {
  const [rows] = await db.execute<any[]>(
    'SELECT messages,paused FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    [account, 'tester', cs],
  );
  const messages = typeof rows[0]?.messages === 'string' ? JSON.parse(rows[0].messages) : (rows[0]?.messages ?? []);
  return { messages: messages as AIMessage[], paused: Boolean(rows[0]?.paused) };
};

test('Tester AI starts switched off and runs one Pelanggan node without router or context', async () => {
  const listed = (await adminProfiles()).find(p => p.id === 'tester');
  assert.equal(listed?.enabled, false, 'profil baru mulai mati');
  assert.deepEqual(Object.keys((await workflowState('tester')).draft.nodes), ['pelanggan']);
  // Profil lain tetap memakai router dan context.
  const cs = Object.keys((await workflowState('cs')).draft.nodes);
  assert.equal(cs[0], 'router');
  assert.equal(cs.at(-1), 'context');
});

test('A manual message starts the test without pausing; the tester answers each CS reply until paused', async () => {
  await setProfileEnabled(owner, 'tester', true);
  const id = randomUUID(),
    key = randomUUID();
  accounts.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  await db.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)', [randomUUID(), id, digest(key)]);
  await basicWallet(id);
  await service.adjust(id, id, { amount: 100000, reason: 'fixture', requestId: 'fixture' });
  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string) =>
    request(app)[method](path).set('X-API-Key', key);
  await api('post', '/sessions').send({ id: 'tester' }).expect(200);
  const created = (
    await api('post', '/ai/data-profiles').send({ profile_type: 'tester', name: 'Ibu pesan kue' }).expect(201)
  ).body;
  const role = 'Ibu rumah tangga yang mau pesan kue ulang tahun, suka menawar.';
  await api('patch', '/ai/data-profiles/' + created.id + '/field')
    .send({ field: 'behavior', value: role })
    .expect(200);
  // Data CS Usaha tidak berlaku untuk Tester AI.
  await api('post', '/ai/data-profiles/' + created.id + '/products')
    .send({ name: 'Kue', type: 'product', description: '', price: 1, stock: 1, active: true })
    .expect(409);
  await api('put', '/sessions/tester/ai/profile').send({ data_profile_id: created.id, enabled: true }).expect(200);
  const update = updates.get(id + '/tester')!;

  // Pesan manual dari HP nomor tester memulai uji: masuk memori sebagai ucapan tester, AI tidak dijeda.
  update({ outgoing: message('PHONE1', 'Assalamualaikum') });
  let state = await eventually(
    () => conversation(id),
    c => c.messages.length === 1,
  );
  assert.deepEqual(state.messages, [{ role: 'assistant', content: 'Assalamualaikum' }]);
  assert.equal(state.paused, false);
  const notes = (await history(id)).filter(m => m.direction === 'note').map(m => m.text);
  assert.deepEqual(notes, ['Tester AI mulai menguji nomor ini']);
  assert.equal(calls.length, 0, 'pesan manual sendiri tidak memanggil model');

  // Balasan CS dijawab Tester AI sebagai pelanggan: satu panggilan node Pelanggan, tanpa router maupun context.
  update({ incoming: message('CS1', 'Waalaikumsalam, ada yang bisa kami bantu?') });
  await eventually(
    () => history(id),
    m => m.some(x => x.origin === 'ai'),
  );
  assert.deepEqual(
    calls.map(c => c.role),
    ['pelanggan'],
  );
  const sent = calls[0]!.messages;
  assert.ok(
    sent.some(m => m.role === 'system' && m.content.includes(role)),
    'peran pelanggan dikirim ke model',
  );
  assert.ok(
    sent.some(m => m.role === 'assistant' && m.content === 'Assalamualaikum'),
    'pesan manual ikut dibaca',
  );
  assert.ok(waits[0]! >= 3000 && waits[0]! <= 8000, 'tester menunggu seperti orang membaca: ' + waits[0]);
  state = await eventually(
    () => conversation(id),
    c => c.messages.length === 3,
  );
  assert.equal(state.messages.at(-1)!.content, 'kak yg 20 cm brp ya?');

  // Arahan manual di tengah obrolan juga tidak menjeda, dan tidak menambah catatan mulai.
  update({ outgoing: message('PHONE2', 'jadi pesan 2 ya kak') });
  state = await eventually(
    () => conversation(id),
    c => c.messages.length === 4,
  );
  assert.equal(state.paused, false);
  assert.equal((await history(id)).filter(m => m.direction === 'note').length, 1);

  // Jeda dari dashboard menghentikan tester; pesan manual berikutnya tidak menyalakannya lagi.
  await api('put', '/sessions/tester/ai/conversations/' + cs)
    .send({ paused: true })
    .expect(200);
  update({ outgoing: message('PHONE3', 'halo?') });
  await eventually(
    () => conversation(id),
    c => c.messages.length === 5,
  );
  update({ incoming: message('CS2', 'Baik kak, 2 kue ya') });
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await conversation(id)).paused, true);
  assert.equal(calls.length, 1, 'tidak ada balasan selama dijeda');
});

test('AI Studio simulates Tester AI with a sample role: the owner writes as CS, only Pelanggan answers', async () => {
  const studioCalls: (string | undefined)[] = [];
  const runner = new AIStudio(
    async config => {
      studioCalls.push(config.call_role);
      return JSON.stringify({ answer: 'kak ada kue coklat?' });
    },
    async () => ({ ...defaults, model_medium: 'medium', secret: 'private-test-secret' }),
    async () => {},
  );
  const events: any[] = [];
  await runner.run(
    owner,
    {
      message: 'Halo kak, ada yang bisa kami bantu?',
      behavior: 'Pelanggan yang mencari kue coklat.',
      profile_type: 'tester',
      revision: (await workflowState('tester')).revision,
    },
    event => events.push(structuredClone(event)),
  );
  assert.deepEqual(studioCalls, ['pelanggan']);
  assert.equal(events.at(-1).node, 'output');
  assert.equal(events.at(-1).output.answer, 'kak ada kue coklat?');
  assert.ok(!events.some(e => e.node === 'router'), 'tidak ada jejak router');
});
