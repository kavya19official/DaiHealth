const {test}=require('node:test');const assert=require('node:assert/strict');
const {createSpeechHandler,pcmToWav}=require('./dayaSpeech');
const {faqs}=require('../frontend/js/daya-knowledge');
function res(){return {code:200,headers:{},status(code){this.code=code;return this;},json(body){this.body=body;return this;},set(headers){Object.assign(this.headers,headers);return this;},send(body){this.body=body;return this;}};}
const text=lang=>faqs.find(f=>f.id==='timeline').answer[lang];
function ok(){return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;codec=pcm;rate=24000',data:Buffer.from([0,0,1,0]).toString('base64')}}]}}]})};}
test('Gemini receives the approved answer with Charon and the selected Hindi/English language, never a question or patient record',async()=>{
 const calls=[];const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake-test-key'},fetchImpl:async(...args)=>{calls.push(args);return ok();}});
 for(const language of ['en','hi']){
  const r=res();await handle({body:{text:text(language),language,question:'private question',record:{name:'PRIVATE'}},ip:'test'},r);
  assert.equal(r.code,200);assert.equal(r.headers['X-DAI-TTS-Voice'],'Charon');assert.equal(r.headers['X-DAI-TTS-Language'],language);
  assert.equal(r.body.toString('ascii',0,4),'RIFF');assert.equal(r.body.readUInt32LE(24),24000);
 }
 for(const [index,[url,options]] of calls.entries()){
  assert.ok(!url.includes('fake-test-key'));assert.equal(options.headers['x-goog-api-key'],'fake-test-key');
  const body=JSON.parse(options.body);assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Charon');
  assert.match(body.contents[0].parts[0].text,index===0?/English \(India\)/:/Hindi \(India\)/);
  assert.ok(!options.body.includes('PRIVATE'));assert.ok(!options.body.includes('private question'));
 }
});
test('missing key and arbitrary text fail locally without a Google call',async()=>{
 let calls=0;const handle=createSpeechHandler({env:{},fetchImpl:async()=>{calls++;return ok();}});
 for(const [body,code] of [[{text:text('en'),language:'en'},503],[{text:'Patient report with private details',language:'en'},400],[{text:text('en'),language:'fr'},400],[{text:''},400]]){
  const r=res();await handle({body},r);assert.equal(r.code,code);
 }assert.equal(calls,0);
});
test('prepared audio is cached per language/model/voice, with configurable model and male voice',async()=>{
 let calls=0;const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake',GEMINI_TTS_MODEL:'configured-tts',GEMINI_TTS_VOICE:'Fenrir'},fetchImpl:async()=>{calls++;return ok();}});
 const first=res(),second=res();for(const r of [first,second])await handle({body:{text:text('en'),language:'en'}},r);
 assert.equal(calls,1);assert.equal(first.headers['X-DAI-TTS-Cache'],'miss');assert.equal(second.headers['X-DAI-TTS-Cache'],'hit');assert.equal(first.headers['X-DAI-TTS-Model'],'configured-tts');assert.equal(first.headers['X-DAI-TTS-Voice'],'Fenrir');
});
test('invalid audio, quota and upstream failures never return fake audio or provider internals',async()=>{
 for(const [upstream,code] of [[{ok:false,status:429,json:async()=>({})},429],[{ok:false,status:403,json:async()=>({})},502],[{ok:true,json:async()=>({})},502]]){
  const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake'},fetchImpl:async()=>upstream}),r=res();
  await handle({body:{text:text('en'),language:'en'}},r);assert.equal(r.code,code);assert.ok(!Buffer.isBuffer(r.body));
 }
 const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake'},fetchImpl:async()=>{const e=new Error('secret');e.name='TimeoutError';throw e;}}),r=res();await handle({body:{text:text('en')}},r);assert.equal(r.code,504);assert.ok(!JSON.stringify(r.body).includes('secret'));
});
test('uncached public requests are rate limited',async()=>{
 let calls=0;const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake'},fetchImpl:async()=>{calls++;return {ok:false,status:503,json:async()=>({})};}});
 let last;for(let i=0;i<31;i++){last=res();await handle({body:{text:text('en')},ip:'same-demo-user'},last);}
 assert.equal(calls,30);assert.equal(last.code,429);
});
test('PCM is wrapped as mono 16-bit WAV with the reported sample rate',()=>{
 const b=pcmToWav(Buffer.from([0,0]),22050);assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt16LE(34),16);assert.equal(b.readUInt32LE(24),22050);assert.equal(b.length,46);
});

// Exercise the actual widget voice functions with mocked browser audio, without
// calling Google or requesting a real microphone permission.
function browserVoice(fetchImpl){
 const fs=require('node:fs'),vm=require('node:vm');
 const code=fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/care-chatbot.js'),'utf8');
 const functions=code.slice(code.indexOf('    const preparedAudio='),code.indexOf('    function navigateLink('));
 const audios=[],gestures=[];
 class MockAudio{
  constructor(){audios.push(this);this.paused=true;}
  async play(){this.paused=false;this.onplaying?.();}
  pause(){this.paused=true;}
  removeAttribute(){}load(){}
 }
 const context=vm.createContext({fetch:fetchImpl,URL,AbortController,AbortSignal,DOMException,Audio:MockAudio,setTimeout,clearTimeout,console,gestures,
  window:{},appBase:new URL('http://localhost:3001/'),speechSynthesis:{cancel(){}}});
 vm.runInContext(`let language='en',voice=true,utterance=null,speechId=0,opened=true,speechAbort=null,currentAudio=null,audioUrl=null;
 const input={addEventListener(){}},knowledge={faqs:[]};
 const errorBox={hidden:true,textContent:''},root={querySelector:()=>errorBox};
 const state={},help={},avatar={setTalking:value=>gestures.push(value)},tr=(en,hi)=>language==='hi'?hi:en;
 ${functions}
 globalThis.voiceTest={speak,stop,setLanguage:value=>{language=value;stop();},status:()=>({text:state.textContent,help:help.textContent})};`,context);
 return {api:context.voiceTest,audios,gestures};
}
const wavResponse=()=>({ok:true,blob:async()=>new Blob([Buffer.from([0,0])],{type:'audio/wav'}),headers:{get:name=>name==='X-DAI-TTS-Provider'?'gemini':'Charon'}});
test('widget starts/stops talking with Gemini playback and releases audio on stop',async()=>{
 const h=browserVoice(async()=>wavResponse());await h.api.speak('prepared answer');assert.equal(h.audios.length,1);assert.equal(h.gestures.at(-1),true);assert.match(h.api.status().help,/Gemini/);
 h.audios[0].onended();assert.equal(h.gestures.at(-1),false);assert.equal(h.audios[0].paused,true);
 await h.api.speak('next answer');h.api.stop();assert.equal(h.audios[1].paused,true);assert.equal(h.gestures.at(-1),false);
});
test('changing language cancels playback and discards stale audio while the cache request finishes',async()=>{
 let complete,signal;const h=browserVoice(async(url,options)=>{signal=options.signal;return new Promise(resolve=>{complete=resolve;});});
 const pending=h.api.speak('prepared answer');h.api.setLanguage('hi');assert.equal(signal.aborted,false);complete(wavResponse());await pending;
 assert.equal(h.audios.length,0);assert.equal(h.gestures.at(-1),false);
});
test('Gemini failure displays an error and never substitutes browser speech',async()=>{
 const h=browserVoice(async()=>({ok:false,status:503,json:async()=>({})}));await h.api.speak('prepared answer');assert.equal(h.audios.length,0);assert.equal(h.gestures.at(-1),false);assert.equal(h.api.status().text,'Gemini voice unavailable');assert.match(h.api.status().help,/no substitute voice/);
});

test('widget contains no browser speech-synthesis fallback',()=>{const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../frontend/js/care-chatbot.js'),'utf8');assert.doesNotMatch(source,/SpeechSynthesisUtterance|speechSynthesis\.speak/);});
test('simultaneous identical replies share one Gemini generation',async()=>{
 let calls=0,resolve;const handle=createSpeechHandler({env:{GEMINI_API_KEY:'fake'},fetchImpl:async()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const a=res(),b=res();const first=handle({body:{text:text('en'),language:'en'},ip:'a'},a),second=handle({body:{text:text('en'),language:'en'},ip:'b'},b);resolve(ok());await Promise.all([first,second]);assert.equal(calls,1);assert.equal(a.code,200);assert.deepEqual(a.body,b.body);
});
test('approved voice cache survives handler restarts and separates voice configurations',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-voice-cache-'));let calls=0;
 try{const env={GEMINI_API_KEY:'fake',DAI_TTS_CACHE_DIR:dir};const first=createSpeechHandler({env,fetchImpl:async()=>{calls++;return ok();}});await first({body:{text:text('hi'),language:'hi'}},res());const second=createSpeechHandler({env,fetchImpl:async()=>{calls++;return ok();}}),r=res();await second({body:{text:text('hi'),language:'hi'}},r);assert.equal(calls,1);assert.equal(r.headers['X-DAI-TTS-Cache'],'hit');assert.equal(r.headers['X-DAI-TTS-Voice'],'Charon');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('widget replays an already prepared reply without another network fetch',async()=>{
 let calls=0;const h=browserVoice(async()=>{calls++;return wavResponse();});await h.api.speak('same approved reply');h.api.stop();await h.api.speak('same approved reply');assert.equal(calls,1);assert.equal(h.audios.length,2);h.api.stop();
});
