import hashlib
import json
from pathlib import Path
import sys
from results import summarize
from accounting import summarize as account
from confirmation_gate import gate
from scan_evidence import digest_files

root, data, judgments, audit_file, provider_scan_file, pi_scan_file = map(Path, sys.argv[1:7])
base = Path(__file__).parent
freeze = json.loads((base / 'CONFIRMATORY_FREEZE.json').read_text())
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['freeze'] == freeze and manifest['commit'] == freeze['commit']
assert freeze['status'] == 'frozen' and not manifest['simulated']
for file, digest in freeze['files'].items():
    assert hashlib.sha256((base / file).read_bytes()).hexdigest() == digest
assert hashlib.sha256((data / 'manifest.json').read_bytes()).hexdigest() == freeze['cohortManifestSha256']
provider_scan = json.loads(provider_scan_file.read_text())
pi_scan = json.loads(pi_scan_file.read_text())
generation_hashes, generation_digest = digest_files(root)
_, judgments_digest = digest_files(judgments)
assert provider_scan['credentialSets'] == ['configured-main', 'configured-jev']
assert pi_scan['credentialSets'] == ['configured-pi-auth']
assert provider_scan['digests']['generation'] == pi_scan['digests']['generation'] == generation_digest
assert pi_scan['digests']['judgments'] == judgments_digest
assert all(scan['credentialMatches'] == 0 and scan['hiddenContentBlocks'] == 0 for scan in [provider_scan, pi_scan])
summary = summarize(root, data, judgments, 'holdout')
accounting = account(root)
audit = json.loads(audit_file.read_text())
assert audit['sourceCommit'] == freeze['commit'] and audit['frozenRuntime'] == freeze['runtime']
assert audit['evidenceHashes'] == generation_hashes
assert audit['phase'] == 'confirmatory' and not audit['simulated'] and audit['cases'] == 196
assert {row['id'] for row in audit['rows']} == {row['id'] for row in summary['ledger']}
for row in summary['ledger']:
    audited = next(item for item in audit['rows'] if item['id'] == row['id'])
    for arm, outcome in row['outcomes'].items():
        assert audited['arms'][arm]['returnedStateAudited'] == (outcome['status'] == 'done')
        if outcome['status'] == 'done':
            assert audited['arms'][arm]['promptSha256'] == row['firstPromptHashes'][arm]
        else:
            assert audited['arms'][arm]['failedCommitPreserved']
summary['credentialScans'] = [provider_scan, pi_scan]
summary['accounting'] = accounting
summary['integrity'] = {'cases': audit['cases'], 'returnedStates': audit['returnedStates'], 'auditSha256': hashlib.sha256(audit_file.read_bytes()).hexdigest()}
summary['adoptionGate'] = gate(summary)
print(json.dumps(summary, indent=2, allow_nan=False))
