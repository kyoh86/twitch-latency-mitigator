#!/usr/bin/env python3
"""Create a deterministic, runtime-only store upload ZIP. No dependencies."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
files = {'manifest.json', 'LICENSE'}
for content in manifest['content_scripts']:
    files.update(content.get('js', []))
    files.update(content.get('css', []))
files.update(manifest['icons'].values())
options = manifest['options_ui']['page']
files.add(options)

class Resources(HTMLParser):
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        reference = values.get('src') if tag == 'script' else values.get('href') if tag == 'link' else None
        if reference:
            if ':' in reference or reference.startswith('/'):
                raise ValueError('Options must use packaged resources: ' + reference)
            files.add((Path(options).parent / reference).as_posix())

Resources().feed((ROOT / options).read_text())
for locale in sorted((ROOT / '_locales').glob('*/messages.json')):
    catalog = json.loads(locale.read_text())
    assert len(catalog['extensionDescription']['message']) <= 132
    files.add(locale.relative_to(ROOT).as_posix())
assert (ROOT / '_locales' / manifest['default_locale'] / 'messages.json').is_file()
for name in files:
    path = ROOT / name
    if not path.resolve().is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Missing or invalid package resource: ' + name)

output = ROOT / 'dist' / f"twitch-latency-mitigator-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for name in sorted(files):
        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / name).read_bytes())
print(output.relative_to(ROOT))
print(f'{len(files)} files; {output.stat().st_size} bytes')
print('SHA-256: ' + hashlib.sha256(output.read_bytes()).hexdigest())
