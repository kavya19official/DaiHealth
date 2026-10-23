'use strict';
const {faqs,respond}=require('../frontend/js/daya-knowledge');

function pcmToWav(pcm,sampleRate=24000){
  const header=Buffer.alloc(44);
  header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);
  header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);
  header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);
  header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
function createSpeechHandler({env=process.env,fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
  const cache=new Map(),requests=new Map();
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
    const cacheKey=JSON.stringify([model,voice,language,text]);
    function send(audio,cached){
      res.set({'Content-Type':'audio/wav','Content-Length':audio.length,'Cache-Control':'no-store',
        'X-DAI-TTS-Provider':'gemini','X-DAI-TTS-Voice':voice,'X-DAI-TTS-Model':model,
        'X-DAI-TTS-Language':language,'X-DAI-TTS-Cache':cached?'hit':'miss'});
      return res.send(audio);
    }
    if(cache.has(cacheKey))return send(cache.get(cacheKey),true);
    const time=now();for(const [ip,entry] of requests)if(entry.expires<=time)requests.delete(ip);
    const ip=req.ip||'local',entry=requests.get(ip)||{count:0,expires:time+600000};
    if(entry.count>=30||requests.size>10000)return res.status(429).json({error:'Voice request limit reached. Please try later.'});
    entry.count++;requests.set(ip,entry);
    try{
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
      if(!response.ok){
        // Return actionable categories, never Google's raw body or credentials.
        const detail=await response.json().catch(()=>({}));
        const reasons=(detail.error?.details||[]).map(d=>d.reason);
        let message=`Google rejected the Gemini voice request (HTTP ${response.status}). Check GEMINI_TTS_MODEL, GEMINI_TTS_VOICE and the API key in backend/.env, then restart DAI.`;
        if(reasons.includes('API_KEY_INVALID'))message='The running backend has an invalid Gemini API key. Update backend/.env and restart DAI; clear any older exported GEMINI_API_KEY first.';
        else if(response.status===429)message='Gemini voice quota is exhausted. Check your Google AI Studio quota or billing, then try again.';
        else if(response.status===403)message='Google denied Gemini voice access. Check API key restrictions and project access in Google AI Studio.';
        else if(response.status===404)message='This Gemini TTS model is unavailable to the running backend. Check GEMINI_TTS_MODEL in backend/.env and restart DAI.';
        return res.status(response.status===429?429:502).json({error:message});
      }
      const data=await response.json();
      const audioPart=data.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
      if(!audioPart||!/^audio\/L16(?:;|$)/i.test(audioPart.mimeType||''))return res.status(502).json({error:'Gemini returned no supported PCM audio'});
      const rate=Number((audioPart.mimeType.match(/rate=(\d+)/)||[])[1]||24000);
      if(!Number.isInteger(rate)||rate<8000||rate>96000)return res.status(502).json({error:'Gemini returned an unsupported sample rate'});
      const pcm=Buffer.from(audioPart.data,'base64');
      if(!pcm.length||pcm.length%2||pcm.length>8*1024*1024)return res.status(502).json({error:'Gemini returned invalid audio'});
      const audio=pcmToWav(pcm,rate);
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(cacheKey,audio);return send(audio,false);
    }catch(error){return res.status(error.name==='TimeoutError'||error.name==='AbortError'?504:502).json({error:'Gemini voice is temporarily unavailable'});}
  };
}
module.exports={createSpeechHandler,pcmToWav};
