"""Hold one synthetic catalog read for installed loading-state acceptance; restore within 60s."""
import json, os, pathlib, time, hashlib, sys
root=pathlib.Path(sys.argv[1]).resolve(strict=True)
assert json.loads((root/'profile.json').read_text())['format']=='nooki-test-profile'
p=root/'data/conversation-agents.json'; original=p.read_bytes()
sessions=json.loads(original)['sessions']
assert set(sessions)=={'pi-handoff-fixture-ordinary','pi-handoff-fixture-disappearing','pi-handoff-fixture-task'}
assert all(s['turns']==[] and not s['nativeStarted'] for s in sessions.values())
release=root/'release-catalog-read'
assert not release.exists()
fifo=root/'catalog-delay.fifo';os.mkfifo(fifo,0o600)
fd=os.open(fifo,os.O_RDWR|os.O_NONBLOCK)
os.replace(fifo,p)
print('READY: controlled synthetic catalog read delay',flush=True)
try:
 deadline=time.monotonic()+60
 while not release.exists() and time.monotonic()<deadline:time.sleep(.05)
 os.write(fd,original)
finally:
 restored=root/'catalog-restored.json';restored.write_bytes(original);os.replace(restored,p)
 os.close(fd)
 if release.exists():release.unlink()
 print('RESTORED '+hashlib.sha256(p.read_bytes()).hexdigest(),flush=True)
