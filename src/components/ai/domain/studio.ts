// Simulasi AI Studio: menjalankan satu pesan lewat alur sebuah profil dengan data simulasi, melaporkan jejak setiap
// node secara langsung, tanpa WhatsApp. Menyimpan dan menerbitkan alur ada di profiles/registry.ts.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ai } from './service.js';
import { composeKnowledge, profileFields, type ProfileField } from './profiles/cs/knowledge.js';
import { callAI, type AIConfig, type AIMessage, type AITransport } from './provider.js';
import { runAgents, updateRouterContext, type AITools } from './pipeline/runner.js';
import {
  eduTool,
  eduToolNames,
  documentMarker,
  type EduSnapshot,
  type EduToolName,
} from './profiles/pendidikan/tools.js';
import { programInput, contactInput } from './profiles/pendidikan/store.js';
import { eduIdentity, eduLimits } from './profiles/pendidikan/profile.js';
import { workflowState, profileDefinition } from './profiles/registry.js';
import type { AgentWorkflow, AITraceEvent } from './pipeline/models.js';
import { productInput, productForAI, orderForAI, orderInput, type Order } from './profiles/cs/store.js';
import { record } from '../../../libraries/validation.js';
import { transientAIError } from './pipeline/retry.js';
import { ApiError } from '../../../libraries/errors.js';

type Emit = (event: AITraceEvent & { session?: string; revision?: number; context?: string | null }) => void;
interface Sandbox {
  owner: string;
  signature: string;
  messages: AIMessage[];
  context: string | null;
  orders: Order[];
  documents: string[];
  touched: number;
}
const bad = (message: string) => new ApiError(400, 'invalid_studio', message);
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max) throw bad('Teks pengujian tidak valid.');
  return value;
}
function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  return /^(ai_|endpoint_)[a-z0-9_]+$/.test(value) ? value : 'studio_failed';
}

export class AIStudio {
  private sessions = new Map<string, Sandbox>();
  private busy = new Set<string>();
  constructor(
    private transport: AITransport = callAI,
    private configuration: () => Promise<AIConfig> = () => ai.config(),
    private wait: (ms: number) => Promise<void> = async ms => {
      await delay(ms);
    },
  ) {}
  async run(owner: string, value: unknown, emit: Emit, signal?: AbortSignal) {
    const body = record(value),
      message = text(body.message, 4000).trim(),
      behavior = text(body.behavior ?? '', 2000);
    if (!message) throw bad('Isi pesan pengujian.');
    // body.profile_type memilih pipeline; setiap profil membawa data simulasinya sendiri (CS: knowledge body.profile
    // dan body.products; CS Lembaga Pendidikan: body.edu; Tester AI: hanya body.behavior).
    const pipeline = profileDefinition(body.profile_type ?? 'cs'),
      edu = pipeline.id === 'pendidikan';
    let knowledge = '',
      products: ReturnType<typeof productInput>[] = [],
      snapshot: EduSnapshot | undefined,
      identity: string | undefined;
    if (edu) {
      const input = record(body.edu ?? {});
      const list = (value: unknown, max: number, name: string) => {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.length > max) throw bad('Maksimal ' + max + ' ' + name + ' simulasi.');
        return value;
      };
      const programs = list(input.programs, eduLimits.programs, 'program').map(programInput);
      if (new Set(programs.map(p => p.name)).size !== programs.length) throw bad('Nama program harus unik.');
      const documents = list(input.documents, eduLimits.documents, 'dokumen').map((value, index) => {
        const d = record(value);
        const filename = text(d.nama_file, 255).trim();
        if (!filename) throw bad('Nama file dokumen simulasi wajib diisi.');
        return {
          id: 'SIM-DOC-' + (index + 1),
          filename,
          media_type: d.jenis === 'gambar' ? ('image' as const) : ('document' as const),
          description: text(d.deskripsi ?? '', eduLimits.documentDescription),
        };
      });
      if (new Set(documents.map(d => d.filename)).size !== documents.length) throw bad('Nama file dokumen harus unik.');
      snapshot = {
        lembaga: text(input.lembaga ?? '', eduLimits.lembaga),
        jadwal: text(input.jadwal ?? '', eduLimits.jadwal),
        faq: text(input.faq ?? '', eduLimits.faq),
        programs,
        contacts: list(input.contacts, eduLimits.contacts, 'kontak').map(contactInput),
        documents,
      };
      identity = eduIdentity(text(input.name ?? '', 100).trim() || 'Lembaga Simulasi');
    } else if (pipeline.id === 'tester') {
      // Tester AI tidak punya data bisnis; perannya datang dari body.behavior (Peran pelanggan simulasi).
    } else {
      const profileInput = record(body.profile ?? {});
      const profile = Object.fromEntries(
        profileFields.map(field => [field, text(profileInput[field] ?? '', 2000)]),
      ) as Record<ProfileField, string>;
      knowledge = composeKnowledge(profile);
      if (!Array.isArray(body.products) || body.products.length > 20) throw bad('Maksimal 20 produk simulasi.');
      products = body.products.map(productInput);
      if (new Set(products.map(p => p.name)).size !== products.length) throw bad('Nama produk harus unik.');
    }
    const state = await workflowState(pipeline.id);
    if (body.revision !== state.revision)
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang sebelum menguji.');
    const base = await this.configuration();
    if (!base.secret) throw bad('Konfigurasikan koneksi AI di Pengaturan AI terlebih dahulu.');
    if (this.busy.has(owner)) throw new ApiError(409, 'studio_busy', 'Pengujian sebelumnya masih berjalan.');
    for (const [id, s] of this.sessions)
      if (Date.now() - s.touched > 1800000 && !this.busy.has(s.owner)) this.sessions.delete(id);
    const signature = JSON.stringify([
      pipeline.id,
      state.revision,
      knowledge,
      behavior,
      products,
      snapshot ?? null,
      identity ?? null,
      base.model,
      base.model_cheap,
      base.model_medium,
      base.model_smart,
      base.model_structured,
      base.memory_limit,
    ]);
    let id: string, sandbox: Sandbox;
    if (body.session) {
      id = text(body.session, 64);
      const found = this.sessions.get(id);
      if (!found || found.owner !== owner)
        throw new ApiError(404, 'studio_session_missing', 'Sesi uji berakhir. Mulai percakapan baru.');
      if (found.signature !== signature)
        throw new ApiError(409, 'studio_session_changed', 'Draft atau data uji berubah. Mulai percakapan baru.');
      sandbox = found;
    } else {
      if (this.sessions.size >= 100)
        throw new ApiError(429, 'studio_capacity', 'Kapasitas pengujian penuh. Coba lagi nanti.');
      const owned = [...this.sessions].filter(([, s]) => s.owner === owner);
      if (owned.length >= 5) this.sessions.delete(owned[0][0]);
      id = randomUUID();
      sandbox = { owner, signature, messages: [], context: null, orders: [], documents: [], touched: Date.now() };
      this.sessions.set(id, sandbox);
    }
    this.busy.add(owner);
    sandbox.touched = Date.now();
    const started = Date.now(),
      guard = () => {
        if (signal?.aborted) throw Error('ai_cancelled');
        if (Date.now() - started >= 120000) throw Error('ai_retry_limit');
      };
    let calls = 0;
    const config: AIConfig = { ...base, workflow: state.draft as AgentWorkflow, signal, onTrace: event => emit(event) };
    const transport: AITransport = async (selected, messages, maxWords) => {
      const node = selected.call_role ?? 'model';
      for (let attempt = 1; attempt <= 3; attempt++) {
        guard();
        if (++calls > 20) throw Error('ai_retry_limit');
        const start = Date.now();
        emit({ node, state: 'running', input: messages, model: selected.model, attempt });
        try {
          const output = await this.transport(selected, messages, maxWords);
          guard();
          emit({ node, state: 'responded', output, model: selected.model, attempt, duration_ms: Date.now() - start });
          return output;
        } catch (error) {
          emit({ node, state: 'error', error: safeError(error), attempt, duration_ms: Date.now() - start });
          if (attempt === 3 || !transientAIError(error) || signal?.aborted) throw error;
          emit({ node, state: 'retry', attempt });
          await this.wait(500 * 2 ** (attempt - 1));
        }
      }
      throw Error('ai_retry_limit');
    };
    const tools: AITools = {
      execute: async (name, query) => {
        guard();
        const start = Date.now();
        emit({ node: name, state: 'running', input: query });
        try {
          let result: unknown;
          // Tool pendidikan menjawab dari data simulasi; kirim_dokumen hanya mencatat apa yang akan dikirim sungguhan.
          if (snapshot && eduToolNames.includes(name as EduToolName)) {
            result = eduTool(name as EduToolName, query, snapshot, sandbox.documents);
            if (name === 'kirim_dokumen' && (result as { available?: boolean }).available)
              sandbox.documents.push((result as { nama_file: string }).nama_file);
          } else if (edu) throw bad('Tool tidak tersedia untuk profil ini.');
          else if (name === 'get_knowledge') result = { knowledge };
          else if (name === 'get_products')
            result = {
              products: products
                .filter(
                  p => p.active && (!query || `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())),
                )
                .map(productForAI),
            };
          else if (name === 'check_order')
            result = { order: orderForAI(sandbox.orders.find(o => o.id === query.trim()) ?? null) };
          else if (name === 'send_product_image') {
            // Simulasi tidak pernah mengirim media WhatsApp; ini hanya melaporkan apakah kiriman sungguhan akan
            // menemukan foto.
            const p = products.find(p => p.name === query.trim());
            result = p?.image_id
              ? { available: true, product_name: p.name, image_id: p.image_id }
              : { available: false, reason: 'Produk tidak ditemukan atau belum memiliki foto' };
          } else {
            if (sandbox.orders.length >= 50) throw bad('Batas 50 pesanan simulasi tercapai. Mulai percakapan baru.');
            let value: unknown;
            try {
              value = JSON.parse(query);
            } catch {
              throw bad('Input order harus JSON.');
            }
            const order = orderInput(value),
              items = order.items.map(item => {
                const p = products.find(p => p.name === item.product_name && p.active);
                if (!p || p.stock < item.quantity) throw bad('Produk tidak tersedia atau stok tidak cukup.');
                return { ...item, price: p.price };
              });
            const created: Order = {
              id: 'SIM-' + (sandbox.orders.length + 1),
              customer: '628000000000',
              items,
              total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
              status: 'pesanan_masuk',
              notes: order.notes,
            };
            sandbox.orders.push(created);
            result = { order: orderForAI(created) };
          }
          emit({ node: name, state: 'done', output: result, duration_ms: Date.now() - start });
          return result;
        } catch (error) {
          emit({
            node: name,
            state: 'error',
            error: error instanceof ApiError ? error.message : safeError(error),
            duration_ms: Date.now() - start,
          });
          throw error;
        }
      },
    };
    try {
      emit({
        node: 'input',
        state: 'done',
        input: message,
        session: id,
        revision: state.revision,
        context: sandbox.context,
      });
      emit({ node: 'memory', state: 'done', output: { messages: sandbox.messages, router_context: sandbox.context } });
      emit({ node: 'router_memory', state: 'done', output: { context: sandbox.context } });
      const priorHistory = sandbox.messages.slice(-base.context_memory_limit);
      sandbox.messages = [...sandbox.messages, { role: 'user' as const, content: message }].slice(-base.memory_limit);
      const system: AIMessage[] = [
        {
          role: 'system',
          content:
            pipeline.id !== 'cs'
              ? pipeline.pipeline.system
              : 'Jawab sebagai asisten bisnis berdasarkan pengetahuan yang diberikan. Jangan mengarang fakta. Jika tidak tahu, arahkan pelanggan ke admin. Balas maksimal 300 kata.',
        },
        ...(behavior ? [{ role: 'system' as const, content: behavior }] : []),
      ];
      const sentBefore = sandbox.documents.length;
      const result = await runAgents(
        transport,
        config,
        [...system, ...sandbox.messages],
        300,
        {
          account: owner,
          profile: 'studio',
          session: 'studio',
          customer: '628000000000',
          requestId: randomUUID(),
          knowledge,
          behavior,
          identity,
          sentDocuments: sandbox.documents,
        },
        tools,
        sandbox.context,
        pipeline.pipeline,
      );
      let context: string | null = null;
      try {
        context = await updateRouterContext(
          transport,
          config,
          message,
          result.answer,
          base.context_memory_limit > 0 ? priorHistory : [],
          pipeline.pipeline,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        emit({ node: 'context', state: 'error', error: safeError(error) });
      }
      if (signal?.aborted) throw Error('ai_cancelled');
      sandbox.context = context;
      sandbox.messages = [
        ...sandbox.messages,
        ...sandbox.documents
          .slice(sentBefore)
          .map(file => ({ role: 'assistant' as const, content: documentMarker(file) })),
        { role: 'assistant' as const, content: result.answer },
      ].slice(-base.memory_limit);
      emit({ node: 'router_memory', state: 'done', output: { context } });
      emit({ node: 'memory', state: 'done', output: { messages: sandbox.messages } });
      emit({
        node: 'output',
        state: 'done',
        output: {
          answer: result.answer,
          agent: result.agent,
          context,
          orders: sandbox.orders,
          documents: sandbox.documents.slice(sentBefore),
        },
        duration_ms: Date.now() - started,
        session: id,
      });
    } catch (error) {
      emit({ node: 'output', state: 'error', error: safeError(error), duration_ms: Date.now() - started, session: id });
    } finally {
      sandbox.touched = Date.now();
      this.busy.delete(owner);
    }
  }
}
export const studio = new AIStudio();
