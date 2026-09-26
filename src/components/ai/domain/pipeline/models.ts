// Tier model per node (Murah, Sedang, Cerdas, Terstruktur, Keputusan) dan kapan skema JSON dikirim ke provider.
import type { AIConfig } from '../provider.js';
// "structured" berisi model yang mendukung JSON Schema ketat, untuk sedikit node yang butuh keluaran persis.
export const modelTiers = ['cheap', 'medium', 'smart', 'structured', 'decision'] as const;
export type ModelTier = (typeof modelTiers)[number];
// Id node berbeda per pipeline profil (CS Usaha: layanan, pesanan…; CS Lembaga Pendidikan: program, jadwal…).
export type ModelRole = string;
export interface AgentWorkflow {
  nodes: Record<
    ModelRole,
    { prompt: string; tier: ModelTier; model: string; tools: string[]; structured_output?: boolean }
  >;
}
export interface AITraceEvent {
  node: string;
  state: string;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
  model?: string;
  attempt?: number;
  error?: string;
}
// Tier bawaan per node untuk CS Usaha; setiap pipeline menentukan miliknya sendiri (lihat Pipeline.roleTier).
export const roleTier: Record<string, ModelTier> = {
  router: 'cheap',
  context: 'cheap',
  pembuka: 'cheap',
  penutup: 'cheap',
  profil_perusahaan: 'medium',
  layanan: 'medium',
  lainnya: 'smart',
  pesanan: 'structured',
};
export function tierConfig(config: AIConfig, tier: ModelTier): AIConfig {
  const profile = config.tier_profiles?.[tier];
  return profile
    ? {
        ...config,
        provider: profile.provider,
        endpoint: profile.endpoint,
        secret: profile.secret,
        model: profile.model,
      }
    : { ...config, model: config[`model_${tier}`] || config.model };
}
// Alur yang tersimpan selalu memuat semua node pipeline-nya; tier cadangan hanya untuk panggilan tanpa alur.
export function roleConfig(config: AIConfig, role: ModelRole): AIConfig {
  const node = config.workflow?.nodes[role];
  const selected = tierConfig(config, node?.tier ?? roleTier[role] ?? 'medium');
  return { ...selected, model: node?.model || selected.model, call_role: role };
}
// Node yang punya skema (Router, Pesanan) mengirimkannya ke provider bila berjalan di tier Terstruktur atau bila
// structured_output dinyalakan secara eksplisit.
export function schemaEnabled(config: AIConfig, role: 'router' | 'pesanan'): boolean {
  const node = config.workflow?.nodes[role];
  if (role === 'router' && node?.tier === 'decision') return false;
  return node?.structured_output === true || (node?.tier ?? roleTier[role]) === 'structured';
}
