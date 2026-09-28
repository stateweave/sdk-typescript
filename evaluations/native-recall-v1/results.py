import hashlib
import json
import statistics
from paired_stats import paired_stats, holm_adjust
from judge import ARMS, MODEL, case_packet, packet_hash, calibration_packets, judge_command


def bound_judgment(judgments, name, packet):
    result = json.loads((judgments / (name + '.json')).read_text())
    started = json.loads((judgments / (name + '.started.json')).read_text())
    transport = json.loads((judgments / (name + '.transport.json')).read_text())
    assert result['requestHash'] == started['requestHash'] == packet_hash(packet)
    assert started['packet'] == packet
    assert started['flags'] == judge_command()[1:], 'Judgment did not use the frozen isolated invocation.'
    assert transport['exitCode'] == 0 and not transport['timedOut'] and transport.get('toolCallBlocks', 0) == 0
    assert transport['messages'] and all(row['provider'] == 'openai-codex' and row['model'] == MODEL for row in transport['messages'])
    text = ''.join(part['text'] for part in transport['messages'][-1]['content'] if part['type'] == 'text').strip()
    if text.startswith('```') and text.endswith('```'):
        text = '\n'.join(text.splitlines()[1:-1])
    assert json.loads(text) == result['parsed'], 'Scored judgment differs from preserved provider text.'
    expected = sorted(response['id'] for task in packet['tasks'] for response in task['responses'])
    assert sorted(row['id'] for row in result['parsed']['results']) == expected
    assert all(type(row['correct']) is bool for row in result['parsed']['results'])
    return result['parsed']['results']


def summarize(root, data, judgments, split='development'):
    expected = 28 if split == 'development' else 196
    assert (root / 'complete.json').exists() and (judgments / 'complete.json').exists()
    packets, expected_calibration = calibration_packets()
    for order, packet in enumerate(packets):
        assert {row['id']: row['correct'] for row in bound_judgment(judgments, 'calibration-' + str(order), packet)} == expected_calibration
    manifest = json.loads((root / 'manifest.json').read_text())
    assert manifest['phase'] == ('answers' if split == 'development' else 'confirmatory')
    source_manifest = json.loads((data / 'manifest.json').read_text())
    gold_bytes = (data / (split + '-gold.json')).read_bytes()
    assert hashlib.sha256(gold_bytes).hexdigest() == source_manifest[split + 'GoldSha256']
    gold = json.loads(gold_bytes)
    assert len(gold) == expected
    ledger, records = [], {arm: [] for arm in ARMS}
    for case in sorted(gold, key=lambda row: row['id']):
        cid = case['id']
        source_bytes = (data / split / (cid + '.json')).read_bytes()
        assert hashlib.sha256(source_bytes).hexdigest() == source_manifest['files'][split + '/' + cid + '.json']
        participant = json.loads(source_bytes)
        maps = json.loads((judgments / (cid + '.mapping.json')).read_text())
        votes = {arm: [] for arm in ARMS}
        for order in range(2):
            mapping, packet = case_packet(root, participant, case, order)
            assert maps[str(order)] == mapping
            for row in bound_judgment(judgments, cid + '.order-' + str(order), packet):
                votes[mapping[row['id']]].append(row['correct'])
        assert all(len(vote) == 2 for vote in votes.values())
        outcomes, prompt_hashes, visible = {}, {}, {}
        for arm in ARMS:
            record = json.loads((root / (cid + '.' + arm + '.result.json')).read_text())
            assert record['status'] in ['done', 'failed'] and record['arm'] == arm
            records[arm].append(record)
            outcomes[arm] = {'status': record['status'], 'votes': votes[arm], 'correct': record['status'] == 'done' and all(votes[arm]), 'judgeDisagreement': len(set(votes[arm])) != 1}
            trace = record.get('result', {}).get('trace', [])
            prompt_hashes[arm] = hashlib.sha256(trace[0]['prompt'].encode()).hexdigest() if trace else None
            recall = record.get('result', {}).get('metadata', {}).get('recall', {})
            visible[arm] = sorted(recall.get('visibleWindowIds', []))
        ledger.append({'id': cid, 'group': case['group'], 'outcomes': outcomes, 'firstPromptHashes': prompt_hashes, 'sameVisibleRecallSpans': bool(visible['native']) and visible['native'] == visible['lexical']})
    groups = [row['group'] for row in ledger]
    comparisons = {arm: paired_stats([int(row['outcomes']['native']['correct']) - int(row['outcomes'][arm]['correct']) for row in ledger], groups) for arm in ['standard', 'lexical']}
    adjusted = holm_adjust({arm: row['exactMcNemarTwoSidedP'] for arm, row in comparisons.items()})
    for arm, comparison in comparisons.items():
        identical = [row for row in ledger if row['firstPromptHashes']['native'] and row['firstPromptHashes']['native'] == row['firstPromptHashes'][arm]]
        comparison.update({'holmAdjustedP': adjusted[arm], 'identicalPromptCases': len(identical), 'identicalPromptWins': sum(row['outcomes']['native']['correct'] and not row['outcomes'][arm]['correct'] for row in identical), 'identicalPromptLosses': sum(not row['outcomes']['native']['correct'] and row['outcomes'][arm]['correct'] for row in identical)})
    summary = {'scope': 'Development-only exploratory answer quality; not held-out confirmation.' if split == 'development' else 'Frozen held-out answer comparison on the filtered public corpus and exact configured model.', 'commit': manifest['commit'], 'cases': len(ledger), 'criterion': 'Failure-zero binary correctness; both order-reversed blind judgments must pass.', 'arms': {}, 'comparisons': comparisons, 'ledger': ledger}
    for arm in ARMS:
        complete = [record for record in records[arm] if record['status'] == 'done']
        summary['arms'][arm] = {'correct': sum(row['outcomes'][arm]['correct'] for row in ledger), 'completed': len(complete), 'judgeDisagreements': sum(row['outcomes'][arm]['judgeDisagreement'] for row in ledger), 'abstentionCorrect': sum(row['outcomes'][arm]['correct'] for row in ledger if row['group'] == 'abstention'), 'medianSuccessfulMs': statistics.median(record['elapsedMs'] for record in complete) if complete else None, 'successfulMainInputTokens': sum(record['result']['metadata']['totalInputTokens'] for record in complete), 'successfulMainOutputTokens': sum(record['result']['metadata']['outputTokens'] for record in complete), 'recallFallbacks': sum((record['result']['metadata'].get('recall', {}) if record['status'] == 'done' else (record.get('recall') or {})).get('status') == 'fallback' for record in records[arm]), 'byGroup': {group: {'correct': sum(row['outcomes'][arm]['correct'] for row in ledger if row['group'] == group), 'cases': sum(row['group'] == group for row in ledger)} for group in sorted(set(groups))}}
    completed = [row for row in ledger if all(row['outcomes'][arm]['status'] == 'done' for arm in ARMS)]
    summary['allArmsCompleteSensitivity'] = {'cases': len(completed), 'scope': 'Selected subset; not a replacement primary endpoint.', 'differences': {arm: sum(int(row['outcomes']['native']['correct']) - int(row['outcomes'][arm]['correct']) for row in completed) / len(completed) if completed else None for arm in ['standard', 'lexical']}}
    factual = [row for row in ledger if row['group'] != 'single-session-preference']
    summary['nonPreferenceSensitivity'] = {'cases': len(factual), 'scope': 'Predeclared robustness against permissive partial-personalization scoring.' if split == 'holdout' else 'Post-hoc exploratory non-preference sensitivity; not a prespecified development endpoint.', 'differences': {arm: sum(int(row['outcomes']['native']['correct']) - int(row['outcomes'][arm]['correct']) for row in factual) / len(factual) if factual else None for arm in ['standard', 'lexical']}}
    return summary
