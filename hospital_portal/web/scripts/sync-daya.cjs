// Keep the static site and hospital app on the same assistant and avatar assets.
const fs=require('node:fs');const path=require('node:path');
const web=path.resolve(__dirname,'..');
const source=process.env.DAI_FRONTEND_ASSET_DIR || path.resolve(web,'../../frontend');
const destination=path.join(web,'public/daya');
const entries=['js/care-chatbot.js','js/care-chatbot.css','js/daya-knowledge.js','js/daya-avatar.mjs','assets/dr-daya','vendor/three'];
for(const entry of entries){
 const from=path.join(source,entry),to=path.join(destination,entry);
 if(!fs.existsSync(from))throw new Error('Missing shared Dr. Daya asset: '+from);
 fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true});
}
console.log('Dr. Daya assets synced for hospital workspace.');
