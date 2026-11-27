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

const {deploymentStatus}=require('./deploymentStatus');
test('deployment metadata identifies revision and disabled features without exposing private environment',()=>{
 const info=deploymentStatus({RENDER_GIT_COMMIT:'a'.repeat(40),DAI_HOSTED_DEMO:'true',DAI_SEED_NIVARA_DEMO:'true',
  ML_ENABLED:'true',PATIENT_ML_RANKING_ENABLED:'false',DAI_ULTRASOUND_ENABLED:'false',
  JWT_SECRET:'private-signing-key',DAI_DEMO_ACCESS_KEY:'private-access-key',GEMINI_API_KEY:'private-provider-key'});
 assert.equal(info.commit,'a'.repeat(40));assert.equal(info.hostedDemo,true);
 assert.equal(info.configuredFeatures.nivaraDemo,true);
 assert.equal(info.configuredFeatures.patientRanking,false);assert.equal(info.configuredFeatures.ultrasound,false);
 assert.doesNotMatch(JSON.stringify(info),/private-|JWT_SECRET|GEMINI_API_KEY|DAI_DEMO_ACCESS_KEY/);
 assert.equal(deploymentStatus({RENDER_GIT_COMMIT:'not-a-revision'}).commit,null);
 assert.equal(deploymentStatus({ML_ENABLED:'true',PATIENT_ML_RANKING_ENABLED:'true',DAI_ULTRASOUND_ENABLED:'true'}).configuredFeatures.patientRanking,true);
 assert.equal(deploymentStatus({DAI_ULTRASOUND_ENABLED:'true'}).configuredFeatures.ultrasound,true);
});
