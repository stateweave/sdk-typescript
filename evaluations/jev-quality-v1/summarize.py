import hashlib
import json
import math
from pathlib import Path
import random
import statistics
import sys

ROOT=Path(__file__).parent
ARMS=['baseline','grounding','recovery','combined']

def read(path):
    return json.loads(path.read_text())

def sign_test(wins,losses):
    n=wins+losses
    if not n:
        return 1.0
    return min(1.0,2*sum(math.comb(n,k) for k in range(min(wins,losses)+1))/2**n)

def bootstrap(rows,arm):
    rng=random.Random(20260924)
    values=[r['correct'][arm]-r['correct']['baseline'] for r in rows]
    if not values:
        return [None,None]
    means=sorted(sum(rng.choices(values,k=len(values)))/len(values) for _ in range(10000))
    return [means[249],means[9749]]

def summarize(result_dir,judge_dir):
    cases=read(ROOT/'cases.json')
    golds={g['id']:g for g in read(ROOT/'private-gold.json')}
    ledger=[]
    memory=[]
    for case in cases:
        cid=case['id']
        runs={arm:read(result_dir/(cid+'.'+arm+'.json')) for arm in ARMS}
        mapping=sorted(ARMS,key=lambda arm:hashlib.sha256(('blind-quality-v1:'+cid+':'+arm).encode()).hexdigest())
        labels={r['id']:r for r in read(judge_dir/(cid+'.qa.json'))['parsed']['results']}
        correct={arm:int(runs[arm]['status']=='done' and labels['response-'+str(mapping.index(arm))]['correct']) for arm in ARMS}
        eligible=not any(r.get('errorClass')=='external' for r in runs.values())
        ledger.append({'id':cid,'sourceId':golds[cid]['sourceId'],'group':golds[cid]['group'],'eligible':eligible,'correct':correct,'statuses':{a:r['status'] for a,r in runs.items()},'latencyMs':{a:r['elapsedMs'] for a,r in runs.items()},'reasons':{a:labels['response-'+str(mapping.index(a))]['reason'] for a in ARMS},'recovery':{a:r['recovery'].get('status') for a,r in runs.items()}})
        producer=read(result_dir/(cid+'.producer.json'))
        grounding=read(result_dir/(cid+'.memory-review.json'))
        audit_path=judge_dir/(cid+'.memory.json')
        if audit_path.exists() and grounding['status']=='reviewed':
            audited={r['id']:r for r in read(audit_path)['parsed']['results']}
            for index,m in enumerate(producer['memories']):
                label=audited['claim-'+str(index)]
                memory.append({'case':cid,'index':index,'content':m['content'],'supported':label['supported'],'accepted':grounding['accepted'][index],'score':grounding['scores'][index],'audit':label})
    paired=[r for r in ledger if r['eligible']]
    summary={'cases':len(ledger),'eligiblePairedCases':len(paired),'arms':{},'ledger':ledger,'memoryAudit':{'count':len(memory),'supported':sum(r['supported'] for r in memory),'unsupported':sum(not r['supported'] for r in memory),'falseRejections':sum(r['supported'] and not r['accepted'] for r in memory),'falseAcceptances':sum(not r['supported'] and r['accepted'] for r in memory),'ledger':memory}}
    for arm in ARMS:
        wins=sum(r['correct'][arm]>r['correct']['baseline'] for r in paired)
        losses=sum(r['correct'][arm]<r['correct']['baseline'] for r in paired)
        runs=[read(result_dir/(c['id']+'.'+arm+'.json')) for c in cases]
        completed=[r for r in runs if r['status']=='done']
        summary['arms'][arm]={'correct':sum(r['correct'][arm] for r in paired),'operationalCorrect':sum(r['correct'][arm] for r in ledger),'wins':wins,'losses':losses,'ties':len(paired)-wins-losses,'exactTwoSidedP':sign_test(wins,losses),'difference95CI':bootstrap(paired,arm),'medianQuestionMs':statistics.median(r['elapsedMs'] for r in runs),'completed':len(completed),'inputTokens':sum(r.get('result',{}).get('metadata',r.get('metrics') or {}).get('totalInputTokens',0) for r in runs),'outputTokens':sum(r.get('result',{}).get('metadata',r.get('metrics') or {}).get('outputTokens',0) for r in runs),'groups':{group:{'correct':sum(r['correct'][arm] for r in paired if r['group']==group),'total':sum(r['group']==group for r in paired)} for group in sorted(set(r['group'] for r in ledger))},'recoveryFallbacks':sum(r['recovery'].get('status')=='fallback' for r in runs)}
    jev=[]
    for file in result_dir.glob('*.response.json'):
        row=read(file)
        if row.get('raw',{}).get('model')=='jev-1.13.0':
            jev.append(row)
    inputs=sum(r['raw']['usage']['input_tokens'] for r in jev)
    outputs=sum(r['raw']['usage']['output_tokens'] for r in jev)
    summary['jevPhysicalUsage']={'calls':len(jev),'inputTokens':inputs,'outputTokens':outputs,'listPriceUSD':inputs*0.042/1_000_000,'sumMeasuredLatencyMs':sum(r['latencyMs'] for r in jev)}
    producers=[read(result_dir/(c['id']+'.producer.json')) for c in cases]
    groundings=[read(result_dir/(c['id']+'.memory-review.json')) for c in cases]
    summary['ingestion']={'sharedProducerCalls':len(producers),'fallbacks':sum(r['status']!='done' for r in producers),'medianProducerMs':statistics.median(r['elapsedMs'] for r in producers),'groundingFallbacks':sum(r['status']=='fallback' for r in groundings),'medianGroundingMs':statistics.median(r.get('latencyMs',0) for r in groundings),'groundingAccepted':sum(sum(r['accepted']) for r in groundings),'groundingProposals':sum(len(r['accepted']) for r in groundings)}
    for arm in ARMS:
        summary['arms'][arm]['medianIngestAndQuestionMs']=statistics.median(producers[i]['elapsedMs']+(groundings[i].get('latencyMs',0) if arm in ['grounding','combined'] else 0)+ledger[i]['latencyMs'][arm] for i in range(len(cases)))
    baseline=summary['arms']['baseline'];combined=summary['arms']['combined']
    gain=(combined['correct']-baseline['correct'])/len(paired) if paired else 0
    abstention_safe=combined['groups']['abstention']['correct']>=baseline['groups']['abstention']['correct']
    invariants=all(read(result_dir/(c['id']+'.'+a+'.json')).get('errorClass')!='invariant' for c in cases for a in ARMS)
    summary['largeGainGate']={'accuracyGain':gain,'minimumGain':0.20,'passed':bool(len(paired)>=30 and gain>=0.20 and combined['exactTwoSidedP']<0.05 and abstention_safe and invariants),'abstentionNonregression':abstention_safe,'invariants':invariants}
    return summary

if __name__=='__main__':
    print(json.dumps(summarize(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False,indent=2))
