/* Educational overlay maths and commands. Never estimates pregnancy from images. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PregnancyMirrorModel=factory();})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const WATERMARK='Educational illustration—not your scan';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function recordedWeek(stage){return !stage?.delivered&&Number.isFinite(stage?.week)&&stage.week>=12&&stage.week<=40?Math.floor(stage.week):null;}
 function weekFromDueDate(due,today){
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!valid(due)||!valid(today))return null;
  const week=Math.floor((280-(Date.parse(due)-Date.parse(today))/86400000)/7);
  return week>=0&&week<=42?week:null;
 }
 const trimester=week=>week<14?1:week<28?2:3;
 const PEEL_ORDER=['uterus','sac','fluid','placenta','cord'];
 const peeledLayers=depth=>PEEL_ORDER.slice(0,clamp(Math.floor(depth||0),0,PEEL_ORDER.length));
 function handGesture(points){
  if(!Array.isArray(points)||points.length!==21||points.some(p=>!p||![p.x,p.y,p.z??0].every(Number.isFinite)))return null;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));
  if(distance(points[0],points[9])<.04)return null;
  let straight=0,folded=0;
  for(const mcp of [5,9,13,17]){
   const a=points[mcp],b=points[mcp+1],tip=points[mcp+3],wrist=points[0];
   const u=[a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0)],v=[tip.x-b.x,tip.y-b.y,(tip.z??0)-(b.z??0)];
   const length=Math.hypot(...u)*Math.hypot(...v);if(length<.00001)return null;
   const angle=Math.acos(clamp(u.reduce((sum,n,i)=>sum+n*v[i],0)/length,-1,1))*180/Math.PI;
   if(angle>155&&distance(tip,wrist)>distance(b,wrist)*1.12)straight++;
   else if(angle<110&&distance(tip,wrist)<distance(b,wrist)*1.15)folded++;
  }
  return straight===4?'palm':folded===4?'fist':null;
 }
 function createGestureGate(){
  let pending=null,since=0,latched=null,neutralSince=null,last=null,cooldown=0;
  return {reset(){pending=null;since=0;latched=null;neutralSince=null;last=null;cooldown=0;},update(kind,now){
   if(!Number.isFinite(now))return null;
   if(last!==null&&(now<last||now-last>500)){pending=null;since=now;neutralSince=null;}last=now;
   if(kind!=='palm'&&kind!=='fist'){pending=null;if(neutralSince===null)neutralSince=now;if(now-neutralSince>=450)latched=null;return null;}
   neutralSince=null;if(kind===latched)return null;
   if(pending!==kind){pending=kind;since=now;return null;}
   if(now-since<800||now<cooldown)return null;
   latched=kind;pending=null;cooldown=now+1200;return kind;
  }};
 }
 function fit(videoWidth,videoHeight,width,height){const scale=Math.max(width/videoWidth,height/videoHeight);return {scale,x:(width-videoWidth*scale)/2,y:(height-videoHeight*scale)/2};}
 function anchor(points,vw,vh,width,height){
  if(!points||![11,12,23,24].every(i=>points[i]&&points[i].visibility>=.7&&points[i].x>=0&&points[i].x<=1&&points[i].y>=0&&points[i].y<=1))return null;
  const f=fit(vw,vh,width,height),project=p=>({x:width-(p.x*vw*f.scale+f.x),y:p.y*vh*f.scale+f.y});
  const a=project(points[11]),b=project(points[12]),c=project(points[23]),d=project(points[24]);
  const shoulders={x:(a.x+b.x)/2,y:(a.y+b.y)/2},hips={x:(c.x+d.x)/2,y:(c.y+d.y)/2};
  // A face-only crop can still produce off-screen inferred hips. Never anchor to those.
  if([a,b,c,d].some(p=>p.x<0||p.x>width||p.y<0||p.y>height)||hips.y-shoulders.y<height*.16)return null;
  const length=Math.hypot(hips.x-shoulders.x,hips.y-shoulders.y);if(length<height*.1)return null;
  const x=shoulders.x*.25+hips.x*.75,y=shoulders.y*.25+hips.y*.75;
  if(x<0||x>width||y<0||y>height)return null;
  return {x,y,size:clamp(length*1.1,140,Math.min(width,height)*1.08),angle:clamp(Math.atan2(hips.y-shoulders.y,hips.x-shoulders.x)-Math.PI/2,-.5,.5)};
 }
 function command(text){const t=String(text||'').toLowerCase().trim();
  if(/\b(?:diagnos\w*|assess|healthy|health|normal|abnormal|measure|position)\b|निदान|बीमारी|स्वस्थ|जाँच/.test(t))return null;
  const explain=/explain|tell me|what (?:is|does|am)|समझा|बताओ|क्या/.test(t);
  if(explain){const part=t.match(/placenta|प्लेसेंटा|अपरा/) ? 'placenta' : /amniotic fluid|fluid|एमनियोटिक द्रव|पानी/.test(t)?'fluid':/amniotic sac|amnion|sac|थैली/.test(t)?'sac':/umbilical|cord|गर्भनाल|नाल/.test(t)?'cord':/uterus|womb|गर्भाशय/.test(t)?'uterus':/baby|fetus|बच्चा|शिशु/.test(t)?'baby':null;return part?{layer:part,explain:true}:/\b(?:this|that|part|layer)\b|यह|इस|इसे/.test(t)?{explain:true}:null;}
  if(/amniotic fluid|fluid|एमनियोटिक द्रव|पानी/.test(t))return {layer:'fluid'};
  if(/amniotic sac|amnion|sac|थैली/.test(t))return {layer:'sac'};
  if(/placenta|प्लेसेंटा|अपरा/.test(t))return {layer:'placenta'};
  if(/\b(?:umbilical|cord)\b|गर्भनाल|नाल/.test(t))return {layer:'cord'};
  if(/uterus|womb|गर्भाशय/.test(t))return {layer:'uterus'};
  if(/twins|जुड़व/.test(t))return {twins:true};
  if(/baby|बच्चा|शिशु/.test(t))return {layer:'baby'};
  if(/all layers|show all|सब दिखा/.test(t))return {layer:'all'};
  if(/recorded week|मेरे रिकॉर्ड/.test(t))return {recorded:true};
  const week=t.match(/(?:week|सप्ताह)\s*(\d{1,2})/);if(week&&+week[1]>=12&&+week[1]<=40)return {week:+week[1]};
  return null;
 }
 const descriptions={
  all:['Explore the uterine wall, amniotic sac, amniotic fluid, placenta, umbilical cord and baby. Peel to reveal each part, then ask me what it does. This is an educational illustration, not your scan.','गर्भाशय की दीवार, एमनियोटिक थैली, उसके द्रव, अपरा, गर्भनाल और शिशु को जानें। परत हटाएँ और पूछें कि यह हिस्सा क्या करता है। यह शैक्षिक चित्र है, आपका स्कैन नहीं।'],
  sac:['The amniotic sac is a thin membrane-lined bag around the baby and amniotic fluid. Its inner membrane is called the amnion. It sits inside the uterus. This translucent shell is simplified for learning; it cannot show whether your membranes are intact.','एमनियोटिक थैली शिशु और उसके आसपास के द्रव को घेरने वाली झिल्लीदार थैली है। इसकी अंदर की झिल्ली को एमनियन कहते हैं। यह गर्भाशय के अंदर होती है। यह सरल शैक्षिक चित्र आपकी झिल्लियों की स्थिति नहीं बता सकता।'],
  fluid:['Amniotic fluid surrounds the baby inside the amniotic sac. It cushions movement, allows room to move, and supports lung development. The tinted volume here is only a visual guide, not a fluid-level measurement. Fluid is hidden rather than peeled like tissue.','एमनियोटिक द्रव थैली के अंदर शिशु को घेरता है। यह झटकों से बचाने, हिलने की जगह देने और फेफड़ों के विकास में मदद करता है। यहाँ का रंग केवल समझाने के लिए है, द्रव की मात्रा का माप नहीं। द्रव को छिपाया जाता है, ऊतक की तरह छीला नहीं जाता।'],
  uterus:['The uterus is the muscular organ in which a pregnancy develops. The translucent outline here is an educational illustration.','गर्भाशय एक मांसपेशीय अंग है जिसमें गर्भावस्था विकसित होती है। यहाँ की पारदर्शी रूपरेखा केवल समझाने के लिए है।'],
  placenta:['The placenta supports exchange of oxygen and nutrients between the mother and baby. Its position here is illustrative, not your recorded placental location.','अपरा माँ और शिशु के बीच ऑक्सीजन और पोषक तत्वों के आदान-प्रदान में मदद करती है। यहाँ दिखाई गई जगह आपकी अपरा की वास्तविक जगह नहीं है।'],
  cord:['The umbilical cord connects the baby to the placenta. This drawing cannot assess cord position or health.','गर्भनाल शिशु को अपरा से जोड़ती है। यह चित्र गर्भनाल की स्थिति या स्वास्थ्य की जाँच नहीं करता।'],
  baby:['This is a schematic baby for learning. The week slider changes illustrative proportions; it does not measure your baby’s growth, size or health.','यह सीखने के लिए शिशु का एक चित्र है। सप्ताह बदलने से केवल चित्र का अनुपात बदलता है; इससे आपके शिशु की वृद्धि, आकार या स्वास्थ्य नहीं मापा जाता।']
 };
 const cutaways=[null,
  ['Uterine wall lifted away. Now explore the amniotic sac.','गर्भाशय की दीवार हटाई गई है। अब एमनियोटिक थैली को जानें।'],
  ['Amniotic sac lifted away. Now explore the amniotic fluid.','एमनियोटिक थैली हटाई गई है। अब उसके द्रव को जानें।'],
  ['Amniotic fluid hidden. Now explore the placenta.','एमनियोटिक द्रव छिपाया गया है। अब अपरा को जानें।'],
  ['Placenta lifted away. Now explore the umbilical cord.','अपरा हटाई गई है। अब गर्भनाल को जानें।'],
  ['Only the baby illustration remains. Restore all layers whenever you like.','अब केवल शिशु का चित्र है। जब चाहें सभी परतें वापस लाएँ।']];
 function currentPart(config={}){if(config.layer&&config.layer!=='all'&&descriptions[config.layer])return config.layer;return PEEL_ORDER[clamp(Math.floor(config.revealDepth||0),0,PEEL_ORDER.length)]||'baby';}
 function narration(config={},language='en'){
  const i=language==='hi'?1:0,depth=clamp(Math.floor(config.revealDepth||0),0,PEEL_ORDER.length);
  if(config.explainLayer)return (descriptions[config.explainLayer]||descriptions[currentPart(config)])[i];
  if(depth)return cutaways[depth][i]+' '+['Educational illustration, not your anatomy.','शैक्षिक चित्र, आपके शरीर की वास्तविक रचना नहीं।'][i];
  return (descriptions[config.layer]||descriptions.all)[i]+(config.twins?[' Twins mode is an example; placental arrangements vary.',' जुड़वाँ मोड एक उदाहरण है; अपरा की व्यवस्था अलग-अलग हो सकती है।'][i]:'');
 }
 function narrations(language){return [...new Set([...Object.values(descriptions).map(d=>d[language==='hi'?1:0]),...Object.keys(descriptions).flatMap(layer=>[false,true].flatMap(twins=>[0,1,2,3,4,5].map(revealDepth=>narration({layer,twins,revealDepth},language))))])];}
 return {PEEL_ORDER,currentPart,WATERMARK,clamp,fit,anchor,recordedWeek,weekFromDueDate,trimester,handGesture,createGestureGate,peeledLayers,command,descriptions,narration,narrations};
});
