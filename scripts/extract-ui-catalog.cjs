'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..'),ts=require('../hospital_portal/web/node_modules/typescript');
const phrases=new Set(),aliases={},origins=new Map();
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,t=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'",'&nbsp;':' '}[t]));
const normalize=s=>decode(s).replace(/\s+/g,' ').trim();
function add(s,file){s=normalize(s);if(s.length<2||s.length>2600||!/[A-Za-z]{2}/.test(s)||/[\u0900-\u0dff]/.test(s)||/^\s*(?:https?:|\/|#|\.|@|--|data:|SELECT |INSERT |UPDATE |CREATE |DELETE |ALTER |WITH |PRAGMA |function\b|const\b|var\b|let\b)/i.test(s)||/[{}<>=\\]|\$\(|\b(?:SELECT|FROM|WHERE|JOIN)\b/.test(s)||/^[\w.-]+\.(?:js|css|json|sql|png|jpg|glb|html|wav|csv|pdf)$/i.test(s)||/^[\w]+[_:/][\w/:.-]+$/.test(s)||/^(?:[a-z]+[-_][a-z_-]+|[a-z]+[A-Z][a-zA-Z]+)$/.test(s)||/^(?:SYNTHETIC |Dr\.? [A-Z]|Gemini|gemini-|DAI-SYN|mother@|doctor@)/.test(s))return;
 if(!origins.has(s))origins.set(s,new Set());origins.get(s).add(file);phrases.add(s);
}
function html(s,file){for(const m of s.matchAll(/(?:placeholder|aria-label|title|alt)\s*=\s*["']([^"']+)["']/gi))add(m[1],file);s=s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');for(const part of s.split(/<[^>]*>/g))add(part,file);}
function expression(node,map=new Map()){
 if(ts.isStringLiteralLike(node))return node.text;
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken)return expression(node.left,map)+expression(node.right,map);
 if(ts.isTemplateExpression(node))return node.head.text+node.templateSpans.map(s=>expression(s.expression,map)+s.literal.text).join('');
 const key=node.getText();if(!map.has(key))map.set(key,map.size);return '{{'+map.get(key)+'}}';
}
function template(value,file){for(const raw of value.split(/<[^>]*>/g)){const s=normalize(raw),literal=s.replace(/\{\{\d+\}\}/g,'');if(!/[\u0900-\u0dff]/.test(s)&&/[A-Za-z]{4}/.test(literal)&&literal.length>=7&&s.length<1600&&!/[<>{}=]/.test(s.replace(/\{\{\d+\}\}/g,''))&&(s.match(/\{\{/g)||[]).length<=6){phrases.add(s);origins.set(s,new Set([file]));}}}
function alias(en,localized,file,allowRoman=false){en=normalize(en);localized=normalize(localized);if(!/[A-Za-z]{3}/.test(en)||/[\u0900-\u0dff]/.test(en)||(!allowRoman&&!/[\u0900-\u097f]/.test(localized)))return;if(en.includes('{{'))template(en,file);else add(en,file);if(phrases.has(en))aliases[localized]=en;}
function strings(node,file){
 if(ts.isStringLiteralLike(node)){
  const v=node.text;if(v.includes('<')||v.includes('>'))html(v,file);else add(v,file);
 }
 if(ts.isJsxText(node))add(node.text,file);
 if(ts.isTemplateExpression(node)&&!/[<>]/.test(node.getText())){
  const value=node.head.text+node.templateSpans.map((s,i)=>'{{'+i+'}}'+s.literal.text).join('');
  if(value.length<1500&&!/[;<>]/.test(value)){const safe=value.replace(/\{\{\d+\}\}/g,'TOKEN');if(/[A-Za-z]{3}/.test(safe)){const tokenized=normalize(value);add(safe,file);if(phrases.has(normalize(safe))){phrases.delete(normalize(safe));phrases.add(tokenized);origins.set(tokenized,new Set([file]));}}}
 }
 if(ts.isCallExpression(node)&&/^(T|tr|t|L)$/.test(node.expression.getText())&&node.arguments.length>=2){const map=new Map();alias(expression(node.arguments[0],map),expression(node.arguments[1],map),file);}
 if(ts.isConditionalExpression(node)&&ts.isStringLiteralLike(node.whenTrue)&&ts.isStringLiteralLike(node.whenFalse)){alias(node.whenFalse.text,node.whenTrue.text,file);alias(node.whenTrue.text,node.whenFalse.text,file);}
 if(ts.isArrayLiteralExpression(node)&&node.elements.length>=2&&ts.isStringLiteralLike(node.elements[0])&&ts.isStringLiteralLike(node.elements[1]))alias(node.elements[0].text,node.elements[1].text,file);
 if(ts.isObjectLiteralExpression(node)){const values=Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).filter(p=>ts.isStringLiteralLike(p.initializer)).map(p=>[p.name.getText().replace(/['"]/g,''),p.initializer.text]));if(values.en){if(values.hi)alias(values.en,values.hi,file,true);if(values.mr)alias(values.en,values.mr,file,true);}}
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken&&!(ts.isBinaryExpression(node.parent)&&node.parent.operatorToken.kind===ts.SyntaxKind.PlusToken))template(expression(node),file);
 ts.forEachChild(node,n=>strings(n,file));
}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.')||['node_modules','vendor','reference-data','public','previews'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(?:js|tsx?|html)$/.test(e.name)&&!/(?:\.test\.|\.spec\.|service-worker|\.min\.)/.test(e.name)){const rel=path.relative(ROOT,p),s=fs.readFileSync(p,'utf8');if(p.endsWith('.html')){html(s,rel);for(const m of s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))strings(ts.createSourceFile(p+'.js',m[1],ts.ScriptTarget.Latest,true),rel);}else strings(ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,p.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS),rel);}}}
function backendCopy(node,file){
 if(ts.isPropertyAssignment(node)&&/^(error|message|label|title|description|notice|warning)$/.test(node.name.getText().replace(/['"]/g,''))&&ts.isStringLiteralLike(node.initializer))add(node.initializer.text,file);
 if((ts.isNewExpression(node)||ts.isCallExpression(node))&&/^Error$/.test(node.expression.getText())&&node.arguments?.length&&ts.isStringLiteralLike(node.arguments[0]))add(node.arguments[0].text,file);
 ts.forEachChild(node,n=>backendCopy(n,file));
}
for(const name of fs.readdirSync(path.join(ROOT,'backend'))){if(!name.endsWith('.js')||name.includes('.test.'))continue;const file='backend/'+name;backendCopy(ts.createSourceFile(file,fs.readFileSync(path.join(ROOT,file),'utf8'),ts.ScriptTarget.Latest,true),file);}
for(const file of ['pregnancy-mirror','uterus-learning','sukoon'])for(const text of require(path.join(ROOT,'shared',file)).narrations('en'))add(text,'shared/'+file+'.js');
for(const dir of ['frontend','hospital_portal/web/app','shared'])walk(path.join(ROOT,dir));
// Keep legacy key-based copy complete and register aliases for previously translated text.
const copyFile=fs.readFileSync(path.join(ROOT,'frontend/js/patient-copy.js'),'utf8'),match=copyFile.match(/const copy=(\{.*\});window\.PatientCopy/s);const legacy=match?JSON.parse(match[1]):{};
for(const [key,en]of Object.entries(legacy.en||{})){add(en,'frontend/js/patient-copy.js');for(const code of ['hi','mr'])if(legacy[code]?.[key])aliases[normalize(legacy[code][key])]=normalize(en);}
for(const en of Object.values(aliases))add(en,'legacy bilingual text');
const overrides=JSON.parse(fs.readFileSync(path.join(ROOT,'frontend/locales/overrides.json'),'utf8'));for(const en of Object.keys(overrides))phrases.add(en);
function technical(s){const v=s.replace(/\{\{\d+\}\}/g,'VALUE');return /^(?:AUD|CAM|DOC|EV|GH|PAT|PNC|SYN|DAI|UHID|ABHA|REQ|REF)-\{\{/.test(s)||['-IN','gi','gu','ig','iu','gs'].includes(s)||s.startsWith('January February March April May June')||!/[A-Za-z]/.test(s.replace(/\{\{\d+\}\}/g,''))||/^\[data-|^(?:background|border|padding|position|z-index|left):|^px[;:]|^(?:rgba?|hsla?|var|calc|url)\(/.test(v)||/(?:^|;)(?:border-radius|font-size|font-family|padding|margin(?:-top|-bottom)?|position|transform|z-index|transition|display|color|overflow-wrap):/.test(v)||/^VALUE(?:\/[^ ]+|\|[^ ]+|[a-z-]+)$/i.test(v);}
const entries=[...phrases].filter(s=>!technical(s)).sort(),hash=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
fs.writeFileSync(path.join(ROOT,'frontend/locales/source.json'),JSON.stringify({version:1,hash,entries,aliases,legacy:legacy.en||{}},null,2)+'\n');
console.log(JSON.stringify({entries:entries.length,characters:entries.join('').length,aliases:Object.keys(aliases).length,hash}));
