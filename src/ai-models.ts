import type {AIConfig} from './ai.js';
// "structured" holds a model that supports strict JSON Schema, for the few nodes that need exact output.
export const modelTiers=['cheap','medium','smart','structured'] as const;
export type ModelTier=typeof modelTiers[number];
// Node ids differ per profile pipeline (CS Usaha: layanan, pesanan…; CS Lembaga Pendidikan: program, jadwal…).
export type ModelRole=string;
export interface AgentWorkflow {nodes:Record<ModelRole,{prompt:string;tier:ModelTier;model:string;tools:string[];structured_output?:boolean}>}
export interface AITraceEvent {node:string;state:string;input?:unknown;output?:unknown;duration_ms?:number;model?:string;attempt?:number;error?:string}
// CS Usaha's default tier per node; each pipeline declares its own (see Pipeline.roleTier).
export const roleTier:Record<string,ModelTier>={router:'cheap',context:'cheap',pembuka:'cheap',penutup:'cheap',profil_perusahaan:'medium',layanan:'medium',lainnya:'smart',pesanan:'structured'};
export function tierConfig(config:AIConfig,tier:ModelTier):AIConfig {const profile=config.tier_profiles?.[tier];return profile?{...config,provider:profile.provider,endpoint:profile.endpoint,secret:profile.secret,model:profile.model}:{...config,model:config[`model_${tier}`]||config.model};}
// A stored workflow always carries every node of its pipeline; the fallback tier only covers a call made without one.
export function roleConfig(config:AIConfig,role:ModelRole):AIConfig {const node=config.workflow?.nodes[role];const selected=tierConfig(config,node?.tier??roleTier[role]??'medium');return {...selected,model:node?.model||selected.model,call_role:role};}
// A node that has a schema (Router, Pesanan) sends it to the provider when it runs on the Terstruktur tier
// or when structured_output is switched on explicitly.
export function schemaEnabled(config:AIConfig,role:'router'|'pesanan'):boolean {const node=config.workflow?.nodes[role];return node?.structured_output===true||(node?.tier??roleTier[role])==='structured';}
