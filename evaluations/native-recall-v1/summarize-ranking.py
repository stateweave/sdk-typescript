import hashlib
import json
import statistics
import sys
from pathlib import Path

root, gold_file = map(Path, sys.argv[1:])
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['phase'] == 'ranking'
assert (root / 'complete.json').exists(), 'Do not select a design during an unfinished cohort.'
gold = json.loads(gold_file.read_text())
assert len(gold) == 28
rows = []
cost = {}
for case in gold:
    cid = case['id']
    data = json.loads((root / (cid + '.input.json')).read_text())
    expected = {data['mapping'][sid] for sid in case['answerSources']}
    candidate_ids = {row['nodeId'] for row in data['candidateIndex']['candidates']}
    record = {'id': cid, 'group': case['group'], 'candidateSourceRecall': len(expected & candidate_ids) / len(expected), 'arms': {}}
    for arm in ['lexical', 'indexed', 'direct', 'graded']:
        result = {'status': 'done', 'selection': data['lexicalSelection']} if arm == 'lexical' else json.loads((root / (cid + '.' + arm + '.result.json')).read_text())
        if result['status'] != 'done':
            record['arms'][arm] = {'status': 'failed', 'sourceRecall': 0, 'completeSources': False}
            continue
        selected = result['selection']['windows']
        available = {row['id']: row for row in data['candidateIndex']['candidates']}
        assert len(selected) <= 12
        assert all(window == available[window['id']] for window in selected)
        ids = {window['nodeId'] for window in selected}
        record['arms'][arm] = {'status': 'done', 'sourceRecall': len(expected & ids) / len(expected), 'completeSources': expected <= ids, 'selectedWindows': len(selected)}
    rows.append(record)
for arm in ['indexed', 'direct', 'graded']:
    responses = [json.loads(file.read_text()) for file in root.glob('*.' + arm + '.jev-*.response.json')]
    requests = len(list(root.glob('*.' + arm + '.jev-*.request.json')))
    usage = [row.get('body', {}).get('usage', {}) for row in responses]
    valid = lambda value: type(value) is int and value >= 0
    cost[arm] = {'requests': requests, 'responses': len(responses), 'knownInputTokens': sum(row['input_tokens'] for row in usage if valid(row.get('input_tokens'))), 'knownOutputTokens': sum(row['output_tokens'] for row in usage if valid(row.get('output_tokens'))), 'requestsWithoutCompleteUsage': requests - sum(valid(row.get('input_tokens')) and valid(row.get('output_tokens')) for row in usage), 'medianHttpMs': statistics.median(row['elapsedMs'] for row in responses) if responses else None}
positive = [row for row in rows if row['group'] != 'abstention']
summary = {'scope': 'Development-only source-session retrieval; not span completeness, answer quality or independent confirmation.', 'commit': manifest['commit'], 'privateDevelopmentGoldSha256': hashlib.sha256(gold_file.read_bytes()).hexdigest(), 'cases': len(rows), 'answerableCases': len(positive), 'meanCandidateSourceRecall': statistics.mean(row['candidateSourceRecall'] for row in positive), 'arms': {arm: {'meanSourceRecall': statistics.mean(row['arms'][arm]['sourceRecall'] for row in positive), 'allSupportingSources': sum(row['arms'][arm]['completeSources'] for row in positive), 'failedCases': sum(row['arms'][arm]['status'] == 'failed' for row in rows)} for arm in ['lexical', 'indexed', 'direct', 'graded']}, 'cost': cost, 'casesDetail': rows}
print(json.dumps(summary, indent=2))
