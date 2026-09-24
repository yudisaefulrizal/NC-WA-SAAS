import type {AIConfig} from './ai.js';
// "structured" holds a model that supports strict JSON Schema, for the few nodes that need exact output.
export const modelTiers=['cheap','medium','smart','structured'] as const;
export type ModelTier=typeof modelTiers[number];
export type ModelRole='router'|'context'|'pembuka'|'penutup'|'profil_perusahaan'|'layanan'|'lainnya'|'pesanan';
export interface AgentWorkflow {nodes:Record<ModelRole,{prompt:string;tier:ModelTier;model:string;tools:string[];structured_output?:boolean}>}
export interface AITraceEvent {node:string;state:string;input?:unknown;output?:unknown;duration_ms?:number;model?:string;attempt?:number;error?:string}
export const roleTier:Record<ModelRole,ModelTier>={router:'cheap',context:'cheap',pembuka:'cheap',penutup:'cheap',profil_perusahaan:'medium',layanan:'medium',lainnya:'smart',pesanan:'structured'};
export function tierConfig(config:AIConfig,tier:ModelTier):AIConfig {const profile=config.tier_profiles?.[tier];return profile?{...config,provider:profile.provider,endpoint:profile.endpoint,secret:profile.secret,model:profile.model}:{...config,model:config[`model_${tier}`]||config.model};}
export function roleConfig(config:AIConfig,role:ModelRole):AIConfig {const node=config.workflow?.nodes[role];const selected=tierConfig(config,node?.tier??roleTier[role]);return {...selected,model:node?.model||selected.model,call_role:role};}
// A node that has a schema (Router, Pesanan) sends it to the provider when it runs on the Terstruktur tier
// or when structured_output is switched on explicitly.
export function schemaEnabled(config:AIConfig,role:'router'|'pesanan'):boolean {const node=config.workflow?.nodes[role];return node?.structured_output===true||(node?.tier??roleTier[role])==='structured';}
