'use strict';
// Native Vercel Build Output API: static patient/doctor UI + same-origin backend routes.
const fs=require('node:fs'),path=require('node:path');
function origin(value){
 let url;try{url=new URL(value);}catch{throw Error('Set DAI_BACKEND_ORIGIN to your Render HTTPS origin.');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('DAI_BACKEND_ORIGIN must be an HTTPS origin without a path or credentials.');
 return url.origin;
}
function configuration(backend){
 const noStore={'Cache-Control':'private, no-store'};
 return {version:3,routes:[
  {src:'^/demo-entry$',dest:backend+'/',headers:noStore},
  {src:'^(/api(?:/.*)?)$',dest:backend+'$1',headers:noStore},
  {src:'^(/hospital-admin(?:/.*)?)$',dest:backend+'$1',headers:noStore},
  {src:'^/(.*\\.html)$',headers:noStore,continue:true},
  {src:'^/$',dest:'/index.html',headers:noStore},
  {handle:'filesystem'}
 ]};
}
function build({root=path.resolve(__dirname,'..'),backend=process.env.DAI_BACKEND_ORIGIN}={}){
 const target=origin(backend),output=path.join(root,'.vercel/output'),statics=path.join(output,'static');
 fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(statics,{recursive:true});
 const filter=file=>!file.split(path.sep).some(p=>p.startsWith('.')||p==='node_modules'||p==='__pycache__');
 fs.cpSync(path.join(root,'frontend'),statics,{recursive:true,filter});
 fs.cpSync(path.join(root,'shared'),path.join(statics,'shared'),{recursive:true,filter});
 fs.writeFileSync(path.join(output,'config.json'),JSON.stringify(configuration(target),null,2)+'\n');
 console.log('Built patient/doctor frontend; API and hospital routes proxy to '+target);
 return {output,statics,config:configuration(target)};
}
module.exports={origin,configuration,build};
if(require.main===module){try{build();}catch(e){console.error(e.message);process.exitCode=1;}}
