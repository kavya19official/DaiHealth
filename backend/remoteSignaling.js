'use strict';

const { endpoint, failure } = require('./daicareCommon');
const HOUR = 60 * 60 * 1000;

function registerSignaling(app, path, participants, room, env = process.env) {
  const rooms = new Map();
  function current(id) {
    const state = rooms.get(id);
    if (state && Date.now()-state.at>HOUR) {
      rooms.delete(id);
      return null;
    }
    return state;
  }

  app.get(path + '/:id/signals', ...participants, endpoint(async (req,res) => {
    const visit = await room(req);
    const after = Number(req.query.after) || 0;
    const iceServers = [{urls:(env.DAI_STUN_URL||'stun:stun.l.google.com:19302').split(',').map(url=>url.trim()).filter(Boolean)}];
    if (env.DAI_TURN_URL && env.DAI_TURN_USERNAME && env.DAI_TURN_PASSWORD) {
      iceServers.push({urls:env.DAI_TURN_URL.split(',').map(url=>url.trim()).filter(Boolean),username:env.DAI_TURN_USERNAME,credential:env.DAI_TURN_PASSWORD});
    }
    res.json({ signals:(current(visit.id)?.messages||[]).filter(m=>m.seq>after && m.sender!==req.user.id),
      ice_servers:iceServers,relay_configured:!!(env.DAI_TURN_URL&&env.DAI_TURN_USERNAME&&env.DAI_TURN_PASSWORD),cursor:current(visit.id)?.seq||0,role:req.user.role,mode:visit.mode });
  }));

  app.post(path + '/:id/signals', ...participants, endpoint(async (req,res) => {
    const visit = await room(req), { type,payload } = req.body || {};
    if (!['offer','answer','candidate','hangup','ready'].includes(type) || JSON.stringify(payload??null).length>40000 ||
        (type==='offer' && req.user.role!=='doctor') || (['answer','ready'].includes(type) && req.user.role!=='mother')) {
      failure(400,'Invalid call signal for this participant.');
    }
    let state = current(visit.id);
    if (!state) {
      for (const id of rooms.keys()) current(id);
      if (rooms.size>=500) failure(503,'Call rooms are at capacity.');
      state = {at:Date.now(),seq:0,messages:[]};
      rooms.set(visit.id,state);
    }
    if (type==='offer') state.messages = [];
    if (state.messages.length>=500) failure(429,'Call signal limit reached. Rejoin the call.');
    state.at=Date.now();
    state.messages.push({seq:++state.seq,sender:req.user.id,type,payload:payload??null});
    res.json({accepted:true});
  }));

  return id => rooms.delete(id);
}
module.exports = { registerSignaling };
