import { describe, expect, it } from "vitest";
import { CausalWeave } from "../src/core/causalWeave.js";
import { Agent } from "../src/agent/agent.js";

function fixture() {
 const weave=new CausalWeave();
 const root=weave.append({kind:"system",payload:"Notes",parents:[],advance:false});
 const add=(key:string,content:string)=>weave.append({kind:"semantic",payload:{type:"memory",key,content},parents:[root.id],resourceKey:`semantic:memory:${key}`,advance:false});
 const a=add("a","Vega release owner is Nadia.");
 const b=add("b","Nadia owns the Vega release.");
 const c=add("c","Vega release needs security review.");
 const beforeGoal=weave.snapshot();
 const goal=weave.append({kind:"goal",payload:"What are Vega release constraints?",parents:[root.id]});
 return {weave,a,b,c,goal,add,beforeGoal};
}
describe("experimental semantic projection aliases",()=>{
 it("preserves source truth and uses only original visible IDs",()=>{
  const {weave,a,b}=fixture(), before=weave.snapshot();
  const result=weave.compile({semanticAliases:[{from:a.id,to:b.id}]});
  expect(result.nodeIds).not.toContain(a.id);expect(result.nodeIds).toContain(b.id);
  expect(result.semanticAliases).toEqual([{from:a.id,to:b.id}]);
  expect(weave.snapshot()).toEqual(before);
  expect(result.nodeIds.every(id=>before.nodes.some(n=>n.id===id))).toBe(true);
 });
 it("is identical when disabled",()=>{
  const {weave}=fixture();expect(weave.compile()).toEqual(weave.compile({semanticAliases:[]}));
 });
 it("refuses chains and duplicate source bindings",()=>{
  const {weave,a,b,c}=fixture();
  for(const links of [[{from:a.id,to:b.id},{from:b.id,to:c.id}],[{from:a.id,to:b.id},{from:a.id,to:c.id}]])expect(weave.compile({semanticAliases:links})).toEqual(weave.compile());
 });
 it("ignores stale representatives instead of following replacements",()=>{
  const {weave,a,b,add}=fixture();add("b","Vega release owner is Owen.");
  expect(weave.compile({semanticAliases:[{from:a.id,to:b.id}]})).toEqual(weave.compile());
 });
 it("never aliases goals or fresh current-turn evidence",()=>{
  const {weave,a,b,goal,add}=fixture();
  const fresh=add("fresh","New current evidence"),newer=add("newer","New current evidence");
  expect(weave.compile({semanticAliases:[{from:goal.id,to:b.id},{from:fresh.id,to:newer.id},{from:a.id,to:"missing"}]})).toEqual(weave.compile());
 });
 it("keeps limits and fails closed on malformed alias objects",()=>{
  const {weave,a,b}=fixture();
  expect(weave.compile({maxNodes:3,semanticAliases:[{from:a.id,to:b.id}]}).nodeIds.length).toBeLessThanOrEqual(3);
  expect(weave.compile({semanticAliases:[null] as never})).toEqual(weave.compile());
  expect(()=>weave.compile({semanticAliases:Array.from({length:257},()=>({from:a.id,to:b.id}))})).toThrow("256");
 });
 it("bypasses aliases for source-sensitive questions and explicit preferences",()=>{
  const {weave,a,b}=fixture();const semanticAliases=[{from:a.id,to:b.id}];
  for(const query of ["Quote the original wording", "What did earlier records say?", "Audit provenance", "Give exact text"]){
   expect(weave.compile({query,semanticAliases})).toEqual(weave.compile({query}));
  }
  expect(weave.compile({preferredNodeIds:[a.id],semanticAliases})).toEqual(weave.compile({preferredNodeIds:[a.id]}));
 });
 it("keeps lexical access through either equivalent wording",()=>{
  const weave=new CausalWeave();
  const root=weave.append({kind:"system",payload:"Records",parents:[],advance:false});
  const a=weave.append({kind:"semantic",payload:{type:"memory",content:"Her occupation is nursing."},parents:[root.id],resourceKey:"semantic:memory:a",advance:false});
  const b=weave.append({kind:"semantic",payload:{type:"memory",content:"She works as a nurse."},parents:[root.id],resourceKey:"semantic:memory:b",advance:false});
  weave.append({kind:"goal",payload:"What is her occupation?",parents:[root.id]});
  const compiled=weave.compile({query:"What is her occupation?",semanticAliases:[{from:a.id,to:b.id}]});
  expect(compiled.nodeIds).toContain(b.id);expect(compiled.nodeIds).not.toContain(a.id);
 });
 it("preserves Agent success-only state and actual answer parents",async()=>{
  const {beforeGoal,a,b}=fixture();
  const model={async complete(){return {text:"FINAL: Nadia owns Vega."};},async *stream(){yield {type:"token" as const,token:"FINAL: Nadia owns Vega."};}};
  const agent=new Agent({model,tools:[],state:beforeGoal,semanticAliases:[{from:a.id,to:b.id}]});
  const result=await agent.run("Who owns the Vega release?");
  expect(result.state.nodes.slice(0,beforeGoal.nodes.length)).toEqual(beforeGoal.nodes);
  expect(result.trace.at(-1)!.nodeIds).not.toContain(a.id);
  expect(result.state.nodes.filter(n=>n.kind==="answer").at(-1)!.parents).toEqual([...result.trace.at(-1)!.nodeIds].sort());
 });
});
