#!/usr/bin/env python3
"""Deterministic App Server protocol fixture; never calls a model."""
import json,sys,os
from pathlib import Path
path=Path('fake-history.json')
threads=json.loads(path.read_text()) if path.exists() else {}
for thread in threads.values():
    for turn in thread['turns']:
        if turn['status']=='inProgress': turn['status']='interrupted';thread['status']={'type':'idle'}
def persist():path.write_text(json.dumps(threads))
def out(value):print(json.dumps(value),flush=True)
def event(method,params):out({'method':method,'params':params})
for line in sys.stdin:
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
    elif method=='turn/interrupt':
        t=threads[p['threadId']];turn=next(x for x in t['turns'] if x['id']==p['turnId']);turn['status']='interrupted';t['status']={'type':'idle'};persist();reply({});event('turn/completed',{'threadId':t['id'],'turn':turn})
    else:error('unsupported method '+str(method))
