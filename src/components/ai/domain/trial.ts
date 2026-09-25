// Uji Coba: menjalankan satu pertanyaan lewat pipeline data profil tanpa WhatsApp, dengan menagih kredit AI.
import { type AgentWorkflow } from './pipeline/models.js';
import { activeWorkflow, enabledProfiles } from './profiles/registry.js';
import { runAgents } from './pipeline/runner.js';
import { csPipeline } from './profiles/cs/pipeline.js';
import { sentDocuments } from './profiles/pendidikan/tools.js';
import { eduIdentity } from './profiles/pendidikan/profile.js';
import { randomUUID } from 'node:crypto';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { AIMessage } from './provider.js';
import { fail, text } from './input-validation.js';
import { countWords, aiFallback, creditCost } from './metering.js';
import { pipelines } from './profile-pipelines.js';
import { transaction, lockAccount } from './transaction.js';
import type { AIService } from './service.js';
import * as usageSql from '../data-access/usage-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';
export async function trial(svc: AIService, account: string, body: unknown) {
  // Menguji data profil yang terpasang di sebuah sesi, atau data profil langsung (halaman Data Profil, walau belum
  // terpasang).
  const input = object(body),
    question = text(input.question, 2000, 'Pertanyaan'),
    session = input.data_profile === undefined ? text(input.session, 64, 'Sesi') : '';
  if (!question) throw fail('Pertanyaan wajib diisi');
  if (input.data_profile === undefined && !session) throw fail('Pilih nomor layanan yang akan diuji');
  const config = await svc.config();
  if (!config.secret) throw fail('AI belum dikonfigurasi');
  const assistant = session
    ? await svc.assistant(account, session)
    : await svc.dataProfile(account, input.data_profile);
  const profile =
    'data_profile' in assistant
      ? assistant.data_profile
      : { id: assistant.id, name: assistant.name, profile_type: assistant.profile_type };
  if (!profile) throw new ApiError(409, 'no_profile', 'Pasang profil AI ke sesi ini terlebih dahulu.');
  if (!(await enabledProfiles()).has(profile.profile_type))
    throw new ApiError(409, 'profile_disabled', 'Profil AI ini sedang dinonaktifkan admin.');
  config.workflow = (await activeWorkflow(profile.profile_type)) as AgentWorkflow;
  const pipeline = pipelines[profile.profile_type] ?? csPipeline,
    identity = profile.profile_type === 'pendidikan' ? eduIdentity(profile.name) : undefined;
  const id = digest(JSON.stringify(['trial', account, session, randomUUID()]));
  const messages: AIMessage[] = [{ role: 'user', content: question }];
  const inputWords = countWords(question);
  const prepared = await transaction(async c => {
    await lockAccount(c, account);
    await walletsSql.ensure(c, [account]);
    const [wallet] = await walletsSql.lockBalance(c, [account]);
    const maxWords = Math.min(
      300,
      Math.floor((wallet[0].balance - inputWords * config.input_rate) / config.output_rate),
    );
    if (maxWords < 1) throw new ApiError(402, 'insufficient_credit', 'Kredit AI tidak cukup untuk uji coba');
    const reserved = creditCost(inputWords, maxWords, config.input_rate, config.output_rate);
    await walletsSql.debit(c, [reserved, account]);
    await usageSql.insertTrial(c, [
      account,
      id,
      session,
      inputWords,
      config.input_rate,
      config.output_rate,
      reserved,
      config.model,
      profile.profile_type,
      profile.id,
    ]);
    return { reserved, maxWords };
  });
  let answer: string,
    agent: string | null = null,
    generationFailed = false;
  const documents: string[] = [];
  try {
    // Uji Coba tidak pernah mengirim WhatsApp; dokumen yang dipilih AI dicantumkan bersama jawabannya.
    const result = await runAgents(
      svc.transport,
      config,
      messages,
      prepared.maxWords,
      {
        account,
        profile: profile.id,
        session,
        customer: '628000000000',
        requestId: id,
        knowledge: assistant.knowledge,
        behavior: assistant.behavior,
        identity,
        fallbackEnabled: false,
      },
      {
        execute: async (name, query, context) => {
          const value = await svc.tools.execute(name, query, { ...context, sentDocuments: documents });
          if (name === 'kirim_dokumen' && (value as { available?: boolean })?.available)
            documents.push((value as { nama_file: string }).nama_file);
          return value;
        },
      },
      null,
      pipeline,
    );
    answer = result.answer;
    agent = result.agent;
  } catch {
    generationFailed = true;
    answer = aiFallback;
  }
  const outputWords = generationFailed ? 0 : countWords(answer),
    charged = generationFailed ? 0 : creditCost(inputWords, outputWords, config.input_rate, config.output_rate);
  const wallet = await transaction(async c => {
    await lockAccount(c, account, true);
    await walletsSql.credit(c, [prepared.reserved - charged, account]);
    await usageSql.finishTrial(c, [
      generationFailed ? 'failed' : 'generated',
      outputWords,
      charged,
      agent,
      account,
      id,
    ]);
    const [rows] = await walletsSql.findBalance(c, [account]);
    return rows[0].balance as number;
  });
  if (generationFailed)
    throw new ApiError(502, 'ai_provider_failed', 'AI belum berhasil menjawab; periksa konfigurasi AI.');
  return { answer, agent, balance: wallet, documents };
}
