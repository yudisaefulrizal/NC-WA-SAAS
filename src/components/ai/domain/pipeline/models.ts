// Tier model per node (Murah, Sedang, Cerdas, Terstruktur, Keputusan) dan model router JEV.
import type { AIConfig } from '../provider.js';
// "structured" berisi model yang mendukung JSON Schema ketat, untuk sedikit node yang butuh keluaran persis.
export const modelTiers = ['cheap', 'medium', 'smart', 'structured', 'decision'] as const;
export type ModelTier = (typeof modelTiers)[number];
// Id node graf yang memanggil model; dicatat di jejak dan riwayat pemakaian.
export type ModelRole = string;
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
// Model JEV hanya menjawab lewat Decisions API OpenRouter, jadi hanya bisa dipakai node Router.
export const isJevModel = (model: string) => /^~?typesafe\/jev-/.test(model);
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
