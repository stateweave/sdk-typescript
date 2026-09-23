import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const dist=process.env.SDK_DIST ?? new URL('../../dist/',import.meta.url).pathname;
const {Agent}=await import(pathToFileURL(path.join(dist,'agent/agent.js')));
const {CausalWeave}=await import(pathToFileURL(path.join(dist,'core/causalWeave.js')));
const {createJevFocusReranker}=await import(pathToFileURL(path.join(dist,'integrations/jevFocus.js')));
const {createModelFromEnv}=await import(pathToFileURL(path.join(dist,'llm/factory.js')));
const {createDefaultTools}=await import(pathToFileURL(path.join(dist,'tools/fileSystemTools.js')));
const bytes=await readFile(new URL('./cases.json',import.meta.url));
const cases=JSON.parse(bytes), hash=createHash('sha256').update(bytes).digest('hex');
const out=process.env.EVAL_OUTPUT ?? new URL('./results/',import.meta.url).pathname;
const arms=['deterministic','flat','hierarchical'];
const topics=['payments','deployment','policy','research','customer','operations','finance','design'];
const fillers={payments:'Monthly settlement statistics were archived; no processing rule changed.',deployment:'The build label and release banner were restyled; runtime settings did not change.',policy:'Document headings were standardized; approval and retention rules were not changed.',research:'The interview template gained optional fields; no experiment outcome was recorded.',customer:'The help-center footer was updated; no contact preference was supplied.',operations:'Inventory labels were printed; no storage, transport, restore, or spending rule changed.',finance:'The ledger typography was updated; no allowance or expense amount was recorded.',design:'The style guide uses muted green for noncritical indicators.'};
function seed(test,index){
 const weave=new CausalWeave();
 const root=weave.append({kind:'system',payload:'Synthetic project records. Use current facts, respect corrections, and do not invent missing values.',parents:[],advance:false});
 const evidence=[];
 const positions=[9+index%5,30+index%7,51+index%3];
 for(let i=0;i<72;i++){
  const fi=positions.indexOf(i),fact=fi<0?undefined:test.facts[fi];
  const topic=fact?.topic ?? topics[i%topics.length];
  const goal=weave.append({kind:'goal',payload:`Record the project note in records/${topic}.md.`,parents:[root.id,...weave.frontier()]});
  const key=fact?.key ?? `${topic}-entry-${i}`;
  const semantic=weave.append({kind:'semantic',payload:{type:'memory',key,content:fact?.text ?? `${fillers[topic]} Entry ${i}.`},parents:[goal.id],resourceKey:`semantic:memory:${key}`,advance:false});
  if(fact && !fact.superseded)evidence.push(semantic.id);
  weave.append({kind:'answer',payload:`Recorded note ${i}.`,parents:[goal.id],advance:true});
 }
 const state=weave.snapshot();for(const node of state.nodes)node.createdAt='2026-09-23T00:00:00.000Z';
 return {state,evidence};
}
const protocol={id:'jev-focus-pilot-v1',fixtureSha256:hash,cases:cases.length,arms,answerModel:process.env.ANTHROPIC_MODEL,judgeModel:'jev-1.13.0',maxIterations:5,maxNodes:16,targetTokens:16000,maxTokens:64000,decoding:{temperature:0,maxOutputTokens:1024},order:'Latin rotation by case index',startedAt:new Date().toISOString()};
await mkdir(out,{recursive:true});
if(process.argv.includes('--preflight')){
 for(const [i,c] of cases.entries()){
  const {state,evidence}=seed(c,i);const weave=new CausalWeave(state);const hierarchy=weave.focusHierarchy(c.query);
  if(state.nodes.length!==217||evidence.length!==c.facts.filter(f=>!f.superseded).length)throw Error('Invalid fixture');
  console.log(c.id,state.nodes.length,hierarchy.topics.length,evidence.length);
 }
 console.log('FIXTURE',hash);process.exit(0);
}
if(process.env.ANTHROPIC_MODEL!=='glm-5.3-flash'||!process.env.TYPESAFE_API_KEY)throw Error('Expected Dev models/credentials are not configured.');
process.env.ANTHROPIC_TEMPERATURE='0';process.env.ANTHROPIC_MAX_TOKENS='1024';
const model=createModelFromEnv();
await writeFile(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx',mode:0o600}).catch(async e=>{if(e.code!=='EEXIST'||!process.argv.includes('--resume'))throw e;const prior=JSON.parse(await readFile(path.join(out,'protocol.json'),'utf8'));if(prior.fixtureSha256!==hash)throw Error('Fixture mismatch');});
for(const [index,test] of cases.entries()){
 const {state,evidence}=seed(test,index);const initialHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 for(let position=0;position<3;position++){
  const arm=arms[(index+position)%3],base=path.join(out,`${String(index+1).padStart(2,'0')}-${test.id}-${arm}`);
  try{await access(base+'.json');continue;}catch{}
  await writeFile(base+'.started.json',JSON.stringify({test:test.id,arm,initialHash,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const workspace=await mkdtemp(path.join(os.tmpdir(),'jev-pilot-'));
  const marker=`PROBE-${String(index+1).padStart(2,'0')}`;
  await writeFile(path.join(workspace,'probe.txt'),`Current verification marker: ${marker}.\n`,{mode:0o600});
  const tools=createDefaultTools({rootDir:workspace}).filter(t=>t.name==='read_file').map(t=>({...t,description:t.description.replaceAll(workspace,'<workspace>')}));
  const agent=new Agent({model,tools,state:structuredClone(state),contextMode:'molecular',projectionMaxNodes:16,projectionTargetTokens:16000,maxPromptTokens:64000,maxIterations:5,
   systemPrompt:'Use the supplied project records. Respect the latest corrections and revocations. Do not guess unavailable values. Follow the requested JSON response format.',
   ...(arm==='deterministic'?{}:{focusReranker:createJevFocusReranker({apiKey:process.env.TYPESAFE_API_KEY,mode:arm,model:'jev-1.13.0'})})});
  const prompt=`Read probe.txt for its current verification marker. Then answer this question from the project records: ${test.query}\nReturn JSON with two strings: answer (the requested decision or values) and probe (the marker read from the file).`;
  const start=Date.now();let record;
  try{
   const result=await agent.run(prompt,{signal:AbortSignal.timeout(120000)});
   let parsed;try{parsed=JSON.parse(result.finalAnswer.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{}
   const answer=typeof parsed?.answer==='string'?parsed.answer:'';
   const correct=test.expected.every(v=>answer.toLowerCase().includes(v.toLowerCase()))&&!test.forbidden.some(v=>answer.toLowerCase().includes(v.toLowerCase()));
   const final=result.trace.at(-1),selected=new Set(final?.nodeIds??[]);
   const recall=evidence.length?evidence.filter(id=>selected.has(id)).length/evidence.length:1;
   const read=result.trace.some(step=>step.action==='tool'&&step.tool==='read_file');
   const currentResults=result.state.nodes.filter(node=>node.kind==='tool_result'&&JSON.stringify(node.payload).includes(marker));
   const freshRead=currentResults.some(node=>selected.has(node.id));
   const answerNode=result.state.nodes.filter(node=>node.kind==='answer').at(-1);
   const provenance=JSON.stringify([...(answerNode?.parents??[])].sort())===JSON.stringify([...(final?.nodeIds??[])].sort());
   const preserved=JSON.stringify(result.state.nodes.slice(0,state.nodes.length))===JSON.stringify(state.nodes);
   const budget=result.trace.every(step=>step.nodeIds.length<=16&&step.contextTokens<=64000);
   const fullPass=correct&&parsed?.probe===marker&&read&&freshRead&&recall===1&&provenance&&preserved&&budget;
   record={id:test.id,category:test.category,arm,initialHash,prompt,evidence,expected:test.expected,forbidden:test.forbidden,status:'done',elapsedMs:Date.now()-start,correct,read,freshRead,recall,provenance,preserved,budget,probeCorrect:parsed?.probe===marker,fullPass,result};
  }catch(error){
   record={id:test.id,category:test.category,arm,initialHash,status:'error',elapsedMs:Date.now()-start,error:String(error?.message??error).slice(0,500),fullPass:false,metrics:error?.metrics,trace:error?.trace};
  }finally{await rm(workspace,{recursive:true,force:true});}
  await writeFile(base+'.json',JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({id:record.id,arm,status:record.status,correct:record.correct,recall:record.recall,fullPass:record.fullPass,elapsedMs:record.elapsedMs,focus:record.result?.metadata.focus?.status}));
 }
}
