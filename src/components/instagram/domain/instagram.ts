// Layanan Instagram DM lewat Zernio untuk gateway dan rute: konektor sesi, akun Zernio, alur hubungkan, webhook,
// dan kontak pelanggan. Gateway memasang `host` supaya layanan ini bisa memakai SessionManager tiap akun tanpa
// komponen whatsapp atau ai mengimpor komponen ini.
import { db } from '../../../libraries/db.js';
import type { Connector, SessionManager } from '../../whatsapp/index.js';
import { ChannelHub, channelConnector } from './channel-connection.js';
import { connectInstagram, reconnectInstagram } from './connect-flow.js';
import { receiveWebhook } from './webhook-events.js';
import * as accounts from './zernio-accounts.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as contactsSql from '../data-access/contacts-queries.js';

export interface InstagramHost {
  manager(account: string): Promise<SessionManager>;
  // Menghapus sesi beserta data AI-nya, sama seperti tombol Hapus di halaman Sesi.
  removeSession(account: string, session: string): Promise<void>;
}
export class Instagram {
  hub = new ChannelHub();
  host?: InstagramHost;
  connector(
    account: string,
    whatsapp: Connector,
    registerSystemMessage: (session: string, messageId: string) => Promise<void>,
  ) {
    return channelConnector(account, whatsapp, this.hub, registerSystemMessage);
  }
  zernioAccounts(account: string) {
    return accounts.listZernioAccounts(account);
  }
  addZernioAccount(account: string, body: unknown) {
    return accounts.addZernioAccount(account, body);
  }
  checkZernioAccount(account: string, id: string) {
    return accounts.checkZernioAccount(account, id);
  }
  replaceZernioKey(account: string, id: string, body: unknown) {
    return accounts.replaceZernioKey(account, id, body);
  }
  instagramAccounts(account: string, id: string) {
    return accounts.instagramAccounts(account, id);
  }
  async deleteZernioAccount(account: string, id: string) {
    for (const session of await accounts.sessionsOfZernioAccount(account, id))
      await this.requireHost().removeSession(account, session);
    return accounts.deleteZernioAccount(account, id);
  }
  async connect(account: string, body: unknown) {
    return connectInstagram(account, await this.requireHost().manager(account), body);
  }
  async reconnect(account: string, session: unknown) {
    return reconnectInstagram(account, await this.requireHost().manager(account), session);
  }
  receiveWebhook(zernioId: string, raw: Buffer, signature: unknown) {
    // Akun yang dihubungkan ulang di Zernio langsung menyambungkan lagi sesinya yang terputus.
    return receiveWebhook(this.hub, zernioId, raw, signature, async (account, session) => {
      const manager = await this.requireHost().manager(account);
      if (manager.list().find(s => s.id === session)?.status === 'logged_out') await manager.reconnect(session);
    });
  }
  async contacts(account: string, session: unknown) {
    if (typeof session !== 'string') return [];
    const [rows] = await contactsSql.listBySession(db, [account, session]);
    return rows;
  }
  // Dipanggil saat sesi dihapus: data kanal dan kontaknya ikut hilang; sesi WhatsApp tidak punya baris di sini.
  async forgetSession(account: string, session: string) {
    await contactsSql.deleteBySession(db, [account, session]);
    await channelsSql.deleteBySession(db, [account, session]);
  }
  private requireHost() {
    if (!this.host) throw new Error('Host Instagram belum dipasang');
    return this.host;
  }
}
export const instagram = new Instagram();
