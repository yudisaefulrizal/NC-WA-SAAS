// Konektor sesi Instagram untuk SessionManager: sesi yang terdaftar di instagram_channels tersambung lewat Zernio,
// sesi lain diteruskan ke konektor WhatsApp. Pesan masuk tidak datang dari soket, tetapi dari webhook Zernio yang
// diteruskan ke sesi lewat ChannelHub.
import { digest } from '../../../libraries/security.js';
import { decrypt } from '../../../libraries/crypto.js';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import type { Connection, Connector, Update } from '../../whatsapp/index.js';
import { sendMessage } from './zernio-client.js';
import * as channelsSql from '../data-access/channels-queries.js';

// ID pesan Instagram (mid) bisa lebih panjang dari kolom riwayat chat, jadi diganti hash tetap. Kiriman dan
// gemanya dari webhook menghasilkan ID yang sama, sehingga kiriman sistem tetap dikenali.
export function messageIdOf(platformMessageId: string) {
  return 'ig_' + digest(platformMessageId).slice(0, 48);
}
// Callback pembaruan setiap sesi Instagram yang sedang terbuka, per akun dan sesi.
export class ChannelHub {
  private links = new Map<string, (event: Update) => void>();
  attach(account: string, session: string, update: (event: Update) => void) {
    this.links.set(account + '/' + session, update);
  }
  detach(account: string, session: string, update: (event: Update) => void) {
    if (this.links.get(account + '/' + session) === update) this.links.delete(account + '/' + session);
  }
  // Mengembalikan false bila sesinya tidak sedang terbuka (nonaktif karena paket, terputus, atau belum dimuat).
  emit(account: string, session: string, event: Update) {
    const update = this.links.get(account + '/' + session);
    if (!update) return false;
    update(event);
    return true;
  }
}
export function channelConnector(
  account: string,
  whatsapp: Connector,
  hub: ChannelHub,
  registerSystemMessage: (session: string, messageId: string) => Promise<void>,
): Connector {
  return async (id, update) => {
    const [rows] = await channelsSql.findBySession(db, [account, id]);
    const channel = rows[0];
    if (!channel) return whatsapp(id, update);
    hub.attach(account, id, update);
    if (channel.status === 'disconnected') update({ disconnected: 401 });
    else update({ status: 'connected', phone: '@' + channel.username });
    const connection: Connection = {
      close() {
        hub.detach(account, id, update);
      },
      // Keluar hanya memutus sesi di NC-WA; akun Instagram di Zernio milik klien tidak disentuh.
      async logout() {
        hub.detach(account, id, update);
      },
      async send(jid, content) {
        const recipient = jid.split('@')[0];
        if (jid.endsWith('@g.us') || !/^[0-9]{5,20}$/.test(recipient))
          throw new ApiError(400, 'invalid_number', 'Tujuan harus ID pengguna Instagram');
        // Kunci dibaca ulang setiap kirim, supaya kunci yang baru diganti langsung dipakai.
        const [current] = await channelsSql.findBySession(db, [account, id]);
        if (!current[0]) throw new ApiError(409, 'session_not_connected', 'Akun Instagram sudah dilepas');
        const key = decrypt(current[0].api_key);
        let platformId: string;
        if ('text' in content) platformId = await sendMessage(key, current[0].ig_account_id, recipient, content.text);
        else
          platformId = await sendMessage(key, current[0].ig_account_id, recipient, content.caption ?? '', {
            path: content.url,
            filename: content.filename,
          });
        const messageId = messageIdOf(platformId);
        // Gema kiriman ini (message.sent) bisa datang lewat webhook; dicatat supaya tidak dianggap balasan manual.
        await registerSystemMessage(id, messageId).catch(() => log(id, 'Gagal mencatat kiriman Instagram'));
        return messageId;
      },
    };
    return connection;
  };
}
