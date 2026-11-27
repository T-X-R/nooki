import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './fake-host.ts'
import {delegateMeeting,createMeeting,readMeeting,listMeetings,publishMeeting,createTodo,attachMeeting,handoffMeeting,refreshMeeting,summarize} from '../../meeting.ts'
const tick=()=>new Promise(resolve=>setTimeout(resolve,1))
test('selected input becomes retained notes; explicit publication, task delivery and chat draft replay safely',async()=>{
 const f=fixture({loseAttachmentReply:true}),meeting=await createMeeting(f.host,'Release planning',[f.source],'en')
 const task=await f.host.tasks.start('summarize',{draftId:meeting.id});await f.settled(task)
 let draft=await readMeeting(f.host,meeting.id);assert.equal(draft.phase,'completed');assert.equal(f.calls.starts,1);assert.equal(f.calls.publishes,0)
 assert.ok(f.calls.agentInputs[0].input.outputSchema);assert.match(draft.text,/## Summary/);assert.match(draft.text,/Owner: Alex/);assert.ok(!draft.text.includes('\"summary\":'))
 assert.deepEqual(f.calls.agentInputs[0].input.sources,[f.source]);assert.equal((await listMeetings(f.host))[0].runId,draft.runId)
 draft=await publishMeeting(f.host,draft);f.host.documents.open(draft.document);assert.equal(f.publications.size,1);assert.equal(f.calls.opened[0].documentId,draft.document.documentId)
 draft=await createTodo(f.host,draft);await createTodo(f.host,draft);assert.equal(f.calls.creates,1)
 const stale=draft;await assert.rejects(attachMeeting(f.host,draft),{code:'OUTCOME_UNKNOWN'});draft=await readMeeting(f.host,draft.id)
 assert.ok(draft.pendingAttachment);draft=await attachMeeting(f.host,stale)
 assert.equal(f.calls.selections,1);assert.equal(f.calls.attachments,1);assert.deepEqual(f.calls.attachmentInputs[0],f.calls.attachmentInputs[1])
 draft=await handoffMeeting(f.host,draft);await handoffMeeting(f.host,draft);assert.equal(f.calls.handoffs,1)
 assert.equal(f.calls.starts,1);assert.equal((await listMeetings(f.host))[0].document.documentId,draft.document.documentId)
})
test('dismissed execution makes no run or publication; cancellation never publishes late results',async()=>{
 const denied=fixture({dismissAgent:true}),draft=await createMeeting(denied.host,'Dismissed',[denied.source],'zh')
 const stopped=await denied.host.tasks.start('summarize',{draftId:draft.id});await denied.settled(stopped)
 assert.equal((await readMeeting(denied.host,draft.id)).phase,'cancelled');assert.equal(denied.calls.starts,0);assert.equal(denied.calls.publishes,0)
 const f=fixture({autoComplete:false}),meeting=await createMeeting(f.host,'Cancelled',[f.source],'zh')
 const task=await f.host.tasks.start('summarize',{draftId:meeting.id});let active
 for(let i=0;i<100;i++){active=await readMeeting(f.host,meeting.id);if(active.runId)break;await tick()}
 await f.host.tasks.cancel(task);await f.settled(task);active=await refreshMeeting(f.host,await readMeeting(f.host,meeting.id))
 assert.equal(active.phase,'cancelled');await assert.rejects(publishMeeting(f.host,active));assert.equal(f.publications.size,0)
})
test('pending remote cancellation remains unresolved and does not expose a successful draft',async()=>{
 const f=fixture({autoComplete:false}),meeting=await createMeeting(f.host,'Pending',[f.source],'en')
 const result=await f.host.agents.start({agentId:'codex',instructions:'Synthetic',sources:[f.source]},{idempotencyKey:'pending'})
 f.emitRun({...result.run,cancellationRequested:true})
 const updated=await refreshMeeting(f.host,{...meeting,runId:result.run.id,phase:'running'})
 assert.equal(updated.phase,'unknown');await assert.rejects(publishMeeting(f.host,updated));assert.equal(f.calls.publishes,0)
})
test('schema failures never become publishable notes',async()=>{
 const f=fixture({invalidResult:true}),meeting=await createMeeting(f.host,'Invalid format',[f.source],'en')
 const task=await f.host.tasks.start('summarize',{draftId:meeting.id});await f.settled(task)
 const draft=await readMeeting(f.host,meeting.id);assert.equal(draft.phase,'failed');assert.equal(draft.text,'')
 await assert.rejects(publishMeeting(f.host,draft));assert.equal(f.calls.publishes,0);assert.equal(f.calls.starts,1)
})

test('independent follow-up retains notes and reconciles a lost reply after reopen',async()=>{
 const f=fixture({loseDelegationReply:true}),meeting=await createMeeting(f.host,'Follow-up',[f.source],'en')
 const task=await f.host.tasks.start('summarize',{draftId:meeting.id});await f.settled(task)
 let draft=await publishMeeting(f.host,await readMeeting(f.host,meeting.id))
 await assert.rejects(delegateMeeting(f.host,draft),{code:'OUTCOME_UNKNOWN'})
 draft=await delegateMeeting(f.host,draft);await delegateMeeting(f.host,draft)
 assert.equal(f.calls.creates,1);assert.equal(f.calls.delegations,1);assert.equal(f.calls.starts,1)
 assert.ok(f.calls.todoInputs[0].description.includes(draft.text));assert.equal(f.calls.delegationInputs[0].input.sourceRunId,draft.runId)
 assert.deepEqual(f.calls.delegationInputs[0],f.calls.delegationInputs[1]);assert.equal((await readMeeting(f.host,draft.id)).delegation.taskId,draft.delegation.taskId)
})
