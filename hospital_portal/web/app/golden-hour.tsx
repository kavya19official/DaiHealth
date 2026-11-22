"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./golden-hour.module.css";

type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;

const LABEL = "PROTOTYPE — synthetic demonstration. No real hospital, ambulance or clinician is contacted.";
const OPEN = new Set(["incoming", "seen", "accepted"]);

function nice(value: string) {
  return String(value || "").replaceAll("_", " ");
}
function ago(iso?: string) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return seconds + " s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  return Math.round(seconds / 3600) + " h ago";
}
function fact(sbar: Row | undefined, label: string) {
  for (const section of sbar?.sections || []) {
    const hit = (section.rows || []).find((r: Row) => r.label === label);
    if (hit) return hit.value as string;
  }
  return "Not recorded";
}

/** One poll loop for incoming alerts. Short polling, quicker while the tab is visible. */
function useIncoming(api: Api, active = true) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const value = await api("/golden-hour/staff/incoming");
      setData(value);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    if (!active) return;
    load();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {
        await load();
        tick();
      }, document.visibilityState === "visible" ? 3000 : 15000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [active, load]);
  return { data, error, load };
}

/** Alarm tone through Web Audio. Browsers only allow sound after a user gesture, so we arm on the first click or key press. */
function useAlarm() {
  const ctx = useRef<AudioContext | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const arm = () => {
      try {
        if (!ctx.current) {
          const Ctor = window.AudioContext || (window as any).webkitAudioContext;
          if (Ctor) ctx.current = new Ctor();
        }
        ctx.current?.resume().then(() => setReady(ctx.current?.state === "running"));
      } catch {
        /* no audio available */
      }
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);
  const play = useCallback((urgent: boolean) => {
    const audio = ctx.current;
    if (!audio || audio.state !== "running") return false;
    const tones = urgent ? [[620, 0, 0.22]] : [[880, 0, 0.18], [660, 0.22, 0.18], [880, 0.44, 0.18]];
    for (const [freq, start, length] of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + start);
      osc.stop(audio.currentTime + start + length + 0.05);
    }
    return true;
  }, []);
  const arm = useCallback(() => {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!ctx.current && Ctor) ctx.current = new Ctor();
    ctx.current?.resume().then(() => setReady(ctx.current?.state === "running"));
  }, []);
  return { play, ready, arm };
}

function MiniMap({ ambulance }: { ambulance: Row }) {
  const o = ambulance?.origin, d = ambulance?.destination, p = ambulance?.position;
  if (!o || !d || o.lat == null || !p) return null;
  const lats = [o.lat, d.lat], lngs = [o.lng, d.lng];
  const pad = 0.012;
  const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
  const W = 320, H = 130;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * (W - 24) + 12;
  const y = (lat: number) => (1 - (lat - minLat) / (maxLat - minLat || 1)) * (H - 24) + 12;
  return (
    <svg className={styles.map} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Simulated route from the patient to this hospital">
      <line x1={x(o.lng)} y1={y(o.lat)} x2={x(d.lng)} y2={y(d.lat)} className={styles.route} />
      <circle cx={x(o.lng)} cy={y(o.lat)} r="6" className={styles.patientDot} />
      <rect x={x(d.lng) - 7} y={y(d.lat) - 7} width="14" height="14" rx="3" className={styles.hospitalDot} />
      <circle cx={x(p.lng)} cy={y(p.lat)} r="7" className={styles.ambulanceDot} />
      <text x={x(o.lng)} y={y(o.lat) - 10} className={styles.mapText} textAnchor="middle">Patient</text>
      <text x={x(d.lng)} y={y(d.lat) + 22} className={styles.mapText} textAnchor="middle">This hospital</text>
    </svg>
  );
}

function IncomingCard({ row, canDecide, canWrite, api, onChange, compact }: { row: Row; canDecide: boolean; canWrite: boolean; api: Api; onChange: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);
  const sbar = row.sbar || {};
  const amb = row.ambulance || {};
  const emergency = row.priority === "emergency";
  const open = OPEN.has(row.status);

  async function act(path: string, body: Row) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setDeclining(false);
      setReason("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const decide = (status: string) => act("/golden-hour/staff/alerts/" + row.id + "/decision", { status, version: row.version, note: status === "declined" ? reason : "" });
  const seen = () => act("/golden-hour/staff/alerts/" + row.id + "/seen", { version: row.version });
  async function copy() {
    try {
      await navigator.clipboard.writeText(sbar.text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy is not available in this browser.");
    }
  }

  return (
    <article className={`${styles.card} ${emergency ? styles.emergency : styles.urgent} ${row.status === "incoming" ? styles.pulse : ""}`} aria-label={"Incoming patient " + row.patient_name}>
      <header className={styles.cardHead}>
        <div>
          <span className={`${styles.chip} ${emergency ? styles.chipRed : styles.chipAmber}`}>{emergency ? "EMERGENCY" : "URGENT"}</span>{" "}
          <span className={styles.chip}>{nice(row.status)}</span>
          <h3>{row.patient_name}</h3>
          <p className={styles.sub}>
            Raised by {row.triggered_by === "family" ? "a family member" : "the patient"} · {ago(row.created_at)} · from {row.origin_label || "unknown area"} · {row.distance_km} km
          </p>
        </div>
        <div className={styles.eta} aria-live="polite">
          <strong>{amb.state === "arrived" ? "Arrived" : amb.state === "stood_down" ? "Stood down" : "~" + (amb.remaining_minutes ?? row.eta_minutes) + " min"}</strong>
          <span>{amb.state === "stood_down" ? "alert closed" : "ETA · " + nice(amb.state || "dispatching")}</span>
          <small>SIMULATED feed, demo speed ×{amb.speedup}</small>
        </div>
      </header>

      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((amb.progress || 0) * 100)} aria-label="Simulated ambulance progress">
        <span style={{ width: Math.round((amb.progress || 0) * 100) + "%" }} />
      </div>
      {!compact && <MiniMap ambulance={amb} />}

      <dl className={styles.facts}>
        <div><dt>Gestation</dt><dd>{fact(sbar, "Situation")}</dd></div>
        <div><dt>Danger signs</dt><dd>{fact(sbar, "Danger signs reported")}</dd></div>
        <div className={styles.key}><dt>Last BP readings</dt><dd>{fact(sbar, "Last blood pressure readings")}</dd></div>
        <div className={styles.key}><dt>Blood group</dt><dd>{fact(sbar, "Blood group")}</dd></div>
        <div className={styles.key}><dt>Allergies</dt><dd>{fact(sbar, "Allergies")}</dd></div>
        <div><dt>Current medicines</dt><dd>{fact(sbar, "Current medicines")}</dd></div>
      </dl>

      <section className={styles.why}>
        <h4>Why this hospital</h4>
        <p>
          Chosen by fixed capability rules: the nearest facility that lists what this situation needs.
          {(row.requirements?.caps || []).concat((row.requirements?.svcs || [])).length > 0 && " Needs: " + [...(row.requirements?.caps || []), ...(row.requirements?.svcs || [])].map(nice).join(", ") + "."}
        </p>
        {(row.skipped_nearer || []).length > 0 && (
          <ul>
            {row.skipped_nearer.map((s: Row) => (
              <li key={s.name}><strong>{s.name}</strong> ({s.distance_km} km) was nearer but lacks {s.missing.join(", ")}.</li>
            ))}
          </ul>
        )}
      </section>

      {!compact && (
        <details open={emergency && open}>
          <summary>SBAR handover</summary>
          <div className={styles.sbar}>
            {(sbar.sections || []).map((section: Row) => (
              <section key={section.key}>
                <h5><span>{section.key}</span> {section.title}</h5>
                <dl>
                  {section.rows.map((r: Row) => (<div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>))}
                </dl>
              </section>
            ))}
            {(sbar.readiness_checklist || []).length > 0 && (
              <section>
                <h5><span>✓</span> Suggested readiness checks</h5>
                <ul>{sbar.readiness_checklist.map((x: string) => <li key={x}>{x}</li>)}</ul>
              </section>
            )}
          </div>
          <button type="button" className={styles.ghost} onClick={copy}>{copied ? "Copied" : "Copy SBAR text"}</button>
        </details>
      )}

      {row.public_note && <p className={styles.note}>Patient sees: {row.public_note}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}

      {open && canWrite && (
        <div className={styles.actions}>
          {row.status === "incoming" && <button type="button" className={styles.ghost} disabled={busy} onClick={seen}>I have seen this</button>}
          {canDecide && row.status !== "accepted" && !declining && (
            <>
              <button type="button" className={styles.accept} disabled={busy} onClick={() => decide("accepted")}>Accept incoming patient</button>
              <button type="button" className={styles.decline} disabled={busy} onClick={() => setDeclining(true)}>Cannot accept…</button>
            </>
          )}
          {canDecide && row.status === "accepted" && <button type="button" className={styles.accept} disabled={busy} onClick={() => decide("arrived")}>Patient has arrived</button>}
          {!canDecide && <span className={styles.sub}>A consultant or hospital administrator accepts or declines.</span>}
        </div>
      )}
      {declining && (
        <form className={styles.declineForm} onSubmit={(e) => { e.preventDefault(); decide("declined"); }}>
          <label>Why can the hospital not accept? The family is told and the alert moves to the next capable facility.
            <textarea required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className={styles.decline} disabled={busy}>Confirm cannot accept</button>{" "}
          <button type="button" className={styles.ghost} onClick={() => setDeclining(false)}>Back</button>
        </form>
      )}
      {!compact && (row.events || []).length > 0 && (
        <details><summary>Status history</summary><ol>{row.events.map((e: Row) => (<li key={e.version + e.status}>{nice(e.status)} — {e.note}</li>))}</ol></details>
      )}
      <p className={styles.proto}>{LABEL} A pre-alert is not a bed reservation. Clinical decisions remain with your team.</p>
    </article>
  );
}

/** Always mounted for staff who can read coordination. Beeps, flashes the title and opens the newest unseen alert over any screen. */
export function GoldenHourLayer({ api, permissions, onOpenBoard }: { api: Api; permissions: string[]; onOpenBoard: () => void }) {
  const { data, error, load } = useIncoming(api, true);
  const alarm = useAlarm();
  const [muted, setMuted] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const baseTitle = useRef("");
  const incoming: Row[] = (data?.alerts || []).filter((a: Row) => a.status === "incoming");
  const loud = incoming.filter((a) => !muted.includes(a.id));
  const focus: Row | undefined = loud.find((a) => !dismissed.includes(a.id)) || undefined;

  const { play } = alarm;
  const loudCount = loud.length;
  const urgentOnly = loud.every((a) => a.priority !== "emergency");
  useEffect(() => {
    if (!loudCount) return;
    play(urgentOnly);
    const timer = setInterval(() => play(urgentOnly), urgentOnly ? 8000 : 3000);
    return () => clearInterval(timer);
  }, [loudCount, urgentOnly, play]);
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title;
    if (!incoming.length) { document.title = baseTitle.current; return; }
    let flip = false;
    const timer = setInterval(() => { flip = !flip; document.title = flip ? "🚨 INCOMING PATIENT" : baseTitle.current; }, 1000);
    return () => { clearInterval(timer); document.title = baseTitle.current; };
  }, [incoming.length]);

  const canWrite = permissions.includes("coordination.write");
  const watching = !error && data;
  return (
    <>
      <div className={styles.dock} aria-live="polite">
        <span className={watching ? styles.live : styles.dead} aria-hidden="true" />
        <span>{watching ? "Golden Hour live" : "Golden Hour feed interrupted"}</span>
        {!alarm.ready && <button type="button" onClick={alarm.arm}>Enable alert sound</button>}
      </div>
      {incoming.length > 0 && (
        <div className={styles.banner} role="alert">
          <strong>🚨 {incoming.length} incoming patient{incoming.length > 1 ? "s" : ""}</strong>
          <span>{incoming.map((a) => a.patient_name).join(", ")}</span>
          <button type="button" onClick={() => { setDismissed((d) => d.filter((id) => !incoming.some((a) => a.id === id))); }}>Show card</button>
          <button type="button" onClick={() => setMuted((m) => [...m, ...incoming.map((a) => a.id)])}>Silence</button>
          <button type="button" onClick={onOpenBoard}>Open Golden Hour board</button>
        </div>
      )}
      {focus && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Incoming patient">
          <div className={styles.modal}>
            <button type="button" className={styles.close} aria-label="Hide card (alert stays active)" onClick={() => setDismissed((d) => [...d, focus.id])}>×</button>
            <IncomingCard row={focus} canDecide={!!data?.can_decide} canWrite={canWrite} api={api} onChange={load} />
          </div>
        </div>
      )}
    </>
  );
}

/** The full Golden Hour screen: every alert for this facility from the last 12 hours. */
export function GoldenHourBoard({ api, permissions }: { api: Api; permissions: string[] }) {
  const { data, error, load } = useIncoming(api, true);
  const canWrite = permissions.includes("coordination.write");
  const rows: Row[] = data?.alerts || [];
  const open = rows.filter((a) => OPEN.has(a.status));
  const closed = rows.filter((a) => !OPEN.has(a.status));
  return (
    <section className={styles.board}>
      <header>
        <h2>Golden Hour · incoming emergency patients</h2>
        <p>{LABEL}</p>
        <p>Pre-alerts sent to <strong>{data?.facility_name || "the active facility"}</strong> by patients and authorised family members. Choose the facility with the Facility context selector. This list refreshes every few seconds.</p>
        <button type="button" onClick={load}>Refresh now</button>
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {data && open.length === 0 && <p className={styles.empty}>No open pre-alerts for this facility.</p>}
      {open.map((r) => <IncomingCard key={r.id} row={r} canDecide={!!data?.can_decide} canWrite={canWrite} api={api} onChange={load} />)}
      {closed.length > 0 && <h3>Closed in the last 12 hours</h3>}
      {closed.map((r) => <IncomingCard key={r.id} row={r} canDecide={false} canWrite={false} api={api} onChange={load} compact />)}
    </section>
  );
}
