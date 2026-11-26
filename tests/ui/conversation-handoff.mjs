import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1240,height:900}});page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
 const source={kind:'library-document',documentId:'example.reader/notes/2026/11/original',title:'Retained notes',revision:'original-revision',grantId:'synthetic-grant'};
 const qa=window.qa={enabled:true,sequence:0,key:'',sources:[source],calls:[],drafts:{},receipts:{},tasks:[],pending:{},loseReply:false,missing:false,partial:false,delayCommit:false};
 let callbacks=0,session=0;
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>++callbacks,unregisterCallback(){},invoke:async(command,args={})=>{
  qa.calls.push({command,args});
  if(command.startsWith('plugin:'))return 1;
  if(['library_list_documents','library_search_content','skill_pool_list'].includes(command))return [];
  if(command==='library_organization')return{folders:[],origins:{},trash:{}};
  if(command==='task_board_read')return{cards:[]};
  if(command==='tasks_read')return qa.tasks;
  if(command==='tasks_write'){qa.tasks=args.records;return;}
  if(command==='conversation_handoff_begin'){
   if(qa.receipts[args.request.key])return{status:'committed',receipt:qa.receipts[args.request.key]};
   const handle=(++session).toString(16).padStart(64,'0');qa.pending[handle]=args.request;
   return{status:'pending',handle,requestId:args.request.requestId,capabilityId:'example.reader',version:'1.0.0'};
  }
  if(command==='conversation_handoff_cancel')return;
  if(command==='conversation_handoff_targets')return{data:args.request.cursor?[{id:'chat',title:'Existing chat'}]:[{id:'other',title:'Other chat'}],nextCursor:args.request.cursor?null:'second',partial:qa.partial};
  if(command==='conversation_handoff_commit'){
   if(qa.delayCommit)await new Promise(resolve=>{qa.releaseCommit=resolve});
   const pending=qa.pending[args.request.handle];const receipt=qa.receipts[pending.key]??{draftId:Object.keys(qa.receipts).length.toString(16).padStart(64,'a'),target:args.request.target};
   qa.receipts[pending.key]=receipt;qa.drafts[receipt.draftId]={id:receipt.draftId,title:pending.draft.title,text:pending.draft.text,target:receipt.target,documents:[{reference:source,documentDate:'2026-11-26',content:'Original retained text'}],capabilityId:'example.reader',capabilityVersion:'1.0.0',createdAt:'2026-11-26T00:00:00Z'};
   if(qa.loseReply){qa.loseReply=false;throw new Error('Lost reply')};return receipt;
  }
  if(command==='conversation_handoff_drafts')return Object.values(qa.drafts).map(({documents,text,...summary})=>summary);
  if(command==='conversation_handoff_read')return qa.drafts[args.request.id];
  if(command==='conversation_read'){if(qa.missing)throw new Error('Conversation removed');return{id:args.id,preview:'Existing chat',createdAt:1,updatedAt:1,turns:[]};}
  if(command==='conversation_create')return{id:'new-native',preview:'',createdAt:1,updatedAt:1,turns:[]};
  if(command==='conversation_handoff_sources')return qa.drafts[args.request.draftId].documents.map(doc=>({...doc,reference:{...doc.reference,snapshotId:args.request.snapshotId,handoffId:args.request.draftId}}));
  if(command==='conversation_run')return{threadId:args.request.threadId,turnId:'turn'};
  throw new Error(`Unexpected IPC ${command}`);
 }};
});
const url=process.env.HANDOFF_TEST_URL||'http://127.0.0.1:5193/tests/ui/fixtures/handoff.html';
const calls=command=>page.evaluate(command=>window.qa.calls.filter(call=>call.command===command),command);
try{
 await page.goto(url);
 const composer=page.getByRole('textbox',{name:'消息',exact:true});await composer.fill('Keep my unsent text');
 await page.getByRole('button',{name:'Request handoff',exact:true}).click();await page.getByRole('dialog').waitFor();
 assert.equal((await calls('conversation_handoff_targets')).length,0,'new drafts do not connect to an Agent catalog');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='Request handoff');
 assert.equal(await composer.inputValue(),'Keep my unsent text');assert.equal((await calls('conversation_handoff_commit')).length,0);
 await page.getByRole('button',{name:'Request handoff',exact:true}).click();
 await page.evaluate(()=>{window.qa.loseReply=true});await page.getByRole('button',{name:'保存并打开草稿',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();
 assert.equal(await page.getByRole('radio',{name:'新聊天',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'重试保存',exact:true}).click();await page.getByRole('region',{name:'待采用的草稿'}).waitFor();
 assert.equal(await composer.inputValue(),'Keep my unsent text');assert.equal((await calls('conversation_run')).length,0);assert.equal((await calls('conversation_create')).length,0);
 await page.getByRole('button',{name:'加入输入框',exact:true}).click();assert.equal(await composer.inputValue(),'Keep my unsent text\n\nPlease review these retained notes.');
 assert.equal((await calls('conversation_run')).length,0);
 await page.screenshot({path:'/tmp/nooki-c05-handoff-adopted.png'});
 await page.getByRole('button',{name:'Toggle chat',exact:true}).click();await page.getByRole('button',{name:'Toggle chat',exact:true}).click();assert.equal(await composer.inputValue(),'Keep my unsent text\n\nPlease review these retained notes.');await page.getByRole('button',{name:'移除草稿资料',exact:true}).waitFor();
 await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>window.qa.calls.some(c=>c.command==='conversation_run'));
 const sent=(await calls('conversation_run'))[0].args.request;assert.ok(sent.context.includes('original-revision'));assert.equal((await calls('library_capture_sources')).length,0);assert.equal((await calls('conversation_handoff_sources')).length,1);
 await page.getByRole('button',{name:'Existing composer',exact:true}).click();await composer.fill('Existing unsent draft');
 await page.getByRole('button',{name:'Request handoff',exact:true}).click();await page.getByRole('radio',{name:'已有聊天',exact:true}).check();await page.getByRole('button',{name:'加载更多',exact:true}).click();await page.getByRole('radio',{name:'Existing chat chat',exact:true}).check();
 await page.getByRole('button',{name:'保存并打开草稿',exact:true}).click();await page.getByRole('region',{name:'待采用的草稿'}).waitFor();assert.equal(await composer.inputValue(),'Existing unsent draft');
 const reads=(await calls('conversation_handoff_read')).length;await page.getByRole('button',{name:'Replay handoff',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('nav button').disabled);assert.equal((await calls('conversation_handoff_read')).length,reads,'replay cannot reopen a draft');
 // A disappeared target remains an error, never silently becomes a new conversation.
 await page.evaluate(()=>{window.qa.missing=true});await page.getByRole('button',{name:'能力包草稿',exact:true}).click();await page.getByRole('dialog').getByRole('button').filter({hasText:'Review notes'}).last().click();await page.getByRole('dialog').getByRole('alert').waitFor();assert.match(await page.getByRole('dialog').getByRole('alert').innerText(),/removed/);await page.keyboard.press('Escape');await page.evaluate(()=>{window.qa.missing=false});
 // Persisted offers stay available independently of their producer; this is a fixture, not native uninstall proof.
 await page.evaluate(()=>{window.qa.enabled=false});await page.getByRole('button',{name:'能力包草稿',exact:true}).click();await page.getByRole('dialog').getByRole('button').filter({hasText:'Review notes'}).first().click();await page.getByRole('region',{name:'待采用的草稿'}).waitFor();await page.evaluate(()=>{window.qa.enabled=true});
 for(const lang of ['zh','en']){
  if(lang==='en')await page.getByRole('button',{name:'Language',exact:true}).click();
  for(const theme of ['light','dark']){
   if(theme==='dark')await page.getByRole('button',{name:'Theme',exact:true}).click();
   await page.getByRole('button',{name:'Request handoff',exact:true}).click();
   for(const width of [1240,768,320]){await page.setViewportSize({width,height:900});const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/nooki-c05-handoff-${lang}-${theme}-${width}.png`});}
   await page.keyboard.press('Escape');await page.setViewportSize({width:1240,height:900});
   if(theme==='dark')await page.getByRole('button',{name:'Theme',exact:true}).click();
  }
 }
 // Disabling during approval closes the review and suppresses late navigation.
 await page.getByRole('button',{name:'Request handoff',exact:true}).click();await page.evaluate(()=>{window.qa.delayCommit=true});await page.getByRole('button',{name:'Save and open draft',exact:true}).click();
 await page.evaluate(async()=>{await window.qa.disable();window.qa.releaseCommit()});await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('[data-testid=result]').textContent==='CANCELLED');
 assert.deepEqual(errors,[]);console.log('PASS: real handoff review/composer components, dismissal/focus, immutable retry, no auto-send, preserved drafts, retained source dispatch, pagination, replay, missing targets, lifecycle, themes/languages and 320/768/1240 layouts');
}catch(error){console.error('Browser errors:',errors);await page.screenshot({path:'/tmp/nooki-c05-handoff-failure.png'});throw error}finally{await browser.close()}
