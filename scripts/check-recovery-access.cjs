'use strict';
// Optional Playwright UI regression. Uses the actual dashboard in guest mode; no patient records.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.DAI_TEST_FRONTEND_ROOT||path.resolve(__dirname,'../frontend');
(async()=>{let browser,server;try{
 server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(name.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:'Guest UI test; no backend data'}));return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.DAI_BROWSER_EXECUTABLE?{executablePath:process.env.DAI_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{localStorage.setItem('dai_guest','1');localStorage.setItem('dai-low-bandwidth','false');});await context.route('https://**/*',r=>r.abort());
 const page=await context.newPage(),tourErrors=[],writes=[];page.on('pageerror',e=>tourErrors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});
 await page.goto(base+'/dashboard.html#facilities');await page.locator('#patientFindCare').waitFor();
 assert.equal(await page.locator('#patientCareShortcuts button').count(),4);
 for(const panel of ['facilities','appointments','records','family']){await page.locator('.sidebar [data-panel="dashboard"]').click();await page.locator('#patientCareShortcuts [data-route="'+panel+'"]').click();assert.ok(await page.locator('#panel-'+panel).evaluate(el=>el.classList.contains('is-active')),panel);}
 await page.locator('#patientFindCare').click();assert.ok(await page.locator('#panel-facilities').evaluate(el=>el.classList.contains('is-active')));assert.ok(await page.locator('#nwSearchDrawer').evaluate(el=>el.open));assert.ok(await page.locator('#service').isVisible());
 await page.evaluate(()=>{const today=PatientModel.today(),birth=new Date(Date.parse(today+'T12:00:00Z')-129*86400000).toISOString().slice(0,10);window.recoveryFixture={user:{id:0,guest:true,full_name:'SYNTHETIC Demo Mother'},children:[{id:1,name:'SYNTHETIC Baby 1',date_of_birth:birth},{id:2,name:'SYNTHETIC Baby 2',date_of_birth:birth}],post:{active:true,delivery:{date:birth},days_postpartum:129,week:19,checkins_open:false,schedule:[{code:'pnc42',title:'SYNTHETIC postnatal follow-up',window_end:birth,status:'overdue'}]}};PatientExperience.update(recoveryFixture);LittleWorld.recoveryUpdate(recoveryFixture);});
 await page.locator('.sidebar [data-panel="postpartum"]').evaluate(el=>{el.closest('details').open=true;el.click();});await page.locator('.rx-recovery').waitFor();
 assert.match(await page.locator('.rx-summary').innerText(),/129/);assert.ok(!(await page.locator('.rx-recovery').innerText()).includes('of 42 days'));assert.match(await page.locator('.rx-summary').innerText(),/Window closed/);
 for(const id of ['dashboard','timeline','gaps','postpartum','appointments','children','records','facilities','schemes','family','companion','messages','settings']){const nav=page.locator('.sidebar .nav-item[data-panel="'+id+'"]').first();await nav.evaluate(el=>{const d=el.closest('details');if(d)d.open=true;el.click();});assert.ok(await page.locator('#panel-'+id).evaluate(el=>el.classList.contains('is-active')),'Navigation '+id);}
 await page.evaluate(()=>document.querySelector('.sidebar [data-panel="postpartum"]').click());
 await page.screenshot({path:'/tmp/dai-recovery-desktop.png',fullPage:true});
 await page.locator('[data-lw-lane="baby"]').click();assert.equal(await page.locator('#lwBabyLane [data-lw-open-baby]').count(),2);assert.ok(await page.locator('#lwBabyLane').isVisible());await page.locator('[data-lw-lane="mother"]').click();assert.ok(await page.locator('#lwMotherLane').isVisible());assert.match(await page.locator('.lw-recovery-visits').innerText(),/SYNTHETIC postnatal follow-up/);
 // Same-key updates must still refresh the actual day marker.
 await page.evaluate(()=>LittleWorld.recoveryUpdate({...recoveryFixture,post:{...recoveryFixture.post,days_postpartum:130}}));assert.match(await page.locator('.rx-summary').innerText(),/130/);
 for(const [width,height] of [[1440,850],[1024,700],[390,844]]){await page.setViewportSize({width,height});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow '+width);if(width>950){assert.ok(await page.locator('.sidebar__nav').evaluate(el=>getComputedStyle(el).overflowY==='auto'&&el.clientHeight>100));await page.locator('.sidebar [data-panel="facilities"]').scrollIntoViewIfNeeded();assert.ok(await page.locator('.sidebar [data-panel="facilities"]').isVisible());}await page.locator('#patientFindCare').click();assert.ok(await page.locator('#panel-facilities').evaluate(el=>el.classList.contains('is-active')));}
 await page.evaluate(()=>{document.querySelector('.sidebar [data-panel="postpartum"]').click();scrollTo(0,0);});await page.screenshot({path:'/tmp/dai-recovery-mobile.png',fullPage:true});
 await page.evaluate(()=>{LittleWorld.recoveryUpdate({...recoveryFixture,children:[],post:{...recoveryFixture.post,days_postpartum:null,schedule:[]}});});assert.match(await page.locator('.rx-summary').innerText(),/Not recorded/);
 assert.deepEqual(tourErrors,[]);assert.deepEqual(writes,[]);console.log('PASS: actual patient dashboard, permanent Find care, all four Home shortcuts, sidebar scroll at short desktop height, postpartum day >42 and same-key update, real follow-up title, mother/baby lanes, empty/missing day state, desktop/tablet/mobile bounds and zero page errors/API writes.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
