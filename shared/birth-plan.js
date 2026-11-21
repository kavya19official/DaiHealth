/* Patient-stated birth preferences. No field is a medical order or a clinical finding. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.DaiBirthPlan=model;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const f=(key,label,max=600,hint='',type='textarea')=>({key,label,max,hint,type});
const sections=[
 {id:'basics',title:'Essential information',fields:[
  f('patient_name','Your name',160,'','text'),f('due_date','Expected due date',10,'As recorded by your care team.','date'),f('clinician','Doctor or midwife',160,'','text'),
  f('facility','Preferred facility',200,'Hospital or birth centre you have discussed.','text'),f('facility_address','Facility address',400,'','text'),f('facility_phone','Facility phone',40,'','tel'),
  f('allergies','Allergies to flag',600,'Patient-stated details for the team to check against your record.'),f('previous_births','Previous births or C-sections',600,'Details you want your care team to review.'),f('pregnancy_details','Pregnancy details to flag',600,'Recorded complications or other information to discuss; no diagnosis is inferred.'),f('blood_group','Blood group',20,'Enter only if known; your care team will verify.','text'),
  f('medicines','Current medicines',600,'Include only medicines you currently take; your care team will verify.'),f('babies_expected','Baby or multiples expected',100,'For example one baby or twins, as recorded by your care team.','text')
 ]},
 {id:'people',title:'People & practical arrangements',fields:[
  f('companion','Birth companion',160,'Partner, family member or doula.','text'),f('companion_role','Companion’s role',300,'How you would like this person to support you.'),f('companion_phone','Companion phone',40,'','tel'),
  f('transport','Transport arrangement',300),f('backup_transport','Backup transport',300),f('emergency_name','Emergency contact',160,'','text'),f('emergency_phone','Emergency phone',40,'','tel'),f('backup_contact','Backup contact',200,'Name and contact number.'),
  f('language_preferences','Language & communication',300),f('accessibility_needs','Accessibility needs',500),f('privacy_preferences','Privacy preferences',500),f('cultural_preferences','Cultural or personal needs',500)
 ]},
 {id:'labour',title:'Labour',fields:[
  f('movement_positions','Movement & labour positions',600,'For example walking, a birthing ball, tub or shower, where available and appropriate.'),
  f('birth_environment','Environment & visitors',600,'Lighting, music, quiet, privacy and who you would like present.'),
  f('fetal_monitoring','Fetal monitoring preferences',500,'Questions about continuous or intermittent monitoring to discuss with your clinician.'),
  f('food_drink','Eating & drinking',500,'Preferences subject to your care team’s advice.'),
  f('induction_augmentation','Induction or augmentation',600,'How you would like options explained and discussed.'),f('membrane_rupture','Membrane rupture',500,'Questions or preferences to discuss if this is proposed.')
 ]},
 {id:'pain',title:'Pain management',fields:[
  f('comfort_methods','Comfort methods',600,'Breathing, massage, hydrotherapy or hypnobirthing preferences.'),
  f('medical_pain_relief','Medical pain-relief options',600,'Epidural, nitrous oxide or IV pain relief to discuss, subject to clinical suitability and availability.'),
  f('pain_relief_offers','When to offer pain relief',300,'Would you prefer options to be offered proactively, or when you ask?')
 ]},
 {id:'delivery',title:'Birth preferences',fields:[
  f('procedure_consent','Explaining procedures & consent',600,'How you want options explained and consent discussed. This plan does not replace consent for a procedure.'),
  f('caesarean_preferences','If a C-section is needed',700,'Companion presence, clear drape and skin-to-skin in theatre, where appropriate and available.'),
  f('pushing_preferences','Pushing positions & support',600,'Preferred positions, guided or spontaneous pushing to discuss.'),
  f('episiotomy','Episiotomy discussion',500,'How you would like the reason, options and consent discussed.'),
  f('assisted_birth','Assisted delivery discussion',600,'Questions about forceps or vacuum if an assisted birth is proposed.'),
  f('birth_mirror_touch','Mirror or touching baby’s head',300,'Whether you would like these offered, if appropriate.'),
  f('cord_preferences','Cord preferences',500,'Who you would like to cut the cord and questions about delayed cord clamping.')
 ]},
 {id:'after',title:'Immediately after birth',fields:[
  f('skin_to_skin','Skin-to-skin contact',500,'Your preferences immediately after birth, where appropriate.'),
  f('feeding_preferences','Feeding & breastfeeding support',600,'Breastfeeding support, expressed milk or formula preferences to discuss.'),
  f('newborn_care','Newborn procedures & rooming-in',900,'Questions about vitamin K, eye ointment, vaccines, delaying the first bath and baby staying in your room. Discuss local protocols and individual needs.'),
  f('placenta_preferences','Placenta handling',500,'Your preferences, subject to clinical needs and facility policy.'),
  f('recovery_preferences','Recovery & pain relief',600,'Support, pain-relief preferences and arrangements for recovery.')
 ]},
 {id:'priorities',title:'Priorities & changing circumstances',fields:[
  f('emergency_preferences','Updates if plans change',700,'Who should receive updates and how you want explanations communicated.'),f('decision_contact','Contact if I cannot communicate',300,'Name, relationship and phone. This does not appoint a legal decision-maker.'),f('consent_arrangements','Agreed communication & consent arrangements',600,'Arrangements already discussed with your team; preferences are not legal authorisation.'),
  {...f('discussion_status','Care-team discussion',40,'Your report of the discussion, not clinician approval.','select'),options:[['','Not recorded'],['not_yet','Not discussed yet'],['discussed','I discussed this with my care team'],['review_again','Changes need another discussion']]},f('discussion_date','Discussion date',10,'Date you discussed the plan.','date'),f('discussion_with','Discussed with',160,'Name or role of the care-team member.','text'),
  f('top_priorities','Most important preferences',600,'The points you most want to discuss with your care team.'),
  f('flexible_preferences','Where I am flexible',600,'What you are comfortable adapting if circumstances change.'),
  f('preferences','Other preferences or questions',1500,'Use short “I would prefer…” bullet points. Your earlier saved notes stay here.')
 ]}
];
const fields=sections.flatMap(s=>s.fields),limits=Object.fromEntries(fields.map(f=>[f.key,f.max]));
function dateValid(value){if(!value)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;}
const discussionStatuses=['','not_yet','discussed','review_again'];
return {sections,fields,limits,dateValid,discussionStatuses};
});
