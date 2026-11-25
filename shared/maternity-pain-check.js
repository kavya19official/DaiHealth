/* Descriptive symptom capture, not a validated triage score or diagnosis.
 * Sources reviewed 2026-11-25: NHS stomach pain in pregnancy; CDC Hear Her.
 * All answers are optional. No combination produces a reassurance/safe result.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MaternityPainCheck=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const fields=[
  ['location','Where do you feel pain?',[['belly','Belly / lower abdomen'],['ribs','Upper belly / under the ribs'],['back','Back / pelvis'],['chest','Chest'],['head','Head'],['leg','One leg'],['wound','C-section wound / stitches'],['other','Somewhere else'],['none','No pain; another concern']]],
  ['feeling','What does it feel like?',[['sharp','Sharp / stabbing'],['cramping','Cramping'],['tightening','Tightening / coming in waves'],['burning','Burning'],['aching','Dull ache'],['pressure','Pressure']]],
  ['severity','How strong does it feel?',[['mild','Mild'],['moderate','Moderate'],['severe','Severe / hard to cope with']]],
  ['onset','When did it start?',[['sudden','Suddenly'],['recent','Within the last hour'],['hours','Several hours ago'],['days','A day or more ago']]],
  ['pattern','Does it come and go?',[['constant','Constant / getting worse'],['waves','Regular waves / tightenings'],['intermittent','Comes and goes without a pattern']]],
  ['rest','Has it eased with rest or a change of position?',[['no','No'],['yes','Yes'],['not_tried','I have not tried / cannot rest']]]
 ];
 function summarize(input={}){
  const a={};for(const [key,,choices] of fields)if(choices.some(c=>c[0]===input[key]))a[key]=input[key];
  const codes=[];const belly=['belly','ribs'].includes(a.location);
  if(a.location==='chest')codes.push('chest_breath');
  if(belly&&a.severity==='severe')codes.push('severe_abdominal_pain');
  if(a.location==='head'&&a.severity==='severe')codes.push('severe_headache_vision');
  if(belly&&(a.pattern==='waves'||a.feeling==='tightening'))codes.push('contractions');
  if(a.location==='leg')codes.push('one_leg_pain');
  if(a.severity==='severe'&&!codes.length)codes.push('pain_needs_review');
  if(a.location&&a.location!=='none'&&(a.rest==='no'||a.pattern==='constant'||a.onset==='sudden'))codes.push('pain_needs_review');
  const description=fields.filter(f=>a[f[0]]).map(([k,title,choices])=>title+' '+choices.find(c=>c[0]===a[k])[1]).join(' | ');
  return {codes:[...new Set(codes)],description,answered:Object.keys(a).length,needsEmergency:codes.some(c=>['chest_breath','severe_abdominal_pain','severe_headache_vision'].includes(c)),needsReview:codes.length>0};
 }
 return {fields,summarize,version:'2026-11-25.1',sources:['https://www.nhs.uk/pregnancy/common-symptoms/stomach-pain/','https://www.cdc.gov/hearher/maternal-warning-signs/index.html']};
});
