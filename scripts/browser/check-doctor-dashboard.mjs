/** Reusable CUA browser checks. Run with an already authenticated synthetic doctor tab.
 * Uses only the browser API supplied by Codex computer use; no Playwright dependency.
 * Example in cua_repl: import this module, then runDoctorDashboardChecks(docTab, docBrowser,
 * {writeFile: fs.writeFile, outDir:'/tmp/dai-doctor-redesign'}).
 */
export async function runDoctorDashboardChecks(tab,browser,{writeFile,outDir}) {
 const results=[];
 const check=(name,ok,detail={})=>{results.push({name,pass:!!ok,...detail});if(!ok)throw Error(name);};
 const viewport=await browser.capabilities.get('viewport');
 const initialTheme=await tab.playwright.locator('body').getAttribute('data-dw-theme');
 const top=async(mode)=>{for(let i=0;i<12;i++){if(await tab.playwright.evaluate(()=>scrollY===0))break;await tab.playwright.locator('[data-dd-mode="'+mode+'"]').press('PageUp');}};
 const theme=async(value)=>{if(await tab.playwright.locator('body').getAttribute('data-dw-theme')!==value)await tab.playwright.getByRole('button',{name:'Toggle light and dark mode',exact:true}).click();};
 try {
 await viewport.set({width:1440,height:1000});
 await tab.playwright.locator('[data-dd-mode="maternal"]').click();
 const cards=await tab.playwright.locator('.dd-hospital').count();check('one resource snapshot',cards===1);
 const available=Number.parseInt(await tab.playwright.locator('[data-dd-stage="t2"] .dd-stage-count').innerText(),10);
 await tab.playwright.locator('[data-dd-stage="t2"]').click();
 check('journey filter limits preview',await tab.playwright.locator('.dd-preview-table tbody tr').count()===Math.min(6,available));
 check('journey selection stays keyboard focused',await tab.playwright.evaluate(()=>document.activeElement?.getAttribute('data-dd-stage')==='t2'));
 await tab.playwright.locator('.dd-table-footer [data-dd-viewall]').click();
 check('journey filter reaches the full roster',await tab.playwright.locator('#dpRoster [data-patient-key]').count()===available);
 await tab.playwright.locator('.sidebar [data-dw-filter="all"]').click();
 check('sidebar clears the journey restriction',await tab.playwright.locator('#dpRoster [data-patient-key]').count()>=available&&await tab.playwright.locator('[data-dp-remove="stage"]').count()===0);
 await tab.playwright.locator('.sidebar [data-panel="dashboard"]').click();
 await tab.playwright.locator('[data-dd-stage="all"]').click();
 await tab.playwright.locator('[data-dd-filters]').click();
 await tab.playwright.locator('[data-dd-query]').fill('no-matching-synthetic-person');
 check('patient filter has a real empty state',await tab.playwright.locator('.dd-preview-table tbody tr').count()===0);
 await tab.playwright.locator('[data-dd-query]').fill('');
 await tab.playwright.locator('[data-dd-filters]').click();
 await tab.playwright.locator('[data-dd-mode="maternal"]').press('Control+k');
 check('Ctrl+K focuses search',await tab.playwright.evaluate(()=>document.activeElement?.id==='searchInput'));
 await tab.playwright.getByRole('button',{name:'About dashboard counts',exact:true}).press('Enter');
 check('keyboard source tooltip opens',await tab.playwright.locator('#dd-hero-source').isVisible());
 await tab.playwright.getByRole('button',{name:'About dashboard counts',exact:true}).press('Escape');
 check('Escape closes source tooltip',!await tab.playwright.locator('#dd-hero-source').isVisible());
 await tab.playwright.locator('#ddProfile > summary').click();
 check('team assignment remains in profile',await tab.playwright.locator('#ddProfile #dwUnitSelect').isVisible());
 await tab.playwright.locator('#ddProfile > summary').press('Escape');
 await tab.playwright.locator('[data-dd-reviews]').click();
 check('review decisions remain reachable',(await tab.playwright.locator('#doctorReviewRequests').getAttribute('open'))!==null);
 await tab.playwright.locator('#doctorReviewRequests > summary').click();
 await tab.playwright.locator('[data-dd-quick="note"]').click();
 check('quick actions reach a patient picker',await tab.playwright.locator('dialog.dd-patient-picker[open]').count()===1);
 await tab.playwright.locator('dialog.dd-patient-picker .ds-close').click();
 check('top five attention cap',await tab.playwright.locator('.dd-attention-list article').count()<=5);
 check('six roster preview cap',await tab.playwright.locator('.dd-preview-table tbody tr').count()<=6);
 check('no zero-filled line charts',await tab.playwright.locator('#doctorWorkspace .dw-chart').count()===0);
 for(const width of [1440,1024,390]) {
  await viewport.set({width,height:width===390?844:1000});
  const sizing=await tab.playwright.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));
  check('no page overflow at '+width,sizing.content<=sizing.width,sizing);
 }
 check('secondary widgets collapse on phone',await tab.playwright.evaluate(()=>!document.querySelector('.dd-more').open));
 for(const width of [1440,390])for(const mode of ['maternal','child'])for(const appearance of ['light','dark']) {
  await viewport.set({width,height:width===390?844:1000});
  await tab.playwright.locator('[data-dd-mode="'+mode+'"]').click();
  await theme(appearance);await top(mode);
  const metrics=await tab.playwright.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,view:document.querySelector('.dd-home').getAttribute('data-view'),words:document.querySelector('#panel-dashboard').innerText.split(/\s+/).filter(Boolean).length}));
  check('view and fit '+mode+' '+width+' '+appearance,metrics.view===mode&&metrics.pageWidth<=metrics.width,metrics);
  if(mode==='child')check('child ages stay unavailable '+width+' '+appearance,await tab.playwright.locator('.dd-stage:disabled').count()===4);
  await writeFile(outDir+'/after-'+mode+'-'+width+'-'+appearance+'.png',await tab.screenshot({fullPage:true}));
 }
 const errors=await tab.dev.logs({levels:['error'],limit:100});check('no browser console errors',errors.length===0,{errors});
 await writeFile(outDir+'/browser-checks.json',JSON.stringify({results},null,2)+'\n');
 return results;
 } finally {
 await theme(initialTheme||'light');await viewport.reset();
 await tab.playwright.locator('[data-dd-mode="maternal"]').click();await top('maternal');
 }
}
