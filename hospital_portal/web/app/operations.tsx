"use client";
import { useState } from "react";
import { CareGapMap } from "./care-gap-map";
type Row = Record<string, any>;
const nice = (v: unknown) => String(v ?? "—").replaceAll("_", " ");
const name = (v: string) =>
  v
    ?.replace("DAI SYNTHETIC ", "DAI · ")
    .replace("Dr SYNTHETIC ", "Dr. ")
    .replace(/^SYNTHETIC /, "") || "—";
const count = (v: unknown) => Number(v || 0).toLocaleString("en-IN");
const date = (v: string) =>
  v
    ? new Date(v.slice(0, 10) + "T12:00:00").toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
    : "—";
const state = (v: unknown) => {
  const text = nice(v);
  return (
    <span
      className={
        "pill " +
        (/available|functional|given|done|responded|attended/i.test(text)
          ? "green"
          : /maintenance|overdue|missed|rejected|non-functional/i.test(text)
            ? "amber"
            : "neutral")
      }
    >
      {text}
    </span>
  );
};
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-scroll" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v ?? "—"}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                <div className="empty">
                  No recorded events for your permitted scope.
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Card({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metric({
  title,
  value,
  detail,
  color = "purple",
}: {
  title: string;
  value: unknown;
  detail: string;
  color?: string;
}) {
  return (
    <section className={"card metric metric-" + color}>
      <span>{title}</span>
      <strong>{String(value ?? "—")}</strong>
      <small>{detail}</small>
    </section>
  );
}

function CensusExplorer({ rows, snapshotAt }: { rows: Row[]; snapshotAt?: string }) {
  const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const [period, setPeriod] = useState("7");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activity, setActivity] = useState("all");
  const baseRows = period === "all" ? ordered : ordered.slice(-Number(period));
  const visibleRows = baseRows.filter((row) => {
    const day = String(row.date || "").slice(0, 10);
    const hasActivity = ["admissions", "discharges", "referrals_in", "referrals_out", "deliveries"]
      .some((key) => Number(row[key] || 0) > 0);
    return (!fromDate || day >= fromDate) && (!toDate || day <= toDate) && (activity === "all" || hasActivity);
  });
  const sum = (key: string) => visibleRows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const latest = visibleRows[visibleRows.length - 1];
  const totals = {
    admissions: sum("admissions"),
    discharges: sum("discharges"),
    referrals: sum("referrals_in") + sum("referrals_out"),
    deliveries: sum("deliveries"),
  };
  const trendRows = visibleRows.slice(-14);
  const trendMax = Math.max(1, ...trendRows.flatMap((row) => [Number(row.admissions || 0), Number(row.discharges || 0), Number(row.deliveries || 0)]));
  const formatDay = (value: string, withYear = true) => new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  const clearDates = () => { setFromDate(""); setToDate(""); };
  const value = (amount: unknown) => <strong className={Number(amount || 0) ? "census-value active" : "census-value"}>{Number(amount || 0).toLocaleString("en-IN")}</strong>;

  return <section className="census-workspace">
    <header className="census-intro">
      <div><span className="eyebrow">RECORDED OPERATIONS</span><h2>Understand daily activity at a glance</h2><p>Review patient movement and delivery activity separately, then use the date controls to focus on the period you need.</p></div>
      <div className="census-data-state"><span className="dot"/><strong>Recorded snapshot</strong><small>{snapshotAt ? formatDay(snapshotAt) : "Snapshot date unavailable"} · Read only</small></div>
    </header>

    <div className="census-controls card">
      <div className="census-periods" aria-label="Date period">
        {["7", "14", "30", "all"].map((option) => <button key={option} className={period === option && !fromDate && !toDate ? "active" : ""} onClick={() => { setPeriod(option); clearDates(); }}>{option === "all" ? "All records" : `Last ${option} days`}</button>)}
      </div>
      <label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPeriod("all"); }}/></label>
      <label>To<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPeriod("all"); }}/></label>
      <label>Activity<select value={activity} onChange={(event) => setActivity(event.target.value)}><option value="all">All recorded days</option><option value="active">Days with activity</option></select></label>
      {(fromDate || toDate || activity !== "all") && <button className="census-clear" onClick={() => { clearDates(); setPeriod("7"); setActivity("all"); }}>Clear filters</button>}
    </div>

    <div className="census-metrics">
      <article><span>Admissions</span><strong>{totals.admissions}</strong><small>During selected period</small></article>
      <article><span>Discharges</span><strong>{totals.discharges}</strong><small>During selected period</small></article>
      <article><span>Referrals</span><strong>{totals.referrals}</strong><small>{sum("referrals_in")} in · {sum("referrals_out")} out</small></article>
      <article><span>Deliveries</span><strong>{totals.deliveries}</strong><small>{latest ? `Latest recorded day: ${formatDay(String(latest.date), false)}` : "No matching records"}</small></article>
    </div>

    <section className="census-trend card">
      <header><div><h2>Activity trend</h2><p>Latest {trendRows.length} matching days. Hover a bar to inspect its value.</p></div><div className="census-legend"><span><i className="admissions"/>Admissions</span><span><i className="discharges"/>Discharges</span><span><i className="deliveries"/>Deliveries</span></div></header>
      {trendRows.length ? <div className="census-chart" style={{ gridTemplateColumns: `repeat(${trendRows.length}, minmax(42px, 1fr))` }}>
        {trendRows.map((row) => <div className="census-chart-day" key={row.date}>
          <div className="census-bars">
            <i className="admissions" title={`${row.admissions || 0} admissions`} style={{ height: `${Math.max(Number(row.admissions || 0) ? 8 : 2, Number(row.admissions || 0) / trendMax * 100)}%` }}/>
            <i className="discharges" title={`${row.discharges || 0} discharges`} style={{ height: `${Math.max(Number(row.discharges || 0) ? 8 : 2, Number(row.discharges || 0) / trendMax * 100)}%` }}/>
            <i className="deliveries" title={`${row.deliveries || 0} deliveries`} style={{ height: `${Math.max(Number(row.deliveries || 0) ? 8 : 2, Number(row.deliveries || 0) / trendMax * 100)}%` }}/>
          </div>
          <span>{formatDay(String(row.date), false)}</span>
        </div>)}
      </div> : <div className="empty">No activity matches the selected period.</div>}
    </section>

    <div className="census-table-grid">
      <section className="card census-table-card">
        <header><div><span className="eyebrow">PATIENT FLOW</span><h2>Admissions, discharges & referrals</h2></div><span>{visibleRows.length} days</span></header>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Admissions</th><th>Discharges</th><th>Referrals in</th><th>Referrals out</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.date}><td>{formatDay(String(row.date))}</td><td>{value(row.admissions)}</td><td>{value(row.discharges)}</td><td>{value(row.referrals_in)}</td><td>{value(row.referrals_out)}</td></tr>) : <tr><td colSpan={5}><div className="empty">No patient-flow records match these filters.</div></td></tr>}</tbody></table></div>
      </section>
      <section className="card census-table-card">
        <header><div><span className="eyebrow">DELIVERY ACTIVITY</span><h2>Deliveries by mode</h2></div><span>{totals.deliveries} total</span></header>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Total</th><th>Normal</th><th>Assisted</th><th>Elective LSCS</th><th>Emergency LSCS</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.date}><td>{formatDay(String(row.date))}</td><td>{value(row.deliveries)}</td><td>{value(row.normal)}</td><td>{value(row.assisted)}</td><td>{value(row.elective_lscs)}</td><td>{value(row.emergency_lscs)}</td></tr>) : <tr><td colSpan={6}><div className="empty">No delivery records match these filters.</div></td></tr>}</tbody></table></div>
      </section>
    </div>
    <p className="census-footnote">This page reports recorded operational events. It does not forecast demand or reserve beds, staff, theatres or transport.</p>
  </section>;
}

function CapacityExplorer({ rows, navigate }: { rows: Row[]; navigate: (view:string)=>void }) {
  const groups = Array.from(new Set(rows.map((row) => String(row.resource || "Other"))));
  const [selected, setSelected] = useState(groups[0] || "");
  const [query,setQuery]=useState(""),[groupFilter,setGroupFilter]=useState(""),[locationFilter,setLocationFilter]=useState(""),[availability,setAvailability]=useState("all");
  const selectedRows = rows.filter((row) => String(row.resource || "Other") === selected);
  const category = (location:string) => selected === "Beds" ? (/^ward/i.test(location)?"General wards":/nicu|picu|hdu|ccu/i.test(location)?"Critical-care units":/labour|lr-/i.test(location)?"Labour rooms":"Other care areas") : selected === "Blood" ? location.split(" · ")[0] : "All locations";
  const categories=Array.from(new Set(selectedRows.map(row=>category(String(row.location))))).sort();
  const locationValue=(location:string)=>selected==="Blood"?location.split(" · ").slice(1).join(" · ")||location:location;
  const locations=Array.from(new Set(selectedRows.filter(row=>!groupFilter||category(String(row.location))===groupFilter).map(row=>locationValue(String(row.location))))).sort();
  const visible = selectedRows.filter((row)=>String(row.location).toLowerCase().includes(query.toLowerCase())&&(!groupFilter||category(String(row.location))===groupFilter)&&(!locationFilter||locationValue(String(row.location))===locationFilter)&&(availability==="all"||(availability==="available"&&Number(row.recorded_available)>0)||(availability==="none"&&Number(row.recorded_available)===0)));
  const reset=()=>{setQuery("");setGroupFilter("");setLocationFilter("");setAvailability("all")};
  return (
    <section className="resource-explorer">
      <header className="explorer-intro">
        <div><span className="eyebrow">RESOURCE OVERVIEW</span><h2>What capacity do you want to check?</h2><p>Choose one resource group first. Details appear only for that group, so teams can find what they need quickly.</p></div>
        <div className="explorer-guide"><b>1</b> Choose a group <i /> <b>2</b> Review availability <i /> <b>3</b> Confirm with the team</div>
      </header>
      <div className="resource-groups">
        {groups.map((group) => {
          const items = rows.filter((row) => String(row.resource || "Other") === group);
          const available = items.reduce((sum, row) => sum + Number(row.recorded_available || 0), 0);
          return <button key={group} className={selected === group ? "active" : ""} onClick={() => {setSelected(group);reset()}}>
            <span>{group === "Beds" ? "▱" : group === "Blood" ? "♦" : group === "Staff" ? "♧" : "✚"}</span>
            <strong>{nice(group)}</strong><small>{items.length} recorded locations</small><b>{count(available)} available</b>
          </button>;
        })}
      </div>
      <section className="explorer-detail card">
        <div className="card-head"><div><span className="eyebrow">SELECTED RESOURCE</span><h2>{nice(selected)}</h2><p>Search a ward, blood group, component, staff member or recorded location.</p></div><span className="pill neutral">Confirm before transfer</span></div>
        <div className="quick-filter-bar capacity-filters"><label className="filter-search">Search {selected.toLowerCase()}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={selected==="Beds"?"Enter ward name or number…":selected==="Blood"?"Enter A+, O-, plasma, platelets…":"Enter location, role or name…"}/></label><label>{selected==="Beds"?"Ward group":selected==="Blood"?"Blood group":"Location group"}<select value={groupFilter} onChange={e=>{setGroupFilter(e.target.value);setLocationFilter("")}}><option value="">All groups</option>{categories.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>{selected==="Blood"?"Blood component":"Exact location"}<select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All {selected==="Blood"?"components":"locations"}</option>{locations.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Availability<select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">All records</option><option value="available">Available only</option><option value="none">Not available</option></select></label>{(query||groupFilter||locationFilter||availability!=="all")&&<button onClick={reset}>Clear filters</button>}</div>
        {selected==="Beds"&&<div className="bed-search-note"><div><strong>Need an exact bed serial number?</strong><span>This capacity view contains ward totals. Open the bed board to search individual bed IDs and see whether each bed is available.</span></div><button onClick={()=>navigate("beds")}>Search individual beds</button></div>}
        <div className="capacity-detail-grid">
          {visible.map((row, index) => <article key={index}>
            <div><strong>{row.location}</strong><small>Last confirmed {row.last_confirmed ? date(row.last_confirmed) : "not recorded"}</small></div>
            <b>{row.recorded_available ?? "—"}</b>
            <p>{row.basis}</p>
          </article>)}
        </div>
        {!visible.length && <div className="empty">No records match these filters. Clear or change a filter to continue.</div>}
      </section>
    </section>
  );
}

function CriticalCareExplorer({ units, admissions }: { units: Row[]; admissions: Row[] }) {
  const [selected, setSelected] = useState(units[0]?.name || "");
  const [query,setQuery]=useState(""),[careType,setCareType]=useState(""),[bedStatus,setBedStatus]=useState("all"),[admissionStatus,setAdmissionStatus]=useState("all");
  const careCategory=(name:string)=>/obstetric|obg/i.test(name)?"Maternal critical care":/nicu/i.test(name)?"Newborn intensive care":/picu|paediatric/i.test(name)?"Child critical care":"Other specialist care";
  const filteredUnits=units.filter(row=>String(row.name).toLowerCase().includes(query.toLowerCase())&&(!careType||careCategory(row.name)===careType)&&(bedStatus==="all"||(bedStatus==="available"&&Number(row.available)>0)||(bedStatus==="full"&&Number(row.available)===0)));
  const unit = filteredUnits.find((row) => row.name === selected) || filteredUnits[0];
  const occupancy = unit?.capacity ? Math.round((unit.occupied / unit.capacity) * 100) : 0;
  const related = admissions.filter((row) => row.ward === unit?.name&&(admissionStatus==="all"||(admissionStatus==="current"&&!row.discharged_at)||(admissionStatus==="discharged"&&row.discharged_at)));
  const categories = [
    ["Maternal critical care", units.filter((row) => /obstetric|obg/i.test(row.name))],
    ["Newborn intensive care", units.filter((row) => /nicu/i.test(row.name))],
    ["Child critical care", units.filter((row) => /picu|paediatric/i.test(row.name))],
  ] as [string, Row[]][];
  return <section className="critical-explorer">
    <header className="explorer-intro"><div><span className="eyebrow">CRITICAL & NEONATAL CARE</span><h2>Choose the type of specialist care</h2><p>Units are grouped by who they care for. Select a unit to see beds, equipment and its admission activity.</p></div><div className="critical-total"><strong>{units.reduce((sum,row)=>sum+Number(row.available||0),0)}</strong><span>beds recorded available across specialist units</span></div></header>
    <div className="quick-filter-bar critical-filters"><label className="filter-search">Search unit or ward<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search NICU, PICU, HDU…"/></label><label>Care group<select value={careType} onChange={e=>setCareType(e.target.value)}><option value="">All care groups</option>{Array.from(new Set(units.map(row=>careCategory(row.name)))).map(value=><option key={value}>{value}</option>)}</select></label><label>Bed availability<select value={bedStatus} onChange={e=>setBedStatus(e.target.value)}><option value="all">All units</option><option value="available">Beds available</option><option value="full">At capacity</option></select></label>{(query||careType||bedStatus!=="all")&&<button onClick={()=>{setQuery("");setCareType("");setBedStatus("all")}}>Clear filters</button>}</div>
    {!unit&&<div className="empty">No specialist units match these filters.</div>}
    {unit&&<>
    <div className="critical-layout">
      <aside className="critical-groups">
        {categories.map(([label])=>[label,filteredUnits.filter(row=>careCategory(row.name)===label)] as [string,Row[]]).filter(([,items])=>items.length).map(([label,items])=><section key={label}><h3>{label}</h3>{items.map((row)=><button key={row.name} className={unit.name===row.name?"active":""} onClick={()=>setSelected(row.name)}><span><strong>{row.name}</strong><small>{row.available} beds available</small></span><b>{row.occupied}/{row.capacity}</b></button>)}</section>)}
      </aside>
      <section className="critical-detail card">
        <div className="card-head"><div><span className="eyebrow">SELECTED UNIT</span><h2>{unit.name}</h2><p>A focused snapshot of this care location.</p></div><span className={"readiness-state "+(occupancy>=95?"full":occupancy>=85?"busy":"ready")}>{occupancy>=95?"At capacity":occupancy>=85?"Limited capacity":"Capacity available"}</span></div><div className="critical-metrics"><article><strong>{unit.available}</strong><span>Available beds</span></article><article><strong>{unit.occupied}</strong><span>Occupied beds</span></article><article><strong>{unit.ventilators||0}</strong><span>Functional ventilators</span></article><article><strong>{occupancy}%</strong><span>Occupancy</span></article></div><div className="capacity-track large"><i style={{width:occupancy+"%"}} /></div>
        <div className="unit-admissions"><div className="subsection-filter"><h3>Admissions in this unit <span>{related.length}</span></h3><label>Show<select value={admissionStatus} onChange={e=>setAdmissionStatus(e.target.value)}><option value="all">All admissions</option><option value="current">Currently admitted</option><option value="discharged">Discharged</option></select></label></div>{related.slice(0,8).map((row)=><article key={row.admission_id}><div><strong>{row.admission_id}</strong><small>Admitted {date(row.admitted_at)}</small></div><span>{row.discharged_at?"Discharged":"Currently admitted"}</span><p>{nice(row.admission_reason)}</p></article>)}{!related.length&&<div className="empty">No admissions match this filter.</div>}</div>
      </section>
    </div>
    </>}
  </section>;
}

function DiagnosticsExplorer({ rows }: { rows: Row[] }) {
  type PatientReports = { id: string; name: string; reports: Row[] };
  const grouped = new Map<string, PatientReports>();
  rows.forEach((row) => {
    const key = String(row.portal_mother_id || row.mother_name);
    const current: PatientReports = grouped.get(key) || { id: key, name: row.mother_name, reports: [] };
    current.reports.push(row);
    grouped.set(key, current);
  });
  const patients: PatientReports[] = Array.from(grouped.values());
  const [selected, setSelected] = useState<string>(patients[0]?.id || "");
  const [query,setQuery]=useState(""),[reportStatus,setReportStatus]=useState("all");
  const filteredPatients=patients.filter(item=>(name(item.name)+" "+item.id).toLowerCase().includes(query.toLowerCase())&&(reportStatus==="all"||(reportStatus==="attention"&&item.reports.some(row=>/abnormal|critical/i.test(row.result_flag)))||(reportStatus==="pending"&&item.reports.some(row=>!/done|completed/i.test(row.status)))||(reportStatus==="complete"&&item.reports.every(row=>/done|completed/i.test(row.status)))));
  const patient = filteredPatients.find((item) => item.id === selected) || filteredPatients[0];
  return <section className="diagnostics-explorer">
    <header className="explorer-intro"><div><span className="eyebrow">PATIENT REPORT OVERVIEW</span><h2>Select a patient, then review their tests</h2><p>Each patient appears once. Open their profile to see completed, pending and attention-needed reports.</p></div><div className="diagnostic-summary"><strong>{patients.length}</strong><span>patients with recorded investigations</span></div></header>
    <div className="quick-filter-bar diagnostic-filters"><label className="filter-search">Search patient name or ID<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Enter patient name, UHID or serial number…"/></label><label>Report status<select value={reportStatus} onChange={e=>setReportStatus(e.target.value)}><option value="all">All patients</option><option value="attention">Needs review</option><option value="pending">Has pending tests</option><option value="complete">All tests completed</option></select></label>{(query||reportStatus!=="all")&&<button onClick={()=>{setQuery("");setReportStatus("all")}}>Clear filters</button>}</div>
    <div className="diagnostic-layout">
      <aside className="patient-report-list">{filteredPatients.map((item)=>{const done=item.reports.filter(r=>/done|completed/i.test(r.status)).length;const attention=item.reports.filter(r=>/abnormal|critical/i.test(r.result_flag)).length;return <button key={item.id} className={patient?.id===item.id?"active":""} onClick={()=>setSelected(item.id)}><span className="patient-initials">{name(item.name).split(" ").map(x=>x[0]).join("").slice(0,2)}</span><span><strong>{name(item.name)}</strong><small>{item.id} · {done} of {item.reports.length} completed</small></span>{attention>0&&<b>{attention} needs review</b>}</button>})}{!filteredPatients.length&&<div className="empty">No patient matches this search.</div>}</aside>
      {patient&&<section className="patient-report-detail card"><div className="card-head"><div><span className="eyebrow">SELECTED PATIENT</span><h2>{name(patient.name)}</h2><p>{patient.reports.length} recorded tests in this care journey.</p></div><div className="report-progress"><strong>{patient.reports.filter(r=>/done|completed/i.test(r.status)).length}/{patient.reports.length}</strong><span>completed</span></div></div><div className="report-cards">{patient.reports.map((row)=><article key={row.investigation_id}><div><strong>{nice(row.test_type)}</strong>{state(row.status)}</div><p>Ordered {date(row.ordered_date)} · Due {date(row.due_date)}</p><footer><span>{row.completed_date?"Completed "+date(row.completed_date):"Result pending"}</span><b className={/abnormal|critical/i.test(row.result_flag)?"attention":""}>{nice(row.result_flag||"No result yet")}</b></footer></article>)}</div></section>}
    </div>
  </section>;
}

function DeliveryReadinessExplorer({ rows, summary, services }: { rows:Row[]; summary:Row; services:Row }) {
  const parseReasons=(value:unknown):string[]=>{
    if(Array.isArray(value)) return value.map(String);
    const text=String(value||"").trim();
    if(!text) return [];
    try { const parsed=JSON.parse(text); if(Array.isArray(parsed)) return parsed.map(String); } catch {}
    return text.split(",").map(item=>item.trim()).filter(Boolean);
  };
  const reasonLabel=(value:string)=>({anaemia_mild:"Mild anaemia",twins:"Twin pregnancy",twins_mcda:"MCDA twin pregnancy",fgr:"Fetal growth restriction",prior_two_cs:"Two previous C-sections"}[value]||nice(value));
  const patientIdentity=(row:Row)=>{
    const raw=name(String(row.name||""));
    const serial=String(row.portal_mother_id||row.mother_id||raw.match(/(\d{5,})$/)?.[1]||"Record pending");
    return {display:raw.replace(/\s+\d{5,}$/,""),serial};
  };
  const [query,setQuery]=useState(""),[stage,setStage]=useState(""),[reason,setReason]=useState(""),[selected,setSelected]=useState("");
  const stages=Array.from(new Set(rows.map(row=>String(row.stage)))).filter(Boolean).sort();
  const reasons=Array.from(new Set(rows.flatMap(row=>parseReasons(row.reason)))).sort();
  const filtered=rows.filter(row=>{const identity=patientIdentity(row),rowReasons=parseReasons(row.reason);return (identity.display+" "+identity.serial).toLowerCase().includes(query.toLowerCase())&&(!stage||row.stage===stage)&&(!reason||rowReasons.includes(reason));});
  const selectedRow=filtered.find(row=>patientIdentity(row).serial===selected)||filtered[0];
  const reset=()=>{setQuery("");setStage("");setReason("");setSelected("")};
  return <section className="delivery-readiness-explorer">
    <header className="explorer-intro readiness-intro"><div><span className="eyebrow">ARRIVAL PREPARATION</span><h2>Know who needs preparation before delivery</h2><p>Start with a patient, understand the recorded readiness reasons, then coordinate beds, blood and the receiving team.</p></div><div className="explorer-guide"><b>1</b> Find patient <i/><b>2</b> Review needs <i/><b>3</b> Confirm resources</div></header>
    <div className="readiness-capacity-strip"><article><span>Available beds</span><strong>{summary.beds.available}</strong><small>Recorded capacity</small></article><article><span>PRBC units</span><strong>{summary.blood_units}</strong><small>Matching still required</small></article><article><span>On-call team</span><strong>{summary.on_call.length}</strong><small>At snapshot time</small></article><article><span>C-section service</span><strong>{services.c_section?"Ready":"Check"}</strong><small>{nice(services.emergency_obstetric_care)}</small></article></div>
    <div className="quick-filter-bar readiness-filters"><label className="filter-search">Find a patient<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, UHID or serial number…"/></label><label>Care stage<select value={stage} onChange={e=>setStage(e.target.value)}><option value="">All care stages</option>{stages.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label><label>Preparation need<select value={reason} onChange={e=>setReason(e.target.value)}><option value="">All recorded needs</option>{reasons.map(value=><option key={value} value={value}>{reasonLabel(value)}</option>)}</select></label>{(query||stage||reason)&&<button onClick={reset}>Clear filters</button>}</div>
    <div className="readiness-layout">
      <aside className="readiness-patient-list"><div className="readiness-list-title"><div><span className="eyebrow">PATIENT WORKLIST</span><h3>{filtered.length} patients</h3></div><small>Select one to view details</small></div>{filtered.map(row=>{const identity=patientIdentity(row),isActive=selectedRow&&patientIdentity(selectedRow).serial===identity.serial;return <button key={identity.serial} className={isActive?"active":""} onClick={()=>setSelected(identity.serial)}><span className="patient-initials">{identity.display.split(" ").map(part=>part[0]).join("").slice(0,2)}</span><span><strong>{identity.display}</strong><small>{identity.serial} · {nice(row.stage)} · {row.gestation_weeks} weeks</small></span><b>{parseReasons(row.reason).length} needs</b></button>})}{!filtered.length&&<div className="empty">No patient matches these filters.</div>}</aside>
      {selectedRow&&(()=>{const identity=patientIdentity(selectedRow),patientReasons=parseReasons(selectedRow.reason);return <section className="readiness-patient-detail card"><div className="card-head"><div><span className="eyebrow">SELECTED PATIENT</span><h2>{identity.display}</h2><p>{identity.serial} · {nice(selectedRow.stage)} · {selectedRow.gestation_weeks} weeks</p></div><span className="readiness-state busy">Preparation needed</span></div><div className="readiness-date-panel"><span>Expected delivery date</span><strong>{new Date(String(selectedRow.edd).slice(0,10)+"T12:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</strong><small>Use the recorded date to plan; confirm any change with the clinical team.</small></div><div className="readiness-needs"><h3>What the team should prepare for</h3><p>These are clinician-recorded context markers, not an automated risk score.</p><div>{patientReasons.map(item=><span key={item}>{reasonLabel(item)}</span>)}</div></div><div className="readiness-actions"><article><b>1</b><span><strong>Review the record</strong><small>Confirm the source note and current plan.</small></span></article><article><b>2</b><span><strong>Check resources</strong><small>Verify bed, blood and relevant service availability.</small></span></article><article><b>3</b><span><strong>Confirm receiving team</strong><small>Record human acceptance before transfer or admission.</small></span></article></div><div className="callout">Resource matching, theatre booking and receiving-team acceptance always require human confirmation.</div></section>})()}
    </div>
  </section>;
}

function BloodBankExplorer({ rows }: { rows: Row[] }) {
  const order = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
  const groups = Array.from(new Set(rows.map((row) => String(row.blood_group)))).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const components = Array.from(new Set(rows.map((row) => String(row.component)))).sort();
  const [query,setQuery]=useState(""),[group,setGroup]=useState(""),[component,setComponent]=useState(""),[availability,setAvailability]=useState("all");
  const filtered = rows.filter((row)=>{
    const haystack=(row.blood_group+" "+row.component).toLowerCase();
    const units=Number(row.units_available||0);
    return haystack.includes(query.toLowerCase())&&(!group||row.blood_group===group)&&(!component||row.component===component)&&(availability==="all"||(availability==="available"&&units>0)||(availability==="low"&&units>0&&units<=3)||(availability==="empty"&&units===0));
  });
  return <section className="filtered-workspace">
    <header className="explorer-intro"><div><span className="eyebrow">BLOOD BANK FINDER</span><h2>Find the required blood stock quickly</h2><p>Search or choose a blood group, component and availability. Recorded stock is shown instantly.</p></div><div className="diagnostic-summary"><strong>{filtered.reduce((sum,row)=>sum+Number(row.units_available||0),0)}</strong><span>matching units recorded</span></div></header>
    <div className="quick-filter-bar"><label className="filter-search">Search blood stock<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search A+, O-, plasma, platelets…"/></label><label>Blood group<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">All blood groups</option>{groups.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Component<select value={component} onChange={e=>setComponent(e.target.value)}><option value="">All components</option>{components.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label><label>Availability<select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">All stock</option><option value="available">Available</option><option value="low">Low stock (1–3)</option><option value="empty">No stock</option></select></label>{(query||group||component||availability!=="all")&&<button onClick={()=>{setQuery("");setGroup("");setComponent("");setAvailability("all")}}>Clear filters</button>}</div>
    <div className="blood-selector">{groups.map(value=>{const units=rows.filter(row=>row.blood_group===value).reduce((sum,row)=>sum+Number(row.units_available||0),0);return <button key={value} className={group===value?"active":""} onClick={()=>setGroup(group===value?"":value)}><strong>{value}</strong><span>{units} units</span></button>})}</div>
    <Card title="Matching blood stock" hint={`${filtered.length} component records match your filters. Confirm compatibility and issue approval separately.`}><Table headers={["Blood group","Component","Units available","Availability","Snapshot"]} rows={filtered.map(row=>[<strong key={row.blood_group}>{row.blood_group}</strong>,nice(row.component),row.units_available,<span key="stock" className={Number(row.units_available)===0?"pill amber":Number(row.units_available)<=3?"pill neutral":"pill green"}>{Number(row.units_available)===0?"No stock":Number(row.units_available)<=3?"Low stock":"Available"}</span>,row.snapshot_date])}/></Card>
  </section>;
}

function EquipmentExplorer({ rows }: { rows: Row[] }) {
  const types=Array.from(new Set(rows.map(row=>String(row.type)))).sort(), wards=Array.from(new Set(rows.map(row=>String(row.ward)))).sort(), statuses=Array.from(new Set(rows.map(row=>String(row.status)))).sort();
  const [query,setQuery]=useState(""),[type,setType]=useState(""),[ward,setWard]=useState(""),[status,setStatus]=useState("");
  const filtered=rows.filter(row=>(row.type+" "+row.ward).toLowerCase().includes(query.toLowerCase())&&(!type||row.type===type)&&(!ward||row.ward===ward)&&(!status||row.status===status));
  return <section className="filtered-workspace"><div className="quick-filter-bar"><label className="filter-search">Search equipment<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search monitor, ventilator or ward…"/></label><label>Equipment type<select value={type} onChange={e=>setType(e.target.value)}><option value="">All equipment</option>{types.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label><label>Ward<select value={ward} onChange={e=>setWard(e.target.value)}><option value="">All wards</option>{wards.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label>{(query||type||ward||status)&&<button onClick={()=>{setQuery("");setType("");setWard("");setStatus("")}}>Clear filters</button>}</div><Card title="Equipment & biomedical resources" hint={`${filtered.length} of ${rows.length} records shown. Installed and functional quantities come from the ward ledger.`}><Table headers={["Equipment","Ward","Installed","Functional","Status","Last service"]} rows={filtered.map(row=>[nice(row.type),row.ward,row.installed_quantity,row.functional_quantity,state(row.status),row.last_service_date])}/></Card></section>;
}

function StaffingExplorer({ rows, data }: { rows: Row[]; data: Row }) {
  const [tab,setTab]=useState("posts"),[query,setQuery]=useState(""),[filter,setFilter]=useState("");
  const source:Row[]=tab==="posts"?(data.posts||[]):tab==="doctors"?rows:(data.rosters||[]);
  const options=Array.from(new Set(source.map(row=>String(tab==="posts"?row.cadre:tab==="doctors"?row.specialty:row.shift)))).filter(Boolean).sort();
  const filtered=source.filter(row=>Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase())&&(!filter||String(tab==="posts"?row.cadre:tab==="doctors"?row.specialty:row.shift)===filter));
  return <Card title="People & coverage" hint="Search the establishment, clinical team or recorded shift roster."><div className="inner-tabs">{[["posts","Staff establishment"],["doctors","Doctors & units"],["rosters","Shift & on-call roster"]].map(([id,title])=><button className={tab===id?"active":""} key={id} onClick={()=>{setTab(id);setFilter("");setQuery("")}}>{title}</button>)}</div><div className="quick-filter-bar compact"><label className="filter-search">Search {tab==="posts"?"staff posts":tab==="doctors"?"doctors":"roster"}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==="doctors"?"Name, qualification, unit…":tab==="rosters"?"Name, role, ward…":"Cadre or role…"}/></label><label>{tab==="posts"?"Cadre":tab==="doctors"?"Specialty":"Shift"}<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All</option>{options.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label>{(query||filter)&&<button onClick={()=>{setQuery("");setFilter("")}}>Clear filters</button>}</div>{tab==="posts"?<Table headers={["Cadre","Sanctioned","In position","Vacancies"]} rows={filtered.map(row=>[row.cadre,row.sanctioned,row.in_position,row.sanctioned-row.in_position])}/>:tab==="doctors"?<Table headers={["Fictional clinician","Specialty","Designation","Qualification","Unit","Experience"]} rows={filtered.map(row=>[name(row.name),row.specialty,row.designation,row.qualification,row.unit_code||"—",row.experience_years+" years"])}/>:<Table headers={["Staff member","Role","Shift","Time","Ward"]} rows={filtered.map(row=>[name(row.name),row.role,row.shift,row.start_time+"–"+row.end_time,row.ward])}/>}</Card>;
}

function AmbulanceExplorer({ rows }: { rows: Row[] }) {
  const [query,setQuery]=useState(""),[type,setType]=useState(""),[status,setStatus]=useState("");
  const types=Array.from(new Set(rows.map(row=>String(row.type)))).sort(),statuses=Array.from(new Set(rows.map(row=>String(row.status)))).sort();
  const filtered=rows.filter(row=>(row.vehicle_label+" "+row.type).toLowerCase().includes(query.toLowerCase())&&(!type||row.type===type)&&(!status||row.status===status));
  return <section className="filtered-workspace"><div className="quick-filter-bar"><label className="filter-search">Search ambulance<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Vehicle number or ambulance type…"/></label><label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{types.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(value=><option key={value} value={value}>{nice(value)}</option>)}</select></label>{(query||type||status)&&<button onClick={()=>{setQuery("");setType("");setStatus("")}}>Clear filters</button>}</div><Card title="Ambulance fleet" hint={`${filtered.length} of ${rows.length} vehicles shown. Status is a recorded snapshot, not live dispatch tracking.`}><Table headers={["Vehicle","Type","Status","Oxygen","Neonatal transport","Last service"]} rows={filtered.map(row=>[row.vehicle_label,nice(row.type),state(row.status),row.oxygen_supported?"Yes":"No",row.neonatal_transport?"Yes":"No",row.last_service_date])}/></Card></section>;
}
export function OperationalOverview({
  summary,
  structure,
  navigate,
  canOpen,
  admin = false,
}: {
  summary: Row;
  structure: Row;
  navigate: (view: string) => void;
  canOpen: (view: string) => boolean;
  admin?: boolean;
}) {
  const b = summary.beds,
    occupancy = b.total ? Math.round((b.occupied / b.total) * 100) : 0;
  const peak = Math.max(
    1,
    ...summary.delivery_history.map((d: Row) => d.deliveries),
  );
  const critical = summary.critical.reduce(
    (a: Row, c: Row) => ({
      occupied: a.occupied + c.occupied,
      capacity: a.capacity + c.capacity,
    }),
    { occupied: 0, capacity: 0 },
  );
  const links = admin
    ? [
        ["beds", "Bed board", "Inspect every ward and bed", "▦"],
        ["blood", "Blood bank", "Review stock by component", "◉"],
        ["staffing", "Staff & on call", "See the team covering care", "♧"],
        ["equipment", "Equipment", "Review functional capacity", "✣"],
      ]
    : [
        [
          "patientCare",
          "Patient Care Hub",
          "Patients, visits and follow-up work",
          "♡",
        ],
        ["incomingCare", "Incoming care", "Review arrivals and requests", "✚"],
        ["careReviews", "Clinical review", "Review summaries and evidence", "▤"],
        ["readiness", "Delivery readiness", "Check recorded resources", "✚"],
      ];
  return (
    <>
      <section className="command-banner">
        <div>
          <div className="eyebrow">
            {admin
              ? "HOSPITAL CAPACITY & RESOURCES"
              : "YOUR HOSPITAL, ONE CONNECTED VIEW"}
          </div>
          <h2>
            {admin
              ? "Prepared teams. Visible capacity."
              : "Every handover starts with readiness."}
          </h2>
          <p>
            {name(structure.facility.name)} · Snapshot{" "}
            {date(summary.snapshot_at)} 2026
          </p>
        </div>
        <div className="banner-seal">
          <span>✚</span>
          <small>
            DAI CARE
            <br />
            CONTINUITY
          </small>
        </div>
      </section>
      <div className="quick-grid">
        {links
          .filter(([view]) => canOpen(view))
          .map(([view, title, detail, icon]) => (
            <button
              className="quick-card"
              key={view}
              onClick={() => navigate(view)}
            >
              <span className="quick-icon">{icon}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
              <span className="quick-arrow">↗</span>
            </button>
          ))}
      </div>
      <div className="metrics operational-metrics">
        <Metric
          title="Bed occupancy"
          value={occupancy + "%"}
          detail={`${count(b.occupied)} occupied / ${count(b.total)} beds`}
        />
        <Metric
          title="Available beds"
          value={count(b.available)}
          detail={`${count(b.reserved)} reserved · ${count(b.maintenance)} maintenance`}
          color="green"
        />
        <Metric
          title="Critical-care occupancy"
          value={`${count(critical.occupied)} / ${count(critical.capacity)}`}
          detail="OBG HDU, neonatal and paediatric care"
          color="blue"
        />
        <Metric
          title="Packed red-cell stock"
          value={count(summary.blood_units)}
          detail="Units in the latest recorded snapshot"
          color="rose"
        />
      </div>
      <div className="command-columns">
        <Card
          title={admin ? "Capacity by care area" : "Critical-care readiness"}
          hint="Recorded cot and bed census; no live admission is implied."
          action={
            canOpen("critical") ? (
              <button
                className="text-button"
                onClick={() => navigate("critical")}
              >
                View units ↗
              </button>
            ) : undefined
          }
        >
          <div className="capacity-list">
            {summary.critical.map((c: Row) => (
              <div key={c.name}>
                <div>
                  <strong>{c.name}</strong>
                  <span>
                    {c.occupied} / {c.capacity} occupied
                  </span>
                </div>
                <div className="capacity-track">
                  <i
                    style={{
                      width:
                        Math.min(100, (c.occupied / c.capacity) * 100) + "%",
                    }}
                  />
                </div>
                <small>{c.available} available beds in the source ledger</small>
              </div>
            ))}
          </div>
        </Card>
        <Card
          title="Delivery activity"
          hint="Last seven days of recorded deliveries."
        >
          <div className="delivery-chart">
            {summary.delivery_history.map((d: Row) => (
              <div key={d.date}>
                <strong>{d.deliveries}</strong>
                <div className="bar-container">
                  <i
                    style={{
                      height: Math.max(4, (d.deliveries / peak) * 100) + "%",
                    }}
                  />
                </div>
                <small>{date(d.date)}</small>
              </div>
            ))}
          </div>
          <div className="chart-foot">
            <span>
              <i /> Recorded deliveries
            </span>
            <span>
              {count(
                summary.delivery_history.reduce(
                  (n: number, d: Row) => n + d.deliveries,
                  0,
                ),
              )}{" "}
              in this period
            </span>
          </div>
        </Card>
      </div>
      <div className="command-columns">
        <Card
          title="Clinician-confirmed arrivals"
          hint="Registered cohort cases in T2, T3 or labour, ordered by EDD."
          action={
            canOpen("readiness") ? (
              <button
                className="text-button"
                onClick={() => navigate("readiness")}
              >
                Readiness view ↗
              </button>
            ) : undefined
          }
        >
          <div className="arrival-list">
            {summary.arrivals.length ? (
              summary.arrivals.map((m: Row) => (
                <div key={m.id}>
                  <span className="avatar">
                    {name(m.name)
                      .split(" ")
                      .slice(0, 2)
                      .map((x: string) => x[0])
                      .join("")}
                  </span>
                  <div>
                    <strong>{name(m.name)}</strong>
                    <small>
                      Unit{" "}
                      {structure.units.find((u: Row) => u.id === m.unit_id)
                        ?.code || "—"}{" "}
                      · {m.gestation_weeks} weeks · EDD {date(m.edd)}
                    </small>
                  </div>
                  <span className="pill amber">Clinician flagged</span>
                </div>
              ))
            ) : (
              <div className="empty">
                No arrivals visible within your role’s scope.
              </div>
            )}
          </div>
        </Card>
        <Card
          title="Who is on call"
          hint="Roster coverage at the dataset snapshot."
        >
          <div className="oncall-list">
            {summary.on_call.length ? (
              summary.on_call.slice(0, 5).map((r: Row, i: number) => (
                <div key={i}>
                  <span className="availability-dot" />
                  <div>
                    <strong>{name(r.name)}</strong>
                    <small>{r.specialty}</small>
                  </div>
                  <span>
                    {r.start_time}–{r.end_time}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty">No recorded cover for this time.</div>
            )}
          </div>
          <div className="card-footer">
            <button
              className="text-button"
              onClick={() => navigate("staffing")}
            >
              Open full staff & roster view ↗
            </button>
          </div>
        </Card>
      </div>
      <Card
        title="Resource attention"
        hint="Explainable observations from the source ledger."
      >
        <div className="attention-grid">
          {summary.alerts.map((a: Row) => (
            <button
              disabled={!canOpen(a.target)}
              key={a.title}
              onClick={() => navigate(a.target)}
            >
              <span className="attention-number">{count(a.value)}</span>
              <div>
                <strong>{a.title}</strong>
                <small>{a.reason}</small>
              </div>
              <span>↗</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
export function SnapshotView({
  view,
  data,
  summary,
  filters,
  setFilters,
  navigate,
}: {
  view: string;
  data: Row;
  summary: Row;
  filters: Row;
  setFilters: (v: Row) => void;
  navigate: (v: string) => void;
}) {
  const rows: Row[] = data.items || [];
  if(view === "care-gap-map") return <CareGapMap data={data} filters={filters} setFilters={setFilters} navigate={navigate}/>;
  if(view === "quality-board") return <section className="card"><h2>Ward quality</h2><p>{data.source_notes}</p><p>Groups under 10 mothers and sparse outcomes are withheld. Missing values are never shown as zero.</p><div style={{overflowX:"auto"}}><table><thead><tr><th>Recorded ward</th><th>People band</th><th>Recorded missed visits</th><th>Median referral turnaround</th><th>Recorded vaccine coverage</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.ward}</td><td>{r.suppressed?"Suppressed":r.people_band}</td><td>{r.missed_visit_pct==null?"Withheld / insufficient":r.missed_visit_pct+"%"}</td><td>{r.median_referral_days==null?"Withheld / insufficient":r.median_referral_days.toFixed(1)+" days"}</td><td>{r.recorded_vaccination_coverage_pct==null?"Withheld / insufficient":r.recorded_vaccination_coverage_pct+"%"}</td></tr>)}</tbody></table></div>{!rows.length&&<p>No ward assignments recorded for this facility.</p>}</section>;
  if(view === "capacity") return <CapacityExplorer rows={rows} navigate={navigate}/>;

  if (view === "beds")
    return (
      <>
        <div className="snapshot-toolbar">
          <label>
            Search beds
            <input
              placeholder="Bed ID or ward name"
              value={filters.q || ""}
              onChange={(e) =>
                setFilters({ ...filters, q: e.target.value, page: 1 })
              }
            />
          </label>
          <label>
            Ward
            <select
              aria-label="Ward filter"
              value={filters.ward || ""}
              onChange={(e) =>
                setFilters({ ...filters, ward: e.target.value, page: 1 })
              }
            >
              <option value="">All wards</option>
              {data.wards.map((w: Row) => (
                <option key={w.ward_id} value={w.ward_id}>
                  {w.label} · {w.capacity} beds
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Bed status"
              value={filters.status || ""}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value, page: 1 })
              }
            >
              <option value="">All statuses</option>
              {["available", "occupied", "reserved", "maintenance"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <Card
          title="Ward & bed board"
          hint={`${count(data.total)} matching beds · select filters to inspect the recorded census.`}
        >
          <div className="bed-legend">
            {["available", "occupied", "reserved", "maintenance"].map((s) => (
              <span key={s}>
                <i className={"bed-dot " + s} />
                {nice(s)}
              </span>
            ))}
          </div>
          <div className="bed-grid">
            {rows.map((b) => (
              <article className={"bed-tile " + b.status} key={b.bed_id}>
                <div>
                  <span className="bed-symbol">▱</span>
                  <span className="bed-dot" />
                </div>
                <strong>{b.bed_id.replace("BED-SYN-", "")}</strong>
                <small>{b.ward}</small>
                <span className="bed-state">{nice(b.status)}</span>
                <footer>
                  <span>{b.oxygen_supported ? "O₂ oxygen" : "— oxygen"}</span>
                  <span>{b.monitor_attached ? "◉ monitor" : "— monitor"}</span>
                </footer>
              </article>
            ))}
          </div>
          <div className="pagination">
            <button
              className="secondary"
              disabled={data.page <= 1}
              onClick={() => setFilters({ ...filters, page: data.page - 1 })}
            >
              ← Previous
            </button>
            <span>
              Page {data.page} of {Math.max(1, Math.ceil(data.total / 60))}
            </span>
            <button
              className="secondary"
              disabled={data.page * 60 >= data.total}
              onClick={() => setFilters({ ...filters, page: data.page + 1 })}
            >
              Next →
            </button>
          </div>
        </Card>
      </>
    );
  if (view === "critical")
    return <CriticalCareExplorer units={rows} admissions={data.admissions || []}/>;
  if (view === "blood") return <BloodBankExplorer rows={rows}/>;
  if (view === "staffing") return <StaffingExplorer rows={rows} data={data}/>;
  if (view === "equipment") return <EquipmentExplorer rows={rows}/>;
  if (view === "ambulances") return <AmbulanceExplorer rows={rows}/>;
  if (view === "census") return <CensusExplorer rows={rows} snapshotAt={data.as_of_date}/>;
  if (view === "readiness")
    return <DeliveryReadinessExplorer rows={rows} summary={summary} services={data.services}/>;
  const views: Record<
    string,
    {
      title: string;
      hint: string;
      headers: string[];
      row: (r: Row) => React.ReactNode[];
    }
  > = {
    organisation: {
      title: "Organisation & responsible officers",
      hint: "All office holders are fictional.",
      headers: ["Role", "Fictional office holder", "Demo email", "Appointed"],
      row: (r) => [r.role_name, name(r.person_name), r.email, r.appointed_on],
    },
    appointments: {
      title: "Appointments & recorded queue",
      hint: "Latest 100 mother appointments within your permitted imported cohort. This is not a live token queue.",
      headers: ["Mother", "Date", "Time", "Doctor", "Reason", "Status"],
      row: (r) => [
        name(r.mother_name),
        r.appointment_date,
        r.start_time + "–" + r.end_time,
        name(r.doctor),
        r.reason,
        state(r.status),
      ],
    },
    gaps: {
      title: "Care-gap worklist",
      hint: "Open gaps derived from expected care versus recorded care. First 100 permitted mother gaps, oldest due first.",
      headers: [
        "Mother",
        "Expected care",
        "Due",
        "Gap type",
        "Severity",
        "Recommended follow-up",
      ],
      row: (r) => [
        name(r.mother_name),
        r.expected_item,
        r.due_date,
        nice(r.gap_type),
        state(r.severity),
        r.action_recommended,
      ],
    },
    referrals: {
      title: "Referrals & handovers",
      hint: "Recorded facility-to-facility transfers for your permitted mother cohort.",
      headers: ["Mother", "From", "To", "Reason", "Referred", "Transport"],
      row: (r) => [
        name(r.mother_name),
        name(r.from_facility),
        name(r.to_facility),
        r.reason,
        r.referred_at,
        r.transport_time_min + " min",
      ],
    },
    sos: {
      title: "SOS event inbox",
      hint: "Recorded authentication and response history. This screen does not dispatch an ambulance or accept an emergency.",
      headers: [
        "Event",
        "Triggered",
        "Required capability",
        "First auth",
        "Second auth",
        "Distance",
        "Response",
        "Outcome",
      ],
      row: (r) => [
        r.event_id,
        r.triggered_at,
        nice(r.required_capability),
        r.first_auth_passed ? "Passed" : "Failed",
        r.second_auth_passed ? "Confirmed" : "Rejected / unverified",
        r.distance_km + " km",
        r.response_time_min ? r.response_time_min + " min" : "—",
        state(r.outcome),
      ],
    },
  };
  if (view === "diagnostics") return <DiagnosticsExplorer rows={rows}/>;
  const v = views[view];
  return v ? (
    <Card title={v.title} hint={v.hint}>
      <Table headers={v.headers} rows={rows.map(v.row)} />
    </Card>
  ) : (
    <div className="empty">Select a workspace view.</div>
  );
}
