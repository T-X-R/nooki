#!/usr/bin/env python3
"""Deterministic App Server protocol fixture; never calls a model."""
import json,sys,os
from pathlib import Path
import socket,threading,time,struct,hashlib,base64
assert sys.argv[1:3]==['app-server','--listen'], sys.argv
listener=socket.socket(socket.AF_UNIX)
listener.bind(sys.argv[3].removeprefix('unix://'))
listener.listen()
peer=None
fixture_workspace=Path.cwd()
Path('fake-daemon.pid').write_text(str(os.getpid()))
path=Path('fake-history.json')
threads=json.loads(path.read_text()) if path.exists() else {}
for thread in threads.values():
    for turn in thread['turns']:
        if turn['status']=='inProgress': turn['status']='interrupted';thread['status']={'type':'idle'}
def persist():path.write_text(json.dumps(threads))
write_lock=threading.Lock()
def frame(payload,opcode=1):
    length=len(payload)
    header=bytes([0x80|opcode,length]) if length<126 else bytes([0x80|opcode,126])+struct.pack('!H',length) if length<65536 else bytes([0x80|opcode,127])+struct.pack('!Q',length)
    with write_lock:
        if peer:peer.sendall(header+payload)
def out(value):
    try:frame(json.dumps(value).encode())
    except OSError:pass

def connections():
    global peer
    while True:
        peer,_=listener.accept()
        try:
            with peer.makefile('rb') as reader:
                if not reader.readline():continue
                headers={}
                while True:
                    line=reader.readline()
                    if not line or line==b'\r\n':break
                    key,value=line.decode().split(':',1);headers[key.lower()]=value.strip()
                if 'sec-websocket-key' not in headers:continue
                accept=base64.b64encode(hashlib.sha1((headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
                peer.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n').encode())
                while True:
                    head=reader.read(2)
                    if len(head)!=2:break
                    opcode=head[0]&15;length=head[1]&127
                    if length==126:length=struct.unpack('!H',reader.read(2))[0]
                    elif length==127:length=struct.unpack('!Q',reader.read(8))[0]
                    mask=reader.read(4) if head[1]&128 else None
                    payload=reader.read(length)
                    if mask:payload=bytes(value^mask[i%4] for i,value in enumerate(payload))
                    if opcode==8:frame(payload,8);break
                    if opcode==9:frame(payload,10);continue
                    if opcode==1:yield payload.decode()
        except (OSError,UnicodeError):pass
        finally:peer.close();peer=None

def background():
    while True:
        time.sleep(0.03)
        if not fixture_workspace.exists():os._exit(0)
        if Path('finish-background').exists():
            Path('finish-background').unlink()
            for t in threads.values():
                for turn in t['turns']:
                    if turn['status']=='inProgress':
                        turn['items'].append({'id':'background-final','type':'agentMessage','phase':'final_answer','text':'Finished while disconnected'})
                        turn['status']='completed';t['status']={'type':'idle'}
                        Path(t['cwd'],'background.md').write_text('Completed by the background worker')
                        persist();event('turn/completed',{'threadId':t['id'],'turn':turn})
threading.Thread(target=background,daemon=True).start()
def event(method,params):out({'method':method,'params':params})
for line in connections():
    request=json.loads(line);method=request.get('method');p=request.get('params',{});rid=request.get('id')
    if rid is None:continue
    with open('fake-requests.jsonl','a') as trace: trace.write(json.dumps(request)+'\n')
    def reply(value):out({'id':rid,'result':value})
    def error(message):out({'id':rid,'error':{'code':-32600,'message':message}})
    if method=='initialize':reply({'userAgent':'fake-codex'})
    elif method=='thread/start':
        tid='session-'+str(len(threads)+1)
        threads[tid]={'id':tid,'cwd':p.get('cwd',os.getcwd()),'preview':'','source':'vscode','updatedAt':1,'status':{'type':'idle'},'turns':[]}
        reply({'thread':threads[tid]})
    elif method=='thread/list':reply({'data':[t for t in threads.values() if t['turns'] and bool(t.get('archived')) == bool(p.get('archived')) and (not p.get('cwd') or t['cwd'] in (p['cwd'] if isinstance(p['cwd'],list) else [p['cwd']])) and (not p.get('sourceKinds') or t['source'] in p['sourceKinds'])],'nextCursor':None})
    elif method in ('thread/archive','thread/unarchive','thread/delete'):
        t=threads.get(p['threadId'])
        if not t:error('session missing');continue
        if method=='thread/delete':
            if not t.get('archived'):error('archive first');continue
            del threads[p['threadId']]
        else:t['archived']=method=='thread/archive'
        persist();reply({})
    elif method in ('thread/read','thread/resume'):
        t=threads.get(p['threadId'])
        if not t:error('session missing');continue
        if method=='thread/resume' and not t['turns']:error('no rollout found');continue
        if method=='thread/resume' and p.get('cwd'):t['cwd']=p['cwd'];persist()
        reply({'thread':{**t,'turns':[]}})
    elif method=='thread/turns/list':
        t=threads.get(p['threadId'])
        if not t or not t['turns']:error('thread is not materialized yet');continue
        reply({'data':list(reversed(t['turns'])),'nextCursor':None})
    elif method=='turn/start':
        t=threads[p['threadId']];text=p['input'][0]['text'];n=len(t['turns'])+1
        if p.get('cwd'):t['cwd']=p['cwd']
        turn={'id':'turn-'+str(n),'status':'inProgress','startedAt':n,'items':[{'id':'user-'+str(n),'clientId':p.get('clientUserMessageId'),'type':'userMessage','content':p['input']}]}
        t['status']={'type':'active'}
        t['turns'].append(turn);t['preview']=text;persist();reply({'turn':turn})
        event('turn/started',{'threadId':t['id'],'turn':turn})
        if text=='disconnect' and n==1:sys.exit(0)
        if text=='slow':continue
        if text=='async-question':
            question={'id':'question-'+str(n),'type':'agentMessage','phase':'final_answer','delivery':'async','text':'Which source?','questions':[{'title':'Which source?','options':['Notes','Documents']}]}
            turn['items'].append(question);persist()
            event('item/completed',{'threadId':t['id'],'turnId':turn['id'],'item':question})
            event('item/reasoning/summaryTextDelta',{'threadId':t['id'],'turnId':turn['id'],'itemId':'still-working','summaryIndex':0,'delta':'Work continues'})
            continue
        if text=='revise-documents':
            for file in Path(t['cwd']).iterdir():
                if file.suffix in ('.md','.txt'):file.write_text(file.read_text()+'\nEdited by fixture')
        if text=='write-document':Path(t['cwd'],'new-document.md').write_text('# New document\nCreated by fixture')
        reasoning={'id':'reason-'+str(n),'type':'reasoning','summary':['Checking sources'],'content':['not exposed']}
        event('item/started',{'threadId':t['id'],'turnId':turn['id'],'item':reasoning})
        event('item/reasoning/summaryTextDelta',{'threadId':t['id'],'turnId':turn['id'],'itemId':reasoning['id'],'summaryIndex':0,'delta':' summary'})
        answer={'id':'answer-'+str(n),'type':'agentMessage','text':'Answer '+str(n),'phase':'final_answer'}
        event('item/agentMessage/delta',{'threadId':t['id'],'turnId':turn['id'],'itemId':answer['id'],'delta':'Answer '})
        turn['items'] += [reasoning,answer]
        turn['status']='failed' if text=='fail-once' and n==1 else 'completed'
        if turn['status']=='failed':turn['error']={'message':'fixture failure'}
        t['status']={'type':'idle'}
        persist();event('item/completed',{'threadId':t['id'],'turnId':turn['id'],'item':answer});event('turn/completed',{'threadId':t['id'],'turn':turn})
    elif method=='turn/steer':
        t=threads[p['threadId']];turn=t['turns'][-1]
        if turn['status']!='inProgress' or turn['id']!=p['expectedTurnId']:error('active turn changed');continue
        user={'id':'steered-user','type':'userMessage','clientId':p['clientUserMessageId'],'content':p['input']}
        turn['items'].append(user);persist();reply({'turnId':turn['id']})
        event('item/completed',{'threadId':t['id'],'turnId':turn['id'],'item':user})
    elif method=='turn/interrupt':
        t=threads[p['threadId']];turn=next(x for x in t['turns'] if x['id']==p['turnId']);turn['status']='interrupted';t['status']={'type':'idle'};persist();reply({});event('turn/completed',{'threadId':t['id'],'turn':turn})
    else:error('unsupported method '+str(method))
