'use strict';
// Optional browser regression: actual dashboard with explicit synthetic display fixtures; no backend writes.
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
 const context=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{localStorage.setItem('dai_guest','1');localStorage.setItem('dai-low-bandwidth','false');});await context.route('https://**/*',r=>r.abort());
 const page=await context.newPage(),tourErrors=[],writes=[];page.on('pageerror',e=>tourErrors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});
 await page.goto(base+'/dashboard.html');await page.locator('#motherHomeOverview').waitFor();
 await page.evaluate(()=>{
 const today=PatientModel.today(),shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),birth=shift(-125);
 window.motherFixture={user:{id:501,full_name:'SYNTHETIC Nivara Sharma',name:'SYNTHETIC Nivara Sharma',guest:true,pregnancy_status:'delivered'},homeLoaded:true,offline:false,post:{active:true,delivery:{date:birth},schedule:[{code:'pnc42',title:'Postnatal follow-up',window_end:shift(-70),status:'pending',why:'Recorded follow-up remains open.'}]},children:[{id:1,name:'CHILD-SYN-1',date_of_birth:birth,vaccinations:[{vaccine_code:'bcg',given_on:shift(-16)}],growth:[]},{id:2,name:'CHILD-SYN-2',date_of_birth:birth,vaccinations:[],growth:[]}],milestones:[{id:1,title:'First antenatal visit',category:'pregnancy',stage:'Trimester 1',due_date:shift(-300),status:'completed',completed_at:shift(-300)},{id:2,title:'Antenatal review',category:'pregnancy',stage:'Trimester 3',due_date:shift(-140),status:'completed',completed_at:shift(-140)}],appointments:[{id:21,requested_date:shift(3),reason:'Hospital stay: post-discharge review',doctor_name:'SYNTHETIC Clinician',hospital_name:'SYNTHETIC New Delhi Care Centre',status:'confirmed'}],overview:{metrics:[],registered_facility:{id:1,name:'SYNTHETIC New Delhi Care Centre',lat:28.5,lng:77.2},facilities:[]}};
 PatientHome.update(motherFixture,{theme:'light',text_size:'standard'});
 document.getElementById('greetName').textContent='Nivara';
 });
 await page.locator('#homeStageImage').evaluate(im=>im.decode());await page.waitForTimeout(200);
 assert.equal(await page.locator('.mr-stage').count(),4);assert.equal(await page.locator('#homeBabyTabs button').count(),2);assert.equal(await page.locator('#motherActivities .mr-activity').count(),3);
 assert.match(await page.locator('#motherCatchup').innerText(),/Postnatal follow-up/);assert.match(await page.locator('#nextStepTitle').innerText(),/Postnatal follow-up/);assert.ok((await page.locator('#homeStageImage').getAttribute('src')).includes('mother-twins'));
 await page.screenshot({path:'/tmp/dai-mother-desktop.png',fullPage:true});
 for(const [selector,panel] of [['#motherNextDetails','postpartum'],['#motherJourneyLink','timeline'],['#motherWellness [data-mr-go="children"]','children'],['#motherSupport button','companion'],['#motherActivities .mr-activity:first-child','appointments']]){
  await page.locator('.sidebar .nav-item[data-panel="dashboard"]').click();await page.locator(selector).click();assert.ok(await page.locator('#panel-'+panel).evaluate(el=>el.classList.contains('is-active')),selector);
 }
 await page.locator('.sidebar .nav-item[data-panel="dashboard"]').click();await page.locator('#homeBabyTabs button').nth(1).click();assert.equal(await page.locator('#homeBabyTabs button').nth(1).getAttribute('aria-selected'),'true');
 await page.locator('#motherMoreCare > summary').click();assert.ok(await page.locator('#homeHealthCard').isVisible());assert.ok(await page.locator('#shareJourney').isVisible());assert.ok(await page.locator('#homeOpenVaccines').isVisible());await page.locator('#motherMoreCare > summary').click();
 await page.evaluate(()=>PatientHome.update({...motherFixture,offline:true},{theme:'light',text_size:'standard'}));assert.match(await page.locator('#motherActivities').innerText(),/Connect to refresh/);
 await page.evaluate(()=>PatientHome.update(motherFixture,{theme:'dark',text_size:'standard'}));assert.equal(await page.locator('body').getAttribute('data-home-theme'),'dark');await page.screenshot({path:'/tmp/dai-mother-dark.png',fullPage:true});
 await page.evaluate(()=>{document.body.style.setProperty('--patient-scale','1.3');PatientHome.update(motherFixture,{theme:'light',text_size:'extra-large'});});
 for(const width of [390,768,1536]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(60);const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(scroll<=width+1,'Overflow '+width+': '+scroll);}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/dai-mother-mobile.png',fullPage:true});
 await page.evaluate(()=>PatientHome.update({user:{guest:true,pregnancy_status:'planning'},homeLoaded:true,children:[],post:{},milestones:[],appointments:[],overview:{}},{theme:'light',text_size:'standard'}));assert.equal(await page.locator('#motherActivities .mr-activity').count(),0);assert.ok(!(await page.locator('#homeOpenTimeline').innerText()).includes('Recorded complete'));
 await page.evaluate(()=>PatientHome.update({...motherFixture,homeLoaded:false,user:{...motherFixture.user,guest:false}},{theme:'light',text_size:'standard'}));assert.equal(await page.locator('#motherActivities .mr-activity').count(),0);assert.equal(await page.locator('#homeOpenJourney').getAttribute('aria-busy'),'true');
 assert.deepEqual(tourErrors,[]);assert.deepEqual(writes,[]);console.log('PASS: actual dashboard with synthetic view fixtures; postpartum/twins, four evidence-based phases, real navigation actions, separate child selector, expandable original tools, offline/loading/empty states, dark/large-text mode, 390/768/1536px bounds and zero API writes.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
