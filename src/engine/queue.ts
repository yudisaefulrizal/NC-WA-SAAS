import { setTimeout } from 'node:timers/promises';
import { ApiError } from './sessions.js';

export class SendQueue {
  private tail = Promise.resolve();
  private nextAt = 0;
  private pending = 0;
  private abort = new AbortController();
  constructor(private intervalMs = 1000) {}
  run<T>(action: () => Promise<T>): Promise<T> {
    if (this.pending >= 256) return Promise.reject(new ApiError(503, 'queue_full', 'Antrean penuh; coba lagi nanti'));
    this.pending++;
    const job = this.tail.then(async () => {
      const remaining = this.nextAt - Date.now();
      if (remaining > 0) await setTimeout(remaining, undefined, { signal: this.abort.signal }).catch(() => {});
      if (this.abort.signal.aborted) throw new ApiError(409, 'session_not_connected', 'Session sudah ditutup');
      try { return await action(); }
      finally { this.nextAt = Date.now() + this.intervalMs; }
    });
    this.tail = job.then(() => {}, () => {}).finally(() => { this.pending--; });
    return job;
  }
  close() { this.abort.abort(); }
}
