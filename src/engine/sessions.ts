import { log } from './log.js';
import type { IncomingMessage } from './incoming.js';
import { SendQueue } from './queue.js';
import type { Outbound } from './messages.js';
import type { SessionStore } from './store.js';
export type Status = 'qr_required' | 'connecting' | 'connected' | 'logged_out';
export interface SessionInfo {
  id: string;
  createdAt?: number;
  serviceActive?: boolean;
  status: Status;
  phone: string | null;
  filter: 'all' | 'private' | 'group';
}
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface Connection {
  close(): void | Promise<void>;
  logout(): Promise<void>;
  typing?(jid: string, state: 'composing' | 'paused'): Promise<void>;
  read?(jid: string, messageId: string, sender?: string): Promise<void>;
  send?(jid: string, content: Outbound): Promise<string>;
  exists?(jid: string): Promise<boolean>;
}
export type Receipt = { messageId: string; to: string; status: 'sent' | 'delivered' | 'read' };
export interface Update { outgoing?: IncomingMessage; incoming?: IncomingMessage; receipt?: Receipt; status?: Status; phone?: string; qr?: string; disconnected?: number }
export type Connector = (id: string, update: (event: Update) => void) => Promise<Connection>;
interface Session extends SessionInfo {
  qr: string | null;
  connection?: Connection;
  generation: number;
  opening?: Promise<void>;
  mutation?: Promise<unknown>;
  retry?: ReturnType<typeof setTimeout>;
  attempts?: number;
  suspended?: boolean;
}

export class SessionManager {
  protected sessions = new Map<string, Session>();
  private stopped = false;
  private started = Date.now();
  private sent = 0;
  private received = 0;
  private activity=new Set<Promise<unknown>>();
  onBeforeSend?: () => Promise<void>;
  private limiting: Promise<void> = Promise.resolve();
  onEvent?: (event: { event: string; sessionId: string; [key: string]: unknown }) => Promise<void>;
  onOutgoing?: (session: SessionInfo, message: IncomingMessage) => Promise<void>;
  onSent?: (session: SessionInfo, message: { messageId: string; to: string; content: Outbound }) => Promise<void>;
  onReceipt?: (session: SessionInfo, receipt: Receipt) => Promise<void>;
  onIncoming?: (session: SessionInfo, message: IncomingMessage) => Promise<void>;
  private queues = new WeakMap<Session, SendQueue>();
  constructor(protected connect: Connector, protected store?: SessionStore, private retryBaseMs = 1000, private sendIntervalMs = 1000) {}
  async restore(limit=Infinity) {
    const saved=(await this.store?.load() ?? []).sort((a,b)=>(b.createdAt??0)-(a.createdAt??0)||b.id.localeCompare(a.id));
    for (const [index, info] of saved.entries()) {
      info.serviceActive=index<limit;
      const session: Session = { ...info, qr: null, generation: 0 };
      this.sessions.set(info.id, session);
      if (info.serviceActive && info.status !== 'logged_out') {
        session.status = 'connecting';
        await this.open(session).catch(() => this.schedule(session));
      }
    }
  }
  protected persist(session: Session) {
    return this.store?.save(this.detail(session.id)) ?? Promise.resolve();
  }

  static validateId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      throw new ApiError(400, 'invalid_request', 'ID harus 1–64 karakter huruf, angka, garis bawah, atau tanda hubung');
    }
  }
  protected get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new ApiError(404, 'session_not_found', `Session ${id} tidak ada`);
    return session;
  }
  detail(id: string): SessionInfo {
    const { status, phone, filter, createdAt, serviceActive } = this.get(id);
    return { id, status, phone, filter, createdAt, serviceActive: serviceActive!==false };
  }
  qr(id: string) { const session=this.get(id);this.active(session);const { status, qr } = session; return { status, qr }; }
  list() { return [...this.sessions.keys()].map(id => this.detail(id)); }
  async create(id: unknown) {
    SessionManager.validateId(id);
    if (this.stopped) throw new ApiError(503, 'unavailable', 'Engine sedang berhenti');
    if (this.sessions.has(id)) throw new ApiError(409, 'session_exists', `Session ${id} sudah ada`);
    const session: Session = { id, createdAt: Date.now(), serviceActive: true, status: 'connecting', phone: null, filter: 'private', qr: null, generation: 0 };
    this.sessions.set(id, session);
    const initialize = async () => {
      await this.persist(session);
      if (!session.suspended && !this.stopped) await this.openConnection(session).catch(() => this.schedule(session));
    };
    session.opening = initialize();
    try { await session.opening; }
    catch (error) { this.sessions.delete(id); throw error; }
    return this.detail(id);
  }
  stats() {
    const sessions: Record<string, number> = { total: this.sessions.size, active: 0, inactive: 0, connected: 0, logged_out: 0, connecting: 0, qr_required: 0 };
    for (const session of this.sessions.values()) {if(session.serviceActive===false)sessions.inactive++;else{sessions.active++;sessions[session.status]++;}}
    return { uptime: Math.floor((Date.now() - this.started) / 1000), sessions, messages: { sent: this.sent, received: this.received } };
  }
  async typing(id: string, jid: string, state: unknown) {
    if (state !== 'composing' && state !== 'paused') throw new ApiError(400, 'invalid_request', 'state harus composing atau paused');
    const connection = this.connected(id);
    try {
      if (!connection.typing) throw new Error('Transport tidak mendukung presence');
      await connection.typing(jid, state);
      return { ok: true };
    } catch { throw new ApiError(502, 'send_failed', 'Gagal memperbarui presence'); }
  }
  async read(id: string, jid: string, messageId: string, sender?: string) {
    const connection = this.connected(id);
    try {
      if (!connection.read) throw new Error('Transport tidak mendukung read');
      await connection.read(jid, messageId, sender);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'send_failed', 'Gagal menandai pesan dibaca');
    }
  }
  async setFilter(id: string, filter: unknown) {
    if (filter !== 'all' && filter !== 'private' && filter !== 'group') throw new ApiError(400, 'invalid_request', 'filter harus all, private, atau group');
    return this.mutate(id, async session => {
      this.active(session);
      const previous = session.filter;
      session.filter = filter;
      try { await this.persist(session); } catch (error) { session.filter = previous; throw error; }
      return { id, filter };
    });
  }
  connected(id: string) {
    const session = this.get(id);
    if (this.stopped) throw new ApiError(503, 'unavailable', 'Engine sedang berhenti');
    if (session.serviceActive===false) throw new ApiError(409, 'session_inactive', `Nomor nonaktif karena batas paket`);
    if (session.suspended) throw new ApiError(409, 'session_suspended', `Session ${id} sedang ditangguhkan`);
    if (session.status !== 'connected') throw new ApiError(409, 'session_not_connected', `Session ${id} belum tersambung (status: ${session.status})`);
    if (!session.connection) throw new ApiError(409, 'session_not_connected', `Session ${id} tidak memiliki koneksi aktif`);
    return session.connection;
  }
  async send(id: string, jid: string, content: Outbound, beforeSend?:()=>Promise<void>) {
    log(id, `Request kirim pesan ke ${jid}`);
    this.connected(id);
    const session = this.get(id);
    let queue = this.queues.get(session);
    if (!queue) { queue = new SendQueue(this.sendIntervalMs); this.queues.set(session, queue); }
    return queue.run(() => {
      if (this.sessions.get(id) !== session) {
        log(id, `Session sudah diganti saat di queue`);
        throw new ApiError(409, 'session_not_connected', 'Session sudah diganti');
      }
      return this.sendNow(id, jid, content, beforeSend);
    });
  }
  private async sendNow(id: string, jid: string, content: Outbound, beforeSend?:()=>Promise<void>) {
    await this.onBeforeSend?.();
    const connection = this.connected(id);
    try {
      log(id, `Mengirim pesan ke ${jid}`);
      if (!jid.endsWith('@g.us') && connection.exists && !await connection.exists(jid)) throw new ApiError(400, 'invalid_number', 'Nomor tidak terdaftar di WhatsApp');
      if (!connection.send) throw new Error('Transport tidak mendukung pengiriman');
      await beforeSend?.();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let messageId: string;
      try {
        messageId = await Promise.race([
          connection.send(jid, content),
          new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 30_000); }),
        ]);
      } catch { throw new ApiError(502, 'send_unknown', 'Hasil pengiriman belum pasti; jangan kirim ulang otomatis'); }
      finally { clearTimeout(timeout); }
      this.sent++;
      log(id, `Pesan berhasil dikirim: ${messageId}`);
      this.track(this.onSent?.(this.detail(id), { messageId, to: jid, content }), id);
      return { messageId, to: jid };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      log(id, `Gagal mengirim: ${error instanceof Error ? error.message : String(error)}`);
      throw new ApiError(502, 'send_failed', 'Gagal mengirim ke WhatsApp');
    }
  }
  private async mutate<T>(id: string, action: (session: Session) => Promise<T>): Promise<T> {
    const session = this.get(id);
    const task = (session.mutation ?? Promise.resolve()).catch(() => {}).then(() => {
      if (this.sessions.get(id) !== session) throw new ApiError(404, 'session_not_found', `Session ${id} tidak ada`);
      return action(session);
    });
    session.mutation = task;
    return task;
  }
  async logout(id: string) {
    return this.mutate(id, async session => {
      this.active(session);
      session.suspended = true;
      clearTimeout(session.retry);
      await session.opening?.catch(() => {});
      if (session.status !== 'logged_out') {
        // Let WhatsApp confirm the unlink before discarding the working connection.
        try {
          if (!session.connection) throw new Error('Tidak ada koneksi');
          await session.connection.logout();
        }
        catch {
          session.suspended = false;
          if (session.status === 'connecting') this.schedule(session);
          throw new ApiError(502, 'logout_failed', 'Logout gagal; coba lagi setelah koneksi pulih');
        }
        this.queues.get(session)?.close();
        session.generation++;
        await session.connection?.close();
        session.connection = undefined;
        this.status(session, 'logged_out', 'logout API');
        session.phone = null;
        session.qr = null;
        await this.persist(session);
      }
      return { id, status: session.status };
    });
  }
  async reconnect(id: string) {
    return this.mutate(id, async session => {
      this.active(session);
      if (session.status !== 'logged_out') {
        throw new ApiError(409, 'session_not_connected', `Session ${id} bukan logged_out; logout dahulu untuk memasang ulang`);
      }
      if (this.stopped) throw new ApiError(503, 'unavailable', 'Engine sedang berhenti');
      clearTimeout(session.retry);
      this.queues.get(session)?.close();
      session.generation++;
      await session.opening?.catch(() => {});
      await session.connection?.close();
      session.connection = undefined;
      // Kredensial lama sudah dicabut WhatsApp; mulai dari nol agar QR baru terbit.
      await this.store?.remove(id);
      session.suspended = false;
      session.phone = null;
      session.qr = null;
      this.status(session, 'connecting', 'pasang ulang');
      await this.persist(session);
      session.opening = this.open(session).catch(() => this.schedule(session));
      await session.opening;
      return { id, status: session.status };
    });
  }
  async remove(id: string) {
    return this.mutate(id, async session => {
      session.suspended = true;
      clearTimeout(session.retry);
      this.queues.get(session)?.close();
      session.generation++;
      await session.opening?.catch(() => {});
      await session.connection?.close();
      await this.store?.remove(id);
      this.sessions.delete(id);
      return { deleted: true };
    });
  }
  protected open(session: Session) {
    const opening = this.openConnection(session);
    session.opening = opening;
    return opening;
  }
  private async openConnection(session: Session) {
    const generation = ++session.generation;
    const connection = await this.connect(session.id, update => {
      if (this.sessions.get(session.id) !== session || generation !== session.generation) {
        log(session.id, `Update diabaikan: session diganti atau generation berubah (gen=${generation} vs ${session.generation})`);
        return;
      }
      if (update.outgoing) {
        this.track(this.onOutgoing?.(this.detail(session.id), update.outgoing),session.id);
        return;
      }
      if (update.receipt) {
        this.track(this.onReceipt?.(this.detail(session.id), update.receipt),session.id);
        return;
      }
      if (update.incoming) {
        this.received++;
        if ((session.filter === 'private' && update.incoming.isGroup) || (session.filter === 'group' && !update.incoming.isGroup)) return;
        if(this.activity.size<32)this.track(this.onIncoming?.(this.detail(session.id), update.incoming),session.id);
        else log(session.id,'Antrean event masuk penuh');
        return;
      }
      if (update.disconnected !== undefined) {
        log(session.id, `Koneksi putus dengan kode: ${update.disconnected}`);
        session.generation++;
        session.qr = null;
        if (update.disconnected === 401) {
          this.status(session, 'logged_out', 'device dihapus');
          session.phone = null;
        } else {
          this.status(session, 'connecting', `koneksi putus ${update.disconnected}`);
          this.schedule(session, update.disconnected === 515);
        }
      }
      if (update.status) this.status(session, update.status, 'update koneksi');
      if (update.status === 'connected') session.attempts = 0;
      if (update.phone) session.phone = update.phone;
      if (update.qr) { session.qr = update.qr; this.emit({ event: 'session.qr', sessionId: session.id, qr: update.qr }); }
      if (update.status === 'connected' || update.status === 'logged_out') session.qr = null;
      void this.persist(session).catch(() => log(session.id, `Gagal menyimpan metadata`));
    });
    if (generation !== session.generation) {
      log(session.id, `Koneksi ditutup karena generation berubah`);
      await connection.close();
    }
    else session.connection = connection;
  }
  private status(session: Session, status: Status, reason: string) {
    if (session.status !== status) log(session.id, `${session.status} → ${status}: ${reason}`);
    const changed = session.status !== status;
    session.status = status;
    if (changed) queueMicrotask(() => this.emit({ event: 'session.status', sessionId: session.id, status, phone: session.phone }));
  }
  private emit(event: { event: string; sessionId: string; [key: string]: unknown }) {
    if(!this.stopped)this.track(this.onEvent?.(event),event.sessionId);
  }
  private track(pending:Promise<unknown>|undefined,id:string){if(!pending)return;const task=pending.catch(()=>log(id,'Pemrosesan event gagal')).finally(()=>this.activity.delete(task));this.activity.add(task);}
  private schedule(session: Session, immediate = false) {
    if (this.stopped || session.suspended || session.serviceActive===false || session.status === 'logged_out' || this.sessions.get(session.id) !== session) return;
    clearTimeout(session.retry);
    const attempt = session.attempts = (session.attempts ?? 0) + 1;
    const delay = immediate ? 0 : Math.min(this.retryBaseMs * 2 ** Math.min(attempt - 1, 6), 30_000);
    log(session.id, `Reconnect percobaan ${attempt}, jeda ${delay}ms`);
    session.retry = setTimeout(() => {
      void (async () => {
        await session.opening?.catch(() => {});
        if (this.stopped || session.suspended || this.sessions.get(session.id) !== session || session.status === 'logged_out') return;
        await session.connection?.close();
        session.connection = undefined;
        if (this.stopped || session.suspended) return;
        await this.open(session);
      })().catch(() => {
        log(session.id, `Reconnect gagal`);
        this.schedule(session);
      });
    }, delay);
    session.retry.unref();
  }
  private active(session:Session){if(session.serviceActive===false)throw new ApiError(409,'session_inactive','Nomor nonaktif karena batas paket');}
  applyLimit(limit:number){
    const work=this.limiting.catch(()=>{}).then(async()=>{
      const sorted=[...this.sessions.values()].sort((a,b)=>(b.createdAt??0)-(a.createdAt??0)||b.id.localeCompare(a.id));
      for(const [index,session] of sorted.entries()){
        const active=index<limit;
        if((session.serviceActive!==false)===active)continue;
        await this.mutate(session.id,async current=>{
          current.serviceActive=active;
          if(!active){
            current.suspended=true;clearTimeout(current.retry);current.generation++;current.qr=null;
            this.queues.get(current)?.close();this.queues.delete(current);
            await current.opening?.catch(()=>{});await current.connection?.close();current.connection=undefined;
          }else if(!this.stopped&&current.status!=='logged_out'){
            current.suspended=false;current.status='connecting';await this.open(current).catch(()=>this.schedule(current));
          }
          await this.persist(current);
        });
      }
    });
    this.limiting=work;return work;
  }
  async stop() {
    this.stopped = true;
    for (const session of this.sessions.values()) {
      session.suspended = true;
      clearTimeout(session.retry);
      this.queues.get(session)?.close();
      session.generation++;
    }
    for (const session of this.sessions.values()) {
      await session.opening?.catch(() => {});
      await session.mutation?.catch(() => {});
      await session.connection?.close();
    }
    await Promise.all(this.activity);
    await this.store?.flush();
  }
}
