import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,channel:'chrome'})
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`${process.env.UI_BASE_URL||'http://127.0.0.1:1420'}/tests/ui/fixtures/agent.html`)
 await page.getByRole('button',{name:'Generate notes'}).click();await page.getByRole('dialog').waitFor()
 assert.match(await page.getByRole('dialog').innerText(),/Synthetic transcript/)
 assert.deepEqual(await page.evaluate(()=>window.qa.calls),['capability_agent_begin'])
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.activeElement?.textContent==='Generate notes')
 assert.match(await page.locator('output').textContent(),/dismissed/)
 await page.evaluate(()=>{window.qa.loseReply=true});await page.getByRole('button',{name:'Generate notes'}).click()
 await page.getByRole('button',{name:'确认执行',exact:true}).click();await page.getByRole('alert').waitFor()
 await page.getByRole('button',{name:'重试原请求',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
 assert.match(await page.locator('output').textContent(),/Meeting notes ready/)
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(c=>c==='capability_agent_approve').length),1)
 assert.deepEqual(errors,[])
 console.log('Agent review UI: dismissal/focus, exact confirmation, uncertain retry and result passed (synthetic Host).')
}finally{await browser.close()}
