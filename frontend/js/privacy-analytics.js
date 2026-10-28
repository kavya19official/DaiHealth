/* Verified-clinician aggregate reporting. Only suppressed/banded DTOs enter this view. */
(function () {
  'use strict';
  var root, defs, report, loading = false, busy = false, expiryTimer;
  var esc = function(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var $ = function(id) { return root.querySelector('#' + id); };
  var date = function(v) { return new Date(v).toLocaleString('en-IN', {timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); };
  async function request(path) {
    var res = await fetch((window.DaiAPI.API_BASE || '/api') + path, {credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)});
    var data = await res.json().catch(function(){return {};});
    if (!res.ok) throw Error(data.error || 'This report is unavailable. Please try again.');
    return data;
  }
  function message(text, error) { $('paStatus').textContent=text; $('paStatus').setAttribute('role',error?'alert':'status'); }
  function current() { return defs.metrics.find(function(m){return m.id===$('paMetric').value;}); }
  function query() { return 'metric='+encodeURIComponent($('paMetric').value)+'&group_by='+encodeURIComponent($('paGroup').value)+'&window='+encodeURIComponent($('paWindow').value); }
  function controls(disabled) { ['paMetric','paGroup','paWindow','paShow'].forEach(function(id){$(id).disabled=disabled;}); }
  function invalidate() {
    report=null;clearTimeout(expiryTimer);$('paExport').disabled=true;
    $('paResult').setAttribute('data-stale','true');
    message('Filters changed. Show report to load these results. The previous report below is out of date.');
  }
  function syncGroups() {
    var m=current();$('paGroup').innerHTML=m.group_by.map(function(g){return '<option value="'+esc(g)+'">'+(g==='area'?'District':'Facility')+'</option>';}).join('');
    $('paDefinition').innerHTML='<span class="pa-tag">'+esc(m.interpretation==='estimate'?'Estimate · not confirmed absence':'Recorded status')+'</span><h3>'+esc(m.label)+'</h3><p>'+esc(m.description)+'</p><p class="pa-muted">'+esc(m.caveat)+'</p><small>Source: '+esc(m.source)+'</small>';
  }
  function shell() {
    root.innerHTML='<header class="pa-heading"><div><span class="pa-eyebrow">CARE QUALITY · AGGREGATE REPORTS</span><h1>Population analytics</h1><p>Understand recorded care patterns while keeping individual patients out of this view.</p></div><span class="pa-privacy-badge">Privacy protected aggregates</span></header>'+
      '<div class="pa-scope"><strong>Network view</strong><span>'+esc(defs.scope)+'</span></div>'+
      '<form class="pa-filters" id="paFilters"><label for="paMetric">Measure<select id="paMetric">'+defs.metrics.map(function(m){return '<option value="'+esc(m.id)+'">'+esc(m.label)+'</option>';}).join('')+'</select></label><label for="paGroup">Group by<select id="paGroup"></select></label><label for="paWindow">Period<select id="paWindow">'+defs.windows.map(function(w){return '<option value="'+w+'"'+(w===90?' selected':'')+'>Last '+w+' days</option>';}).join('')+'</select></label><button type="submit" class="pa-primary" id="paShow">Show report</button><button type="button" id="paExport" disabled>Download shown CSV</button></form>'+
      '<section class="pa-definition" id="paDefinition" aria-label="Measure definition"></section><p id="paStatus" role="status" aria-live="polite"></p><div id="paResult"></div>'+
      '<details class="pa-method"><summary>Privacy rules & report methodology</summary><ul><li>Groups need at least '+defs.k_min+' distinct people. Smaller groups show no numeric values.</li><li>No overall patient or event total is published. People appear as bands; rare outcomes use broad rate bands.</li><li>Medians need valid durations from at least five distinct people. An outreach attempt does not prove contact or care completion.</li><li>Views and downloads are audited. Fixed periods limit arbitrary filtering; repeated reports may still reveal changes. Do not attempt to identify anyone.</li><li>CSV downloads use the exact report shown, valid for '+defs.snapshot_minutes+' minutes. Limit: '+defs.export_limit_per_day+' downloads per rolling 24 hours.</li></ul></details>';
    $('paFilters').addEventListener('submit',function(e){e.preventDefault();show();});
    $('paMetric').addEventListener('change',function(){syncGroups();invalidate();});
    ['paGroup','paWindow'].forEach(function(id){$(id).addEventListener('change',invalidate);});
    $('paExport').addEventListener('click',download);syncGroups();
  }
  function render(r) {
    var m=r.definition, median=r.metric==='time_to_follow_up'||r.metric==='referral_completion';
    var visible=r.rows.filter(function(x){return !x.suppressed;}).length;
    var out='<div class="pa-report-head"><div><h2>'+esc(m.label)+'</h2><p>'+esc(r.group_by==='area'?'By district':'By facility')+' · Last '+r.window_days+' days · Generated '+esc(date(r.generated_at))+' IST</p></div><span class="pa-tag">'+(m.interpretation==='estimate'?'Estimate':'Recorded data')+'</span></div>';
    out+='<div class="pa-summary"><article><small>Publishable groups</small><strong>'+visible+'</strong><span>Meeting the minimum group size</span></article><article><small>Privacy threshold</small><strong>'+r.k_min+' people</strong><span>Distinct people, not event count</span></article><article><small>Recent records excluded</small><strong>'+r.period.excluded_recent_days+' days</strong><span>'+(r.period.excluded_recent_days?'Allows time for follow-through':'Today and future visits excluded')+'</span></article></div>';
    if(r.data_quality.unassigned_facility)out+='<div class="pa-warning"><strong>Some records have no facility attribution.</strong> They stay in “No facility recorded”. This is a data-quality gap, not a facility name. '+esc(r.data_quality.notice)+'</div>';
    if(!r.rows.length)out+='<div class="pa-empty"><h3>No eligible records in this period</h3><p>This is not a zero rate. Try a longer period or another measure. No example outcomes have been inserted.</p></div>';
    else {
      if(!visible)out+='<div class="pa-warning">All groups are below the privacy threshold. Numeric results are hidden.</div>';
      out+='<div class="pa-table-scroll" role="region" aria-label="Aggregate report" tabindex="0"><table><caption>Only publishable aggregate values; no overall patient total.</caption><thead><tr><th scope="col">'+(r.group_by==='area'?'District':'Facility')+'</th><th scope="col">Distinct people (band)</th><th scope="col">'+esc(m.rate_label)+'</th>'+(median?'<th scope="col">Median recorded time</th>':'')+'</tr></thead><tbody>';
      r.rows.forEach(function(x){out+='<tr><th scope="row">'+esc(x.label)+'</th>';if(x.suppressed){out+='<td colspan="'+(median?3:2)+'"><span class="pa-tag pa-suppressed">Hidden · '+esc(x.reason)+'</span></td>';}else{out+='<td>'+esc(x.people_band)+'</td><td><strong class="pa-rate">'+esc(x.rate_text)+'</strong>'+(x.rate_pct===null?'<small class="pa-muted">Privacy band · exact rate withheld</small>':'')+'</td>'+(median?'<td>'+(x.median_days==null?'<span class="pa-muted">'+esc(x.median_note)+'</span>':esc(x.median_days)+' days')+'</td>':'');}out+='</tr>';});out+='</tbody></table></div>';
    }
    out+='<p class="pa-footnote">'+esc(m.caveat)+' '+esc(r.period.basis)+'. Download expires '+esc(date(r.expires_at))+' IST. Rates use recorded events; the people column shows distinct individuals.</p>';
    $('paResult').innerHTML=out;$('paResult').removeAttribute('data-stale');
  }
  async function show() {
    if(busy)return;busy=true;report=null;clearTimeout(expiryTimer);controls(true);$('paExport').disabled=true;$('paResult').setAttribute('aria-busy','true');message('Loading recorded aggregates…');
    try {var r=await request('/analytics/report?'+query());report=r;render(r);$('paExport').disabled=false;message('Report ready. CSV will contain these exact aggregate rows.');expiryTimer=setTimeout(function(){report=null;$('paExport').disabled=true;message('Download expired. Show report again to refresh the data.');},Math.max(0,new Date(r.expires_at)-Date.now()));}
    catch(e){$('paResult').innerHTML='<div class="pa-empty"><h3>Report unavailable</h3><p>'+esc(e.message)+'</p></div>';message(e.message,true);}
    finally {busy=false;controls(false);$('paResult').setAttribute('aria-busy','false');}
  }
  async function download() {
    if(!report||busy)return;busy=true;controls(true);$('paExport').disabled=true;var shown=report;
    try {
      var res=await fetch((window.DaiAPI.API_BASE||'/api')+'/analytics/export.csv?report_id='+encodeURIComponent(shown.report_id),{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!res.ok){var err=await res.json().catch(function(){return {};});if(res.status===410)report=null;throw Error(err.error||'Download unavailable.');}
      var blob=await res.blob(),link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='dai-'+shown.metric+'-'+shown.window_days+'d.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);message('Downloaded the displayed report. This download was recorded.');
    }catch(e){message(e.message,true);}finally{busy=false;controls(false);$('paExport').disabled=!report;}
  }
  async function load() {
    root=document.getElementById('dwPopulation');if(!root||loading||defs)return;loading=true;root.classList.add('pa-panel');root.innerHTML='<p role="status">Loading report definitions…</p>';
    try{defs=await request('/analytics/metrics');shell();await show();}catch(e){root.innerHTML='<div class="pa-empty"><h2>Population analytics unavailable</h2><p>'+esc(e.message)+'</p><button type="button" id="paRetry">Try again</button></div>';root.querySelector('#paRetry').onclick=load;}finally{loading=false;}
  }
  window.PrivacyAnalytics={load:load};
})();
