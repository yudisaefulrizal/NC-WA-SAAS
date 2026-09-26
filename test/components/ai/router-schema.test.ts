// Tes skema Router dan Pesanan: daftar specialist, skema opsional ke provider, dan kecocokan draft lama.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  routerAgentNames,
  routerOutputSchema,
  validateRouterOutput,
} from '../../../src/components/ai/domain/pipeline/router-schema.js';
import { runAgents } from '../../../src/components/ai/domain/pipeline/runner.js';
import { agents, csPipeline } from '../../../src/components/ai/domain/profiles/cs/pipeline.js';
import { eduPipeline } from '../../../src/components/ai/domain/profiles/pendidikan/pipeline.js';
import { parseJevRoute } from '../../../src/components/ai/domain/pipeline/jev-router.js';
import { aiRequestPayload, defaults } from '../../../src/components/ai/domain/provider.js';
import { defaultWorkflow, workflowInput } from '../../../src/components/ai/domain/pipeline/workflow.js';
import { roleConfig } from '../../../src/components/ai/domain/pipeline/models.js';
import { db } from '../../../src/libraries/db.js';
after(() => db.end());
test('Router enum covers exactly the executable agents and rejects invalid routes', () => {
  assert.deepEqual([...routerAgentNames].sort(), Object.keys(agents).sort());
  const route = { sub_agent: 'profil_perusahaan', s_p_o_konteks: 'Pelanggan mencari produk', isi_pesan: 'ya' };
  for (const sub_agent of routerAgentNames)
    assert.doesNotThrow(() => validateRouterOutput({ ...route, sub_agent }, 'ya'));
  assert.doesNotThrow(() => validateRouterOutput({ ...route, s_p_o_konteks: 'pelanggan-meminta-harga murah' }, 'ya'));
  for (const value of [
    { ...route, sub_agent: 'unknown' },
    { ...route, sub_agent: ['profil_perusahaan'] },
    { ...route, extra: true },
    { ...route, isi_pesan: 'changed' },
    { ...route, s_p_o_konteks: '   ' },
    { ...route, s_p_o_konteks: 'a'.repeat(201) },
    {},
  ])
    assert.throws(() => validateRouterOutput(value, 'ya'), /ai_invalid_route/);
});
test('Provider schema is opt-in, router-only, and old drafts stay compatible', () => {
  const workflow = defaultWorkflow();
  delete workflow.nodes.router.structured_output;
  assert.equal(workflowInput(workflow).nodes.router.structured_output, false);
  assert.equal(aiRequestPayload({ ...defaults, workflow, call_role: 'router' }, []).response_format, undefined);
  workflow.nodes.router.structured_output = true;
  assert.deepEqual(aiRequestPayload({ ...defaults, workflow, call_role: 'router' }, []).response_format, {
    type: 'json_schema',
    json_schema: { name: 'router_output', strict: true, schema: routerOutputSchema },
  });
  for (const call_role of ['context', 'profil_perusahaan', undefined] as const)
    assert.equal(aiRequestPayload({ ...defaults, workflow, call_role }, []).response_format, undefined);
  workflow.nodes.context.structured_output = true;
  assert.throws(() => workflowInput(workflow));
});
test('Custom prompt and repair preserve enum contract before dispatch', async () => {
  const workflow = defaultWorkflow();
  workflow.nodes.router.prompt = 'Custom router';
  let calls = 0;
  const result = await runAgents(
    async (c, m) => {
      if (c.call_role !== 'router') return '{"answer":"Baik"}';
      assert.ok(m[0].content.includes(JSON.stringify(routerOutputSchema)));
      assert.ok(m[0].content.startsWith('Custom router'));
      return JSON.stringify({
        sub_agent: ++calls === 1 ? 'unknown' : 'layanan',
        s_p_o_konteks: 'Pelanggan memesan produk',
        isi_pesan: 'ya',
      });
    },
    { ...defaults, workflow },
    [{ role: 'user', content: 'ya' }],
    300,
    { account: 'test', session: 'test', customer: 'test', requestId: 'test', knowledge: '' },
  );
  assert.equal(calls, 2);
  assert.equal(result.agent, 'layanan');
});
test('Workflows saved before the Pesanan node still load with its default', () => {
  const workflow = defaultWorkflow() as any;
  delete workflow.nodes.pesanan;
  workflow.nodes.router.prompt = 'Router lama';
  const loaded = workflowInput(workflow);
  assert.equal(loaded.nodes.router.prompt, 'Router lama');
  assert.deepEqual(loaded.nodes.pesanan, defaultWorkflow().nodes.pesanan);
  assert.equal(loaded.nodes.pesanan.tier, 'structured');
  assert.equal(loaded.nodes.pesanan.structured_output, false);
  workflow.nodes.pesanan = { ...defaultWorkflow().nodes.pesanan, structured_output: true };
  assert.equal(workflowInput(workflow).nodes.pesanan.structured_output, true);
  workflow.nodes.pesanan.structured_output = 'ya';
  assert.throws(() => workflowInput(workflow));
});
test('Router sends its schema when moved to the Terstruktur tier, and uses that tier model', () => {
  const workflow = defaultWorkflow();
  workflow.nodes.router.tier = 'structured';
  const config = { ...defaults, workflow, model_cheap: 'cheap-test', model_structured: 'structured-test' };
  const selected = roleConfig(config, 'router');
  assert.equal(selected.model, 'structured-test');
  assert.deepEqual(aiRequestPayload(selected, []).response_format, {
    type: 'json_schema',
    json_schema: { name: 'router_output', strict: true, schema: routerOutputSchema },
  });
  // Peran lain di tier Terstruktur mendapat modelnya tapi tanpa skema; hanya Router dan Pesanan yang punya skema.
  workflow.nodes.layanan.tier = 'structured';
  const layanan = roleConfig(config, 'layanan');
  assert.equal(layanan.model, 'structured-test');
  assert.equal(aiRequestPayload(layanan, []).response_format, undefined);
  assert.ok(workflowInput(workflow).nodes.router.tier === 'structured');
});
test('Decision tier is selectable without changing the default router or forcing a chat JSON schema', () => {
  const workflow = defaultWorkflow();
  assert.equal(workflow.nodes.router.tier, 'cheap');
  workflow.nodes.router.tier = 'decision';
  const loaded = workflowInput(workflow);
  const selected = roleConfig({ ...defaults, workflow: loaded, model_decision: 'decision-test' }, 'router');
  assert.equal(selected.model, 'decision-test');
  assert.equal(aiRequestPayload(selected, []).response_format, undefined);
});
test('JEV routes both CS profiles through typed decisions and relates only matching pending tickets', async () => {
  for (const [pipeline, specialist] of [
    [csPipeline, 'layanan'],
    [eduPipeline, 'program'],
  ] as const) {
    const workflow = defaultWorkflow(pipeline);
    workflow.nodes.router.tier = 'decision';
    const pendingFallbacks = [
      { id: 'ticket-a', question: 'Harga program?' },
      { id: 'ticket-b', question: 'Alamat kantor?' },
    ];
    const routed: unknown[] = [];
    const result = await runAgents(
      async (selected, messages) => {
        if (selected.call_role !== 'router') return '{"answer":"Baik"}';
        const request = selected.decision_request!;
        assert.equal(request.model, 'typesafe/jev-1.13');
        assert.equal(request.state.pesan_terbaru, 'Berapa harganya?');
        assert.equal(request.state.konteks_sebelumnya, 'pelanggan-menanyakan-program-biaya');
        assert.deepEqual(Object.keys(request.questions), ['specialist', 'ticket_0', 'ticket_1']);
        assert.deepEqual(Object.keys(request.questions.specialist.criteria), Object.keys(pipeline.agents));
        assert.deepEqual(messages, [{ role: 'user', content: 'Berapa harganya?' }]);
        return JSON.stringify({
          specialist: { type: 'choice', choice: specialist, confidence: 0.9 },
          ticket_0: { type: 'noul', noul: 0.91 },
          ticket_1: { type: 'noul', noul: 0.2 },
        });
      },
      {
        ...defaults,
        provider: 'openrouter',
        model_decision: 'typesafe/jev-1.13',
        workflow,
        onTrace: event => {
          if (event.node === 'router' && event.state === 'routed') routed.push(event.output);
        },
      },
      [{ role: 'user', content: 'Berapa harganya?' }],
      300,
      {
        account: 'test',
        profile: 'test',
        session: 'test',
        customer: 'test',
        requestId: 'test',
        knowledge: '',
        pendingFallbacks,
      },
      undefined,
      'pelanggan-menanyakan-program-biaya',
      pipeline,
    );
    assert.equal(result.agent, specialist);
    assert.deepEqual(routed, [{ sub_agent: specialist, fallback_terkait: ['ticket-a'] }]);
  }
});
test('JEV rejects unknown specialists, malformed ticket decisions, and use outside Decision tier', async () => {
  const names = Object.keys(csPipeline.agents);
  for (const answers of [
    { specialist: { type: 'choice', choice: 'unknown' }, ticket_0: { type: 'noul', noul: 0.8 } },
    { specialist: { type: 'choice', choice: 'layanan' }, ticket_0: { type: 'noul', noul: 2 } },
    { specialist: { type: 'choice', choice: 'layanan' } },
  ])
    assert.throws(
      () => parseJevRoute(JSON.stringify(answers), names, [{ id: 'ticket-a', question: 'Harga?' }]),
      /ai_invalid_route/,
    );
  const workflow = defaultWorkflow();
  assert.throws(() =>
    workflowInput({ nodes: { ...workflow.nodes, layanan: { ...workflow.nodes.layanan, tier: 'decision' } } }),
  );
  await assert.rejects(
    runAgents(
      async () => '{"answer":"Baik"}',
      { ...defaults, model_cheap: 'typesafe/jev-1.13', workflow },
      [{ role: 'user', content: 'Halo' }],
      300,
      { account: 'test', profile: 'test', session: 'test', customer: 'test', requestId: 'test', knowledge: '' },
    ),
    /ai_jev_requires_decision_tier/,
  );
});
