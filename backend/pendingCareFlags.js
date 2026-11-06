'use strict';
function flags(env=process.env){return {pendingCarePlanner:env.PENDING_CARE_PLANNER==='true',pendingCareAssistant:env.PENDING_CARE_ASSISTANT==='true',pendingCareReceipts:env.PENDING_CARE_RECEIPTS==='true',pendingCareLive:env.PENDING_CARE_LIVE==='true'};}
module.exports={flags};
