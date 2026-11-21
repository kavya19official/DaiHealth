"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadOutbox, saveOutbox } from "./asha-outbox";

type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
type OutboxItem = {
  client_uuid: string;
  entity: "visit" | "note" | "camp_update";
  payload: Row;
  queued_at: string;
  attempts: number;
  last_error?: string;
  needs_review?: boolean;
};

const label = "Simulated on synthetic data";
const KINDS = ["attendance", "vitals", "immunization", "referral_flag"];

const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
const stamp = (x?: string) =>
  x ? new Date(x).toLocaleString("en-IN") : "—";
const nice = (x: unknown) => String(x ?? "—").replaceAll("_", " ");

function Badge({ status }: { status: string }) {
  return (
    <span
      className={
        "pill " +
        (/completed|open|administered/.test(status)
          ? "green"
          : /missed|error|closed/.test(status)
            ? "amber"
            : "neutral")
      }
    >
      {nice(status)}
    </span>
  );
}

function RouteMap({ stops, origin }: { stops: Row[]; origin: Row }) {
  const points = useMemo(() => {
    const all: { lat: number; lng: number; kind: string; i?: number }[] = [
      ...(origin?.lat != null ? [{ lat: origin.lat, lng: origin.lng, kind: "origin" }] : []),
      ...stops.map((st: Row, i: number) => ({ lat: st.lat, lng: st.lng, kind: "stop", i })),
    ].filter((p) => p.lat != null && p.lng != null);
    if (!all.length) return null;
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const span = Math.max(maxLat - minLat, maxLng - minLng, 0.001);
    const W = 320, H = 220, pad = 24;
    const xy = (lat: number, lng: number) => [
      pad + ((lng - minLng) / span) * (W - 2 * pad),
      H - pad - ((lat - minLat) / span) * (H - 2 * pad),
    ];
    return { all, xy, W, H };
  }, [stops, origin]);
  if (!points) return <div className="empty">No route coordinates available.</div>;
  const { all, xy, W, H } = points;
  const routePts = all
    .map((p) => xy(p.lat, p.lng).join(","))
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="asha-map" role="img" aria-label="Village route map">
      {all.map((p, i) => {
        const [x, y] = xy(p.lat, p.lng);
        return p.kind === "origin" ? (
          <g key={"o" + i}>
            <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} fill="#0f766e" />
            <text x={x} y={y + 20} textAnchor="middle" fontSize={10}>Facility</text>
          </g>
        ) : (
          <g key={"s" + i}>
            <circle cx={x} cy={y} r={7} fill="#b45309" stroke="#fff" strokeWidth={1.5} />
            <text x={x} y={y - 10} textAnchor="middle" fontSize={9} fill="#444">
              {(p.i ?? 0) + 1}
            </text>
          </g>
        );
      })}
      <polyline points={routePts} fill="none" stroke="#0f766e" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
    </svg>
  );
}

export function AshaCopilot({ api, user }: { api: Api; user: Row }) {
  const isWorker = user.role === "asha";
  const [tab, setTab] = useState<"today" | "route" | "notes" | "camps" | "sync">("today");
  const [date, setDate] = useState(todayLocal());
  const [dash, setDash] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [route, setRoute] = useState<Row | null>(null);
  const [camps, setCamps] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Row[]>([]);
  const [queue, setQueue] = useState<OutboxItem[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const [queueError, setQueueError] = useState("");
  const queueRef = useRef<OutboxItem[]>([]);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const refreshAfterSync = useRef<(() => Promise<void>) | null>(null);
  const scope = user.id + ":" + user.facility_id;
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionFor, setActionFor] = useState<Row | null>(null);
  const [noteFor, setNoteFor] = useState<Row | null>(null);
  const [campForm, setCampForm] = useState({ village_id: "", name: "", camp_date: todayLocal() });
  const [campQuery, setCampQuery] = useState("");
  const [campDrafts, setCampDrafts] = useState<Record<string, Row>>({});
  const [oversight, setOversight] = useState<Row | null>(null);
  const [roster, setRoster] = useState<Row | null>(null);
  const [assignForm, setAssignForm] = useState({ asha_id: "", mother_id: "", village_id: "", household_label: "" });
  const [motherQuery, setMotherQuery] = useState("");
  const [motherResults, setMotherResults] = useState<Row[]>([]);

  useEffect(() => {
    if (!isWorker) return;
    let active = true;
    loadOutbox<OutboxItem>(scope, user.id).then((items) => {
      if (!active) return;
      queueRef.current = items;
      setQueue(items);
      setQueueReady(true);
    }).catch(() => {
      if (active) setQueueError("This browser could not open protected offline storage. Retry in a supported browser.");
    });
    return () => { active = false; };
  }, [scope, isWorker, user.id]);

  const setQ = useCallback(
    (updater: (q: OutboxItem[]) => OutboxItem[]) => {
      const next = updater(queueRef.current);
      queueRef.current = next;
      setQueue(next);
      writes.current = writes.current.catch(() => {}).then(() => saveOutbox(scope, next));
      void writes.current.then(() => setQueueError(""), () => setQueueError("The queue could not be saved on this device. Keep this page open and sync online."));
    },
    [scope]
  );

  const sync = useCallback(async (retryRejected = false) => {
    if (!isWorker || !queueReady || !navigator.onLine || inFlight.current) return;
    const eligible = queueRef.current.filter(item => retryRejected || !item.needs_review);
    const batch = (entity: OutboxItem["entity"]) => eligible.filter(item => item.entity === entity).slice(0, 100);
    const visits = batch("visit"), notes = batch("note"), camps = batch("camp_update");
    const sent = new Set([...visits, ...notes, ...camps].map(item => item.client_uuid));
    if (!sent.size) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const result = await api("/asha/sync", {
        method: "POST",
        body: JSON.stringify({ visits: visits.map(item => item.payload), notes: notes.map(item => item.payload),
          camp_updates: camps.map(item => item.payload) }),
      });
      const outcomes = new Map<string, Row>(((result.results || []) as Row[])
        .map(r => [r.entity + ":" + r.client_uuid, r]));
      setQ(prev => prev.flatMap(item => {
        if (!sent.has(item.client_uuid)) return [item];
        const r = outcomes.get(item.entity + ":" + item.client_uuid);
        if (r?.status === "created" || r?.status === "duplicate") {
          if (item.entity === "visit") setItems(current => current.map(row =>
            row.mother_id === item.payload.mother_id && date === item.payload.visit_date
              ? { ...row, visit_id: r.id, status: r.visit_status || item.payload.status } : row));
          return [];
        }
        return [{ ...item, attempts: item.attempts + 1,
          needs_review: Number(r?.code) >= 400 && Number(r?.code) < 500,
          last_error: r?.detail || "No server result" }];
      }));
      setLastSync(new Date().toISOString());
      void refreshAfterSync.current?.();
    } catch (e) {
      setQ(prev => prev.map(item => !sent.has(item.client_uuid) ? item : ({
        ...item, attempts: item.attempts + 1, last_error: (e as Error).message
      })));
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [api, date, isWorker, queueReady, setQ]);

  const enqueue = useCallback(
    (entity: OutboxItem["entity"], payload: Row) => {
      if (!queueReady) {
        setError("Protected offline storage is unavailable. Your change was not queued.");
        return;
      }
      const cu = payload.client_uuid || uuid();
      const item: OutboxItem = {
        client_uuid: cu,
        entity,
        payload: { ...payload, client_uuid: cu },
        queued_at: new Date().toISOString(),
        attempts: 0,
      };
      setQ((prev) => [...prev, item]);
      // Optimistic local echo for visit status.
      if (entity === "visit" && payload.status && date === payload.visit_date) {
        setItems((prev) =>
          prev.map((v) =>
            v.mother_id === payload.mother_id
              ? { ...v, status: payload.status, visit_id: v.visit_id }
              : v
          )
        );
      }
      return item;
    },
    [date, queueReady, setQ]
  );

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const version = ++loadVersion.current;
    setError("");
    const qs = "?date=" + encodeURIComponent(date);
    const results = await Promise.allSettled([
      api("/asha/dashboard" + qs), api("/asha/visits" + qs), api("/asha/route" + qs),
      api("/asha/camps"), api("/asha/notes?limit=20"),
    ]);
    if (version !== loadVersion.current) return;
    const [d, v, r, cp, nt] = results;
    if (d.status === "fulfilled") setDash(d.value);
    if (v.status === "fulfilled") setItems((v.value.items || []).map((row: Row) => {
      const pending = queueRef.current.findLast(item => item.entity === "visit" &&
        item.payload.mother_id === row.mother_id && item.payload.visit_date === date && !item.needs_review);
      return pending ? { ...row, status: pending.payload.status } : row;
    }));
    if (r.status === "fulfilled") setRoute(r.value);
    if (cp.status === "fulfilled") setCamps(cp.value.items || []);
    if (nt.status === "fulfilled") setNotes(nt.value.items || []);
    if (results.some(item => item.status === "rejected")) setError("Some field data could not load. Reconnect and refresh to try again.");
  }, [api, date]);

  useEffect(() => {
    refreshAfterSync.current = refresh;
    if (online) void refresh();
    return () => {
      refreshAfterSync.current = null;
      loadVersion.current++;
    };
  }, [refresh, online]);

  useEffect(() => {
    if (!isWorker) {
      api("/asha/oversight").then(setOversight).catch(() => {});
      api("/asha/roster").then(setRoster).catch(() => {});
    }
  }, [api, isWorker]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (online && queue.length) void sync();
  }, [online, queue.length, sync]);

  useEffect(() => {
    const t = setInterval(() => {
      if (online && queue.length) void sync();
    }, 30000);
    return () => clearInterval(t);
  }, [online, queue.length, sync]);

  function visitAction(item: Row, status: string, outcome?: Row) {
    enqueue("visit", {
      mother_id: item.mother_id,
      visit_date: date,
      status,
      client_uuid: uuid(),
      recorded_at: new Date().toISOString(),
      outcome: outcome || {},
    });
    if (status === "rescheduled" && outcome?.next_date) {
      enqueue("visit", {
        mother_id: item.mother_id,
        visit_date: outcome.next_date,
        status: "planned",
        client_uuid: uuid(),
        recorded_at: new Date().toISOString(),
        outcome: { rescheduled_from: date },
      });
    }
    setActionFor(null);
  }

  async function searchMothers(e: FormEvent) {
    e.preventDefault();
    if (!motherQuery.trim()) return;
    const r = await api(
      "/patients?limit=8&q=" + encodeURIComponent(motherQuery.trim())
    );
    setMotherResults(r.items || []);
  }

  async function createCamp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/asha/camps", {
        method: "POST",
        body: JSON.stringify(campForm),
      });
      setCampForm({ village_id: "", name: "", camp_date: todayLocal() });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function campStatus(camp: Row, status: string) {
    if (status === "closed" && queueRef.current.some(item => item.entity === "camp_update" && item.payload.camp_id === camp.id)) {
      setError("Sync or resolve this camp’s queued updates before closing it.");
      return;
    }
    try {
      await api("/asha/camps/" + camp.id + "/status", {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function draftFor(campId: string, motherId: string): Row {
    return (
      campDrafts[campId + "|" + motherId] || {
        kind: "attendance",
        payload: { status: "present" },
        include: false,
      }
    );
  }

  function setDraft(campId: string, motherId: string, patch: Row) {
    setCampDrafts((prev) => ({
      ...prev,
      [campId + "|" + motherId]: { ...draftFor(campId, motherId), ...patch },
    }));
  }

  function queueCampUpdates(camp: Row) {
    if (!queueReady) {
      setError("Protected offline storage is unavailable. Your updates have not been queued.");
      return;
    }
    const updates: OutboxItem[] = [];
    for (const item of items) {
      const d = draftFor(camp.id, item.mother_id);
      if (!d.include) continue;
      const payload: Row = { status: "present" };
      if (d.kind === "vitals") {
        const text = d.vitals?.text?.trim();
        if (!text) return setError("Add the recorded vitals for " + item.name + ".");
        payload.vitals = { text };
      }
      if (d.kind === "immunization") {
        if (!d.child_id || !d.vaccine?.trim()) return setError("Choose a child and enter the recorded vaccine for " + item.name + ".");
        payload.child_id = d.child_id;
        payload.vaccine = d.vaccine.trim();
      }
      if (d.kind === "referral_flag") {
        if ((d.reason?.trim().length || 0) < 5) return setError("Enter the referral reason for " + item.name + ".");
        payload.reason = d.reason.trim();
      }
      const cu = uuid();
      updates.push({
        client_uuid: cu,
        entity: "camp_update",
        payload: {
          camp_id: camp.id,
          mother_id: item.mother_id,
          kind: d.kind,
          payload,
          client_uuid: cu,
        },
        queued_at: new Date().toISOString(),
        attempts: 0,
      });
    }
    if (!updates.length) {
      setError("Select at least one beneficiary update.");
      return;
    }
    setQ((prev) => [...prev, ...updates]);
    setCampDrafts(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(camp.id + "|"))));
  }

  const pendingCount = queue.length;
  const stats = dash?.stats || {};

  if (!isWorker) {
    return (
      <section className="card asha-admin">
        <div className="card-head">
          <div>
            <h2>ASHA Copilot · oversight</h2>
            <p>
              Community health worker beats, visits and health camps · {label}
            </p>
          </div>
        </div>
        {oversight && (
          <>
            <h3>Workers</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Assigned</th>
                    <th>Visits · 7d</th>
                    <th>Notes</th>
                    <th>Camps</th>
                  </tr>
                </thead>
                <tbody>
                  {oversight.workers.map((w: Row) => (
                    <tr key={w.asha_id}>
                      <td>{String(w.name || "").replace(/^SYNTHETIC /, "")}</td>
                      <td>{w.assigned}</td>
                      <td>{w.visits_7d}</td>
                      <td>{w.notes}</td>
                      <td>{w.camps}</td>
                    </tr>
                  ))}
                  {!oversight.workers.length && (
                    <tr>
                      <td colSpan={5} className="empty">
                        No ASHA workers in this facility yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {roster && (
          <>
            <h3>Villages & assignment</h3>
            <div className="asha-villages">
              {roster.villages.map((v: Row) => (
                <span key={v.id} className="pill neutral">
                  {v.name} · {v.anganwadi_name || "no anganwadi"}
                </span>
              ))}
              {!roster.villages.length && (
                <span className="small">No villages defined.</span>
              )}
            </div>
            <form className="asha-assign" onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/asha/assignments", {
                  method: "POST",
                  body: JSON.stringify({
                    ...assignForm,
                    village_id: assignForm.village_id || null,
                    household_label: assignForm.household_label || null,
                  }),
                });
                setAssignForm({ asha_id: "", mother_id: "", village_id: "", household_label: "" });
                setMotherResults([]);
                setMotherQuery("");
                api("/asha/oversight").then(setOversight).catch(() => {});
              } catch (err) {
                setError((err as Error).message);
              }
            }}>
              <h4>Assign beneficiary to worker</h4>
              <div className="form-grid">
                <label>
                  ASHA worker
                  <select
                    value={assignForm.asha_id}
                    onChange={(e) => setAssignForm({ ...assignForm, asha_id: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {roster.workers.map((w: Row) => (
                      <option key={w.id} value={w.id}>
                        {String(w.name).replace(/^SYNTHETIC /, "")} ({w.assigned})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Village
                  <select
                    value={assignForm.village_id}
                    onChange={(e) => setAssignForm({ ...assignForm, village_id: e.target.value })}
                  >
                    <option value="">Default</option>
                    {roster.villages.map((v: Row) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Household label
                  <input
                    value={assignForm.household_label}
                    onChange={(e) => setAssignForm({ ...assignForm, household_label: e.target.value })}
                    placeholder="House 12, near school"
                  />
                </label>
              </div>
              <div className="mother-search">
                <input
                  value={motherQuery}
                  onChange={(e) => setMotherQuery(e.target.value)}
                  placeholder="Search patient registry (name or UHID)…"
                />
                <button type="button" className="text-button" onClick={searchMothers}>
                  Search
                </button>
              </div>
              {motherResults.length > 0 && (
                <div className="mother-results">
                  {motherResults.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className={assignForm.mother_id === m.id ? "pill green" : "pill neutral"}
                      onClick={() => setAssignForm({ ...assignForm, mother_id: m.id })}
                    >
                      {String((m.details || {}).name || m.source_id).replace(/^SYNTHETIC /, "")} · {m.uhid}
                    </button>
                  ))}
                </div>
              )}
              <button className="primary" disabled={!assignForm.asha_id || !assignForm.mother_id}>
                Assign beneficiary →
              </button>
            </form>
          </>
        )}
        {error && <div role="alert" className="error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="card asha-copilot">
      <div className="card-head">
        <div>
          <h2>ASHA Copilot</h2>
          <p>
            {String(user.name || "").replace(/^SYNTHETIC /, "")} · community
            visits, voice notes & camps · {label}
          </p>
        </div>
        <div className="asha-head-actions">
          <span className={"pill " + (online ? "green" : "amber")}>
            {online ? "Online" : "Offline"}
          </span>
          {pendingCount > 0 && (
            <span className="pill amber">{pendingCount} queued</span>
          )}
          <button
            className="text-button"
            onClick={() => void sync(true)}
            disabled={syncing || !pendingCount || !online || !queueReady}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {queueError && <div role="alert" className="error">{queueError}</div>}
      {!online && <p role="status" className="small">Changes queue on this device. Keep this page open to use the field list already loaded for this date.</p>}
      <div className="asha-toolbar">
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
            disabled={!online}
          />
        </label>
        <div className="asha-tabs">
          {(
            [
              ["today", "Today’s visits"],
              ["route", "Village route"],
              ["notes", "Voice notes"],
              ["camps", "Health camps"],
              ["sync", "Offline queue"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              className={tab === id ? "pill green" : "pill neutral"}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {dash && (
        <div className="asha-stats">
          <span className="pill neutral">{stats.assigned ?? 0} beneficiaries</span>
          <span className="pill neutral">{stats.priority_today ?? 0} need priority</span>
          <span className="pill neutral">{stats.planned ?? 0} planned</span>
          <span className="pill green">{stats.completed ?? 0} completed</span>
          <span className="pill amber">{stats.missed ?? 0} missed</span>
          {lastSync && <span className="small">Last sync {stamp(lastSync)}</span>}
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error} {online ? "" : "— changes are queued and will sync when back online."}
        </div>
      )}

      {tab === "today" && (
        <div className="asha-visits">
          {!items.length && <div className="empty">No assigned beneficiaries for this date.</div>}
          {items.map((v) => (
            <article key={v.mother_id} className="asha-visit">
              <div className="asha-visit-head">
                <div>
                  <strong>{String(v.name).replace(/^SYNTHETIC /, "")}</strong>
                  <span className="small">
                    {" "}
                    · {v.uhid} · {v.village} · {v.household_label}
                  </span>
                </div>
                <div className="asha-visit-badges">
                  {v.priority_score > 0 && (
                    <span className="pill amber">priority {v.priority_score}</span>
                  )}
                  {v.clinician_high_risk && <span className="pill amber">high risk</span>}
                  <Badge status={v.status} />
                </div>
              </div>
              {v.reasons?.length > 0 && (
                <div className="asha-reasons">
                  {v.reasons.slice(0, 6).map((r: Row, i: number) => (
                    <span key={i} className="pill neutral" title={r.detail || ""}>
                      {r.label}
                      {r.detail ? ` · ${r.detail}` : ""}
                    </span>
                  ))}
                  {v.reasons.length > 6 && (
                    <span className="small">+{v.reasons.length - 6} more</span>
                  )}
                </div>
              )}
              <div className="asha-visit-actions">
                {v.status !== "completed" && v.status !== "missed" && (
                  <>
                    {v.status === "pending" && (
                      <button className="text-button" onClick={() => visitAction(v, "planned")}>
                        Plan visit
                      </button>
                    )}
                    <button className="primary" onClick={() => setActionFor({ ...v, _action: "completed" })}>
                      Complete
                    </button>
                    <button className="text-button" onClick={() => setActionFor({ ...v, _action: "missed" })}>
                      Missed
                    </button>
                    <button className="text-button" onClick={() => setActionFor({ ...v, _action: "rescheduled" })}>
                      Reschedule
                    </button>
                  </>
                )}
                <button className="text-button" onClick={() => setNoteFor(v)}>
                  + Note
                </button>
              </div>
              {actionFor && actionFor.mother_id === v.mother_id && (
                <form
                  className="asha-action-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    visitAction(v, actionFor._action, {
                      note: String(fd.get("note") || ""),
                      follow_up_days: Number(fd.get("follow_up_days") || 0) || undefined,
                      next_date: String(fd.get("next_date") || "") || undefined,
                    });
                  }}
                >
                  <label>
                    Outcome note
                    <textarea name="note" rows={2} placeholder="What happened during the visit?" />
                  </label>
                  {actionFor._action === "rescheduled" && (
                    <label>
                      New date
                      <input name="next_date" type="date" required />
                    </label>
                  )}
                  {actionFor._action === "completed" && (
                    <label>
                      Follow-up in (days)
                      <input name="follow_up_days" type="number" min={0} max={365} defaultValue={7} />
                    </label>
                  )}
                  <div>
                    <button className="primary" type="submit">
                      Save {nice(actionFor._action)}
                    </button>{" "}
                    <button type="button" className="text-button" onClick={() => setActionFor(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      {tab === "route" && route && (
        <div className="asha-route">
          <div className="asha-route-summary">
            <strong>{route.stops?.length ?? 0} stops</strong>
            <span className="small">
              {route.estimated_stops > 0
                ? `~${route.total_km} km · ~${route.total_minutes} min for ${route.estimated_stops} estimated legs`
                : "Distance unavailable"} · straight-line estimates
            </span>
          </div>
          <RouteMap stops={route.stops || []} origin={route.origin} />
          <ol className="asha-stops">
            {(route.stops || []).map((s: Row, i: number) => (
              <li key={s.mother_id}>
                <span className="asha-stop-num">{i + 1}</span>
                <div>
                  <strong>{String(s.name).replace(/^SYNTHETIC /, "")}</strong>
                  <span className="small">
                    {" "}
                    · {s.village} · {s.household_label} · {s.leg_km == null
                      ? "Distance unavailable" : `+${s.leg_km} km (${s.leg_minutes} min)`} · priority {s.priority_score}
                  </span>
                  <div className="asha-reasons">
                    {(s.reasons || []).slice(0, 3).map((r: Row, j: number) => (
                      <span key={j} className="pill neutral">
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "notes" && (
        <div className="asha-notes">
          <NoteComposer
            api={api}
            items={items}
            noteFor={noteFor}
            setNoteFor={setNoteFor}
            onSave={(mother_id, transcript, recorded_at, structured) => {
              const queued = enqueue("note", {
                mother_id,
                transcript,
                structured,
                client_uuid: uuid(),
                recorded_at,
              });
              if (queued) setNoteFor(null);
              return Boolean(queued);
            }}
          />
          <h3>Recorded notes</h3>
          {!notes.length && <div className="empty">No notes yet.</div>}
          {notes.map((n) => {
            const ex = n.structured?.extracted || {};
            return (
              <article key={n.id} className="asha-note">
                <div className="asha-visit-head">
                  <strong>{stamp(n.recorded_at)}</strong>
                  <Badge status={n.camp_update_id ? "camp" : "note"} />
                </div>
                <p>{n.transcript}</p>
                {(ex.danger_signs?.length > 0 || ex.measurements && Object.keys(ex.measurements).length > 0) && (
                  <div className="asha-reasons">
                    {ex.danger_signs?.map((d: string) => (
                      <span key={d} className="pill amber">
                        ⚠ {d}
                      </span>
                    ))}
                    {Object.entries(ex.measurements || {}).map(([k, v]: [string, any]) => (
                      <span key={k} className="pill neutral">
                        {k}: {typeof v === "object" ? Object.values(v).join("/") : v}
                        {v?.unit ? `°${v.unit}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {tab === "camps" && (
        <div className="asha-camps">
          <form className="asha-camp-form" onSubmit={createCamp}>
            <label>
              Village
              <select
                value={campForm.village_id}
                onChange={(e) => setCampForm({ ...campForm, village_id: e.target.value })}
                required
              >
                <option value="">Select…</option>
                {(dash?.villages || []).map((v: Row) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Camp name
              <input
                value={campForm.name}
                onChange={(e) => setCampForm({ ...campForm, name: e.target.value })}
                placeholder="Immunization + ANC camp"
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={campForm.camp_date}
                onChange={(e) => setCampForm({ ...campForm, camp_date: e.target.value })}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Create camp
            </button>
          </form>
          {!camps.length && <div className="empty">No health camps planned.</div>}
          {camps.map((c) => (
            <article key={c.id} className="asha-camp">
              <div className="asha-visit-head">
                <div>
                  <strong>{c.name}</strong>
                  <span className="small">
                    {" "}
                    · {c.village_name} · {c.camp_date} · {c.updates ?? 0} updates
                  </span>
                </div>
                <Badge status={c.status} />
              </div>
              <div className="asha-visit-actions">
                {c.status === "planned" && (
                  <button className="primary" onClick={() => campStatus(c, "open")}>
                    Open camp
                  </button>
                )}
                {c.status === "open" && (
                  <>
                    <button className="primary" onClick={() => queueCampUpdates(c)}>
                      Queue beneficiary updates ({items.length} beneficiaries)
                    </button>
                    <button className="text-button" onClick={() => campStatus(c, "closed")}>
                      Close camp
                    </button>
                  </>
                )}
                {c.status === "closed" && (
                  <button className="text-button" onClick={() => campStatus(c, "open")}>
                    Reopen
                  </button>
                )}
              </div>
              {c.status === "open" && (
                <div className="asha-camp-grid">
                  <label>Find a beneficiary
                    <input type="search" value={campQuery} onChange={event => setCampQuery(event.target.value)}
                      placeholder="Name or village" />
                  </label>
                  {items.filter(v => [v.name, v.village, v.uhid].some(value =>
                    String(value || "").toLowerCase().includes(campQuery.trim().toLowerCase()))).map((v) => {
                    const d = draftFor(c.id, v.mother_id);
                    return (
                      <div key={v.mother_id} className="asha-camp-row">
                        <label className="asha-camp-check">
                          <input
                            type="checkbox"
                            checked={!!d.include}
                            onChange={(e) =>
                              setDraft(c.id, v.mother_id, { include: e.target.checked })
                            }
                          />
                          <span>{String(v.name).replace(/^SYNTHETIC /, "")}</span>
                        </label>
                        <select
                          value={d.kind}
                          onChange={(e) =>
                            setDraft(c.id, v.mother_id, { kind: e.target.value })
                          }
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {nice(k)}
                            </option>
                          ))}
                        </select>
                        {d.kind === "vitals" && (
                          <input
                            placeholder="Recorded BP, temperature or weight"
                            maxLength={800}
                            value={d.vitals?.text || ""}
                            onChange={(e) =>
                              setDraft(c.id, v.mother_id, {
                                vitals: { text: e.target.value },
                              })
                            }
                          />
                        )}
                        {d.kind === "immunization" && (
                          <>
                            <select
                              value={d.child_id || ""}
                              onChange={(e) =>
                                setDraft(c.id, v.mother_id, { child_id: e.target.value })
                              }
                            >
                              <option value="">Child…</option>
                              {(v.children || []).map((ch: Row) => (
                                <option key={ch.id} value={ch.id}>
                                  b. {ch.date_of_birth}
                                </option>
                              ))}
                            </select>
                            <input
                              placeholder="Vaccine"
                              maxLength={120}
                              value={d.vaccine || ""}
                              onChange={(e) =>
                                setDraft(c.id, v.mother_id, { vaccine: e.target.value })
                              }
                            />
                          </>
                        )}
                        {d.kind === "referral_flag" && (
                          <input
                            placeholder="Reason for referral"
                            value={d.reason || ""}
                            onChange={(e) =>
                              setDraft(c.id, v.mother_id, { reason: e.target.value })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                  {items.length > 12 && (
                    <p className="small">
                      Showing first 12 of {items.length} beneficiaries — open camp
                      day view on a larger screen for the full list.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {tab === "sync" && (
        <div className="asha-sync">
          <div className="asha-sync-head">
            <strong>{pendingCount} pending item{pendingCount === 1 ? "" : "s"}</strong>
            <button className="primary" onClick={() => void sync(true)} disabled={syncing || !pendingCount || !online || !queueReady}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          <p className="small">
            Field work is queued on this device first and uploaded in batches.
            Each item carries a client UUID, so retries never duplicate records.
            {lastSync ? ` Last successful sync ${stamp(lastSync)}.` : ""}
          </p>
          {!queue.length && <div className="empty">Queue is empty — everything is synced.</div>}
          {queue.map((q) => (
            <div key={q.client_uuid} className="asha-queue-item">
              <Badge status={q.entity} />
              <div>
                <strong>{nice(q.entity)}</strong>
                <span className="small">
                  {" "}
                  · queued {stamp(q.queued_at)} · {q.attempts} attempt
                  {q.attempts === 1 ? "" : "s"}
                  {q.last_error ? ` · ${q.last_error}` : ""}
                </span>
                <div className="small mono">{q.client_uuid.slice(0, 8)}…</div>
              </div>
              <button
                className="text-button"
                onClick={() => setQ((prev) => prev.filter((i) => i.client_uuid !== q.client_uuid))}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NoteComposer({
  api,
  items,
  noteFor,
  setNoteFor,
  onSave,
}: {
  api: Api;
  items: Row[];
  noteFor: Row | null;
  setNoteFor: (v: Row | null) => void;
  onSave: (motherId: string, transcript: string, recordedAt: string, structured: Row | null) => boolean;
}) {
  const [motherId, setMotherId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [structured, setStructured] = useState<Row | null>(null);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const [error, setError] = useState("");

  useEffect(() => () => recogRef.current?.abort(), []);

  useEffect(() => {
    if (noteFor) {
      setMotherId(noteFor.mother_id);
      setTranscript("");
      setStructured(null);
    }
  }, [noteFor]);

  function toggleDictation() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setError("Voice dictation is not supported in this browser — type or paste the note instead.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    if (!("processLocally" in rec)) {
      setError("This browser cannot keep dictation on the device. Type the visit note here.");
      return;
    }
    rec.lang = "en-IN";
    rec.processLocally = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      setTranscript(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setError("On-device dictation could not start. Enable the local English (India) language pack or type the note.");
    };
    recogRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setError("");
    } catch {
      setError("Allow microphone access to dictate, or type the note.");
    }
  }

  async function preview() {
    try {
      setStructured(null);
      const submitted = transcript;
      const r = await api("/asha/notes/extract", {
        method: "POST",
        body: JSON.stringify({ transcript }),
      });
      setStructured(r.structured ? { transcript: submitted, fields: r.structured } : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="asha-note-composer">
      <h3>Voice / text visit note</h3>
      <p className="small">
        Type a note or dictate with on-device speech recognition. When online, preview the extracted measurements and follow-up before saving.
      </p>
      <label>
        Beneficiary
        <select value={motherId} onChange={(e) => setMotherId(e.target.value)} required>
          <option value="">Select…</option>
          {items.map((v: Row) => (
            <option key={v.mother_id} value={v.mother_id}>
              {String(v.name).replace(/^SYNTHETIC /, "")} · {v.uhid}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note transcript
        <textarea
          rows={4}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Record the visit in your own words"
          maxLength={4000}
        />
      </label>
      <div className="asha-note-actions">
        <button
          type="button"
          className={listening ? "pill amber" : "text-button"}
          onClick={toggleDictation}
        >
          {listening ? "■ Stop dictation" : "🎙 Dictate"}
        </button>
        <button type="button" className="text-button" onClick={preview} disabled={transcript.trim().length < 3 || !navigator.onLine}>
          Preview structure
        </button>
        <button
          type="button"
          className="primary"
          disabled={!motherId || transcript.trim().length < 3}
          onClick={() => {
            if (!onSave(motherId, transcript.trim(), new Date().toISOString(), structured?.transcript === transcript ? structured.fields : null)) return;
            setTranscript("");
            setStructured(null);
            setMotherId("");
          }}
        >
          Save note{!navigator.onLine ? " (queued)" : ""}
        </button>
        {noteFor && (
          <button type="button" className="text-button" onClick={() => setNoteFor(null)}>
            Cancel
          </button>
        )}
      </div>
      {structured?.transcript === transcript && (
        <div className="asha-structured">
          <strong>Extracted structure (review before filing)</strong>
          <pre>{JSON.stringify(structured.fields, null, 2)}</pre>
        </div>
      )}
      {error && <div role="alert" className="error">{error}</div>}
    </div>
  );
}
