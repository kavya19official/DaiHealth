"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./ultrasound.module.css";

type API = (path: string, options?: RequestInit) => Promise<unknown>;
type State = "quality_issue" | "model_unavailable" | "prediction" | "priority_review" | "low_confidence";
type ReviewItem = {
  id: string;
  patient_name: string;
  uhid: string;
  created_at: string;
  updated_at: string;
  image_expires_at: string;
  image_available: boolean;
  pregnancy_context: { stage?: string; gestation_weeks?: number; edd?: string };
  analysis: { state: State; model_version?: string; label?: string;
    probabilities?: Record<string, number>; confidence?: number; quality?: Record<string, number> };
  reasons: string[];
  revision: number;
  review_status: "pending" | "reviewed";
  reviewed_at?: string;
  decision?: string;
  review_note?: string;
};
type Queue = { items: ReviewItem[]; has_more: boolean; enabled: boolean };

const states: Record<State, string> = {
  quality_issue: "Image quality issue", model_unavailable: "Model unavailable",
  prediction: "Research scores available", priority_review: "Priority review", low_confidence: "Low confidence",
};
const decisions: Record<string, string> = {
  review_complete: "Review complete", follow_up_needed: "Follow-up needed", replacement_requested: "Replacement image requested",
};
const formatTime = (value: string) => new Date(value).toLocaleString();
const percent = (value: number) => (value * 100).toFixed(1) + "%";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Ultrasound request failed.";
const path = "/ultrasound";

function Badges({ item }: { item: ReviewItem }) {
  return <div className={styles.badges}>
    <span data-status={item.review_status}>{item.review_status === "reviewed" ? "Reviewed by clinician" : "Pending review"}</span>
    <span data-status={item.analysis.state}>{states[item.analysis.state]}</span>
    {item.analysis.state === "priority_review" && item.analysis.confidence !== undefined && item.analysis.confidence < .8 &&
      <span data-status="low_confidence">Low confidence</span>}
  </div>;
}

export function UltrasoundUpload({ api, motherId, open }: { api: API; motherId: string; open: (id: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    // Capability check without reading queue entries or patient data.
    api(path + "/capability")
      .then(result => { if (active) setEnabled((result as { enabled: boolean }).enabled); })
      .catch(error => { if (active) setMessage(errorMessage(error)); });
    return () => { active = false; };
  }, [api]);
  if (!enabled) return message ? <p role="alert">{message}</p> : null;
  return <section className={styles.panel} aria-label="Upload ultrasound">
    <h3>Upload ultrasound for review</h3>
    <p>Use a single PNG, JPEG or WebP image up to 12 MiB. Check that it belongs to this pregnancy and remove any identifiers visible in the image.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const image = new FormData(form).get("image");
      if (!(image instanceof File) || !image.size) return;
      if (image.size > 12 * 1024 * 1024) {
        setMessage("Choose an image no larger than 12 MiB.");
        return;
      }
      setBusy(true);
      setMessage("");
      try {
        const result = await api(path + "/patients/" + motherId, {
          method: "POST", body: image, headers: { "Content-Type": image.type }, signal: AbortSignal.timeout(30000),
        }) as { id: string };
        form.reset();
        open(result.id);
      } catch (error) {
        setMessage(errorMessage(error));
      } finally {
        setBusy(false);
      }
    }}>
      <label>Ultrasound image <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required disabled={busy}/></label>
      <button type="submit" disabled={busy}>{busy ? "Uploading and checking image…" : "Upload for review"}</button>
    </form>
    {message && <p role="alert">{message}</p>}
  </section>;
}

function Preview({ api, item }: { api: API; item: ReviewItem }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (!requests || !item.image_available) return;
    const controller = new AbortController();
    let objectUrl = "";
    api(path + "/" + item.id + "/image", { headers: { Accept: "image/png" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(result => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(result as Blob);
          setUrl(objectUrl);
        }
      }).catch(error => { if (!controller.signal.aborted) setMessage(errorMessage(error)); });
    const expiry = new Date(item.image_expires_at).getTime();
    const timer = window.setInterval(() => {
      if (Date.now() < expiry) return;
      window.clearInterval(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl("");
      setMessage("The image retention period has ended.");
    }, 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, item.id, item.image_available, item.image_expires_at, requests]);
  if (!item.image_available) return <p>Image retention period ended.</p>;
  if (url) return <img className={styles.preview} src={url} alt="Ultrasound frame submitted for clinician review"/>;
  return <>
    {message && <p role="alert">{message}</p>}
    <button type="button" disabled={requests > 0 && !message} onClick={() => {
      setMessage("");
      setRequests(requests + 1);
    }}>{requests > 0 && !message ? "Loading private image…" : "View ultrasound image"}</button>
  </>;
}

export function UltrasoundReview({ api, permissions, selected, select }: {
  api: API; permissions: string[]; selected: string; select: (id: string) => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const options = signal ? { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) } : undefined;
    if (selected) {
      const result = await api(path + "/" + selected, options) as ReviewItem;
      if (!signal?.aborted) setItem(result);
    } else {
      const result = await api(path + "?" + new URLSearchParams({ reviewed: String(reviewed), offset: String(offset) }), options) as Queue;
      if (!signal?.aborted) setQueue(result);
    }
  }, [api, offset, reviewed, selected]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [load]);

  function open(id: string) {
    setError("");
    setItem(null);
    setQueue(null);
    select(id);
  }

  async function change(action: string, options: RequestInit) {
    setBusy(true);
    setError("");
    try {
      await api(path + "/" + selected + "/" + action, { ...options, signal: AbortSignal.timeout(30000) });
      await load();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const current = item?.id === selected ? item : null;
  return <section className={styles.panel} aria-label="Ultrasound AI Review">
    <p>Archive-label scores are experimental. A clinician reviews each submission and records a separate decision.</p>
    {error && <p role="alert">{error}</p>}
    {selected ? <>
      <button type="button" onClick={() => open("")} disabled={busy}>Back to review queue</button>
      {!current && !error && <p role="status">Loading ultrasound record…</p>}
      {current && <article className={styles.card}>
        <h2>{current.patient_name} <small>{current.uhid}</small></h2>
        <Badges item={current}/>
        <dl className={styles.facts}>
          <div><dt>Uploaded</dt><dd>{formatTime(current.created_at)}</dd></div>
          <div><dt>Recorded pregnancy stage</dt><dd>{current.pregnancy_context.stage ?? "Unavailable"}</dd></div>
          <div><dt>Recorded gestational age</dt><dd>{current.pregnancy_context.gestation_weeks != null ? current.pregnancy_context.gestation_weeks + " weeks" : "Unavailable"}</dd></div>
          <div><dt>Estimated due date</dt><dd>{current.pregnancy_context.edd ?? "Unavailable"}</dd></div>
          <div><dt>Image quality</dt><dd>{current.analysis.state === "quality_issue" ? "Raster quality issue" :
            current.analysis.quality?.width ? "Passed raster checks" : "Not assessed"}</dd></div>
          <div><dt>Review priority</dt><dd>{current.analysis.state === "priority_review" ? "Priority" : "Routine"}</dd></div>
          <div><dt>Model version</dt><dd className={styles.hash}>{current.analysis.model_version ?? "Unavailable"}</dd></div>
          <div><dt>Record updated</dt><dd>{formatTime(current.updated_at)}</dd></div>
        </dl>
        <ul>{current.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {current.analysis.probabilities && <div>
          <h3>Experimental archive scores</h3>
          <p>Top archive class <strong>{current.analysis.label}</strong> · Confidence <strong>{percent(current.analysis.confidence!)}</strong></p>
          <dl className={styles.facts}>{Object.entries(current.analysis.probabilities).map(([label, probability]) =>
            <div key={label}><dt>{label}</dt><dd>{percent(probability)}</dd></div>)}</dl>
        </div>}
        <Preview key={current.id} api={api} item={current}/>
        {current.review_status === "reviewed" ? <div className={styles.review}>
          <h3>{decisions[current.decision ?? ""]}</h3>
          <p>{current.review_note}</p>
          {current.reviewed_at && <time>{formatTime(current.reviewed_at)}</time>}
        </div> : <>
          {current.analysis.state === "model_unavailable" && current.image_available && permissions.includes("ultrasound.upload") &&
            <button type="button" disabled={busy} onClick={() => void change("retry", { method: "POST" })}>Retry analysis</button>}
          {permissions.includes("ultrasound.review") && <form key={current.revision} className={styles.review} onSubmit={event => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void change("review", { method: "POST", body: JSON.stringify({
              revision: current.revision, decision: values.get("decision"), note: values.get("note"),
            }) });
          }}>
            <label>Review decision <select name="decision" required defaultValue="">
              <option value="" disabled>Select a decision</option>
              {Object.entries(decisions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>Clinician comments <textarea name="note" required minLength={5} maxLength={1000}/></label>
            <button type="submit" disabled={busy}>{busy ? "Working…" : "Record ultrasound review"}</button>
          </form>}
        </>}
      </article>}
    </> : <>
      {queue?.enabled === false ? <p>Ultrasound intake is disabled for this deployment.</p> :
        <div className={styles.controls}>
          <label>Review status <select value={String(reviewed)} onChange={event => {
            setError(""); setQueue(null); setOffset(0); setReviewed(event.target.value === "true");
          }}><option value="false">Pending review</option><option value="true">Reviewed by clinician</option></select></label>
          <button type="button" onClick={() => {
            setError(""); load().catch(error => setError(errorMessage(error)));
          }}>Refresh queue</button>
        </div>}
      {!queue && !error && <p role="status">Loading review queue…</p>}
      {queue?.enabled && !queue.items.length && <p>No ultrasound records in this view.</p>}
      {queue?.items.map(row => <article className={styles.card} key={row.id}>
        <h2>{row.patient_name} <small>{row.uhid}</small></h2>
        <Badges item={row}/>
        <p>Uploaded {formatTime(row.created_at)}</p>
        <button type="button" onClick={() => open(row.id)}>Open ultrasound review</button>
      </article>)}
      {(offset > 0 || queue?.has_more) && <nav className={styles.controls} aria-label="Ultrasound queue pages">
        <button type="button" disabled={offset === 0} onClick={() => { setQueue(null); setOffset(offset - 25); }}>Previous</button>
        <button type="button" disabled={!queue?.has_more} onClick={() => { setQueue(null); setOffset(offset + 25); }}>Next</button>
      </nav>}
    </>}
  </section>;
}
