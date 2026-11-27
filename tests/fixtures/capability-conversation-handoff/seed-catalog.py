"""Seed unstarted local conversations in an isolated profile; never starts an Agent."""
import fcntl
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
marker = json.loads((root / 'profile.json').read_text())
assert marker['format'] == 'nooki-test-profile' and marker['version'] == 1
assert len(marker['storeId']) == 16
folder = root / 'data'
folder.mkdir(exist_ok=True)
assert folder.resolve() == folder, 'Do not seed through a symlink'
catalog = folder / 'conversation-agents.json'
board = folder / 'task-board.json'
with (folder / 'task-data.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert not catalog.exists() and not board.exists(), 'Do not overwrite existing catalog/board'
    sessions = {}
    for suffix, title in [('ordinary', 'Handoff ordinary synthetic chat'),
                          ('disappearing', 'Handoff disappearing synthetic chat'),
                          ('task', 'Handoff task-owned synthetic chat')]:
        id = 'pi-handoff-fixture-' + suffix
        sessions[id] = dict(id=id, agent='pi', nativeId=id, sessionFile=None,
                            nativeStarted=False, preview=title, createdAt=1795737600000,
                            updatedAt=1795737600000, archived=False, turns=[])
    # Reuse the existing local-catalog adapter format. These sessions have never run Pi.
    with catalog.open('x') as output:
        json.dump(dict(sessions=sessions), output, indent=2)
    with board.open('x') as output:
        json.dump(dict(paused=True, cards=[dict(id='handoff-catalog-task',
            title='Synthetic task ownership fixture', description='Never execute',
            status='todo', engine='goals', threadId='pi-handoff-fixture-task')]), output, indent=2)
print(root)
