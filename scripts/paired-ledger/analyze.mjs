import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {scoreAnswer} from './ledger.mjs';
import {chooseCandidate,protocol} from './pilot.mjs';

const [directory]=process.argv.slice(2);
if(!directory)throw new Error('Usage: node analyze.mjs RECEIPT_DIRECTORY');
const reportPath=path.join(directory,'report.json'), eventsPath=path.join(directory,'events.jsonl');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
if(report.status==='running')throw new Error('Do not analyze an active run');
const events=fs.readFileSync(eventsPath,'utf8').trim().split('\n').map(JSON.parse);
const dispatches=events.filter(e=>e.type==='dispatch'), responses=events.filter(e=>e.type==='response'), outcomes=events.filter(e=>e.type==='outcome');
const checks=[];
const check=(name,ok)=>{checks.push({name,pass:Boolean(ok)});if(!ok)throw new Error('Evidence check failed: '+name);};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const validUsage=u=>u&&['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)&&['cache_read_input_tokens','cache_creation_input_tokens'].every(k=>u[k]===undefined||(Number.isSafeInteger(u[k])&&u[k]>=0));
const usage=u=>({inputTokens:u.input_tokens+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0),outputTokens:u.output_tokens});
const key=c=>JSON.stringify([c.phase,c.nodes,c.seed,c.turn,c.arm]);
check('frozen protocol identity',report.protocol.id===protocol.id);
for(const [file,expected] of Object.entries(report.manifest.sourceHashes))check('source hash '+file,hash(new URL(file,import.meta.url))===expected);
check('call cap / contiguous request identities',dispatches.length===report.budget.calls&&dispatches.length<=600&&dispatches.every((d,i)=>d.id===i+1));
const responseIds=new Set(responses.map(row=>row.id));
check('at most one response per authorized dispatch',responseIds.size===responses.length&&responses.every(row=>dispatches[row.id-1]?.provider===row.provider));
const unreturned=dispatches.filter(row=>!responseIds.has(row.id));
check('token ceiling including unresolved reservations',report.budget.knownTokens+report.budget.unresolvedReservedTokens<=3_000_000);
check('no final-test dispatch',dispatches.every(d=>!protocol.cohort.finalTest.includes(d.context.seed)));
check('only authorized development/validation/calibration visits',dispatches.every(d=>d.context.seed===undefined||[protocol.devSeed,protocol.validationSeed,protocol.calibrationSeed].includes(d.context.seed)));
check('no duplicate participant/provider dispatches or retries',new Set(dispatches.map(d=>key(d.context)+d.provider)).size===dispatches.length);
check('one visible outcome per participant turn',new Set(outcomes.map(e=>key(e.context))).size===outcomes.length);
check('frozen final-only scoring',outcomes.every(e=>e.correct===Boolean(!e.protocolFailure&&scoreAnswer(e.answer,e.expected).correct)));
const known=responses.filter(r=>r.httpStatus>=200&&r.httpStatus<300&&validUsage(r.response.usage));
const total=known.reduce((n,r)=>{const u=usage(r.response.usage);return n+u.inputTokens+u.outputTokens;},0);
check('all successful response usage reconciles',total===report.budget.knownTokens);
const settledIds=new Set(known.map(row=>row.id));
check('all unresolved dispatch reservations reconcile',dispatches.filter(row=>!settledIds.has(row.id)).reduce((n,row)=>n+row.reservation,0)===report.budget.unresolvedReservedTokens);
check('configured identities and GLM limits',dispatches.every(d=>d.request.model===(d.provider==='zai'?protocol.answeringModel:protocol.recallModel)&&(d.provider!=='zai'||(d.request.max_tokens===1024&&d.request.temperature===0&&d.request.stream===false&&!d.request.tools))));
check('served model identities',known.every(r=>r.response.model===(r.provider==='zai'?protocol.answeringModel:protocol.recallModel)));
check('provider-reported GLM output cap',known.filter(r=>r.provider==='zai').every(r=>r.response.usage.output_tokens<=1024));
check('no reported server-side tools',known.filter(r=>r.provider==='zai').every(r=>Object.values(r.response.usage.server_tool_use??{}).every(n=>n===0)));
const recallStatuses={};
for(const row of outcomes.filter(e=>e.context.arm==='graph'&&e.recall))recallStatuses[row.recall.status]=(recallStatuses[row.recall.status]??0)+1;
check('no completed study silently uses lexical fallback',report.status!=='completed'||!recallStatuses.fallback);
const providers={};
for(const provider of ['zai','jev']){
  const rows=known.filter(r=>r.provider===provider);
  providers[provider]={attempts:dispatches.filter(r=>r.provider===provider).length,responses:rows.length,inputTokens:0,outputTokens:0,totalLatencyMs:0,maxOutputTokens:0,...(provider==='jev'?{classifiedQuestions:dispatches.filter(r=>r.provider===provider).reduce((sum,r)=>sum+Object.keys(r.request.questions).length,0)}:{})};
  for(const row of rows){const u=usage(row.response.usage);providers[provider].inputTokens+=u.inputTokens;providers[provider].outputTokens+=u.outputTokens;providers[provider].totalLatencyMs+=row.elapsedMs;providers[provider].maxOutputTokens=Math.max(providers[provider].maxOutputTokens,row.response.usage.output_tokens);}
}
const episodes=[];
for(const episode of report.episodes){
  const result={phase:episode.phase,nodes:episode.nodes,seed:episode.seed,complete:episode.complete,arms:{},primary:episode.complete&&episode.phase!=='calibration'?{}:null};
  for(const arm of ['graph','transcript']){
    const same=c=>c.phase===episode.phase&&c.nodes===episode.nodes&&c.seed===episode.seed&&c.arm===arm;
    const scored=outcomes.filter(e=>same(e.context));
    const actual=known.filter(e=>same(e.context));
    const stats=episode[arm];
    check(episode.phase+' '+arm+' outcomes/correct',scored.length===stats.turns&&scored.filter(e=>e.correct).length===stats.correct&&scored.filter(e=>e.correct&&e.context.turn>=41).length===stats.lateCorrect);
    if(episode.complete){
      const tokens=actual.reduce((n,e)=>{const u=usage(e.response.usage);return n+u.inputTokens+u.outputTokens;},0);
      check(episode.phase+' '+arm+' token attribution',tokens===stats.inputTokens+stats.outputTokens);
    }
    const categories={};
    for(const row of scored){const bucket=categories[row.category]??={correct:0,total:0};bucket.correct+=Number(row.correct);bucket.total++;}
    const generations=actual.filter(row=>row.provider==='zai');
    const truncatedResponses=generations.filter(row=>row.response.stop_reason==='max_tokens').length;
    const emptyVisibleResponses=generations.filter(row=>!row.response.content.some(part=>part.text?.trim())).length;
    result.arms[arm]={...stats,meanEndToEndMs:stats.turns?Math.round(stats.latencyMs/stats.turns):null,truncatedResponses,emptyVisibleResponses,categories};
    if(result.primary)result.primary[arm]={correct:stats.lateCorrect,total:20,accuracy:stats.lateCorrect/20};
  }
  episodes.push(result);
}
let incumbent=report.episodes.find(e=>e.phase==='development-baseline'&&e.complete);
if(incumbent){for(const candidate of report.episodes.filter(e=>e.phase==='development-candidate'&&e.complete))incumbent=chooseCandidate(incumbent,candidate);if(report.selectedNodes!==undefined)check('frozen candidate selection replay',incumbent.nodes===report.selectedNodes);}
const analysis={analysisVersion:1,status:report.status,reason:report.reason,startedAt:report.startedAt,completedAt:report.completedAt,elapsedMinutes:Math.round((Date.parse(report.completedAt)-Date.parse(report.startedAt))/6000)/10,provenance:{preregisteredCommit:'19944ec1e2fd60844098881f20f8f0e0960bfb82',analysisSourceSha256:hash(fileURLToPath(import.meta.url)),reportSha256:hash(reportPath),eventsSha256:hash(eventsPath)},checks,providers,recallStatuses,unreturned:unreturned.map(({id,provider,context,reservation})=>({id,provider,context,reservation})),budget:report.budget,selectedNodes:report.selectedNodes,roundsSkipped:report.roundsSkipped,episodes,limits:protocol.interpretation};
fs.writeFileSync(path.join(directory,'analysis.json'),JSON.stringify(analysis,null,2)+'\n');
console.log(JSON.stringify({status:analysis.status,checks:checks.length,providers,budget:analysis.budget,selectedNodes:analysis.selectedNodes,episodes:episodes.map(({phase,nodes,complete,primary,arms})=>({phase,nodes,complete,primary,graph:arms.graph,transcript:arms.transcript}))},null,2));
