'use strict';
const fs=require('node:fs/promises');
function parseText(text){
 const observations=[];
 const tests=[['Haemoglobin',/\b(?:ha?emoglobin|hb)\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(g\s*\/\s*d[lL])?/i],['Glucose',/\b(?:glucose|blood sugar)\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mg\s*\/\s*d[lL]|mmol\s*\/\s*[lL])?/i],['Platelets',/\bplatelets?\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*([^\n]{0,16})/i],['TSH',/\bTSH\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mIU\s*\/\s*[lL]|uIU\s*\/\s*m[lL])?/i],['Creatinine',/\bcreatinine\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mg\s*\/\s*d[lL])?/i]];
 for(const line of text.split(/\r?\n/))for(const [label,rx]of tests){const m=line.match(rx);if(m&&observations.length<40)observations.push({label,value:m[1],unit:(m[2]||'').trim(),source_line:line.slice(0,300)});}
 const date=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
 return {report_date:date?.[1]||'',document_type:/\b(laboratory|lab report|ha?emoglobin|glucose)\b/i.test(text)?'lab_report':/prescription/i.test(text)?'prescription':'medical_report',observations};
}
async function extract(file,mime){
 const bytes=await fs.readFile(file);if(bytes.length>5*1024*1024)throw Error('Report exceeds 5 MB');
 let text='',warnings=['Extraction is a draft. Check every date, value and unit against the original. English printed text only.'];
 if(mime==='application/pdf'){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');
  const canvas=require('@napi-rs/canvas');for(const k of ['DOMMatrix','ImageData','Path2D'])globalThis[k]??=canvas[k];
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,maxImageSize:12000000});
  try{const pdf=await task.promise;for(let n=1;n<=Math.min(pdf.numPages,5);n++){const page=await pdf.getPage(n);const content=await page.getTextContent();let line='';for(const item of content.items){line+=item.str+' ';if(item.hasEOL){text+=line+'\n';line='';}}text+=line+'\n';}if(pdf.numPages>5)warnings.push('Only the first five pages were extracted.');if(text.trim().length<20)warnings.push('Scanned PDF: enter fields manually from the original.');}finally{await task.destroy();}
 }else if(['image/png','image/jpeg','image/webp'].includes(mime)){
  const {imageSize}=require('image-size');const size=imageSize(bytes);const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};if(size.type!==types[mime]||size.width*size.height>12000000)throw Error('Image format mismatch or image exceeds 12 megapixels');
  const {createWorker}=require('tesseract.js');const os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-ocr-'));let worker,timer;
  try{worker=await createWorker('eng',1,{langPath:require('@tesseract.js-data/eng').langPath,cachePath:dir});const input=mime==='image/webp'?await require('@napi-rs/canvas').loadImage(bytes).then(im=>{const c=require('@napi-rs/canvas').createCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);return c.toBuffer('image/png');}):bytes;const result=await Promise.race([worker.recognize(input),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OCR timed out')),60000);})]);text=result.data.text;}finally{clearTimeout(timer);if(worker)await worker.terminate();await fs.rm(dir,{recursive:true,force:true});}
 }else warnings.push('This format requires manual transcription.');
 text=text.slice(0,100000);if(!text.trim())warnings.push('No readable text extracted; use manual entry.');
 return {source_text:text,candidates:parseText(text),warnings};
}
module.exports={extract,parseText};
