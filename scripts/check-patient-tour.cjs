'use strict';
// Optional Playwright UI regression. Uses the actual dashboard in guest mode; no patient records.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend');
(async()=>{let browser,server;try{
 server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(name.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:'Guest UI test; no backend data'}));return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.DAI_BROWSER_EXECUTABLE?{executablePath:process.env.DAI_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{localStorage.setItem('dai_guest','1');localStorage.setItem('dai-low-bandwidth','true');});await context.route('https://**/*',r=>r.abort());
 const page=await context.newPage(),tourErrors=[],writes=[];page.on('pageerror',e=>tourErrors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});
 await page.goto(base+'/dashboard.html');await page.locator('#patientTourStart').waitFor();
 await page.locator('.patient-tour-welcome button').click();const dialog=page.getByRole('dialog',{name:'Your care, in one place'});await dialog.waitFor();if(process.env.DAI_TOUR_SCREENSHOT)await page.screenshot({path:process.env.DAI_TOUR_SCREENSHOT});assert.equal(await page.locator('.patient-tour-card').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('[data-tour-next]').evaluate(el=>el===document.activeElement));await page.keyboard.press('Tab');assert.ok(await page.locator('[data-tour-close]').evaluate(el=>el===document.activeElement));
 const panels=['dashboard','timeline','gaps','facilities','appointments','records','outreach','postpartum','children','family','messages','settings'];
 for(let i=0;i<panels.length;i++){
  assert.equal(await page.locator('[data-tour-count]').textContent(),'STEP '+(i+1)+' OF 12');assert.ok(await page.locator('#panel-'+panels[i]).evaluate(el=>el.classList.contains('is-active')));
  const bounds=await page.locator('.patient-tour-card').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1441&&bounds.y+bounds.height<=1001);
  if(i===2){await page.locator('[data-tour-back]').click();assert.equal(await page.locator('[data-tour-count]').textContent(),'STEP 2 OF 12');await page.locator('[data-tour-next]').click();}
  await page.locator('[data-tour-next]').click();
 }
 assert.equal(await page.locator('.patient-tour-layer').count(),0);assert.match(await page.locator('#patientTourAnnouncement').textContent(),/complete/);
 await page.locator('#patientTourStart').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.patient-tour-layer').count(),0);assert.ok(await page.locator('#panel-settings').evaluate(el=>el.classList.contains('is-active')));assert.equal(await page.locator('#patientTourStart').evaluate(el=>el===document.activeElement),true);
 await page.setViewportSize({width:390,height:844});await page.locator('#patientTourStart').click();
 for(let i=0;i<panels.length;i++){const r=await page.locator('.patient-tour-card').boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=391&&r.y+r.height<=845,'Mobile card bounds');await page.locator('[data-tour-next]').click();}
 await page.locator('#patientTourStart').click();await page.locator('[data-tour-skip]').click();assert.equal(await page.locator('.patient-tour-layer').count(),0);
 assert.deepEqual(tourErrors,[]);assert.deepEqual(writes,[]);console.log('PASS: actual guest dashboard, all 12 routes desktop/mobile, Back, Finish, restart, Escape, Skip, focus restoration, viewport bounds and zero API writes.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
