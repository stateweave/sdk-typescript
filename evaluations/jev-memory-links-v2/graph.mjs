import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dist=process.env.SDK_DIST??new URL('../../dist/',import.meta.url).pathname;
const {CausalWeave}=await import(pathToFileURL(path.join(dist,'core/causalWeave.js')));
export function graphCase(pairs,decisions,maxNodes=8) {
 const weave=new CausalWeave();
 const root=weave.append({kind:'system',payload:'Use only the recorded release facts. Say unknown when information is missing.',parents:[],advance:false});
 const nodes=new Map(),factForNode=new Map();
 const aliases=[];
 for(const [i,pair]of pairs.entries()){
  const ids=[];
  for(const [j,content] of [pair.left,pair.right].entries()){
   const key=`n${i}-${j}`;
   const node=weave.append({kind:'semantic',payload:{type:'memory',key,content},parents:[root.id],resourceKey:`semantic:memory:${key}`,advance:false});
   ids.push(node.id);factForNode.set(node.id,pair.id);
  }
  nodes.set(pair.id,ids);
  if(decisions.get(pair.id)==='equivalent')aliases.push({from:ids[0],to:ids[1]});
 }
 const entity=[...new Set(pairs.map(p=>p.left.split(' ')[0]))].join(' and ');
 const query=`What are all the recorded ${entity} release constraints?`;
 const sourceState=weave.snapshot();
 for(const node of sourceState.nodes)node.createdAt='2030-01-01T00:00:00.000Z';
 weave.append({kind:'goal',payload:query,parents:[root.id]});
 const state=weave.snapshot();
 for(const node of state.nodes)node.createdAt='2030-01-01T00:00:00.000Z';
 const compiled=new CausalWeave(state).compile({query,contextMode:'molecular',maxNodes,maxTokens:64000,targetTokens:16000,semanticAliases:aliases});
 const covered=[...new Set(compiled.nodeIds.map(id=>factForNode.get(id)).filter(Boolean))];
 return {sourceState,state,compiled,covered,aliases,query,maxNodes,nodeFacts:Object.fromEntries(factForNode),pairs:pairs.map(p=>p.id),facts:pairs.map(p=>p.left)};
}
