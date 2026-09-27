import base64
import hashlib
import json
import os
from pathlib import Path
import sys


def digest_files(root):
    files = sorted(root.glob('*.json'))
    assert files and all(not file.is_symlink() for file in files)
    hashes = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
    return hashes, hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def scan(roots, credentials, sets):
    assert credentials and all(isinstance(value, str) and len(value) >= 16 for value in credentials)
    patterns = {item for value in credentials for item in [value.encode(), base64.b64encode(value.encode())]}
    digests, hits, hidden, count, size = {}, 0, 0, 0, 0
    for name, root in roots.items():
        hashes, digest = digest_files(root)
        digests[name] = digest
        for file in hashes:
            data = (root / file).read_bytes()
            hits += sum(data.count(pattern) for pattern in patterns)
            count += 1
            size += len(data)
            row = json.loads(data)
            if file.endswith('.response.json') and '.main-' in file:
                hidden += sum(part.get('type') != 'text' for part in row.get('body', {}).get('content', []))
            if file.endswith('.transport.json'):
                hidden += sum(part.get('type') != 'text' for message in row.get('messages', []) for part in message.get('content', []))
    return {'digests': digests, 'credentialSets': sets, 'credentialMatches': hits, 'hiddenContentBlocks': hidden, 'files': count, 'bytes': size, 'scope': 'Exact configured credential and raw-base64 matches; structured persisted provider blocks only. Does not claim detection of all possible secrets.'}

if __name__ == '__main__':
    mode, generation, *judgments = sys.argv[1:]
    roots = {'generation': Path(generation)}
    if judgments:
        roots['judgments'] = Path(judgments[0])
    if mode == 'providers':
        credentials = [os.environ[name] for name in ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY']]
        sets = ['configured-main', 'configured-jev']
    elif mode == 'pi':
        auth = json.loads(Path('/root/.pi/agent/auth.json').read_text())
        credentials = []
        def collect(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key.lower().replace('_', '') in ['key', 'apikey', 'access', 'refresh', 'token', 'accesstoken', 'refreshtoken'] and isinstance(item, str) and len(item) >= 16:
                        credentials.append(item)
                    elif isinstance(item, dict):
                        collect(item)
        collect(auth)
        sets = ['configured-pi-auth']
    else:
        raise ValueError('Unknown credential scope.')
    print(json.dumps(scan(roots, credentials, sets), indent=2))
