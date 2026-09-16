import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager, type SessionInfo } from './sessions.js';

export class SessionStore {
  private writes = new Map<string, Promise<void>>();
  constructor(public root: string) {}
  directory(id: string) { SessionManager.validateId(id); return join(this.root, id); }
  async load(): Promise<SessionInfo[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const result: SessionInfo[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = this.directory(entry.name);
      const info = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')) as SessionInfo;
      if (info.id !== entry.name || !['connecting', 'connected', 'qr_required', 'logged_out'].includes(info.status)
        || !['all', 'private', 'group'].includes(info.filter)) throw new Error('Metadata session tidak valid');
      info.createdAt ??= (await stat(join(directory,'session.json'))).birthtimeMs;
      result.push(info);
    }
    return result;
  }
  save(info: SessionInfo) {
    const snapshot = JSON.stringify(info);
    const write = (this.writes.get(info.id) ?? Promise.resolve()).then(async () => {
      const directory = this.directory(info.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, 'session.json.tmp'), snapshot, { mode: 0o600 });
      await rename(join(directory, 'session.json.tmp'), join(directory, 'session.json'));
    });
    this.writes.set(info.id, write.catch(() => {}));
    return write;
  }
  async remove(id: string) {
    await this.writes.get(id);
    await rm(this.directory(id), { recursive: true, force: true });
    this.writes.delete(id);
  }
  async flush() { await Promise.all(this.writes.values()); }
}
