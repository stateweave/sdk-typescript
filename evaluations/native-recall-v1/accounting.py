import collections
import json
from pathlib import Path
import statistics
import sys


def usage_record(body, provider):
    usage = body.get('usage') if isinstance(body, dict) else None
    usage = usage if isinstance(usage, dict) else {}
    valid = lambda value: type(value) is int and value >= 0
    base, output = usage.get('input_tokens'), usage.get('output_tokens')
    cache = [usage.get(key, 0) for key in ['cache_read_input_tokens', 'cache_creation_input_tokens']] if provider == 'main' else []
    return {'knownInput': (base if valid(base) else 0) + sum(value for value in cache if valid(value)), 'knownOutput': output if valid(output) else 0, 'complete': valid(base) and valid(output) and all(valid(value) for value in cache)}


def summarize(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    totals = {}
    for provider in ['main', 'jev']:
        starts = sorted(root.glob('*.' + provider + '-*.request.json'))
        records = []
        for file in starts:
            prefix = file.name.removesuffix('.request.json')
            response = root / (prefix + '.response.json')
            error = root / (prefix + '.error.json')
            data = json.loads(response.read_text()) if response.exists() else {}
            request = json.loads(file.read_text())
            failure = json.loads(error.read_text()) if error.exists() else {}
            body = data.get('body', {})
            returned_model = body.get('model') if isinstance(body, dict) else None
            record = {'id': prefix, 'owner': prefix.rsplit('.' + provider + '-', 1)[0], 'status': data.get('status', failure.get('observedHttpStatus')), 'response': response.exists(), 'transportError': error.exists(), 'requestStartRecordedAt': request['startedAt'], 'requestedModel': request['body'].get('model'), 'returnedModel': returned_model if isinstance(returned_model, str) else None, 'elapsedMs': data.get('elapsedMs', failure.get('elapsedMs')), **usage_record(body, provider)}
            records.append(record)
        def aggregate(rows):
            times = [row['elapsedMs'] for row in rows if row['elapsedMs'] is not None]
            return {'starts': len(rows), 'responses': sum(row['response'] for row in rows), 'httpStatusObserved': sum(row['status'] is not None for row in rows), 'httpStatuses': dict(collections.Counter(str(row['status']) for row in rows)), 'knownInputTokens': sum(row['knownInput'] for row in rows), 'knownOutputTokens': sum(row['knownOutput'] for row in rows), 'startsWithoutCompleteUsage': sum(not row['complete'] for row in rows), 'medianHttpMs': statistics.median(times) if times else None, 'requestedModels': sorted(set(row['requestedModel'] for row in rows if row['requestedModel'])), 'returnedModels': sorted(set(row['returnedModel'] for row in rows if row['returnedModel']))}
        totals[provider] = {**aggregate(records), 'byOwnerArm': {arm: aggregate([row for row in records if row['owner'].endswith('.' + arm)]) for arm in ['standard', 'lexical', 'native']}, 'attempts': records}
    return {'sourceCommit': manifest['commit'], 'phase': manifest['phase'], 'simulated': manifest.get('simulated', False), 'scope': 'Every preserved request start, including rejected or unreturned attempts. A recorded start does not prove provider receipt. Missing usage is not zero. Responses counts fully captured records; status may be known without a complete body. HTTP-attempt time includes failures/capture but excludes the dispatch throttle; agent wall time includes it.', 'providers': totals}

if __name__ == '__main__':
    print(json.dumps(summarize(Path(sys.argv[1])), indent=2))
