const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function worker(fetchImpl){const events={},store=new Map(),cache={match:async key=>store.get(key)?.clone(),put:async(key,response)=>store.set(key,response.clone())};const scope={location:{origin:'http://localhost:3001'},addEventListener:(name,fn)=>events[name]=fn};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/patient-sw.js'),'utf8'),{self:scope,caches:{open:async()=>cache},fetch:fetchImpl,URL,AbortController,setTimeout,clearTimeout});return {events,store,request(url){let result;events.fetch({request:new Request('http://localhost:3001'+url),respondWith:p=>result=p});return result;}};}
test('online dashboard and versioned scripts replace stale cached shell files',async()=>{
 const seen=[],w=worker(async(req,options)=>{seen.push([req.url,options.cache]);return new Response('current release');});w.store.set('/dashboard.html',new Response('old dashboard'));w.store.set('/js/patient-uterus-model.js',new Response('old viewer'));
 assert.equal(await(await w.request('/dashboard.html')).text(),'current release');assert.equal(await(await w.request('/js/patient-uterus-model.js?v=4')).text(),'current release');assert.equal(await w.store.get('/dashboard.html').text(),'current release');assert.ok(seen.every(([,mode])=>mode==='no-cache'));
});
test('offline shell remains available, while API and uploaded records bypass caching',async()=>{
 const w=worker(async()=>{throw Error('offline');});w.store.set('/dashboard.html',new Response('offline shell'));assert.equal(await(await w.request('/dashboard.html')).text(),'offline shell');assert.equal(w.request('/api/patient/dashboard'),undefined);assert.equal(w.request('/uploads/report.pdf'),undefined);
});
test('a failed shell response uses cached copy without replacing it',async()=>{
 const w=worker(async()=>new Response('unavailable',{status:503}));w.store.set('/shared/uterus-learning.js',new Response('cached public anatomy'));assert.equal(await(await w.request('/shared/uterus-learning.js?v=1')).text(),'cached public anatomy');assert.equal(await w.store.get('/shared/uterus-learning.js').text(),'cached public anatomy');
});
