"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
const metrics = [
  ["water_m3", "Water", "m³"],
  ["energy_kwh", "Electricity", "kWh"],
  ["paper_sheets", "Paper", "sheets"],
  ["waste_kg", "Waste", "kg"],
];
const nice = (x: unknown) => String(x ?? "—").replaceAll("_", " ");
const number = (x: number) =>
  x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export function SustainabilityPanel({
  api,
  permissions,
}: {
  api: Api;
  permissions: string[];
}) {
  const [data, setData] = useState<Row | null>(null),
    [period, setPeriod] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editor, setEditor] = useState<Row | null>(null);
  const write = permissions.includes("green.write");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(
        await api("/sustainability" + (period ? "?period=" + period : "")),
      );
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, period]);
  useEffect(() => {
    load();
  }, [load]);
  async function save(path: string, body: Row) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setEditor(null);
      setNotice("Saved with reporting source and audit history.");
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function measure(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      v = Object.fromEntries(new FormData(form));
    if (
      await save("/sustainability/measurements", {
        ...v,
        value: Number(v.value),
        occupied_bed_days: v.occupied_bed_days
          ? Number(v.occupied_bed_days)
          : null,
      })
    ) {
      setPeriod(String(v.period));
      form.reset();
    }
  }
  async function action(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      v = Object.fromEntries(new FormData(form));
    if (
      await save("/sustainability/actions", {
        ...v,
        baseline: Number(v.baseline),
        target: Number(v.target),
      })
    )
      form.reset();
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget));
    await save("/sustainability/actions/" + editor!.id, {
      ...v,
      version: editor!.details.version,
      actual: v.actual === "" ? null : Number(v.actual),
    });
  }
  return (
    <div className="green-workspace">
      <div className="module-intro green-intro">
        <div>
          <div className="eyebrow">GREEN HOSPITAL · RESPONSIBLE REPORTING</div>
          <h2>Measure first. Improve against your own baseline.</h2>
          <p>
            Monthly resource observations and owned actions. No invented
            savings, peer rankings or AI-to-carbon conversions.
          </p>
        </div>
        <div>
          <label>
            Reporting month
            <input
              aria-label="Reporting month"
              type="month"
              value={period || data?.period || ""}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
          <button className="secondary" onClick={load} disabled={busy}>
            ↻ Refresh
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {busy && <p role="status">Loading / saving resource observations…</p>}
      {data && (
        <>
          <div className="green-indicators">
            {data.indicators.map((i: Row) => (
              <section key={i.metric} className="card green-indicator">
                <div className="green-indicator-head">
                  <span>{i.name}</span>
                  <span
                    className={"pill " + (i.observation ? "green" : "neutral")}
                  >
                    {i.observation
                      ? nice(i.observation.quality)
                      : "Unavailable"}
                  </span>
                </div>
                <strong>
                  {i.observation ? number(i.observation.value) : "—"}{" "}
                  <small>{i.unit}</small>
                </strong>
                <p>
                  {data.period} ·{" "}
                  {i.observation?.source || "No observation supplied"}
                </p>
                {i.change_percent !== null ? (
                  <p>
                    {i.change_percent > 0 ? "+" : ""}
                    {i.change_percent}% from {i.previous_period}
                    <br />
                    <small>
                      Same reporting method; consumption change, not attributed
                      savings.
                    </small>
                  </p>
                ) : (
                  <p className="small">
                    No comparable prior-month observation.
                  </p>
                )}
                {i.per_occupied_bed_day !== null && (
                  <p className="small">
                    {i.per_occupied_bed_day} {i.unit} / reported occupied
                    bed-day
                  </p>
                )}
                {i.observation && (
                  <details>
                    <summary>Source & evidence</summary>
                    <p>{i.observation.evidence}</p>
                    <p className="small">
                      Recorded{" "}
                      {new Date(i.observation.created_at).toLocaleString(
                        "en-IN",
                      )}
                    </p>
                  </details>
                )}
              </section>
            ))}
          </div>
          <div className="care-columns">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Monthly resource record</h2>
                  <p>
                    Enter the reporting period, measurement method and source.
                    Existing monthly evidence cannot be silently overwritten.
                  </p>
                </div>
              </div>
              {write ? (
                <form className="form-body care-form" onSubmit={measure}>
                  <div className="form-grid">
                    <label>
                      Reporting month
                      <input
                        name="period"
                        type="month"
                        required
                        max={new Date().toISOString().slice(0, 7)}
                      />
                    </label>
                    <label>
                      Metric
                      <select name="metric">
                        {metrics.map((m) => (
                          <option key={m[0]} value={m[0]}>
                            {m[1]} · {m[2]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Consumption
                      <input
                        name="value"
                        type="number"
                        required
                        min={0}
                        max={1e12}
                        step="any"
                      />
                    </label>
                    <label>
                      Data quality
                      <select name="quality">
                        <option value="measured">Measured</option>
                        <option value="facility_reported">
                          Facility-reported
                        </option>
                        <option value="estimated">Estimated</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Meter / record source
                    <input
                      name="source"
                      required
                      minLength={3}
                      maxLength={200}
                      placeholder="e.g. October meter ledger"
                    />
                  </label>
                  <label>
                    Evidence reference
                    <input
                      name="evidence"
                      required
                      minLength={3}
                      maxLength={1000}
                      placeholder="e.g. Meter ledger page 12"
                    />
                  </label>
                  <label>
                    Occupied bed-days · optional
                    <input
                      name="occupied_bed_days"
                      type="number"
                      min={1}
                      max={10000000}
                      step={1}
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Record observation
                  </button>
                </form>
              ) : (
                <div className="empty">
                  Your role cannot record measurements.
                </div>
              )}
            </section>
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Plan an improvement action</h2>
                  <p>
                    Set a measurable baseline and target with an accountable
                    owner. Targets remain goals until evidence is recorded.
                  </p>
                </div>
              </div>
              {write ? (
                <form className="form-body care-form" onSubmit={action}>
                  <label>
                    Action title
                    <input
                      name="title"
                      required
                      minLength={3}
                      maxLength={180}
                      placeholder="e.g. Investigate ward water leak"
                    />
                  </label>
                  <label>
                    Metric / unit
                    <select name="metric">
                      {metrics.map((m) => (
                        <option key={m[0]} value={m[0]}>
                          {m[1]} · {m[2]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid">
                    <label>
                      Baseline
                      <input
                        name="baseline"
                        type="number"
                        min={0}
                        max={1e12}
                        step="any"
                        required
                      />
                    </label>
                    <label>
                      Target consumption
                      <input
                        name="target"
                        type="number"
                        min={0}
                        max={1e12}
                        step="any"
                        required
                      />
                    </label>
                  </div>
                  <label>
                    Baseline period and source
                    <input
                      name="baseline_source"
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                  </label>
                  <label>
                    Responsible owner
                    <select name="owner_id" required>
                      <option value="">Choose authorised staff</option>
                      {data.staff.map((u: Row) => (
                        <option key={u.id} value={u.id}>
                          {u.name} · {nice(u.role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target completion date
                    <input name="due_date" type="date" required />
                  </label>
                  <button className="primary" disabled={busy}>
                    Create action
                  </button>
                </form>
              ) : (
                <div className="empty">Your role cannot plan actions.</div>
              )}
            </section>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Green actions register</h2>
                <p>
                  {data.actions.length} recorded actions · completion requires
                  an actual observation and evidence.
                </p>
              </div>
            </div>
            <div className="care-records">
              {data.actions.map((a: Row) => (
                <article className="care-record" key={a.id}>
                  <div className="care-record-heading">
                    <span
                      className={
                        "pill " +
                        (a.status === "completed" ? "green" : "neutral")
                      }
                    >
                      {nice(a.status)}
                    </span>
                    <span className="small">Due {a.due_date}</span>
                  </div>
                  <h3>{a.title}</h3>
                  <p>
                    Owner:{" "}
                    {data.staff.find((u: Row) => u.id === a.owner_id)?.name ||
                      a.owner_id}
                  </p>
                  <div className="green-baseline">
                    <div>
                      <small>Baseline</small>
                      <strong>
                        {number(a.baseline)} {a.unit}
                      </strong>
                    </div>
                    <div>
                      <small>Target</small>
                      <strong>
                        {number(a.target)} {a.unit}
                      </strong>
                    </div>
                    <div>
                      <small>Actual reported</small>
                      <strong>
                        {a.details.completion
                          ? number(a.details.completion.actual) + " " + a.unit
                          : "Not recorded"}
                      </strong>
                    </div>
                  </div>
                  <p className="small">
                    Baseline source: {a.details.baseline_source}
                  </p>
                  {write && !["completed", "cancelled"].includes(a.status) && (
                    <button className="secondary" onClick={() => setEditor(a)}>
                      Update progress
                    </button>
                  )}
                  <details className="care-history">
                    <summary>
                      Action history · {a.details.history.length}
                    </summary>
                    {a.details.history.map((h: Row, i: number) => (
                      <p key={i}>
                        {nice(h.status)} · {h.actor} · {h.notes}
                        {h.evidence && (
                          <>
                            <br />
                            Evidence: {h.evidence}
                          </>
                        )}
                      </p>
                    ))}
                  </details>
                </article>
              ))}
              {!data.actions.length && (
                <div className="empty">
                  No actions yet. Start with a measurable issue and a baseline
                  you can support.
                </div>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Reporting history</h2>
                <p>
                  Facility-only observations; no patient details or
                  environmental impact scores.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Metric</th>
                    <th>Consumption</th>
                    <th>Method / source</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h: Row) => (
                    <tr key={h.id}>
                      <td>{h.period}</td>
                      <td>{metrics.find((m) => m[0] === h.metric)?.[1]}</td>
                      <td>
                        {number(h.value)}{" "}
                        {metrics.find((m) => m[0] === h.metric)?.[2]}
                      </td>
                      <td>
                        {nice(h.quality)}
                        <p>{h.source}</p>
                      </td>
                      <td>{h.evidence}</td>
                    </tr>
                  ))}
                  {!data.history.length && (
                    <tr>
                      <td colSpan={5}>
                        No monthly consumption records supplied. Missing values
                        are not treated as zero.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <p className="small">
            {data.limitations} AI token/compute telemetry is unavailable in this
            module; no figures are fabricated.
          </p>
        </>
      )}
      {editor && (
        <div className="modal-backdrop">
          <section
            className="modal care-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="green-action-title"
          >
            <div className="card-head">
              <h2 id="green-action-title">Update {editor.title}</h2>
              <button
                className="icon-button"
                aria-label="Close action"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                ×
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <form className="form-body care-form" onSubmit={update}>
              <label>
                Status
                <select name="status">
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Progress / completion notes
                <textarea
                  autoFocus
                  name="notes"
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </label>
              <label>
                Actual observed consumption · {editor.unit}
                <input
                  name="actual"
                  type="number"
                  min={0}
                  max={1e12}
                  step="any"
                />
              </label>
              <label>
                Evidence reference
                <input name="evidence" maxLength={1000} />
              </label>
              <p className="small">
                Actual consumption and evidence are required to complete.
                Reporting a lower value does not by itself prove this action
                caused a saving.
              </p>
              <button className="primary" disabled={busy}>
                Save progress
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
