'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..'),source=require('../frontend/locales/source.json');
const tokens=s=>(s.match(/\{\{\d+\}\}/g)||[]).sort().join('|');
const numbers=s=>(s.replace(/\{\{\d+\}\}/g,'').match(/\d+(?:[.,]\d+)*/g)||[]).flatMap(n=>/^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(n)?[n.replaceAll(',','')]:n.split(',')).sort().join('|');
test('Hindi and Marathi cover every extracted UI phrase and preserve dynamic placeholders and quantities',()=>{
 assert.ok(source.entries.length>10000);assert.equal(new Set(source.entries).size,source.entries.length);
 assert.equal(source.hash,crypto.createHash('sha256').update(JSON.stringify(source.entries)).digest('hex'));
 for(const code of ['hi','mr']){const locale=require('../frontend/locales/'+code+'.json');assert.equal(locale.sourceHash,source.hash);assert.equal(Object.keys(locale.phrases).length,source.entries.length);assert.equal(locale.hash,crypto.createHash('sha256').update(JSON.stringify(locale.phrases)).digest('hex'));
  for(const en of source.entries){const text=locale.phrases[en];assert.equal(typeof text,'string',code+': '+en);assert.ok(text.trim(),code+': '+en);assert.equal(tokens(text),tokens(en),code+' placeholders: '+en);
   // These are named stages (first/second/third), not measured patient values.
   if(!/^(?:[123](?:st|nd|rd)(?: trimester)?|Trimester [123])$/.test(en))assert.equal(numbers(text),numbers(en),code+' quantities: '+en);
  }
 }
 assert.equal(require('../frontend/locales/hi.json').phrases['Birth plan'],'प्रसव योजना');assert.equal(require('../frontend/locales/mr.json').phrases['Birth plan'],'प्रसूतीची योजना');
});
test('every static entry point and hospital layout loads the shared translator and offline catalogues',()=>{
 for(const file of ['index.html','auth.html','dashboard.html','doctor.html','child-dashboard.html','caregiver.html','hospital.html','facilities.html','about.html','timeline-share.html','care-capsule/index.html']){const s=fs.readFileSync(path.join(ROOT,'frontend',file),'utf8');assert.equal((s.match(/src="\/js\/i18n\.js/g)||[]).length,1,file);assert.match(s,/i18n\.css/);}
 const layout=fs.readFileSync(path.join(ROOT,'hospital_portal/web/app/layout.tsx'),'utf8'),sync=fs.readFileSync(path.join(ROOT,'hospital_portal/web/scripts/sync-daya.cjs'),'utf8');assert.match(layout,/daya\/js\/i18n\.js/);assert.match(sync,/'locales'/);
 for(const file of ['patient-sw.js','care-capsule/sw.js']){const s=fs.readFileSync(path.join(ROOT,'frontend',file),'utf8');for(const code of ['source','hi','mr'])assert.ok(s.includes('/locales/'+code+'.json'),file+' '+code);}
});
test('Marathi FAQs retain prepared-response routing and safety boundaries',()=>{
 const {faqs,respond}=require('../frontend/js/daya-knowledge');for(const faq of faqs){assert.match(faq.question.mr,/[\u0900-\u097f]/,faq.id);assert.match(faq.answer.mr,/[\u0900-\u097f]/,faq.id);const result=respond(faq.question.mr,'mr');assert.equal(result.id,faq.id,faq.id);}
 assert.equal(respond('मला रक्तस्राव होत आहे','mr').id,'danger');assert.equal(respond('औषधाचा डोस बदलू का','mr').id,'medicine-refusal');
});
