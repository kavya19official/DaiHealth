"use client";
import { useCallback, useEffect, useState } from "react";
import { GoldenHourBoard } from "./golden-hour";
import { PatientRequestsPanel } from "./patient-requests";
import { ReferralInbox } from "./administration";
import styles from "./incoming-care.module.css";

type Api=(path:string,options?:RequestInit)=>Promise<any>;
type Tab="emergency"|"requests"|"handoffs";

export function IncomingCare({api,permissions,role,facilityId}:{api:Api;permissions:string[];role:string;facilityId:string}){
  const [tab,setTab]=useState<Tab>("emergency");
  const [counts,setCounts]=useState({emergency:0,requests:0,handoffs:0});
  const loadCounts=useCallback(async()=>{
    const results=await Promise.allSettled([
      api("/golden-hour/staff/incoming"),
      api("/demo-coordination/staff/requests"),
      api("/care-referrals"),
    ]);
    setCounts({
      emergency:results[0].status==="fulfilled"?(results[0].value.alerts||[]).filter((x:any)=>["incoming","seen","accepted"].includes(x.status)).length:0,
      requests:results[1].status==="fulfilled"?(results[1].value.requests||[]).filter((x:any)=>!["closed","cancelled","declined"].includes(x.status)).length:0,
      handoffs:results[2].status==="fulfilled"?(results[2].value.items||[]).filter((x:any)=>!["completed","rejected"].includes(x.status)).length:0,
    });
  },[api]);
  useEffect(()=>{loadCounts();},[loadCounts]);
  const tabs:[Tab,string,string][]=[
    ["emergency","Emergency arrivals","Pre-alerts before a patient reaches the hospital"],
    ["requests","Patient requests","Appointment and referral requests awaiting coordination"],
    ["handoffs","Facility transfers","Consented handovers from another care centre"],
  ];
  return <section className={styles.shell}>
    <div className={styles.intro}>
      <div><span>INCOMING CARE DESK</span><h2>Everything arriving at your hospital, in one place</h2><p>Start with the most time-sensitive item, review the handover, then record who is taking responsibility.</p></div>
      <div className={styles.flow}><strong>1. Review</strong><i/><strong>2. Assign</strong><i/><strong>3. Confirm</strong></div>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Incoming care type">
      {tabs.map(([id,label,help])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?styles.active:""} onClick={()=>setTab(id)}><span>{label}<b>{counts[id]}</b></span><small>{help}</small></button>)}
    </div>
    <div className={styles.content} onClick={()=>setTimeout(loadCounts,300)}>
      {tab==="emergency"&&<GoldenHourBoard api={api} permissions={permissions}/>} 
      {tab==="requests"&&<PatientRequestsPanel api={api} permissions={permissions}/>} 
      {tab==="handoffs"&&<ReferralInbox api={api} role={role} facilityId={facilityId}/>} 
    </div>
  </section>;
}
