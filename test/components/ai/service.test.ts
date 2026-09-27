// Tes layanan Asisten AI: tagihan per kata, memori, tiket fallback, pengiriman ganda, konteks, dan pengulangan saat
// provider gagal. Sesi menjalankan graf uji (graph-fixture.ts) yang diterbitkan pemilik.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { aiFallback, countWords, creditCost } from '../../../src/components/ai/domain/metering.js';
import {
  defaults,
  chatEndpoint,
  type AITransport,
  type AIMessage,
} from '../../../src/components/ai/domain/provider.js';
import { SessionManager } from '../../../src/components/whatsapp/domain/sessions.js';
import { ApiError } from '../../../src/libraries/errors.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';
import { digest } from '../../../src/libraries/security.js';
import { graphSystem } from '../../../src/components/ai/domain/profiles/registry.js';
import { blankDefinition } from '../../../src/components/ai/domain/builder/definition.js';
import { writeRecord } from '../../../src/components/ai/domain/builder/store.js';
import { publishGraph, routedGraph, simpleGraph } from './graph-fixture.js';
const ids: string[] = [],
  managers: SessionManager[] = [],
  graphs: string[] = [];
const owner = randomUUID();
let simple = '',
  routed = '',
  withData = '';
before(async () => {
  await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
    owner,
    owner + '@test.invalid',
    'unused',
  ]);
  // Agent "info" pada graf data boleh memanggil Cari dan Simpan pada koleksi Catatan.
  const data = simpleGraph('Profil uji data');
  data.collections = [
    {
      id: 'catatan',
      name: 'Catatan',
      owner: 'shared',
      fields: [{ id: 'isi', label: 'Isi', type: 'text', required: true, options: [], collection: '' }],
    },
  ];
  const tool = { ...blankDefinition().nodes[1], type: 'data_table' as const, collection: 'catatan', x: 500 };
  data.nodes.push(
    { ...tool, id: 'cari', label: 'Cari', operation: 'search' },
    { ...tool, id: 'simpan', label: 'Simpan', operation: 'create' },
  );
  data.nodes.find(n => n.id === 'info')!.tools = ['cari', 'simpan'];
  for (const d of [simpleGraph(), routedGraph(), data]) graphs.push(await publishGraph(owner, d));
  [simple, routed, withData] = graphs;
});
after(async () => {
  for (const m of managers) await m.stop();
  for (const id of graphs) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  for (const id of [...ids, owner]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
});
class FixtureAI extends AIService {
  settings = { ...defaults, memory_limit: 3, secret: 'fixture' };
  override async config() {
    return { ...this.settings };
  }
}
async function fixture(
  call: AITransport = async () => 'Jawaban bisnis',
  sendFail = false,
  wait: (ms: number) => Promise<void> = async () => {},
  events: string[] = [],
  presenceFail = false,
  raw = false,
  graph: 'simple' | 'routed' | 'data' = 'simple',
) {
  const id = randomUUID();
  ids.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  await basicWallet(id);
  const service = new FixtureAI(
    raw
      ? call
      : async (c, m, max) => {
          if (c.call_role === 'router') return JSON.stringify({ branch: 'info', fallback_terkait: [] });
          if (c.call_role === 'context') return 'pelanggan-menunggu-informasi';
          return JSON.stringify({ answer: await call(c, m, max) });
        },
    wait,
  );
  await service.adjust(id, id, { amount: 10000, reason: 'fixture', requestId: 'fixture' });
  const profile = (
    await service.createDataProfile(id, {
      profile_type: { simple, routed, data: withData }[graph],
      name: 'Toko',
    })
  ).id;
  await service.saveDataProfileField(id, profile, 'behavior', 'Gunakan bahasa Indonesia');
  await service.attachProfile(id, 'shop', { data_profile_id: profile, enabled: true });
  let sent = 0;
  const manager = new SessionManager(async (_id, update) => {
    update({ status: 'connected' });
    return {
      close() {},
      async logout() {},
      async exists() {
        return !sendFail;
      },
      async read(jid, messageId) {
        events.push('read:' + jid + ':' + messageId);
        if (presenceFail) throw Error('read unavailable');
      },
      async typing(_jid, state) {
        events.push(state);
        if (presenceFail) throw Error('presence unavailable');
      },
      async send() {
        events.push('send');
        sent++;
        return 'reply-' + sent;
      },
    };
  });
  managers.push(manager);
  await manager.create('shop');
  const message = (messageId: string, text = 'Halo pelanggan', from = '628123456789') => ({
    messageId,
    text,
    from,
    sender: from,
    isGroup: false,
    groupId: null,
    type: 'text' as const,
    timestamp: 1,
  });
  return { id, service, manager, message, profile, sent: () => sent };
}
async function rows(id: string) {
  return await db
    .execute<any[]>('SELECT * FROM ai_usage WHERE account_id=? ORDER BY created_at,request_id', [id])
    .then(r => r[0]);
}
test('AI history pagination separates accounts and provides stable pages and bounds', async () => {
  const f = await fixture(),
    other = await fixture();
  for (let i = 0; i < 21; i++)
    await db.execute(
      "INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_rate,output_rate,model,created_at) VALUES (?,?,'shop','628123456789','sent',1,2,'fixture','2026-01-01 00:00:00')",
      [f.id, String(i).padStart(64, '0')],
    );
  const first = await f.service.usagePage(f.id, '1'),
    last = await f.service.usagePage(f.id, '2');
  assert.equal(first.total, 21);
  assert.equal(first.pages, 2);
  assert.equal((first.items as any[]).length, 20);
  assert.equal((last.items as any[]).length, 1);
  assert.equal(new Set([...(first.items as any[]), ...(last.items as any[])].map(r => r.request_id)).size, 21);
  assert.equal((await f.service.usagePage(f.id, '999')).page, 2);
  assert.equal((await other.service.usagePage(other.id, '1')).total, 0);
  for (const page of ['0', '-1', '1.5', 'x', ['1']]) await assert.rejects(f.service.usagePage(f.id, page));
});
test('Word billing is deterministic for whitespace, punctuation, URLs, emoji and unspaced language', () => {
  assert.equal(countWords(' \n\t '), 0);
  assert.equal(countWords('Halo,  dunia!\nhttps://example.com 🙂 中文'), 5);
  assert.equal(creditCost(countWords('kata '.repeat(500)), countWords('jawab '.repeat(100)), 1, 2), 700);
  assert.equal(chatEndpoint('https://ai.sumopod.com'), 'https://ai.sumopod.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://ai.sumopod.com/v1/'), 'https://ai.sumopod.com/v1/chat/completions');
  assert.throws(() => chatEndpoint('http://localhost'));
  assert.throws(() => chatEndpoint('https://key@example.com'));
});
test('Fallback ticket stays scoped to its session and forwards a team reply to the right customer', async () => {
  const f = await fixture(
    async () =>
      JSON.stringify({
        fallback: 'Diskon perlu persetujuan',
        question: 'Apakah diskon khusus dapat diberikan?',
      }),
    false,
    async () => {},
    [],
    false,
    true,
  );
  await f.service.saveField(f.id, 'shop', 'fallback_number', '628999999999');
  await f.service.saveField(f.id, 'shop', 'fallback_notify', true);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('fallback-one', 'Bisa diskon khusus?'));
  const [tickets] = await db.execute<any[]>('SELECT * FROM ai_fallbacks WHERE account_id=? AND session_id=?', [
    f.id,
    'shop',
  ]);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].customer, '628123456789');
  assert.equal(tickets[0].status, 'waiting');
  assert.ok(tickets[0].notification_message_id);
  assert.equal(f.sent(), 2);
  await f.service.incoming(f.id, f.manager, 'shop', {
    ...f.message('team-one', tickets[0].id, '628999999999'),
    quotedMessageId: tickets[0].notification_message_id,
  });
  const [resolved] = await db.execute<any[]>('SELECT status,staff_answer FROM ai_fallbacks WHERE id=?', [
    tickets[0].id,
  ]);
  assert.deepEqual(resolved[0], { status: 'resolved', staff_answer: tickets[0].id });
  assert.equal(f.sent(), 3);
});
test('Web-only fallback creates a ticket without team notification and can resolve it', async () => {
  const f = await fixture(
    async () => JSON.stringify({ fallback: 'Butuh keputusan', question: 'Setujui permintaan pelanggan?' }),
    false,
    async () => {},
    [],
    false,
    true,
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('fallback-web', 'Butuh persetujuan'));
  const tickets = ((await f.service.fallbacks(f.id, 'shop', '1')) as any).items;
  assert.equal(tickets.length, 1);
  assert.equal(f.sent(), 1);
  assert.deepEqual(
    await f.service.answerFallback(f.id, f.manager, 'shop', tickets[0].id, { answer: 'Permintaan disetujui.' }),
    { ok: true, status: 'resolved' },
  );
  assert.equal(f.sent(), 2);
});
test('Duplicate messages charge and send once; rates are snapshotted and latest input appears once', async () => {
  let seen: AIMessage[] = [];
  const f = await fixture(async (_config, messages) => {
    seen = messages;
    f.service.settings.input_rate = 19;
    f.service.settings.output_rate = 29;
    return 'Jawaban bisnis';
  });
  await Promise.all([
    f.service.incoming(f.id, f.manager, 'shop', f.message('one')),
    f.service.incoming(f.id, f.manager, 'shop', f.message('one')),
  ]);
  const usage = await rows(f.id);
  assert.equal(usage.length, 1);
  assert.equal(f.sent(), 1);
  assert.equal(usage[0].status, 'sent');
  assert.equal(usage[0].input_rate, 1);
  assert.equal(usage[0].output_rate, 2);
  // Yang ditagih adalah pesan sistem, perilaku, dan memori percakapan; prompt node tidak ikut dihitung.
  assert.equal(
    usage[0].input_words,
    [graphSystem, 'Gunakan bahasa Indonesia', 'Halo pelanggan'].reduce((n, text) => n + countWords(text), 0),
  );
  assert.equal(seen.filter(m => m.content === 'Halo pelanggan').length, 1);
  assert.equal(usage[0].charged, usage[0].input_words + 4);
  assert.equal((await f.service.wallet(f.id)).balance, 10000 - usage[0].charged);
  assert.equal((await basicWallet(f.id)).balance, 99);
});
test('Memory holds individual messages within the global limit and is isolated by tenant/session/customer', async () => {
  // Memori tersimpan dipangkas dengan batas di ai_settings, jadi tes mengaturnya di sana juga, bukan hanya di fixture.
  const [saved] = await db.query<any[]>('SELECT * FROM ai_settings WHERE id=1');
  try {
    await db.query(
      "INSERT INTO ai_settings(id,endpoint,model,secret,memory_limit) VALUES (1,'https://8.8.8.8/v1/chat/completions','fixture','',3) ON DUPLICATE KEY UPDATE memory_limit=3",
    );
    const calls: AIMessage[][] = [];
    const f = await fixture(async (_c, m) => {
      calls.push(m);
      return 'Balasan';
    });
    for (let i = 0; i < 3; i++) await f.service.incoming(f.id, f.manager, 'shop', f.message('m' + i, 'Pesan ' + i));
    assert.deepEqual(
      calls[2].filter(m => m.role !== 'system').map(m => m.content),
      ['Pesan 1', 'Balasan', 'Pesan 2'],
    );
    await f.service.incoming(f.id, f.manager, 'shop', f.message('new', 'Pelanggan lain', '628999999999'));
    assert.equal(calls[3].filter(m => m.role !== 'system').length, 1);
    await f.manager.create('other');
    await f.service.attachProfile(f.id, 'other', { data_profile_id: f.profile, enabled: true });
    await f.service.incoming(f.id, f.manager, 'other', f.message('same', 'Nomor lain'));
    assert.equal(calls[4].filter(m => m.role !== 'system').length, 1);
    const other = await fixture();
    assert.equal((await other.service.conversations(other.id, 'shop')).length, 0);
    assert.equal((await other.service.assistant(other.id, 'other')).enabled, false);
    const [memory] = await db.execute<any[]>(
      'SELECT JSON_LENGTH(messages) AS n FROM ai_conversations WHERE account_id=?',
      [f.id],
    );
    assert.equal(memory.length, 3);
    assert.ok(memory.every(m => m.n <= 3));
  } finally {
    await db.query('DELETE FROM ai_settings WHERE id=1');
    if (saved[0]) {
      const keys = Object.keys(saved[0]);
      await db.execute(
        'INSERT INTO ai_settings (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')',
        keys.map(k => saved[0][k]),
      );
    }
  }
});
test('WhatsApp failure still charges AI; provider failure and invalid output release the reservation', async () => {
  const f = await fixture(undefined, true);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('failure'));
  let usage = await rows(f.id);
  assert.equal(usage[0].status, 'send_failed');
  assert.ok(usage[0].charged > 0);
  assert.equal((await basicWallet(f.id)).balance, 100);
  for (const output of ['', 'kata '.repeat(301), null]) {
    const g = await fixture(async () => {
      if (output === null) throw Error('timeout');
      return output;
    });
    await g.service.incoming(g.id, g.manager, 'shop', g.message('error'));
    await g.service.incoming(g.id, g.manager, 'shop', g.message('error'));
    usage = await rows(g.id);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].status, 'fallback_sent');
    assert.equal(usage[0].charged, 0);
    assert.equal(usage[0].reserved, 0);
    assert.equal((await g.service.wallet(g.id)).balance, 10000);
    assert.equal(g.sent(), 1);
    assert.equal((await basicWallet(g.id)).balance, 99);
  }
});
test('Concurrent customers cannot overspend, groups/media and disabled/paused assistants never invoke AI', async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return 'OK';
  });
  await f.service.adjust(f.id, f.id, { amount: -9950, reason: 'small budget', requestId: 'small' });
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      f.service.incoming(f.id, f.manager, 'shop', f.message('m' + i, 'Halo', '62812345000' + i)),
    ),
  );
  // Sisa 50 kredit hanya cukup untuk sebagian pelanggan: setiap panggilan punya reservasi dan totalnya tidak melebihi saldo.
  const usage = await rows(f.id);
  assert.ok((await f.service.wallet(f.id)).balance >= 0);
  assert.equal(calls, usage.length);
  assert.ok(calls >= 1 && calls < 5);
  assert.ok(usage.reduce((n, r) => n + Number(r.charged), 0) <= 50);
  await f.service.setEnabled(f.id, 'shop', false);
  const before = calls;
  await f.service.incoming(f.id, f.manager, 'shop', f.message('off'));
  await f.service.incoming(f.id, f.manager, 'shop', { ...f.message('group'), isGroup: true });
  await f.service.incoming(f.id, f.manager, 'shop', { ...f.message('image'), type: 'image' });
  assert.equal(calls, before);
  await f.service.setEnabled(f.id, 'shop', true);
  await f.service.conversation(f.id, 'shop', '628123456789', { paused: true });
  await f.service.incoming(f.id, f.manager, 'shop', f.message('paused'));
  assert.equal(calls, before);
});
test('Changes during generation cancel dispatch and context clear is preserved; generated answer stays billed', async () => {
  const f = await fixture(async () => {
    await f.service.conversation(f.id, 'shop', '628123456789', { paused: true, clear: true });
    return 'Jawaban';
  });
  await f.service.incoming(f.id, f.manager, 'shop', f.message('clear'));
  assert.equal(f.sent(), 0);
  const usage = await rows(f.id);
  assert.equal(usage[0].status, 'cancelled');
  assert.ok(usage[0].charged > 0);
  const conversations = (await f.service.conversations(f.id, 'shop')) as any[];
  assert.equal(conversations[0].message_count, 0);
});
test('Restart recovery refunds interrupted AI once and never retries a generated WhatsApp send', async () => {
  const f = await fixture();
  await db.execute('UPDATE ai_wallets SET balance=balance-600 WHERE account_id=?', [f.id]);
  await db.execute(
    "INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_rate,output_rate,reserved,model) VALUES (?,?,'shop','628123456789','generating',1,2,600,'fixture')",
    [f.id, '0'.repeat(64)],
  );
  await f.service.recover(f.id);
  await f.service.recover(f.id);
  assert.equal((await f.service.wallet(f.id)).balance, 10000);
  assert.equal((await rows(f.id))[0].status, 'interrupted');
});
test('AI wallet adjustments are idempotent and HTTP owner configuration is private', async () => {
  const f = await fixture();
  await f.service.adjust(f.id, f.id, { amount: 10000, reason: 'fixture', requestId: 'fixture' });
  assert.equal((await f.service.wallet(f.id)).balance, 10000);
  await assert.rejects(f.service.adjust(f.id, f.id, { amount: 1, reason: 'fixture', requestId: 'fixture' }), {
    code: 'idempotency_conflict',
  });
  const { createApp } = await import('../../../src/http/app.js');
  const app = createApp(),
    token = randomUUID();
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    f.id,
  ]);
  const cookie = 'ncwa_session=' + token,
    origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
  await request(app).get('/api/admin/ai').set('Cookie', cookie).expect(403);
  await request(app).put('/api/admin/ai').set('Origin', origin).set('Cookie', cookie).send({}).expect(403);
  await request(app).get('/api/ai/wallet').expect(401);
  const w = await request(app).get('/api/ai/wallet').set('Cookie', cookie).expect(200);
  assert.equal(w.body.balance, 10000);
  assert.equal(w.body.secret, undefined);
});

test('Consecutive customer messages after provider errors trim oldest messages rather than pairs', async () => {
  const inputs: AIMessage[][] = [];
  const f = await fixture(async (_c, m) => {
    inputs.push(m);
    throw Error('provider unavailable');
  });
  for (let i = 1; i <= 4; i++)
    await f.service.incoming(f.id, f.manager, 'shop', f.message('failure-' + i, 'Pelanggan ' + i));
  assert.deepEqual(
    inputs[3].filter(m => m.role === 'user').map(m => m.content),
    ['Pelanggan 3', 'Pelanggan 4'],
  );
  assert.ok(inputs[3].some(m => m.content === aiFallback));
  assert.equal((await f.service.wallet(f.id)).balance, 10000);
});
test('Gateway assistant routes verify session ownership and account isolation', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'),
    { tmpdir } = await import('node:os'),
    { join } = await import('node:path');
  const { createGateway } = await import('../../../src/http/gateway.js');
  const { createApp } = await import('../../../src/http/app.js');
  const f = await fixture(),
    g = await fixture(),
    root = await mkdtemp(join(tmpdir(), 'ncwa-ai-test-'));
  const gateway = createGateway(
    () => async (_id, update) => {
      update({ status: 'connected' });
      return { close() {}, async logout() {} };
    },
    root,
    f.service,
  );
  const app = createApp(gateway);
  try {
    const tokens = [randomUUID(), randomUUID()];
    for (const [i, account] of [f.id, g.id].entries())
      await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
        digest(tokens[i]),
        account,
      ]);
    const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067';
    await request(app)
      .post('/sessions')
      .set('Cookie', 'ncwa_session=' + tokens[0])
      .set('Origin', origin)
      .send({ id: 'shop' })
      .expect(200);
    await request(app)
      .get('/sessions/shop/ai')
      .set('Cookie', 'ncwa_session=' + tokens[1])
      .expect(404);
    await request(app)
      .post('/sessions')
      .set('Cookie', 'ncwa_session=' + tokens[1])
      .set('Origin', origin)
      .send({ id: 'shop' })
      .expect(200);
    const mine = await request(app)
      .patch('/sessions/shop/ai/field')
      .set('Cookie', 'ncwa_session=' + tokens[0])
      .set('Origin', origin)
      .send({ field: 'behavior', value: 'Tenant A only', accountId: g.id })
      .expect(200);
    assert.equal(mine.body.behavior, 'Tenant A only');
    const other = await request(app)
      .get('/sessions/shop/ai')
      .set('Cookie', 'ncwa_session=' + tokens[1])
      .expect(200);
    assert.equal(other.body.behavior, 'Gunakan bahasa Indonesia');
    await request(app)
      .patch('/sessions/shop/ai/field')
      .set('Cookie', 'ncwa_session=' + tokens[0])
      .send({ field: 'behavior', value: '' })
      .expect(403);
  } finally {
    await gateway.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('Natural reply waits briefly, reads, composes through generation, then sends and pauses', async () => {
  const events: string[] = [];
  const f = await fixture(
    async () => {
      events.push('generate');
      return 'Jawaban';
    },
    false,
    async ms => {
      assert.ok(Number.isInteger(ms) && ms >= 200 && ms <= 1000);
      events.push('wait');
    },
    events,
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('natural'));
  assert.deepEqual(events, [
    'wait',
    'read:628123456789@s.whatsapp.net:natural',
    'composing',
    'generate',
    'send',
    'paused',
  ]);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('natural'));
  assert.equal(events.length, 6);
  assert.equal((await basicWallet(f.id)).balance, 99);
});
test('Typing ends after send failure or cancellation during the delay', async () => {
  const failed: string[] = [];
  const f = await fixture(undefined, true, async () => {}, failed);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('failed'));
  assert.equal(failed.at(-1), 'paused');
  assert.equal((await rows(f.id))[0].status, 'send_failed');
  const events: string[] = [];
  const g = await fixture(
    undefined,
    false,
    async () => {
      await g.service.conversation(g.id, 'shop', '628123456789', { paused: true });
    },
    events,
  );
  await g.service.incoming(g.id, g.manager, 'shop', g.message('cancel'));
  assert.deepEqual(events, ['read:628123456789@s.whatsapp.net:cancel', 'composing', 'paused']);
  assert.equal(g.sent(), 0);
  assert.equal((await rows(g.id))[0].status, 'cancelled');
  assert.equal((await basicWallet(g.id)).balance, 100);
});
test('Read/presence failures do not prevent a reply or change AI billing', async () => {
  const events: string[] = [];
  const f = await fixture(undefined, false, async () => {}, events, true);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('presence'));
  assert.equal(f.sent(), 1);
  assert.equal(events.at(-1), 'paused');
  assert.equal((await rows(f.id))[0].status, 'sent');
});

test('Manual reply pauses only its conversation, enters memory, and duplicate events cannot pause again after resume', async () => {
  const f = await fixture();
  await f.service.incoming(f.id, f.manager, 'shop', f.message('before'));
  const manual = f.message('manual', 'Saya bantu langsung');
  await f.service.manualOutgoing(f.id, 'shop', manual);
  const [memory] = await db.execute<any[]>(
    'SELECT paused,messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    [f.id, 'shop', manual.from],
  );
  assert.equal(memory[0].paused, 1);
  const messages = typeof memory[0].messages === 'string' ? JSON.parse(memory[0].messages) : memory[0].messages;
  assert.equal(messages.at(-1).content, 'Saya bantu langsung');
  assert.ok(messages.length <= 3);
  const count = f.sent();
  await f.service.incoming(f.id, f.manager, 'shop', f.message('after'));
  assert.equal(f.sent(), count);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('other', 'Halo', '628999999999'));
  assert.equal(f.sent(), count + 1);
  await f.service.conversation(f.id, 'shop', manual.from, { paused: false });
  await f.service.manualOutgoing(f.id, 'shop', manual);
  const conversations = (await f.service.conversations(f.id, 'shop')) as any[];
  assert.equal(conversations.find(c => c.customer === manual.from).paused, 0);
});
test('Persisted system IDs ignore early echoes and survive service restart; same ID in another account is independent', async () => {
  const f = await fixture();
  await f.service.registerSystemMessage(f.id, 'shop', 'system-id');
  const restarted = new FixtureAI(
    async () => 'OK',
    async () => {},
  );
  await restarted.manualOutgoing(f.id, 'shop', f.message('system-id'));
  assert.equal((await f.service.conversations(f.id, 'shop')).length, 0);
  const g = await fixture();
  await g.service.manualOutgoing(g.id, 'shop', g.message('system-id'));
  const rows = (await g.service.conversations(g.id, 'shop')) as any[];
  assert.equal(rows[0].paused, 1);
});
test('Manual reply during generation cancels AI dispatch but retains the valid generated-answer charge', async () => {
  const f = await fixture(async () => {
    await f.service.manualOutgoing(f.id, 'shop', f.message('manual-during', 'Admin mengambil alih'));
    return 'Jawaban AI';
  });
  await f.service.incoming(f.id, f.manager, 'shop', f.message('incoming'));
  assert.equal(f.sent(), 0);
  const usage = await rows(f.id);
  assert.equal(usage[0].status, 'cancelled');
  assert.ok(usage[0].charged > 0);
  assert.equal((await basicWallet(f.id)).balance, 100);
});
test('Manual media pauses conversation, but groups and disabled assistants are ignored', async () => {
  const f = await fixture();
  await f.service.manualOutgoing(f.id, 'shop', { ...f.message('group'), isGroup: true });
  assert.equal((await f.service.conversations(f.id, 'shop')).length, 0);
  await f.service.manualOutgoing(f.id, 'shop', { ...f.message('image', 'Foto produk'), type: 'image' });
  assert.equal(((await f.service.conversations(f.id, 'shop')) as any[])[0].paused, 1);
  await f.service.setEnabled(f.id, 'shop', false);
  await f.service.manualOutgoing(f.id, 'shop', f.message('disabled', 'Halo', '628999999999'));
  assert.equal((await f.service.conversations(f.id, 'shop')).length, 1);
});

test('Routed WhatsApp flow switches agents, persists shared memory across restart, and isolates identical customer IDs', async () => {
  const observed: { input: string; history: AIMessage[] }[] = [];
  const transport: AITransport = async (c, m) => {
    if (c.call_role === 'context') return 'pelanggan-menunggu-layanan';
    if (c.call_role === 'router') {
      const input = JSON.parse(m.at(-1)!.content).input.message as string;
      return JSON.stringify({ branch: input.startsWith('info') ? 'info' : 'layanan', fallback_terkait: [] });
    }
    const input = m.filter(x => x.role === 'user').at(-1)!.content;
    observed.push({ input, history: m.filter(x => x.role !== 'system') });
    return JSON.stringify({ answer: 'Balasan ' + c.call_role });
  };
  const f = await fixture(transport, false, async () => {}, [], false, true, 'routed');
  await Promise.all(
    ['info produk', 'saran produk', 'pesan produk'].map((input, i) =>
      f.service.incoming(f.id, f.manager, 'shop', f.message('switch-' + i, input)),
    ),
  );
  assert.deepEqual(
    observed.map(x => x.input),
    ['info produk', 'saran produk', 'pesan produk'],
  );
  assert.ok(observed[2].history.some(x => x.content === 'Balasan layanan'));
  const restarted = new FixtureAI(transport, async () => {});
  await restarted.incoming(f.id, f.manager, 'shop', f.message('restart', 'status pesanan'));
  assert.ok(observed[3].history.some(x => x.content === 'Balasan layanan'));
  assert.deepEqual((await rows(f.id)).map(x => x.agent).sort(), ['info', 'layanan', 'layanan', 'layanan']);
  const g = await fixture(transport, false, async () => {}, [], false, true, 'routed');
  await g.service.incoming(g.id, g.manager, 'shop', g.message('switch-0', 'info tenant B'));
  assert.deepEqual(observed.at(-1)!.history, [{ role: 'user', content: 'info tenant B' }]);
  const [stored] = await db.execute<any[]>('SELECT messages FROM ai_conversations WHERE account_id=?', [f.id]);
  const json = JSON.stringify(stored);
  assert.ok(!json.includes('fallback_terkait'));
  assert.ok(!json.includes('pelanggan-menunggu-layanan'));
  assert.ok(!json.includes('tenant B'));
});

test('Data nodes run with the authenticated tenant scope and never write after manual takeover', async () => {
  const prompts: string[] = [];
  // Giliran pertama agent memanggil Cari; setelah ada hasil tool, agent menjawab.
  const transport: AITransport = async (_c, m) => {
    prompts.push(m[0].content);
    return m[0].content.includes('Hasil tool: []')
      ? JSON.stringify({ tool: 'cari', query: '' })
      : JSON.stringify({ answer: 'Informasi tersedia' });
  };
  const f = await fixture(transport, false, async () => {}, [], false, true, 'data'),
    g = await fixture(transport, false, async () => {}, [], false, true, 'data');
  await writeRecord(f.id, f.profile, 'catatan', 'create', { data: { isi: 'Rahasia toko A' } });
  await writeRecord(g.id, g.profile, 'catatan', 'create', { data: { isi: 'Rahasia toko B' } });
  await f.service.incoming(f.id, f.manager, 'shop', f.message('tool'));
  const seen = prompts.at(-1)!;
  assert.ok(seen.includes('Rahasia toko A'));
  assert.ok(!seen.includes('Rahasia toko B'));
  assert.equal(f.sent(), 1);
  // Admin mengambil alih saat agent memutuskan menyimpan: node Simpan tidak pernah dijalankan.
  const paused = await fixture(
    async () => {
      await paused.service.manualOutgoing(paused.id, 'shop', paused.message('manual-takeover', 'Admin membantu'));
      return JSON.stringify({ tool: 'simpan', query: { data: { isi: 'Tidak boleh tersimpan' } } });
    },
    false,
    async () => {},
    [],
    false,
    true,
    'data',
  );
  await paused.service.incoming(paused.id, paused.manager, 'shop', paused.message('paused-tool'));
  const [records] = await db.execute<any[]>('SELECT COUNT(*) AS n FROM ai_data_records WHERE account_id=?', [
    paused.id,
  ]);
  assert.equal(Number(records[0].n), 0);
  assert.equal(paused.sent(), 0);
  assert.equal((await rows(paused.id))[0].status, 'cancelled');
  assert.equal((await paused.service.wallet(paused.id)).balance, 10000);
});

test('Malformed router output refunds reservation and sends one safe fallback without leaking JSON', async () => {
  const f = await fixture(
    async () => '{"sub_agent":"invalid"}',
    false,
    async () => {},
    [],
    false,
    true,
    'routed',
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('invalid-route'));
  assert.equal(f.sent(), 1);
  assert.equal((await f.service.wallet(f.id)).balance, 10000);
  assert.equal((await rows(f.id))[0].status, 'fallback_sent');
});

test('Router context persists, feeds next turn, stays isolated and clears with memory', async () => {
  const seen: AIMessage[][] = [];
  const transport: AITransport = async (c, m) => {
    if (c.call_role === 'router') {
      seen.push(m);
      return JSON.stringify({ branch: 'layanan', fallback_terkait: [] });
    }
    if (c.call_role === 'context') return 'pelanggan-mengonfirmasi-pesanan';
    return JSON.stringify({ answer: 'Ingin memesan produk ini?' });
  };
  // Router membaca pesan terbaru dan konteks Shared Memory dari data eksekusi.
  const input = (m: AIMessage[]) => JSON.parse(m.at(-1)!.content).input;
  const f = await fixture(transport, false, async () => {}, [], false, true, 'routed');
  await f.service.incoming(f.id, f.manager, 'shop', f.message('first'));
  const restarted = new FixtureAI(transport, async () => {});
  await restarted.incoming(f.id, f.manager, 'shop', f.message('next', 'ya'));
  assert.equal(input(seen[0]).context, null);
  assert.equal(input(seen[1]).context, 'pelanggan-mengonfirmasi-pesanan');
  assert.equal(input(seen[1]).message, 'ya');
  await restarted.incoming(f.id, f.manager, 'shop', f.message('other', 'ya', '628999999999'));
  assert.equal(input(seen[2]).context, null);
  const [stored] = await db.execute<any[]>(
    'SELECT messages,router_context FROM ai_conversations WHERE account_id=? AND customer=?',
    [f.id, '628123456789'],
  );
  assert.equal(stored[0].router_context, 'pelanggan-mengonfirmasi-pesanan');
  assert.ok(!JSON.stringify(stored[0].messages).includes('pelanggan-mengonfirmasi-pesanan'));
  await restarted.conversation(f.id, 'shop', '628123456789', { paused: false, clear: true });
  const cleared = ((await restarted.conversations(f.id, 'shop')) as any[]).find(r => r.customer === '628123456789');
  assert.equal(cleared.router_context, null);
  assert.equal(cleared.message_count, 0);
});

test('Failed delivery, failed context updates and manual takeover cannot leave misleading context', async () => {
  const failed = await fixture(undefined, true);
  await failed.service.incoming(failed.id, failed.manager, 'shop', failed.message('failed'));
  assert.equal(((await failed.service.conversations(failed.id, 'shop')) as any[])[0].router_context, null);
  let failContext = false;
  const f = await fixture(
    async c => {
      if (c.call_role === 'router') return JSON.stringify({ branch: 'info', fallback_terkait: [] });
      if (c.call_role === 'context') {
        if (failContext) throw Error('timeout');
        return 'pelanggan-menunggu-informasi';
      }
      return JSON.stringify({ answer: 'Jawaban pelanggan' });
    },
    false,
    async () => {},
    [],
    false,
    true,
    'routed',
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('first'));
  assert.equal(
    ((await f.service.conversations(f.id, 'shop')) as any[])[0].router_context,
    'pelanggan-menunggu-informasi',
  );
  // Ringkasan yang gagal menggagalkan jawaban graf: pelanggan menerima jawaban aman dan konteks lama dikosongkan.
  failContext = true;
  await f.service.incoming(f.id, f.manager, 'shop', f.message('second'));
  assert.equal(f.sent(), 2);
  assert.equal((await rows(f.id)).find(r => r.status !== 'sent')?.status, 'fallback_sent');
  assert.equal(((await f.service.conversations(f.id, 'shop')) as any[])[0].router_context, null);
  failContext = false;
  await f.service.incoming(f.id, f.manager, 'shop', f.message('third'));
  await f.service.manualOutgoing(f.id, 'shop', f.message('manual', 'Admin mengambil alih'));
  const row = ((await f.service.conversations(f.id, 'shop')) as any[])[0];
  assert.equal(row.router_context, null);
  assert.equal(Boolean(row.paused), true);
});

test('Transient provider failures retry with backoff, retain billing and record each attempt', async () => {
  let calls = 0;
  const delays: number[] = [];
  const f = await fixture(
    async () => {
      if (++calls < 3) throw Error('ai_provider_http_503');
      return 'Jawaban';
    },
    false,
    async ms => {
      delays.push(ms);
    },
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('retry'));
  // delays[0] adalah jeda singkat sebelum status dibaca; jeda pengulangan menyusul.
  assert.equal(calls, 3);
  assert.equal(f.sent(), 1);
  assert.ok(delays[0] >= 200 && delays[0] <= 1000);
  assert.ok(delays[1] >= 500 && delays[1] <= 750);
  assert.ok(delays[2] >= 1000 && delays[2] <= 1250);
  const usage = (await rows(f.id))[0],
    trace = typeof usage.model_calls === 'string' ? JSON.parse(usage.model_calls) : usage.model_calls;
  assert.deepEqual(
    trace.filter((c: any) => c.role === 'info').map((c: any) => [c.status, c.attempt]),
    [
      ['failed', 1],
      ['failed', 2],
      ['responded', 3],
    ],
  );
  assert.equal(usage.charged, usage.input_words + 2);
  assert.equal(usage.status, 'sent');
});

test('Permanent provider errors do not retry; exhausted retries send a single fallback', async () => {
  for (const code of ['ai_provider_http_401', 'ai_provider_http_403', 'ai_provider_http_404', 'ai_provider_http_429']) {
    let calls = 0;
    const f = await fixture(async () => {
      calls++;
      throw Error(code);
    });
    await f.service.incoming(f.id, f.manager, 'shop', f.message('failed'));
    await f.service.incoming(f.id, f.manager, 'shop', f.message('failed'));
    assert.equal(calls, code.endsWith('429') ? 3 : 1);
    assert.equal(f.sent(), 1);
    assert.equal((await f.service.wallet(f.id)).balance, 10000);
  }
});

test('Pause during retry cancels further calls and suppresses fallback', async () => {
  // Tunggu pertama adalah jeda sebelum status dibaca; yang kedua jeda pengulangan.
  let calls = 0,
    waits = 0;
  const f = await fixture(
    async () => {
      calls++;
      throw Error('ai_provider_http_503');
    },
    false,
    async () => {
      if (++waits === 2) await f.service.conversation(f.id, 'shop', '628123456789', { paused: true });
    },
  );
  await f.service.incoming(f.id, f.manager, 'shop', f.message('cancel-retry'));
  assert.equal(calls, 1);
  assert.equal(f.sent(), 0);
  assert.equal((await rows(f.id))[0].status, 'cancelled');
  assert.equal((await f.service.wallet(f.id)).balance, 10000);
});

test('Full auto persists per conversation, survives manual replies, and explicit pause disables it', async () => {
  const f = await fixture(),
    customer = '628123456789';
  await f.service.conversation(f.id, 'shop', customer, { paused: false, full_auto: true });
  const restarted = new FixtureAI();
  await restarted.manualOutgoing(f.id, 'shop', f.message('manual-auto', 'Admin membantu'));
  let row = ((await f.service.conversations(f.id, 'shop')) as any[])[0];
  assert.equal(row.paused, 0);
  assert.equal(row.full_auto, 1);
  await f.service.incoming(f.id, f.manager, 'shop', f.message('after-manual'));
  assert.equal(f.sent(), 1);
  await f.service.manualOutgoing(f.id, 'shop', f.message('other-manual', 'Admin membantu', '628999999999'));
  row = ((await f.service.conversations(f.id, 'shop')) as any[]).find(r => r.customer === '628999999999');
  assert.equal(row.paused, 1);
  assert.equal(row.full_auto, 0);
  await f.service.conversation(f.id, 'shop', customer, { paused: false, clear: true });
  row = ((await f.service.conversations(f.id, 'shop')) as any[]).find(r => r.customer === customer);
  assert.equal(row.full_auto, 1);
  assert.equal(row.message_count, 0);
  await f.service.conversation(f.id, 'shop', customer, { paused: true });
  await f.service.manualOutgoing(f.id, 'shop', f.message('manual-paused'));
  row = ((await f.service.conversations(f.id, 'shop')) as any[]).find(r => r.customer === customer);
  assert.equal(row.paused, 1);
  assert.equal(row.full_auto, 0);
  await assert.rejects(f.service.conversation(f.id, 'shop', customer, { paused: false, full_auto: 'yes' }));
  await assert.rejects(f.service.conversation(f.id, 'shop', customer, { paused: true, full_auto: true }));
  await f.service.conversation(f.id, 'shop', customer, { paused: false, full_auto: true });
  await f.service.conversation(f.id, 'shop', customer, { paused: false, full_auto: false });
  await f.service.manualOutgoing(f.id, 'shop', f.message('manual-normal'));
  row = ((await f.service.conversations(f.id, 'shop')) as any[]).find(r => r.customer === customer);
  assert.equal(row.paused, 1);
});

test('Owner model configuration persists, legacy fallback works, tests select each tier, and client usage hides models', async () => {
  const f = await fixture();
  const [saved] = await db.query<any[]>('SELECT * FROM ai_settings WHERE id=1');
  const calls: string[] = [];
  const service = new AIService(async c => {
    calls.push(c.model);
    return 'OK';
  });
  try {
    await service.configure(f.id, {
      ...defaults,
      endpoint: 'https://8.8.8.8/v1/chat/completions',
      apiKey: 'fixture-only',
      model_cheap: 'cheap-fixture',
      model_medium: 'medium-fixture',
      model_smart: 'smart-fixture',
      model_decision: 'decision-fixture',
    });
    const config = await new AIService().configuration();
    assert.equal(config.model_cheap, 'cheap-fixture');
    assert.equal(config.model_medium, 'medium-fixture');
    assert.equal(config.model_smart, 'smart-fixture');
    assert.equal(config.model_decision, 'decision-fixture');
    assert.ok(!JSON.stringify(config).includes('fixture-only'));
    for (const tier of ['cheap', 'medium', 'smart', 'decision']) await service.test(tier);
    assert.deepEqual(calls, ['cheap-fixture', 'medium-fixture', 'smart-fixture', 'decision-fixture']);
    await assert.rejects(service.test('invalid'));
    await assert.rejects(
      service.configure(f.id, { ...defaults, model_medium: '', model_cheap: 'x', model_smart: 'z' }),
    );
    await service.configure(f.id, {
      ...defaults,
      endpoint: 'https://8.8.8.8/v1/chat/completions',
      model: 'legacy-updated',
    });
    assert.equal((await service.config()).model_medium, 'legacy-updated');
    assert.equal((await service.config()).model_cheap, 'cheap-fixture');
    await db.query('UPDATE ai_settings SET model_cheap=NULL,model_medium=NULL,model_smart=NULL WHERE id=1');
    const legacy = await service.config();
    assert.equal(legacy.model_cheap, legacy.model);
    assert.equal(legacy.model_smart, legacy.model);
  } finally {
    await db.query('DELETE FROM ai_settings WHERE id=1');
    if (saved[0]) {
      const keys = Object.keys(saved[0]);
      await db.execute(
        'INSERT INTO ai_settings (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')',
        keys.map(k => saved[0][k]),
      );
    }
  }
  const tiered = await fixture(undefined, false, async () => {}, [], false, false, 'routed');
  Object.assign(tiered.service.settings, {
    model_cheap: 'cheap-fixture',
    model_medium: 'medium-fixture',
    model_smart: 'smart-fixture',
  });
  await tiered.service.incoming(tiered.id, tiered.manager, 'shop', tiered.message('tiered'));
  const usage = (await rows(tiered.id))[0];
  const trace = typeof usage.model_calls === 'string' ? JSON.parse(usage.model_calls) : usage.model_calls;
  assert.deepEqual(
    trace.map((c: any) => [c.role, c.model]),
    [
      ['router', 'cheap-fixture'],
      ['info', 'medium-fixture'],
      ['context', 'cheap-fixture'],
    ],
  );
  assert.equal(usage.model, 'medium-fixture');
  const client = (await tiered.service.usage(tiered.id)) as any[];
  assert.equal(client[0].model, undefined);
  assert.equal(client[0].model_calls, undefined);
  const { createApp } = await import('../../../src/http/app.js');
  const token = randomUUID();
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    tiered.id,
  ]);
  await request(createApp())
    .get('/api/admin/ai/usage')
    .set('Cookie', 'ncwa_session=' + token)
    .expect(403);
  await db.execute("UPDATE accounts SET role='owner' WHERE id=?", [tiered.id]);
  const admin = await request(createApp())
    .get('/api/admin/ai/usage')
    .set('Cookie', 'ncwa_session=' + token)
    .expect(200);
  assert.ok(admin.body.some((r: any) => r.request_id === usage.request_id && r.model_calls));
});
