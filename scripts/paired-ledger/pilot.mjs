import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createEpisode, scoreAnswer, LEDGER_PROTOCOL } from './ledger.mjs';
import { Budget, BudgetStop } from './budget.mjs';

export const protocol = {
  id: 'current-agent-native-ledger-pilot-v1-20261107', sdkSourceRevision: 'bcf490a5231cba70ba316578e24ceb26762d83d9',
  answeringModel: 'glm-5.3-flash', recallModel: 'jev-1.13.0', maxCalls: 600, maxTokens: 3_000_000,
  maxOutputTokens: 1024, maxPromptTokens: 64_000, maxIterations: 1, tools: [], temperature: 0,
  nativeRecall: true, projectionTargetTokens: 16_000, baselineNodes: 48, candidateNodes: [12, 8],
  turns: 60, primaryTurns: [41, 60], devSeed: 117701, validationSeed: 227701,
  cohort: { development: Array.from({length:10},(_,i)=>117701+i), validation:Array.from({length:10},(_,i)=>227701+i), finalTest:Array.from({length:10},(_,i)=>337701+i) },
  calibrationSeed: 447701, maxCandidateRounds: 2, retries: 0, deadlineMinutes: 45,
  selection: 'Higher development late accuracy with no additional protocol failures; ties require no loss of full-episode accuracy and at least 5% lower graph-arm total input tokens (GLM plus Jev). Otherwise retain incumbent.',
  scheduling: 'Reserve 180 calls for a 60-turn validation pair; skip a candidate round unless its own worst-case 180 calls and that reserve fit. Token reservation may stop any phase earlier.',
  interpretation: 'Whole-system comparison: graph arm has paid native Jev retrieval; transcript does not. One development and one validation episode are descriptive, not a powered superiority test. Validation compares selected graph configuration with transcript, not default graph versus candidate. Final test remains untouched.'
};
const TASK = LEDGER_PROTOCOL+'Track the ledger exactly across turns. Later explicit events supersede older values. Use only supplied evidence; missing values are null. Follow the query semantics. Your human answer must be exactly one JSON object with the single key "answer". Do not include internal memory in that human answer. No tools are available.';
const PROVIDER_SYSTEM = 'You are a careful assistant. Follow the supplied task and output protocol. Preserve explicit facts, corrections and revocations accurately. Do not claim external actions.';
const BASELINE_FORMAT = '\nUse a structured FINAL response: FINAL {"answer":"<the human answer JSON encoded as a string>","state":[]}. You may put optional durable memory entries in state; your entire raw response is preserved in the transcript. Do not produce explanations or TOOL_CALL.';
const digest = data => createHash('sha256').update(data).digest('hex');
const iso = () => new Date().toISOString();
export function chooseCandidate(incumbent, candidate) {
  const a = incumbent.graph, b = candidate.graph;
  return b.protocolFailures <= a.protocolFailures && (b.lateCorrect > a.lateCorrect || (b.lateCorrect === a.lateCorrect && b.correct >= a.correct && b.inputTokens <= a.inputTokens * .95)) ? candidate : incumbent;
}

export function validNativeAnswers(request, response) {
  const keys=Object.keys(request.questions??{}), answers=response.answers;
  return answers&&typeof answers==='object'&&!Array.isArray(answers)&&Object.keys(answers).length===keys.length&&keys.every(key=>answers[key]?.type==='noul'&&typeof answers[key].noul==='number'&&Number.isFinite(answers[key].noul)&&answers[key].noul>=0&&answers[key].noul<=1);
}

export function extractTranscriptAnswer(text, parseFinal) {
  const direct=parseFinal(text);
  if(direct)return direct;
  const markers=[...text.matchAll(/^FINAL(?=\s|:|\{)/gim)];
  if(!/```|~~~|\bTOOL_CALL\b/i.test(text)&&markers.length===1&&markers[0].index>0){const terminal=parseFinal(text.slice(markers[0].index));if(terminal)return terminal;}
  const answer=text.trim();
  return answer&&!/^\s*(?:TOOL_CALL|FINAL)\b/i.test(answer)&&! /^(?:not an action|invalid|planning prose|i(?:'| wi| a)?ll|let me|first,|sure,? i(?:'| wi)ll)\b/i.test(answer)?{answer,state:[]}:undefined;
}

async function main() {
  const [sdkRoot, out] = process.argv.slice(2);
  if (!sdkRoot || !out) throw new Error('Usage: node pilot.mjs SDK_DIST_ROOT NEW_OUTPUT_DIRECTORY');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const receipt = fs.openSync(path.join(out, 'receipt.json'), 'wx', 0o600);
  fs.writeFileSync(receipt, JSON.stringify({protocol:protocol.id,startedAt:iso(),pid:process.pid})); fs.fsyncSync(receipt); fs.closeSync(receipt);
  const ledger = fs.openSync(path.join(out, 'events.jsonl'), 'ax', 0o600);
  const secrets = [process.env.ANTHROPIC_API_KEY, process.env.TYPESAFE_API_KEY].filter(Boolean);
  const record = item => {
    const text = JSON.stringify({at:iso(), ...item});
    if (secrets.some(secret => text.includes(secret))) throw new Error('Credential bytes detected: refusing artifact write');
    fs.writeSync(ledger, text+'\n'); fs.fsyncSync(ledger);
  };
  const budget = new Budget(protocol);
  let current = {phase:'preflight'}, fatal;
  const billed = {inputTokens:0, outputTokens:0};
  const episodes = [];
  const report = {protocol,startedAt:iso(),status:'running',episodes,roundsSkipped:[]};
  const save = () => fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...report,budget:budget.snapshot()},null,2),{mode:0o600});
  const deadline = setTimeout(()=>{ report.status='deadline'; report.completedAt=iso(); record({type:'stop',reason:'owned-process deadline',budget:budget.snapshot()});save();process.exit(2);},protocol.deadlineMinutes*60_000); deadline.unref();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (fatal) throw fatal;
    const target = new URL(String(url));
    const provider = target.origin+target.pathname === 'https://api.z.ai/api/anthropic/v1/messages' ? 'zai' : target.origin+target.pathname === 'https://api.typesafe.ai/v1/systemone' ? 'jev' : undefined;
    if (!provider || options.method !== 'POST' || target.search || target.username || target.password) throw new Error('Unapproved network request');
    const body = JSON.parse(String(options.body));
    if ((provider==='zai' && (body.model!==protocol.answeringModel || body.max_tokens!==1024 || body.stream!==false || body.tools || body.temperature!==0)) || (provider==='jev' && body.model!==protocol.recallModel)) throw new Error('Request violates frozen model policy');
    if (provider==='zai' && Buffer.byteLength(JSON.stringify({system:body.system,messages:body.messages}))>64_000) throw new Error('Shared conservative input byte ceiling exceeded; no truncation');
    let reservation;
    try { reservation=budget.reserve(body,provider); } catch(error) { fatal=error;throw error; }
    const id = budget.calls;
    record({type:'dispatch',id,context:current,provider,request:body,reservation});
    const started=performance.now();
    let raw;
    try {
      const response=await realFetch(target,{...options,redirect:'error',signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000)});
      const text=await response.clone().text();
      if (Buffer.byteLength(text)>256_000) throw new Error('Response exceeds archive bounds');
      raw=JSON.parse(text);
      const safeResponse = provider==='zai' ? {id:raw.id,model:raw.model,stop_reason:raw.stop_reason,usage:raw.usage,content:(raw.content??[]).filter(part=>part.type==='text').map(part=>({type:'text',text:part.text}))} : {model:raw.model,usage:raw.usage,answers:raw.answers};
      record({type:'response',id,context:current,provider,httpStatus:response.status,elapsedMs:Math.round(performance.now()-started),response:safeResponse});
      if(!response.ok) throw new Error('Provider HTTP failure');
      budget.settle(reservation,raw.usage);
      billed.inputTokens+=raw.usage.input_tokens+(raw.usage.cache_read_input_tokens??0)+(raw.usage.cache_creation_input_tokens??0);
      billed.outputTokens+=raw.usage.output_tokens;
      if(raw.model!==body.model) throw new Error('Served model identity mismatch');
      if(provider==='jev'&&(Buffer.byteLength(text)>100_000||!validNativeAnswers(body,raw)))throw new Error('Native recall response failed the SDK contract; stopping before fallback');
      if (provider==='zai' && raw.usage.output_tokens>1024) throw new Error('Provider exceeded output cap');
      record({type:'accounting',id,budget:budget.snapshot()});
      return response;
    } catch(error) {
      fatal=error instanceof BudgetStop ? error : new Error('Provider or accounting failure; no retries');
      record({type:'request_failure',id,context:current,provider,errorType:error.name,usageKnown:Boolean(raw?.usage),budget:budget.snapshot()});
      throw fatal;
    }
  };
  try {
    const endpoint=new URL(process.env.ANTHROPIC_BASE_URL??'');
    if(endpoint.href.replace(/\/$/,'')!=='https://api.z.ai/api/anthropic' || process.env.ANTHROPIC_MODEL!==protocol.answeringModel || !process.env.ANTHROPIC_API_KEY || !process.env.TYPESAFE_API_KEY) throw new Error('Configured model/provider/native-recall setup mismatch');
    const runtimeHashes={};
    const hashTree=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())hashTree(file);else if(entry.name.endsWith('.js'))runtimeHashes[path.relative(sdkRoot,file)]=digest(fs.readFileSync(file));}};
    for(const dir of ['agent','core','llm','integrations'])hashTree(path.join(sdkRoot,dir));
    const runtimeLock=JSON.parse(fs.readFileSync(new URL('runtime-lock.json',import.meta.url),'utf8'));
    if(JSON.stringify(runtimeLock.files)!==JSON.stringify(runtimeHashes))throw new Error('Deployed SDK changed since offline snapshot: refusing calls');
    const sourceHashes={};
    for(const file of ['pilot.mjs','ledger.mjs','budget.mjs','runtime-lock.json'])sourceHashes[file]=digest(fs.readFileSync(new URL(file,import.meta.url)));
    const cohortHashes={};
    for(const [split,seeds] of Object.entries(protocol.cohort))cohortHashes[split]=digest(JSON.stringify(seeds.map(createEpisode)));
    report.manifest={node:process.version,runtimeHashes,sourceHashes,cohortHashes,policySha256:digest(TASK+PROVIDER_SYSTEM+BASELINE_FORMAT)};
    record({type:'manifest',manifest:report.manifest,protocol});save();
    const {Agent}=await import(pathToFileURL(path.join(sdkRoot,'agent/agent.js')));
    const {parseFinal,transcriptAgentSystemPrompt}=await import(pathToFileURL(path.join(sdkRoot,'agent/toolProtocol.js')));
    const {createJevRecallClient}=await import(pathToFileURL(path.join(sdkRoot,'integrations/jevRecall.js')));
    const answeringModel={async complete(input){
      const response=await globalThis.fetch(endpoint.href.replace(/\/$/,'')+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':process.env.ANTHROPIC_VERSION??'2023-06-01'},body:JSON.stringify({model:protocol.answeringModel,max_tokens:1024,temperature:0,stream:false,system:input.system??PROVIDER_SYSTEM,messages:input.messages??[{role:'user',content:input.prompt}]}),signal:input.signal});
      const body=await response.json();
      return {text:(body.content??[]).filter(part=>part.type==='text').map(part=>part.text).join(''),usage:{inputTokens:body.usage.input_tokens+(body.usage.cache_read_input_tokens??0)+(body.usage.cache_creation_input_tokens??0),outputTokens:body.usage.output_tokens}};
    }};
    const stats=()=>({correct:0,lateCorrect:0,turns:0,lateTurns:0,protocolFailures:0,parseErrors:0,inputTokens:0,outputTokens:0,calls:0,latencyMs:0});
    const pair=async(phase,nodes,seed,turnLimit=60)=>{
      const episode=createEpisode(seed);
      const agent=new Agent({model:answeringModel,tools:[],maxIterations:1,maxPromptTokens:64000,projectionTargetTokens:16000,projectionMaxNodes:nodes,contextMode:'causal',systemPrompt:TASK+BASELINE_FORMAT,providerSystem:PROVIDER_SYSTEM,enforceCompletionEvidence:false});
      const history=[];
      const summary={phase,nodes,seed,graph:stats(),transcript:stats(),complete:false};episodes.push(summary);
      let priorNodes=0;
      for(const turn of episode.turns.slice(0,turnLimit)){
        const order=(seed+turn.turn)%2 ? ['graph','transcript'] : ['transcript','graph'];
        record({type:'pair_start',phase,nodes,seed,turn:turn.turn,order,input:turn.input});
        for(const arm of order){
          current={phase,nodes,seed,turn:turn.turn,arm};
          const before=budget.snapshot();const beforeBilled={...billed};const started=performance.now();let answer='',protocolFailure=false,result;
          try{
            if(arm==='graph'){
              result=await agent.run(turn.input);
              answer=result.finalAnswer;
            }else{
              const content=(history.length?'':transcriptAgentSystemPrompt(TASK,[])+BASELINE_FORMAT+'\n\n')+turn.input;
              history.push({role:'user',content});
              const output=await answeringModel.complete({system:PROVIDER_SYSTEM,messages:history});
              history.push({role:'assistant',content:output.text});
              const parsed=extractTranscriptAnswer(output.text,parseFinal);
              if(!parsed)protocolFailure=true;
              else answer=parsed.answer;
            }
          }catch(error){if(fatal)throw fatal;protocolFailure=true;record({type:'participant_failure',context:current,errorType:error.name});}
          const score=scoreAnswer(answer,turn.expected);
          const cost=budget.knownTokens-before.knownTokens;
          const target=summary[arm];target.turns++;target.calls+=budget.calls-before.calls;target.latencyMs+=Math.round(performance.now()-started);
          target.inputTokens+=billed.inputTokens-beforeBilled.inputTokens;target.outputTokens+=billed.outputTokens-beforeBilled.outputTokens;
          target.protocolFailures+=Number(protocolFailure);target.parseErrors+=Number(score.parseError);target.correct+=Number(!protocolFailure&&score.correct);
          if(turn.turn>=41){target.lateTurns++;target.lateCorrect+=Number(!protocolFailure&&score.correct);}
          const eventsCost={totalProviderTokens:cost};
          record({type:'outcome',context:current,category:turn.category,answer,expected:turn.expected,correct:!protocolFailure&&score.correct,protocolFailure,parseError:score.parseError,cost:eventsCost,...(result?{stateDelta:result.state.nodes.slice(priorNodes),frontier:result.state.frontier,trace:result.trace,recall:result.metadata.recall}:{})});
          if(result)priorNodes=result.state.nodes.length;
          save();
        }
      }
      summary.complete=true;save();return summary;
    };
    const calibration=await pair('calibration',48,protocol.calibrationSeed,1);
    if(calibration.graph.correct!==1||calibration.transcript.correct!==1)throw new Error('Output/oracle calibration failed; no scored calls');
    current={phase:'calibration-native'};
    const native=createJevRecallClient();
    const ranking=await native.rank('What is the unit code?',[
      {id:'smoke-a',nodeId:'synthetic-a',kind:'goal',start:0,end:19,text:'The unit code is 7.',sourcePrefix:'The unit code is 7.',lexicalScore:0},
      {id:'smoke-b',nodeId:'synthetic-b',kind:'goal',start:0,end:16,text:'The sky is blue.',sourcePrefix:'The sky is blue.',lexicalScore:0}
    ]);
    if(ranking.scores[0].relevance<=ranking.scores[1].relevance)throw new Error('Native recall calibration failed');
    record({type:'calibration_passed',budget:budget.snapshot()});
    let incumbent=await pair('development-baseline',protocol.baselineNodes,protocol.devSeed);
    for(const nodes of protocol.candidateNodes){
      if(budget.maxCalls-budget.calls<360){report.roundsSkipped.push({nodes,reason:'reserve 180 calls for validation plus 180 for candidate'});continue;}
      const candidate=await pair('development-candidate',nodes,protocol.devSeed);
      incumbent=chooseCandidate(incumbent,candidate);
      record({type:'selection',candidateNodes:nodes,selectedNodes:incumbent.nodes,selection:protocol.selection});
    }
    report.selectedNodes=incumbent.nodes;
    report.selectionDevelopmentPhase=incumbent.phase;
    if(budget.maxCalls-budget.calls>=180)await pair('validation-selected',incumbent.nodes,protocol.validationSeed);
    else report.roundsSkipped.push({phase:'validation',reason:'insufficient call reserve'});
    report.status=episodes.some(e=>e.phase==='validation-selected'&&e.complete)?'completed':'incomplete';
    report.finalTestCalls=0;
  }catch(error){report.status=fatal instanceof BudgetStop?'budget_stopped':fatal?'provider_stopped':'preflight_or_harness_stopped';report.errorType=error.name;report.reason=secrets.reduce((text,key)=>text.replaceAll(key,'[redacted]'),String(error.message)).slice(0,240);record({type:'stop',status:report.status,errorType:error.name,reason:report.reason,budget:budget.snapshot()});}
  finally{clearTimeout(deadline);report.completedAt=iso();save();fs.closeSync(ledger);}
  if(report.status!=='completed')process.exitCode=2;
  console.log(JSON.stringify({status:report.status,selectedNodes:report.selectedNodes,budget:budget.snapshot(),episodes:episodes.map(({phase,nodes,complete,graph,transcript})=>({phase,nodes,complete,graph,transcript}))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
