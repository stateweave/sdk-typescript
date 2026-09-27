"""Reassemble and checksum the preserved evidence; makes no provider requests."""
import hashlib
import json
import os
import sys
from pathlib import Path


def restore(destination):
    root = Path(__file__).parent / 'evidence'
    manifest = json.loads((root / 'manifest.json').read_text())
    digest = hashlib.sha256()
    size = 0
    with destination.open('xb') as output:
        os.chmod(destination, 0o600)
        for part in manifest['parts']:
            assert Path(part['file']).name == part['file']
            file = root / part['file']
            assert file.stat().st_size == part['bytes']
            part_digest = hashlib.sha256()
            with file.open('rb') as source:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
                    part_digest.update(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            assert part_digest.hexdigest() == part['sha256'], part['file']
        output.flush()
        os.fsync(output.fileno())
    assert size == manifest['archiveBytes'] and digest.hexdigest() == manifest['archiveSha256']
    print(json.dumps({'bytes': size, 'sha256': digest.hexdigest(), 'destination': str(destination)}))


if __name__ == '__main__':
    restore(Path(sys.argv[1]))
