(function(){
  'use strict';
  if(document.getElementById('daiCareChatbot')||window.daiDayaLoading)return;
  window.daiDayaLoading=true;
  const script=document.currentScript;
  const base=new URL('../',script.src);
  const appBase=new URL('/',location.origin);
  const asset=path=>new URL(path,base).href;
  const style=document.createElement('link');style.rel='stylesheet';style.href=asset('js/care-chatbot.css?v=dhruv-voice-8');document.head.appendChild(style);
  function el(tag,attrs={},text){const n=document.createElement(tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text)n.textContent=text;return n;}
  function boot(){
    const knowledge=window.DaiDayaKnowledge;
    let language='en',voice=false,avatar=null,avatarPromise=null,recognition=null,lastReply='',lastReplyOptions={},speechId=0,opened=false,speechAbort=null,currentAudio=null,audioUrl=null,slow=false;
    const root=el('div',{class:'care-chatbot',id:'daiCareChatbot'});
    root.innerHTML=`<button type="button" class="care-chatbot__launcher" aria-controls="careChatbotPanel" aria-expanded="false"><span class="daya-spark" aria-hidden="true">✦</span><span>Ask Dhruv</span></button>
      <section id="careChatbotPanel" class="care-chatbot__panel" aria-label="Dhruv assistant" hidden>
      <header class="care-chatbot__header"><strong>Dhruv</strong><div class="daya-header-actions"><details class="dhruv-about"><summary aria-label="About Dhruv">ⓘ</summary><p>AI guide, not a clinician. Microphone audio may use your browser’s speech service. Approved spoken replies use Gemini. Nothing is saved from this chat.</p></details><select aria-label="Assistant language"><option value="en">English</option><option value="hi">हिंदी</option></select><button type="button" class="care-chatbot__close" aria-label="Close assistant">×</button></div></header>
      <div class="daya-body"><aside class="daya-character" aria-label="Animated 3D Dhruv"><div class="daya-avatar"><span class="daya-avatar-status" role="status">Loading…</span></div><span class="daya-state" role="status">Ready</span><a class="daya-credit" href="https://sketchfab.com/3d-models/doctor-sketchfab-weekly-13-mar23-9c89a438a5e940e59a0f9a07c22d6ade" target="_blank" rel="noopener noreferrer">Avatar: BrushDip · CC BY</a></aside>
      <div class="daya-conversation"><div class="dhruv-modes"><select class="dhruv-input-mode" aria-label="Chat mode"><option value="text">Text → Text</option><option value="text-voice">Text → Voice</option><option value="conversation">Voice ↔ Voice</option></select></div>
      <div class="dhruv-voice-heading" hidden><h2>Talk to Dhruv</h2><div class="dhruv-waveform" aria-hidden="true"></div><p class="dhruv-voice-status" role="status">Ready when you are</p></div>
      <p class="daya-voice-error" role="status" hidden></p><button type="button" class="dhruv-play-reply" hidden>Play reply</button><button type="button" class="dhruv-device-fallback" hidden>Use device voice</button>
      <div class="care-chatbot__feed" role="log" aria-live="polite" aria-label="Conversation"></div><div class="care-chatbot__chips" aria-label="Suggested questions"></div>
      <form class="care-chatbot__form"><input type="text" maxlength="1500" aria-label="Ask Dhruv" placeholder="Ask me anything…" autocomplete="off"><button type="submit">Send</button></form>
      <div class="dhruv-voice-input" hidden><div class="dhruv-mic-orbit" aria-hidden="true"></div><button type="button" class="daya-mic" aria-pressed="false">🎙 Start conversation</button><span class="dhruv-mic-caption" aria-hidden="true">Start conversation</span></div><p class="daya-help-status" role="status" hidden></p></div></div></section>`;
    document.body.appendChild(root);
    const panel=root.querySelector('section'),launcher=root.querySelector('.care-chatbot__launcher'),feed=root.querySelector('.care-chatbot__feed'),input=root.querySelector('.care-chatbot__form input'),mic=root.querySelector('.daya-mic'),state=root.querySelector('.daya-state'),help=root.querySelector('.daya-help-status'),avatarHost=root.querySelector('.daya-avatar');
    const tr=(en,hi)=>language==='hi'?hi:en;
    let careGuide=null,inputMode='text',interactionId=0,conversationActive=false,deviceVoice=false,liveTranscript=null;
    const modeBar=root.querySelector('.dhruv-modes'),modeSelect=root.querySelector('.dhruv-input-mode'),voiceControls=root.querySelector('.dhruv-voice-input'),speechStatus=help;
    const micIdleLabel=()=>conversationActive?tr('■ End conversation','■ बातचीत बंद करें'):tr('🎙 Start conversation','🎙 बातचीत शुरू करें');
    const micIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
    const endIcon='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>';
    function updateMic(){
      const label=conversationActive?tr('End conversation','बातचीत बंद करें'):tr('Start conversation','बातचीत शुरू करें');
      mic.setAttribute('aria-pressed',String(conversationActive));mic.setAttribute('aria-label',label);mic.innerHTML=conversationActive?endIcon:micIcon;mic.appendChild(el('span',{class:'dhruv-sr-only'},label));root.querySelector('.dhruv-mic-caption').textContent=label;
    }
    const waveHeights=[7,12,20,11,28,35,18,42,25,48,32,20,39,54,30,44,23,36,16,28,20,12,8];
    const waveform=root.querySelector('.dhruv-waveform');waveHeights.forEach((height,index)=>{const bar=el('span');bar.style.setProperty('--bar-height',height+'px');bar.style.setProperty('--bar-delay',(-index*.07)+'s');waveform.appendChild(bar);});
    function clearLiveTranscript(){liveTranscript?.remove();liveTranscript=null;}
    const preparedAudio=new Map(),preparingAudio=new Map();
    function setVoiceState(kind,text){
      if(root.dataset)root.dataset.voiceState=kind;
      state.textContent=text;const status=root.querySelector('.dhruv-voice-status');if(status)status.textContent=text;
    }
    // Safari grants playback permission per element: keep one player for the whole chat.
    let playbackAudio=null,audioUnlocked=false,pendingPlayback=null;
    function getPlaybackAudio(){if(!playbackAudio){playbackAudio=new Audio();playbackAudio.preload='auto';playbackAudio.setAttribute?.('playsinline','');}return playbackAudio;}
    function unlockAudio(){
      if(audioUnlocked||!voice)return;
      const audio=getPlaybackAudio(),token=speechId;if(currentAudio)return;
      audio.src='data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==';
      try{Promise.resolve(audio.play()).then(()=>{audioUnlocked=true;if(token===speechId&&audio!==currentAudio){audio.pause();audio.currentTime=0;}}).catch(()=>{});}catch{}
    }
    function resumeReplyAudio(){
      const waiting=pendingPlayback;if(!waiting||waiting.id!==speechId||!voice||!opened)return;
      try{return Promise.resolve(waiting.audio.play()).then(()=>{if(waiting.id!==speechId)return;audioUnlocked=true;pendingPlayback=null;root.querySelector('.daya-voice-error').hidden=true;root.querySelector('.dhruv-play-reply').hidden=true;}).catch(()=>{});}catch{}
    }
    async function prepareAudio(text,requestedLanguage,cacheable=true){
      const key=JSON.stringify([requestedLanguage,text]);
      if(cacheable&&preparedAudio.has(key))return preparedAudio.get(key);
      if(cacheable&&preparingAudio.has(key))return preparingAudio.get(key);
      const pending=(async()=>{
        const response=await fetch(new URL('api/tts',appBase).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,language:requestedLanguage}),signal:AbortSignal.timeout(35000)});
        if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||('Gemini voice unavailable: '+response.status));}
        if(response.headers.get('X-DAI-TTS-Provider')!=='gemini')throw new Error('The voice service did not return Gemini audio.');
        const blob=await response.blob();if(!/^audio\//i.test(blob.type)||!blob.size)throw new Error('No Gemini audio');
        const result={blob,voice:response.headers.get('X-DAI-TTS-Voice')||'Charon'};
        if(cacheable){if(preparedAudio.size>=12)preparedAudio.delete(preparedAudio.keys().next().value);preparedAudio.set(key,result);}return result;
      })();if(cacheable)preparingAudio.set(key,pending);
      try{return await pending;}finally{if(cacheable)preparingAudio.delete(key);}
    }
    function releaseAudio(){
      pendingPlayback=null;root.querySelector('.dhruv-play-reply')?.setAttribute?.('hidden','');
      if(currentAudio){currentAudio.onplaying=null;currentAudio.onended=null;currentAudio.onerror=null;currentAudio.pause();currentAudio.removeAttribute('src');currentAudio.load();currentAudio=null;}
      if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}
    }
    function stop(){speechId++;window.speechSynthesis?.cancel();speechAbort?.abort();speechAbort=null;releaseAudio();avatar?.setTalking(false);setVoiceState('idle',tr('Ready when you are','आपका प्रश्न सुनने को तैयार'));}
    function stopListening(){clearLiveTranscript();if(recognition){const old=recognition;recognition=null;old.onend=null;old.onresult=null;try{old.abort();}catch{}}updateMic();}
    async function speak(text,options={}){
      stop();if(!voice||!text)return;
      if(options.deviceVoice)return speakOnDevice(text,options);
      const id=speechId,requestedLanguage=options.language||language,controller=new AbortController();speechAbort=controller;
      let failed=false;
      const timeout=setTimeout(()=>controller.abort(),35000);
      setVoiceState('preparing',tr('Preparing reply…','जवाब तैयार हो रहा है…'));
      const fail=(message)=>{
        if(failed||id!==speechId||!voice||!opened)return;
        failed=true;releaseAudio();avatar?.setTalking(false);
        setVoiceState('error',tr('Gemini voice unavailable','Gemini आवाज़ उपलब्ध नहीं'));
        help.textContent=tr('Gemini error · no substitute voice','Gemini त्रुटि · दूसरी आवाज़ नहीं');
        const errorBox=root.querySelector('.daya-voice-error');errorBox.hidden=false;root.querySelector('.dhruv-device-fallback')?.removeAttribute?.('hidden');
        errorBox.textContent=tr('Voice unavailable. You can read the reply or use device voice.','आवाज़ उपलब्ध नहीं। जवाब पढ़ें या डिवाइस की आवाज़ चुनें।');errorBox.title=message||'';
      };
      const errorBox=root.querySelector('.daya-voice-error');errorBox.hidden=true;
      try{
        const prepared=await Promise.race([prepareAudio(text,requestedLanguage,options.cacheable!==false),new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new DOMException('Request stopped','AbortError')),{once:true});})]);
        if(id!==speechId||!voice||!opened)return;
        audioUrl=URL.createObjectURL(prepared.blob);const audio=getPlaybackAudio();audio.src=audioUrl;currentAudio=audio;
        audio.playbackRate=slow?.85:1;
        const voiceName=prepared.voice;
        help.textContent='Gemini · '+voiceName+' · '+(requestedLanguage==='hi'?'हिंदी':'English');
        audio.onplaying=()=>{if(id===speechId){avatar?.setTalking(true);setVoiceState('speaking',tr('Speaking…','बोल रहा हूँ…'));}};
        audio.onended=()=>{if(id===speechId){releaseAudio();avatar?.setTalking(false);setVoiceState('idle',tr('Ready when you are','आपका प्रश्न सुनने को तैयार'));options.onEnd?.();}};
        audio.onerror=()=>fail(tr('Voice could not play. Please try again.','आवाज़ नहीं चल पाई। फिर कोशिश करें।'));await audio.play();
      }catch(error){
        if(error.name==='NotAllowedError'&&id===speechId&&currentAudio&&voice&&opened){
          pendingPlayback={id,audio:currentAudio};avatar?.setTalking(false);setVoiceState('paused',tr('Tap to hear reply','जवाब सुनने के लिए दबाएँ'));
          errorBox.hidden=false;errorBox.textContent=tr('Tap Play reply to enable sound.','आवाज़ के लिए जवाब सुनें दबाएँ।');root.querySelector('.dhruv-play-reply').hidden=false;
        }else fail(error.name==='AbortError'?tr('Gemini voice timed out. Please try again.','Gemini आवाज़ का समय समाप्त हुआ। फिर कोशिश करें।'):error.message);
      }
      finally{clearTimeout(timeout);if(speechAbort===controller)speechAbort=null;}
    }
    function speakOnDevice(text,options={}){
      if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){setVoiceState('error',tr('Voice unavailable','आवाज़ उपलब्ध नहीं'));help.hidden=false;help.textContent=tr('Device voice unavailable. Read the reply.','डिवाइस की आवाज़ उपलब्ध नहीं। जवाब पढ़ें।');return;}
      const id=speechId,u=new window.SpeechSynthesisUtterance(text);u.lang=(options.language||language)==='hi'?'hi-IN':'en-IN';u.rate=slow?.8:.95;
      help.textContent=tr('Device voice · no Gemini request','डिवाइस की आवाज़ · Gemini को अनुरोध नहीं');
      u.onstart=()=>{if(id===speechId){avatar?.setTalking(true);setVoiceState('speaking',tr('Speaking…','बोल रहा हूँ…'));}};
      u.onend=()=>{if(id===speechId){avatar?.setTalking(false);setVoiceState('idle',tr('Ready when you are','आपका प्रश्न सुनने को तैयार'));options.onEnd?.();}};
      u.onerror=()=>{if(id===speechId){avatar?.setTalking(false);setVoiceState('error',tr('Voice unavailable','आवाज़ उपलब्ध नहीं'));help.hidden=false;help.textContent=tr('Device voice unavailable. Read the reply.','डिवाइस की आवाज़ उपलब्ध नहीं। जवाब पढ़ें।');}};
      window.speechSynthesis.speak(u);
    }
    function navigateLink(target){
      const names={timeline:['Open Care Timeline','Care Timeline खोलें'],records:['Open Records','Records खोलें'],settings:['Open Settings','Settings खोलें'],appointments:['Open Appointments','Appointments खोलें'],postpartum:['Open Postpartum','Postpartum खोलें'],child:['Open Child workspace','Child workspace खोलें']};
      const a=el('a',{href:new URL(target==='child'?'child-dashboard.html':'dashboard.html',appBase).href},names[target]?tr(...names[target]):'Open workspace');
      if(target!=='child')a.addEventListener('click',event=>{
        const button=document.querySelector('[data-panel="'+target+'"]');
        if(button&&location.pathname.endsWith('/dashboard.html')){event.preventDefault();button.click();close();}
      });return a;
    }
    function message(who,text,result,audioOptions={}){
      const row=el('div',{class:'care-chatbot__message care-chatbot__message--'+who});
      const identity=el('span',{class:'dhruv-bubble-identity'},who==='bot'?'Dhruv':tr('You','आप'));row.appendChild(identity);row.appendChild(el('p',{class:'dhruv-reply-text'},text));
      if(result){row.dataset.replyId=result.id;if(result.safety)row.dataset.safety='true';
        if(!result.safety&&(result.sources.length||result.navigation)){
          const links=el('div',{class:'daya-links'});
          if(result.navigation)links.appendChild(navigateLink(result.navigation));
          result.sources.forEach((source,i)=>{const u=new URL(source);if(u.protocol!=='https:')return;links.appendChild(el('a',{href:u.href,target:'_blank',rel:'noopener noreferrer'},tr('Official / clinical source','आधिकारिक / चिकित्सा स्रोत')+(result.sources.length>1?' '+(i+1):'')+' ↗'));});row.appendChild(links);
        }
      }
      if(who==='bot'&&(result||audioOptions.replay)){
        const replay=el('button',{type:'button',class:'dhruv-bubble-play','aria-label':tr('Replay Dhruv reply','ध्रुव का जवाब फिर सुनें'),title:tr('Replay reply','जवाब फिर सुनें')},'▶');
        const replyOptions={language,...audioOptions};
        replay.onclick=()=>{if(!voice)return;interactionId++;conversationActive=false;stopListening();updateMic();speakReply(text,replyOptions);};row.appendChild(replay);
      }
      feed.appendChild(row);feed.scrollTop=feed.scrollHeight;
    }
    function intro(){message('bot',tr('Hi, I’m Dhruv. How can I help?','नमस्ते, मैं ध्रुव हूँ। कैसे मदद करूँ?'));}
    function ask(text,options={}){
      const clean=String(text||'').trim().slice(0,1500);if(!clean)return;
      interactionId++;stopListening();stop();speechStatus.hidden=true;message('user',clean);input.value='';
      if(careGuide?.handle(clean,options))return;
      const result=knowledge.respond(clean,language);lastReplyOptions={};lastReply=result.text;message('bot',result.text,result);speakReply(result.text);
    }
    function topics(){
      const chips=root.querySelector('.care-chatbot__chips');chips.replaceChildren();
      const suggestions=[['timeline','My timeline','मेरी टाइमलाइन'],['next-visit','My next checkup','अगली जाँच'],['upload','Upload a report','रिपोर्ट अपलोड'],['family','Family sharing','परिवार से साझा करें']];
      for(const [id,en,hi] of suggestions){const q=knowledge.faqs.find(q=>q.id===id);if(!q)continue;const button=el('button',{type:'button','data-question-id':id},tr(en,hi));button.onclick=()=>{ask(q.question[language],{faq:true});unlockAudio();};chips.appendChild(button);}
    }
    function labels(){
      root.lang=language;root.dataset.inputMode=inputMode;root.querySelector('.dhruv-voice-heading').hidden=inputMode!=='conversation';root.querySelector('.dhruv-voice-heading h2').textContent=tr('Talk to Dhruv','ध्रुव से बात करें');state.setAttribute('aria-hidden',String(inputMode==='conversation'));setVoiceState('idle',tr('Ready when you are','आपका प्रश्न सुनने को तैयार'));
      input.placeholder=tr('Ask me anything…','अपना प्रश्न पूछें…');root.querySelector('form button').textContent=tr('Send','भेजें');
      modeSelect.options[0].textContent=tr('Text → Text','लिखें → लिखित जवाब');modeSelect.options[1].textContent=tr('Text → Voice','लिखें → आवाज़ में जवाब');modeSelect.options[2].textContent=tr('Voice ↔ Voice','बोलकर बातचीत');
      root.querySelector('.care-chatbot__form').hidden=inputMode==='conversation';voiceControls.hidden=inputMode!=='conversation';updateMic();
      speechStatus.hidden=true;if(inputMode==='conversation'&&!(window.SpeechRecognition||window.webkitSpeechRecognition)){speechStatus.hidden=false;speechStatus.textContent=tr('Voice input is unavailable here. Choose a text mode.','यहाँ बोलना उपलब्ध नहीं। लिखने वाला मोड चुनें।');}root.querySelector('.daya-voice-error').hidden=true;root.querySelector('.dhruv-device-fallback').hidden=true;root.querySelector('.dhruv-play-reply').hidden=true;
      root.querySelector('.dhruv-about p').textContent=tr('AI guide, not a clinician. Microphone audio may use your browser’s speech service. Approved replies use Gemini for voice. Nothing is saved from this chat.','AI साथी, डॉक्टर नहीं। माइक्रोफ़ोन की आवाज़ ब्राउज़र की सेवा प्रोसेस कर सकती है। अनुमत जवाब Gemini से सुनाए जाते हैं। यह चैट सेव नहीं होती।');
      root.querySelector('.dhruv-device-fallback').textContent=tr('Use device voice','डिवाइस की आवाज़');root.querySelector('.dhruv-play-reply').textContent=tr('Play reply','जवाब सुनें');
      careGuide?.languageChanged?.();topics();
    }
    async function loadAvatar(){
      if(avatarPromise)return avatarPromise;
      const status=avatarHost.querySelector('.daya-avatar-status');
      if(localStorage.getItem('dai-low-bandwidth')==='true'){avatarHost.classList.add('daya-avatar--static');status.textContent=tr('Text & voice · 3D paused','लिखें या बोलें · 3D बंद');return Promise.resolve(null);}
      avatarPromise=import(asset('js/daya-avatar.mjs')).then(module=>module.createAvatar(avatarHost,base)).then(instance=>{
        avatar=instance;avatar.setVisible(opened);status.hidden=true;if(currentAudio&&!currentAudio.paused)avatar.setTalking(true);
      }).catch(error=>{console.warn('Dhruv 3D preview unavailable:',error);status.textContent=tr('3D view unavailable. Chat and voice still work.','3D उपलब्ध नहीं। चैट और आवाज़ इस्तेमाल करें।');});
      return avatarPromise;
    }
    function open(){opened=true;panel.hidden=false;launcher.hidden=true;launcher.setAttribute('aria-expanded','true');avatar?.setVisible(true);if(!feed.children.length)intro();loadAvatar();if(inputMode==='conversation')mic.focus();else input.focus();}
    function close(){interactionId++;conversationActive=false;opened=false;panel.hidden=true;launcher.hidden=false;launcher.setAttribute('aria-expanded','false');stop();stopListening();avatar?.setVisible(false);launcher.focus();}
    launcher.addEventListener('click',open);root.querySelector('.care-chatbot__close').addEventListener('click',close);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
    root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();ask(input.value);unlockAudio();});
    root.querySelector('.daya-header-actions select').addEventListener('change',event=>{stopListening();interactionId++;conversationActive=false;language=event.target.value;stop();lastReply='';careGuide?.reset();labels();intro();});
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    function speechFailure(code){
      conversationActive=false;clearLiveTranscript();
      const reasons={
        'not-allowed':tr('Microphone access was blocked. Allow it in this site’s browser settings and macOS System Settings → Privacy & Security → Microphone, then try again.','माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र की साइट सेटिंग और macOS की Privacy & Security → Microphone में अनुमति दें।'),
        'service-not-allowed':tr('The browser blocked its speech-recognition service. Try this page in Google Chrome, or type.','ब्राउज़र ने आवाज़ पहचानने की सेवा रोक दी। यह पेज Google Chrome में खोलें या लिखें।'),
        'audio-capture':tr('No working microphone was found. Check your selected input device and microphone permissions, then try again.','काम करने वाला माइक्रोफ़ोन नहीं मिला। चुना हुआ माइक्रोफ़ोन और अनुमति जाँचें।'),
        'no-speech':tr('No speech was detected. Tap Start speaking, wait for Listening, then speak near your microphone.','आवाज़ नहीं मिली। बोलना शुरू करें दबाएँ, सुन रहा हूँ दिखने पर माइक्रोफ़ोन के पास बोलें।'),
        'network':tr('The browser’s speech-recognition service could not connect. Check your connection or try this page in Google Chrome.','ब्राउज़र की आवाज़ पहचानने की सेवा से कनेक्शन नहीं हुआ। इंटरनेट जाँचें या यह पेज Google Chrome में खोलें।'),
        'language-not-supported':tr('This browser’s speech service does not support the selected language. Try another language or open this page in Google Chrome.','यह ब्राउज़र चुनी हुई भाषा में आवाज़ नहीं पहचान पाया। दूसरी भाषा चुनें या Google Chrome में खोलें।'),
        'aborted':tr('Listening stopped. Tap Start speaking when you are ready.','सुनना बंद हुआ। तैयार होने पर बोलना शुरू करें दबाएँ।')
      };
      let message=reasons[code]||tr('Speech input failed in this browser. Try again or type your question.','इस ब्राउज़र में आवाज़ नहीं मिली। फिर कोशिश करें या अपना प्रश्न लिखें।');
      if(navigator.brave&&['network','service-not-allowed','language-not-supported'].includes(code))message=tr('Brave’s speech-recognition service failed for this session. Open the same DAI address in Google Chrome and allow the microphone. Typing still works here.','इस बार Brave की आवाज़ पहचान सेवा काम नहीं कर पाई। यही DAI पता Google Chrome में खोलें और माइक्रोफ़ोन की अनुमति दें। यहाँ लिखना चालू है।');
      speechStatus.hidden=false;speechStatus.dataset.error=code;speechStatus.textContent=message;
      updateMic();
      setVoiceState('error',tr('Voice input paused','बोलकर संदेश देना रुका है'));
    }

    if(!Recognition){mic.disabled=true;mic.title='Speech recognition is not supported in this browser. You can type instead.';}
    function startListening(){
      if(!Recognition||!opened||inputMode!=='conversation')return;
      stopListening();stop();let r;try{r=new Recognition();}catch{speechFailure('service-not-allowed');return;}delete speechStatus.dataset.error;recognition=r;r.lang=language==='hi'?'hi-IN':'en-IN';r.interimResults=true;r.continuous=false;
      let finalText='',hadError=false;
      speechStatus.hidden=true;
      r.onstart=()=>{if(recognition!==r)return;updateMic();setVoiceState('listening',tr('Listening…','सुन रहा हूँ…'));};
      r.onresult=event=>{if(recognition!==r||!opened)return;let interim='';for(let i=event.resultIndex;i<event.results.length;i++){if(event.results[i].isFinal)finalText+=event.results[i][0].transcript+' ';else interim+=event.results[i][0].transcript;}input.value=(finalText+interim).trim().slice(0,1500);
        if(input.value){if(!liveTranscript){liveTranscript=el('div',{class:'care-chatbot__message care-chatbot__message--user dhruv-live-transcript','aria-label':tr('Your speech transcript','आपकी बोली बात')});liveTranscript.append(el('span',{class:'dhruv-bubble-identity'},tr('You','आप')),el('p',{class:'dhruv-reply-text'}));feed.appendChild(liveTranscript);}liveTranscript.querySelector('p').textContent=input.value;feed.scrollTop=feed.scrollHeight;}
      };
      r.onerror=event=>{if(recognition!==r)return;hadError=true;speechFailure(event.error||'unknown');recognition=null;r.onend=null;r.onresult=null;try{r.abort();}catch{}};
      r.onend=()=>{if(recognition!==r)return;recognition=null;if(!opened||hadError)return;if(finalText.trim())ask(finalText);else{clearLiveTranscript();conversationActive=false;updateMic();setVoiceState('idle',tr('Ready','तैयार'));}};
      try{r.start();}catch(error){recognition=null;speechFailure(error.name==='NotAllowedError'?'not-allowed':'service-not-allowed');}
    }
    mic.addEventListener('click',()=>{if(conversationActive){interactionId++;conversationActive=false;stopListening();stop();updateMic();return;}conversationActive=true;updateMic();startListening();unlockAudio();});
    modeSelect.addEventListener('change',()=>{interactionId++;conversationActive=false;stopListening();stop();inputMode=modeSelect.value;voice=inputMode!=='text';labels();if(voice)unlockAudio();if(inputMode==='conversation')mic.focus();else input.focus();});
    root.querySelector('.dhruv-play-reply').onclick=resumeReplyAudio;
    root.querySelector('.dhruv-device-fallback').onclick=()=>{deviceVoice=true;root.querySelector('.daya-voice-error').hidden=true;root.querySelector('.dhruv-device-fallback').hidden=true;if(voice&&lastReply)speakReply(lastReply,lastReplyOptions);};
    function speakReply(text,options={}){
      const token=interactionId;
      speak(text,{...options,deviceVoice,onEnd:()=>{if(token===interactionId&&opened&&voice&&inputMode==='conversation'&&conversationActive&&!options.pauseConversation&&!document.hidden)startListening();}});
    }
    function guideReply(text,{spokenLanguage=language,pauseConversation=false}={}){
      lastReply=text;lastReplyOptions={language:spokenLanguage,cacheable:false};message('bot',text,null,{...lastReplyOptions,replay:true});
      if(pauseConversation){conversationActive=false;updateMic();}
      speakReply(text,{...lastReplyOptions,pauseConversation});
    }
    window.DhruvCompanion={open,close,ask,root,feed,reply:guideReply,message,language:()=>language,isOpen:()=>opened,registerGuide:guide=>{careGuide=guide;},listen:startListening,stop:()=>{interactionId++;conversationActive=false;stopListening();stop();updateMic();}};
    window.dispatchEvent(new Event('dhruv:ready'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden){interactionId++;conversationActive=false;stop();stopListening();}});
    window.addEventListener('pagehide',event=>{conversationActive=false;stop();stopListening();if(event.persisted)avatar?.setVisible(false);else avatar?.dispose();});
    window.addEventListener('pageshow',event=>{if(event.persisted)avatar?.setVisible(opened);});
    labels();
    if(['#dr-daya','#dhruv','#dai-didi'].includes(location.hash))open();
  }
  if(window.DaiDayaKnowledge)boot();else{
    const knowledge=document.createElement('script');knowledge.src=asset('js/daya-knowledge.js?v=dhruv-voice-8');knowledge.onload=boot;knowledge.onerror=()=>{window.daiDayaLoading=false;console.error('Dhruv questions could not load.');};document.head.appendChild(knowledge);
  }
})();
