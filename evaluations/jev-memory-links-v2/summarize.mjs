import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=process.argv[2];if(!dir)throw Error('Supply the frozen results directory');
const links=JSON.parse(await readFile(path.join(dir,'links-summary.json'),'utf8'));
const files=(await readdir(dir)).filter(f=>/^graph-\d+-(deterministic|exact|jev)\.json$/.test(f)).sort();
assert.equal(files.length,9);
const rows=await Promise.all(files.map(async file=>{
 const r=JSON.parse(await readFile(path.join(dir,file),'utf8'));
 const m=r.result?.metadata;
 return {file,arm:r.arm,status:r.status,initialHash:r.initialHash,facts:r.graph.pairs.length,cap:r.graph.maxNodes,covered:r.covered?.length??0,aliases:r.graph.aliases.length,modelCalls:m?.modelCalls,inputTokens:m?.totalInputTokens,outputTokens:m?.outputTokens,latencyMs:r.elapsedMs,preserved:r.graphPreserved&&r.readSetsPreserved,final:r.result?.finalAnswer};
}));
for(let i=0;i<3;i++)assert.equal(new Set(rows.filter(r=>r.file.startsWith(`graph-${i}-`)).map(r=>r.initialHash)).size,1);
console.log(JSON.stringify({links:{...links,ledger:links.ledger.map(({id,expected,relation,equivalent,conflicting})=>({id,expected,relation,equivalent,conflicting}))},rows},null,2));
