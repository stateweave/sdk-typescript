import json,hashlib,sys
from pathlib import Path

root=Path(__file__).parent
out=Path(sys.argv[1])
judges=Path(sys.argv[2])
load=lambda p:json.loads(p.read_text())
assert (out/'complete.json').exists() and (judges/'complete.json').exists()
manifest=load(out/'manifest.json')
assert manifest['commit']=='d68b6d16c5e01c2cb8a1ee8435b010e2524385c1'
assert not any('mock' in a for a in manifest['execArgv'])
for name,sha in manifest['hashes'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha,name
cases=load(root/'cases.json')
no_op_equal=0
no_op_total=0
nominated=0
visible=0
runs=0
completed=0
for case in cases:
    cid=case['id']
    sources=[{'id':f"{session['id']}:{index}",'sessionId':session['id'],'date':session['date'],**turn} for session in case['sessions'] for index,turn in enumerate(session['turns'])]
    producer=load(out/(cid+'.producer.started.json'))
    assert json.loads(producer['input']['prompt'])=={'sources':sources}
    reviews=load(out/(cid+'.memory-review.json'))
    if reviews['status']=='reviewed':
        assert load(out/(cid+'.memory-review.started.json'))['payload']['state']=={'sources':sources}
    states=load(out/(cid+'.states.json'))['states']
    for state in states.values():
        assert [n['payload'] for n in state['nodes'] if n['kind']=='resource']==sources
    records={}
    for arm in ['baseline','grounding','recovery','combined']:
        r=load(out/(cid+'.'+arm+'.json'));records[arm]=r;runs+=1
        if r['status']!='done':
            continue
        completed+=1
        result=r['result'];state=states['grounding' if arm in ['grounding','combined'] else 'baseline']
        assert result['state']['nodes'][:len(state['nodes'])]==state['nodes']
        assert not result['metadata']['tools']
        assert result['metadata']['modelCalls']<=2
        assert result['metadata']['projectionMaxNodes']==16
        assert result['metadata']['maxPromptTokens']==64000
        assert result['metadata']['contextMode']=='molecular'
        assert all(len(t['nodeIds'])<=16 and t['contextTokens']<=64000 for t in result['trace'])
        assert [n for n in result['state']['nodes'] if n['kind']=='answer'][-1]['parents']==sorted(result['trace'][-1]['nodeIds'])
        assert result['finalAnswer']!='OFFLINE MOCK ONLY'
        selected=r['recovery'].get('preferredNodeIds',[])
        if selected:
            nominated+=1;visible+=len(r['preferredActuallyVisible'])
            assert set(selected)<=set(r['recovery']['candidates'])
            assert len(selected)<=6
    if records['baseline']['status']=='done' and records['recovery']['status']=='done' and not records['recovery']['recovery'].get('preferredNodeIds'):
        no_op_total+=1
        no_op_equal+=records['baseline']['result']['trace'][0]['prompt']==records['recovery']['result']['trace'][0]['prompt']
for file in judges.glob('*.transport.json'):
    for msg in load(file)['messages']:
        assert msg['provider']=='openai-codex' and msg['model']=='gpt-5.6-sol'
        assert not any(part['type'] in ['toolCall','thinking'] for part in msg['content'])
print(json.dumps({'runRecordsAudited':runs,'completedRunsAudited':completed,'completedSourceGraphsPreserved':True,'completedReadSetsAndBudgetsPreserved':True,'producerAndGroundingSourcesOriginal':True,'noOpRecoveryPromptsEqual':no_op_equal,'noOpRecoveryPromptsCompared':no_op_total,'nominatingRuns':nominated,'nominatedNodesActuallyVisible':visible,'judgeIsolationVerified':True},indent=2))
