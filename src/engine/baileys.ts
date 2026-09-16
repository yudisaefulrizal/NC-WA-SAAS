import { log, protectLibraryLogs } from './log.js';
import { parseIncoming, parseManualCandidate } from './incoming.js';
import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, generateMessageIDV2, type AnyMessageContent, type WAMessageKey } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { join } from 'node:path';
import { ApiError, type Connector } from './sessions.js';
import type { SessionStore } from './store.js';

// Baileys requires this interface. Suppress library traffic and credential logs.
const silentLogger = {
  level: 'silent', child() { return silentLogger; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {},
};
export function baileysConnector(store: SessionStore, registerSystemMessage: (session: string, messageId: string) => Promise<void>): Connector {
  protectLibraryLogs();
  return async (id, update) => {
    const { state, saveCreds } = await useMultiFileAuthState(join(store.directory(id), 'auth'));
    const socket = makeWASocket({ auth: state, logger: silentLogger, markOnlineOnConnect: false, syncFullHistory: false });
    let saves = Promise.resolve();
    socket.ev.on('creds.update', () => {
      saves = saves.then(saveCreds).catch(() => {
        log(id, `Gagal menyimpan kredensial`);
      });
    });
    const connectedAtSeconds = Math.floor(Date.now() / 1000);
    const messageKeys = new Map<string, WAMessageKey>();
    const seen = new Set<string>();
    socket.ev.on('messages.upsert', event => {
      if (event.type !== 'notify') return;
      for (let message of event.messages) {
        if (message.key.fromMe) {
          void (async()=>{
            if (message.key.remoteJid?.endsWith('@lid') && !message.key.remoteJidAlt) {
              const phone = await socket.signalRepository.lidMapping.getPNForLID(message.key.remoteJid);
              if (phone) message = { ...message, key: { ...message.key, remoteJidAlt: phone } };
            }
            const outgoing = parseManualCandidate(message, connectedAtSeconds);
            if (outgoing) update({ outgoing });
          })().catch(()=>log(id,'Gagal memeriksa pesan keluar manual'));
          continue;
        }
        const incoming = parseIncoming(message);
        if (!incoming) continue;
        const address = incoming.from.includes('@') ? incoming.from : `${incoming.from}@s.whatsapp.net`;
        messageKeys.set(`${address}:${incoming.messageId}`, message.key);
        if (messageKeys.size > 5000) messageKeys.delete(messageKeys.keys().next().value!);
        const key = `${message.key.remoteJid}:${incoming.messageId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
        if (incoming.type !== 'text') incoming.download = () => downloadMediaMessage(message, 'stream', {}, { logger: silentLogger, reuploadRequest: socket.updateMediaMessage });
        update({ incoming });
      }
    });
    let qrGeneration = 0;
    socket.ev.on('connection.update', event => {
      if (event.connection === 'open' || event.connection === 'close') qrGeneration++;
      if (event.qr) {
        const generation = ++qrGeneration;
        void QRCode.toDataURL(event.qr).then(qr => {
          if (generation === qrGeneration) update({ status: 'qr_required', qr });
        }).catch(() => log(id, `Gagal membuat QR`));
      }
      if (event.connection === 'open') update({ status: 'connected', phone: socket.user?.id.split(':')[0].split('@')[0] });
      if (event.connection === 'close') {
        const error = event.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        update({ disconnected: error?.output?.statusCode ?? 0 });
      }
    });
    return {
      async typing(jid, state) {
        await socket.sendPresenceUpdate('available');
        await socket.sendPresenceUpdate(state, jid);
      },
      async read(jid, messageId, sender) {
        const cached = messageKeys.get(`${jid}:${messageId}`);
        if (jid.endsWith('@g.us') && !cached && !sender) throw new ApiError(400, 'invalid_request', 'sender wajib untuk pesan grup yang belum dikenal setelah restart');
        await socket.readMessages([cached ?? { remoteJid: jid, id: messageId, fromMe: false, participant: sender }]);
      },
      async exists(jid) { return Boolean((await socket.onWhatsApp(jid))?.some(result => result.exists)); },
      async send(jid, content) {
        let outgoing: AnyMessageContent;
        if ('text' in content) outgoing = { ...content, linkPreview: null };
        else {
          const media = { url: content.url };
          switch (content.type) {
            case 'image': outgoing = { image: media, caption: content.caption }; break;
            case 'video': outgoing = { video: media, caption: content.caption }; break;
            case 'audio': outgoing = { audio: media, mimetype: content.mimetype ?? 'audio/mpeg' }; break;
            case 'document': outgoing = { document: media, caption: content.caption, fileName: content.filename ?? 'document', mimetype: content.mimetype ?? 'application/octet-stream' }; break;
          }
        }
        const messageId = generateMessageIDV2(socket.user?.id);
        // Persist before network dispatch: even an early echo or a restart is recognized.
        await registerSystemMessage(id, messageId);
        const message = await socket.sendMessage(jid, outgoing, { messageId });
        if (!message?.key.id) throw new Error('WhatsApp tidak memberikan ID pesan');
        return message.key.id;
      },
      async close() { qrGeneration++; socket.ev.removeAllListeners('connection.update'); socket.ev.removeAllListeners('messages.upsert'); socket.end(undefined); await saves; },
      async logout() { await socket.logout(); await saves; },
    };
  };
}
