"""Verify relocation identities separately from immutable production receipts."""
from pathlib import Path
import hashlib, json, sys
ROOT = Path(__file__).resolve().parents[1]
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    digest = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()
manifest = read(ROOT / 'migration/manifest.json')
errors = []
for row in manifest['files']:
    file = (ROOT / row['destination']).resolve()
    if not file.is_relative_to(ROOT) or not file.is_file():
        errors.append('Missing package file: ' + row['destination']); continue
    actual = sha(file)
    if actual != row['destinationSha256']: errors.append('Package file changed: ' + row['destination'])
    if row['role'] in ('final-presentation', 'final-film', 'historical-verification') and actual != row['originalSha256']:
        errors.append('Original identity differs: ' + row['destination'])
review = read(ROOT / 'source/video/history/verification/independent-homepage-review.json')
production = read(ROOT / 'source/video/history/render/final-manifest.json')
for name in ('stage.js', 'stage.css', 'feature-detail.js'):
    digest = sha(ROOT / 'source/video' / name)
    if digest != review['reviewed_file_sha256'][name] or digest != production['sourceHashes'][name]:
        errors.append('Core visual source differs from production review: ' + name)
result = {'status': 'PASS' if not errors else 'FAIL', 'scope': 'Package identities, final artifact byte identity, immutable production receipts, unchanged core visual source. Runtime checks are separate.', 'filesChecked': len(manifest['files']), 'errors': errors}
(ROOT / 'migration/package-identity-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(bool(errors))
