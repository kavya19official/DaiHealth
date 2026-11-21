/* Patient choices are discussion preferences, never procedure consent or orders. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.DaiBirthExperienceModel=m;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const prompts={
 movement_positions:['Would you like to move during labour?','Walking or changing positions, when appropriate.','labour','move'],
 birth_environment:['Would you like a calm birth space?','Record lighting, sound and visitor preferences.','labour','home'],
 comfort_methods:['Would you like to try comfort methods?','Tell your team what helps you feel comfortable.','labour','heart'],
 medical_pain_relief:['Would you like to discuss pain relief?','Your clinician explains suitable, available options.','labour','care'],
 pain_relief_offers:['Would you like pain-relief options offered?','You can change your preferences with your care team.','labour','care'],
 pushing_preferences:['Would you like to discuss birth positions?','Record the support you would like to discuss.','birth','heart'],
 birth_mirror_touch:['Would you like a mirror offered?','Only if appropriate and you would find it helpful.','birth','baby'],
 cord_preferences:['Would you like to discuss cord preferences?','Ask your team about timing and who cuts the cord.','birth','baby'],
 caesarean_preferences:['Would you like to plan for a C-section possibility?','Preferences if needed; this choice is not consent or refusal.','birth','care'],
 skin_to_skin:['Would you like skin-to-skin contact?','Discuss what is appropriate for you and your baby.','hour','baby'],
 feeding_preferences:['Would you like feeding support?','Record the support and feeding options you want to discuss.','hour','baby'],
 newborn_care:['Would you like to discuss newborn care?','Questions for your team; no procedure is agreed by this choice.','hour','baby'],
 recovery_preferences:['Would you like help planning recovery?','Record support and recovery questions for your team.','hour','heart']
};
const stages=[{id:'home',title:'At home',caption:'People, priorities & getting ready'},{id:'arrival',title:'Arrival',caption:'Your welcome & communication'},{id:'labour',title:'Labour',caption:'Comfort, movement & support'},{id:'birth',title:'Birth',caption:'Preferences if circumstances change'},{id:'hour',title:'First hour',caption:'Contact, feeding & newborn care'}];
function stageFor(key,section){return prompts[key]?.[2]||(['patient_name','due_date','clinician','facility','facility_address','facility_phone','transport','backup_transport','companion','companion_phone','companion_role','top_priorities','flexible_preferences','preferences'].includes(key)?'home':section==='basics'||section==='people'?'arrival':section==='after'?'hour':section==='labour'||section==='pain'?'labour':section==='delivery'?'birth':'arrival');}
function parse(value){const m=String(value||'').match(/^\[Preference: (Yes|Maybe|Not for me)\](?:\n|$)/);return {choice:m?.[1]||'',note:m?String(value).slice(m[0].length):String(value||'')};}
function encode(choice,note,max){if(!['','Yes','Maybe','Not for me'].includes(choice))return null;const value=(choice?'[Preference: '+choice+']\n':'')+note;return value.length<=max?value:null;}
function display(value){const p=parse(value);return (p.choice?p.choice+(p.note?' · ':''):'')+p.note;}
function priorities(value){return String(value||'').split(/\n+/).map(s=>s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/,'').trim()).filter(Boolean);}
return {prompts,stages,stageFor,parse,encode,display,priorities};
});
