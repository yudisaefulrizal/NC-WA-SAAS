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
  mimetype?: string;
  download?: () => Promise<Readable>;
}
function address(jid: string) {
  return jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : jid;
}
export function parseIncoming(message: WAMessage): IncomingMessage | undefined {
  const { key } = message;
  if (key.fromMe || !key.id || !key.remoteJid || key.remoteJid.endsWith('@broadcast') || key.remoteJid.endsWith('@newsletter')) return;
  const content = normalizeMessageContent(message.message);
  if (!content) return;
  const isGroup = key.remoteJid.endsWith('@g.us');
  const remote = key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? key.remoteJidAlt : key.remoteJid;
  const participant = key.participantAlt?.endsWith('@s.whatsapp.net') ? key.participantAlt : key.participant;
  const sender = isGroup ? participant : remote;
  if (!sender) return;
  const common = {
    messageId: key.id, from: address(remote), isGroup,
    groupId: isGroup ? key.remoteJid : null, sender: address(sender),
    timestamp: Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  };
  if (content.conversation != null || content.extendedTextMessage?.text != null) {
    return { ...common, type: 'text', text: content.conversation ?? content.extendedTextMessage!.text! };
  }
  for (const [type, media] of [
    ['image', content.imageMessage], ['document', content.documentMessage],
    ['audio', content.audioMessage], ['video', content.videoMessage],
  ] as const) {
    if (media) return { ...common, type, text: 'caption' in media ? media.caption ?? '' : '', mimetype: media.mimetype ?? 'application/octet-stream' };
  }
}
