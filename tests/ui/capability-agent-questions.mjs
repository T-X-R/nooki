import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,channel:'chrome'})
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`${process.env.UI_BASE_URL||'http://127.0.0.1:1420'}/tests/ui/fixtures/agent-questions.html`)
 await page.getByRole('button',{name:'Codex 有 1 项需要你处理'}).click()
 assert.equal(await page.getByRole('button',{name:'发送回答',exact:true}).isDisabled(),true)
 await page.getByRole('button',{name:'稍后回答'}).click()
 await page.getByRole('button',{name:'Codex 有 1 项需要你处理'}).click()
 await page.getByRole('radio',{name:'发布纪要',exact:true}).check()
 await page.screenshot({path:'/tmp/nooki-interactions-ui.png',fullPage:true})
 await page.getByRole('button',{name:'发送回答',exact:true}).click()
 await page.getByRole('dialog').waitFor({state:'hidden'})
 await page.getByRole('button',{name:'Codex 有 1 项需要你处理'}).waitFor({state:'hidden'})
 assert.deepEqual(await page.evaluate(()=>window.qa.answers),[['发布纪要']]);assert.deepEqual(errors,[])
 console.log('Host questions UI passed: postpone, reopen, validate and submit one answer.')
}finally{await browser.close()}
