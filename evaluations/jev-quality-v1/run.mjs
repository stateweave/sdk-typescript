import {readFile,writeFile,mkdir,link,unlink,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {groundMemories,createRecovery,parseMemories,producerSystem,sourceSystem,policy} from './checkpoints.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtureBytes=await readFile(new URL('cases.json',import.meta.url));
assert.equal(sha(fixtureBytes),'cdec87a7d7956b0fe61566a3619419c657ec2d90e74fe1760aede18d77f7e52a');
const cases=JSON.parse(fixtureBytes);
assert.equal(cases.length,32);
const dist=process.env.SDK_DIST??new URL('../../dist/',import.meta.url).pathname;
const {Agent}=await import(pathToFileURL(path.join(dist,'agent/agent.js')));
const {CausalWeave}=await import(pathToFileURL(path.join(dist,'core/causalWeave.js')));
const {createModelFromEnv}=await import(pathToFileURL(path.join(dist,'llm/factory.js')));
const out=process.env.EVAL_OUTPUT;
assert.ok(out && /^[a-f0-9]{40}$/.test(process.env.PROBE_COMMIT??''));
assert.equal(process.env.ANTHROPIC_MODEL,'glm-5.3-flash');
assert.ok(process.env.TYPESAFE_API_KEY);
process.env.ANTHROPIC_TEMPERATURE='0';
process.env.ANTHROPIC_MAX_TOKENS='4096';
await mkdir(out,{recursive:true,mode:0o700});
async function save(name,data) {
  const target=path.join(out,name+'.json'),temporary=target+'.tmp-'+process.pid;
  await writeFile(temporary,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
  const file=await open(temporary,'r');await file.sync();await file.close();
  await link(temporary,target);await unlink(temporary);
}
const files=['PROTOCOL.md','cases.json','checkpoints.mjs','run.mjs','judge.py','summarize.py'];
const hashes=Object.fromEntries(await Promise.all(files.map(async name=>[name,sha(await readFile(new URL(name,import.meta.url)))])));
const runtimeHashes=Object.fromEntries(await Promise.all(['agent/agent.js','core/causalWeave.js','llm/factory.js','llm/anthropicModel.js'].map(async name=>[name,sha(await readFile(path.join(dist,name)))])));
await save('manifest',{commit:process.env.PROBE_COMMIT,hashes,runtimeHashes,execArgv:process.execArgv,policy,startedAt:new Date().toISOString(),provider:'glm-5.3-flash',order:'case index, four-arm Latin rotation; two case workers',arms:['baseline','grounding','recovery','combined']});
const baseModel=createModelFromEnv();
assert.equal(baseModel.constructor.name,'AnthropicModel','Real configured provider required; a mock participant is forbidden');
const model={complete:input=>baseModel.complete({...input,parameters:{model:'glm-5.3-flash',maxTokens:4096,temperature:0}}),stream:input=>baseModel.stream({...input,parameters:{model:'glm-5.3-flash',maxTokens:4096,temperature:0}})};
const arms=['baseline','grounding','recovery','combined'];
let next=0;

async function runCase(caseData,index) {
  const localSave=(name,data)=>save(caseData.id+'.'+name,data);
  const sources=caseData.sessions.flatMap(session=>session.turns.map((turn,index)=>({id:`${session.id}:${index}`,sessionId:session.id,date:session.date,...turn})));
  const sourceWeave=new CausalWeave();
  const system=sourceWeave.append({kind:'system',payload:producerSystem,parents:[],advance:true});
  const sourceIds=sources.map(source=>sourceWeave.append({kind:'resource',payload:source,parents:[system.id],resourceKey:'conversation:'+source.id,advance:false}).id);
  const producerInput={system:producerSystem,prompt:JSON.stringify({sources}),mode:'text'};
  await localSave('producer.started',{input:producerInput,sourceState:sourceWeave.snapshot(),startedAt:new Date().toISOString()});
  const producerStart=Date.now();
  let memories=[],producer;
  try {
    const response=await model.complete({...producerInput,signal:AbortSignal.timeout(120000)});
    await localSave('producer.response',{response,elapsedMs:Date.now()-producerStart});
    memories=parseMemories(response.text);
    producer={status:'done',elapsedMs:Date.now()-producerStart,usage:response.usage,memories};
  } catch (error) {
    producer={status:'fallback-raw-sources',error:error.name,elapsedMs:Date.now()-producerStart,memories:[],usageIncomplete:true};
  }
  await localSave('producer',producer);
  const parent=sourceWeave.append({kind:'inference',payload:{operation:'memory_import',recordedBy:'importer',producerStatus:producer.status,proposalCount:memories.length,description:'Import metadata, not a user fact or a verbatim model answer. Exact extraction response is retained in the import trace.'},parents:[system.id,...sourceIds],advance:true});
  const sourceState=sourceWeave.snapshot();
  const grounding=await groundMemories(sources,memories,{apiKey:process.env.TYPESAFE_API_KEY,save:localSave});
  await localSave('memory-review',grounding);
  const states={};
  for (const treatment of ['baseline','grounding']) {
    const weave=new CausalWeave(sourceState);
    memories.forEach((memory,i)=>{
      if (treatment==='baseline' || grounding.accepted[i]) weave.append({kind:'semantic',payload:memory,parents:[parent.id],resourceKey:`semantic:${memory.type}:${memory.key}`,advance:false});
      else weave.append({kind:'verification',payload:{status:'unverified',memoryProposal:memory,meaning:'The optional source checker did not establish this proposal. It is not an established fact; the unchanged original records remain authoritative.'},parents:[parent.id,...sourceIds],advance:false});
    });
    states[treatment]=weave.snapshot();
  }
  await localSave('states',{states,sourceIds});
  for (let position=0;position<arms.length;position++) {
    const arm=arms[(index+position)%arms.length];
    const state=states[arm==='grounding'||arm==='combined'?'grounding':'baseline'];
    const recoveryDiagnostics={status:'disabled'};
    const needsRecovery=arm==='recovery'||arm==='combined';
    const recovery=createRecovery({apiKey:process.env.TYPESAFE_API_KEY,save:localSave,label:arm},recoveryDiagnostics);
    const agent=new Agent({model,tools:[],state,systemPrompt:sourceSystem,contextMode:'molecular',projectionMaxNodes:16,projectionTargetTokens:16000,maxPromptTokens:64000,maxIterations:2,enforceCompletionEvidence:false,...(needsRecovery?{contextRecovery:async (...args)=>{try{return await recovery(...args);}catch(error){Object.assign(recoveryDiagnostics,{status:'fallback',usageIncomplete:true});throw error;}}}:{})});
    const query=`Current question date: ${caseData.questionDate}\n\n${caseData.question}`;
    await localSave(arm+'.started',{arm,stateHash:sha(JSON.stringify(state)),query,startedAt:new Date().toISOString()});
    const start=Date.now();let record;
    try {
      const result=await agent.run(query,{signal:AbortSignal.timeout(120000)});
      assert.deepEqual(result.state.nodes.slice(0,state.nodes.length),state.nodes);
      assert.deepEqual(result.state.nodes.filter(n=>n.kind==='answer').at(-1).parents,[...result.trace.at(-1).nodeIds].sort());
      assert.ok(result.trace.every(t=>t.nodeIds.length<=16 && t.contextTokens<=64000));
      const visible=new Set(result.trace.at(-1).nodeIds);
      record={status:'done',arm,elapsedMs:Date.now()-start,recovery:recoveryDiagnostics,result,sourceGraphPreserved:true,readSetPreserved:true,visibleSourceIds:sourceIds.filter(id=>visible.has(id)),preferredActuallyVisible:(recoveryDiagnostics.preferredNodeIds??[]).filter(id=>visible.has(id))};
    } catch (error) {
      record={status:'error',arm,elapsedMs:Date.now()-start,recovery:recoveryDiagnostics,error:error.name,errorClass:error.code==='ERR_ASSERTION'?'invariant':error.metrics?'agent':'external',trace:error.trace,metrics:error.metrics,usageIncomplete:!error.metrics};
    }
    await localSave(arm,record);
    console.log(JSON.stringify({case:caseData.id,arm,status:record.status,elapsedMs:record.elapsedMs,recovery:recoveryDiagnostics.status}));
  }
  await localSave('complete',{completedAt:new Date().toISOString()});
}
async function worker() {
  while (next<cases.length) {const index=next++;await runCase(cases[index],index);}
}
await Promise.all([worker(),worker()]);
await save('complete',{completedAt:new Date().toISOString(),cases:cases.length,runs:cases.length*arms.length});
console.log(JSON.stringify({status:'complete',cases:cases.length,runs:cases.length*arms.length}));
