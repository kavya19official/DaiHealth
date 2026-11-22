/* Sukoon public prototype content and deterministic rules. No diagnosis or emotion inference. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SukoonModel=factory();})(typeof window==='undefined'?globalThis:window,function(){'use strict';
const items = [
  ['I have been able to laugh and see the funny side of things', ['As much as I always could', 'Not quite so much now', 'Definitely not so much now', 'Not at all']],
  ['I have looked forward with enjoyment to things', ['As much as I ever did', 'Rather less than I used to', 'Definitely less than I used to', 'Hardly at all']],
  ['I have blamed myself unnecessarily when things went wrong', ['Yes, most of the time', 'Yes, some of the time', 'Not very often', 'No, never']],
  ['I have been anxious or worried for no good reason', ['No, not at all', 'Hardly ever', 'Yes, sometimes', 'Yes, very often']],
  ['I have felt scared or panicky for no very good reason', ['Yes, quite a lot', 'Yes, sometimes', 'No, not much', 'No, not at all']],
  ['Things have been getting on top of me', ['Yes, most of the time I haven’t been able to cope at all', 'Yes, sometimes I haven’t been coping as well as usual', 'No, most of the time I have coped quite well', 'No, I have been coping as well as ever']],
  ['I have been so unhappy that I have had difficulty sleeping', ['Yes, most of the time', 'Yes, sometimes', 'Not very often', 'No, not at all']],
  ['I have felt sad or miserable', ['Yes, most of the time', 'Yes, quite often', 'Not very often', 'No, not at all']],
  ['I have been so unhappy that I have been crying', ['Yes, most of the time', 'Yes, quite often', 'Only occasionally', 'No, never']],
  ['The thought of harming myself has occurred to me', ['Yes, quite often', 'Sometimes', 'Hardly ever', 'Never']]
];
const reverse = new Set([2, 4, 5, 6, 7, 8, 9]);
const priority = (score, itemTen) => itemTen > 0 ? 'urgent' : score >= 13 ? 'follow_up' : 'routine';

function scoreEPDS(answers) {
  if (!Array.isArray(answers) || answers.length !== 10 ||
      !Array.from(answers).every(value => Number.isInteger(value) && value >= 0 && value <= 3)) return null;
  const scores = answers.map((value, index) => reverse.has(index) ? 3 - value : value);
  return { score: scores.reduce((sum, value) => sum + value, 0), itemTen: scores[9] };
}
 const weather=[{id:'storm',en:'Very heavy',hi:'बहुत भारी',icon:'☂',reply:['Thank you for telling me. You deserve support and a little room to rest.','बताने के लिए धन्यवाद। आपको सहारा और आराम की जगह मिलनी चाहिए।']},{id:'rain',en:'Heavy',hi:'भारी',icon:'☔',reply:['That sounds like a lot to carry. One small offer of help can be a place to start.','यह बहुत कुछ सँभालने जैसा है। थोड़ी मदद माँगकर शुरुआत कर सकती हैं।']},{id:'cloud',en:'In between',hi:'मिला-जुला',icon:'☁',reply:['There is room for mixed days here. You do not have to explain everything.','मिले-जुले दिनों के लिए भी यहाँ जगह है। सब कुछ समझाना ज़रूरी नहीं।']},{id:'haze',en:'A little lighter',hi:'थोड़ा हल्का',icon:'◒',reply:['A little lighter is enough for today. You can still ask for help.','आज थोड़ा हल्का लगना भी ठीक है। आप फिर भी मदद माँग सकती हैं।']},{id:'clear',en:'Light',hi:'हल्का',icon:'☀',reply:['Thank you for checking in. There is space for every kind of day.','बताने के लिए धन्यवाद। हर तरह के दिन के लिए यहाँ जगह है।']}];
 const grounding=[
 ['Let this be a small pause. You can keep your eyes open and stay seated however is comfortable. If you are caring for your baby, keep doing what your baby needs. There is nothing to finish or get right. Notice where your body is supported.','यह एक छोटा विराम है। आँखें खुली रख सकती हैं और जैसे आराम हो वैसे बैठ सकती हैं। शिशु की देखभाल करते समय उसकी ज़रूरतें पहले रखें। यहाँ कुछ पूरा करना या सही करना ज़रूरी नहीं। ध्यान दें कि आपके शरीर को कहाँ सहारा मिल रहा है।'],
 ['Notice one ordinary thing you can see. It might be a corner of the room, a soft colour or a familiar object. You do not need to search for anything special. If this does not feel helpful, you can stop and choose something else.','आसपास की एक साधारण चीज़ देखें। कमरे का कोना, कोई रंग या परिचित चीज़ हो सकती है। किसी खास चीज़ की तलाश ज़रूरी नहीं। अगर यह मददगार न लगे तो रोक सकती हैं।'],
 ['Notice a sound near you, then one a little further away. You can let the sounds come and go. There is no need to become calm on command. Whatever you are carrying today, you can ask another person to sit with you.','पास की एक आवाज़ सुनें, फिर थोड़ी दूर की। आवाज़ों को आने-जाने दें। कहने भर से शांत होना ज़रूरी नहीं। आज जो भी भारी लग रहा हो, किसी अपने से साथ बैठने को कह सकती हैं।'],
 ['If it feels comfortable, notice your breathing without changing it. There is no need to hold your breath or follow a fixed pace. If you feel uncomfortable or dizzy, stop this exercise. You can look around the room and return to an ordinary activity.','आराम लगे तो साँस पर ध्यान दें, उसे बदलने की ज़रूरत नहीं। साँस रोकना या तय गति अपनाना ज़रूरी नहीं। असहज लगने या चक्कर आने पर अभ्यास रोक दें। कमरे में देखें और सामान्य काम पर लौट सकती हैं।'],
 ['This pause is nearly over. Choose one practical thing that could help next: a drink nearby, a comfortable seat, or someone taking a household task. You can also choose nothing for now. Support is something you deserve, on lighter days and heavier ones.','यह विराम अब पूरा होने वाला है। अगला छोटा सहारा चुन सकती हैं: पास में पानी, आराम से बैठना या किसी का घर का एक काम सँभालना। अभी कुछ न चुनना भी ठीक है। हल्के और भारी, दोनों तरह के दिनों में आप सहारे की हकदार हैं।']
 ];
 const stories=[
 {title:['One task at a time','एक बार में एक काम'],text:['An illustrative story, not a real mother’s recording. On a long night, a mother asked a trusted person to bring water and settle the room. The night was still tiring. She did not have to arrange every small thing alone.','यह एक उदाहरण कहानी है, किसी माँ की वास्तविक रिकॉर्डिंग नहीं। लंबी रात में एक माँ ने अपने भरोसेमंद व्यक्ति से पानी लाने और कमरा सँभालने को कहा। रात फिर भी थकाने वाली थी। मगर हर छोटा काम अकेले सँभालना नहीं पड़ा।']},
 {title:['Words that make room','जगह देने वाले शब्द'],text:['An illustrative story, not a real mother’s recording. Someone asked, what would help tonight, instead of giving advice. The answer was simple: sit beside me for a while. Listening was a task worth sharing too.','यह एक उदाहरण कहानी है, किसी माँ की वास्तविक रिकॉर्डिंग नहीं। सलाह देने के बजाय किसी ने पूछा: आज रात क्या मदद करेगा? जवाब था: थोड़ी देर मेरे पास बैठिए। सुनना भी साथ निभाने का एक काम था।']}
 ];
 const duties={feed:['Feed support','दूध पिलाने में सहारा'],diaper:['Diaper change','डायपर बदलना'],meal:['Food & water','खाना और पानी'],settle:['Settling baby','शिशु को सँभालना'],home:['Household task','घर का काम']};
 function today(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(now);}
 function windowDays(end,offset=0){const value=new Date(end+'T12:00:00Z');value.setUTCDate(value.getUTCDate()-offset*7);return Array.from({length:7},(_,i)=>{const day=new Date(value);day.setUTCDate(day.getUTCDate()-6+i);return day.toISOString().slice(0,10);});}
 function weekly(entries,end,offset=0){return windowDays(end,offset).map(date=>({date,entry:entries.find(e=>e.date===date)||null}));}
 function needsSupport(entries,end){return weekly(entries,end).filter(day=>day.entry&&['storm','rain'].includes(day.entry.weather)).length>=3;}
 function invitations(deliveryDate,checkins=[],now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate||''))return [];
  const days=Math.floor((Date.parse(today(now))-Date.parse(deliveryDate))/86400000);if(!Number.isFinite(days)||days<0)return [];
  const latest=[14,42,90].filter(day=>days>=day).at(-1);
  return latest&&!checkins.some(c=>(Date.parse(c.date)-Date.parse(deliveryDate))/86400000>=latest-7)?[latest]:[];
 }
 function urgentDisclosure(text){return /(?:hurt|harm|kill)\s+(?:myself|me|my\s*(?:baby|child))|suicid|end\s+my\s+life|खुद.*(?:नुकसान|मार)|(?:बच्चे|शिशु).*(?:नुकसान|मार)|आत्महत्या|(?:I am|I feel) (?:severely|very) confused|(?:seeing|hearing) things (?:that )?others (?:do not|don't)|I (?:have not|haven't) slept for (?:several|many|three|four|five|[3-9]) days|कई दिनों से नींद नहीं/i.test(String(text||''));}
 return {items,scoreEPDS,priority,weather,grounding,stories,duties,today,weekly,needsSupport,invitations,urgentDisclosure,narrations:lang=>[...grounding.map(s=>s[lang==='hi'?1:0]),...stories.map(s=>s.text[lang==='hi'?1:0])],fresh:()=>({version:1,entries:[],letters:[],checkins:[],duties:[],contacts:{},preferences:{}})};
});
