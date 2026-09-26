// Tool bisnis sandbox: memakai fixture eksplisit dan tidak mengakses database, endpoint, atau WhatsApp.
import { randomUUID } from 'node:crypto';
import { record } from '../../../../libraries/validation.js';
import { ApiError } from '../../../../libraries/errors.js';
import { productInput, productForAI, orderInput, orderForAI, orderStatuses, type Order } from '../profiles/cs/store.js';
import type { AITools, PendingFallback } from '../pipeline/runner.js';
import { text } from './definition.js';
export const simulationCustomer = '628000000001';
export function businessSimulation(value: unknown) {
  const input = record(value ?? {});
  const list = (v: unknown): unknown[] => {
    if (!Array.isArray(v) || v.length > 100)
      throw new ApiError(400, 'invalid_request', 'Maksimal 100 data bisnis simulasi.');
    return v;
  };
  const products = list(input.products ?? []).map(productInput);
  if (new Set(products.map(p => p.name)).size !== products.length)
    throw new ApiError(400, 'invalid_request', 'Nama produk simulasi harus unik.');
  const knowledge = text(input.knowledge ?? '', 12000);
  const pending: PendingFallback[] = list(input.pending ?? []).map(v => {
    const t = record(v);
    return { id: text(t.id, 64), question: text(t.question, 1000) };
  });
  const orders: Order[] = list(input.orders ?? []).map(v => {
    const o = record(v);
    const validated = orderInput({
      items: Array.isArray(o.items)
        ? o.items.map(v => {
            const i = record(v);
            return { product_name: i.product_name, quantity: i.quantity };
          })
        : o.items,
      notes: o.notes,
    });
    const rawItems = o.items as Record<string, unknown>[];
    const items = validated.items.map((i, index) => {
      const price = rawItems[index].price;
      if (!Number.isSafeInteger(price) || Number(price) < 0 || Number(price) > 1000000000)
        throw new ApiError(400, 'invalid_request', 'Harga simulasi tidak valid.');
      return { ...i, price: Number(price) };
    });
    if (!orderStatuses.includes(o.status as (typeof orderStatuses)[number]))
      throw new ApiError(400, 'invalid_request', 'Status pesanan tidak valid.');
    return {
      id: text(o.id, 64),
      customer: text(o.customer, 64),
      items,
      total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      status: String(o.status),
      notes: validated.notes,
    };
  });
  const requests = new Map<string, { input: string; order: Order }>();
  const images: string[] = [];
  const tools: AITools = {
    execute: async (name, query, scope) => {
      if (name === 'get_knowledge') return { knowledge };
      if (name === 'get_products')
        return {
          products: products
            .filter(p => p.active && p.name.toLowerCase().includes(query.toLowerCase()))
            .map(productForAI),
        };
      if (name === 'check_order')
        return { order: orderForAI(orders.find(o => o.id === query && o.customer === scope.customer) ?? null) };
      if (name === 'send_product_image') {
        const p = products.find(p => p.active && p.name === query.trim());
        if (!p?.image_id) return { available: false, reason: 'Produk tidak ditemukan atau belum memiliki foto' };
        if (!images.includes(p.image_id)) images.push(p.image_id);
        return { available: true, product_name: p.name, image_id: p.image_id };
      }
      if (name !== 'create_order') throw Error('ai_invalid_tool');
      const data = orderInput(JSON.parse(query));
      const hash = JSON.stringify([scope.customer, data]);
      const previous = requests.get(scope.requestId);
      if (previous) {
        if (previous.input !== hash) throw new ApiError(409, 'idempotency_conflict', 'ID sudah dipakai');
        return { order: orderForAI(previous.order) };
      }
      const items = data.items.map(i => {
        const p = products.find(p => p.active && p.name === i.product_name);
        if (!p || p.stock < i.quantity)
          throw new ApiError(400, 'invalid_request', 'Produk tidak tersedia atau stok/kapasitas tidak cukup');
        return { ...i, price: p.price };
      });
      const order: Order = {
        id: 'ORD-' + randomUUID(),
        customer: scope.customer,
        items,
        total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
        status: 'pesanan_masuk',
        notes: data.notes,
      };
      orders.push(order);
      requests.set(scope.requestId, { input: hash, order });
      return { order: orderForAI(order) };
    },
  };
  return { tools, knowledge, pending, snapshot: () => ({ knowledge, products, orders, pending }), images };
}
