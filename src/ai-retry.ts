import type {AIConfig,AIMessage,AITransport} from './ai.js';

export function transientAIError(error:unknown):boolean {
 if(!(error instanceof Error))return false;
 return /^(ai_provider|endpoint)_http_(429|5\d\d)$/.test(error.message)||
  ['ai_provider_failed','endpoint_failed','timeout'].includes(error.message)||
  ['ETIMEDOUT','ECONNRESET','EAI_AGAIN','ECONNREFUSED','ABORT_ERR'].includes(String((error as NodeJS.ErrnoException).code));
}

// Repair only the current model response. Never restart the tool loop or replay mutations.
export async function validatedAI<T>(transport:AITransport,config:AIConfig,messages:AIMessage[],maxWords:number,validate:(raw:string)=>T,correction:string):Promise<T> {
 let current=messages;
 for(let attempt=0;attempt<2;attempt++){
  let raw:string;
  try{raw=await transport(config,current,maxWords);}catch(error){
   if(attempt===0&&error instanceof Error&&['ai_provider_empty_content','ai_provider_invalid_json'].includes(error.message)){
    config.onTrace?.({node:config.call_role??'model',state:'retry',error:error.message});
    current=[...messages,{role:'system',content:correction}];continue;
   }
   throw error;
  }
  try{return validate(raw);}catch(error){
   config.onTrace?.({node:config.call_role??'model',state:attempt===1?'invalid':'retry',error:error instanceof Error?error.message:'invalid_output'});
   if(attempt===1)throw error;
   current=[...messages,{role:'system',content:'Output sebelumnya tidak valid. '+correction}];
  }
 }
 throw Error('ai_invalid_response');
}
