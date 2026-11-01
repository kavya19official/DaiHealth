'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
console.log('DaiHealth video demo: fictional, labelled fixture data; existing edits are preserved.');
console.log('After startup open http://localhost:'+(process.env.DAI_PORT||'3001')+'/auth.html?demo=video for the optional recording guide.');
const r=spawnSync(process.execPath,[path.join(__dirname,'local.cjs'),'run'],{stdio:'inherit',env:{...process.env,DAI_VIDEO_DEMO:'true'}});process.exit(r.status??1);
