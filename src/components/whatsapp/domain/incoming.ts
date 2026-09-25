// Mengubah pesan mentah Baileys menjadi IncomingMessage: pesan masuk dari pelanggan, dan pesan keluar yang
// diketik manual dari HP.
import { normalizeMessageContent, type WAMessage } from '@whiskeysockets/baileys';
import type { Readable } from 'node:stream';
import type { MediaType } from './messages.js';

export interface IncomingMessage {
  messageId: string;
  from: string;
  isGroup: boolean;
  groupId: string | null;
  sender: string;
  type: 'text' | MediaType;
  text: string;
  timestamp: number;
  quotedMessageId?: string;
  mimetype?: string;
  download?: () => Promise<Readable>;
}
function address(jid: string) {
  return jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : jid;
}
export function parseIncoming(message: WAMessage): IncomingMessage | undefined {
  const { key } = message;
  if (
    key.fromMe ||
    !key.id ||
    !key.remoteJid ||
    key.remoteJid.endsWith('@broadcast') ||
    key.remoteJid.endsWith('@newsletter')
  )
    return;
  const content = normalizeMessageContent(message.message);
  if (!content) return;
  const isGroup = key.remoteJid.endsWith('@g.us');
  const remote = key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? key.remoteJidAlt : key.remoteJid;
  const participant = key.participantAlt?.endsWith('@s.whatsapp.net') ? key.participantAlt : key.participant;
  const sender = isGroup ? participant : remote;
  if (!sender) return;
  const common = {
    messageId: key.id,
    from: address(remote),
    isGroup,
    groupId: isGroup ? key.remoteJid : null,
    sender: address(sender),
    timestamp: Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    quotedMessageId: content.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
  };
  if (content.conversation != null || content.extendedTextMessage?.text != null) {
    return { ...common, type: 'text', text: content.conversation ?? content.extendedTextMessage!.text! };
  }
  for (const [type, media] of [
    ['image', content.imageMessage],
    ['document', content.documentMessage],
    ['audio', content.audioMessage],
    ['video', content.videoMessage],
  ] as const) {
    if (media)
      return {
        ...common,
        type,
        text: 'caption' in media ? (media.caption ?? '') : '',
        mimetype: media.mimetype ?? 'application/octet-stream',
      };
  }
}

// Hanya isi chat keluar yang baru (bukan pembaruan protokol) yang bisa dianggap balasan manual. Pesan grup
// tetap diteruskan supaya Auto Share bisa mengenali perintah "tambah" dari pemilik sesi.
export function parseManualCandidate(message: WAMessage, connectedAtSeconds: number): IncomingMessage | undefined {
  if (!message.key.fromMe || Number(message.messageTimestamp ?? 0) < connectedAtSeconds) return;
  const content = normalizeMessageContent(message.message);
  const supported =
    content &&
    [
      ['stiker', content.stickerMessage],
      ['kontak', content.contactMessage ?? content.contactsArrayMessage],
      ['lokasi', content.locationMessage ?? content.liveLocationMessage],
      ['polling', content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3],
    ].find(([, value]) => value);
  const key = { ...message.key, fromMe: false };
  if (key.remoteJid?.endsWith('@g.us') && !key.participant && !key.participantAlt) key.participant = key.remoteJid;
  const parsed = parseIncoming({
    ...message,
    key,
    message: supported ? { conversation: `[Pesan ${supported[0]} manual]` } : message.message,
  });
  if (!parsed || (!parsed.isGroup && !/^[1-9][0-9]{5,14}$/.test(parsed.from))) return;
  return parsed;
}
