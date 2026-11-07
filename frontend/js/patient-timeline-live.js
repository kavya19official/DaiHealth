/* Cookie-authenticated SSE. Existing 30s timeline polling is the fallback. */
(function(){'use strict';
let source=null,retry=null,ready=false;
function state(value){document.documentElement.dataset.daiTimelineConnectionState=value;document.querySelectorAll('span[data-timeline-connection]').forEach(el=>el.textContent=value==='live'?'Live updates':value==='offline'?'Saved offline':'Refresh available');window.dispatchEvent?.(new CustomEvent('dai:timeline-connection',{detail:{state:value}}));}
function close(){source?.close();source=null;clearTimeout(retry);}
function connect(){
 close();if(document.hidden||!navigator.onLine||window.DaiAPI?.lowBandwidth()){state(navigator.onLine?'paused':'offline');return;}
 if(!window.EventSource||localStorage.getItem('dai_guest')){state('paused');return;}
 source=new EventSource(DaiAPI.API_BASE+'/patient/timeline/events',{withCredentials:true});
 source.addEventListener('ready',()=>{state('live');window.PatientExperience?.refreshTimeline();ready=true;});
 source.addEventListener('timeline-changed',()=>{state('live');window.PatientExperience?.refreshTimeline();});
 source.addEventListener('session-ended',()=>{close();state('paused');});
 source.onerror=()=>{close();state('paused');retry=setTimeout(connect,10000);};
}
window.addEventListener('online',connect);window.addEventListener('offline',()=>{close();state('offline');});
window.addEventListener('pagehide',close);window.addEventListener('pageshow',connect);document.addEventListener('visibilitychange',()=>document.hidden?close():connect());
// Start once the patient identity is loaded, never on the sign-in or guest screen.
window.PatientTimelineLive={start:connect};
})();
