(function(){
  'use strict';
  if(document.getElementById('daiCareChatbot')||window.daiDayaLoading)return;
  window.daiDayaLoading=true;
  const script=document.currentScript;
  const base=new URL('../',script.src);
  const appBase=new URL('/',location.origin);
  const asset=path=>new URL(path,base).href;
  const style=document.createElement('link');style.rel='stylesheet';style.href=asset('js/care-chatbot.css?v=dhruv-ui-1');document.head.appendChild(style);
  function el(tag,attrs={},text){const n=document.createElement(tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text)n.textContent=text;return n;}
  function boot(){
    const knowledge=window.DaiDayaKnowledge;
    let language='en',voice=false,avatar=null,avatarPromise=null,recognition=null,lastReply='',speechId=0,opened=false,speechAbort=null,currentAudio=null,audioUrl=null,slow=false;
    const root=el('div',{class:'care-chatbot',id:'daiCareChatbot'});
    root.innerHTML=`<button type="button" class="care-chatbot__launcher" aria-controls="careChatbotPanel" aria-expanded="false"><span class="daya-spark" aria-hidden="true">✦</span><span>Ask Dhruv<small>AI care companion</small></span></button>
      <section id="careChatbotPanel" class="care-chatbot__panel" aria-label="Dhruv assistant" hidden>
      <header class="care-chatbot__header"><div class="dhruv-identity"><span class="dhruv-monogram" aria-hidden="true">ध</span><div><strong>Dhruv <span class="dhruv-online" aria-hidden="true"></span></strong><small>AI care companion</small></div></div><div class="daya-header-actions"><select aria-label="Assistant language"><option value="en">English</option><option value="hi">हिंदी</option></select><button type="button" class="care-chatbot__close" aria-label="Close assistant">×</button></div></header>
      <div class="daya-body"><aside class="daya-character" aria-label="Animated AI companion"><span class="daya-badge">AI CARE COMPANION</span><div class="daya-avatar"><span class="daya-avatar-status" role="status">Loading your companion…</span></div><span class="dhruv-eyebrow">A LITTLE CLARITY. A LITTLE CARE.</span><h3>Here with you.</h3><p>I explain and guide.<br>Your real doctor makes the medical decisions.</p><span class="daya-state" role="status">Ready when you are</span><span class="dhruv-journey" hidden></span><a class="daya-credit" href="https://sketchfab.com/3d-models/doctor-sketchfab-weekly-13-mar23-9c89a438a5e940e59a0f9a07c22d6ade" target="_blank" rel="noopener noreferrer">Avatar: BrushDip · CC BY · adapted</a></aside>
      <div class="daya-conversation"><p class="care-chatbot__notice"></p><p class="daya-voice-error" role="status" hidden></p><div class="care-chatbot__feed" role="log" aria-live="polite" aria-label="Conversation"></div>
      <details class="daya-topics"><summary>Explore questions</summary><div class="daya-categories" aria-label="Question topics"></div><div class="care-chatbot__chips"></div></details>
      <details class="daya-routing"><summary>AI used when needed · how assistance works</summary>
      <p><strong>Routine clicks do not need AI.</strong> Opening a timeline, fetching records and submitting requests use ordinary application code. Optional drafting needs your approval; clinical decisions need clinician review.</p>
      <p>FAQs and form checks run locally. Typed questions are not sent to a language model. Prepared public answers can be reused; patient records and this conversation are never shared-cache content.</p>
      <button type="button" class="daya-directory">View reusable facility metadata</button><p class="daya-directory-status" role="status"></p>
      <label>Optional longer draft <select class="daya-complex-task"><option value="visit-questions">Questions to ask before a visit</option><option value="sharing-checklist">Record-sharing discussion checklist</option></select></label>
      <p>This optional task uses an external Google AI service. Only the selected generic task and language are sent. Your typed questions, identity and records are excluded. Drafts may be wrong; check before use. Each draft uses one bounded request with no automatic retries. Clinical decisions belong in the clinician-review workflow.</p><button type="button" class="daya-human-review">Open clinician review requests</button><button type="button" class="daya-open-usage">View AI usage & deployment</button>
      <label><input class="daya-complex-approval" type="checkbox"> I approve sending this generic task to external AI for this request.</label>
      <button type="button" class="daya-complex-run">Generate optional draft</button><p class="daya-complex-status" role="status"></p>
      </details>
      <form class="care-chatbot__form"><input type="text" maxlength="1500" aria-label="Ask Dhruv" placeholder="Type your question…" autocomplete="off"><button type="submit">Send</button></form>
      <div class="daya-tools"><button type="button" class="daya-mic" aria-pressed="false">◉ Speak</button><button type="button" class="care-chatbot__voice" aria-pressed="false">Voice: Off</button><button type="button" class="dhruv-slow" aria-pressed="false">Speak slowly</button><button type="button" class="daya-clear">Clear</button><span class="daya-help-status" role="status">English · text or voice</span></div></div></div></section>`;
    document.body.appendChild(root);
    if(matchMedia("(max-height: 650px)").matches)root.querySelector(".daya-topics").open=false;
    const panel=root.querySelector('section'),launcher=root.querySelector('.care-chatbot__launcher'),feed=root.querySelector('.care-chatbot__feed'),input=root.querySelector('.care-chatbot__form input'),mic=root.querySelector('.daya-mic'),voiceButton=root.querySelector('.care-chatbot__voice'),state=root.querySelector('.daya-state'),help=root.querySelector('.daya-help-status'),avatarHost=root.querySelector('.daya-avatar');
    const tr=(en,hi)=>language==='hi'?hi:en;
    let activeCategory='app';
    const preparedAudio=new Map(),preparingAudio=new Map();
    async function prepareAudio(text,requestedLanguage){
      const key=JSON.stringify([requestedLanguage,text]);
      if(preparedAudio.has(key))return preparedAudio.get(key);
      if(preparingAudio.has(key))return preparingAudio.get(key);
      const pending=(async()=>{
        const response=await fetch(new URL('api/tts',appBase).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,language:requestedLanguage}),signal:AbortSignal.timeout(35000)});
        if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||('Gemini voice unavailable: '+response.status));}
        if(response.headers.get('X-DAI-TTS-Provider')!=='gemini')throw new Error('The voice service did not return Gemini audio.');
        const blob=await response.blob();if(!/^audio\//i.test(blob.type)||!blob.size)throw new Error('No Gemini audio');
        const result={blob,voice:response.headers.get('X-DAI-TTS-Voice')||'Charon'};
        if(preparedAudio.size>=12)preparedAudio.delete(preparedAudio.keys().next().value);preparedAudio.set(key,result);return result;
      })();preparingAudio.set(key,pending);
      try{return await pending;}finally{preparingAudio.delete(key);}
    }
    function releaseAudio(){
      if(currentAudio){currentAudio.onplaying=null;currentAudio.onended=null;currentAudio.onerror=null;currentAudio.pause();currentAudio.removeAttribute('src');currentAudio.load();currentAudio=null;}
      if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}
    }
    function stop(){speechId++;speechAbort?.abort();speechAbort=null;releaseAudio();avatar?.setTalking(false);state.textContent=tr('Ready when you are','आपका प्रश्न सुनने को तैयार');}
    function stopListening(){if(recognition){recognition.abort();recognition=null;}mic.setAttribute('aria-pressed','false');mic.textContent=tr('◉ Speak','◉ बोलें');}
    async function speak(text){
      stop();if(!voice||!text)return;
      const id=speechId,requestedLanguage=language,controller=new AbortController();speechAbort=controller;
      let failed=false;
      const timeout=setTimeout(()=>controller.abort(),35000);
      state.textContent=tr('Preparing Gemini voice…','Gemini आवाज़ तैयार हो रही है…');
      const fail=(message)=>{
        if(failed||id!==speechId||!voice||!opened)return;
        failed=true;releaseAudio();avatar?.setTalking(false);
        state.textContent=tr('Gemini voice unavailable','Gemini आवाज़ उपलब्ध नहीं');
        help.textContent=tr('Gemini error · no substitute voice','Gemini त्रुटि · दूसरी आवाज़ नहीं');
        const errorBox=root.querySelector('.daya-voice-error');errorBox.hidden=false;
        errorBox.textContent=message||tr('Gemini could not play this reply. Your answer is still shown below.','Gemini यह जवाब नहीं सुना पाया। लिखित जवाब नीचे उपलब्ध है।');
      };
      const errorBox=root.querySelector('.daya-voice-error');errorBox.hidden=true;
      try{
        const prepared=await Promise.race([prepareAudio(text,requestedLanguage),new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new DOMException('Request stopped','AbortError')),{once:true});})]);
        if(id!==speechId||!voice||!opened)return;
        audioUrl=URL.createObjectURL(prepared.blob);const audio=new Audio(audioUrl);currentAudio=audio;
        audio.playbackRate=slow?.85:1;
        const voiceName=prepared.voice;
        help.textContent='Gemini · '+voiceName+' · '+(requestedLanguage==='hi'?'हिंदी':'English');
        audio.onplaying=()=>{if(id===speechId){avatar?.setTalking(true);state.textContent=tr('Speaking…','बोल रहा हूँ…');}};
        audio.onended=()=>{if(id===speechId){releaseAudio();avatar?.setTalking(false);state.textContent=tr('Ready when you are','आपका प्रश्न सुनने को तैयार');}};
        audio.onerror=()=>fail(tr('Gemini audio could not play. Click Voice off, then on to retry.','Gemini आवाज़ नहीं चल पाई। Voice बंद करके फिर चालू करें।'));await audio.play();
      }catch(error){fail(error.name==='AbortError'?tr('Gemini voice timed out. Please try again.','Gemini आवाज़ का समय समाप्त हुआ। फिर कोशिश करें।'):error.message);}
      finally{clearTimeout(timeout);if(speechAbort===controller)speechAbort=null;}
    }
    function navigateLink(target){
      const names={timeline:['Open Care Timeline','Care Timeline खोलें'],records:['Open Records','Records खोलें'],settings:['Open Settings','Settings खोलें'],appointments:['Open Appointments','Appointments खोलें'],postpartum:['Open Postpartum','Postpartum खोलें'],child:['Open Child workspace','Child workspace खोलें']};
      const a=el('a',{href:new URL(target==='child'?'child-dashboard.html':'dashboard.html',appBase).href},names[target]?tr(...names[target]):'Open workspace');
      if(target!=='child')a.addEventListener('click',event=>{
        const button=document.querySelector('[data-panel="'+target+'"]');
        if(button&&location.pathname.endsWith('/dashboard.html')){event.preventDefault();button.click();close();}
      });return a;
    }
    function message(who,text,result){
      const row=el('div',{class:'care-chatbot__message care-chatbot__message--'+who});
      if(who==='bot')row.appendChild(el('span',{class:'dhruv-reply-label'},tr('DHRUV · AI COMPANION','ध्रुव · AI साथी')));
      row.appendChild(el('p',{class:'dhruv-reply-text'},text));
      if(result){row.dataset.replyId=result.id;if(result.safety)row.dataset.safety='true';
        if(!result.safety&&(result.sources.length||result.navigation)){
          const links=el('div',{class:'daya-links'});
          if(result.navigation)links.appendChild(navigateLink(result.navigation));
          result.sources.forEach((source,i)=>{const u=new URL(source);if(u.protocol!=='https:')return;links.appendChild(el('a',{href:u.href,target:'_blank',rel:'noopener noreferrer'},tr('Official / clinical source','आधिकारिक / चिकित्सा स्रोत')+(result.sources.length>1?' '+(i+1):'')+' ↗'));});row.appendChild(links);
        }
      }
      if(who==='bot'&&result){row.appendChild(el('small',{class:'daya-route-label'},tr('Local prepared answer · no language-model request','स्थानीय तैयार जवाब · भाषा मॉडल को अनुरोध नहीं')));const actions=el('div',{class:'dhruv-reply-actions'});const replay=el('button',{type:'button'},tr('↻ Listen again','↻ फिर सुनें'));replay.addEventListener('click',()=>{voice=true;voiceButton.setAttribute('aria-pressed','true');voiceButton.textContent=tr('Voice: On','आवाज़: चालू');speak(text);});actions.appendChild(replay);row.appendChild(actions);}
      feed.appendChild(row);feed.scrollTop=feed.scrollHeight;
    }
    function intro(){message('bot',tr('Hello, I’m Dhruv, your AI care companion. I can explain your care journey and help you prepare questions. For medical decisions, talk to your real doctor. What’s on your mind?','नमस्ते, मैं ध्रुव हूँ, आपका AI care companion। मैं देखभाल के पड़ाव समझा सकता हूँ और डॉक्टर के लिए प्रश्न तैयार करने में मदद कर सकता हूँ। चिकित्सा के फ़ैसले आपके असली डॉक्टर करेंगे। आप क्या पूछना चाहेंगी?'));}
    function ask(text){
      const clean=String(text||'').trim().slice(0,1500);if(!clean)return;
      stopListening();message('user',clean);input.value='';
      const result=knowledge.respond(clean,language);lastReply=result.text;message('bot',result.text,result);speak(result.text);
    }
    function topics(){
      const categories=root.querySelector('.daya-categories');categories.replaceChildren();
      knowledge.categories.forEach(category=>{
        const button=el('button',{type:'button','aria-pressed':String(category.id===activeCategory)},category[language]);
        button.addEventListener('click',()=>{activeCategory=category.id;topics();});categories.appendChild(button);
      });
      const chips=root.querySelector('.care-chatbot__chips');chips.replaceChildren();
      knowledge.faqs.filter(q=>q.category===activeCategory).forEach(q=>{const button=el('button',{type:'button','data-question-id':q.id},q.question[language]);button.addEventListener('click',()=>ask(q.question[language]));chips.appendChild(button);});
    }
    function labels(){
      root.querySelector('.care-chatbot__notice').textContent=tr('No diagnosis or prescriptions. Voice sends the prepared answer to Google Gemini; private records are not read.','Diagnosis या prescription नहीं। आवाज़ के लिए तैयार जवाब Google Gemini को भेजा जाता है; निजी records नहीं पढ़े जाते।');
      input.placeholder=tr('Type your question…','अपना प्रश्न लिखें…');
      root.querySelector('form button').textContent=tr('Send','भेजें');
      root.querySelector('.daya-topics summary').textContent=tr('Explore questions','प्रश्न और विषय देखें');
      root.querySelector('.daya-clear').textContent=tr('Clear','साफ़ करें');
      voiceButton.textContent=tr('Voice: ','आवाज़: ')+(voice?tr('On','चालू'):tr('Off','बंद'));
      mic.textContent=tr('◉ Speak','◉ बोलें');
      help.textContent=tr('English · text or voice','हिंदी · लिखें या बोलें');
      root.querySelector('.daya-character h3').textContent=tr('Here with you.','आपके साथ, हर कदम।');
      root.querySelector('.care-chatbot__header small').textContent=tr('AI care companion','AI देखभाल साथी');
      root.querySelector('.dhruv-slow').textContent=tr('Speak slowly','धीरे बोलें');
      root.querySelector('.daya-character p').textContent=tr('I explain and guide. Your real doctor makes the medical decisions.','मैं समझाता हूँ और रास्ता दिखाता हूँ। चिकित्सा के फ़ैसले आपके असली डॉक्टर करेंगे।');
      topics();
    }
    async function loadAvatar(){
      if(avatarPromise)return avatarPromise;
      const status=avatarHost.querySelector('.daya-avatar-status');
      if(localStorage.getItem('dai-low-bandwidth')==='true')return Promise.resolve(null);
      avatarPromise=import(asset('js/daya-avatar.mjs')).then(module=>module.createAvatar(avatarHost,base)).then(instance=>{
        avatar=instance;avatar.setVisible(opened);status.hidden=true;if(currentAudio&&!currentAudio.paused)avatar.setTalking(true);
      }).catch(error=>{console.warn('Dhruv 3D preview unavailable:',error);status.textContent=tr('3D view unavailable. Chat and voice still work.','3D उपलब्ध नहीं। चैट और आवाज़ इस्तेमाल करें।');});
      return avatarPromise;
    }
    function open(){const journey=root.querySelector('.dhruv-journey'),stageLabel=document.getElementById('patientStage')?.textContent;journey.hidden=!stageLabel;journey.textContent=stageLabel||'';opened=true;panel.hidden=false;launcher.hidden=true;launcher.setAttribute('aria-expanded','true');avatar?.setVisible(true);if(!feed.children.length)intro();loadAvatar();input.focus();}
    function close(){opened=false;panel.hidden=true;launcher.hidden=false;launcher.setAttribute('aria-expanded','false');stop();stopListening();avatar?.setVisible(false);launcher.focus();}
    launcher.addEventListener('click',open);root.querySelector('.care-chatbot__close').addEventListener('click',close);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
    root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
    root.querySelector('.daya-header-actions select').addEventListener('change',event=>{stopListening();language=event.target.value;stop();lastReply='';labels();intro();});
    voiceButton.addEventListener('click',()=>{voice=!voice;voiceButton.setAttribute('aria-pressed',String(voice));labels();if(voice&&lastReply)speak(lastReply);else stop();});
    root.querySelector('.dhruv-slow').addEventListener('click',event=>{slow=!slow;event.currentTarget.setAttribute('aria-pressed',String(slow));if(currentAudio)currentAudio.playbackRate=slow?.85:1;});
    root.querySelector('.daya-clear').addEventListener('click',()=>{stop();stopListening();feed.replaceChildren();lastReply='';intro();input.focus();});
    let complexBusy=false,directoryBusy=false;
    const approval=root.querySelector('.daya-complex-approval');
    root.querySelector('.daya-open-usage').onclick=()=>{close();if(window.DaiAIUsage)window.DaiAIUsage.open();else location.href='/dashboard.html#settings';};
    root.querySelector('.daya-human-review').onclick=()=>{const isDoctor=location.pathname.endsWith('/doctor.html'),target=document.querySelector(isDoctor?'[data-panel=dashboard]':'[data-panel=timeline]');if(target)target.click();else if(!isDoctor)location.href='/dashboard.html#timeline';close();requestAnimationFrame(()=>document.querySelector('.clinical-review-panel')?.scrollIntoView({block:'start'}));};
    root.querySelector('.daya-complex-task').addEventListener('change',()=>{approval.checked=false;});
    root.querySelector('.daya-header-actions select').addEventListener('change',()=>{approval.checked=false;});
    root.querySelector('.daya-directory').addEventListener('click',async()=>{
      if(directoryBusy)return;directoryBusy=true;const status=root.querySelector('.daya-directory-status');status.textContent='Loading public metadata…';
      try{const r=await fetch(new URL('api/public/facility-metadata',appBase),{credentials:'omit',cache:'no-store'});if(!r.ok)throw Error('Directory unavailable');const d=await r.json();
        status.textContent=d.facilities.slice(0,12).map(f=>f.name+' — '+f.city).join('; ')+'. Public metadata fetched '+d.fetched_at+'. Up to 60 seconds of server reuse. Services and slots require live search.';
      }catch{status.textContent='Public directory unavailable. Use Nearby care to search.';}finally{directoryBusy=false;}
    });
    root.querySelector('.daya-complex-run').addEventListener('click',async event=>{
      const status=root.querySelector('.daya-complex-status');if(complexBusy)return;
      if(!approval.checked){status.textContent='Approve this external task first. Nothing was sent.';return;}
      const task=root.querySelector('.daya-complex-task').value,requestedLanguage=language;
      approval.checked=false;complexBusy=true;event.currentTarget.disabled=true;status.textContent='Generating a general draft…';
      try{const r=await fetch(new URL('api/assistance/complex',appBase),{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({task,language:requestedLanguage,approved:true})});
        const d=await r.json();if(!r.ok)throw Error(d.error||'Draft unavailable');message('bot',d.notice+'\n\n'+d.text);window.dispatchEvent(new Event('dai-ai-usage-updated'));if(d.usage?.recorded===false)message('bot','The draft was returned, but usage metadata could not be recorded. Usage totals may be incomplete.');root.querySelector('.daya-routing').open=false;requestAnimationFrame(()=>{feed.scrollTop=feed.scrollHeight;});status.textContent='External AI draft · not cached · check before use.';
      }catch(error){status.textContent=error.message||'Draft unavailable. Local FAQs still work.';}finally{complexBusy=false;root.querySelector('.daya-complex-run').disabled=false;}
    });
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){mic.disabled=true;mic.title='Speech recognition is not supported in this browser. You can type instead.';}
    mic.addEventListener('click',()=>{
      if(recognition){stopListening();return;}
      stop();const r=new Recognition();recognition=r;r.lang=language==='hi'?'hi-IN':'en-IN';r.interimResults=false;r.continuous=false;
      // Browser handles the permission prompt. Audio may be processed by its provider.
      help.textContent=tr('Browser speech service may process audio','ब्राउज़र की speech service आवाज़ प्रोसेस कर सकती है');
      r.onstart=()=>{mic.setAttribute('aria-pressed','true');mic.textContent=tr('■ Stop','■ रोकें');state.textContent=tr('Listening…','सुन रहा हूँ…');};
      r.onresult=event=>{if(recognition!==r||!opened)return;const text=event.results[0][0].transcript;recognition=null;ask(text);};
      r.onerror=event=>{if(recognition!==r)return;help.textContent=event.error==='not-allowed'?tr('Microphone permission denied. Type instead.','माइक्रोफ़ोन अनुमति नहीं मिली। टाइप करें।'):tr('Could not hear you. Please type or try again.','आवाज़ नहीं समझ पाया। लिखें या फिर बोलें।');};
      r.onend=()=>{if(recognition===r)recognition=null;mic.setAttribute('aria-pressed','false');mic.textContent=tr('◉ Speak','◉ बोलें');if(!currentAudio&&!speechAbort)state.textContent=tr('Ready when you are','आपका प्रश्न सुनने को तैयार');};
      try{r.start();}catch{recognition=null;help.textContent=tr('Microphone unavailable. Type instead.','माइक्रोफ़ोन उपलब्ध नहीं। टाइप करें।');}
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();stopListening();}});
    window.addEventListener('pagehide',event=>{stop();stopListening();if(event.persisted)avatar?.setVisible(false);else avatar?.dispose();});
    window.addEventListener('pageshow',event=>{if(event.persisted)avatar?.setVisible(opened);});
    labels();
    if(['#dr-daya','#dhruv'].includes(location.hash))open();
  }
  if(window.DaiDayaKnowledge)boot();else{
    const knowledge=document.createElement('script');knowledge.src=asset('js/daya-knowledge.js?v=dhruv-ui-1');knowledge.onload=boot;knowledge.onerror=()=>{window.daiDayaLoading=false;console.error('Dhruv questions could not load.');};document.head.appendChild(knowledge);
  }
})();
