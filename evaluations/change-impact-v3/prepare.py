import hashlib
import json
from collections import defaultdict
from pathlib import Path
import sys

SEED = 'stateweave-change-impact-20260927-v2'

def digest(value):
    return hashlib.sha256((SEED + ':' + str(value)).encode()).hexdigest()

def prepare(source, target):
    corpus = {str(r['doc_id']): r for r in map(json.loads, (source/'corpus.jsonl').read_text().splitlines())}
    dev = list(map(json.loads, (source/'claims_dev.jsonl').read_text().splitlines()))
    train = list(map(json.loads, (source/'claims_train.jsonl').read_text().splitlines()))
    excluded_docs = {str(d) for r in dev for d in [*r['cited_doc_ids'], *r['evidence']]}
    excluded_text = {' '.join(r['claim'].lower().split()) for r in dev}
    eligible = [r for r in train if not excluded_docs & {str(d) for d in [*r['cited_doc_ids'], *r['evidence']]} and ' '.join(r['claim'].lower().split()) not in excluded_text]
    claims = sorted(eligible, key=lambda row: hashlib.sha256(('change-impact-v2-memory:'+str(row['id'])).encode()).hexdigest())[:300]
    assert len(claims) == 300
    parent = {}
    def find(x):
        parent.setdefault(x,x)
        if parent[x] != x: parent[x] = find(parent[x])
        return parent[x]
    for row in claims:
        docs = list(row['evidence'])
        for doc in docs: parent[find(doc)] = find(docs[0])
    groups = defaultdict(list)
    for doc in parent: groups[find(doc)].append(doc)
    selected = []
    for group in groups.values():
        admissible = [doc for doc in group if len(corpus[doc]['title']+'\n'+'\n'.join(corpus[doc]['abstract'])) <= 7000]
        if admissible: selected.append(min(admissible, key=lambda doc: digest('document:'+doc)))
    selected = sorted(selected, key=lambda doc: digest('order:'+doc))[:128]
    assert len(selected)==128
    mapping = {row['id']: 'm_'+digest('claim:'+str(row['id']))[:12] for row in claims}
    public = [{'id': mapping[row['id']], 'text': row['claim']} for row in sorted(claims,key=lambda row:digest('memory-order:'+str(row['id'])))]
    cases, gold = [], []
    for index, doc in enumerate(selected):
        case_id = 'c_'+digest('case:'+doc)[:12]
        cases.append({'id': case_id, 'source': corpus[doc]['title']+'\n'+'\n'.join(corpus[doc]['abstract']), 'rotation': index%4})
        labels = {}
        for row in claims:
            if doc in row['evidence']:
                values = {item['label'] for item in row['evidence'][doc]}
                assert len(values)==1
                labels[mapping[row['id']]] = next(iter(values))
        gold.append({'id':case_id, 'documentId':doc, 'clusterDocuments':sorted(groups[find(doc)]), 'review':sorted(k for k,v in labels.items() if v=='CONTRADICT'), 'annotatedLabels':labels})
    target.mkdir(exist_ok=True,parents=True)
    (target/'cases.json').write_text(json.dumps({'seed':SEED,'memories':public,'cases':cases},ensure_ascii=False,indent=2)+'\n')
    (target/'private-gold.json').write_text(json.dumps({'source':'SciFact train; all development evidence/cited documents and duplicate texts excluded', 'excludedDevelopmentDocuments':sorted(excluded_docs), 'eligibleClaims':len(eligible), 'eligibleComponents':len(groups), 'cases':gold,'claimIdMap':mapping},indent=2)+'\n')
    print(json.dumps({'cases':len(cases),'memories':len(public),'positiveCases':sum(bool(c['review']) for c in gold),'goldRefutations':sum(len(c['review']) for c in gold),'maxRefutations':max(len(c['review']) for c in gold),'eligibleClaims':len(eligible),'eligibleComponents':len(groups)}))

if __name__=='__main__': prepare(Path(sys.argv[1]),Path(sys.argv[2]))
