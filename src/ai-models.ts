import type {AIConfig} from './ai.js';
export const modelTiers=['cheap','medium','smart'] as const;
export type ModelTier=typeof modelTiers[number];
export type ModelRole='router'|'context'|'pembuka'|'penutup'|'informasi'|'konsultasi'|'transaksi'|'dukungan'|'keluhan'|'lainnya';
export const roleTier:Record<ModelRole,ModelTier>={router:'cheap',context:'cheap',pembuka:'cheap',penutup:'cheap',informasi:'medium',konsultasi:'medium',transaksi:'medium',dukungan:'medium',keluhan:'medium',lainnya:'smart'};
export function tierConfig(config:AIConfig,tier:ModelTier):AIConfig {return {...config,model:config[`model_${tier}`]||config.model};}
export function roleConfig(config:AIConfig,role:ModelRole):AIConfig {return {...tierConfig(config,roleTier[role]),call_role:role};}
