// Kesetaraan alur CS: publikasi, routing, tool bisnis, isolasi pelanggan, dan fallback.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { csTemplate as csParityProfile } from '../../../src/components/ai/domain/builder/cs-template.js';
import { businessSamples } from '../../../scripts/checks/fixtures/cs-business-profile.js';
import {
  assertRunnable,
  parseDefinition,
  validateGraph,
} from '../../../src/components/ai/domain/builder/definition.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import { agents, permissions } from '../../../src/components/ai/domain/profiles/cs/pipeline.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
const scope = {
  account: 'audit',
  profile: 'audit',
  session: 'audit',
  customer: 'pelanggan-uji-a',
  requestId: randomUUID(),
  knowledge: '',
  fallbackEnabled: true,
};
after(() => db.end());
test('Faithful CS scaffold preserves all five specialists and permissions, and can be published with business tools', async () => {
  const d = csParityProfile();
  assert.deepEqual(parseDefinition(d), d);
  for (const [id, prompt] of Object.entries(agents)) {
    const n = d.nodes.find(n => n.id === id)!;
    assert.equal(n.prompt, prompt);
    assert.deepEqual(n.tools, permissions[id as keyof typeof permissions]);
  }
  const issues = validateGraph(d);
  assert.deepEqual(issues, []);
  assertRunnable(d);
  const actor = randomUUID();
  let id = '';
  try {
    await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
      actor,
      actor + '@test.invalid',
      'unused',
    ]);
    const g = await store.createGraph(actor, d);
    id = g.id;
    await store.saveGraph(actor, id, { revision: g.revision }, true);
    assert.ok((await store.graphState(id)).active);
    assert.equal((await store.graphState(id)).draft.nodes.filter(n => n.type === 'agent').length, 5);
  } finally {
    if (id) {
      await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
      await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
    }
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [actor]);
    await db.execute('DELETE FROM accounts WHERE id=?', [actor]);
  }
});
for (const branch of Object.keys(agents))
  test('CS branch ' + branch + ' executes only its specialist and context', async () => {
    const d = csParityProfile(),
      called: string[] = [],
      events: any[] = [];
    assertRunnable(d);
    const transport: AITransport = async (c, m) => {
      const id = c.trace_node ?? c.call_role!;
      called.push(id);
      if (id === 'router') {
        assert.deepEqual(Object.keys(c.decision_request!.questions.branch.criteria), Object.keys(agents));
        assert.equal(JSON.stringify(c.decision_request).includes('pesan-lama-rahasia'), false);
        return JSON.stringify({ branch: { choice: branch } });
      }
      if (id === 'context') return 'pelanggan-menunggu-jawaban';
      assert.ok(m.some(m => m.content === 'pesan-lama-rahasia'));
      return '{"answer":"Jawaban uji"}';
    };
    const config = { ...defaults, model_decision: 'typesafe/jev-1.13', onTrace: (e: any) => events.push(e) };
    const out = await runGraph(
      d,
      transport,
      config,
      [
        { role: 'user', content: 'pesan-lama-rahasia' },
        { role: 'assistant', content: 'Sebelumnya' },
        { role: 'user', content: 'Pesan terbaru' },
      ],
      scope,
      'pelanggan-menunggu-informasi',
    );
    assert.deepEqual(called, ['router', branch, 'context']);
    assert.equal(out.agent, branch);
    assert.equal(out.answer, 'Jawaban uji');
    assert.equal(config.graph_context, 'pelanggan-menunggu-jawaban');
    assert.ok(events.some(e => e.node === 'output' && e.state === 'done'));
  });
test('Business reads use native shapes and isolate customer orders in sandbox', async () => {
  for (const [tool, query, marker] of [
    ['get_knowledge', '', 'Toko Uji Nusantara'],
    ['get_products', 'Basic', '150000'],
    ['check_order', 'ORDER-UJI-B', '"order":null'],
  ]) {
    let turn = 0;
    const events: any[] = [];
    await simulate(
      'audit',
      { definition: csParityProfile(), message: 'Informasi uji', business: businessSamples },
      e => events.push(e),
      new AbortController().signal,
      async (c, m) => {
        if (c.call_role === 'router') return '{"branch":"layanan"}';
        if (c.call_role === 'context') return 'pelanggan-mendapat-informasi';
        if (turn++ === 0) return JSON.stringify({ tool, query });
        assert.ok(m.some(m => m.content.includes(marker)));
        return '{"answer":"Data uji tersedia"}';
      },
    );
    const output = events.find(e => e.node === tool && e.state === 'done').output;
    if (tool === 'check_order') assert.deepEqual(output, { order: null });
    assert.equal(events.at(-1).state, 'completed');
  }
});
for (const scenario of ['order', 'image', 'stock', 'price', 'repeat', 'extract'])
  test('Business sandbox: ' + scenario, async () => {
    let turn = 0;
    const events: any[] = [];
    const query =
      scenario === 'stock'
        ? '11 x Produk Basic'
        : scenario === 'price'
          ? { items: [{ product_name: 'Produk Basic', quantity: 1, price: 1 }] }
          : scenario === 'image'
            ? 'Produk Basic'
            : scenario === 'extract'
              ? 'Saya pesan dua buah produk basic'
              : '2 x Produk Basic';
    await simulate(
      'audit',
      { definition: csParityProfile(), message: 'Permintaan uji', business: businessSamples },
      e => events.push(e),
      new AbortController().signal,
      async c => {
        if (c.call_role === 'router') return '{"branch":"layanan"}';
        if (c.call_role === 'context') return 'pelanggan-mendapat-konfirmasi';
        if (c.call_role === 'pesanan')
          return JSON.stringify({ lengkap: true, items: [{ product_name: 'Produk Basic', quantity: 2 }], notes: '' });
        if (turn++ < (scenario === 'repeat' ? 2 : 1))
          return JSON.stringify({ tool: scenario === 'image' ? 'send_product_image' : 'create_order', query });
        return '{"answer":"Hasil uji diproses"}';
      },
    );
    const completed = events.at(-1).output;
    if (scenario === 'image') assert.equal(completed.images.length, 1);
    else if (['stock', 'price'].includes(scenario)) {
      assert.equal(completed.business.orders.length, 1);
      assert.ok(events.some(e => e.output?.error));
    } else {
      assert.equal(completed.business.orders.length, 2);
      assert.equal(completed.business.orders[1].total, 300000);
      assert.equal(completed.business.orders[1].customer, '628000000001');
    }
  });
test('Agent fallback follows its connected port and respects the runtime setting', async () => {
  const transport: AITransport = async c =>
    c.call_role === 'router'
      ? '{"branch":"layanan"}'
      : '{"fallback":"Butuh tim","question":"Apakah ada diskon khusus?"}';
  const out = await runGraph(
    csParityProfile(),
    transport,
    { ...defaults },
    [{ role: 'user', content: 'Diskon khusus' }],
    scope,
    null,
  );
  assert.deepEqual(out.fallback, { reason: 'Butuh tim', question: 'Apakah ada diskon khusus?' });
  await assert.rejects(
    runGraph(
      csParityProfile(),
      transport,
      { ...defaults },
      [{ role: 'user', content: 'Diskon khusus' }],
      { ...scope, fallbackEnabled: false },
      null,
    ),
    /ai_invalid_structure/,
  );
});
test('JEV router selects pending tickets and supplies related ticket to agent', async () => {
  let checked = false;
  await runGraph(
    csParityProfile(),
    async (c, m) => {
      if (c.call_role === 'router') {
        assert.ok(JSON.stringify(c.decision_request).includes('FB-UJI-1'));
        return '{"branch":{"choice":"layanan"},"ticket_0":{"type":"noul","noul":0.9}}';
      }
      if (c.call_role === 'context') return 'pelanggan-menunggu-konfirmasi';
      checked = true;
      assert.ok(m.some(m => m.content.includes('FB-UJI-1')));
      return '{"answer":"Masih menunggu tim"}';
    },
    { ...defaults, model_decision: 'typesafe/jev-1.13' },
    [{ role: 'user', content: 'Status tiket saya?' }],
    { ...scope, pendingFallbacks: [{ id: 'FB-UJI-1', question: 'Uji keputusan tim' }] },
    null,
  );
  assert.equal(checked, true);
});

test('Standalone Condition and Fallback nodes work, but require an explicit graph route', async () => {
  const d = csParityProfile();
  const input = d.nodes.find(n => n.type === 'input')!;
  d.nodes = [
    input,
    {
      ...input,
      id: 'condition',
      type: 'condition',
      field: 'input.message',
      operator: 'equals',
      compare: 'hubungi tim',
    },
    { ...input, id: 'fallback', type: 'fallback', label: 'Butuh tim', value: '{{input.message}}' },
    { ...input, id: 'output', type: 'output', value: 'Selesai' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'condition' },
    { id: 'e2', source: 'condition', port: 'yes', target: 'fallback' },
    { id: 'e3', source: 'condition', port: 'no', target: 'output' },
  ];
  const noModel: AITransport = async () => {
    throw Error('Tidak perlu model');
  };
  const routed = await runGraph(d, noModel, { ...defaults }, [{ role: 'user', content: 'hubungi tim' }], scope, null);
  assert.equal(routed.fallback?.reason, 'Butuh tim');
  assert.equal(
    (await runGraph(d, noModel, { ...defaults }, [{ role: 'user', content: 'selesai' }], scope, null)).answer,
    'Selesai',
  );
});

test('Published graph dispatches native tools with tenant/customer scope, durable idempotency and media hooks', async () => {
  const { AIService } = await import('../../../src/components/ai/domain/service.js');
  const { aiData } = await import('../../../src/components/ai/domain/profiles/cs/store.js');
  const { setProfileEnabled, activeWorkflow, clientProfiles } =
    await import('../../../src/components/ai/domain/profiles/registry.js');
  const { runAgents } = await import('../../../src/components/ai/domain/pipeline/runner.js');
  const actor = randomUUID();
  let graphId = '';
  try {
    await db.execute("INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,'owner')", [
      actor,
      actor + '@test.invalid',
      'unused',
    ]);
    const g = await store.createGraph(actor, csParityProfile());
    graphId = g.id;
    await store.saveGraph(actor, graphId, { revision: g.revision }, true);
    await setProfileEnabled(actor, graphId, true);
    const svc = new AIService(
      async () => '{"answer":"Uji"}',
      async () => {},
    );
    const profile = await svc.createDataProfile(actor, { profile_type: graphId, name: 'Bisnis uji' });
    const { default: request } = await import('supertest');
    const { createApp } = await import('../../../src/http/app.js');
    const { digest } = await import('../../../src/libraries/security.js');
    const token = randomUUID();
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      actor,
    ]);
    const app = createApp();
    await request(app)
      .post('/ai/data-profiles/' + profile.id + '/products')
      .set('Cookie', 'ncwa_session=' + token)
      .set('Origin', process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067')
      .send({ ...businessSamples.products[0], image_id: null })
      .expect(200);
    await svc.saveDataProfileField(actor, profile.id, 'usaha', 'Toko Uji');
    assert.match((await svc.dataProfile(actor, profile.id)).knowledge, /Toko Uji/);
    const nativeScope = {
      ...scope,
      account: actor,
      profile: profile.id,
      session: '',
      customer: '628000000001',
      requestId: randomUUID(),
    };
    const workflow = (await activeWorkflow(
      graphId,
    )) as import('../../../src/components/ai/domain/pipeline/models.js').AgentWorkflow;
    let turns = 0;
    const execute = async (tool: string, query: unknown, overrides = {}) => {
      turns = 0;
      const observed: unknown[] = [];
      await runAgents(
        async c => {
          if (c.call_role === 'router') return '{"branch":"layanan"}';
          if (c.call_role === 'context') return 'pelanggan-mendapat-konfirmasi';
          return turns++ === 0 ? JSON.stringify({ tool, query }) : '{"answer":"Selesai"}';
        },
        { ...defaults, workflow },
        [{ role: 'user', content: 'Uji bisnis' }],
        300,
        { ...nativeScope, ...overrides },
        {
          execute: async (name, q, context) => {
            assert.equal(context.account, actor);
            assert.equal(context.profile, profile.id);
            const result = await aiData.execute(name, q, context);
            observed.push(result);
            return result;
          },
        },
      );
      return observed.at(-1) as any;
    };
    const created = await execute('create_order', '2 x Produk Basic');
    assert.equal(created.order.total, 300000);
    const repeat = await execute('create_order', '2 x Produk Basic');
    assert.equal(repeat.order.id, created.order.id);
    assert.equal((await aiData.orders(actor, profile.id)).length, 1);
    assert.deepEqual(await execute('check_order', created.order.id, { customer: '628000000002' }), { order: null });
    assert.equal((await execute('check_order', created.order.id)).order.id, created.order.id);
    const picture = randomUUID();
    await db.execute('INSERT INTO ai_product_images(id,account_id,data_profile_id,size_bytes) VALUES (?,?,?,?)', [
      picture,
      actor,
      profile.id,
      10,
    ]);
    await aiData.saveProduct(actor, profile.id, 'Produk Basic', { ...businessSamples.products[0], image_id: picture });
    assert.equal((await execute('send_product_image', 'Produk Basic')).image_id, picture);
    const other = await svc.createDataProfile(actor, { profile_type: graphId, name: 'Profil lain' });
    assert.deepEqual(await aiData.execute('check_order', created.order.id, { ...nativeScope, profile: other.id }), {
      order: null,
    });
    assert.ok((await clientProfiles(actor)).some(p => p.id === graphId && p.business_tools));
  } finally {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [actor]);
    await db.execute('DELETE FROM accounts WHERE id=?', [actor]);
    if (graphId) {
      await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [graphId]);
      await db.execute('DELETE FROM ai_profile_types WHERE id=?', [graphId]);
    }
  }
});

test('SPO context uses the legacy payload, repairs invalid format, and feeds the next router turn', async () => {
  const d = csParityProfile();
  let contextCalls = 0;
  const config = { ...defaults, model_decision: 'typesafe/jev-1.13' };
  const history = [
    { role: 'user' as const, content: 'Pesan sebelumnya' },
    { role: 'assistant' as const, content: 'Jawaban sebelumnya' },
  ];
  await runGraph(
    d,
    async (c, m, max) => {
      if (c.call_role === 'router') return '{"branch":{"choice":"layanan"}}';
      if (c.call_role === 'context') {
        assert.equal(max, 30);
        const data = JSON.parse(m[1].content);
        assert.deepEqual(data, {
          riwayat_sebelumnya: [
            { peran: 'user', isi: 'Pesan sebelumnya' },
            { peran: 'assistant', isi: 'Jawaban sebelumnya' },
          ],
          pesan_pelanggan: 'Pesan terbaru',
          jawaban_agent: 'Silakan tentukan jumlah',
        });
        assert.equal('nodes' in data, false);
        if (contextCalls++ === 0) return 'Pelanggan ditanya jumlah.';
        assert.ok(m.at(-1)!.content.includes('Output sebelumnya tidak valid'));
        return 'pelanggan-diminta-menentukan-jumlah';
      }
      return '{"answer":"Silakan tentukan jumlah"}';
    },
    config,
    [...history, { role: 'user', content: 'Pesan terbaru' }],
    scope,
    'pelanggan-mencari-produk',
  );
  assert.equal(contextCalls, 2);
  assert.equal(config.graph_context, 'pelanggan-diminta-menentukan-jumlah');
  await runGraph(
    d,
    async c => {
      if (c.call_role === 'router') {
        assert.equal((c.decision_request!.state as any).input.context, config.graph_context);
        return '{"branch":{"choice":"layanan"}}';
      }
      return c.call_role === 'context' ? 'pelanggan-memesan-dua-produk' : '{"answer":"Baik"}';
    },
    { ...defaults, model_decision: 'typesafe/jev-1.13' },
    [{ role: 'user', content: 'Dua' }],
    scope,
    config.graph_context!,
  );
});

test('SPO context respects disconnected memory and rejects malformed output after correction', async () => {
  const d = csParityProfile();
  d.nodes.find(n => n.id === 'context')!.memory = '';
  let attempts = 0;
  const config = { ...defaults };
  await assert.rejects(
    runGraph(
      d,
      async (c, m) => {
        if (c.call_role === 'router') return '{"branch":"layanan"}';
        if (c.call_role === 'context') {
          attempts++;
          assert.deepEqual(JSON.parse(m[1].content).riwayat_sebelumnya, []);
          return '{"context":"ringkasan tidak sesuai"}';
        }
        return '{"answer":"Jawaban"}';
      },
      config,
      [
        { role: 'user', content: 'Riwayat yang dilepas' },
        { role: 'user', content: 'Pesan saat ini' },
      ],
      scope,
      'konteks-lama-tersimpan',
    ),
    /ai_invalid_context/,
  );
  assert.equal(attempts, 2);
  assert.equal(config.graph_context, 'konteks-lama-tersimpan');
});
