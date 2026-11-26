'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {origin,configuration,build}=require('../scripts/build-vercel.cjs');
test('deployment requires a clean HTTPS backend origin and proxies protected paths before static lookup',()=>{
 for(const value of [undefined,'http://example.com','https://user:pass@example.com','https://example.com/api','https://example.com/?key=secret'])assert.throws(()=>origin(value));
 assert.equal(origin('https://example.onrender.com/'),'https://example.onrender.com');
 const config=configuration('https://example.onrender.com');assert.equal(config.version,3);
 for(const url of ['/api/auth/login','/api/patient/ultrasound','/hospital-admin/api/auth/login','/hospital-admin/_next/static/a.js']){
  const route=config.routes.find(r=>r.src&&new RegExp('^'+r.src+'$').test(url));assert.ok(route?.dest.startsWith('https://example.onrender.com'));assert.equal(route.headers['Cache-Control'],'private, no-store');
 }
});
test('Vercel package contains shared browser modules, excludes private files, and rebuilds cleanly',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dai-vercel-'));
 try{
  fs.mkdirSync(path.join(root,'frontend/js'),{recursive:true});fs.mkdirSync(path.join(root,'shared'));fs.mkdirSync(path.join(root,'backend'));
  fs.writeFileSync(path.join(root,'frontend/index.html'),'demo');fs.writeFileSync(path.join(root,'frontend/.env'),'PRIVATE');fs.writeFileSync(path.join(root,'backend/.env'),'PRIVATE');fs.writeFileSync(path.join(root,'shared/clinical-ledger.js'),'public');
  const result=build({root,backend:'https://example.onrender.com'});assert.ok(fs.existsSync(path.join(result.statics,'shared/clinical-ledger.js')));assert.equal(fs.existsSync(path.join(result.statics,'.env')),false);assert.equal(fs.existsSync(path.join(result.statics,'backend')),false);
  fs.writeFileSync(path.join(result.statics,'obsolete.txt'),'old');build({root,backend:'https://example.onrender.com'});assert.equal(fs.existsSync(path.join(result.statics,'obsolete.txt')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('deployed patient/doctor API uses same-origin cookies rather than a hard-coded external host',()=>{
 const window={},document={};const location={hostname:'dai-demo.vercel.app',port:'',protocol:'https:'};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/dai-api.js'),'utf8'),{window,document,location,console,URLSearchParams,fetch(){}});
 assert.equal(window.DaiAPI.API_BASE,'/api');
});
