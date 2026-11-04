/* Run inside Codex cua_repl, passing a freshly selected QA preview tab/browser.
 * Uses only documented CUA browser methods. Never run against patient accounts.
 */
export async function captureHomeMatrix(tab,browser,fs,directory,{revision='after'}={}){
 const url=await tab.url();if(!/^http:\/\/(127\.0\.0\.1|localhost):13201\/preview/.test(url))throw Error('Use isolated QA preview, not a patient account');
 await fs.mkdir(directory,{recursive:true});const results=[];
 for(const width of [1440,390]){
  const viewport=await browser.capabilities.get('viewport');await viewport.set({width,height:900});
  const actual=await tab.playwright.evaluate(()=>innerWidth);await viewport.set({width:Math.round(width*width/actual),height:Math.round((width===390?844:900)*width/actual)});
  for(const stage of ['pregnancy','postpartum','child'])for(const lang of ['en','hi'])for(const theme of ['light','dark']){
   await tab.playwright.locator('#testStage').selectOption(stage);await tab.playwright.locator('#testLang').selectOption(lang);await tab.playwright.locator('#testTheme').selectOption(theme);await tab.getAXState({emit:false});
   const sample=await tab.playwright.evaluate(()=>{const t=document.getElementById('nextStepTitle').getBoundingClientRect(),s=document.getElementById('nextStepStatus').getBoundingClientRect(),p=document.getElementById('nextStepWhy').getBoundingClientRect(),sos=document.getElementById('sosBtn').getBoundingClientRect();return {width:innerWidth,height:document.documentElement.scrollHeight,text:document.getElementById('panel-dashboard').innerText.length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,overlap:t.left<s.right&&t.right>s.left&&t.top<s.bottom&&t.bottom>s.top,bodyBelowTitle:p.top>=t.bottom-1,sosVisible:sos.top>=0&&sos.bottom<=innerHeight&&sos.right<=document.documentElement.clientWidth+1,stops:document.querySelectorAll('#homeOpenTimeline>.oh-stop').length};});
   const key=[width,stage,lang,theme].join('-');if(Math.abs(sample.width-width)>1||sample.overflow||!sample.sosVisible||(revision==='after'&&(sample.overlap||!sample.bodyBelowTitle||sample.stops>6)))throw Error(key+': '+JSON.stringify(sample));
   await fs.writeFile(directory+'/'+key+'.png',await tab.screenshot({fullPage:true}));results.push({key,...sample});
  }
 }
 await fs.writeFile(directory+'/measurements.json',JSON.stringify(results,null,2));return results;
}
export async function verifyPatientHome(tab){
 const results=[],assert=(condition,name)=>{if(!condition)throw Error(name);results.push(name);};
 assert((await tab.url()).includes(':13201/preview'),'isolated fixture only');
 await tab.playwright.locator('#testStage').selectOption('postpartum');await tab.playwright.locator('#testLang').selectOption('en');await tab.playwright.locator('#testTheme').selectOption('light');await tab.getAXState({emit:false});
 assert(await tab.playwright.locator('#panel-dashboard [role=tablist]').count()===1,'one shared baby selector');
 await tab.playwright.getByRole('tab',{name:'Baby B',exact:true}).click();await tab.getAXState({emit:false});
 assert(await tab.playwright.evaluate(()=>[...document.querySelectorAll('#homeOpenVaccineRows [data-oh-baby]')].every(b=>b.dataset.ohBaby==='2')),'Baby B doses keep child 2 identity');
 await tab.playwright.locator('[data-oh-change-baby]').click();await tab.getAXState({emit:false});assert(await tab.playwright.evaluate(()=>document.activeElement?.getAttribute('data-home-child'))==='2','change-baby restores avatar keyboard focus');
 await tab.playwright.locator('[data-oh-catchup]').click();await tab.getAXState({emit:false});assert(await tab.playwright.locator('#homeCatchupItems>div').count()===4,'all four source catch-up records remain');await tab.playwright.locator('[data-oh-catchup]').click();await tab.getAXState({emit:false});
 await tab.playwright.locator('#patientTourStart').click();await tab.getAXState({emit:false});assert(await tab.playwright.getByRole('dialog').count()===1,'question-mark opens walkthrough');await tab.pressKey(null,'Escape');await tab.getAXState({emit:false});assert(await tab.playwright.locator('.patient-tour-layer').count()===0,'tour closes with Escape');
 await tab.playwright.locator('#homeOpenVaccineBabies .oh-info summary').click();await tab.getAXState({emit:false});await tab.pressKey(null,'Escape');await tab.pressKey(null,'Tab');await tab.getAXState({emit:false});assert(await tab.playwright.evaluate(()=>!!document.activeElement?.classList.contains('oh-dose-ring')&&getComputedStyle(document.activeElement.querySelector('[role=tooltip]')).display==='block'),'vaccine tooltip appears on keyboard focus');await tab.pressKey(null,'Escape');await tab.getAXState({emit:false});assert(await tab.playwright.evaluate(()=>getComputedStyle(document.activeElement.querySelector('[role=tooltip]')).display==='none'),'vaccine tooltip dismisses with Escape');
 await tab.playwright.locator('#homeCareNavigation>summary').click();await tab.getAXState({emit:false});await tab.playwright.locator('.sidebar [data-panel=timeline]').click();await tab.getAXState({emit:false});assert(await tab.playwright.locator('#homeCareNavigation').getAttribute('open')!==null,'care navigation expands on active subpage');await tab.playwright.locator('.sidebar [data-panel=dashboard]').click();await tab.getAXState({emit:false});assert(await tab.playwright.locator('#homeCareNavigation').getAttribute('open')===null,'care navigation closes on Home');
 return results;
}
