"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./clinical-monitor.module.css";

type API = (path: string, options?: RequestInit) => Promise<unknown>;
type Evidence = {source:string;record_id:string;date:string|null;values:Record<string,string|number|null>};
type Flag = {id:string;mother_id:string;patient_name:string;priority:number;summary:string;action:string;
  evidence:Evidence[];fingerprint:string;rule_version:string;reference_url:string;reviewed_at:string|null;
  review_note:string|null;as_of:string};
type Queue = {items:Flag[];has_more:boolean;last_scan:string|null};
type Snapshot = {as_of:string;coverage:{eligible:boolean;synthetic:boolean;anchor_source?:string;anc_visits?:number;
  paired_bp?:number;finalized_reports?:number;glucose_context_records?:number;weight_reference_available?:boolean};
  trends:{trimester:number;dates:number;first_date:string;last_date:string;change_kg:number|null;
    kg_per_week:number|null;evidence:Evidence[]}[]};

const levels = ["", "Routine", "High", "Urgent"];
const errorText = (error:unknown) => error instanceof Error ? error.message : "Could not load monitoring records.";

function SourceRows({items}:{items:Evidence[]}) {
  return <ol className={styles.evidence}>{items.map((item)=><li key={item.source+item.record_id}>
    <strong>{item.source}</strong> {item.date && <time>{item.date}</time>}
    <code>{item.record_id}</code>
    <div>{Object.entries(item.values).filter(([,value])=>value!==null).map(([key,value])=>
      <span key={key}><b>{key.replaceAll("_"," ")}:</b> {value}</span>)}</div>
  </li>)}</ol>;
}

export function PatientMonitoring({api,motherId}:{api:API;motherId:string}) {
  const [snapshot,setSnapshot] = useState<Snapshot|null>(null);
  const [error,setError] = useState("");
  useEffect(()=>{
    let mounted = true;
    api("/clinical-monitor/patients/"+motherId)
      .then(result=>{if(mounted)setSnapshot((result as {snapshot:Snapshot}).snapshot);})
      .catch(e=>{if(mounted)setError((e as {status?:number}).status===404 ?
        "No monitoring snapshot is available for this patient." : errorText(e));});
    return ()=>{mounted=false;};
  },[api,motherId]);
  if(!snapshot) return <p role={error?"status":undefined}>{error||"Loading observation coverage…"}</p>;
  const c=snapshot.coverage;
  return <section className={styles.snapshot}>
    <h3>Monitoring coverage</h3>
    <p>Records through {snapshot.as_of}{c.synthetic?" · synthetic snapshot":""}{c.anchor_source?" · "+c.anchor_source:""}</p>
    {!c.eligible ? <p>No active antenatal episode with valid recorded dating was available.</p> : <>
      <p>{c.anc_visits} dated ANC visits · {c.paired_bp} paired blood pressure readings · {c.glucose_context_records} glucose records with context · {c.finalized_reports} completed reports</p>
      {!c.weight_reference_available && <p>Weight changes are descriptive. A recorded prepregnancy BMI and singleton status are needed for reference comparison.</p>}
      {snapshot.trends.length===0 && <p>No dated pregnancy weights were available.</p>}
      {snapshot.trends.map(trend=><details key={trend.trimester}>
        <summary>Trimester {trend.trimester} · {trend.dates} observation day(s) · {trend.change_kg===null?"Change unavailable":`${trend.change_kg} kg change · ${trend.kg_per_week} kg/week`}</summary>
        <p>{trend.first_date} to {trend.last_date}</p>
        <SourceRows items={trend.evidence}/>
      </details>)}
    </>}
  </section>;
}

export function ClinicalMonitoring({api,canReview,openPatient}:{api:API;canReview:boolean;openPatient:(id:string)=>Promise<void>}) {
  const [priority,setPriority] = useState("all");
  const [reviewed,setReviewed] = useState(false);
  const [offset,setOffset] = useState(0);
  const [data,setData] = useState<Queue|null>(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState("");
  const [coverage,setCoverage] = useState("");
  const sequence=useRef(0);
  const load=useCallback(async()=>{
    const current=++sequence.current;
    try{
      const result=await api("/clinical-monitor?"+new URLSearchParams({priority,reviewed:String(reviewed),offset:String(offset)})) as Queue;
      if(current===sequence.current){setData(result);setError("");}
    }catch(e){if(current===sequence.current){setError(errorText(e));setData(null);}}
  },[api,priority,reviewed,offset]);
  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},30000);
    return ()=>{window.clearInterval(timer);sequence.current++;};
  },[load]);
  function change(filter:()=>void){setData(null);setCoverage("");setOffset(0);filter();}
  async function acknowledge(item:Flag,note:string) {
    setBusy(item.id);setNotice("");
    try{
      await api("/clinical-monitor/flags/"+item.id+"/review",{method:"POST",
        body:JSON.stringify({fingerprint:item.fingerprint,disposition:"reviewed",note})});
      await load();setNotice("Review recorded for this evidence version.");
    }catch(e){setError(errorText(e));}
    finally{setBusy("");}
  }
  return <section className={styles.panel} aria-label="Clinical monitoring">
    <div className={styles.toolbar}>
      <label>Priority <select value={priority} onChange={e=>change(()=>setPriority(e.target.value))}>
        <option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="routine">Routine</option>
      </select></label>
      <label>Review state <select value={String(reviewed)} onChange={e=>change(()=>setReviewed(e.target.value==="true"))}>
        <option value="false">Needs review</option><option value="true">Reviewed</option>
      </select></label>
      <button type="button" onClick={()=>void load()}>Refresh queue</button>
    </div>
    <p>Clinical review required. Flags summarize recorded evidence and do not change the diagnosis, care plan, or confirmed risk status.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data && <p>{data.last_scan?"Latest scan in your scope "+new Date(data.last_scan).toLocaleString():"No completed scan in your scope."}</p>}
    {!data && !error && <p role="status">Loading review queue…</p>}
    {data?.items.length===0 && <p>No flags in this view. A clear queue does not establish that all observations are available.</p>}
    {data?.items.map(item=><article key={item.id} className={styles.flag} data-level={item.priority}>
      <header><strong>{levels[item.priority]} · {item.reviewed_at?"Reviewed":"Needs review"}</strong><span>Records through {item.as_of}</span></header>
      <h3>{item.patient_name}</h3><p>{item.summary}</p><p><strong>Review step</strong> {item.action}</p>
      <details><summary>Recorded evidence</summary><SourceRows items={item.evidence}/>
        <p>Rule {item.rule_version} {item.reference_url&&<a href={item.reference_url} target="_blank" rel="noreferrer">Open guideline</a>}</p>
      </details>
      <div className={styles.toolbar}>
        <button type="button" onClick={()=>setCoverage(coverage===item.id?"":item.id)}>{coverage===item.id?"Hide coverage":"View weight and observation coverage"}</button>
        <button type="button" onClick={()=>openPatient(item.mother_id).catch(e=>setError(errorText(e)))}>Open patient record</button>
      </div>
      {coverage===item.id && <PatientMonitoring key={item.mother_id} api={api} motherId={item.mother_id}/>}
      {item.review_note && <p><strong>Clinician review note</strong> {item.review_note}</p>}
      {canReview && !item.reviewed_at && <form key={item.fingerprint} onSubmit={event=>{
        event.preventDefault();const note=(new FormData(event.currentTarget)).get("note");
        if(typeof note==="string")void acknowledge(item,note);
      }}><label>Review note <textarea name="note" minLength={5} maxLength={500} required/></label>
        <button type="submit" disabled={Boolean(busy)}>{busy===item.id?"Saving…":"Record clinical review"}</button></form>}
    </article>)}
    {(offset>0 || data?.has_more) && <nav className={styles.toolbar} aria-label="Monitoring pages">
      <button type="button" disabled={!offset} onClick={()=>{setData(null);setOffset(offset-25);}}>Previous</button>
      <button type="button" disabled={!data?.has_more} onClick={()=>{setData(null);setOffset(offset+25);}}>Next</button>
    </nav>}
  </section>;
}
