// Uji Coba: menjalankan satu pertanyaan lewat graf terbit data profil tanpa WhatsApp, dengan menagih kredit AI.
import { activeGraph, enabledProfiles } from './profiles/registry.js';
import { runGraph } from './builder/engine.js';
import { randomUUID } from 'node:crypto';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { AIMessage } from './provider.js';
import { fail, text } from './input-validation.js';
import { basicWallet } from '../../billing/index.js';
import { countWords, aiFallback, creditCost, planPart, refundSplit } from './metering.js';
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
  const graph = await activeGraph(profile.profile_type);
  const id = digest(JSON.stringify(['trial', account, session, randomUUID()]));
  const messages: AIMessage[] = [{ role: 'user', content: question }];
  const inputWords = countWords(question);
  await basicWallet(account);
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
    const fromPlan = planPart(reserved, wallet[0].plan_balance);
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
    return { reserved, maxWords, fromPlan };
  });
  let answer: string,
    agent: string | null = null,
    generationFailed = false;
  const media: { name: string; type: string; when: string }[] = [];
  try {
    const result = await runGraph(
      graph,
      svc.transport,
      config,
      messages,
      {
        account,
        profile: profile.id,
        session,
        customer: '628000000000',
        serviceName: profile.name,
        requestId: id,
        behavior: assistant.behavior,
        fallbackEnabled: false,
      },
      null,
      undefined,
      prepared.maxWords,
    );
    answer = result.answer;
    agent = result.agent;
    // Uji Coba tidak mengirim WhatsApp; media dari node Kirim media hanya dicantumkan.
    if ('media' in result && result.media)
      media.push(...result.media.map(m => ({ name: m.filename, type: m.type, when: m.when })));
  } catch {
    generationFailed = true;
    answer = aiFallback;
  }
  const outputWords = generationFailed ? 0 : countWords(answer),
    charged = generationFailed ? 0 : creditCost(inputWords, outputWords, config.input_rate, config.output_rate);
  const wallet = await transaction(async c => {
    await lockAccount(c, account, true);
    const back = refundSplit(prepared.reserved, prepared.fromPlan, prepared.reserved - charged);
    await walletsSql.refund(c, [back.toBalance, back.toPlan, account]);
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
  return { answer, agent, balance: wallet, media };
}
