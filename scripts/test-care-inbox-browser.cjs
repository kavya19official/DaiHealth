'use strict';
const {chromium}=require('playwright-core'),express=require('../backend/node_modules/express'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{let server,browser;try{
 const app=express();app.use(express.static(path.join(__dirname,'../frontend')));app.use('/shared',express.static(path.join(__dirname,'../shared')));
 app.get('/inbox-test',(req,res)=>res.send('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/demo-care-messages.css"><style>body{margin:0;padding:16px;font-family:Arial;background:#faf7ff}.panel{max-width:1300px;margin:auto}</style><div class="panel is-active"><div id="docMessages"></div></div><script src="/js/demo-care-messages.js"></script>'));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const width of [1440,820,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let revoked=false,posts=0;
  const history={1:[{id:'3',body:'Please review my report <script>unsafe</script>',mine:false,created_at:'2026-11-23T04:00:00Z'},{id:'4',body:'Please bring your previous reports to your appointment.',mine:true,created_at:'2026-11-23T04:05:00Z'}],2:[{id:'5',body:'Can we confirm tomorrow’s appointment?',mine:false,created_at:'2026-11-23T05:00:00Z'}],3:[]};
  const contacts=[{id:2,name:'SYNTHETIC Meera Joshi',unread:1,last_message:history[2][0]},{id:1,name:'SYNTHETIC Nivara Sethi',unread:2,last_message:history[1][1]},{id:3,name:'SYNTHETIC Asha Nair',unread:0,last_message:null}];
  await page.route('**/api/**',async r=>{const u=new URL(r.request().url()),b=r.request().postDataJSON();let json={user:{role:'doctor',full_name:'Synthetic Doctor'},patients:[],appointments:[],documents:[],queue:[],summary:{},requests:[],reviews:[],notifications:[],actions:[],items:[]};if(u.pathname.endsWith('/contacts'))json={contacts:revoked?contacts.filter(c=>c.id!==1):contacts,role:'doctor'};else if(u.pathname.endsWith('/read')){const c=contacts.find(c=>c.id===b.peer_id);if(c)c.unread=0;json={read:true};}else if(u.pathname.endsWith('/thread')){if(r.request().method()==='POST'){posts++;history[b.peer_id].push({id:String(6+posts),body:b.text,mine:true,created_at:new Date().toISOString()});json={saved:true};}else json={messages:u.searchParams.has('before')?[{id:'1',body:'An older message',mine:false,created_at:'2026-11-20T04:00:00Z'}]:history[u.searchParams.get('peer_id')],next_before:u.searchParams.has('before')?null:'3'};}await r.fulfill({json});});
  await page.goto('http://127.0.0.1:'+server.address().port+'/inbox-test');await page.locator('[data-cm-peer="1"]').waitFor();
  assert.equal(await page.locator('[data-cm-peer]').count(),3);
  await page.locator('[data-cm-new]').click();await page.locator('#cmNewChat').waitFor();
  await page.getByRole('searchbox',{name:'Find a contact'}).fill('asha');assert.equal(await page.locator('[data-cm-start]').count(),1);
  await page.screenshot({path:'/private/tmp/dai-new-chat-'+width+'.png'});
  await page.locator('[data-cm-start="3"]').click();await page.locator('#cmNewChat').waitFor({state:'detached'});assert.equal(await page.locator('#cmNewChat').count(),0);assert.equal(await page.locator('textarea').inputValue(),'');assert.ok(await page.locator('textarea').isVisible());
  if(width<761)await page.locator('[data-cm-back]').click();

  await page.locator('[data-cm-filter="unread"]').click();assert.equal(await page.locator('[data-cm-peer]').count(),2);await page.locator('[data-cm-filter="all"]').click();
  await page.locator('[data-cm-search]').fill('nivara');assert.equal(await page.locator('[data-cm-peer]').count(),1);await page.locator('[data-cm-search]').fill('');
  await page.locator('[data-cm-peer="1"]').click();await page.locator('.cm-message').first().waitFor();assert.equal(await page.locator('.cm-message script').count(),0);assert.ok((await page.locator('[data-cm-thread]').innerText()).includes('<script>unsafe</script>'));
  await page.locator('[data-cm-older]').click();await page.getByText('An older message',{exact:true}).waitFor();
  await page.locator('textarea').fill('Draft for Nivara');
  if(width<761)await page.locator('[data-cm-back]').click();
  await page.locator('[data-cm-peer="2"]').click();assert.equal(await page.locator('textarea').inputValue(),'');
  if(width<761)await page.locator('[data-cm-back]').click();
  await page.locator('[data-cm-peer="1"]').click();assert.equal(await page.locator('textarea').inputValue(),'Draft for Nivara');
  await page.locator('textarea').fill('Your appointment is confirmed.');await page.locator('textarea').press('Enter');await page.getByText('Your appointment is confirmed.',{exact:true}).waitFor();assert.equal(posts,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/private/tmp/dai-messages-'+width+'.png',fullPage:true});
  revoked=true;await page.evaluate(()=>DaiDemoMessages.refresh());assert.equal(await page.locator('.cm-message').count(),0);assert.equal(await page.locator('[data-cm-peer="1"]').count(),0);assert.ok(await page.locator('form').isHidden());
  assert.deepEqual(errors,[]);console.log('PASS',width,'inbox, unread/search, history, escaped text, per-patient drafts, send, revoked access, responsive layout');await page.close();
 }
 // Exercise the real doctor page including its asynchronous legacy boot.
 const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.addInitScript(()=>{localStorage.setItem('dai_guest','1');localStorage.setItem('dai_guest_role','doctor');});
 await p.route('**/api/**',r=>r.fulfill({json:r.request().url().endsWith('/contacts')?{contacts:[{id:1,name:'Synthetic Nivara',unread:0}],role:'doctor'}:{user:{role:'doctor',full_name:'Synthetic Doctor'},patients:[],appointments:[],documents:[],queue:[],summary:{},requests:[],reviews:[],notifications:[],actions:[],items:[]}}));
 await p.goto('http://127.0.0.1:'+server.address().port+'/doctor.html#messages');await p.locator('#demoCareMessages').waitFor();await p.waitForTimeout(700);assert.ok(await p.locator('#demoCareMessages').isVisible());assert.equal(await p.locator('#demoCareMessages').count(),1);await p.screenshot({path:'/private/tmp/dai-messages-doctor.png',fullPage:true});console.log('PASS actual doctor page retains inbox after async boot');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
