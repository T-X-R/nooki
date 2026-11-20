"""Seed only a fresh disposable desktop profile; no real credentials or agent execution."""
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
marker = json.loads((root / 'profile.json').read_text())
assert marker['format'] == 'nooki-test-profile' and marker['version'] == 1
assert not (root / 'data').exists(), 'Use a new empty profile'

def write(name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))

id = 'example.notes/notes/2026/11/minutes'
reference = dict(kind='library-document', documentId=id, title='Original selected notes', grantId='selected', revision='2026-11-20T00:00:00Z')
original = '# Original selected notes\n\nORIGINAL SELECTED CONTENT — retained after revoke.\n'
current = '# Changed current notes\n\nCHANGED CURRENT CONTENT — should not replace the selection.\n'
write(f'data/document-library/{id}.json', dict(id=id, capabilityId='example.notes', capabilityName='Synthetic notes', collectionKey='notes', collectionName='Notes', key='minutes', title='Changed current notes', documentDate='2026-11-20', format='markdown', sizeBytes=len(current.encode()), createdAt=reference['revision'], updatedAt='2026-11-20T01:00:00Z'))
(root / f'data/document-library/{id}.md').write_text(current)
write('data/document-grants/selected.json', dict(id='selected', capabilityId='example.notes', capabilityVersion='1.0.0', createdAt=reference['revision'], documents=[dict(reference=reference, documentDate='2026-11-20', content=original)]))
write('data/document-grant-revocations/selected.json', dict(revoked=True))
source = dict(id=id, title=reference['title'], reference=reference)
missing = dict(id=id, title=reference['title'], reference={**reference, 'grantId': 'missing'})
write('data/task-board.json', dict(paused=True, cards=[
    dict(id='selected-task', title='Selected snapshot task', description='Use the originally selected content.', status='todo', sources=[source]),
    dict(id='missing-task', title='Missing source task', description='Capture must fail and leave this task idle.', status='todo', sources=[missing]),
    dict(id='plain-task', title='Current document task', description='Plain reference control.', status='todo', sources=[dict(id=id, title='Changed current notes')]),
]))
# Synthetic status metadata enables the delegate button. No tokens/keys exist, and the
# NOOKI_TEST_PROFILE execution prohibition stays enabled. The queue starts paused.
write('home/.codex/auth.json', dict(auth_mode='synthetic-fixture'))
print(root)
