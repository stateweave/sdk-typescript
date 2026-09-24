import {createHash} from 'node:crypto';
import {judgePairs as originalJudge,exactEquivalent,model} from '../jev-memory-links-v1/linker.mjs';
export {exactEquivalent,model};
export const protocol='jev-memory-links-v2';
export const pairKey=p=>createHash('sha256').update(JSON.stringify([protocol,model,p.left,p.right])).digest('hex');
export async function judgePairs(pairs,options){
 const result=await originalJudge(pairs,options);
 return {...result,protocol,judgments:result.judgments.map((j,i)=>({...j,pairHash:pairKey(pairs[i]),originalRelation:j.relation,relation:exactEquivalent(pairs[i])||j.equivalent>=0.9&&j.conflicting<=0.1?'equivalent':j.conflicting>=0.97&&j.equivalent<=0.03?'conflicting':'none'}))};
}
