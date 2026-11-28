(function(){'use strict';
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),doctor=location.pathname.includes('doctor.html'),api=(p,o)=>window.DaiAPI.apiRequest(p,o);
const panel=document.getElementById('panel-appointments');if(!panel)return;const root=document.createElement('section');root.className='connected-care-card';root.id='remoteFollowups';root.innerHTML='<h2>Remote follow-ups</h2><span class="connected-care-tag">Prototype calls · real-device/network validation pending</span><p>Use an existing confirmed appointment. No recording; the patient controls audio/video consent.</p><button type="button" class="btn btn--ghost" data-remote-refresh>Load follow-ups</button><div data-remote-list></div>';if(document.body.classList.contains('doctor-workspace')&&document.getElementById('doctor-view-appointments')){const more=document.createElement('details');more.className='doctor-appointment-extra';const summary=document.createElement('summary');summary.textContent='Remote follow-ups';more.append(summary);root.querySelector('h2')?.remove();more.append(root);document.getElementById('doctor-view-appointments').append(more);}else panel.append(root);
let callPath='/remote-visits',dialog=null,peer=null,stream=null,poll=null,cursor=0,appointment=null,callBusy=false,pendingCandidates=[],outgoingCandidates=[],signalReady=false,callGeneration=0,openSequence=0;
let cameraSender=null,cameraBusy=false,pollBusy=false,disconnectTimer=null,remoteStream=null,callRole=doctor?'doctor':'mother';
async function load(){const r=await api('/remote-visits');if(!r)return;root.querySelector('[data-remote-list]').innerHTML=r.visits.map(a=>'<article class="connected-care-row"><div><strong>'+E(a.visit_date)+' '+E(a.requested_time||'')+'</strong><small>'+E(a.reason||'Follow-up')+' · '+E(a.status)+'</small></div><button class="btn btn--ghost" data-remote-id="'+a.id+'">Open follow-up</button></article>').join('')||'<p>No appointments recorded. Arrange a visit through the existing booking flow.</p>';}
root.querySelector('[data-remote-refresh]').onclick=load;root.addEventListener('click',e=>{const b=e.target.closest('[data-remote-id]');if(b)open(Number(b.dataset.remoteId));});
async function open(id,network=false,instant=null){const ticket=++openSequence;const path=instant?'/instant-consultations':network?'/daicare/visits':'/remote-visits';const r=instant?{visit:instant,notice:'Both participants need to join and allow microphone access. You can preview your camera before joining. Both participants must join and allow microphone access.'}:await api(path+'/'+id);if(!r||ticket!==openSequence)return;if(dialog){hangup();dialog.close();}callPath=path;appointment=id;const a=r.visit;dialog=document.createElement('dialog');dialog.className='connected-care-dialog';dialog.setAttribute('aria-label','Remote follow-up');dialog.innerHTML='<header><h2>'+(instant?'Doctor Connect call':network?'DaiCare consultation':'Remote follow-up #'+id)+'</h2><button type="button" class="btn btn--ghost" data-close aria-label="Close remote follow-up">×</button></header><p>'+E(r.notice)+'</p>'+(!doctor?'<button type="button" class="btn btn--ghost" data-remote-sos>SOS · urgent help</button>':'')+'<span class="connected-care-tag">'+E(a.status)+'</span>'+(!doctor&&!network&&!instant?'<form data-consent><label>Call mode<select name="mode"><option value="audio">Audio</option><option value="video" '+(a.mode==='video'?'selected':'')+'>Video</option></select></label><label><input type="checkbox" name="consent" '+(a.consent_at&&!a.revoked_at?'checked':'')+'>I agree to this remote consultation. I can withdraw and arrange in-person care.</label><button class="btn btn--primary">Save consent choice</button></form>':'<p>Patient consent: '+(instant||a.consent_at&&!a.revoked_at?'Recorded':'Not active')+'</p>')+'<div class="connected-call-media"><video data-local muted autoplay playsinline aria-label="Your camera preview" '+(instant?'hidden':'')+'></video><video data-remote autoplay playsinline controls aria-label="Remote participant audio or video"></video></div><div class="connected-care-actions"><button class="btn btn--primary" data-join>'+(instant?'Join audio call':'Join scheduled call')+'</button><button class="btn btn--ghost" data-mute>Mute / unmute</button>'+(instant?'<button type="button" class="btn btn--ghost" data-camera aria-pressed="false">Turn on camera</button>':'')+'<button type="button" class="btn btn--ghost" data-play hidden>Play remote audio</button><button class="btn btn--ghost" data-end>End call</button></div><p role="status" aria-live="polite" data-call-status>Not connected</p>'+(instant?'':network?(!doctor?'<button type="button" class="btn btn--ghost" data-withdraw-daicare>Cancel visit and withdraw consent</button>':''):doctor?'<form data-notes><label>Clinician visit note<textarea name="notes" maxlength="6000" rows="6">'+E(a.notes||'')+'</textarea></label><label>Clinician-issued prescription<select name="prescription"><option value="">No prescription attached</option></select></label><label>Original prescription PDF<input type="file" data-prescription-file accept="application/pdf"></label><button type="button" class="btn btn--ghost" data-upload-prescription>Upload issued prescription</button><small>Uploading adds the PDF to the patient’s Reports & records immediately. DAI does not verify a digital signature.</small><p>Attach an original prescription PDF issued by you through Reports & results. DAI does not generate medicines or claim a digital signature.</p><label><input type="checkbox" name="release">Release this note and linked prescription to the patient</label><button type="submit" class="btn btn--primary">Save visit note</button></form>':'<section><h3>Released visit note</h3><p class="connected-care-pre">'+E(a.notes||'No note released by the clinician yet.')+'</p>'+(a.prescription_document_id?'<a class="btn btn--ghost" target="_blank" rel="noopener" href="'+E(window.DaiAPI.API_BASE+'/documents/'+a.prescription_document_id+'/download')+'">Download clinician prescription</a>':'')+'</section>');document.body.append(dialog);dialog.showModal();const d=dialog;
d.querySelector('[data-close]').onclick=()=>{openSequence++;d.close();};d.addEventListener('close',()=>{if(dialog===d){hangup();dialog=null;}d.remove();});d.addEventListener('cancel',()=>hangup());
d.querySelector('[data-remote-sos]')?.addEventListener('click',()=>{d.close();window.CareExt?.openSOS();});const consent=d.querySelector('[data-consent]');if(consent)consent.onsubmit=async e=>{e.preventDefault();const ok=await api('/remote-visits/'+id+'/consent',{method:'PUT',body:{mode:consent.elements.mode.value,consent:consent.elements.consent.checked}});if(ok){hangup();status(consent.elements.consent.checked?'Consent choice saved. Rejoin using this mode.':'Consent withdrawn. Call ended.');}};
d.querySelector('[data-join]').onclick=join;d.querySelector('[data-play]').onclick=()=>playRemote();d.querySelector('[data-camera]')?.addEventListener('click',toggleCamera);d.querySelector('[data-end]').onclick=hangup;d.querySelector('[data-mute]').onclick=()=>{for(const track of stream?.getAudioTracks()||[])track.enabled=!track.enabled;status(stream?.getAudioTracks()[0]?.enabled?'Microphone on':'Microphone muted');};d.querySelector('[data-withdraw-daicare]')?.addEventListener('click',async()=>{if(!confirm('Cancel this visit and withdraw call consent?'))return;const saved=await api(path+'/'+id,{method:'PATCH',body:{action:'cancel'}});if(saved){hangup(false);status('Consent withdrawn. Call ended.');document.dispatchEvent(new Event('dai:daicare-bookings-changed'));}});const notes=d.querySelector('[data-notes]');if(notes){const refreshPrescriptions=async(selected=a.prescription_document_id)=>{const result=await api('/remote-visits/'+id+'/prescriptions');if(!result||!d.isConnected)return;notes.elements.prescription.innerHTML='<option value="">No prescription attached</option>'+result.documents.map(x=>'<option value="'+x.id+'">'+E(x.title)+'</option>').join('');if(selected)notes.elements.prescription.value=String(selected);};refreshPrescriptions();d.querySelector('[data-upload-prescription]').onclick=async e=>{const file=d.querySelector('[data-prescription-file]').files[0];if(!file||file.type!=='application/pdf'||file.size>5*1024*1024){status('Choose an issued PDF, up to 5 MB.');return;}e.target.disabled=true;try{const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const result=await api('/doctor/patients/'+a.mother_id+'/documents',{method:'POST',body:{title:'Prescription · follow-up #'+id,doc_type:'prescription',filename:file.name,mime_type:file.type,content_base64:content,appointment_id:id}});if(result){await refreshPrescriptions(result.document.id);status('Issued prescription added to the patient’s records.');}}catch{status('Could not upload the PDF. The visit note is unchanged.');}finally{e.target.disabled=false;}};}if(notes)notes.onsubmit=async e=>{e.preventDefault();if(notes.dataset.saving==='true')return;notes.dataset.saving='true';const b=notes.querySelector('[type=submit]');b.disabled=true;try{const result=await api('/remote-visits/'+id+'/notes',{method:'PUT',body:{notes:notes.elements.notes.value,release:notes.elements.release.checked,prescription_document_id:notes.elements.prescription.value?Number(notes.elements.prescription.value):null}});if(result)status(result.released?'Visit note released to the patient.':'Private draft note saved.');}finally{b.disabled=false;delete notes.dataset.saving;}};}
function status(text){const h=dialog?.querySelector('[data-call-status]');if(h)h.textContent=text;}
async function signal(type,payload){
 const result=await api(callPath+'/'+appointment+'/signals',{method:'POST',body:{type,payload}});
 if(!result)throw Error('Call signalling failed. Check the connection and join again.');
 return result;
}
function mediaError(error,kind='Microphone'){
 if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError')return kind+' permission is blocked. Use the browser site controls to allow it, then try again.';
 if(error?.name==='NotFoundError')return 'No '+kind.toLowerCase()+' was found. Connect a device and try again.';
 if(error?.name==='NotReadableError')return kind+' is being used or blocked by another app. Close that app and try again.';
 return kind+' could not start. Check device access and use HTTPS or localhost.';
}
function updateCameraControl(){
 const button=dialog?.querySelector('[data-camera]');
 const on=stream?.getVideoTracks().some(t=>t.readyState==='live')??false;
 if(button){button.disabled=cameraBusy||callBusy;button.textContent=cameraBusy?'Opening camera…':on?'Turn off camera':'Turn on camera';button.setAttribute('aria-pressed',String(on));}
 const local=dialog?.querySelector('[data-local]');if(local)local.hidden=!on;
 const joinButton=dialog?.querySelector('[data-join]');if(joinButton){joinButton.disabled=callBusy||cameraBusy||!!peer;joinButton.textContent=peer?(peer.connectionState==='connected'?'Connected':'Connecting…'):callBusy?'Opening microphone…':callPath==='/instant-consultations'?'Join audio call':'Join scheduled call';}
}
async function playRemote(){
 const video=dialog?.querySelector('[data-remote]');if(!video?.srcObject)return;
 try{await video.play();dialog?.querySelector('[data-play]')?.setAttribute('hidden','');}
 catch{const button=dialog?.querySelector('[data-play]');if(button)button.hidden=false;status('Remote media received. Tap Play remote audio to hear the call.');}
}
async function toggleCamera(){
 if(cameraBusy||callBusy||!dialog?.open)return;
 if(!navigator.mediaDevices?.getUserMedia)return status('Camera access needs HTTPS and a supported browser.');
 const generation=callGeneration,activeDialog=dialog,local=stream||(stream=new MediaStream());
 const current=()=>generation===callGeneration&&dialog===activeDialog&&dialog?.open;
 const active=local.getVideoTracks()[0];cameraBusy=true;updateCameraControl();let camera;
 try{
  if(active){if(cameraSender)await cameraSender.replaceTrack(null);active.stop();local.removeTrack(active);if(current())status(peer?'Camera off. Audio continues.':'Camera preview off.');return;}
  camera=await navigator.mediaDevices.getUserMedia({audio:false,video:true});if(!current())return;
  const track=camera.getVideoTracks()[0];if(!track)throw Error('No camera track');
  if(cameraSender)await cameraSender.replaceTrack(track);if(!current())return;
  local.addTrack(track);camera=null;const video=activeDialog.querySelector('[data-local]');video.srcObject=local;void video.play().catch(()=>{});
  track.addEventListener('ended',()=>{local.removeTrack(track);if(current()){updateCameraControl();status('Camera stopped. You can turn it on again.');}},{once:true});
  status(peer?'Camera on.':'Camera preview ready. Join the call to connect with the other participant.');
 }catch(error){if(current())status(mediaError(error,'Camera'));}
 finally{camera?.getTracks().forEach(t=>t.stop());if(generation===callGeneration){cameraBusy=false;updateCameraControl();}}
}
function reserveVideo(target){
 const transceiver=target.getTransceivers().find(t=>t.receiver.track.kind==='video'&&!t.stopped);
 if(transceiver){transceiver.direction='sendrecv';transceiver.sender.setStreams(stream);cameraSender=transceiver.sender;}
 else cameraSender=target.addTransceiver('video',{direction:'sendrecv',streams:[stream]}).sender;
}
async function offer(restart=false){
 const target=peer,generation=callGeneration;if(!target)return;
 const description=await target.createOffer(restart?{iceRestart:true}:undefined);
 if(generation!==callGeneration||peer!==target)return;
 await target.setLocalDescription(description);await signal('offer',target.localDescription);
 if(generation!==callGeneration)return;signalReady=true;
 for(const c of outgoingCandidates)await signal('candidate',c);outgoingCandidates=[];
}
async function addCandidate(target,candidate){
 // Late ICE from an earlier negotiation must not tear down the current call.
 const fragment=candidate?.usernameFragment,sdp=target.remoteDescription?.sdp||'';
 if(fragment&&!sdp.split(/\r?\n/).includes('a=ice-ufrag:'+fragment))return;
 await target.addIceCandidate(candidate);
}
async function processSignals(messages=[]){
 const target=peer,generation=callGeneration;
 for(const m of messages){
  if(generation!==callGeneration||peer!==target)return;cursor=Math.max(cursor,m.seq);if(!target)return;
  if(m.type==='hangup'){hangup(false);status('The other participant ended the call. Join again when both are ready.');return;}
  if(m.type==='ready'&&callRole==='doctor'&&target.signalingState==='stable'){await offer(true);}
  else if(m.type==='offer'&&callRole==='mother'){
   await target.setRemoteDescription(m.payload);if(generation!==callGeneration)return;
   if(callPath==='/instant-consultations')reserveVideo(target);
   for(const c of pendingCandidates)await addCandidate(target,c);pendingCandidates=[];
   await target.setLocalDescription(await target.createAnswer());await signal('answer',target.localDescription);
   if(generation!==callGeneration)return;signalReady=true;
   for(const c of outgoingCandidates)await signal('candidate',c);outgoingCandidates=[];updateCameraControl();
  }else if(m.type==='answer'&&callRole==='doctor'&&target.signalingState==='have-local-offer'){
   await target.setRemoteDescription(m.payload);for(const c of pendingCandidates)await addCandidate(target,c);pendingCandidates=[];
  }else if(m.type==='candidate'){if(target.remoteDescription)await addCandidate(target,m.payload);else pendingCandidates.push(m.payload);}
 }
}
async function join(){
 if(peer||callBusy||cameraBusy)return;
 if(!window.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia)return status('Calls need HTTPS and microphone access in a supported browser.');
 callBusy=true;updateCameraControl();const generation=++callGeneration,activeDialog=dialog,targetAppointment=appointment;let stage='configuration',everConnected=false;
 try{
  const cfg=await api(callPath+'/'+targetAppointment+'/signals?after=0');if(generation!==callGeneration||dialog!==activeDialog)return;
  if(!cfg)throw Error('Call unavailable. Reopen the accepted consultation and join again.');
  callRole=cfg.role||callRole;stage='microphone';status('Allow microphone access to join.');
  const acquired=await navigator.mediaDevices.getUserMedia({audio:true,video:cfg.mode==='video'&&!stream?.getVideoTracks().length});
  if(generation!==callGeneration||dialog!==activeDialog||!activeDialog.isConnected){acquired.getTracks().forEach(t=>t.stop());return;}
  if(stream){for(const track of acquired.getTracks())stream.addTrack(track);}else stream=acquired;
  stage='connection';status('Microphone ready. Waiting for the other participant to join…');
  const target=peer=new RTCPeerConnection({iceServers:cfg.ice_servers});
  cursor=cfg.cursor||0;pendingCandidates=[];outgoingCandidates=[];signalReady=false;remoteStream=new MediaStream();
  activeDialog.querySelector('[data-local]').srcObject=stream;
  for(const track of stream.getTracks())target.addTrack(track,stream);
  target.ontrack=e=>{if(generation!==callGeneration)return;for(const t of e.streams?.[0]?.getTracks()||[e.track])if(!remoteStream.getTracks().some(existing=>existing.id===t.id))remoteStream.addTrack(t);activeDialog.querySelector('[data-remote]').srcObject=remoteStream;void playRemote();};
  target.onicecandidate=e=>{if(generation!==callGeneration||!e.candidate)return;const candidate=e.candidate.toJSON();if(signalReady)void signal('candidate',candidate).catch(()=>{if(generation===callGeneration)status('Network interrupted while connecting. If it does not recover, end and rejoin.');});else outgoingCandidates.push(candidate);};
  target.onconnectionstatechange=()=>{
   if(generation!==callGeneration)return;const state=target.connectionState;updateCameraControl();
   if(state==='connected'){everConnected=true;clearTimeout(disconnectTimer);disconnectTimer=null;status('Call connected. You can turn your camera on or off.');void playRemote();if(callPath==='/instant-consultations')void api(callPath+'/'+targetAppointment+'/connected',{method:'POST'});}
   else if(state==='disconnected'){status('Connection interrupted. Trying to recover…');if(!disconnectTimer)disconnectTimer=setTimeout(()=>{if(generation===callGeneration&&target.connectionState!=='connected'){hangup(false);status('Connection lost. Join again on both devices.');}},15000);}
   else if(state==='failed'){hangup(false);status(cfg.relay_configured?'Connection failed. Check the network and rejoin.':'Could not connect devices. This network may require a configured TURN relay; try another Wi-Fi or contact the clinic.');}
  };
  if(callRole==='doctor'){if(callPath==='/instant-consultations')reserveVideo(target);await offer();}
  else{
   const messages=cfg.signals||[],ended=Math.max(0,...messages.filter(m=>m.type==='hangup').map(m=>m.seq));
   const available=messages.filter(m=>m.seq>ended);const latestOffer=available.filter(m=>m.type==='offer').at(-1);
   await processSignals(latestOffer?available.filter(m=>m.seq>=latestOffer.seq):[]);
   if(peer)await signal('ready',null);
  }
  if(!peer)return;const deadline=Date.now()+75000;
  poll=setInterval(async()=>{
   if(pollBusy||!peer||generation!==callGeneration)return;
   if(!everConnected&&Date.now()>deadline){hangup();status(cfg.relay_configured?'Call could not connect. Both participants should rejoin.':'Call could not connect. Check that both participants joined; a TURN relay may be needed on this network.');return;}
   pollBusy=true;
   try{const r=await api(callPath+'/'+targetAppointment+'/signals?after='+cursor);if(generation!==callGeneration)return;if(!r){hangup(false);status('Call access ended or the server is unavailable. Reopen the consultation.');return;}await processSignals(r.signals);}
   catch{if(generation===callGeneration){hangup(false);status('Could not exchange call information. Rejoin on both devices.');}}
   finally{if(generation===callGeneration){pollBusy=false;updateCameraControl();}}
  },1500);
 }catch(error){if(generation===callGeneration){hangup(false);status(stage==='microphone'?mediaError(error,'Microphone'):error.message||'Could not join. Try again.');}}
 finally{if(generation===callGeneration){callBusy=false;updateCameraControl();}}
}
function hangup(send=true){
 callGeneration++;clearInterval(poll);poll=null;clearTimeout(disconnectTimer);disconnectTimer=null;
 if(send&&peer)void signal('hangup',null).catch(()=>{});
 const closing=peer;peer=null;if(closing){closing.onicecandidate=null;closing.ontrack=null;closing.onconnectionstatechange=null;closing.close();}
 stream?.getTracks().forEach(t=>t.stop());stream=null;remoteStream=null;cameraSender=null;cameraBusy=false;callBusy=false;pollBusy=false;
 for(const selector of ['[data-local]','[data-remote]']){const video=dialog?.querySelector(selector);if(video){video.pause();video.srcObject=null;}}
 pendingCandidates=[];outgoingCandidates=[];signalReady=false;updateCameraControl();status('Call ended. No recording was made.');
}
window.DaiRemoteCalls={openDaiCare:id=>open(id,true),openInstant:visit=>open(visit.id,false,visit)};
window.addEventListener('pagehide',()=>hangup(false));window.addEventListener('dai:patient-panel',e=>{if(e.detail.panel==='appointments')load();});
})();
