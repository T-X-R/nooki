// Browser suite. Run `npm run dev -- --host 127.0.0.1 --port 5193`, then `npm run test:ui`.
// Use PLAYWRIGHT_MODULE for an external Playwright installation; requires Chrome.
// CONVERSATION_TEST_URL defaults to http://127.0.0.1:5193/. No real Codex calls are made.
import assert from 'node:assert/strict';
const installed = [
 ...['com.personal.codex-daily-review', 'com.personal.diary'].map(id => ({manifest:{id,name:id,description:'Removed bundled package',version:'1.0.0',entrypoints:['page'],permissions:[]},enabled:true})),
 {manifest:{id:'qa.external',name:'Independent package',description:'Installed from a ZIP',version:'1.0.0',entrypoints:['page'],permissions:[]},enabled:false,packageVersion:'1.0.0'},
];
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({headless:true, channel:'chrome'});
const context = await browser.newContext({viewport:{width:1240,height:820},permissions:['clipboard-read','clipboard-write']});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
try {
await page.addInitScript((installed)=>{
 localStorage.setItem('personal-workbench-preferences',JSON.stringify({state:{view:'conversations',language:'zh',theme:'light'},version:0}));
 const old={id:'old',preview:'历史测试会话',createdAt:1,updatedAt:999,turns:[{id:'t1',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'测试消息'}]},...Array.from({length:60},(_,i)=>({id:'r'+i,type:'reasoning',summary:i%2 ? ['公开摘要 '+i+'\n'+('摘要行\n'.repeat(100))] : []})),{id:'old-answer',type:'agentMessage',phase:'final_answer',text:'安装包在这个目录：\n\n```\n/com.personal.workbench/conversation-workspaces/bcbf704d041b7bddb40b1f02280ac7a4ec6f64f035adbe3ea2cec5f9915cd737/package.zip\n```\n\n配置：\n\n```json\n{"ready": true}\n```'}]}]};
 const docs=[{id:'notes/notes/2026/09/one',capabilityId:'notes',capabilityName:'工作记录',collectionKey:'notes',collectionName:'笔记',title:'已有记录',documentDate:'2026-09-09'}, {id:'summary/reports/2026/09/one',capabilityId:'summary',capabilityName:'项目总结',collectionKey:'reports',collectionName:'总结',title:'已有总结',documentDate:'2026-09-09'}];
 const organization={topics:[{id:'research',name:'研究专题',documentIds:[docs[0].id]},...Array.from({length:18},(_,i)=>({id:'topic-'+i,name:'其他专题 '+i,documentIds:[]})),{id:'empty',name:'空专题',documentIds:[]}],origins:{},trash:{},sections:{},customSections:[{id:'custom-collection',name:'我的收藏'}]};
 let tasks=[], nextId=1; let current=null; const callbacks=new Map(),events=new Map();
 window.qa={old,docs,organization,uninstalled:[],readDelay:1500,emit:(method,params)=>{for(const [event,handler] of events)if(event==='workbench:conversation-event') callbacks.get(handler)({event,id:handler,payload:{method,params}})}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:fn=>{let id=nextId++;callbacks.set(id,fn);return id},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
  if(command==='plugin:event|listen'){events.set(args.event,args.handler);return args.handler}
  if(command.startsWith('plugin:'))return null;
  if(command==='capability_agent')return 'codex';
  if(command==='agent_tools')return [{id:'codex',name:'Codex',directory:'/tmp/.codex/skills',detected:true,readsPool:false,custom:false,signIn:{state:'in',method:'ChatGPT',hint:null},servesCapabilities:true}];
  if(command==='list_capabilities')return installed;
  if(command==='uninstall_capability'){window.qa.uninstalled.push(args.id);installed=installed.filter(item=>item.manifest.id!==args.id);return}
  if(['library_search_content','library_capture_sources'].includes(command))return [];
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
  if(command==='conversation_list' && args.cursor)return {data:[{id:'earliest',preview:'更早创建但最近更新',createdAt:0,updatedAt:9999999999,turns:[]}],nextCursor:null};
  if(command==='conversation_list')return {data:[...(current ? [{...current,turns:[]}] : []),{...old,turns:[]},...(window.qa.additional || [])],nextCursor:window.qa.more ? 'older-page' : null};
  if(command==='conversation_read'){await new Promise(r=>setTimeout(r,window.qa.readDelay));return structuredClone(args.id==='old'?old:current??{id:'new-session',preview:'',createdAt:2,updatedAt:2,turns:[]})}
  if(command==='conversation_create'){await new Promise(r=>setTimeout(r,700));return {id:'new-session',preview:'',createdAt:2,updatedAt:2,turns:[]}}
  if(command==='conversation_run')return new Promise(resolve=>{
   window.qa.startTurn=()=>{
    const user={id:'native-user',type:'userMessage',clientId:args.request.requestId,content:[{type:'text',text:args.request.message}]};
    const turn={id:'native-turn',status:'inProgress',startedAt:100,items:[user,{id:'native-progress',type:'agentMessage',phase:'commentary',text:'核对资料的进展'},{id:'native-summary',type:'reasoning',summary:['公开思考摘要']},{id:'native-tool',type:'commandExecution',command:'read document',aggregatedOutput:'工具结果',status:'completed'}]};
    current={id:'new-session',preview:args.request.message,createdAt:2,updatedAt:Date.now()/1000,turns:[turn]};
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
}, installed);
await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
await page.getByRole('button',{name:'历史测试会话',exact:true}).waitFor();
assert.deepEqual(await page.locator('.primary-nav > button .nav-item-main, .primary-nav > div > button .nav-item-main').allTextContents(), ['创建会话', '今日', '技能池', '资料库', '能力']);
assert.equal(await page.locator('.sidebar').getByRole('button', {name:'任务',exact:true}).count(), 0);
assert.equal(await page.locator('.sidebar-content > :last-child').getAttribute('class'), 'nav-conversations sidebar-conversations');
const capabilitiesToggle = page.getByRole('button', {name:'能力',exact:true});
assert.deepEqual(await page.evaluate(()=>window.qa.uninstalled), ['com.personal.codex-daily-review','com.personal.diary']);
assert.deepEqual(await page.locator('#sidebar-installed-capabilities button').allTextContents(), []);
await capabilitiesToggle.focus(); await page.keyboard.press('Enter');
assert.equal(await page.locator('#sidebar-installed-capabilities').count(), 0);
const explore = page.locator('.brand-lockup').getByRole('button', {name:'探索灵感',exact:true});
await explore.focus(); await page.keyboard.press('Enter');
await page.locator('.capabilities-page').waitFor();
assert.equal(await explore.getAttribute('aria-current'), 'page');
assert.equal(await page.locator('.sidebar').getByRole('button', {name:'能力中心',exact:true}).count(), 0);
assert.equal(await page.locator('.capability-card').count(), 1, 'A separately installed package stays available');
await capabilitiesToggle.focus(); await page.keyboard.press('Enter');
assert.equal(await capabilitiesToggle.getAttribute('aria-expanded'), 'true');
await page.getByRole('button', {name:'今日',exact:true}).click();
await page.getByRole('heading', {level:1}).waitFor();
await page.getByRole('button', {name:'会话',exact:true}).click();
assert.equal(await page.locator('.conversation-page').count(), 0, 'Collapsing history does not navigate away from Today');
await page.getByRole('button', {name:'会话',exact:true}).click();
await page.getByRole('button', {name:'创建会话',exact:true}).click();
await page.locator('.conversation-page').waitFor();
for (const width of [980, 1240, 1440]) {
  await page.setViewportSize({width, height:680});
  await page.screenshot({path:`/private/tmp/nooki-sidebar-${width}.png`});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const sidebar = await page.locator('.sidebar').boundingBox();
  const exploreBounds = await explore.boundingBox();
  assert.ok(exploreBounds.x + exploreBounds.width <= sidebar.x + sidebar.width, 'Explore fits alongside the Nooki brand');
  const settings = await page.locator('.sidebar-settings').boundingBox();
  assert.ok(settings.y + settings.height <= 680, 'Settings stays visible at the minimum desktop height');
}
await page.setViewportSize({width:1240, height:820});
const historyRows = page.locator('#sidebar-conversation-history .nav-row-label');
const showMore = page.getByRole('button', {name:'显示更多', exact:true});
assert.equal(await historyRows.count(), 1);
assert.equal(await showMore.count(), 0, 'Short histories need no expansion button');
await page.evaluate(() => {
 window.qa.additional = Array.from({length:4}, (_,i) => ({id:'extra-'+i,preview:'较早会话 '+(i+1),createdAt:-i,updatedAt:999,turns:[]}));
 window.dispatchEvent(new Event('workbench:conversations-changed'));
});
await page.waitForFunction(() => document.querySelectorAll('#sidebar-conversation-history .nav-row-label').length === 5);
assert.equal(await showMore.count(), 0, 'Exactly five conversations need no expansion button');
await page.evaluate(() => {
 window.qa.additional = Array.from({length:11}, (_,i) => ({id:'extra-'+i,preview:'较早会话 '+(i+1),createdAt:-i,updatedAt:999,turns:[]}));
 window.dispatchEvent(new Event('workbench:conversations-changed'));
});
await showMore.waitFor();
assert.equal(await historyRows.count(), 5, 'Long histories initially show five conversations');
await showMore.focus(); await page.keyboard.press('Enter');
assert.equal(await historyRows.count(), 10, 'Show more reveals five more conversations using the keyboard');
await showMore.click();
assert.equal(await historyRows.count(), 12);
assert.equal(await showMore.count(), 0, 'Show more disappears when every conversation is visible');
await page.getByRole('button', {name:'会话',exact:true}).click();
await page.getByRole('button', {name:'会话',exact:true}).click();
await showMore.waitFor();
assert.equal(await historyRows.count(), 5, 'Closing and reopening the section restores the compact list');
await page.evaluate(() => { window.qa.additional = []; window.dispatchEvent(new Event('workbench:conversations-changed')); });
await page.waitForFunction(() => document.querySelectorAll('#sidebar-conversation-history .nav-row-label').length === 1);
await page.getByRole('button',{name:'历史测试会话',exact:true}).click();
await page.getByText('正在读取对话…',{exact:true}).waitFor({state:'visible',timeout:500});
const historyProcess=page.locator('.conversation-turn-process');
await historyProcess.waitFor();
const copyButtons=page.locator('.conversation-code-copy');
assert.equal(await copyButtons.count(),2, 'Every fenced path or code block has one copy action');
assert.deepEqual(await page.locator('.conversation-code-language').allTextContents(),['text','json']);
assert.deepEqual(await page.locator('.conversation-code-block').evaluateAll(blocks=>blocks.map(block=>{
 const toolbar=block.querySelector('.conversation-code-toolbar').getBoundingClientRect();
 const content=block.querySelector('pre').getBoundingClientRect();
 return toolbar.bottom<=content.top+1;
})),[true,true], 'The toolbar occupies its own row above the content');
assert.equal(await page.locator('.conversation-code-block pre').first().evaluate(element=>element.scrollWidth>element.clientWidth),true, 'Long paths scroll only inside the content row');
await page.screenshot({path:'/private/tmp/nooki-code-copy.png'});
await copyButtons.first().focus();
assert.equal(await copyButtons.first().evaluate(element=>element===document.activeElement),true, 'The native copy button is keyboard focusable');
await copyButtons.first().click();
await page.waitForFunction(()=>document.querySelector('.conversation-code-copy')?.getAttribute('aria-label')!=='复制内容');
assert.equal(await copyButtons.first().getAttribute('aria-label'),'已复制');
assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'/com.personal.workbench/conversation-workspaces/bcbf704d041b7bddb40b1f02280ac7a4ec6f64f035adbe3ea2cec5f9915cd737/package.zip');
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
await page.getByRole('button',{name:'创建会话',exact:true}).click();
const composer = page.getByRole('textbox',{name:'消息',exact:true});
await composer.fill('nooki');
for (const isComposing of [true, false]) {
 const allowed = await composer.evaluate((element, isComposing) => {
  element.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
  if (!isComposing) element.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:'nooki'}));
  const allowed = element.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',keyCode:isComposing ? 13 : 229,isComposing,bubbles:true,cancelable:true}));
  if (isComposing) element.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:'nooki'}));
  return allowed;
 }, isComposing);
 assert.equal(allowed, true, 'IME confirmation must remain available to the input method, including WebKit compositionend-before-keydown');
 assert.equal(await composer.inputValue(), 'nooki', 'IME confirmation preserves the draft');
 assert.equal(await page.locator('.conversation-user').count(), 0, 'IME confirmation does not send a message');
}
await composer.press('Shift+Enter');
assert.equal(await composer.inputValue(), 'nooki\n', 'Shift+Enter still inserts a newline');
await page.getByRole('textbox',{name:'消息',exact:true}).fill('马上显示的新会话');
await composer.press('Enter');
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
const sidebarTitles = () => page.locator('.nav-row-label').allTextContents();
assert.deepEqual(await sidebarTitles(), ['马上显示的新会话', '历史测试会话']);
await page.evaluate(() => {
 window.qa.old.updatedAt = 9999999999;
 window.qa.more = true;
 window.dispatchEvent(new Event('workbench:conversations-changed'));
});
await page.getByRole('button', {name:'显示更多',exact:true}).waitFor();
assert.deepEqual(await sidebarTitles(), ['马上显示的新会话', '历史测试会话'], 'Updating an older conversation must not move it');
await page.getByRole('button', {name:'显示更多',exact:true}).click();
await page.getByRole('button', {name:'更早创建但最近更新',exact:true}).waitFor();
assert.deepEqual(await sidebarTitles(), ['马上显示的新会话', '历史测试会话', '更早创建但最近更新'], 'Older pages stay in creation order');

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
assert.deepEqual(await dialog.getByRole('listbox',{name:'栏目',exact:true}).getByRole('option').allTextContents(),['工作记录','我的收藏']);
await page.keyboard.press('Escape');
assert.equal(await dialog.isVisible(),true, 'Escape closes the menu without closing the save dialog');
assert.equal(await sectionPicker.getAttribute('aria-expanded'),'false');
assert.equal(await sectionPicker.evaluate(el=>el===document.activeElement),true);
await topicPicker.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
await sectionPicker.click();
assert.deepEqual(await dialog.getByRole('listbox',{name:'栏目',exact:true}).getByRole('option').allTextContents(),['对话','我的收藏']);
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
await sectionPicker.click();
await dialog.getByRole('option',{name:'我的收藏',exact:true}).click();
await dialog.getByRole('button',{name:'保存',exact:true}).click();
await page.getByRole('button',{name:'已保存 · 打开',exact:true}).waitFor();
const saved=await page.evaluate(()=>{
 const doc=window.qa.docs.find(d=>d.content==='保存测试正文');
 return {doc, section:window.qa.organization.sections[doc.id], topic:window.qa.organization.topics.find(t=>t.id==='research'), origin:window.qa.organization.origins[doc.id]};
});
assert.equal(saved.doc.capabilityId,'workbench.conversations');
assert.equal(saved.section.id,'custom-collection');
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
