import { expect,it } from 'vitest';
import { judgePairs,pairKey,classify,model,exactEquivalent } from '../evaluations/jev-memory-links-v1/linker.mjs';
const pair={id:'private-id',left:'Vega is approved.',right:'Vega has approval.',expected:'equivalent'};
const raw={model,answers:{e0:{type:'noul',noul:0.99},c0:{type:'noul',noul:0.01}},usage:{input_tokens:100,output_tokens:20}};
it('binds judgments to exact text and excludes private evaluation fields',async()=>{
 let request;
 const result=await judgePairs([pair],{apiKey:'test-only',transport:async(_,init)=>{request=JSON.parse(init.body);return new Response(JSON.stringify(raw));}});
 expect(request.state.pairs).toEqual([{left:pair.left,right:pair.right}]);
 expect(JSON.stringify(request)).not.toContain('private-id');expect(JSON.stringify(request)).not.toContain('expected');
 expect(result.judgments[0]).toMatchObject({relation:'equivalent',pairHash:pairKey(pair)});
 expect(pairKey({...pair,right:'Vega is not approved.'})).not.toBe(pairKey(pair));
});
it('requires both positive evidence and absence of a contradictory judgment',()=>{
 expect(classify({equivalent:0.98,conflicting:0.5})).toBe('none');
 expect(classify({equivalent:0.9,conflicting:0})).toBe('none');
 expect(classify({equivalent:0.02,conflicting:0.99})).toBe('conflicting');
 expect(exactEquivalent({left:'A is ready.',right:'a is ready.'})).toBe(true);
 expect(exactEquivalent({left:'A is -5.',right:'A is 5.'})).toBe(false);
});
it('rejects malformed responses, missing usage, excessive input and HTTP failures',async()=>{
 for(const value of [{...raw,model:'jev-latest'},{...raw,usage:{}},{...raw,answers:{e0:{type:'noul',noul:2},c0:{type:'noul',noul:0}}}])await expect(judgePairs([pair],{apiKey:'test',transport:async()=>new Response(JSON.stringify(value))})).rejects.toThrow();
 await expect(judgePairs(Array(7).fill(pair),{apiKey:'test'})).rejects.toThrow('bounded');
 await expect(judgePairs([pair],{apiKey:'test',transport:async()=>new Response('',{status:503})})).rejects.toThrow('503');
});
it('propagates caller cancellation before inference',async()=>{
 await expect(judgePairs([pair],{apiKey:'test',signal:AbortSignal.abort(),transport:async()=>{throw Error('should not call');}})).rejects.toThrow();
});
