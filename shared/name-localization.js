/* Offline display transliteration. Never changes saved names or sends them to a provider. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DaiNames=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const spellings={
 nivara:'निवारा',hemangini:'हेमांगिनी',batra:'बत्रा',sethi:'सेठी',aakriti:'आकृति',aakritii:'आकृति',akriti:'आकृति',khanak:'खनक',kavya:'काव्या',aabhanshi:'आभांशी',abhanshi:'आभांशी',
 aarohi:'आरोही',arohi:'आरोही',kavini:'कविनी',anvita:'अन्विता',kusuma:'कुसुमा',rewati:'रेवती',revati:'रेवती',maithili:'मैथिली',kalyani:'कल्याणी',suhani:'सुहानी',mrinali:'मृणाली',vaidehi:'वैदेही',anagha:'अनघा',kavitha:'कविता',kavita:'कविता',thenmozhi:'तेनमोझी',kayal:'कयल',rupali:'रूपाली',padmika:'पद्मिका',chandrika:'चंद्रिका',nirav:'नीरव',
 meera:'मीरा',mira:'मीरा',asha:'आशा',priya:'प्रिया',pooja:'पूजा',puja:'पूजा',neha:'नेहा',anita:'अनिता',sunita:'सुनीता',suman:'सुमन',rekha:'रेखा',seema:'सीमा',rani:'रानी',aarti:'आरती',arti:'आरती',sneha:'स्नेहा',shreya:'श्रेया',shweta:'श्वेता',shruti:'श्रुती',swati:'स्वाती',nisha:'निशा',divya:'दिव्या',deepa:'दीपा',deepika:'दीपिका',lakshmi:'लक्ष्मी',laxmi:'लक्ष्मी',sangeeta:'संगीता',sangita:'संगीता',savita:'सविता',vandana:'वंदना',manisha:'मनीषा',geeta:'गीता',gita:'गीता',anjali:'अंजली',anjana:'अंजना',anjum:'अंजुम',fatima:'फातिमा',aisha:'आयशा',ayesha:'आयशा',farah:'फ़राह',farhat:'फ़रहत',mary:'मेरी',rose:'रोज़',sara:'सारा',sarah:'सारा',jose:'जोसे',thomas:'थॉमस',smith:'स्मिथ',john:'जॉन',
 anil:'अनिल',sunil:'सुनील',rohan:'रोहन',rahul:'राहुल',raj:'राज',rajesh:'राजेश',rakesh:'राकेश',amit:'अमित',sumit:'सुमित',ajay:'अजय',vijay:'विजय',arjun:'अर्जुन',aarav:'आरव',vivek:'विवेक',vikas:'विकास',vikram:'विक्रम',suresh:'सुरेश',ramesh:'रमेश',dinesh:'दिनेश',mahesh:'महेश',harish:'हरीश',sachin:'सचिन',sandeep:'संदीप',sanjay:'संजय',sanjiv:'संजीव',sanjeev:'संजीव',deepak:'दीपक',mohit:'मोहित',manoj:'मनोज',manish:'मनीष',vinod:'विनोद',pavan:'पवन',pawan:'पवन',gaurav:'गौरव',abhay:'अभय',abhishek:'अभिषेक',raghav:'राघव',aditya:'आदित्य',aditi:'अदिती',ananya:'अनन्या',atharva:'अथर्व',ishaan:'ईशान',ishita:'इशिता',
 mehra:'मेहरा',tiwari:'तिवारी',mishra:'मिश्रा',verma:'वर्मा',sinha:'सिन्हा',jha:'झा',kumari:'कुमारी',deshmukh:'देशमुख',kulkarni:'कुलकर्णी',patil:'पाटील',selvan:'सेल्वन',kannan:'कन्नन',murugan:'मुरुगन',rathore:'राठौर',rathod:'राठोड',chauhan:'चौहान',joshi:'जोशी',sharma:'शर्मा',gupta:'गुप्ता',nair:'नायर',iyer:'अय्यर',singh:'सिंह',kumar:'कुमार',kapoor:'कपूर',malhotra:'मल्होत्रा',reddy:'रेड्डी',menon:'मेनन',shah:'शाह',mehta:'मेहता',patel:'पटेल',desai:'देसाई',banerjee:'बनर्जी',chatterjee:'चटर्जी',das:'दास',ghosh:'घोष',bose:'बोस',bhat:'भट',bhatia:'भाटिया',pawar:'पवार',shinde:'शिंदे',chavan:'चव्हाण',jadhav:'जाधव',more:'मोरे',ali:'अली',khan:'खान',ahmed:'अहमद',qureshi:'कुरैशी',ansari:'अंसारी',shaikh:'शेख',sheikh:'शेख',hussain:'हुसैन',fernandes:'फर्नांडिस',"d'souza":'डिसूझा',
 delhi:'दिल्ली',pune:'पुणे',mumbai:'मुंबई',lucknow:'लखनऊ',patna:'पटना',chennai:'चेन्नई',jaipur:'जयपुर',maharashtra:'महाराष्ट्र',bihar:'बिहार',rajasthan:'राजस्थान',uttar:'उत्तर',pradesh:'प्रदेश',tamil:'तमिल',nadu:'नाडु',gujarat:'गुजरात',karnataka:'कर्नाटक',bengaluru:'बेंगलुरु',bangalore:'बेंगलुरु',hyderabad:'हैदराबाद',kolkata:'कोलकाता',nagpur:'नागपुर',nashik:'नाशिक',thane:'ठाणे',navi:'नवी',saket:'साकेत',rohini:'रोहिणी',lajpat:'लाजपत',nagar:'नगर',safdarjung:'सफदरजंग',aiims:'एम्स',apollo:'अपोलो',fortis:'फोर्टिस',max:'मैक्स',
 dr:'डॉ',doctor:'डॉक्टर',prof:'प्रो',mr:'श्री',mrs:'श्रीमती',ms:'सुश्री',synthetic:'काल्पनिक',demo:'डेमो',review:'रिव्यू',staff:'स्टाफ',baby:'बेबी',hospital:'अस्पताल',hospitals:'अस्पताल',clinic:'क्लिनिक',centre:'केंद्र',center:'केंद्र',health:'स्वास्थ्य',medical:'मेडिकल',college:'कॉलेज',government:'सरकारी',district:'ज़िला',community:'सामुदायिक',primary:'प्राथमिक',new:'नई',north:'उत्तर',south:'दक्षिण',east:'पूर्व',west:'पश्चिम'
};
const marathi={patil:'पाटील',jaipur:'जयपूर',tamil:'तामिळ',nadu:'नाडू',bengaluru:'बंगळुरू',bangalore:'बंगळुरू',hyderabad:'हैदराबाद',banerjee:'बॅनर्जी',baby:'बाळ',hospital:'रुग्णालय',hospitals:'रुग्णालये',clinic:'दवाखाना',centre:'केंद्र',center:'केंद्र',health:'आरोग्य',medical:'वैद्यकीय',college:'महाविद्यालय',government:'शासकीय',district:'जिल्हा',community:'सामुदायिक',primary:'प्राथमिक',new:'नवी',ms:'सुश्री'};
const hindi={patil:'पाटिल',shruti:'श्रुति',swati:'स्वाति',aditi:'अदिति',nashik:'नासिक'};
const protectedWords=new Set(['DAI','ABHA','UHID','BP','Hb','HB','CBC','PDF','QR','SOS','ICU','NICU','PHC','CHC','WHO','API','OTP','IST','ML','AI','MRI','CT','ECG','LMS','OSRM','mmHg','mg','kg','cm','mm','ml','mL','bpm','SpO2']);
const letterNames={A:'ए',B:'बी',C:'सी',D:'डी',E:'ई',F:'एफ',G:'जी',H:'एच',I:'आई',J:'जे',K:'के',L:'एल',M:'एम',N:'एन',O:'ओ',P:'पी',Q:'क्यू',R:'आर',S:'एस',T:'टी',U:'यू',V:'वी',W:'डब्ल्यू',X:'एक्स',Y:'वाय',Z:'ज़ेड'};
const vowels={aa:['आ','ा'],ai:['ऐ','ै'],au:['औ','ौ'],ee:['ई','ी'],ii:['ई','ी'],oo:['ऊ','ू'],uu:['ऊ','ू'],ou:['औ','ौ'],a:['अ',''],i:['इ','ि'],u:['उ','ु'],e:['ए','े'],o:['ओ','ो']};
const consonants={chh:'छ',ksh:'क्ष',shr:'श्र',dny:'ज्ञ',jny:'ज्ञ',kh:'ख',gh:'घ',ch:'च',jh:'झ',th:'थ',dh:'ध',ph:'फ',bh:'भ',sh:'श',zh:'झ',ng:'ङ',ny:'न्य',tr:'त्र',dr:'द्र',b:'ब',c:'क',d:'द',f:'फ़',g:'ग',h:'ह',j:'ज',k:'क',l:'ल',m:'म',n:'न',p:'प',q:'क़',r:'र',s:'स',t:'त',v:'व',w:'व',x:'क्स',y:'य',z:'ज़'};
function word(value,code,initials=false){
 if(!['hi','mr'].includes(code))return value;
 if(!initials&&protectedWords.has(value))return value;
 const lower=value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if((code==='mr'?marathi:hindi)[lower])return (code==='mr'?marathi:hindi)[lower];
 if(spellings[lower])return spellings[lower];
 if(/^[A-Z]{1,3}$/.test(value))return value.split('').map(c=>letterNames[c]||c).join('');
 let out='',pending=false,i=0;
 while(i<lower.length){let matched=false;
  for(const size of [2,1]){const part=lower.slice(i,i+size);if(vowels[part]){out+=vowels[part][pending?1:0];pending=false;i+=size;matched=true;break;}}
  if(matched)continue;
  for(const size of [3,2,1]){const part=lower.slice(i,i+size);if(consonants[part]){if(pending)out+='्';out+=consonants[part];pending=true;i+=size;matched=true;break;}}
  if(!matched){out+=lower[i];pending=false;i++;}
 }
 return out;
}
function localize(value,code,options={}){
 const original=String(value??'');if(!['hi','mr'].includes(code))return original;
 // Keep machine identifiers, email addresses, URLs and measurements exact.
 return original.replace(/https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[A-Z]{2,}[-:][A-Z0-9_:/-]*\d[A-Z0-9_:/-]*|[A-Za-zÀ-ž]+(?:['’][A-Za-zÀ-ž]+)?/g,token=>{
  if(/https?:\/\/|@|\d/.test(token))return token;
  return word(token,code,Boolean(options.initials));
 });
}
function looksLikeName(value){const words=String(value||'').match(/[A-Za-z]+/g)||[];return words.length>0&&words.length<12&&words.some(w=>Object.hasOwn(spellings,w.toLowerCase()))&&words.every(w=>/^[A-Z]/.test(w)||['of','and','the','de','van'].includes(w));}
function matches(value,query){const clean=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(),q=clean(query);return !q||[String(value??''),localize(value,'hi'),localize(value,'mr')].some(v=>clean(v).includes(q));}
return {localize,word,looksLikeName,matches};
});
