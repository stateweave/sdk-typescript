import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {judgePairs,exactEquivalent,pairKey,protocol} from './linker.mjs';
import {graphCase} from './graph.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const bytes=await readFile(new URL('cases.json',import.meta.url));
const cases=JSON.parse(bytes);
assert.equal(cases.length,32);assert.equal(new Set(cases.map(p=>p.id)).size,32);
const dist=process.env.SDK_DIST??new URL('../../dist/',import.meta.url).pathname;
const {Agent}=await import(pathToFileURL(path.join(dist,'agent/agent.js')));
const {createModelFromEnv}=await import(pathToFileURL(path.join(dist,'llm/factory.js')));
const out=process.env.EVAL_OUTPUT;
if(!out||!/^[a-f0-9]{40}$/.test(process.env.PROBE_COMMIT??''))throw Error('Explicit output and frozen commit required');
if(process.env.ANTHROPIC_MODEL!=='glm-5.3-flash'||!process.env.TYPESAFE_API_KEY)throw Error('Expected configured Dev providers');
await mkdir(out,{recursive:true,mode:0o700});
const save=(name,data)=>writeFile(path.join(out,name+'.json'),JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
const hashes={};for(const file of ['PROTOCOL.md','cases.json','linker.mjs','graph.mjs','run.mjs','../jev-memory-links-v1/linker.mjs'])hashes[file]=sha(await readFile(new URL(file,import.meta.url)));
await save('protocol',{protocol,commit:process.env.PROBE_COMMIT,hashes,startedAt:new Date().toISOString()});
const ordered=[...cases].sort((a,b)=>sha('links-v2'+a.id).localeCompare(sha('links-v2'+b.id)));
const decisions=new Map(),batches=[];
for(let i=0;i<ordered.length;i+=6){
 const batch=ordered.slice(i,i+6),name='batch-'+String(i/6).padStart(2,'0');
 await save(name+'.started',{ids:batch.map(p=>p.id),startedAt:new Date().toISOString()});
 try{
  const result=await judgePairs(batch,{apiKey:process.env.TYPESAFE_API_KEY});
  const rows=batch.map((p,j)=>{assert.equal(result.judgments[j].pairHash,pairKey(p));const row={...p,...result.judgments[j]};decisions.set(p.id,row);return row;});
  await save(name,{...result,rows});batches.push(result);
  console.log(JSON.stringify({batch:i/6,status:'done',latencyMs:result.latencyMs,usage:result.usage}));
 }catch(e){await save(name+'.error',{message:String(e.message),usageIncomplete:true});throw Error('Relation batch failed; evidence preserved; no automatic retry');}
}
const ledger=cases.map(p=>decisions.get(p.id));
const metrics=Object.fromEntries(['equivalent','conflicting'].map(label=>{
 const tp=ledger.filter(p=>p.expected===label&&p.relation===label).length;
 const fp=ledger.filter(p=>p.expected!==label&&p.relation===label).length;
 const fn=ledger.filter(p=>p.expected===label&&p.relation!==label).length;
 return [label,{tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp/(tp+fn)}];
}));
await save('links-summary',{metrics,ledger,latencyMs:batches.reduce((s,b)=>s+b.latencyMs,0),inputTokens:batches.reduce((s,b)=>s+b.usage.input_tokens,0),outputTokens:batches.reduce((s,b)=>s+b.usage.output_tokens,0),calls:batches.length});
console.log(JSON.stringify({relationMetrics:metrics}));
process.env.ANTHROPIC_TEMPERATURE='0';process.env.ANTHROPIC_MAX_TOKENS='4096';
const model=createModelFromEnv(),arms=['deterministic','exact','jev'];
const variants=[[cases.slice(0,8),10],[cases.slice(8,16),10],[cases.slice(0,16),16]];
for(const [index,[pairs,maxNodes]]of variants.entries())for(let pos=0;pos<arms.length;pos++){
 const arm=arms[(index+pos)%arms.length];
 const links=new Map(pairs.map(p=>[p.id,arm==='jev'?decisions.get(p.id).relation:arm==='exact'&&exactEquivalent(p)?'equivalent':'none']));
 const graph=graphCase(pairs,links,maxNodes);
 const name=`graph-${index}-${arm}`,initialHash=sha(JSON.stringify(graph.sourceState));
 await save(name+'.started',{arm,initialHash,startedAt:new Date().toISOString()});
 const agent=new Agent({model,tools:[],state:graph.sourceState,semanticAliases:graph.aliases,contextMode:'molecular',projectionMaxNodes:maxNodes,projectionTargetTokens:16000,maxPromptTokens:64000,maxIterations:2,systemPrompt:'Answer from the supplied recorded facts. Do not invent missing constraints. Enumerate the release constraints in ordinary final-answer text.'});
 const start=Date.now();let record;
 try{
  const result=await agent.run(graph.query,{signal:AbortSignal.timeout(120000)});
  const finalIds=result.trace.at(-1).nodeIds;
  const covered=[...new Set(finalIds.map(id=>graph.nodeFacts[id]).filter(Boolean))];
  assert.deepEqual(result.state.nodes.slice(0,graph.sourceState.nodes.length),graph.sourceState.nodes);
  assert.deepEqual(result.state.nodes.filter(n=>n.kind==='answer').at(-1).parents,[...finalIds].sort());
  assert.ok(result.trace.every(t=>t.nodeIds.length<=maxNodes&&t.contextTokens<=64000));
  record={status:'done',arm,initialHash,elapsedMs:Date.now()-start,graph,covered,result,graphPreserved:true,readSetsPreserved:true};
 }catch(error){record={status:'error',arm,initialHash,elapsedMs:Date.now()-start,graph,error:String(error.message).slice(0,300),trace:error.trace,metrics:error.metrics};}
 await save(name,record);console.log(JSON.stringify({fixture:index,arm,status:record.status,coverage:record.covered?.length,total:pairs.length,elapsedMs:record.elapsedMs}));
}
