import type {AIConfig} from './ai.js';
export const modelTiers=['cheap','medium','smart'] as const;
export type ModelTier=typeof modelTiers[number];
export type ModelRole='router'|'context'|'pembuka'|'penutup'|'informasi'|'layanan'|'lainnya';
export interface AgentWorkflow {nodes:Record<ModelRole,{prompt:string;tier:ModelTier;model:string;tools:string[];structured_output?:boolean}>}
export interface AITraceEvent {node:string;state:string;input?:unknown;output?:unknown;duration_ms?:number;model?:string;attempt?:number;error?:string}
export const roleTier:Record<ModelRole,ModelTier>={router:'cheap',context:'cheap',pembuka:'cheap',penutup:'cheap',informasi:'medium',layanan:'medium',lainnya:'smart'};
export function tierConfig(config:AIConfig,tier:ModelTier):AIConfig {return {...config,model:config[`model_${tier}`]||config.model};}
export function roleConfig(config:AIConfig,role:ModelRole):AIConfig {const node=config.workflow?.nodes[role];const selected=tierConfig(config,node?.tier??roleTier[role]);return {...selected,model:node?.model||selected.model,call_role:role};}
