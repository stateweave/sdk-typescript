"""Read-only all-attempt accounting, separate from the frozen efficacy scorer."""
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


def accounting(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    assert not manifest['offline']
    providers = defaultdict(Counter)
    arms = defaultdict(Counter)
    latencies = defaultdict(list)
    statuses = defaultdict(Counter)
    errors = defaultdict(Counter)
    unknown = []
    for request_path in sorted(root.glob('*.http-*.request.json')):
        request = json.loads(request_path.read_text())
        assert request['url'] in ['https://api.z.ai/api/anthropic/v1/messages', 'https://api.typesafe.ai/v1/systemone']
        provider = 'main' if 'z.ai/' in request['url'] else 'jev'
        arm = request_path.name.split('.')[1]
        assert arm in manifest['arms']
        buckets = [providers[provider], arms[provider + ':' + arm]]
        for bucket in buckets:
            bucket['requestStarts'] += 1
        response_path = request_path.with_name(request_path.name.replace('.request.json', '.response.json'))
        error_path = request_path.with_name(request_path.name.replace('.request.json', '.error.json'))
        complete_usage = False
        if response_path.exists():
            response = json.loads(response_path.read_text())
            statuses[provider][str(response['status'])] += 1
            for bucket in buckets:
                bucket['responses'] += 1
                bucket['http200'] += response['status'] == 200
            usage = response.get('body', {}).get('usage', {})
            values = [usage.get('input_tokens'), usage.get('cache_read_input_tokens', 0), usage.get('cache_creation_input_tokens', 0), usage.get('output_tokens')]
            input_known = all(type(value) is int and value >= 0 for value in values[:3])
            output_known = type(values[3]) is int and values[3] >= 0
            complete_usage = input_known and output_known
            for bucket in buckets:
                if input_known:
                    total = sum(values[:3])
                    bucket['knownInputTokens'] += total
                    bucket['maxReportedInputTokens'] = max(bucket['maxReportedInputTokens'], total)
                if output_known:
                    bucket['knownOutputTokens'] += values[3]
                    bucket['maxReportedOutputTokens'] = max(bucket['maxReportedOutputTokens'], values[3])
                bucket['responsesWithCompleteUsage'] += complete_usage
            if response['status'] == 200:
                latencies[provider].append(response['durationMs'])
        if error_path.exists():
            error = json.loads(error_path.read_text())
            name = error.get('name')
            errors[provider][name if name in ['TimeoutError', 'AbortError', 'Error', 'TypeError'] else 'other'] += 1
        if not complete_usage:
            unknown.append(request_path.name)
            for bucket in buckets:
                bucket['requestsWithoutCompleteUsage'] += 1
    pattern = r'^c_[a-f0-9]{12}\.(standard|lexical|jev|full)\.json$'
    records = [file for file in root.glob('*.json') if re.fullmatch(pattern, file.name)]
    started = [file for file in root.glob('*.started.json')]
    terminal = Counter()
    failure_phases = Counter()
    returned_states = 0
    for file in records:
        row = json.loads(file.read_text())
        terminal[row['status']] += 1
        returned_states += row.get('result') is not None
        if row['status'] != 'done':
            failure_phases[row.get('phase', 'unknown')] += 1
    planned = manifest['cases'] * len(manifest['arms'])
    exit_file = root / 'exit.status'
    return {
        'frozenCommit': manifest['commit'], 'plannedArms': planned,
        'startedArms': len(started), 'terminalRecords': len(records), 'terminalStatuses': dict(terminal),
        'unreturnedArms': len(started) - len(records), 'unstartedArms': planned - len(started),
        'returnedAgentResults': returned_states, 'failurePhases': dict(failure_phases),
        'completeMarker': (root / 'complete.json').exists(), 'exit': exit_file.read_text().strip() if exit_file.exists() else None,
        'providers': {key: dict(value) for key, value in providers.items()},
        'byArm': {key: dict(value) for key, value in arms.items()},
        'httpStatuses': {key: dict(value) for key, value in statuses.items()},
        'transportErrors': {key: dict(value) for key, value in errors.items()},
        'medianSuccessfulTransportMs': {key: statistics.median(value) for key, value in latencies.items()},
        'requestsWithoutCompleteUsage': unknown,
        'notes': 'Request starts are recorded attempts, not proof an unanswered call reached the provider. Unknown usage is not zero. Input totals include reported Anthropic-compatible cache tokens. This ledger does not change efficacy scores.'
    }


if __name__ == '__main__':
    print(json.dumps(accounting(Path(sys.argv[1])), indent=2))
