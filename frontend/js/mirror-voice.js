/* Prepared, public mirror explanations only. Uses the existing server-side Charon service. */
(function(root){'use strict';
 root.createMirrorVoice=function({url,onState=()=>{},active=()=>true}){
  const cache=new Map();let audio=null,objectURL=null,controller=null,serial=0,disposed=false,pending=false;
  const player=()=>{if(!audio){audio=new Audio();audio.preload='auto';audio.setAttribute('playsinline','');}return audio;};
  function release(){pending=false;if(audio){audio.onplaying=audio.onended=audio.onerror=null;if(objectURL){audio.pause();audio.removeAttribute('src');audio.load();}}if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;}
  function stop(){serial++;controller?.abort();controller=null;release();}
  function unlock(){if(disposed||objectURL)return;const p=player();p.src='data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==';try{Promise.resolve(p.play()).then(()=>{if(!objectURL){p.pause();p.currentTime=0;}}).catch(()=>{});}catch{}}
  async function resume(){if(disposed||!pending||!active())return;try{await player().play();pending=false;}catch{onState('blocked');}}
  async function speak(text,language){
   stop();if(disposed||!active())return;const token=serial;onState('loading');
   try{
    const key=JSON.stringify([language,text]);let blob=cache.get(key);
    if(!blob){const request=new AbortController();controller=request;const timeout=setTimeout(()=>request.abort(),35000);let response;try{response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,language}),signal:controller.signal});}finally{clearTimeout(timeout);}
     if(!response.ok)throw Error('Voice unavailable');
     if(response.headers.get('X-DAI-TTS-Provider')!=='gemini'||response.headers.get('X-DAI-TTS-Voice')!=='Charon')throw Error('Charon unavailable');
     blob=await response.blob();if(!/^audio\//.test(blob.type)||!blob.size)throw Error('Empty voice');
     if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,blob);
    }
    if(token!==serial||disposed||!active())return;controller=null;objectURL=URL.createObjectURL(blob);const p=player();p.src=objectURL;
    p.onplaying=()=>{if(token===serial&&active())onState('speaking');};p.onended=()=>{if(token===serial){release();onState('ready');}};p.onerror=()=>{if(token===serial){release();onState('error');}};
    try{await p.play();}catch(error){if(token!==serial||disposed)return;if(error.name==='NotAllowedError'){pending=true;onState('blocked');}else throw error;}
   }catch(error){if(token!==serial||disposed||!active())return;release();onState('error');}
  }
  return {unlock,speak,stop,resume,pending:()=>pending,dispose(){disposed=true;stop();cache.clear();}};
 };
})(window);
