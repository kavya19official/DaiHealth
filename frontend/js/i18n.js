/**
 * English / Hindi i18n for DaiHealth patient UI.
 * Strings marked for clinical review should be verified by a clinician before production.
 */
(function (global) {
  'use strict';

  var STRINGS = {
    en: {
      'nav.dashboard': 'Dashboard',
      'nav.profile': 'Mother / Patient',
      'nav.child': 'Child',
      'nav.appointments': 'Appointments',
      'nav.timeline': 'Care Timeline',
      'nav.records': 'Records',
      'nav.messages': 'Messages',
      'nav.settings': 'Settings',
      'settings.title': 'Settings',
      'settings.lang': 'Language',
      'settings.notif': 'Notification preferences',
      'settings.privacy': 'Privacy controls',
      'settings.save': 'Save settings',
      'settings.logout': 'Log out',
      'settings.saved': 'Settings saved',
      'notif.appt': 'Appointment reminders',
      'notif.vax': 'Vaccination due / missed',
      'notif.growth': 'Growth alerts',
      'notif.care': 'Care timeline gaps',
      'notif.sms': 'SMS alerts',
      'privacy.share_doctors': 'Share records with linked doctors',
      'privacy.analytics': 'Allow anonymous product analytics',
      'form.required': 'This field is required',
      'form.invalid_email': 'Enter a valid email address',
      'form.invalid_phone': 'Enter a valid 10-digit mobile number',
      'a11y.menu': 'Open navigation menu',
      'a11y.close': 'Close navigation menu',
      'a11y.skip': 'Skip to main content',
      'search.placeholder': 'Search anything...'
    },
    hi: {
      'nav.dashboard': 'डैशबोर्ड',
      'nav.profile': 'माँ / रोगी',
      'nav.child': 'बच्चा',
      'nav.appointments': 'अपॉइंटमेंट',
      'nav.timeline': 'देखभाल समयरेखा',
      'nav.records': 'रिकॉर्ड',
      'nav.messages': 'संदेश',
      'nav.settings': 'सेटिंग्स',
      'settings.title': 'सेटिंग्स',
      'settings.lang': 'भाषा',
      'settings.notif': 'सूचना प्राथमिकताएँ',
      'settings.privacy': 'गोपनीयता नियंत्रण',
      'settings.save': 'सेटिंग्स सहेजें',
      'settings.logout': 'लॉग आउट',
      'settings.saved': 'सेटिंग्स सहेजी गईं',
      'notif.appt': 'अपॉइंटमेंट अनुस्मारक',
      'notif.vax': 'टीकाकरण देय / छूटा',
      'notif.growth': 'वृद्धि अलर्ट',
      'notif.care': 'देखभाल समयरेखा अंतर',
      'notif.sms': 'SMS अलर्ट',
      'privacy.share_doctors': 'लिंक किए गए डॉक्टरों के साथ रिकॉर्ड साझा करें',
      'privacy.analytics': 'अनाम उत्पाद विश्लेषण की अनुमति दें',
      'form.required': 'यह फ़ील्ड आवश्यक है',
      'form.invalid_email': 'मान्य ईमेल पता दर्ज करें',
      'form.invalid_phone': 'मान्य 10 अंकों का मोबाइल नंबर दर्ज करें',
      'a11y.menu': 'नेविगेशन मेनू खोलें',
      'a11y.close': 'नेविगेशन मेनू बंद करें',
      'a11y.skip': 'मुख्य सामग्री पर जाएँ',
      'search.placeholder': 'कुछ भी खोजें...'
    }
  };

  var KEY = 'dai_lang';
  var dictionaries = {}, aliases = {}, source = null, pending = {}, languageVersion = 0;
  var records = new WeakMap(), attributeRecords = new WeakMap(), queued = new Set(), timer = null, observer = null;
  var script = document.currentScript;
  var localeBase = new URL('../locales/', script ? script.src : location.href);
  var names = { en:'English', hi:'हिन्दी', mr:'मराठी' };
  var excluded = 'script,style,noscript,textarea,pre,code,kbd,[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-no-i18n],.notranslate,.care-chatbot__message--user,.cm-message p';
  var nameSelectors = '#userName,.user-chip__name,.user-chip .user-name,.dw-patient-name strong,.dp-person-name strong,.dp-person-top>div>strong,.dpp-header h2,.wb-table-scroll td:first-child strong,[data-patient-name],[data-person-name],[data-localize-name],.cm-contact-top strong,.cm-contact-copy>strong,[data-cm-chat-name],.facility-label strong,.facility-card h3,.leaflet-popup-content>div>strong,[data-demo-results] h3,[data-demo-results] li>strong';
  var initialsSelectors = '.patient-initials,.dw-avatar,#dwDoctorInitials,.dd-avatar,.cm-avatar,[data-cm-chat-initials]';
  var nameLoading;
  function loadNames() {
    if(global.DaiNames)return Promise.resolve();
    if(!nameLoading)nameLoading=new Promise(function(resolve,reject){var tag=document.createElement('script');tag.src=new URL('../shared/name-localization.js?v=names-1',script?script.src:location.href).href;tag.onload=resolve;tag.onerror=function(){tag.remove();nameLoading=null;reject(Error('Name display unavailable'));};document.head.appendChild(tag);});
    return nameLoading;
  }
  function nameFragments(value,code) {
    if(!global.DaiNames||code==='en')return value;
    return value.replace(/[A-Za-zÀ-ž]+(?:['’][A-Za-zÀ-ž]+)?(?:[ .-]+[A-Za-zÀ-ž]+(?:['’][A-Za-zÀ-ž]+)?)*\.?/g,function(part){return global.DaiNames.looksLikeName(part)?global.DaiNames.localize(part,code):part;});
  }
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function cookieLanguage() { var m=document.cookie.match(/(?:^|; )dai_lang=(en|hi|mr)(?:;|$)/);return m ? m[1] : null; }
  var explicit = cookieLanguage() || storageGet(KEY);
  var lang = names[explicit] ? explicit : 'en';
  var notifiedLang = lang;
  function normalize(value) { return String(value || '').replace(/\s+/g,' ').trim(); }
  function canonical(value) { var n=normalize(value);if(aliases[n])return aliases[n];if(/[\u0900-\u097f]/.test(n)){for(var i=0;i<reversePatterns.length;i++){var p=reversePatterns[i],m=n.match(p.re);if(m){var result=p.en;p.tokens.forEach(function(token,index){result=result.split(token).join(m[index+1]);});return result;}}}return n; }
  function preserveSpace(original, translated) { var m=original.match(/^(\s*)([\s\S]*?)(\s*)$/);return m[1]+translated+m[3]; }
  var patterns = [], reversePatterns = [], fragments = [], memo = new Map(), caseKeys = {}, dateMaps = {};
  function prepare() {
    memo.clear();caseKeys={};(source&&source.entries||[]).forEach(function(en){caseKeys[en.toLowerCase()]=en;});
    aliases = Object.assign({},source && source.aliases || {});
    Object.keys(dictionaries).forEach(function(code){Object.keys(dictionaries[code].phrases||{}).forEach(function(en){var value=normalize(dictionaries[code].phrases[en]);if(value && value!==en && !aliases[value])aliases[value]=en;});});
    Object.keys(STRINGS).forEach(function(code){Object.keys(STRINGS[code]).forEach(function(key){if(STRINGS.en[key]&&STRINGS[code][key]!==STRINGS.en[key])aliases[normalize(STRINGS[code][key])]=STRINGS.en[key];});});
    reversePatterns=[];
    function reverse(en,localized) { if(!/\{\{\d+\}\}/.test(localized))return;var tokens=[],re=localized.split(/(\{\{\d+\}\})/g).map(function(part){if(/^\{\{\d+\}\}$/.test(part)){tokens.push(part);return '(.{1,240}?)';}return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');try{reversePatterns.push({en:en,tokens:tokens,re:new RegExp('^'+re+'$')});}catch(_){} }
    Object.keys(dictionaries).forEach(function(code){Object.keys(dictionaries[code].phrases||{}).forEach(function(en){reverse(en,dictionaries[code].phrases[en]);});});
    Object.keys(source&&source.aliases||{}).forEach(function(localized){reverse(source.aliases[localized],localized);});
    patterns=[];
    (source && source.entries || []).forEach(function(en){if(!/\{\{\d+\}\}/.test(en))return;var tokens=[],parts=en.split(/(\{\{\d+\}\})/g);var pattern=parts.map(function(part){if(/^\{\{\d+\}\}$/.test(part)){tokens.push(part);return '(.{1,240}?)';}return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');try{patterns.push({en:en,re:new RegExp('^'+pattern+'$'),tokens:tokens});}catch(_){}});
    var specificity=function(p){return p.en.replace(/\{\{\d+\}\}/g,'').length;};patterns.sort(function(a,b){return specificity(b)-specificity(a);});reversePatterns.sort(function(a,b){return b.re.source.length-a.re.source.length;});
    // Match source-code sentence fragments around dynamic numbers and names.
    // Longest phrases win; no page text is ever sent to a translation provider.
    fragments=Object.keys(dictionaries[lang] && dictionaries[lang].phrases || {}).filter(function(en){return en.length>=5 && /[A-Za-z]/.test(en) && !/\{\{|[\[\]{}<>]/.test(en);}).sort(function(a,b){return b.length-a.length;});
  }
  function localizeDates(text,code) {
    if(code==='en'||!names[code])return text;
    var months='January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec';
    if(!new RegExp('(?:\\b\\d{1,2}\\s+(?:'+months.split(' ').join('|')+')\\b|\\b(?:'+months.split(' ').join('|')+')\\s+\\d{1,4}\\b)','i').test(text))return text;
    if(!dateMaps[code]){var map={};for(var m=0;m<12;m++)for(var width of ['long','short']){var d=new Date(Date.UTC(2024,m,15)),en=new Intl.DateTimeFormat('en-IN',{month:width,timeZone:'UTC'}).format(d),out=new Intl.DateTimeFormat(code+'-IN',{month:width,timeZone:'UTC'}).format(d);map[en.toLowerCase()]=out;}map.sep=map.sept;dateMaps[code]=map;}
    return text.replace(new RegExp('\\b('+months.split(' ').join('|')+')\\b','gi'),function(m){return dateMaps[code][m.toLowerCase()]||m;});
  }
  function translateRaw(value, code) {
    code=code||lang;var original=String(value == null ? '' : value),key=canonical(original),dict=dictionaries[code] && dictionaries[code].phrases || {};
    if(code==='en')return preserveSpace(original,key);
    if(dict[key])return preserveSpace(original,dict[key]);
    if(caseKeys[key.toLowerCase()]&&dict[caseKeys[key.toLowerCase()]])return preserveSpace(original,dict[caseKeys[key.toLowerCase()]]);
    var clean=key.replace(/^([•·↗→←↓↑♡✦✧+−—–:()\s]+)|([:：. …↗→←↓↑()\s]+)$/g,'');
    if(clean!==key && dict[clean])return preserveSpace(original,key.replace(clean,dict[clean]));
    for(var i=0;i<patterns.length;i++){var p=patterns[i],match=key.match(p.re);if(match&&dict[p.en]){var result=dict[p.en];p.tokens.forEach(function(token,n){result=result.split(token).join(match[n+1]);});return preserveSpace(original,result);}}
    // Only known source phrases may be substituted. Unknown text stays unchanged.
    // Display names are transliterated separately; saved records remain unchanged.
    if(code===lang && key.length<2600){
      var replacements=[],available=key;
      for(var j=0;j<fragments.length;j++){var phrase=fragments[j],at=available.toLowerCase().indexOf(phrase.toLowerCase());if(at<0)continue;var before=at?available[at-1]:'',after=available[at+phrase.length]||'';if(/[A-Za-z]/.test(before)||/[A-Za-z]/.test(after))continue;if(phrase.split(/\s+/).length<2 && phrase.length<8)continue;var token='\u0001'+replacements.length+'\u0002';replacements.push(dict[phrase]);available=available.slice(0,at)+token+available.slice(at+phrase.length);if(!/[A-Za-z]{2}/.test(available))break;}
      if(replacements.length){available=available.replace(/\u0001(\d+)\u0002/g,function(_,n){return replacements[Number(n)];});return localizeDates(preserveSpace(original,available),code);}
    }
    return localizeDates(original,code);
  }
  function translate(value,code) { var key=(code||lang)+'|'+String(value);if(memo.has(key))return memo.get(key);var selected=code||lang;var result=nameFragments(translateRaw(value,code),selected);if(memo.size>8000)memo.clear();memo.set(key,result);return result; }
  function t(key) { var en=STRINGS.en[key] || source && source.legacy && source.legacy[key];if(en)return translate(en);return STRINGS[lang] && STRINGS[lang][key] || key; }
  async function readCatalogue(file) {
    var url=new URL(file+'?v=20261124-3',localeBase).href,response;
    try { response=await fetch(url,{credentials:'same-origin',cache:'no-cache'});if(!response.ok)throw Error('Catalogue unavailable');var data=await response.json();try{var c=await caches.open('dai-public-ui-locales-v2');await c.put(url,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));}catch(_){}return data; }
    catch(error){try{var cached=await caches.match(url);if(cached)return await cached.json();}catch(_){}throw error;}
  }
  async function load(code) {
    if(code==='en' && !source)return;
    if(!names[code] || code==='en'){prepare();return;}
    if(!pending[code])pending[code]=Promise.all([source?Promise.resolve(source):readCatalogue('source.json'),dictionaries[code]?Promise.resolve(dictionaries[code]):readCatalogue(code+'.json'),loadNames()]).then(function(values){source=values[0];dictionaries[code]=values[1];prepare();}).catch(function(e){delete pending[code];throw e;});
    return pending[code];
  }
  function isExcluded(node) { if(node.nodeType===3&&/^[A-Z]{2,}[-:][A-Z0-9_:/-]*\d[A-Z0-9_:/-]*$/.test(node.data.trim()))return true;var el=node.nodeType===1?node:node.parentElement;return !el||Boolean(el.closest(excluded))||Boolean(el.closest('[data-dai-language],#patientLanguage,#setLang')); }
  function textNode(node) {
    if(isExcluded(node)||!normalize(node.data)||!/[A-Za-z\u0900-\u097f]/.test(node.data))return;
    var entry=records.get(node),value=node.data,isName=Boolean(node.parentElement.closest(nameSelectors)),isInitials=Boolean(node.parentElement.closest(initialsSelectors));
    if(!entry||value!==entry.last)entry={original:isName||isInitials?normalize(value):canonical(value),space:value,last:value};
    var out=(isName||isInitials)&&global.DaiNames?global.DaiNames.localize(entry.original,lang,{initials:isInitials}):translate(entry.original);out=preserveSpace(entry.space,out.trim());
    if(value!==out)node.data=out;
    entry.last=out;records.set(node,entry);
  }
  function attributes(el) {
    if(isExcluded(el))return;
    var states=attributeRecords.get(el)||{};
    ['placeholder','title','aria-label','alt'].forEach(function(name){if(!el.hasAttribute(name))return;var value=el.getAttribute(name),entry=states[name];if(!entry||value!==entry.last)entry={original:canonical(value),last:value};var next=translate(entry.original);if(value!==next)el.setAttribute(name,next);entry.last=next;states[name]=entry;});
    attributeRecords.set(el,states);
  }
  function visit(root) {
    if(!root || root.nodeType===3){if(root)textNode(root);return;}
    if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
    if(root.nodeType===1&&isExcluded(root))return;
    if(root.nodeType===1)attributes(root);
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:function(n){if(isExcluded(n))return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT;}}),node;
    while((node=walker.nextNode())){if(node.nodeType===3)textNode(node);else attributes(node);}
  }
  function applyDom() {
    if(!document.body)return;
    document.querySelectorAll('[data-i18n]').forEach(function(el){var key=el.getAttribute('data-i18n'),value=t(key);if(key&&value!==key&&!el.children.length&&el.textContent!==value)el.textContent=value;});
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el){el.setAttribute('aria-label',t(el.getAttribute('data-i18n-aria')));});
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){el.setAttribute('placeholder',t(el.getAttribute('data-i18n-placeholder')));});
    visit(document.body);var title=document.head.querySelector('title');if(title)visit(title);syncSelectors();
  }
  function schedule(node) { queued.add(node);if(timer)return;timer=setTimeout(function(){timer=null;var work=Array.from(queued);queued.clear();work.forEach(visit);installSelector();},24); }
  function syncSelectors() {
    document.querySelectorAll('[data-dai-language],#patientLanguage,#setLang').forEach(function(el){Object.keys(names).forEach(function(code){var option=Array.from(el.options||[]).find(function(o){return o.value===code;});if(!option){option=document.createElement('option');option.value=code;el.appendChild(option);}if(option.textContent!==names[code])option.textContent=names[code];});if(el.value!==lang)el.value=lang;});
  }
  function hasPreference(){return Boolean(cookieLanguage()||storageGet(KEY));}
  async function setLang(next,options) {
    if(!names[next]&&!STRINGS[next])return;
    var changed=lang!==next,version=++languageVersion;lang=next;document.documentElement.lang=lang;
    if(!options||options.persist!==false){try{localStorage.setItem(KEY,lang);}catch(_){}try{document.cookie='dai_lang='+lang+'; Path=/; Max-Age=31536000; SameSite=Lax';}catch(_){} }
    syncSelectors();
    try { await load(lang);if(version!==languageVersion)return;prepare();applyDom();if(notifiedLang!==lang){notifiedLang=lang;window.dispatchEvent(new CustomEvent('dai:lang',{detail:{lang:lang}}));} }
    catch(_){if(version===languageVersion){applyDom();document.documentElement.dataset.translationStatus='unavailable';}}
  }
  function installSelector() {
    var native=document.querySelector('#patientLanguage,select[data-dai-language]:not([data-dai-generated])');
    if(native){syncSelectors();return;}
    var label=document.querySelector('.dai-language-control');
    if(!label){label=document.createElement('label');label.className='dai-language-control';label.setAttribute('translate','no');label.innerHTML='<span aria-hidden="true">🌐</span><select data-dai-language data-dai-generated aria-label="Language / भाषा"></select>';}
    var bar=document.querySelector('[data-dai-language-slot],.topbar__right,.topbar-actions,.header-actions');
    if(bar){label.classList.remove('dai-language-control--floating');if(label.parentElement!==bar)bar.prepend(label);}
    else {label.classList.add('dai-language-control--floating');if(label.parentElement!==document.body)document.body.appendChild(label);}
    syncSelectors();
  }
  function start() {
    document.documentElement.lang=lang;installSelector();
    observer=new MutationObserver(function(changes){changes.forEach(function(m){if(m.type==='childList')m.addedNodes.forEach(schedule);else schedule(m.target);});});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','alt']});
    observer.observe(document.head,{subtree:true,childList:true,characterData:true});
    ['alert','confirm','prompt'].forEach(function(name){var native=window[name];if(typeof native==='function')window[name]=function(message){var args=Array.prototype.slice.call(arguments);args[0]=translate(message);return native.apply(window,args);};});
    document.addEventListener('change',function(e){if(e.target.matches('[data-dai-language],#patientLanguage,#setLang')){setLang(e.target.value);if(window.DaiPrefs&&e.target.id!=='patientLanguage'&&e.target.id!=='setLang')window.DaiPrefs.setPrefs({lang:e.target.value});}});
    window.addEventListener('storage',function(e){if(e.key===KEY&&names[e.newValue])setLang(e.newValue,{persist:false});});
    window.addEventListener('focus',function(){var next=cookieLanguage();if(next&&next!==lang)setLang(next,{persist:false});});
    load(lang).then(function(){applyDom();window.dispatchEvent(new CustomEvent('dai:i18n-ready',{detail:{lang:lang}}));}).catch(function(){applyDom();});
  }
  global.DaiI18n={registerLocale:function(code,values){STRINGS[code]=Object.assign({},STRINGS[code]||{},values);prepare();},t:t,translate:translate,setLang:setLang,getLang:function(){return lang;},hasPreference:hasPreference,applyDom:applyDom,ready:function(){return load(lang);},supportedLanguages:Object.keys(names)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window !== 'undefined' ? window : this);
