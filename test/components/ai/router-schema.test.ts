// Tes skema Router dan Pesanan: daftar specialist, skema opsional ke provider, dan kecocokan draft lama.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  routerAgentNames,
  routerOutputSchema,
  validateRouterOutput,
} from '../../../src/components/ai/domain/pipeline/router-schema.js';
import { runAgents } from '../../../src/components/ai/domain/pipeline/runner.js';
import { agents } from '../../../src/components/ai/domain/profiles/cs/pipeline.js';
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
