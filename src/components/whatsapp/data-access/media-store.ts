import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {ApiError} from '../../../libraries/errors.js';
import type { IncomingMessage } from '../domain/incoming.js';

export class MediaStore {
  private writing:Promise<unknown>=Promise.resolve();
  private pending=0;
  constructor(public root: string, private baseUrl: string, private maxBytes = 32 * 1024 * 1024, private retentionDays = 7, private maxStoredBytes = 256 * 1024 * 1024) {}
  save(sessionId:string,message:IncomingMessage){
    if(this.pending>=8)return Promise.reject(new ApiError(503,'media_queue_full','Antrean media masuk penuh'));
    this.pending++;
    const work=this.writing.catch(()=>{}).then(()=>this.saveNow(sessionId,message));
    this.writing=work;
    return work.finally(()=>{this.pending--;});
  }
  async flush(){await this.writing.catch(()=>{});}
  private async saveNow(sessionId: string, message: IncomingMessage) {
    if (!message.download) return null;
    const id = createHash('sha256').update(`${sessionId}\0${message.messageId}`).digest('hex');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    let stored=0;for(const name of await readdir(this.root)){if(/^[a-f0-9]{64}$/.test(name))stored+=(await stat(join(this.root,name))).size;}
    const remaining=this.maxStoredBytes-stored;
    if(remaining<=0)throw new ApiError(409,'media_storage_full','Penyimpanan media akun penuh');
    const temporary = join(this.root, `${id}.${randomUUID()}.part`);
    let size = 0;
    const limit = new Transform({ transform: (chunk, _encoding, callback) => {
      size += chunk.length;
      callback(size > Math.min(this.maxBytes,remaining) ? new Error('Media terlalu besar') : null, chunk);
    } });
    const mimetype = /^[\w.+-]+\/[\w.+-]+$/.test(message.mimetype ?? '') ? message.mimetype! : 'application/octet-stream';
    try {
      await pipeline(await message.download(), limit, createWriteStream(temporary, { mode: 0o600, flags: 'wx' }),{signal:AbortSignal.timeout(30000)});
      await rename(temporary, join(this.root, id));
      await writeFile(join(this.root, `${id}.json`), JSON.stringify({ mimetype }), { mode: 0o600 });
    } finally { await rm(temporary, { force: true }); }
    return { url: `${this.baseUrl.replace(/\/$/, '')}/media/${id}`, mimetype };
  }
  async prune() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}(?:\.json|\.[a-f0-9-]+\.part)?$/.test(name)) continue;
      const path = join(this.root, name);
      try {
        if (Date.now() - (await stat(path)).mtimeMs >= this.retentionDays * 86400_000) await rm(path, { force: true });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  async get(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, 'media_not_found', 'Media tidak ada');
    try {
      const path = join(this.root, id);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs >= this.retentionDays * 86400_000) throw new Error('expired');
      const { mimetype } = JSON.parse(await readFile(`${path}.json`, 'utf8'));
      return { path, mimetype: typeof mimetype === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(mimetype) ? mimetype : 'application/octet-stream' };
    } catch { throw new ApiError(404, 'media_not_found', 'Media tidak ada atau sudah kedaluwarsa'); }
  }
}
