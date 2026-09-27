import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

base = Path(__file__).resolve().parent
repo = base.parents[1]
cohort, baseline = map(Path, sys.argv[1:3])
draft = '--draft' in sys.argv
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
files = ['CONFIRMATORY_PROTOCOL.md', 'confirm.mjs', 'store.mjs', 'import-evidence.mjs', 'test-import.mjs', 'judge.py', 'results.py', 'paired_stats.py', 'score-confirm.py', 'confirmation_gate.py', 'audit.mjs', 'accounting.py', 'scan_evidence.py', 'power.py', 'power.json', 'freeze.py', 'cohort-manifest.json', 'baseline-common-parser.patch', 'prepare.py', 'prior-exclusions.json', 'test_protocol.py', 'test_judge.py', 'test_statistics.py', 'test_confirmation.py', '../../package.json', '../../pnpm-lock.yaml']
if not draft:
    subprocess.run(['git', 'diff', '--quiet', 'HEAD'], cwd=repo, check=True)
    for name in files:
        subprocess.run(['git', 'ls-files', '--error-unmatch', str((base / name).resolve().relative_to(repo))], cwd=repo, stdout=subprocess.DEVNULL, check=True)
target = base / 'CONFIRMATORY_FREEZE.json'
if target.exists():
    assert json.loads(target.read_text())['status'] != 'frozen', 'An existing final freeze cannot be overwritten.'
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
manifest = json.loads((cohort / 'manifest.json').read_text())
value = {'status': 'draft-engineering' if draft else 'frozen', 'commit': commit, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'nodeVersion': 'v22.23.2', 'zodVersion': '3.25.76', 'piVersion': '0.87.1', 'executionImage': 'sha256:17c413217253ba396c5523b72c1739654743022e8089972935137e8d553c046d', 'cohortManifestSha256': sha(cohort / 'manifest.json'), 'goldSha256': manifest['holdoutGoldSha256'], 'runtime': {str(file.relative_to(repo / 'dist')): sha(file) for file in sorted((repo / 'dist').rglob('*')) if file.is_file()}, 'baselineRuntime': {str(file.relative_to(baseline)): sha(file) for file in sorted(baseline.rglob('*')) if file.is_file()}, 'files': {file: sha(base / file) for file in files}}
target.write_text(json.dumps(value, indent=2) + '\n')
print(json.dumps({'status': value['status'], 'commit': commit, 'freezeSha256': sha(target), 'runtimeFiles': len(value['runtime']), 'baselineFiles': len(value['baselineRuntime'])}))
