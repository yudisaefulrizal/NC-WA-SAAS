import {routerSchema} from './ai-router-schema.js';
import {csPipeline,type Pipeline} from './ai-agents.js';
import {orderOutputSchema} from './ai-order-schema.js';
import {modelTiers,type AgentWorkflow} from './ai-models.js';
import {record} from './ai-data.js';
import {ApiError} from './engine/sessions.js';

// Every node of a pipeline, in the order AI Studio lists them: router, the specialists, extra nodes, context.
export function pipelineNodes(pipeline:Pipeline){return ['router',...Object.keys(pipeline.agents),...Object.keys(pipeline.extraNodes),'context'];}
function defaultPrompt(pipeline:Pipeline,role:string){return role==='router'?pipeline.routerPrompt:role==='context'?pipeline.contextPrompt:pipeline.agents[role]??pipeline.extraNodes[role];}
export function defaultWorkflow(pipeline:Pipeline=csPipeline):AgentWorkflow {
 return {nodes:Object.fromEntries(pipelineNodes(pipeline).map(role=>[role,{tier:pipeline.roleTier[role]??'medium',model:'',...(pipeline.structuredNodes.includes(role)?{structured_output:false}:{}),prompt:defaultPrompt(pipeline,role),tools:[...(pipeline.permissions[role]??[])]}]))};
}
export function workflowInput(value:unknown,pipeline:Pipeline=csPipeline):AgentWorkflow {
 // A workflow saved before a node existed (CS: Pesanan) gets that node's default instead of being rejected.
 const root=record(value),stored=record(root.nodes),defaults=defaultWorkflow(pipeline),roles=pipelineNodes(pipeline);
 const nodes:Record<string,unknown>={...stored};for(const role of Object.keys(pipeline.extraNodes))if(!(role in nodes))nodes[role]=defaults.nodes[role];
 if(Object.keys(root).join()!=='nodes'||Object.keys(nodes).sort().join()!==[...roles].sort().join())throw new ApiError(400,'invalid_workflow','Node dan hubungan alur bersifat tetap.');
 const result=defaults;
 for(const role of roles){
  const node=record(nodes[role]),structured=pipeline.structuredNodes.includes(role);
  if(Object.keys(node).some(k=>!['prompt','tier','model','tools',...(structured?['structured_output']:[])].includes(k))||(node.structured_output!==undefined&&typeof node.structured_output!=='boolean')||typeof node.prompt!=='string'||!node.prompt.trim()||node.prompt.length>8000||!modelTiers.includes(node.tier as any)||typeof node.model!=='string'||node.model.length>100||!Array.isArray(node.tools))throw new ApiError(400,'invalid_workflow','Pengaturan node '+role+' tidak valid.');
  const allowed:readonly string[]=pipeline.permissions[role]??[];
  if(node.tools.some(t=>typeof t!=='string'||!allowed.includes(t))||new Set(node.tools).size!==node.tools.length)throw new ApiError(400,'invalid_workflow','Tool node '+role+' tidak diizinkan.');
  result.nodes[role]={prompt:node.prompt.trim(),tier:node.tier as typeof modelTiers[number],model:node.model.trim(),tools:node.tools as string[],...(structured?{structured_output:node.structured_output===true}:{})};
 }
 return result;
}
// What AI Studio shows next to a canvas: which tools each node may use and the schemas it enforces.
export function csStudioMeta(){return {allowedTools:csPipeline.permissions,routerSchema:routerSchema(),orderSchema:orderOutputSchema(['<nama produk dari katalog>'])};}
export function studioMeta(pipeline:Pipeline){return {allowedTools:pipeline.permissions,routerSchema:routerSchema(Object.keys(pipeline.agents))};}
