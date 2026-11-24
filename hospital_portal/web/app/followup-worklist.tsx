"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import styles from "./followup-worklist.module.css";
type Row=Record<string,any>; type Api=(path:string,options?:RequestInit)=>Promise<any>;
const nice=(v:string)=>String(v||"").replaceAll("_"," ");

export function FollowupWorklist({api,permissions,userId}:{api:Api;permissions:string[];userId:string}){
 const [data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[filter,setFilter]=useState("open");
 const load=useCallback(async()=>{try{const [requests,tasks]=await Promise.all([api('/demo-coordination/staff/requests'),api('/demo-coordination/staff/followups')]);setData({...requests,...tasks});setError('');}catch(e){setError((e as Error).message)}},[api]);
 useEffect(()=>{load()},[load]);
 const tasks:Row[]=data?.tasks||[]; const today=new Date().toLocaleDateString('en-CA');
 const metrics=useMemo(()=>({overdue:tasks.filter(t=>t.due_date<today&&!['closed','cancelled'].includes(t.status)).length,due:tasks.filter(t=>t.due_date===today&&!['closed','cancelled'].includes(t.status)).length,open:tasks.filter(t=>!['closed','cancelled'].includes(t.status)).length,done:tasks.filter(t=>t.status==='closed').length}),[tasks,today]);
 const visible=tasks.filter(t=>filter==='all'||filter==='done'?(filter==='all'||t.status==='closed'):!['closed','cancelled'].includes(t.status));
 async function action(t:Row,name:string){setBusy(true);try{await api('/demo-coordination/staff/followups/'+t.id+'/actions',{method:'POST',body:JSON.stringify({version:t.version,action:name,public_note:name==='complete'?'Follow-up reviewed and completed by the care team.':'Follow-up reopened for coordination.',evidence_ref:name==='complete'?'Demo care-team review':''})});setMessage('Follow-up updated. The patient timeline now shows the same status.');await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className={styles.shell}>
  <div className={styles.hero}><div><span>SHARED FOLLOW-UP WORKLIST</span><h2>Know what is due, who owns it, and what happens next</h2><p>Every task below is connected to a patient request. Updates saved here are reflected on the patient side.</p></div><button onClick={load}>Refresh worklist</button></div>
  <div className={styles.metrics}>{[[metrics.overdue,'Overdue','Needs action'],[metrics.due,'Due today','Plan today'],[metrics.open,'Open','In progress'],[metrics.done,'Completed','Recorded']].map(([n,l,s])=><article key={String(l)}><strong>{n}</strong><div><b>{l}</b><small>{s}</small></div></article>)}</div>
  <div className={styles.toolbar}><h3>Patient follow-ups</h3><div>{[['open','Open'],['done','Completed'],['all','All']].map(([id,l])=><button key={id} className={filter===id?styles.selected:''} onClick={()=>setFilter(id)}>{l}</button>)}</div></div>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.notice}>{message}</p>}
  <div className={styles.list}>{visible.map(t=><article key={t.id} className={styles.task}>
    <div className={styles.patient}><span>{t.patient_name?.split(' ').map((x:string)=>x[0]).join('').slice(0,2)}</span><div><strong>{t.patient_name}</strong><small>{t.facility_name}</small></div></div>
    <div className={styles.main}><div><span className={styles.status}>{nice(t.status)}</span><span className={t.due_date<today?styles.late:styles.date}>Due {new Date(t.due_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span></div><h4>{t.title}</h4><p>{t.public_note}</p><small>Owner: <b>{t.owner_name}</b></small></div>
    <div className={styles.actions}>{permissions.includes('coordination.write')&&(t.assigned_to===userId||permissions.includes('user.verify'))&&(!['closed','cancelled'].includes(t.status)?<button disabled={busy} onClick={()=>action(t,'complete')}>Mark completed</button>:<button disabled={busy} onClick={()=>action(t,'reopen')}>Reopen</button>)}</div>
  </article>)}</div>
  {!visible.length&&<div className={styles.empty}><strong>No tasks in this view</strong><p>Choose another filter to see the connected synthetic follow-up journey.</p></div>}
 </section>
}
