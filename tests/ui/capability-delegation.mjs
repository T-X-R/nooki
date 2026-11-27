import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,channel:'chrome'})
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`${process.env.UI_BASE_URL||'http://127.0.0.1:1420'}/tests/ui/fixtures/task-delegation.html`)
 await page.getByRole('button',{name:'请求交接',exact:true}).click()
 await page.getByRole('button',{name:'取消',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.qa.commits),0)
 await page.getByRole('button',{name:'请求交接',exact:true}).click()
 await page.getByText('已批准的纪要',{exact:true}).click()
 await page.getByText('周五交付原型。',{exact:true}).waitFor()
 await page.getByRole('button',{name:'确认并交给 Codex',exact:true}).click()
 await page.getByRole('alert').waitFor()
 await page.screenshot({path:'/tmp/nooki-delegation-ui.png',fullPage:true})
 await page.getByRole('button',{name:'重试交接',exact:true}).click()
 await page.getByRole('dialog').waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.qa.commits),1);assert.equal(await page.evaluate(()=>window.qa.attempts),2);assert.deepEqual(errors,[])
 console.log('Delegation UI passed: inspect retained material, dismiss without execution, approve and reconcile a lost reply.')
}finally{await browser.close()}
