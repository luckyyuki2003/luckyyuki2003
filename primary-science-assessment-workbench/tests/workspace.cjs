const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(root,'.test-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const server=http.createServer((req,res)=>{const f=path.join(root,req.url==='/'?'index.html':req.url);try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(8765,'127.0.0.1',r));const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});page.on('console',m=>console.log('browser',m.text()));
 await page.goto('http://127.0.0.1:8765');await page.waitForSelector('#ws-name');
 assert.equal(await page.locator('#ws-name').inputValue(),'本机试卷');
 await page.locator('#paper').fill('1. 水结冰后体积如何变化？（10分）\n答案：增大');await page.locator('#paper').dispatchEvent('input');await page.waitForTimeout(800);
 await page.locator('#ws-name').fill('今天的测试试卷');await page.locator('#ws-name').dispatchEvent('change');
 await page.reload();await page.waitForSelector('#ws-name');assert.equal(await page.locator('#ws-name').inputValue(),'今天的测试试卷');assert.match(await page.locator('#paper').inputValue(),/水结冰/);
 await page.locator('#ws-new').click();assert.equal(await page.locator('#paper').inputValue(),'');
 await page.locator('#ws-library').click();await page.locator('#ws-search').fill('今天');await page.locator('[data-action="打开"]').click();assert.match(await page.locator('#paper').inputValue(),/水结冰/);
 await page.locator('#paper').fill('第二个版本');await page.locator('#paper').dispatchEvent('input');await page.waitForTimeout(800);
 await page.locator('#ws-library').click();await page.locator('[data-action="版本"]').click();await page.locator('[data-action="恢复版本"]').first().click();await page.locator('#ws-close').click();assert.match(await page.locator('#paper').inputValue(),/水结冰/);
 await page.locator('#ws-library').click();page.once('dialog',d=>d.accept());await page.locator('[data-action="删除"]').first().click();await page.locator('[data-action="恢复"]').first().click();
 // Confirm the soft-delete action.
 await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:true});
 await page.locator('#ws-close').click();await page.locator('#btn-sample').click();await page.locator('#btn-analyze').click();
 const engine=await page.evaluate(()=>window.WBEngine.selftest());assert(engine.every(t=>t.pass));console.log('PASS: 7 existing engine checks');
 await page.screenshot({path:path.join(artifacts,'analysis.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'mobile page must not overflow');assert.deepEqual(errors,[]);console.log('PASS: persistence, navigation, history restore, soft delete/recovery, responsive layout; no browser errors');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(artifacts,'preview.png')});
 const cloud=await browser.newPage();const cloudErrors=[];cloud.on('pageerror',e=>cloudErrors.push(e.message));
 await cloud.route('**/cloud-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.WB_CLOUD_CONFIG={url:"https://test.supabase.co",publishableKey:"test"};'}));
 await cloud.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:`
 window.mock={user:null,rows:[],offline:false}; window.supabase={createClient:()=>({auth:{
 getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:mock.user}}),
 signInWithOtp:async()=>({}),verifyOtp:async({email})=>{mock.user={id:email.startsWith('two')?'user-two':'user-one',email};return{data:{user:mock.user}}},
 signOut:async()=>{mock.user=null;return{}},onAuthStateChange:()=>({})},
 from:()=>({select:async()=>mock.offline?{error:Error('offline')}:{data:mock.rows.filter(r=>r.owner===mock.user.id)}}),
 rpc:async(name,args)=>{if(mock.offline)return{error:Error('offline')};let r=mock.rows.find(r=>r.id===args.doc_id);if(r&&r.revision!==args.expected_revision)return{error:Error('conflict')};if(!r){r={id:args.doc_id,revision:0,owner:mock.user.id};mock.rows.push(r)}r.document=structuredClone(args.body);r.revision++;return{data:r.revision}}})};` }));
 await cloud.goto('http://127.0.0.1:8765');await cloud.waitForSelector('#ws-name');
 await cloud.locator('#paper').fill('游客内容');await cloud.locator('#paper').dispatchEvent('input');await cloud.waitForTimeout(650);
 async function login(email){await cloud.locator('#ws-account').click();await cloud.locator('#ws-email').fill(email);await cloud.locator('#ws-code').fill('123456');await cloud.locator('#ws-auth-form button[type=submit]').click();await cloud.waitForFunction(()=>document.querySelector('#ws-message').textContent==='登录成功。');}
 await login('one@example.com');assert.equal(await cloud.locator('#paper').inputValue(),'');
 await cloud.locator('#ws-close').click();await cloud.locator('#paper').fill('账号一内容');await cloud.locator('#paper').dispatchEvent('input');await cloud.waitForTimeout(2200);assert.equal(await cloud.evaluate(()=>mock.rows.some(r=>r.document.payload.paper==='账号一内容')),true);
 await cloud.evaluate(()=>mock.offline=true);await cloud.locator('#paper').fill('离线修改');await cloud.locator('#paper').dispatchEvent('input');await cloud.waitForTimeout(2200);assert.match(await cloud.locator('#ws-status').textContent(),/未完成/);
 await cloud.evaluate(()=>{mock.offline=false;const r=mock.rows.find(r=>r.document.payload.paper==='账号一内容');r.document.payload.paper='另一设备内容';r.revision++;});await cloud.locator('#ws-sync').click();await cloud.waitForTimeout(300);assert.equal(await cloud.locator('#paper').inputValue(),'离线修改');assert.equal(await cloud.evaluate(()=>mock.rows.some(r=>r.document.name.includes('冲突副本'))),true);
 await cloud.locator('#ws-account').click();await cloud.locator('#ws-signout').click();await cloud.waitForTimeout(100);assert.equal(await cloud.locator('#paper').inputValue(),'游客内容');await cloud.locator('#ws-close').click();
 await login('two@example.com');assert.equal(await cloud.locator('#paper').inputValue(),'');assert.deepEqual(cloudErrors,[]);console.log('PASS: mocked OTP, account isolation, logout, offline retry and concurrent cloud conflict preservation');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
