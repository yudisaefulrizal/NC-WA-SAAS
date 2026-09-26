// Adapter tool bisnis yang dapat dipasang pada graf; konteks identitas hanya berasal dari runtime.
import { ApiError } from '../../../../libraries/errors.js';
import { structuredOrder } from '../profiles/cs/orders.js';
import { orderPrompt } from '../profiles/cs/order-schema.js';
import { orderInput } from '../profiles/cs/store.js';
import type { AITools, ToolContext } from '../pipeline/runner.js';
import type { AIConfig, AITransport } from '../provider.js';
import type { GraphNode } from './definition.js';

export const businessDescriptions = {
  get_knowledge: 'Baca profil usaha. query berupa string kosong.',
  get_products: 'Cari katalog aktif dengan query nama produk atau string kosong.',
  check_order: 'Cari pesanan pelanggan percakapan ini. query adalah ID pesanan.',
  create_order:
    'Buat pesanan setelah pelanggan mengonfirmasi. query: "2 x Nama Produk; catatan: ..." atau objek {items:[{product_name,quantity}],notes}. Harga berasal dari katalog. Tier dan model tool dipakai untuk ekstraksi bila parser belum cukup.',
  send_product_image: 'Pilih foto produk untuk dikirim bersama jawaban. query adalah nama produk persis dari katalog.',
};
export async function executeBusinessTool(
  node: GraphNode,
  value: unknown,
  scope: ToolContext,
  tools: AITools,
  transport: AITransport,
  config: AIConfig,
) {
  const name = node.capability!;
  if (!scope.customer) throw Error('ai_missing_customer');
  try {
    let query: string;
    if (name === 'create_order') {
      if (value && typeof value === 'object') query = JSON.stringify(orderInput(value));
      else {
        if (typeof value !== 'string' || value.length > 2000) throw Error('ai_invalid_tool');
        // Konfigurasi ekstraksi ikut node Tool ini, bukan nama node atau profil yang ditanam di kode.
        const extraction = {
          ...config,
          workflow: {
            ...config.workflow,
            nodes: {
              ...config.workflow?.nodes,
              pesanan: { prompt: node.prompt || orderPrompt, tier: node.tier, model: node.model, tools: [] },
            },
          },
          onTrace: config.onTrace
            ? (event: Parameters<NonNullable<AIConfig['onTrace']>>[0]) =>
                config.onTrace?.({ ...event, node: event.node === 'pesanan' ? node.id : event.node })
            : undefined,
        };
        query = await structuredOrder(
          (c, m, max) => transport({ ...c, trace_node: node.id }, m, max),
          extraction,
          value,
          new Map(),
          tools,
          Object.freeze({ ...scope }),
        );
      }
    } else {
      if (typeof value !== 'string' || value.length > 2000) throw Error('ai_invalid_tool');
      query = value;
    }
    return await tools.execute(name, query, Object.freeze({ ...scope }));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
    return { error: error.code, message: error.message };
  }
}
