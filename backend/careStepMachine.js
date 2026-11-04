'use strict';
const {createMachine,createActor}=require('xstate');
// Database authorisation is checked before these pure guards are supplied.
const machine=createMachine({id:'care-step',initial:'planned',states:{
 planned:{on:{REPORT:{target:'patient_reported',guard:'owner'},EVIDENCE:{target:'evidence_submitted',guard:'evidence'}}},
 patient_reported:{on:{EVIDENCE:{target:'evidence_submitted',guard:'evidence'}}},
 evidence_submitted:{on:{QUEUE:{target:'awaiting_review',guard:'evidence'}}},
 awaiting_review:{on:{EVIDENCE:{target:'evidence_submitted',guard:'evidence'},CONFIRM:{target:'clinician_confirmed',guard:'clinician'}}},
 clinician_confirmed:{type:'final'}
}},{guards:{owner:({event})=>event.owner===true,evidence:({event})=>event.owner===true&&event.evidence===true,clinician:({event})=>event.authorised===true&&event.evidence===true}});
function stateOf(row){return row.completion_verification==='verified'?'clinician_confirmed':row.result_id?'awaiting_review':row.completed_at?'patient_reported':'planned';}
function transition(state,event){const snapshot=machine.resolveState({value:state,context:{}});const actor=createActor(machine,{snapshot}).start();actor.send(event);const next=actor.getSnapshot().value;actor.stop();if(next===state)throw Object.assign(new Error('This care step cannot make that transition.'),{status:409});return next;}
async function record(db,row,event,actorId){const from=stateOf(row),to=transition(from,event);await db.query('INSERT INTO care_step_events(mother_id,milestone_id,actor_id,from_state,to_state) VALUES($1,$2,$3,$4,$5)',[row.mother_id,row.id,actorId,from,to]);return to;}
module.exports={machine,stateOf,transition,record};
