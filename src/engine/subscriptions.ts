import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { validatePublicUrl } from './download.js';
import { ApiError, SessionManager } from './sessions.js';

export interface Subscription {
  id: string;
  url: string;
  sessionId: string | null;
}

export const MAX_SUBSCRIPTIONS = 20;

/**
 * Langganan webhook yang didaftarkan client lewat API.
 *
 * Terpisah dari `WEBHOOK_URL` di env: yang itu milik pemasang engine, tidak
 * muncul di daftar dan tidak bisa dicabut client.
 */
export class Subscriptions {
  private items: Subscription[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(private file: string) {}

  async load() {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch { this.items = []; return; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Daftar webhook tidak valid'); }
    if (!Array.isArray(parsed)) throw new Error('Daftar webhook tidak valid');
    this.items = parsed.map(entry => {
      const item = entry as Partial<Subscription>;
      if (typeof item.id !== 'string' || typeof item.url !== 'string'
        || (item.sessionId !== null && typeof item.sessionId !== 'string')) {
        throw new Error('Daftar webhook tidak valid');
      }
      return { id: item.id, url: item.url, sessionId: item.sessionId ?? null };
    });
  }

  list(): Subscription[] {
    return this.items.map(item => ({ ...item }));
  }

  /**
   * Mendaftarkan URL. Aman diulang: URL yang sama dengan penyaring session yang
   * sama mengembalikan langganan yang sudah ada, bukan membuat duplikat —
   * alat otomatis mendaftar ulang tiap kali workflow-nya diaktifkan.
   */
  async add(body: unknown): Promise<Subscription> {
    const input = (body ?? {}) as Record<string, unknown>;
    if (typeof input.url !== 'string' || !input.url.trim()) {
      throw new ApiError(400, 'invalid_request', 'url wajib diisi');
    }
    let sessionId: string | null = null;
    if (input.sessionId !== undefined && input.sessionId !== null) {
      if (typeof input.sessionId !== 'string') throw new ApiError(400, 'invalid_request', 'sessionId harus teks');
      SessionManager.validateId(input.sessionId);
      sessionId = input.sessionId;
    }

    let url: string;
    try { url = (await validatePublicUrl(input.url)).url.href; }
    catch { throw new ApiError(400, 'invalid_request', 'url webhook harus menuju alamat HTTP/HTTPS publik'); }

    const existing = this.items.find(item => item.url === url && item.sessionId === sessionId);
    if (existing) return { ...existing };

    if (this.items.length >= MAX_SUBSCRIPTIONS) {
      throw new ApiError(409, 'too_many_webhooks', `Maksimal ${MAX_SUBSCRIPTIONS} webhook terdaftar`);
    }

    const created: Subscription = { id: `wh_${randomUUID().replace(/-/g, '').slice(0, 12)}`, url, sessionId };
    this.items.push(created);
    await this.save();
    return { ...created };
  }

  async remove(id: string) {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) throw new ApiError(404, 'webhook_not_found', 'Webhook tidak terdaftar');
    this.items.splice(index, 1);
    await this.save();
    return { deleted: true };
  }

  /** URL yang harus menerima event ini, setelah disaring per session. */
  targets(sessionId: string): string[] {
    return this.items
      .filter(item => item.sessionId === null || item.sessionId === sessionId)
      .map(item => item.url);
  }

  private save() {
    const snapshot = JSON.stringify(this.items);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    return this.writing;
  }

  async flush() { await this.writing.catch(() => {}); }
}
