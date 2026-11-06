'use strict';
const config=require('./data/care-timeline-rules.json');
if(!Array.isArray(config.milestones)||!config.milestones.length||config.milestones.some(m=>!Number.isInteger(m.days)||m.days<0||!m.title||!['pregnancy','child'].includes(m.category)))throw Error('Invalid configured timeline rules');
module.exports={version:config.version,milestones:config.milestones.map(m=>Object.freeze({...m})),explain:m=>'Expected from the recorded care-start date using '+config.version+'; '+m.days+' day offset. Clinician plans take precedence.'};
