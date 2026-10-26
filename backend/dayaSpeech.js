'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {faqs,respond}=require('../frontend/js/daya-knowledge');

function pcmToWav(pcm,sampleRate=24000){
  const header=Buffer.alloc(44);
  header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);
  header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);
  header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);
  header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
function createSpeechHandler({env=process.env,fetchImpl=(...args)=>fetch(...args),now=Date.now,usageTracker=null}={}){
  const cache=new Map(),requests=new Map(),inflight=new Map();
  const diskDir=env.DAI_TTS_CACHE_DIR || (env===process.env?path.join(__dirname,'../.local/tts-cache'):null);
  const approved=Object.fromEntries(['en','hi'].map(lang=>[lang,new Set([...faqs.map(f=>f.answer[lang]),respond('',lang).text])]));
  return async function speech(req,res){
    const text=typeof req.body?.text==='string'?req.body.text.trim():'';
    const rawLanguage=req.body?.language??'en';
    if(!['en','hi','en-IN','hi-IN'].includes(rawLanguage))return res.status(400).json({error:'Language must be English (en) or Hindi (hi)'});
    const language=rawLanguage.startsWith('hi')?'hi':'en';
    if(!text||text.length>1500)return res.status(400).json({error:'A prepared answer of at most 1500 characters is required'});
    // The public widget can voice prepared educational answers only. Never forward
    // arbitrary questions, patient records or caller-provided prompts to Google.
    if(!approved[language].has(text))return res.status(400).json({error:'Only Dr. Daya prepared answers can be spoken'});
    const key=env.GEMINI_API_KEY||env.GOOGLE_API_KEY;
    if(!key)return res.status(503).json({error:'Gemini voice is not configured. Add GEMINI_API_KEY to backend/.env and restart DAI.'});
    const model=env.GEMINI_TTS_MODEL||'gemini-2.5-flash-preview-tts';
    const voice=env.GEMINI_TTS_VOICE||'Charon';
    const cacheKey=JSON.stringify(['v2',model,voice,language,text]);
    const diskPath=diskDir?path.join(diskDir,crypto.createHash('sha256').update(cacheKey).digest('hex')+'.wav'):null;
    let usage=null,providerResponse=null,providerStatus=null;
    async function track(outcome,called){if(!usage)usage=await usageTracker?.start({owner_id:req.user?.id,kind:'prepared_speech',task_key:'prepared-speech',model,provider_called:called});const receipt=await usage?.finish({outcome,response:providerResponse,http_status:providerStatus});if(receipt?.event_id)res.set({'X-DAI-Usage-ID':receipt.event_id});}
    async function send(audio,cached){
      await track(cached?'cache_hit':'returned',!cached);
      res.set({'Content-Type':'audio/wav','Content-Length':audio.length,'Cache-Control':'no-store',
        'X-DAI-TTS-Provider':'gemini','X-DAI-TTS-Voice':voice,'X-DAI-TTS-Model':model,
        'X-DAI-TTS-Language':language,'X-DAI-TTS-Cache':cached?'hit':'miss'});
      return res.send(audio);
    }
    if(cache.has(cacheKey))return send(cache.get(cacheKey),true);
    if(diskPath){try{const bytes=await fs.readFile(diskPath);if(bytes.length>44&&bytes.length<=8*1024*1024&&bytes.toString('ascii',0,4)==='RIFF'){cache.set(cacheKey,bytes);return send(bytes,true);}}catch{}}
    if(inflight.has(cacheKey)){const result=await inflight.get(cacheKey);await track('coalesced',false);return result.audio?send(result.audio,true):res.status(result.code).json({error:result.error});}

    const time=now();for(const [ip,entry] of requests)if(entry.expires<=time)requests.delete(ip);
    const ip=req.ip||'local',entry=requests.get(ip)||{count:0,expires:time+600000};
    if(entry.count>=30||requests.size>10000)return res.status(429).json({error:'Voice request limit reached. Please try later.'});
    entry.count++;requests.set(ip,entry);
    let settle;inflight.set(cacheKey,new Promise(resolve=>{settle=resolve;}));
    async function failure(code,error){await track(code===504?'timeout':'failed',true);settle({code,error});inflight.delete(cacheKey);return res.status(code).json({error});}
    try{
      if(usageTracker){usage=await usageTracker.start({owner_id:req.user?.id,kind:'prepared_speech',task_key:'prepared-speech',model,provider_called:true});usage.sent();}
      const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',signal:AbortSignal.timeout(30000),
        headers:{'Content-Type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({contents:[{parts:[{text:[
          `Read the transcript below in ${language==='hi'?'Hindi (India)':'English (India)'}.`,
          'Use a calm, clear Indian male care-guide voice. Read only the transcript, without adding advice, explanations or words. Do not translate the transcript into another language.',
          'For Roman-script Hindi, pronounce the words naturally in Hindi.',
          '', 'Transcript:',text
        ].join('\n')}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}})
      });
      providerStatus=response.status??null;
      if(!response.ok){
        // Return actionable categories, never Google's raw body or credentials.
        const detail=await response.json().catch(()=>({}));providerResponse=detail;usage?.received();
        const reasons=(detail.error?.details||[]).map(d=>d.reason);
        let message=`Google rejected the Gemini voice request (HTTP ${response.status}). Check GEMINI_TTS_MODEL, GEMINI_TTS_VOICE and the API key in backend/.env, then restart DAI.`;
        if(reasons.includes('API_KEY_INVALID'))message='The running backend has an invalid Gemini API key. Update backend/.env and restart DAI; clear any older exported GEMINI_API_KEY first.';
        else if(response.status===429)message='Gemini voice quota is exhausted. Check your Google AI Studio quota or billing, then try again.';
        else if(response.status===403)message='Google denied Gemini voice access. Check API key restrictions and project access in Google AI Studio.';
        else if(response.status===404)message='This Gemini TTS model is unavailable to the running backend. Check GEMINI_TTS_MODEL in backend/.env and restart DAI.';
        return failure(response.status===429?429:502,message);
      }
      const data=await response.json();providerResponse=data;usage?.received();
      const audioPart=data.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
      if(!audioPart||!/^audio\/L16(?:;|$)/i.test(audioPart.mimeType||''))return failure(502,'Gemini returned no supported PCM audio');
      const rate=Number((audioPart.mimeType.match(/rate=(\d+)/)||[])[1]||24000);
      if(!Number.isInteger(rate)||rate<8000||rate>96000)return failure(502,'Gemini returned an unsupported sample rate');
      const pcm=Buffer.from(audioPart.data,'base64');
      if(!pcm.length||pcm.length%2||pcm.length>8*1024*1024)return failure(502,'Gemini returned invalid audio');
      const audio=pcmToWav(pcm,rate);
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(cacheKey,audio);
      if(diskPath){try{await fs.mkdir(diskDir,{recursive:true});const temporary=diskPath+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temporary,audio);await fs.rename(temporary,diskPath);}catch{ /* Audio still plays if disk storage is unavailable. */ }}
      settle({audio});inflight.delete(cacheKey);return send(audio,false);
    }catch(error){return failure(error.name==='TimeoutError'||error.name==='AbortError'?504:502,'Gemini voice is temporarily unavailable');}
  };
}
module.exports={createSpeechHandler,pcmToWav};
