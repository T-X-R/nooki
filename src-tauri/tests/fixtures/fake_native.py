#!/usr/bin/env python3
import json, os, pathlib, sys, time
root = pathlib.Path('FIXTURE_ROOT')
agent = 'AGENT_NAME'
line = sys.stdin.readline()
with (root / 'prompts').open('a') as log:
    log.write(line.strip() + '\n')
def emit(value):
    print(json.dumps(value), flush=True)
if (root / 'fail').exists():
    emit({'type': 'result', 'is_error': True, 'result': 'network disconnected'})
    sys.exit(1)
if agent == 'claude':
    emit({'type': 'system', 'subtype': 'init'})
    emit({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': 'working'}}})
else:
    emit({'type': 'agent_start'})
    emit({'type': 'message_update', 'assistantMessageEvent': {'type': 'text_delta', 'delta': 'working'}})
    emit({'type': 'turn_end', 'message': {'role': 'assistant', 'stopReason': 'toolUse'}})
    emit({'type': 'message_end', 'message': {'role': 'assistant', 'stopReason': 'error', 'errorMessage': 'temporary error'}})
    emit({'type': 'agent_end', 'willRetry': True})
(root / 'pid').write_text(str(os.getpid()))
while not (root / 'finish').exists():
    time.sleep(.02)
pathlib.Path('background.md').write_text('finished while the UI was disconnected')
if agent == 'claude':
    emit({'type': 'result', 'result': 'finished document'})
else:
    emit({'type': 'message_end', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'finished document'}]}})
    emit({'type': 'agent_end', 'willRetry': False})
    emit({'type': 'agent_settled'})
    # RPC stays alive until its owner ends the completed execution.
    time.sleep(30)
