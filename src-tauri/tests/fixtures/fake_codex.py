#!/usr/bin/env python3
"""Deterministic App Server protocol fixture; never calls a model."""
import json,sys,os
from pathlib import Path
path=Path('fake-history.json')
threads=json.loads(path.read_text()) if path.exists() else {}
for thread in threads.values():
    for turn in thread['turns']:
        if turn['status']=='inProgress': turn['status']='interrupted'
def persist():path.write_text(json.dumps(threads))
def out(value):print(json.dumps(value),flush=True)
def event(method,params):out({'method':method,'params':params})
for line in sys.stdin:
    request=json.loads(line);method=request.get('method');p=request.get('params',{});rid=request.get('id')
    if rid is None:continue
    def reply(value):out({'id':rid,'result':value})
    def error(message):out({'id':rid,'error':{'code':-32600,'message':message}})
    if method=='initialize':reply({'userAgent':'fake-codex'})
    elif method=='thread/start':
        tid='session-'+str(len(threads)+1)
        threads[tid]={'id':tid,'cwd':os.getcwd(),'preview':'','source':'vscode','updatedAt':1,'status':{'type':'idle'},'turns':[]}
        reply({'thread':threads[tid]})
    elif method=='thread/list':reply({'data':[t for t in threads.values() if t['turns'] and (not p.get('sourceKinds') or t['source'] in p['sourceKinds'])],'nextCursor':None})
    elif method in ('thread/read','thread/resume'):
        t=threads.get(p['threadId'])
        if not t:error('session missing');continue
        if method=='thread/resume' and not t['turns']:error('no rollout found');continue
        reply({'thread':{**t,'turns':[]}})
    elif method=='thread/turns/list':
        t=threads.get(p['threadId'])
        if not t or not t['turns']:error('thread is not materialized yet');continue
        reply({'data':list(reversed(t['turns'])),'nextCursor':None})
    elif method=='turn/start':
        t=threads[p['threadId']];text=p['input'][0]['text'];n=len(t['turns'])+1
        turn={'id':'turn-'+str(n),'status':'inProgress','startedAt':n,'items':[{'id':'user-'+str(n),'clientId':p.get('clientUserMessageId'),'type':'userMessage','content':p['input']}]}
        t['turns'].append(turn);t['preview']=text;persist();reply({'turn':turn})
        event('turn/started',{'threadId':t['id'],'turn':turn})
        if text=='disconnect' and n==1:sys.exit(0)
        if text=='slow':continue
        reasoning={'id':'reason-'+str(n),'type':'reasoning','summary':['Checking sources'],'content':['not exposed']}
        event('item/started',{'threadId':t['id'],'turnId':turn['id'],'item':reasoning})
        event('item/reasoning/summaryTextDelta',{'threadId':t['id'],'turnId':turn['id'],'itemId':reasoning['id'],'summaryIndex':0,'delta':' summary'})
        answer={'id':'answer-'+str(n),'type':'agentMessage','text':'Answer '+str(n),'phase':'final_answer'}
        event('item/agentMessage/delta',{'threadId':t['id'],'turnId':turn['id'],'itemId':answer['id'],'delta':'Answer '})
        turn['items'] += [reasoning,answer]
        turn['status']='failed' if text=='fail-once' and n==1 else 'completed'
        if turn['status']=='failed':turn['error']={'message':'fixture failure'}
        persist();event('item/completed',{'threadId':t['id'],'turnId':turn['id'],'item':answer});event('turn/completed',{'threadId':t['id'],'turn':turn})
    elif method=='turn/interrupt':
        t=threads[p['threadId']];turn=next(x for x in t['turns'] if x['id']==p['turnId']);turn['status']='interrupted';persist();reply({});event('turn/completed',{'threadId':t['id'],'turn':turn})
    else:error('unsupported method '+str(method))
