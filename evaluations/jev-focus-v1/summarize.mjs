import { readdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.argv[2];if(!root)throw Error('Pass the results directory');
const files=(await readdir(root)).filter(f=>f.endsWith('.json')&&!f.endsWith('.started.json')&&f!=='protocol.json'&&f!=='summary.json');
const rows=[];for(const f of files)rows.push(JSON.parse(await readFile(path.join(root,f),'utf8')));
const arms=['deterministic','flat','hierarchical'];
const median=xs=>{const s=xs.slice().sort((a,b)=>a-b);return s.length?(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2:0};
function usage(r){const f=r.result?.metadata.focus??r.metrics?.focus;const stages=f?.ranking?.stages??f?.completedStages??[];return {input:f?.ranking?.inputTokens??stages.reduce((n,s)=>n+s.inputTokens,0),output:f?.ranking?.outputTokens??stages.reduce((n,s)=>n+s.outputTokens,0),latency:f?.latencyMs??0,calls:stages.length,incomplete:f?.usageIncomplete===true,fallback:f?.status==='fallback'};}
const sums=Object.fromEntries(arms.map(arm=>{
 const selected=rows.filter(r=>r.arm===arm),u=selected.map(usage);
 return [arm,{attempts:selected.length,completed:selected.filter(r=>r.status==='done').length,correct:selected.filter(r=>r.correct).length,fullPass:selected.filter(r=>r.fullPass).length,meanRequiredRecall:selected.length?selected.reduce((n,r)=>n+(r.recall??0),0)/selected.length:0,medianLatencyMs:median(selected.map(r=>r.elapsedMs)),medianJevLatencyMs:median(u.map(x=>x.latency)),modelInputTokens:selected.reduce((n,r)=>n+(r.result?.metadata.totalInputTokens??r.metrics?.totalInputTokens??0),0),modelOutputTokens:selected.reduce((n,r)=>n+(r.result?.metadata.outputTokens??r.metrics?.outputTokens??0),0),jevInputTokens:u.reduce((n,x)=>n+x.input,0),jevOutputTokens:u.reduce((n,x)=>n+x.output,0),jevCompletedCalls:u.reduce((n,x)=>n+x.calls,0),fallbacks:u.filter(x=>x.fallback).length,incompleteUsage:u.filter(x=>x.incomplete).length}];
}));
const ids=[...new Set(rows.map(r=>r.id))];
function binomial(n,k){let p=1;for(let i=1;i<=k;i++)p=p*(n-i+1)/i;return p;}
const comparisons=['deterministic','flat'].map(other=>{let wins=0,losses=0,ties=0,incomplete=0;for(const id of ids){const a=rows.find(r=>r.id===id&&r.arm==='hierarchical'),b=rows.find(r=>r.id===id&&r.arm===other);if(!a||!b||a.status!=='done'||b.status!=='done'){incomplete++;continue;}if(a.fullPass===b.fullPass)ties++;else if(a.fullPass)wins++;else losses++;}const n=wins+losses,p=Math.min(1,2*Array.from({length:Math.min(wins,losses)+1},(_,k)=>binomial(n,k)/2**n).reduce((a,b)=>a+b,0));return {hierarchicalVersus:other,wins,losses,ties,incomplete,p};});
const ordered=comparisons.slice().sort((a,b)=>a.p-b.p);let prior=0;for(let i=0;i<ordered.length;i++){prior=Math.max(prior,Math.min(1,ordered[i].p*(ordered.length-i)));ordered[i].holmAdjustedP=prior;}
const ledger=ids.map(id=>({id,...Object.fromEntries(arms.map(arm=>{const r=rows.find(r=>r.id===id&&r.arm===arm);return [arm,r?{status:r.status,correct:r.correct,fullPass:r.fullPass,recall:r.recall,latencyMs:r.elapsedMs,focus:r.result?.metadata.focus?.status??'off',freshRead:r.freshRead,budget:r.budget,provenance:r.provenance,preserved:r.preserved,error:r.error}:null]}))}));
const summary={arms:sums,comparisons,ledger,caveat:'Twelve designed pilot cases; no general quality claim. Error cases need operational classification before inference. Jev overhead is separate and must be added for total efficiency.'};
await writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({arms:sums,comparisons},null,2));
