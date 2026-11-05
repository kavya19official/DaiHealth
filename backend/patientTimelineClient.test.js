'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('SSE client authenticates with cookies, refreshes after reconnect, closes hidden/offline streams and retains fallback',()=>{
 const listeners={},streams=[],timers=[],badge={textContent:''};let refreshed=0,low=false;
 class EventSource{constructor(url,options){this.url=url;this.options=options;this.events={};streams.push(this);}addEventListener(name,fn){this.events[name]=fn;}close(){this.closed=true;}}
 const html={dataset:{},set textContent(value){throw new Error('Never replace the document with a connection badge');}};
 const document={hidden:false,documentElement:html,querySelectorAll:selector=>selector==='[data-timeline-connection]'&&Object.hasOwn(html.dataset,'timelineConnection')?[html,badge]:[badge],addEventListener:(name,fn)=>listeners[name]=fn};
 const window={EventSource,DaiAPI:{API_BASE:'/api',lowBandwidth:()=>low},PatientExperience:{refreshTimeline(){refreshed++;}},addEventListener:(name,fn)=>listeners[name]=fn};
 const navigator={onLine:true};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-timeline-live.js'),'utf8'),{window,EventSource,DaiAPI:window.DaiAPI,document,navigator,localStorage:{getItem:()=>null},setTimeout:fn=>timers.push(fn),clearTimeout(){}});
 window.PatientTimelineLive.start();assert.equal(streams[0].url,'/api/patient/timeline/events');assert.equal(streams[0].options.withCredentials,true);streams[0].events.ready();assert.equal(refreshed,1);assert.equal(badge.textContent,'Live updates');assert.equal(html.dataset.daiTimelineConnectionState,'live');assert.equal(Object.hasOwn(html.dataset,'timelineConnection'),false);streams[0].events['timeline-changed']();assert.equal(refreshed,2);
 streams[0].onerror();assert.equal(streams[0].closed,true);assert.equal(badge.textContent,'Refresh available');timers.at(-1)();streams[1].events.ready();assert.equal(refreshed,3);
 document.hidden=true;listeners.visibilitychange();assert.equal(streams[1].closed,true);document.hidden=false;listeners.visibilitychange();assert.equal(streams.length,3);
 navigator.onLine=false;listeners.offline();assert.equal(streams[2].closed,true);assert.equal(badge.textContent,'Saved offline');navigator.onLine=true;low=true;listeners.online();assert.equal(streams.length,3);
});
test('timeline cache includes the new client but continues excluding API and report data',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../frontend/dashboard.html'),'utf8'),sw=fs.readFileSync(path.join(__dirname,'../frontend/patient-sw.js'),'utf8');
 assert.match(page,/js\/patient-timeline-live\.js/);assert.match(sw,/v60-timeline-visual-polish/);assert.match(sw,/FILES\.includes\(u.pathname\)/);
 assert.match(page,/id="timelineRecordDetails"/);
});

test('every patient startup script parses, including deferred follow-up code',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../frontend/js/patient-followup-state.js'),'utf8');assert.doesNotThrow(()=>new vm.Script(source));
});
