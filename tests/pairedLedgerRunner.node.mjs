import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Budget,BudgetStop} from '../scripts/paired-ledger/budget.mjs';
import {chooseCandidate,protocol,extractTranscriptAnswer,validNativeAnswers} from '../scripts/paired-ledger/pilot.mjs';
const body={max_tokens:1024,model:'glm-5.3-flash'};
test('call ceiling counts dispatches, not successful outcomes',()=>{
  const budget=new Budget({maxCalls:1});budget.reserve(body,'zai');
  assert.throws(()=>budget.reserve(body,'zai'),BudgetStop);assert.equal(budget.calls,1);
});
test('token reservation rejects before counting an unaffordable request',()=>{
  const budget=new Budget({maxTokens:100});assert.throws(()=>budget.reserve(body,'zai'),BudgetStop);assert.equal(budget.calls,0);
});
test('returned usage includes cache reads and creation',()=>{
  const budget=new Budget();const reservation=budget.reserve(body,'zai');budget.settle(reservation,{input_tokens:20,output_tokens:5,cache_read_input_tokens:7,cache_creation_input_tokens:3});
  assert.equal(budget.knownTokens,35);assert.equal(budget.unresolvedReservedTokens,0);
});
test('missing or negative usage is never free',()=>{
  for(const usage of [undefined,{input_tokens:-1,output_tokens:0},{input_tokens:0,output_tokens:0,cache_read_input_tokens:-1}]){
    const budget=new Budget();const reservation=budget.reserve(body,'zai');assert.throws(()=>budget.settle(reservation,usage),BudgetStop);assert.equal(budget.unresolvedReservedTokens,reservation);assert.equal(budget.unknownUsageCalls,1);
  }
});
test('exact reservation boundary fits, one byte less does not',()=>{
  const size=Buffer.byteLength(JSON.stringify(body))+4096+1024;
  assert.equal(new Budget({maxTokens:size}).reserve(body,'zai'),size);
  assert.throws(()=>new Budget({maxTokens:size-1}).reserve(body,'zai'),BudgetStop);
});
test('native recall and answering share a ledger; output caps are checked',()=>{
  const budget=new Budget();budget.reserve(body,'zai');budget.reserve({model:'jev-1.13.0'},'jev');assert.equal(budget.calls,2);
  assert.throws(()=>budget.reserve({max_tokens:1025},'zai'),BudgetStop);
});
test('selection rejects quality/failure regressions and weak cost changes',()=>{
  const base={graph:{lateCorrect:19,correct:58,protocolFailures:0,inputTokens:1000}};
  const candidate=patch=>({graph:{...base.graph,...patch}});
  for(const patch of [{lateCorrect:18,inputTokens:100},{correct:57,inputTokens:100},{protocolFailures:1,inputTokens:100},{inputTokens:951}])assert.equal(chooseCandidate(base,candidate(patch)),base);
  const cheap=candidate({inputTokens:950});assert.equal(chooseCandidate(base,cheap),cheap);
  const better=candidate({lateCorrect:20,inputTokens:1100});assert.equal(chooseCandidate(base,better),better);
});
test('only development and validation seeds are scheduled; final cohort disjoint',()=>{
  assert.equal(protocol.cohort.finalTest.length,10);assert.ok(![...protocol.cohort.development,...protocol.cohort.validation].some(s=>protocol.cohort.finalTest.includes(s)));
});
test('plain JSON human answers are not uniquely rejected by transcript control',()=>{
  assert.equal(extractTranscriptAnswer('{"answer":12}',()=>undefined).answer,'{"answer":12}');
  assert.equal(extractTranscriptAnswer('FINAL {broken',()=>undefined),undefined);
});
test('native malformed coverage, types and scores stop before SDK fallback',()=>{
  const request={questions:{q0:{}}};
  for(const answers of [{}, {other:{type:'noul',noul:.5}},{q0:{type:'noul',noul:2}},{q0:{type:'score',noul:.5}},{q0:{type:'noul',noul:'1'}}])assert.ok(!validNativeAnswers(request,{answers}));
  assert.ok(validNativeAnswers(request,{answers:{q0:{type:'noul',noul:.5}}}));
});
const sdk=process.env.PILOT_TEST_SDK;
for(const failure of [undefined,'missing-usage','native-missing-usage','native-invalid','transcript-malformed'])test('actual compiled SDK offline integration: '+(failure??'full run'),{skip:!sdk,timeout:120_000},()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'paired-ledger-integration-'));const out=path.join(temp,'run');
  try{
    const script=fileURLToPath(new URL('../scripts/paired-ledger/pilot.mjs',import.meta.url));
    const mock=fileURLToPath(new URL('./fixtures/pairedLedgerMock.mjs',import.meta.url));
    const env={...process.env,ANTHROPIC_BASE_URL:'https://api.z.ai/api/anthropic',ANTHROPIC_MODEL:'glm-5.3-flash',ANTHROPIC_API_KEY:'OFFLINE_FAKE_ANSWERING_CREDENTIAL',TYPESAFE_API_KEY:'OFFLINE_FAKE_RECALL_CREDENTIAL',PILOT_MOCK_OUTPUT:out,...(failure?{PILOT_MOCK_FAIL:failure}:{})};
    const run=spawnSync(process.execPath,['--import',mock,script,sdk,out],{env,encoding:'utf8',timeout:115_000,maxBuffer:1_000_000});
    const report=JSON.parse(readFileSync(path.join(out,'report.json'),'utf8'));
    const text=readFileSync(path.join(out,'events.jsonl'),'utf8');const events=text.trim().split('\n').map(JSON.parse);
    assert.equal(report.budget.calls,events.filter(e=>e.type==='dispatch').length);
    assert.ok(report.budget.calls<=600&&report.budget.knownTokens<=3_000_000);
    assert.ok(!text.includes('PRIVATE_OFFLINE_CANARY'));assert.ok(!text.includes(env.ANTHROPIC_API_KEY));assert.ok(!text.includes(env.TYPESAFE_API_KEY));
    if(failure&&failure!=='transcript-malformed'){assert.equal(run.status,2);assert.equal(report.status,failure==='native-invalid'?'provider_stopped':'budget_stopped');if(failure!=='native-invalid')assert.ok(report.budget.unresolvedReservedTokens>0);if(failure==='missing-usage')assert.equal(report.budget.calls,1);else assert.equal(events.filter(e=>e.type==='dispatch').at(-1).provider,'jev');}
    else{
      assert.equal(run.status,0,run.stderr+' '+JSON.stringify({status:report.status,reason:report.reason}));
      if(failure==='transcript-malformed')assert.equal(report.episodes.find(e=>e.phase==='development-baseline').transcript.protocolFailures,1);assert.equal(report.status,'completed');assert.equal(report.finalTestCalls,0);
      assert.ok(report.episodes.some(e=>e.phase==='validation-selected'&&e.complete));
      assert.ok(events.filter(e=>e.type==='dispatch').every(e=>e.context.seed===undefined||[447701,117701,227701].includes(e.context.seed)));
      const sum=report.episodes.reduce((n,e)=>n+e.graph.inputTokens+e.graph.outputTokens+e.transcript.inputTokens+e.transcript.outputTokens,0);
      const native=events.find(e=>e.type==='response'&&e.context.phase==='calibration-native').response.usage;
      assert.equal(sum+native.input_tokens+native.output_tokens,report.budget.knownTokens);
      const second=spawnSync(process.execPath,['--import',mock,script,sdk,out],{env,encoding:'utf8',timeout:5000});assert.notEqual(second.status,0);
      assert.equal(readFileSync(path.join(out,'events.jsonl'),'utf8'),text);
    }
  }finally{rmSync(temp,{recursive:true,force:true});}
});
