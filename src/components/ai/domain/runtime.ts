// Runtime WhatsApp: mengantrekan pesan masuk per pelanggan, menjalankan pipeline profil, menagih kredit, mengirim
// jawaban (beserta foto produk dan dokumen), dan menyimpan memori.
import { type ModelRole, type AgentWorkflow, type AITraceEvent } from './pipeline/models.js';
import { activeWorkflow } from './profiles/registry.js';
import { transientAIError } from './pipeline/retry.js';
import { runAgents, updateRouterContext } from './pipeline/runner.js';
import { eduData, documentMarker, sentDocuments } from './profiles/pendidikan/tools.js';
import { eduIdentity } from './profiles/pendidikan/profile.js';
import { randomInt, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { db } from '../../../libraries/db.js';
import { digest } from '../../../libraries/security.js';
import { type SessionManager } from '../../whatsapp/index.js';
import { ApiError } from '../../../libraries/errors.js';
import type { IncomingMessage } from '../../whatsapp/index.js';
import { basicWallet, sendBilled } from '../../billing/index.js';
import { recordOutgoing } from './chat.js';
import { AIMessage, defaults, provider, AITransport } from './provider.js';
import { text } from './input-validation.js';
import { countWords, aiFallback, creditCost } from './metering.js';
import { profileFields, ProfileField, composeKnowledge } from './profiles/cs/knowledge.js';
import { pipelines } from './profile-pipelines.js';
import { transaction, lockAccount } from './transaction.js';
import { parseMemory } from './memory.js';
import type { AIService } from './service.js';
import * as conversations from './conversations.js';
import * as agentFailuresSql from '../data-access/agent-failures-queries.js';
import * as assistantsSql from '../data-access/assistants-queries.js';
import * as conversationsSql from '../data-access/conversations-queries.js';
import * as fallbacksSql from '../data-access/fallbacks-queries.js';
import * as settingsSql from '../data-access/settings-queries.js';
import * as traceLogSql from '../data-access/trace-log-queries.js';
import * as usageSql from '../data-access/usage-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';
export function incoming(
  svc: AIService,
  account: string,
  manager: SessionManager,
  session: string,
  message: IncomingMessage,
) {
  if (message.isGroup || message.type !== 'text' || !message.text.trim() || !/^\d{5,20}$/.test(message.from))
    return Promise.resolve();
  const key = JSON.stringify([account, session, message.from]);
  if (svc.queued >= 128) return Promise.resolve();
  svc.queued++;
  const task = (svc.queues.get(key) ?? Promise.resolve())
    .then(async () => {
      if (!(await conversations.handleFallbackReply(svc, account, manager, session, message)))
        await handleMessage(svc, account, manager, session, message);
    })
    .catch(() => {
      console.error('Pemrosesan AI gagal; periksa riwayat penggunaan.');
    })
    .finally(() => {
      svc.queued--;
      if (svc.queues.get(key) === task) svc.queues.delete(key);
    });
  svc.queues.set(key, task);
  return task;
}
export async function stop(svc: AIService) {
  await Promise.all(svc.queues.values());
}
export async function recover(svc: AIService, account?: string) {
  // Di bawah kunci engine, panggilan yang terputus tidak diulang. Hasil provider yang tidak pasti tidak ditagihkan.
  await transaction(async c => {
    const [rows] = await usageSql.lockGenerating(c, account ? [account] : [], account);
    for (const row of rows) {
      await walletsSql.credit(c, [row.reserved, row.account_id]);
      await usageSql.markInterrupted(c, [row.account_id, row.request_id]);
    }
    await usageSql.resolveGenerated(c, account ? [account] : [], account);
  });
}
export async function handleMessage(
  svc: AIService,
  account: string,
  manager: SessionManager,
  session: string,
  message: IncomingMessage,
) {
  // Menjalankan pipeline profil milik data profil sesi, selama pemilik menyalakan profil itu.
  const config = await svc.config();
  if (!config.secret) return;
  const assistant = await svc.assistant(account, session),
    type = assistant.data_profile?.profile_type ?? '',
    pipeline = pipelines[type];
  if (!assistant.enabled || !pipeline || !assistant.profile_enabled) return;
  manager.connected(session);
  if ((await basicWallet(account)).balance < 1) return;
  const id = digest(JSON.stringify([session, message.from, message.messageId]));
  const prepared = await transaction(async c => {
    await lockAccount(c, account);
    const [existing] = await usageSql.findRequest(c, [account, id]);
    if (existing[0]) return;
    const [current] = await assistantsSql.findForRuntime(c, [account, session, type]);
    if (!current[0]?.enabled) return;
    // Knowledge CS diambil sekali di sini; tool pendidikan membaca data profil saat dijalankan.
    const knowledge =
      type === 'cs'
        ? composeKnowledge(
            Object.fromEntries(
              profileFields.map(field => [field, String(current[0]['profil_' + field] ?? '')]),
            ) as Record<ProfileField, string>,
          )
        : '';
    const identity = type === 'pendidikan' ? eduIdentity(String(current[0].name)) : undefined;
    const [limits] = await settingsSql.shareMemoryLimit(c);
    await conversationsSql.ensure(c, [account, session, message.from]);
    const [conversations] = await conversationsSql.lockForMessage(c, [account, session, message.from]);
    if (conversations[0].paused) return;
    if (message.text.length > 4000) return;
    const memory = [...parseMemory(conversations[0].messages), { role: 'user' as const, content: message.text }].slice(
      -(limits[0]?.memory_limit ?? config.memory_limit),
    );
    await walletsSql.ensure(c, [account]);
    const [wallet] = await walletsSql.findBalance(c, [account]);
    const [pending] = await fallbacksSql.findWaitingForCustomer(c, [account, session, message.from]);
    const fallbackNumber = String(current[0].fallback_number ?? '');
    const system: AIMessage[] = [
      { role: 'system', content: pipeline.system },
      ...([current[0].behavior] as string[]).filter(Boolean).map(content => ({ role: 'system' as const, content })),
    ];
    const messages = [...system, ...memory],
      inputWords = messages.reduce((sum, m) => sum + countWords(m.content), 0);
    // Instruksi sistem ikut dihitung; mengganti angka batasnya tidak mengubah jumlah katanya.
    const maxWords = Math.min(
      300,
      Math.floor((wallet[0].balance - inputWords * config.input_rate) / config.output_rate),
    );
    if (inputWords > 12000 || maxWords < 1) return;
    system[0].content = system[0].content.replace('300 kata', maxWords + ' kata');
    const reserved = creditCost(inputWords, maxWords, config.input_rate, config.output_rate);
    await walletsSql.debit(c, [reserved, account]);
    await usageSql.insertMessage(c, [
      account,
      id,
      session,
      message.from,
      inputWords,
      config.input_rate,
      config.output_rate,
      reserved,
      config.model,
      type,
      current[0].data_profile_id,
    ]);
    await conversationsSql.updateMessages(c, [JSON.stringify(memory), account, session, message.from]);
    return {
      messages,
      inputWords,
      reserved,
      maxWords,
      routerContext: conversations[0].router_context as string | null,
      revision: conversations[0].revision,
      knowledge,
      behavior: current[0].behavior as string,
      identity,
      pendingFallbacks: pending.map(row => ({ id: String(row.id), question: String(row.question) })),
      fallbackNumber,
      fallbackNotify: Boolean(current[0].fallback_notify),
      profileId: String(current[0].data_profile_id),
    };
  });
  if (!prepared) return;
  config.workflow = (await activeWorkflow(type)) as AgentWorkflow;
  const jid = message.from + '@s.whatsapp.net';
  // Urutan yang dilihat pelanggan: jeda singkat, centang biru, lalu "mengetik..." selama jawaban dibuat.
  // Status dibaca/mengetik tidak dijamin, dan tidak pernah menambah pesan atau tagihan kredit.
  await svc.wait(randomInt(200, 1001));
  await manager.read(session, jid, message.messageId).catch(() => {});
  await manager.typing(session, jid, 'composing').catch(() => {});
  // WhatsApp menghapus status "mengetik" setelah beberapa detik, jadi diperbarui terus sampai balasan terkirim.
  const typingRefresh = setInterval(() => {
    manager.typing(session, jid, 'composing').catch(() => {});
  }, 8000);
  typingRefresh.unref();
  let typingStopped = false;
  const stopTyping = async () => {
    if (typingStopped) return;
    typingStopped = true;
    clearInterval(typingRefresh);
    await manager.typing(session, jid, 'paused').catch(() => {});
  };
  try {
    // Pengaturan asisten (knowledge/perilaku/fallback) bisa tersimpan otomatis di tengah proses; request yang sedang
    // berjalan diselesaikan dengan pengaturan saat mulai, tidak dibatalkan setiap kali ada suntingan.
    // Mematikan asisten adalah satu-satunya perubahan pengaturan yang langsung membatalkan proses berjalan.
    // Mengganti data profil sesi, atau pemilik mematikan profilnya, juga membatalkan.
    const guard = async () => {
      const enabled = await svc.assistant(account, session);
      const [rows] = await conversationsSql.findPausedRevision(db, [account, session, message.from]);
      if (
        !enabled.enabled ||
        enabled.data_profile?.id !== prepared.profileId ||
        !enabled.profile_enabled ||
        rows[0]?.paused ||
        rows[0]?.revision !== prepared.revision
      )
        throw new ApiError(409, 'ai_cancelled', 'Asisten atau konteks percakapan telah berubah');
    };
    const modelCalls: { role: ModelRole | undefined; model: string; status: string; attempt: number }[] = [];
    const deadline = Date.now() + 120000;
    const retryPause = async (attempt: number) => {
      await svc.wait(500 * 2 ** attempt + randomInt(0, 251));
      await guard();
    };
    let lastMessages: AIMessage[] | undefined, lastModel: string | undefined;
    const trace = config.trace_enabled
      ? (event: AITraceEvent) => {
          traceLogSql
            .insert(db, [
              account,
              session,
              id,
              type,
              event.node.slice(0, 20),
              event.state.slice(0, 20),
              event.model?.slice(0, 100) ?? null,
              event.attempt ?? null,
              event.duration_ms ?? null,
              event.input !== undefined ? JSON.stringify(event.input).slice(0, 60000) : null,
              event.output !== undefined ? JSON.stringify(event.output).slice(0, 60000) : null,
              event.error?.slice(0, 200) ?? null,
            ])
            .catch(() => {});
        }
      : undefined;
    const trackedTransport: AITransport = async (selected, messages, maxWords) => {
      lastMessages = messages;
      lastModel = selected.model;
      const node = selected.call_role ?? 'model';
      for (let attempt = 0; attempt < 3; attempt++) {
        await guard();
        if (modelCalls.length >= 20 || Date.now() >= deadline) throw Error('ai_retry_limit');
        const entry = { role: selected.call_role, model: selected.model, status: 'failed', attempt: attempt + 1 };
        modelCalls.push(entry);
        trace?.({ node, state: 'running', input: messages, model: selected.model, attempt: attempt + 1 });
        try {
          const result = await svc.transport(selected, messages, maxWords);
          entry.status = 'responded';
          trace?.({ node, state: 'responded', output: result, model: selected.model, attempt: attempt + 1 });
          return result;
        } catch (error) {
          trace?.({
            node,
            state: 'error',
            error: error instanceof Error ? error.message : 'unknown_error',
            attempt: attempt + 1,
          });
          if (attempt === 2 || !transientAIError(error)) throw error;
          await retryPause(attempt);
        }
      }
      throw Error('ai_retry_limit');
    };
    let answer: string,
      agent: string | null = null,
      generationFailed = false,
      fallback: { reason: string; question: string } | undefined;
    let lastNode: string | undefined,
      lastTraceError: string | undefined,
      lastRawOutput: string | undefined,
      pendingImageId: string | undefined;
    // Dokumen yang dipilih lewat kirim_dokumen di giliran ini, dikirim sebelum jawaban; penanda di memori mencegah
    // pengiriman ulang.
    const alreadySent = sentDocuments(prepared.messages),
      pendingDocuments: { id: string; filename: string }[] = [];
    config.onTrace = event => {
      trace?.(event);
      if (event.node === 'router' && event.state === 'routed')
        lastNode = String((event.output as { sub_agent?: unknown })?.sub_agent ?? lastNode);
      if (event.error) {
        lastNode = event.node;
        lastTraceError = event.error;
        if (typeof event.output === 'string') lastRawOutput = event.output;
      }
    };
    try {
      const result = await runAgents(
        trackedTransport,
        config,
        prepared.messages,
        prepared.maxWords,
        {
          account,
          profile: prepared.profileId,
          session,
          customer: message.from,
          requestId: id,
          knowledge: prepared.knowledge,
          behavior: prepared.behavior,
          fallbackEnabled: true,
          pendingFallbacks: prepared.pendingFallbacks,
          identity: prepared.identity,
          sentDocuments: alreadySent,
        },
        {
          execute: async (name, query, base) => {
            await guard();
            const context = { ...base, sentDocuments: [...alreadySent, ...pendingDocuments.map(d => d.filename)] };
            const start = Date.now();
            trace?.({ node: name, state: 'running', input: query });
            try {
              let result = await svc.tools.execute(name, query, context);
              if (name === 'kirim_dokumen' && (result as { available?: boolean })?.available) {
                if (pendingDocuments.length >= 3)
                  result = { available: false, reason: 'Paling banyak tiga dokumen per jawaban.' };
                else
                  pendingDocuments.push({
                    id: (result as { document_id: string }).document_id,
                    filename: (result as { nama_file: string }).nama_file,
                  });
              }
              trace?.({ node: name, state: 'done', output: result, duration_ms: Date.now() - start });
              // Menentukan gambar hanyalah data; pengiriman WhatsApp terjadi setelah jawaban akhir pasti di bawah, jadi
              // langkah tool berikutnya atau pengulangan ai_invalid_tool tidak meninggalkan gambar terkirim untuk
              // giliran yang dibuang.
              if (name === 'send_product_image' && (result as { available?: boolean; image_id?: string })?.available)
                pendingImageId = (result as { image_id: string }).image_id;
              return result;
            } catch (error) {
              if (name === 'create_order' || !transientAIError(error) || Date.now() >= deadline) {
                trace?.({
                  node: name,
                  state: 'error',
                  error: error instanceof Error ? error.message : 'unknown_error',
                  duration_ms: Date.now() - start,
                });
                throw error;
              }
              await retryPause(0);
              const result = await svc.tools.execute(name, query, context);
              trace?.({ node: name, state: 'done', output: result, duration_ms: Date.now() - start });
              return result;
            }
          },
        },
        prepared.routerContext,
        pipeline,
      );
      fallback = result.fallback;
      answer = fallback ? 'Baik, saya konfirmasi dulu dan akan melanjutkan jawaban segera.' : result.answer;
      agent = result.agent;
    } catch (error) {
      generationFailed = true;
      answer = aiFallback;
      const errorCode = error instanceof Error ? error.message : 'unknown_error';
      await agentFailuresSql
        .insert(db, [
          account,
          session,
          id,
          lastNode ?? null,
          (lastTraceError ?? errorCode).slice(0, 100),
          message.text.slice(0, 4000),
          lastModel ?? null,
          lastMessages ? JSON.stringify(lastMessages) : null,
          lastRawOutput?.slice(0, 65000) ?? null,
          prepared.routerContext,
        ])
        .catch(() => {});
    }
    // Context bersifat internal dan tidak ditagih. Ringkasan yang gagal mengosongkan context lama bila kiriman berhasil.
    let routerContext: string | null = null;
    const contextHistory =
      config.context_memory_limit > 0
        ? prepared.messages
            .filter(m => m.role !== 'system')
            .slice(0, -1)
            .slice(-config.context_memory_limit)
        : [];
    if (!generationFailed)
      try {
        routerContext = await updateRouterContext(
          trackedTransport,
          config,
          message.text,
          answer,
          contextHistory,
          pipeline,
        );
      } catch (error) {
        console.error('Pembaruan konteks router AI gagal.');
        const errorCode = error instanceof Error ? error.message : 'unknown_error';
        await agentFailuresSql
          .insert(db, [
            account,
            session,
            id,
            'context',
            (lastTraceError ?? errorCode).slice(0, 100),
            message.text.slice(0, 4000),
            lastModel ?? null,
            lastMessages ? JSON.stringify(lastMessages) : null,
            lastRawOutput?.slice(0, 65000) ?? null,
            prepared.routerContext,
          ])
          .catch(() => {});
      }
    const outputWords = generationFailed ? 0 : countWords(answer),
      charged = generationFailed
        ? 0
        : creditCost(prepared.inputWords, outputWords, config.input_rate, config.output_rate);
    const fallbackId = fallback ? 'FB-' + randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase() : undefined;
    await transaction(async c => {
      await lockAccount(c, account, true);
      await walletsSql.credit(c, [prepared.reserved - charged, account]);
      await usageSql.finishMessage(c, [
        generationFailed ? 'fallback_generated' : 'generated',
        outputWords,
        charged,
        agent,
        JSON.stringify(modelCalls),
        modelCalls.find(call => call.role === agent)?.model ?? config.model,
        account,
        id,
      ]);
      if (fallbackId && fallback)
        await fallbacksSql.insertIgnore(c, [
          fallbackId,
          account,
          session,
          message.from,
          prepared.fallbackNumber,
          agent ?? 'lainnya',
          fallback.reason,
          fallback.question,
          prepared.routerContext,
          JSON.stringify(prepared.messages),
          message.messageId,
        ]);
    });
    let status = 'sent';
    const sentMarkers: string[] = [];
    try {
      // Dikirim sebelum jawaban teks supaya pelanggan melihat produknya sebelum penjelasannya. Tidak dijamin: gambar
      // yang gagal tidak pernah menahan atau menggagalkan balasan teks sesudahnya.
      if (!generationFailed && !fallback && pendingImageId) {
        await guard();
        const readImage = async (imageId: string) => {
          const file = await svc.productImages.get(account, imageId);
          return { path: file.path, mimetype: file.mimetype, cleanup: async () => {} };
        };
        const image = await sendBilled(
          account,
          manager,
          session,
          'media',
          { to: message.from, type: 'image' as const, url: pendingImageId },
          'ai_image_' + id,
          readImage,
          guard,
        ).catch(() => undefined);
        if (image)
          await recordOutgoing(account, session, {
            customer: message.from,
            messageId: image.messageId,
            origin: 'ai',
            type: 'image',
            text: '',
          }).catch(() => {});
      }
      // Setiap dokumen adalah pesan tersendiri yang ditagih: gambar tampil sebagai foto, lainnya sebagai file dengan
      // namanya.
      if (!generationFailed && !fallback)
        for (const [index, document] of pendingDocuments.entries()) {
          await guard();
          const readDocument = async () => {
            const file = await eduData.store.file(account, document.id, prepared.profileId);
            return { path: file.path, mimetype: file.mimetype, cleanup: async () => {} };
          };
          const file = await eduData.store.file(account, document.id, prepared.profileId).catch(() => undefined);
          if (!file) continue;
          const sent = await sendBilled(
            account,
            manager,
            session,
            'media',
            {
              to: message.from,
              type: file.media_type,
              url: document.id,
              ...(file.media_type === 'document' ? { filename: file.filename } : {}),
            },
            'ai_doc_' + index + '_' + id,
            readDocument,
            guard,
          ).catch(() => undefined);
          if (sent) {
            sentMarkers.push(documentMarker(document.filename));
            await recordOutgoing(account, session, {
              customer: message.from,
              messageId: sent.messageId,
              origin: 'ai',
              type: file.media_type,
              text: file.filename,
            }).catch(() => {});
          }
        }
      await guard();
      const confirmation = await sendBilled(
        account,
        manager,
        session,
        'text',
        { to: message.from, text: answer },
        'ai_' + id,
        undefined,
        guard,
      );
      await recordOutgoing(account, session, {
        customer: message.from,
        messageId: confirmation.messageId,
        origin: 'ai',
        text: answer,
      }).catch(() => {});
      if (fallbackId) await fallbacksSql.setConfirmationMessage(db, [confirmation.messageId, fallbackId]);
    } catch (error) {
      status =
        error instanceof ApiError && error.code === 'ai_cancelled'
          ? 'cancelled'
          : error instanceof ApiError && error.code === 'send_unknown'
            ? 'send_unknown'
            : 'send_failed';
    } finally {
      await stopTyping();
    }
    if (status === 'sent' && fallbackId && fallback && prepared.fallbackNotify && prepared.fallbackNumber)
      try {
        const notification = await sendBilled(
          account,
          manager,
          session,
          'text',
          {
            to: prepared.fallbackNumber,
            text:
              'Konfirmasi diperlukan [' +
              fallbackId +
              ']\\nPelanggan: ' +
              message.from +
              '\\nPertanyaan: ' +
              fallback.question +
              '\\nKonteks: ' +
              (prepared.routerContext ?? '-') +
              '\\nBalas pesan ini atau awali balasan dengan ' +
              fallbackId +
              '.',
          },
          'fallback_team_' + id,
        );
        await recordOutgoing(account, session, {
          customer: prepared.fallbackNumber,
          messageId: notification.messageId,
          origin: 'system',
          text: 'Konfirmasi diperlukan [' + fallbackId + ']',
        }).catch(() => {});
        await fallbacksSql.setNotificationMessage(db, [notification.messageId, fallbackId]);
      } catch {
        await fallbacksSql.markFailed(db, [fallbackId]);
      }
    await transaction(async c => {
      await lockAccount(c, account, true);
      await usageSql.updateStatus(c, [
        generationFailed && status !== 'cancelled' ? 'fallback_' + status : status,
        account,
        id,
      ]);
      if (status === 'sent') {
        const [limits] = await settingsSql.shareMemoryLimit(c);
        const [rows] = await conversationsSql.lockMessagesRevision(c, [account, session, message.from]);
        if (!rows[0] || rows[0].revision !== prepared.revision) return;
        const memory = [
          ...parseMemory(rows[0].messages),
          ...sentMarkers.map(content => ({ role: 'assistant' as const, content })),
          { role: 'assistant' as const, content: answer },
        ].slice(-(limits[0]?.memory_limit ?? defaults.memory_limit));
        await conversationsSql.updateMessagesAndContext(c, [
          JSON.stringify(memory),
          routerContext,
          account,
          session,
          message.from,
        ]);
      }
    });
  } finally {
    await stopTyping();
  }
}
