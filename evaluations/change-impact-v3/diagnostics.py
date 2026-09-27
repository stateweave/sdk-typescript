"""Descriptive diagnostics only; no replacement endpoints or new significance tests."""
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path
from summarize import case_score


def diagnostics(root):
    here = Path(__file__).parent
    gold_bytes = (here / 'private-gold.json').read_bytes()
    manifest = json.loads((root / 'manifest.json').read_text())
    assert not manifest['offline'] and hashlib.sha256(gold_bytes).hexdigest() == manifest['privateGoldSha256']
    counts = Counter()
    missing_sidecars, no_ops, disagreements, failures = [], [], [], []
    estimated = Counter()
    for case in json.loads(gold_bytes)['cases']:
        cid = case['id']
        base = json.loads((root / (cid + '.state.json')).read_text())
        expected = set(case['review'])
        candidates = base['candidateIds']
        mapping = base['mapping']
        counts['goldClaims'] += len(expected)
        counts['goldInLexicalTopSix'] += len(expected & {mapping[node] for node in candidates[:6]})
        counts['goldInCandidate64'] += len(expected & {mapping[node] for node in candidates})
        matches = []
        for request_file in root.glob(cid + '.jev.http-*.request.json'):
            request = json.loads(request_file.read_text())
            if request['url'] == 'https://api.typesafe.ai/v1/systemone':
                matches.append(request_file)
        assert len(matches) == 1
        response_file = matches[0].with_name(matches[0].name.replace('.request.json', '.response.json'))
        nominated = None
        if response_file.exists():
            response = json.loads(response_file.read_text())
            body = response['body']
            answers = body.get('answers', {})
            valid = response['status'] == 200 and body.get('model') == 'jev-1.13.0' and set(answers) == {f'q{i}' for i in range(len(candidates))}
            if valid:
                valid = all(value.get('type') == 'noul' and type(value.get('noul')) in (int, float) and math.isfinite(value['noul']) and 0 <= value['noul'] <= 1 for value in answers.values())
            usage = body.get('usage', {})
            valid = valid and all(type(usage.get(key)) is int and 0 <= usage[key] <= 2**53 - 1 for key in ['input_tokens', 'output_tokens'])
            if valid:
                scored = [(node, answers[f'q{i}']['noul']) for i, node in enumerate(candidates)]
                threshold = {mapping[node] for node, p in scored if p >= .8}
                top_five = [mapping[node] for node, p in sorted(scored, key=lambda row: (-row[1], row[0])) if p >= .8][:5]
                nominated = set(top_five)
                counts['sidecarCallsWithValidScores'] += 1
                counts['goldInKnownSidecarCases'] += len(expected)
                counts['thresholdTP'] += len(threshold & expected)
                counts['thresholdFP'] += len(threshold - expected)
                counts['nomineeTP'] += len(nominated & expected)
                counts['nomineeFP'] += len(nominated - expected)
                counts['nomineeFN'] += len(expected - nominated)
                counts['knownNegativeSidecarCases'] += not expected
                counts['negativeSidecarAlertCases'] += not expected and bool(nominated)
        if nominated is None:
            missing_sidecars.append(cid)
        records = {arm: json.loads((root / f'{cid}.{arm}.json').read_text()) for arm in manifest['arms']}
        for arm, record in records.items():
            if record['status'] != 'done':
                calls = []
                for file in root.glob(f'{cid}.{arm}.http-*.request.json'):
                    request = json.loads(file.read_text())
                    if 'z.ai/' not in request['url']:
                        continue
                    response_file = file.with_name(file.name.replace('.request.json', '.response.json'))
                    error_file = file.with_name(file.name.replace('.request.json', '.error.json'))
                    response = json.loads(response_file.read_text()) if response_file.exists() else {}
                    body = response.get('body', {})
                    calls.append({'status': response.get('status'), 'stop': body.get('stop_reason'), 'outputTokens': body.get('usage', {}).get('output_tokens'), 'visibleChars': sum(len(block.get('text', '')) for block in body.get('content', []) if block.get('type') == 'text'), 'error': json.loads(error_file.read_text()).get('name') if error_file.exists() else None})
                category = 'unclassified'
                if any(call['status'] == 429 for call in calls):
                    category = 'request_rate_limit'
                elif any(call['error'] == 'TimeoutError' for call in calls):
                    category = 'main_timeout'
                elif len(calls) == 2 and all(call['status'] == 200 and call['stop'] == 'max_tokens' and call['outputTokens'] == 4096 and call['visibleChars'] == 0 for call in calls):
                    category = 'two_output_limit_responses_without_final_text'
                failures.append({'id': cid, 'arm': arm, 'category': category, 'calls': calls})
            if record.get('result'):
                for trace in record['result']['trace']:
                    estimated[arm] = max(estimated[arm], trace['contextTokens'])
        jev, standard = records['jev'], records['standard']
        if nominated is not None and jev.get('result'):
            actual = set(jev['result']['metadata']['changeReview'].get('flaggedNodeIds', []))
            assert {mapping[node] for node in actual} == nominated
            if jev['status'] == 'done' and set(jev['predicted']) != nominated:
                disagreements.append({'id': cid, 'suggested': sorted(nominated), 'final': jev['predicted'], 'gold': case['review']})
            if not nominated and standard.get('result'):
                identical = standard['result']['trace'][0]['prompt'] == jev['result']['trace'][0]['prompt']
                delta = case_score(expected, jev.get('predicted'), jev['status'] == 'done') - case_score(expected, standard.get('predicted'), standard['status'] == 'done')
                no_ops.append({'id': cid, 'identicalFirstPrompt': identical, 'scoreDifference': delta, 'standardStatus': standard['status'], 'jevStatus': jev['status']})
    return {'counts': dict(counts), 'missingOrInvalidSidecarCases': missing_sidecars, 'noOpPairs': no_ops, 'mainModelOverrides': disagreements, 'maxEstimatedContextByArm': dict(estimated), 'failureDiagnostics': failures, 'scope': 'All planned cases for candidate recall; successful raw sidecar score responses for conditional nomination diagnostics. No-op prompt equality covers first calls; differences are not evidence-recovery gains. These descriptive diagnostics do not alter frozen scores.'}


if __name__ == '__main__':
    print(json.dumps(diagnostics(Path(sys.argv[1])), indent=2))
