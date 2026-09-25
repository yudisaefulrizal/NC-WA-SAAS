// Data CS Usaha di sebuah data profil: produk, pesanan, dan sumber datanya (bawaan atau endpoint milik klien),
// beserta tool yang dipakai AI untuk membacanya dan membuat pesanan.
import { randomUUID } from 'node:crypto';
import { request } from 'node:https';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../../../../libraries/db.js';
import { digest } from '../../../../../libraries/security.js';
import { encrypt, decrypt } from '../../../../../libraries/crypto.js';
import { ApiError } from '../../../../../libraries/errors.js';
import { validatePublicUrl } from '../../../../../libraries/download.js';
import type { AITools, ToolContext, ToolName } from '../../pipeline/runner.js';
import { record } from '../../../../../libraries/validation.js';
import * as accountsSql from '../../../data-access/accounts-queries.js';
import * as dataProfilesSql from '../../../data-access/data-profiles-queries.js';
import * as dataSourcesSql from '../../../data-access/data-sources-queries.js';
import * as ordersSql from '../../../data-access/orders-queries.js';
import * as productImagesSql from '../../../data-access/product-images-queries.js';
import * as productsSql from '../../../data-access/products-queries.js';

const invalid = (message: string) => new ApiError(400, 'invalid_request', message);
const missing = () => new ApiError(404, 'not_found', 'Data tidak ditemukan');
function text(value: unknown, max: number, name: string, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw invalid(name + ' tidak valid');
  return value.trim();
}
function integer(value: unknown, max: number, name: string, min = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid(name + ' tidak valid');
  return Number(value);
}
function identifier(value: unknown) {
  const id = text(value, 64, 'ID');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw invalid('ID hanya boleh huruf, angka, tanda - dan _');
  return id;
}
export function customerNumber(value: unknown) {
  const number = text(value, 20, 'Nomor pelanggan');
  if (!/^[1-9][0-9]{5,14}$/.test(number)) throw invalid('Gunakan nomor WhatsApp internasional tanpa +');
  return number;
}
// Setiap penulisan memeriksa ulang bahwa data profil milik akun ini, jadi id milik akun lain tidak pernah cocok.
async function transaction<T>(account: string, fn: (c: PoolConnection) => Promise<T>, profile?: string) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await accountsSql.lockSuspended(c, [account]);
    if (!rows[0] || rows[0].suspended) throw new ApiError(403, 'account_unavailable', 'Akun tidak tersedia');
    if (profile !== undefined) {
      const [owned] = await dataProfilesSql.findOwned(c, [profile, account]);
      if (!owned[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
    }
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export interface Product {
  name: string;
  type: 'product' | 'service';
  description: string;
  price: number;
  stock: number;
  active: boolean;
  image_id: string | null;
}
function imageId(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const id = text(value, 36, 'Foto');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw invalid('Referensi foto tidak valid');
  return id;
}
export function productInput(value: unknown): Product {
  const p = record(value);
  if (p.type !== 'product' && p.type !== 'service') throw invalid('Jenis produk/layanan tidak valid');
  if (typeof p.active !== 'boolean') throw invalid('Status produk tidak valid');
  return {
    name: text(p.name, 150, 'Nama'),
    type: p.type,
    description: text(p.description ?? '', 500, 'Deskripsi', true),
    price: integer(p.price, 1000000000, 'Harga'),
    stock: integer(p.stock, 1000000, 'Stok/kapasitas'),
    active: p.active,
    image_id: imageId(p.image_id),
  };
}
// Yang dilihat AI: ada foto atau tidak, bukan id gambar internal (send_product_image bekerja berdasarkan nama).
export function productForAI({ image_id, ...product }: Product) {
  return { ...product, ada_foto: Boolean(image_id) };
}
function productRow(p: RowDataPacket): Product {
  return productInput({ ...p, price: Number(p.price), active: Boolean(p.active) });
}
export interface OrderInput {
  items: { product_name: string; quantity: number }[];
  notes: string;
}
export function orderInput(value: unknown): OrderInput {
  const o = record(value);
  if (Object.keys(o).some(k => !['items', 'notes'].includes(k)))
    throw invalid('Pesanan hanya menerima items dan notes');
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > 20) throw invalid('Isi 1–20 item pesanan');
  const items = o.items.map(value => {
    const item = record(value);
    if (Object.keys(item).some(k => !['product_name', 'quantity'].includes(k)))
      throw invalid('Item hanya menerima product_name dan quantity');
    return {
      product_name: text(item.product_name, 150, 'Nama produk'),
      quantity: integer(item.quantity, 1000, 'Jumlah', 1),
    };
  });
  if (new Set(items.map(i => i.product_name)).size !== items.length)
    throw invalid('Gabungkan produk yang sama dalam satu item');
  return { items, notes: text(o.notes ?? '', 1000, 'Catatan', true) };
}
export const orderStatuses = ['pesanan_masuk', 'dibayar', 'diproses', 'selesai', 'dibatalkan'] as const;
// Nama status untuk pelanggan yang diulang AI; nilai tersimpan dan API HTTP memakai status mentahnya.
export const orderStatusLabels: Record<(typeof orderStatuses)[number], string> = {
  pesanan_masuk: 'Pesanan masuk',
  dibayar: 'Dibayar',
  diproses: 'Diproses',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};
export function orderForAI<T extends { status: string }>(order: T | null) {
  return (
    order && { ...order, status: orderStatusLabels[order.status as (typeof orderStatuses)[number]] ?? order.status }
  );
}
export interface Order {
  id: string;
  customer: string;
  items: (OrderInput['items'][number] & { price: number })[];
  total: number;
  status: string;
  notes: string;
}
function orderRow(row: RowDataPacket): Order {
  return {
    id: row.id,
    customer: row.customer,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    total: Number(row.total),
    status: row.status,
    notes: row.notes,
  };
}
export interface DataSource {
  mode: 'builtin' | 'endpoint';
  endpoint: string;
  secret: string;
}
export type SourceKind = 'products' | 'orders';
export const builtinSource: DataSource = { mode: 'builtin', endpoint: '', secret: '' };
// Produk, pesanan, dan sumbernya milik data profil (ai_data_profiles), dipakai bersama oleh semua sesi yang
// memasangnya.
export async function source(account: string, profile: string, kind: SourceKind, c = db): Promise<DataSource> {
  const [rows] = await dataSourcesSql.find(c, [account, profile, kind]);
  return rows[0] ? { mode: rows[0].mode, endpoint: rows[0].endpoint, secret: rows[0].secret } : { ...builtinSource };
}
export async function publicSources(account: string, profile: string) {
  const products = await source(account, profile, 'products'),
    orders = await source(account, profile, 'orders');
  const safe = ({ secret, ...s }: DataSource) => ({ ...s, has_token: Boolean(secret) });
  return { products_source: safe(products), orders_source: safe(orders) };
}
export async function endpointUrl(value: string) {
  if (value.length > 512) throw invalid('Endpoint terlalu panjang');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw invalid('Endpoint tidak valid');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw invalid('Endpoint wajib HTTPS tanpa kredensial, query atau fragmen');
  await validatePublicUrl(u.href);
  return u.href;
}
export async function sourceInput(value: unknown) {
  const s = record(value);
  if (s.mode !== 'builtin' && s.mode !== 'endpoint') throw invalid('Sumber data tidak valid');
  const endpoint = s.mode === 'endpoint' ? await endpointUrl(text(s.endpoint, 512, 'Endpoint')) : '';
  let token: string | undefined;
  if (s.token !== undefined) {
    token = text(s.token, 512, 'Token', true);
    if (/[\r\n]/.test(token)) throw invalid('Token tidak valid');
  }
  if (s.clear_token !== undefined && typeof s.clear_token !== 'boolean')
    throw invalid('Pilihan hapus token tidak valid');
  return { mode: s.mode as DataSource['mode'], endpoint, token, clear_token: s.clear_token === true };
}
export async function saveSource(
  c: PoolConnection,
  account: string,
  profile: string,
  kind: SourceKind,
  input: Awaited<ReturnType<typeof sourceInput>>,
) {
  const [rows] = await dataSourcesSql.findEndpoint(c, [account, profile, kind]);
  const secret =
    input.clear_token || input.mode === 'builtin'
      ? ''
      : input.token
        ? encrypt(input.token)
        : rows[0]?.endpoint === input.endpoint
          ? rows[0].secret
          : '';
  await dataSourcesSql.upsert(c, [account, profile, kind, input.mode, input.endpoint, secret]);
}

// Hanya HTTPS; DNS dikunci di setiap request, tanpa redirect, tanpa kredensial atau body di pesan error.
export type EndpointTransport = (
  source: DataSource,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) => Promise<unknown>;
export const callEndpoint: EndpointTransport = async (config, payload, idempotencyKey) => {
  const { url, addresses } = await validatePublicUrl(await endpointUrl(config.endpoint));
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Idempotency-Key': idempotencyKey,
          ...(config.secret ? { Authorization: 'Bearer ' + decrypt(config.secret) } : {}),
        },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32000) {
            res.destroy(Error('endpoint_response_limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', error =>
          reject(Error(error.message === 'endpoint_response_limit' ? 'endpoint_response_limit' : 'endpoint_failed')),
        );
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(Error('endpoint_http_' + res.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(Error('endpoint_invalid_json'));
          }
        });
      },
    );
    req.on('error', () => reject(Error('endpoint_failed')));
    req.end(body);
  });
};

export class AIData implements AITools {
  constructor(private remote: EndpointTransport = callEndpoint) {}
  async products(account: string, profile: string, query = '', activeOnly = false) {
    const [rows] = await productsSql.listByProfile(db, [account, profile, '%' + query + '%'], activeOnly);
    return rows.map(productRow);
  }
  async saveProduct(account: string, profile: string, previousName: string, value: unknown) {
    const p = productInput(value);
    return transaction(
      account,
      async c => {
        // Foto hanya bisa dipakai oleh data profil tempat foto itu diunggah.
        if (p.image_id) {
          const [image] = await productImagesSql.findInProfile(c, [p.image_id, account, profile]);
          if (!image[0]) throw invalid('Foto produk tidak ditemukan');
        }
        if (previousName && previousName !== p.name)
          await productsSql.deleteByName(c, [account, profile, previousName]);
        const [previous] = await productsSql.findImageId(c, [account, profile, previousName || p.name]);
        await productsSql.upsert(c, [
          account,
          profile,
          p.name,
          p.type,
          p.description,
          p.price,
          p.stock,
          p.active,
          p.image_id,
        ]);
        return {
          product: p,
          replacedImageId:
            previous[0]?.image_id && previous[0].image_id !== p.image_id ? String(previous[0].image_id) : null,
        };
      },
      profile,
    );
  }
  async orders(account: string, profile: string) {
    const [rows] = await ordersSql.listByProfile(db, [account, profile]);
    return rows.map(row => ({ ...orderRow(row), session_id: row.session_id ?? null, created_at: row.created_at }));
  }
  async order(account: string, profile: string, id: string, customer?: string) {
    const [rows] = await ordersSql.findForCustomer(
      db,
      [account, profile, id, ...(customer ? [customer] : [])],
      customer,
    );
    return rows[0] ? orderRow(rows[0]) : null;
  }
  async updateOrder(account: string, profile: string, id: string, value: unknown) {
    const o = record(value);
    if (!orderStatuses.includes(o.status as any)) throw invalid('Status pesanan tidak valid');
    const notes = text(o.notes ?? '', 1000, 'Catatan', true);
    return transaction(account, async c => {
      const [rows] = await ordersSql.lockOwned(c, [account, profile, id]);
      if (!rows[0]) throw missing();
      await ordersSql.updateStatus(c, [String(o.status), notes, account, profile, id]);
      return { ok: true };
    });
  }
  // Pesanan tidak pernah memesan stok, jadi menghapusnya tidak perlu menyesuaikan stok.
  async deleteOrder(account: string, profile: string, id: string) {
    return transaction(account, async c => {
      const [result] = await ordersSql.deleteOwned(c, [account, profile, id]);
      if (!result.affectedRows) throw missing();
      return { ok: true };
    });
  }
  private async remoteCall(config: DataSource, name: ToolName, query: unknown, scope: ToolContext) {
    return record(
      await this.remote(
        config,
        {
          action: name,
          query,
          context: {
            account_id: scope.account,
            data_profile_id: scope.profile,
            session_id: scope.session || null,
            customer: scope.customer,
            request_id: scope.requestId,
          },
        },
        digest(
          JSON.stringify([
            scope.account,
            scope.session,
            scope.customer,
            scope.requestId,
            name,
            name === 'create_order' ? '' : query,
          ]),
        ),
      ),
    );
  }
  async catalog(scope: ToolContext, query: string): Promise<Product[]> {
    const config = await source(scope.account, scope.profile, 'products');
    if (config.mode === 'builtin') return this.products(scope.account, scope.profile, query, true);
    const result = await this.remoteCall(config, 'get_products', query, scope);
    if (!Array.isArray(result.products) || result.products.length > 20) throw Error('endpoint_invalid_products');
    const products = result.products.map(productInput).filter(p => p.active);
    if (new Set(products.map(p => p.name)).size !== products.length) throw Error('endpoint_duplicate_products');
    return products;
  }
  private validateRemoteOrder(value: unknown, scope: ToolContext, expectedId?: string): Order | null {
    if (value === null) return null;
    const o = record(value);
    if (
      o.customer !== scope.customer ||
      (expectedId && o.id !== expectedId) ||
      !orderStatuses.includes(o.status as any)
    )
      throw Error('endpoint_order_scope');
    const id = identifier(o.id),
      customer = customerNumber(o.customer),
      notes = text(o.notes ?? '', 1000, 'Catatan', true);
    if (!Array.isArray(o.items) || !o.items.length || o.items.length > 20) throw Error('endpoint_invalid_order');
    const items = o.items.map(value => {
      const i = record(value);
      return {
        product_name: text(i.product_name, 150, 'Nama produk'),
        quantity: integer(i.quantity, 1000, 'Jumlah', 1),
        price: integer(i.price, 1000000000, 'Harga'),
      };
    });
    const total = integer(o.total, 20000000000000, 'Total');
    if (total !== items.reduce((sum, i) => sum + i.quantity * i.price, 0)) throw Error('endpoint_invalid_total');
    return { id, customer, items, total, status: String(o.status), notes };
  }
  async createOrder(scope: ToolContext, input: OrderInput): Promise<Order> {
    const hash = digest(JSON.stringify([scope.customer, input]));
    // Idempotensi yang tersimpan dicek sebelum membaca harga, supaya pengulangan tetap memakai harga saat pertama.
    const [old] = await ordersSql.findByRequest(db, [scope.account, scope.profile, scope.requestId]);
    if (old[0]) {
      if (old[0].customer !== scope.customer || old[0].input_hash !== hash)
        throw new ApiError(409, 'idempotency_conflict', 'ID sudah dipakai');
      return orderRow(old[0]);
    }
    const items: Order['items'] = [];
    for (const item of input.items) {
      const product = (await this.catalog(scope, item.product_name)).find(p => p.name === item.product_name);
      if (!product || product.stock < item.quantity)
        throw invalid('Produk tidak tersedia atau stok/kapasitas tidak cukup');
      items.push({ ...item, price: product.price });
    }
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return transaction(
      scope.account,
      async c => {
        const [existing] = await ordersSql.findByRequest(c, [scope.account, scope.profile, scope.requestId]);
        if (existing[0]) {
          if (existing[0].customer !== scope.customer || existing[0].input_hash !== hash)
            throw new ApiError(409, 'idempotency_conflict', 'ID sudah dipakai');
          return orderRow(existing[0]);
        }
        const order: Order = {
          id: 'ORD-' + randomUUID(),
          customer: scope.customer,
          items,
          total,
          status: 'pesanan_masuk',
          notes: input.notes,
        };
        await ordersSql.insert(c, [
          scope.account,
          scope.profile,
          scope.session || null,
          order.id,
          scope.requestId,
          hash,
          scope.customer,
          JSON.stringify(items),
          total,
          order.status,
          order.notes,
        ]);
        return order;
      },
      scope.profile,
    );
  }
  async execute(name: ToolName, query: string, scope: ToolContext): Promise<unknown> {
    if (name === 'get_knowledge') return { knowledge: scope.knowledge };
    if (name === 'get_products') return { products: (await this.catalog(scope, query)).map(productForAI) };
    if (name === 'send_product_image') {
      // Menentukan gambar mana yang dikirim hanyalah data (dipakai semua pemanggil, termasuk simulasi AI Studio);
      // mengirimnya lewat WhatsApp adalah efek samping yang hanya dilakukan runtime, setelah fungsi ini selesai.
      const product = (await this.catalog(scope, query)).find(p => p.name === query.trim());
      if (!product || !product.image_id)
        return { available: false, reason: 'Produk tidak ditemukan atau belum memiliki foto' };
      return { available: true, product_name: product.name, image_id: product.image_id };
    }
    const config = await source(scope.account, scope.profile, 'orders');
    if (name === 'check_order') {
      const id = identifier(query);
      return {
        order: orderForAI(
          config.mode === 'builtin'
            ? await this.order(scope.account, scope.profile, id, scope.customer)
            : this.validateRemoteOrder((await this.remoteCall(config, name, id, scope)).order, scope, id),
        ),
      };
    }
    let input: OrderInput;
    try {
      input = orderInput(JSON.parse(query));
    } catch {
      throw invalid('create_order memerlukan JSON items [{product_name,quantity}] dan notes');
    }
    if (config.mode === 'builtin') return { order: orderForAI(await this.createOrder(scope, input)) };
    const priced = [];
    for (const item of input.items) {
      const product = (await this.catalog(scope, item.product_name)).find(p => p.name === item.product_name);
      if (!product || product.stock < item.quantity)
        throw invalid('Produk tidak tersedia atau stok/kapasitas tidak cukup');
      priced.push({ ...item, price: product.price });
    }
    const result = await this.remoteCall(config, name, { ...input, items: priced }, scope);
    const order = this.validateRemoteOrder(result.order, scope);
    if (!order) throw Error('endpoint_missing_order');
    if (
      order.items.length !== input.items.length ||
      input.items.some(i => !order.items.some(o => o.product_name === i.product_name && o.quantity === i.quantity))
    )
      throw Error('endpoint_order_items');
    return { order: orderForAI(order) };
  }
}
export const aiData = new AIData();
