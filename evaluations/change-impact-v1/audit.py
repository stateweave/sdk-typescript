"""Post-run integrity audit; does not modify or replace frozen scoring."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


def audit(root):
    here = Path(__file__).parent
    manifest = json.loads((root/'manifest.json').read_text())
    assert not manifest['offline'], 'Mocks are not provider evidence'
    for name, expected in manifest['files'].items():
        assert hashlib.sha256((here/name).read_bytes()).hexdigest() == expected, name
    cases = json.loads((here/'cases.json').read_text())
    gold = {c['id']: c for c in json.loads((here/'private-gold.json').read_text())['cases']}
    counts = Counter()
    misses, overrides = [], []
    for case in cases['cases']:
        base = json.loads((root/f"{case['id']}.state.json").read_text())
        base_nodes = base['state']['nodes']
        mapping = base['mapping']
        candidate_entries = {mapping[node] for node in base['candidateIds']}
        expected = set(gold[case['id']]['review'])
        counts['goldRefutations'] += len(expected)
        counts['goldRefutationsInCandidates'] += len(expected & candidate_entries)
        if expected-candidate_entries: misses.append({'id': case['id'], 'missed': sorted(expected-candidate_entries)})
        before = json.dumps(base_nodes, sort_keys=True)
        standard_prompt = None
        for arm in ['standard','lexical','jev','full']:
            record = json.loads((root/f"{case['id']}.{arm}.json").read_text())
            counts['plannedRecords'] += 1
            if record['status'] != 'done':
                counts['failedRecords'] += 1
                continue
            result = record['result']
            assert json.dumps(result['state']['nodes'][:len(base_nodes)], sort_keys=True) == before
            assert result['metadata']['modelCalls'] <= 2
            assert result['metadata']['toolCalls'] == 0
            for step in result['trace']:
                assert len(step['nodeIds']) <= 48 and step['contextTokens'] <= 64000
                assert case['source'] in step['prompt']
                assert step['action'] != 'tool'
            answer = [node for node in result['state']['nodes'] if node['kind']=='answer'][-1]
            assert answer['parents'] == sorted(result['trace'][-1]['nodeIds'])
            assert len(record['dependentIds']) == 2*len(record['predicted'])
            counts['completedSourcePrefixesAndReadSetsAudited'] += 1
            if arm == 'standard': standard_prompt = result['trace'][0]['prompt']
            if arm == 'full':
                for memory in cases['memories']:
                    encoded = json.dumps(memory['text'], ensure_ascii=False)[1:-1]
                    assert encoded in result['trace'][0]['prompt']
                counts['fullLedgersAudited'] += 1
            if arm == 'jev':
                review = result['metadata']['changeReview']
                counts['jevStatus:'+review['status']] += 1
                if review['status'] == 'reviewed':
                    assert review['result']['model'] == 'jev-1.13.0'
                    nominated = set(review['flaggedNodeIds'])
                    visible = set(review['selectedNodeIds'])
                    assert visible <= nominated
                    counts['nominees'] += len(nominated)
                    counts['visibleNominees'] += len(visible)
                    annotations = [node for node in result['state']['nodes'] if node['id']==review.get('annotationNodeId')]
                    if nominated:
                        assert len(annotations)==1
                        assert annotations[0]['payload']['status']=='advisory_only'
                        assert annotations[0]['parents']==sorted([base['sourceId']]+base['candidateIds'])
                    else:
                        counts['noOpComparisons'] += standard_prompt is not None
                        counts['noOpIdenticalPrompts'] += standard_prompt == result['trace'][0]['prompt']
                    suggested = sorted(mapping[node] for node in nominated)
                    if suggested != record['predicted']:
                        overrides.append({'id': case['id'], 'suggested': suggested, 'predicted': record['predicted'], 'expected': sorted(expected)})
                    counts['sidecarTP'] += len(set(suggested)&expected)
                    counts['sidecarFP'] += len(set(suggested)-expected)
                    counts['sidecarFN'] += len(expected-set(suggested))
            del record, result
        del base
    transport = Counter()
    for file in root.glob('*.http-*.request.json'):
        row = json.loads(file.read_text())
        assert set(row) == {'url','body','startedAt'}
        assert row['url'] in ['https://api.typesafe.ai/v1/systemone','https://api.z.ai/api/anthropic/v1/messages']
        assert 'authorization' not in row and 'headers' not in row
        transport['requests'] += 1
        response_file = file.with_name(file.name.replace('.request.json','.response.json'))
        error_file = file.with_name(file.name.replace('.request.json','.error.json'))
        if response_file.exists():
            response = json.loads(response_file.read_text())
            assert response['thinkingBlocksOmitted']
            if response['status'] == 200:
                assert response['body']['model'] == row['body']['model']
                assert all(block['type'] not in ['thinking','redacted_thinking'] for block in response['body'].get('content',[]))
            transport['responses'] += 1
            transport['HTTP:'+str(response['status'])] += 1
        else:
            transport['withoutResponse'] += 1
            assert error_file.exists()
    return {'counts': dict(counts), 'transport': dict(transport), 'candidateMisses': misses, 'mainModelOverrides': overrides, 'frozenCommit': manifest['commit'], 'scope': 'Integrity assertions apply to returned completed states. No change to frozen scores.'}

if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1])), indent=2))
