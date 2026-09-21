import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {routerAgentNames,routerOutputSchema,validateRouterOutput} from '../src/ai-router-schema.js';
import {agents,runAgents} from '../src/ai-agents.js';
import {aiRequestPayload,defaults} from '../src/ai.js';
import {defaultWorkflow,workflowInput} from '../src/ai-workflow.js';
import {db} from '../src/db.js';
after(()=>db.end());
test('Router enum covers exactly the executable agents and rejects invalid routes',()=>{
 assert.deepEqual([...routerAgentNames].sort(),Object.keys(agents).sort());
 const route={sub_agent:'profil_perusahaan',s_p_o_konteks:'Pelanggan mencari produk',isi_pesan:'ya'};
 for(const sub_agent of routerAgentNames)assert.doesNotThrow(()=>validateRouterOutput({...route,sub_agent},'ya'));
 assert.doesNotThrow(()=>validateRouterOutput({...route,s_p_o_konteks:'pelanggan-meminta-harga murah'},'ya'));
 for(const value of [{...route,sub_agent:'unknown'},{...route,sub_agent:['profil_perusahaan']},{...route,extra:true},{...route,isi_pesan:'changed'},{...route,s_p_o_konteks:'   '},{...route,s_p_o_konteks:'a'.repeat(201)},{}])assert.throws(()=>validateRouterOutput(value,'ya'),/ai_invalid_route/);
});
test('Provider schema is opt-in, router-only, and old drafts stay compatible',()=>{
 const workflow=defaultWorkflow();
 delete workflow.nodes.router.structured_output;
 assert.equal(workflowInput(workflow).nodes.router.structured_output,false);
 assert.equal(aiRequestPayload({...defaults,workflow,call_role:'router'},[]).response_format,undefined);
 workflow.nodes.router.structured_output=true;
 assert.deepEqual(aiRequestPayload({...defaults,workflow,call_role:'router'},[]).response_format,{type:'json_schema',json_schema:{name:'router_output',strict:true,schema:routerOutputSchema}});
 for(const call_role of ['context','profil_perusahaan',undefined] as const)assert.equal(aiRequestPayload({...defaults,workflow,call_role},[]).response_format,undefined);
 workflow.nodes.context.structured_output=true;
 assert.throws(()=>workflowInput(workflow));
});
test('Custom prompt and repair preserve enum contract before dispatch',async()=>{
 const workflow=defaultWorkflow();workflow.nodes.router.prompt='Custom router';
 let calls=0;
 const result=await runAgents(async(c,m)=>{
  if(c.call_role!=='router')return '{"answer":"Baik"}';
  assert.ok(m[0].content.includes(JSON.stringify(routerOutputSchema)));
  assert.ok(m[0].content.startsWith('Custom router'));
  return JSON.stringify({sub_agent:++calls===1?'unknown':'layanan',s_p_o_konteks:'Pelanggan memesan produk',isi_pesan:'ya'});
 },{...defaults,workflow},[{role:'user',content:'ya'}],300,{account:'test',session:'test',customer:'test',requestId:'test',knowledge:''});
 assert.equal(calls,2);assert.equal(result.agent,'layanan');
});
