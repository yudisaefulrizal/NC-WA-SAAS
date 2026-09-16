import { log } from './log.js';
import { setTimeout } from 'node:timers/promises';

export type Payload = { event: string; sessionId: string; [key: string]: unknown };

export class Webhook {
  private abort = new AbortController();

  /**
   * `url` adalah webhook tetap dari env. `extra` menyumbang URL yang
   * didaftarkan client lewat API, dibaca tiap kirim supaya perubahan
   * langganan langsung berlaku tanpa menjalankan ulang engine.
   */
  constructor(
    private url = '',
    private send: typeof fetch = fetch,
    private retryMs = 1000,
    private extra: (payload: Payload) => string[] = () => [],
  ) {
    if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('WEBHOOK_URL harus HTTP atau HTTPS');
  }

  async post(payload: Payload) {
    const targets = [...new Set([...(this.url ? [this.url] : []), ...this.extra(payload)])];
    if (!targets.length) return;
    // Satu tujuan yang mati tidak boleh menahan yang lain.
    await Promise.all(targets.map(target => this.deliver(target, payload)));
  }

  private async deliver(target: string, payload: Payload) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (this.abort.signal.aborted) return;
      try {
        const response = await this.send(target, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), redirect: 'error',
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error('Webhook gagal');
        return;
      } catch {
        if (this.abort.signal.aborted) return;
        log(payload.sessionId, `Webhook gagal, percobaan ${attempt + 1}/4`);
        if (attempt === 3) return;
        await setTimeout(this.retryMs * 2 ** attempt, undefined, { signal: this.abort.signal }).catch(() => {});
      }
    }
  }

  stop() { this.abort.abort(); }
}
