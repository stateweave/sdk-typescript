import hashlib
import json
from collections import defaultdict
from pathlib import Path
import sys

SEED = 'stateweave-change-impact-20260927-v1'

def digest(value):
    return hashlib.sha256((SEED + ':' + str(value)).encode()).hexdigest()

def prepare(source, target):
    corpus = {str(r['doc_id']): r for r in map(json.loads, (source / 'corpus.jsonl').read_text().splitlines())}
    claims = list(map(json.loads, (source / 'claims_dev.jsonl').read_text().splitlines()))
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]
    for claim in claims:
        docs = list(claim['evidence'])
        for doc in docs:
            parent[find(doc)] = find(docs[0])
    groups = defaultdict(list)
    for doc in parent:
        groups[find(doc)].append(doc)
    selected = sorted([min(docs, key=lambda doc: digest('document:' + doc)) for docs in groups.values()], key=lambda doc: digest('order:' + doc))
    public_claims = [{'id': 'm_' + digest('claim:' + str(row['id']))[:12], 'text': row['claim']} for row in sorted(claims, key=lambda row: digest('memory-order:' + str(row['id'])))]
    mapping = {row['id']: 'm_' + digest('claim:' + str(row['id']))[:12] for row in claims}
    cases, gold = [], []
    for index, doc in enumerate(selected):
        source_text = corpus[doc]['title'] + '\n' + '\n'.join(corpus[doc]['abstract'])
        assert len(source_text) < 12000
        case_id = 'c_' + digest('case:' + doc)[:12]
        cases.append({'id': case_id, 'source': source_text, 'rotation': index % 4})
        labels = {}
        for row in claims:
            if doc not in row['evidence']:
                continue
            values = {item['label'] for item in row['evidence'][doc]}
            assert len(values) == 1
            labels[mapping[row['id']]] = next(iter(values))
        gold.append({'id': case_id, 'documentId': doc, 'clusterDocuments': sorted(groups[find(doc)]), 'review': sorted(key for key, value in labels.items() if value == 'CONTRADICT'), 'annotatedLabels': labels})
    target.mkdir(parents=True, exist_ok=True)
    (target / 'cases.json').write_text(json.dumps({'seed': SEED, 'memories': public_claims, 'cases': cases}, ensure_ascii=False, indent=2) + '\n')
    (target / 'private-gold.json').write_text(json.dumps({'source': 'SciFact development split; one document per claim-linked component', 'cases': gold, 'claimIdMap': mapping}, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'memories': len(public_claims), 'positiveCases': sum(bool(row['review']) for row in gold), 'goldRefutations': sum(len(row['review']) for row in gold), 'maxRefutations': max(len(row['review']) for row in gold)}))

if __name__ == '__main__':
    prepare(Path(sys.argv[1]), Path(sys.argv[2]))
