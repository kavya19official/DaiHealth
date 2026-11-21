/* Legacy Didi engine integrated into Dhruv's simple conversation; no automatic saves. */
(function(){
 'use strict';
 function connect(){
  const chat=window.DhruvCompanion,engine=window.DaiDidi;if(!chat||!engine||chat.root.dataset.careGuide)return;chat.root.dataset.careGuide='ready';
  let state=null,last=null;const reset=()=>{state=null;last=null;};
  chat.registerGuide({reset,handle(text,options={}){
   const ex=engine.extract(text),recognized=ex.codes.length||Object.keys(ex.soft).length||ex.bp||ex.crisis;
   if(options.faq&&!recognized)return false;if(!recognized&&!last?.question)return false;
   const context=window.CareExt?.currentContext?.()==='postpartum'?'postpartum':'pregnant',week=window.CareExt?.gestWeeks?.();
   const result=engine.processTurn(state||engine.newState({context,gestWeeks:Number.isFinite(week)&&context==='pregnant'?week:null}),text.slice(0,500),{langHint:chat.language()});
   state=result.state;state.transcript=state.transcript.slice(-24);last=result;
   const textReply=result.fragments.filter(part=>part!==engine.tpl(result.language,'saved_ask')).join('\n')||engine.tpl(result.language,'unsure_head');
   chat.reply(textReply,{spokenLanguage:result.language==='en'?'en':'hi',pauseConversation:result.evaluation.level==='emergency'});
   if(result.actions.openEmergencyFlow){
    const row=document.createElement('div');row.className='dhruv-sos-help';
    for(const number of result.actions.numbers||[]){const a=document.createElement('a');a.href='tel:'+String(number.number).replace(/[^\d+]/g,'');a.textContent=(chat.language()==='hi'?'कॉल ':'Call ')+number.number;row.appendChild(a);}
    if(window.CareExt?.openSOS){const button=document.createElement('button');button.type='button';button.textContent=chat.language()==='hi'?'SOS खोलें':'Open SOS';button.onclick=()=>window.CareExt.openSOS(result.actions.emergencyPreset);row.appendChild(button);}
    chat.feed.appendChild(row);chat.feed.scrollTop=chat.feed.scrollHeight;
   }
   return true;
  }});
  window.DaiDidiUI={open:chat.open,close:chat.close,say:text=>{chat.open();chat.ask(text);}};
 }
 window.addEventListener('dhruv:ready',connect);connect();
})();
