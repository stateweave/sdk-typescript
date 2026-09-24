import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { askJev, groundMemories, createRecovery, parseMemories } from '../evaluations/jev-quality-v1/checkpoints.mjs';
const memory={type:'memory',key:'city',content:'The user lives in Oslo.'};
const save=async()=>{};
function fake(scores) { return async (_url,options)=>{ const request=JSON.parse(options.body);const values=typeof scores==='function'?scores(request):scores;return {ok:true,json:async()=>({model:'jev-1.13.0',answers:Object.fromEntries(Object.keys(request.questions).map((id,index)=>[id,{type:'noul',noul:values[index]??values[0]}])),usage:{input_tokens:50,output_tokens:10}})}; }; }
it('parses bounded proposals but rejects duplicates, oversize or unsupported structures',()=>{
 expect(parseMemories(JSON.stringify({memories:[memory]}))).toEqual([memory]);
 expect(()=>parseMemories(JSON.stringify({memories:[memory,memory]}))).toThrow();
 expect(()=>parseMemories(JSON.stringify({memories:[{...memory,content:'x'.repeat(701)}]}))).toThrow();
 expect(()=>parseMemories('{"answer":"wrong schema"}')).toThrow();
});
it('uses grounded promotion thresholds and fails open when the optional service fails',async()=>{
 const args={apiKey:'mock-key',save,fetchImpl:fake([0.8,0.79])};
 const result=await groundMemories([], [memory,{...memory,key:'second'}],args);
 expect(result.accepted).toEqual([true,false]);
 const failed=await groundMemories([], [memory],{...args,fetchImpl:async()=>{throw Error('offline');}});
 expect(failed.status).toBe('fallback');expect(failed.accepted).toEqual([true]);
});
it('rejects malformed scores and a changed model instead of trusting partial judgments',async()=>{
 await expect(askJev({}, {a:{type:'noul',instructions:'test'}}, {apiKey:'mock-key',save,label:'test',fetchImpl:fake([NaN])})).rejects.toThrow();
 await expect(askJev({}, {}, {apiKey:'mock-key',save,label:'test',fetchImpl:async()=>({ok:true,json:async()=>({model:'jev-latest',answers:{},usage:{input_tokens:0,output_tokens:0}})})})).rejects.toThrow();
});
it('keeps sufficient projections unchanged without a ranking call',async()=>{
 let calls=0; const fetchImpl=async(...args)=>{calls++;return fake([0.9])(...args)};
 const diagnostics={};
 const ids=await createRecovery({apiKey:'mock-key',save,label:'test',fetchImpl},diagnostics)({query:'test',state:{nodes:[]},compiled:{nodeIds:[]}});
 expect(ids).toEqual([]);expect(calls).toBe(1);expect(diagnostics.status).toBe('sufficient');
});
it('selects only bounded, unselected current sources and leaves uncertain evidence available',async()=>{
 const nodes=[{id:'visible',kind:'resource',payload:'present'},{id:'old',kind:'semantic',resourceKey:'k',payload:'old'},...Array.from({length:8},(_,i)=>({id:'source-'+i,kind:'resource',resourceKey:'r'+i,payload:'source'})),{id:'new',kind:'semantic',resourceKey:'k',payload:'new'}];
 const diagnostics={};
 const hook=createRecovery({apiKey:'mock-key',save,label:'test',fetchImpl:fake(request=>Object.hasOwn(request.questions,'sufficient')?[0.1]:[0.95])},diagnostics);
 const result=await hook({query:'test',state:{nodes},compiled:{nodeIds:['visible']}});
 expect(result).toHaveLength(6);expect(result).not.toContain('old');expect(result).not.toContain('visible');expect(nodes).toHaveLength(11);
});
it('freezes 32 independent external cases without private labels in participant files or runner',()=>{
 const bytes=readFileSync(new URL('../evaluations/jev-quality-v1/cases.json',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('cdec87a7d7956b0fe61566a3619419c657ec2d90e74fe1760aede18d77f7e52a');
 const cases=JSON.parse(bytes);expect(cases).toHaveLength(32);
 const sessionIds=cases.flatMap(c=>c.sessions.map(s=>s.id));expect(new Set(sessionIds).size).toBe(sessionIds.length);
 for(const c of cases){expect(Object.keys(c).sort()).toEqual(['id','question','questionDate','sessions']);for(const s of c.sessions){expect(s.id).toMatch(/^source-[a-f0-9]{16}$/);}for(const s of c.sessions)for(const t of s.turns)expect(Object.keys(t).sort()).toEqual(['content','role']);}
 const runner=readFileSync(new URL('../evaluations/jev-quality-v1/run.mjs',import.meta.url),'utf8');
 expect(runner).not.toContain('private-gold.json');expect(runner).not.toContain('questionType');expect(runner).not.toContain('has_answer');
});
