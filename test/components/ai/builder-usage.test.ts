// Pemakaian AI di Uji: token dan biaya dibaca dari tiga bentuk jawaban penyedia (OpenRouter chat, Sumopod/LiteLLM,
// OpenRouter Decisions), dan simulasi melaporkannya per panggilan node, dengan perkiraan bila penyedia tidak menyebut.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { readUsage, type AITransport } from '../../../src/components/ai/domain/provider.js';
import { isJevModel, type AITraceEvent } from '../../../src/components/ai/domain/pipeline/models.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import { catalogGraph } from './graph-fixture.js';

after(async () => {
  await db.end();
});

test('Usage and cost are read from OpenRouter, Sumopod (LiteLLM header), and Decisions responses', () => {
  assert.deepEqual(
    readUsage(
      {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          cost: 0.00000825,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      },
      {},
    ),
    { input: 10, output: 5, reasoning: 0, cost: 0.00000825 },
  );
  assert.deepEqual(
    readUsage(
      { usage: { prompt_tokens: 34, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 5 } } },
      { 'x-litellm-response-cost': '8.1e-06' },
    ),
    { input: 34, output: 5, reasoning: 5, cost: 0.0000081 },
  );
  assert.deepEqual(readUsage({ usage: { input_tokens: 323, output_tokens: 37, cost: 0.000013566 } }, {}), {
    input: 323,
    output: 37,
    reasoning: 0,
    cost: 0.000013566,
  });
  assert.deepEqual(readUsage({ usage: { prompt_tokens: 3, completion_tokens: 1 } }, {}), {
    input: 3,
    output: 1,
    reasoning: 0,
    cost: null,
  });
  assert.equal(readUsage({}, {}), null);
});

test('Uji reports usage per model call; calls without provider usage are estimated', async () => {
  const events: AITraceEvent[] = [];
  // Router menyebut pemakaiannya; Agent tidak (diperkirakan dari panjang teks).
  const transport: AITransport = async c => {
    if (c.call_role !== 'router') return '{"answer":"Halo kak"}';
    c.onUsage?.({ input: 120, output: 8, reasoning: 2, cost: 0.00001 });
    return isJevModel(c.model) ? '{"branch":{"choice":"sapaan"}}' : '{"branch":"sapaan","fallback_terkait":[]}';
  };
  await simulate(
    randomUUID(),
    { definition: catalogGraph(), message: 'assalamualaikum' },
    e => events.push(e),
    new AbortController().signal,
    transport,
  );
  const responded = events.filter(e => e.state === 'responded');
  const router = responded.find(e => e.node === 'router')!,
    agent = responded.find(e => e.node === 'sapaan')!;
  assert.deepEqual(router.usage, { input: 120, output: 8, reasoning: 2, cost: 0.00001 });
  assert.equal(agent.usage?.estimated, true);
  assert.equal(agent.usage?.cost, null);
  assert.ok(agent.usage!.input > 0 && agent.usage!.output > 0);
});
