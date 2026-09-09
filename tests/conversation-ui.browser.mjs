// Start npm run dev -- --host 127.0.0.1 --port 5193, then run node tests/conversation-ui.browser.mjs.
// Use PLAYWRIGHT_MODULE for an external Playwright installation; requires Chrome.
// CONVERSATION_TEST_URL defaults to http://127.0.0.1:5193/. No real Codex calls are made.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, channel:'chrome'});
const page = await browser.newPage({viewport:{width:1240,height:820}});
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
try {
await page.addInitScript(()=>{
 localStorage.setItem('personal-workbench-preferences',JSON.stringify({state:{view:'conversations',language:'zh',theme:'light',providerKind:'codex-api'},version:0}));
 const old={id:'old',preview:'历史测试会话',updatedAt:1,turns:[{id:'t1',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'测试消息'}]},...Array.from({length:60},(_,i)=>({id:'r'+i,type:'reasoning',summary:i%2 ? ['公开摘要 '+i+'\n'+('摘要行\n'.repeat(100))] : []}))]}]};
 const docs=[{id:'diary/notes/2026/09/one',capabilityId:'diary',capabilityName:'日记',collectionKey:'notes',collectionName:'笔记',title:'已有日记',documentDate:'2026-09-09'}, {id:'daily/reports/2026/09/one',capabilityId:'daily',capabilityName:'Codex 每日总结',collectionKey:'reports',collectionName:'总结',title:'已有总结',documentDate:'2026-09-09'}];
 const organization={topics:[{id:'research',name:'研究专题',documentIds:[docs[0].id]},...Array.from({length:18},(_,i)=>({id:'topic-'+i,name:'其他专题 '+i,documentIds:[]})),{id:'empty',name:'空专题',documentIds:[]}],origins:{},trash:{},sections:{}};
 let tasks=[], nextId=1; let current=null; const callbacks=new Map(),events=new Map();
 window.qa={old,docs,organization,readDelay:1500,emit:(method,params)=>{for(const [event,handler] of events)if(event==='workbench:codex-event') callbacks.get(handler)({event,id:handler,payload:{method,params}})}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:fn=>{let id=nextId++;callbacks.set(id,fn);return id},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
  if(command==='plugin:event|listen'){events.set(args.event,args.handler);return args.handler}
  if(command.startsWith('plugin:'))return null;
  if(command==='get_selected_provider')return 'codex-api';
  if(command==='provider_status')return {kind:'codex-api',state:'ready',label:'Codex',detail:'Fixture'};
  if(['list_capabilities','library_search_content','library_capture_sources'].includes(command))return [];
  if(command==='library_list_documents')return structuredClone(docs);
  if(command==='library_organization')return structuredClone(organization);
  if(command==='conversation_publish'){
   const d=args.document,id=`workbench.conversations/${d.collectionKey}/${d.documentDate.slice(0,4)}/${d.documentDate.slice(5,7)}/${d.key}`;
   docs.push({...d,id,capabilityId:'workbench.conversations',capabilityName:'对话'}); return;
  }
  if(command==='library_change'){
   const c=args.change;
   if(c.kind==='place'){organization.sections[c.id]=c.section;if(c.topicId)organization.topics.find(t=>t.id===c.topicId).documentIds.push(c.id);return null}
   if(c.kind==='origin'){organization.origins[c.id]=c.origin;return null}
   throw new Error('Unexpected library change '+c.kind);
  }
  if(command==='tasks_read')return tasks;
  if(command==='tasks_write'){tasks=args.records;return}
  if(command==='conversation_list')return {data:[...(current ? [{...current,turns:[]}] : []),{...old,turns:[]}],nextCursor:null};
  if(command==='conversation_read'){await new Promise(r=>setTimeout(r,window.qa.readDelay));return structuredClone(args.id==='old'?old:current??{id:'new-session',preview:'',updatedAt:2,turns:[]})}
  if(command==='conversation_create'){await new Promise(r=>setTimeout(r,700));return {id:'new-session',preview:'',updatedAt:2,turns:[]}}
  if(command==='conversation_run')return new Promise(resolve=>{
   window.qa.startTurn=()=>{
    const user={id:'native-user',type:'userMessage',clientId:args.request.requestId,content:[{type:'text',text:args.request.message}]};
    const turn={id:'native-turn',status:'inProgress',startedAt:100,items:[user,{id:'native-progress',type:'agentMessage',phase:'commentary',text:'核对资料的进展'},{id:'native-summary',type:'reasoning',summary:['公开思考摘要']},{id:'native-tool',type:'commandExecution',command:'read document',aggregatedOutput:'工具结果',status:'completed'}]};
    current={id:'new-session',preview:args.request.message,updatedAt:Date.now()/1000,turns:[turn]};
    window.qa.emit('turn/started',{threadId:current.id,turn});
   };
   window.qa.finish=()=>{
    current.turns[0].items.push({id:'native-answer',type:'agentMessage',phase:'final_answer',text:'保存测试正文'});
    current.turns[0].status='completed';
    current.turns[0].completedAt=165; current.turns[0].durationMs=65000;
    window.qa.emit('turn/completed',{threadId:current.id,turn:current.turns[0]});
    resolve({threadId:current.id,turnId:current.turns[0].id});
   };
  });
  throw new Error('Unexpected '+command);
 }};
});
await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
await page.getByRole('button',{name:'历史测试会话',exact:true}).click();
await page.getByText('正在读取对话…',{exact:true}).waitFor({state:'visible',timeout:500});
const historyProcess=page.locator('.conversation-turn-process');
await historyProcess.waitFor();
assert.equal(await historyProcess.getAttribute('open'),null, 'Completed history starts collapsed');
await historyProcess.locator(':scope > summary').click();
assert.equal(await page.locator('.conversation-reasoning').count(),30, 'Empty summaries stay hidden');
assert.equal(await page.locator('.conversation-reasoning').evaluateAll(els=>els.filter(e=>e.parentElement.closest('details')?.className!=='conversation-turn-process').length),0, 'Summaries have no individual disclosure');
const messages=page.locator('.conversation-messages');
await messages.hover({position:{x:3,y:100}}); await page.mouse.wheel(0,-600); await page.waitForTimeout(150);
assert.equal(await messages.evaluate(e=>e.scrollTop),0);
await messages.evaluate(e=>{e.scrollTop=e.scrollHeight});
await page.waitForTimeout(100);
await messages.hover({position:{x:3,y:100}}); await page.mouse.wheel(0,-40); await page.waitForTimeout(100);
const beforeDelta=await messages.evaluate(e=>e.scrollTop);
assert.ok(beforeDelta>0, 'Fixture must overflow the message pane');
await page.evaluate(()=>window.qa.emit('item/agentMessage/delta',{threadId:'old',turnId:'t1',itemId:'stream',delta:'新的进展'}));
await page.waitForTimeout(100);
assert.equal(await messages.evaluate(e=>e.scrollTop),beforeDelta, 'Incoming output must not reset upward scrolling');
// Expanded process output is keyboard-scrollable and does not move the message pane.
const output=page.locator('.conversation-reasoning').last();
await output.focus();
const outerTop=await messages.evaluate(e=>e.scrollTop);
await page.keyboard.press('PageDown'); await page.waitForTimeout(200);
assert.ok(await output.evaluate(e=>e.scrollTop)>0);
assert.equal(await messages.evaluate(e=>e.scrollTop),outerTop);
await page.evaluate(()=>window.qa.emit('item/agentMessage/delta',{threadId:'old',turnId:'t1',itemId:'stream',delta:'后续进展'}));
await page.waitForTimeout(100);
assert.equal(await messages.evaluate(e=>e.scrollTop),outerTop);
// Returning to the bottom resumes following.
await messages.evaluate(e=>{e.scrollTop=e.scrollHeight}); await page.waitForTimeout(100);
await page.evaluate(()=>window.qa.emit('item/agentMessage/delta',{threadId:'old',turnId:'t1',itemId:'stream',delta:'\n更多进展'.repeat(30)}));
await page.waitForTimeout(100);
assert.ok(await messages.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)<=2);

// A subsequent history read can omit a summary already received publicly.
await page.evaluate(()=>{
  window.qa.emit('item/reasoning/summaryTextDelta',{threadId:'old',turnId:'t1',itemId:'retained',summaryIndex:0,delta:'保留已经收到的公开摘要'});
  window.qa.old.turns[0].items.push({id:'retained',type:'reasoning',summary:[]});
});
await page.getByRole('button',{name:'刷新对话',exact:true}).click();
await page.waitForTimeout(1700);
assert.equal(await page.locator('.conversation-reasoning').filter({hasText:'保留已经收到的公开摘要'}).count(),1);
await page.getByRole('button',{name:'新对话',exact:true}).click();
await page.getByRole('textbox',{name:'消息',exact:true}).fill('马上显示的新会话');
await page.getByRole('button',{name:'发送消息',exact:true}).click();
await page.getByText('正在准备对话…',{exact:true}).waitFor({state:'visible',timeout:500});
await page.waitForTimeout(900);
const newSession=page.locator('#sidebar-conversation-history').getByRole('button',{name:'马上显示的新会话',exact:true});
assert.equal(await newSession.count(),1);
const user=page.locator('.conversation-user').filter({hasText:'马上显示的新会话'});
assert.equal(await user.count(),1);
assert.equal(await page.getByText('正在生成…',{exact:true}).isVisible(),true, 'First turn has a placeholder before output');
await page.evaluate(()=>window.qa.startTurn()); await page.waitForTimeout(100);
assert.equal(await user.count(),1, 'Native user event must replace the pending message');
const liveProcess=page.locator('.conversation-turn-process');
assert.equal(await page.getByText('正在生成…',{exact:true}).count(),0, 'Process replaces the initial generation placeholder');
assert.equal(await page.getByText('进展',{exact:true}).count(),0);
assert.equal(await liveProcess.getAttribute('open'),'');
assert.equal(await liveProcess.getByText('公开思考摘要',{exact:true}).isVisible(),true);
await liveProcess.locator(':scope > summary').click();
await page.evaluate(()=>window.qa.emit('item/reasoning/summaryTextDelta',{threadId:'new-session',turnId:'native-turn',itemId:'native-summary',summaryIndex:0,delta:' 后续摘要'}));
await page.waitForTimeout(100);
assert.equal(await liveProcess.getAttribute('open'),null, 'Streaming must respect a manually collapsed process');
await liveProcess.locator(':scope > summary').click();
await liveProcess.locator('.conversation-process > summary').click();
assert.equal(await liveProcess.getAttribute('open'),'', 'Tool disclosure must not toggle the whole process');
await page.evaluate(()=>window.qa.finish()); await page.waitForTimeout(1700);
assert.equal(await newSession.count(),1, 'Authoritative listing must not duplicate the new session');
assert.equal(await user.count(),1);
assert.equal(await liveProcess.getAttribute('open'),null, 'Completion automatically collapses the process');
assert.equal(await liveProcess.locator(':scope > summary').innerText(),'用时 1分 5秒');
assert.equal(await page.getByText('保存测试正文',{exact:true}).isVisible(),true);
assert.equal(await page.getByText('核对资料的进展',{exact:true}).isVisible(),false);
await liveProcess.locator(':scope > summary').click();
assert.equal(await page.getByText('核对资料的进展',{exact:true}).isVisible(),true);
assert.equal(await page.getByText('保存测试正文',{exact:true}).isVisible(),true);
await page.getByRole('button',{name:'刷新对话',exact:true}).click(); await page.waitForTimeout(1700);
assert.equal(await liveProcess.getAttribute('open'),'', 'Refreshing completed history preserves a manual expansion');
assert.equal(await liveProcess.locator(':scope > summary').innerText(),'用时 1分 5秒', 'Completed duration stays fixed after refresh');
await liveProcess.locator(':scope > summary').click();
await page.getByRole('button',{name:'保存到资料库',exact:true}).click();
const dialog=page.getByRole('dialog',{name:'保存到资料库',exact:true});
const topicPicker=dialog.getByRole('button',{name:/^专题 /});
const sectionPicker=dialog.getByRole('button',{name:/^栏目 /});
await topicPicker.waitFor();
assert.equal(await dialog.locator('textarea').count(),0, 'Save dialog must not expose the document body');
assert.equal(await dialog.getByText('保存测试正文',{exact:true}).count(),0);
await topicPicker.click();
assert.ok(await dialog.getByRole('listbox',{name:'专题',exact:true}).evaluate(el=>el.scrollHeight>el.clientHeight), 'Long option lists scroll inside the menu');
await dialog.getByRole('option',{name:'研究专题',exact:true}).click();
await sectionPicker.click();
assert.deepEqual(await dialog.getByRole('listbox',{name:'栏目',exact:true}).getByRole('option').allTextContents(),['日记']);
await page.keyboard.press('Escape');
assert.equal(await dialog.isVisible(),true, 'Escape closes the menu without closing the save dialog');
assert.equal(await sectionPicker.getAttribute('aria-expanded'),'false');
assert.equal(await sectionPicker.evaluate(el=>el===document.activeElement),true);
await topicPicker.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
await sectionPicker.click();
assert.deepEqual(await dialog.getByRole('listbox',{name:'栏目',exact:true}).getByRole('option').allTextContents(),['对话']);
await dialog.getByRole('heading',{name:'保存到资料库',exact:true}).click();
await page.waitForFunction(()=>document.querySelectorAll('.conversation-destination-menu:popover-open').length===0,{},{timeout:1000});
await page.waitForTimeout(50);
assert.equal(await sectionPicker.getAttribute('aria-expanded'),'false', 'Clicking outside dismisses the menu');
await topicPicker.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
assert.equal(await topicPicker.innerText(),'研究专题');
await sectionPicker.click();
await sectionPicker.click();
await page.waitForFunction(()=>document.querySelectorAll('.conversation-destination-menu:popover-open').length===0,{},{timeout:1000});
await page.waitForTimeout(50);
assert.equal(await sectionPicker.getAttribute('aria-expanded'),'false', 'Trigger toggles an open menu closed');
await sectionPicker.click(); await page.keyboard.press('Tab');
assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).evaluate(el=>el===document.activeElement),true, 'Tab continues to the next form control');
assert.equal(await page.locator('.conversation-destination-menu:popover-open').count(),0, 'Tab closes the popup before moving to the next control');
await dialog.getByRole('button',{name:'保存',exact:true}).click();
await page.getByRole('button',{name:'已保存 · 打开',exact:true}).waitFor();
const saved=await page.evaluate(()=>{
 const doc=window.qa.docs.find(d=>d.content==='保存测试正文');
 return {doc, section:window.qa.organization.sections[doc.id], topic:window.qa.organization.topics.find(t=>t.id==='research'), origin:window.qa.organization.origins[doc.id]};
});
assert.equal(saved.doc.capabilityId,'workbench.conversations');
assert.equal(saved.section.id,'diary');
assert.ok(saved.topic.documentIds.includes(saved.doc.id));
assert.equal(saved.origin.messageId,'native-answer');
await page.getByRole('textbox',{name:'消息',exact:true}).fill('第二轮继续修改');
await page.getByRole('button',{name:'发送消息',exact:true}).click();
await page.locator('.conversation-user').filter({hasText:'第二轮继续修改'}).waitFor();
assert.equal(await page.getByText('正在生成…',{exact:true}).count(),0, 'Follow-up turns need no generation placeholder');
assert.equal(await page.getByText('正在准备对话…',{exact:true}).count(),0);
assert.deepEqual(errors,[]);
console.log('PASS: loading feedback, public summaries, live scrolling, process scrolling, immediate session listing, message reconciliation and topic/section saving and per-turn process disclosure');

} finally { await browser.close(); }
