'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../shared/pregnancy-mirror');
test('recorded week is unavailable after delivery, when missing, or outside the illustrative range',()=>{
 for(const stage of [null,{week:null},{week:8},{week:41},{week:28,delivered:true}])assert.equal(M.recordedWeek(stage),null);
 assert.equal(M.recordedWeek({week:28,delivered:false}),28);
});
test('a valid recorded due date supplies a week without inventing missing or invalid dates',()=>{
 assert.equal(M.weekFromDueDate('2027-02-14','2026-11-22'),28);
 for(const due of [null,'','2026-02-30','tomorrow','2029-01-01'])assert.equal(M.weekFromDueDate(due,'2026-11-22'),null);
 assert.equal(M.weekFromDueDate('2027-02-14','invalid'),null);
 assert.deepEqual([12,20,28,36].map(M.trimester),[1,2,3,3]);
});
test('cover crop and mirror projection stay aligned in portrait and landscape',()=>{
 const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
 points[11]={x:.3,y:.2,visibility:1};points[12]={x:.5,y:.2,visibility:1};points[23]={x:.3,y:.7,visibility:1};points[24]={x:.5,y:.7,visibility:1};
 for(const [vw,vh,w,h]of [[640,480,400,500],[480,640,390,400]]){const a=M.anchor(points,vw,vh,w,h),fit=M.fit(vw,vh,w,h);assert.ok(a);assert.ok(Math.abs(a.x-(w-(.4*vw*fit.scale+fit.x)))<.001);assert.ok(Math.abs(a.y-(.575*vh*fit.scale+fit.y))<.001);assert.equal(a.angle,0);}
});
test('low confidence and missing landmarks cannot reposition the overlay',()=>{
 assert.equal(M.anchor(null,640,480,400,500),null);const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:.2}));assert.equal(M.anchor(p,640,480,400,500),null);
});
test('off-screen inferred hips and a face-only crop never qualify as a torso anchor',()=>{
 const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));p[11]={x:.3,y:.15,visibility:1};p[12]={x:.7,y:.15,visibility:1};p[23]={x:.35,y:1.2,visibility:1};p[24]={x:.65,y:1.2,visibility:1};assert.equal(M.anchor(p,640,480,640,480),null);
 p[23].y=p[24].y=.2;assert.equal(M.anchor(p,640,480,640,480),null);
});
test('all mirror narration variants are exact members of the public speech catalogue',()=>{
 for(const language of ['en','hi']){const approved=M.narrations(language);assert.equal(approved.length,19);for(const layer of Object.keys(M.descriptions))for(const twins of [true,false])for(const revealDepth of [0,1,2,3,4,5])assert.ok(approved.includes(M.narration({layer,twins,revealDepth},language)));assert.ok(!approved.includes(M.descriptions.all[language==='hi'?1:0]+' private data'));}
});
test('only bounded illustration commands are available in English and Hindi',()=>{
 assert.deepEqual(M.command('Dhruv show me the placenta'),{layer:'placenta'});assert.deepEqual(M.command('गर्भाशय दिखाओ'),{layer:'uterus'});assert.deepEqual(M.command('week 32'),{week:32});assert.deepEqual(M.command('my recorded week'),{recorded:true});assert.equal(M.command('week 50'),null);assert.equal(M.command('diagnose my baby'),null);assert.deepEqual(M.command('show twins'),{twins:true});
});
test('watermark and explanations distinguish illustration from patient assessment',()=>{
 assert.equal(M.WATERMARK,'Educational illustration—not your scan');assert.match(M.descriptions.baby[0],/does not measure/);assert.match(M.descriptions.placenta[0],/not your recorded/);assert.match(M.descriptions.cord[0],/cannot assess/);assert.equal(Object.keys(M.descriptions).length,7);
});
function hand(folded=false){const points=Array.from({length:21},()=>({x:.5,y:.8,z:0}));points[0]={x:.5,y:.95,z:0};for(const [n,mcp]of [5,9,13,17].entries()){const x=.35+n*.1;points[mcp]={x,y:.7,z:0};points[mcp+1]={x,y:.5,z:0};points[mcp+2]={x,y:folded?.65:.3,z:0};points[mcp+3]={x,y:folded?.78:.1,z:0};}return points;}
test('hand controls distinguish a steady open palm, fist, ambiguous and missing hands',()=>{
 assert.equal(M.handGesture(hand()),'palm');assert.equal(M.handGesture(hand(true)),'fist');assert.equal(M.handGesture(null),null);assert.equal(M.handGesture([]),null);
 const ambiguous=hand();ambiguous[8]=hand(true)[8];assert.equal(M.handGesture(ambiguous),null);
 const rotated=hand().map(p=>({x:1-p.y,y:p.x,z:0}));assert.equal(M.handGesture(rotated),'palm');
 const invalid=hand();invalid[7].x=NaN;assert.equal(M.handGesture(invalid),null);
});
test('holding one palm never strips multiple layers; lowering it rearms the next peel',()=>{
 const gate=M.createGestureGate(),actions=[];
 for(let time=0;time<=2400;time+=200){const action=gate.update('palm',time);if(action)actions.push(action);}
 assert.deepEqual(actions,['palm']);
 for(let time=2600;time<=3200;time+=200)gate.update(null,time);
 for(let time=3400;time<=4200;time+=200){const action=gate.update('palm',time);if(action)actions.push(action);}
 assert.deepEqual(actions,['palm','palm']);
 let restored=null;for(let time=4400;time<=5600;time+=200)restored=gate.update('fist',time)||restored;assert.equal(restored,'fist');
});
test('short gestures and stalled inference cannot activate a peel',()=>{
 const gate=M.createGestureGate();assert.equal(gate.update('palm',0),null);assert.equal(gate.update('palm',400),null);assert.equal(gate.update('palm',10000),null);assert.equal(gate.update(null,10200),null);gate.reset();assert.equal(gate.update('palm',20000),null);
});
test('peeling hides the five learning layers in order, and never the baby',()=>{
 for(let depth=0;depth<=5;depth++)assert.deepEqual(M.peeledLayers(depth),M.PEEL_ORDER.slice(0,depth));assert.deepEqual(M.peeledLayers(99),M.PEEL_ORDER);assert.ok(!M.peeledLayers(5).includes('baby'));
});

test('explanations cover new anatomy and preserve the cutaway context',()=>{
 assert.deepEqual(M.command('Dhruv explain the amniotic sac'),{layer:'sac',explain:true});
 assert.deepEqual(M.command('what does amniotic fluid do'),{layer:'fluid',explain:true});
 assert.deepEqual(M.command('explain this part'),{explain:true});
 assert.deepEqual(M.command('यह थैली समझाओ'),{layer:'sac',explain:true});
 assert.equal(M.currentPart({revealDepth:1}),'sac');assert.equal(M.currentPart({revealDepth:5}),'baby');
 assert.equal(M.currentPart({layer:'placenta',revealDepth:0}),'placenta');
 for(const language of ['en','hi'])for(const explainLayer of Object.keys(M.descriptions))for(const revealDepth of [0,1,2,3,4,5])assert.ok(M.narrations(language).includes(M.narration({explainLayer,revealDepth},language)));
 assert.match(M.narration({explainLayer:'fluid',revealDepth:2},'en'),/cushions movement/);
 assert.equal(M.command('explain whether my baby is healthy'),null);
});
