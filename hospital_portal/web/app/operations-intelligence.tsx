"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./operations-intelligence.module.css";

type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
const base = "/operations-intelligence";
const label = (s: unknown) => String(s ?? "—").replaceAll("_", " ");
const metricNames: Record<string, string> = {
  energy_kwh: "Electricity",
  water_m3: "Water",
  paper_sheets: "Paper",
  waste_kg: "Waste",
};
const metricUnits: Record<string, string> = {
  energy_kwh: "kWh",
  water_m3: "m³",
  paper_sheets: "sheets",
  waste_kg: "kg",
};
const number = (n: unknown) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : "Unavailable";
const date = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const icons: Record<string, string> = {
  inspect_resource_use: "♧",
  inspect_tickets: "▤",
  inspect_availability: "◷",
  optimize_maintenance: "⌘",
  explain_plan: "✧",
};
const titles: Record<string, string> = {
  inspect_resource_use: "Read resource use",
  inspect_tickets: "Inspect open work",
  inspect_availability: "Check declared capacity",
  optimize_maintenance: "Optimise the draft",
  explain_plan: "Explain & hand over",
};
function Leaf() {
  return (
    <svg
      viewBox="0 0 80 80"
      width="1em"
      height="1em"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M18 49C12 22 37 12 65 14c3 27-7 50-31 47"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M17 69 53 30M32 52l-2-17m12 6 17-1"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <svg
        width="110"
        height="80"
        viewBox="0 0 110 80"
        role="img"
        aria-label="Illustrated operations clipboard"
      >
        <rect
          x="22"
          y="12"
          width="65"
          height="58"
          rx="16"
          fill="var(--lavender)"
        />
        <path
          d="M37 32h34M37 43h25M37 54h18"
          stroke="var(--purple)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity=".4"
        />
        <circle cx="83" cy="59" r="15" fill="var(--bg)" stroke="var(--line)" />
        <path
          d="m76 59 5 5 10-11"
          fill="none"
          stroke="var(--purple)"
          strokeWidth="2"
        />
      </svg>
      <p>{children}</p>
    </div>
  );
}
export function OperationsIntelligencePanel({
  api,
  permissions,
  onOpenGreen,
}: {
  api: Api;
  permissions: string[];
  onOpenGreen: () => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [active, setActive] = useState<Row | null>(null),
    [tab, setTab] = useState("plan"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [excluded, setExcluded] = useState(""),
    [external, setExternal] = useState(false),
    [availabilityOpen, setAvailabilityOpen] = useState(false);
  const sequence = useRef(0),
    write = permissions.includes("operations.write");
  const load = useCallback(async () => {
    setError("");
    const n = ++sequence.current;
    try {
      const d = await api(base);
      if (n === sequence.current) {
        setData(d);
        setActive((a) =>
          a ? d.runs.find((r: Row) => r.id === a.id) || a : d.runs[0] || null,
        );
      }
    } catch (e) {
      if (n === sequence.current) setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  async function action(path: string, body: Row) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await api(base + path, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    const out = await action("/runs", {
      horizon_days: 7,
      exclude_staff_ids: excluded ? [excluded] : [],
      allow_external_ai: external,
    });
    if (out) {
      setActive(out);
      setTab("plan");
      setNotice(
        out.cache_hit
          ? "Reused the unchanged draft. No new solver or provider call."
          : "Draft ready. No work has been assigned.",
      );
      await load();
    }
  }
  async function seed() {
    const out = await action("/demo-scenario", {});
    if (out) {
      setNotice(
        out.added +
          " fictional workshop records added. Existing observations were kept.",
      );
      await load();
    }
  }
  async function availability(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const out = await action("/availability", {
      staff_id: f.get("staff"),
      starts_at: new Date(String(f.get("start"))).toISOString(),
      ends_at: new Date(String(f.get("end"))).toISOString(),
      domains: f.getAll("domain"),
      source: f.get("source"),
    });
    if (out) {
      form.reset();
      setAvailabilityOpen(false);
      setNotice(
        "Declared capacity saved. Existing drafts will be rechecked on approval.",
      );
      await load();
    }
  }
  async function decision(e: FormEvent<HTMLFormElement>, choice = "approve") {
    e.preventDefault();
    if (!active) return;
    const form = e.currentTarget,
      f = new FormData(form);
    const out = await action("/runs/" + active.id + "/decision", {
      version: active.version,
      decision: choice,
      note: f.get("note"),
    });
    if (out) {
      setActive({ ...active, state: out.state, version: out.version });
      setNotice(
        choice === "approve"
          ? "Assignments saved and tickets moved to In progress. No clinical roster was changed."
          : "Draft rejected. No assignment was created.",
      );
      await load();
    }
  }
  if (!data)
    return (
      <section className={styles.root}>
        <div
          className={styles.skeleton}
          aria-label="Loading operations intelligence"
        />
        {error && (
          <p role="alert">
            {error}
            <button onClick={load}>Retry</button>
          </p>
        )}
      </section>
    );
  const plan = active?.plan,
    usage = data.usage,
    assignments: Row[] = plan?.assignments || [];
  return (
    <div className={styles.root}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            OPERATIONS INTELLIGENCE · HUMAN APPROVED
          </span>
          <h2>
            Less waste.
            <br />A more prepared team.
          </h2>
          <p>
            Turn reported resource use and declared capacity into an explainable
            maintenance plan.
          </p>
          <div className={styles.heroStats}>
            <span>
              <b>{data.jobs.length}</b>Unassigned work items
            </span>
            <span>
              <b>{data.windows.filter((w: Row) => w.active).length}</b>Declared
              windows
            </span>
            <span>
              <b>{usage.cache_hits}</b>Drafts reused
            </span>
          </div>
        </div>
        <div className={styles.orbit} aria-hidden="true">
          <span>
            <Leaf />
          </span>
          <i>Read</i>
          <i>Plan</i>
          <i>Explain</i>
          <i>Approve</i>
        </div>
      </section>
      <div className={styles.toolbar}>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Operations intelligence views"
        >
          {[
            ["plan", "Action planner"],
            ["green", "Green Hospital"],
            ["usage", "Sustainable AI"],
            ["explain", "Decision trail · XAI"],
          ].map(([id, title]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
            >
              {title}
            </button>
          ))}
        </div>
        <span className={styles.badge}>Simulated on synthetic data</span>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button onClick={load}>Refresh</button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {tab === "plan" && (
        <>
          <section className={styles.controls}>
            <div>
              <h3>Build the next seven days</h3>
              <p>
                Inspection and maintenance coordination only. Capacity comes
                from declarations.
              </p>
            </div>
            <label>
              What-if: unavailable staff
              <select
                aria-label="Staff excluded from what-if plan"
                value={excluded}
                onChange={(e) => setExcluded(e.target.value)}
              >
                <option value="">Use all declared staff</option>
                {data.staff.map((s: Row) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.primary}
              disabled={busy || !write}
              onClick={run}
            >
              {busy
                ? "Working…"
                : excluded
                  ? "Compare a draft"
                  : "Build a plan →"}
            </button>
            <details className={styles.external}>
              <summary>AI planner options</summary>
              <p>
                The bounded policy agent works locally. Optional Gemini tool
                selection receives only aggregate counts, never patient records,
                staff names or source notes. At most two calls, with local
                fallback.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={external}
                  disabled={!data.external_ai_configured}
                  onChange={(e) => setExternal(e.target.checked)}
                />{" "}
                Allow external AI for these aggregates
              </label>
              {!data.external_ai_configured && (
                <small>
                  External planner is not configured; the local tool agent is
                  available.
                </small>
              )}
            </details>
          </section>
          {!data.jobs.length && (
            <Empty>
              No unassigned maintenance tickets. Inspect Green Hospital records
              or load the fictional workshop below.
            </Empty>
          )}
          {active ? (
            <section className={styles.plan}>
              <header>
                <div>
                  <span className={styles.eyebrow}>DRAFT & APPROVAL</span>
                  <h3>
                    {label(active.state)} · {assignments.length}{" "}
                    {active.state === "approved" ? "approved" : "proposed"}{" "}
                    assignments
                  </h3>
                </div>
                <label>
                  Saved plan
                  <select
                    aria-label="Saved operations plan"
                    value={active.id}
                    onChange={(e) =>
                      setActive(
                        data.runs.find((r: Row) => r.id === e.target.value) ||
                          active,
                      )
                    }
                  >
                    {data.runs.map((r: Row) => (
                      <option key={r.id} value={r.id}>
                        {label(r.state)} · {date(r.created_at)} ·{" "}
                        {r.plan.assignments.length} assignments
                      </option>
                    ))}
                  </select>
                </label>
                <span className={styles.badge}>
                  {plan.source === "cp_sat"
                    ? "Google OR-Tools · CP-SAT"
                    : "Rule fallback"}{" "}
                  · {label(plan.status)}
                </span>
              </header>
              <div className={styles.planStats}>
                <div>
                  <b>{plan.objective.points}</b>
                  <span>Priority points covered</span>
                </div>
                <div>
                  <b>{plan.objective.baseline_points}</b>
                  <span>Same-input greedy baseline</span>
                </div>
                <div>
                  <b>{number(plan.elapsed_ms)} ms</b>
                  <span>Measured planning time</span>
                </div>
                <div>
                  <b>{plan.unscheduled.length}</b>
                  <span>Unresolved work items</span>
                </div>
              </div>
              <div className={styles.assignmentList}>
                {assignments.map((a) => (
                  <article key={a.job_id}>
                    <span className={styles.jobIcon}>✓</span>
                    <div>
                      <h4>{a.title}</h4>
                      <p>
                        {a.staff_name} · {date(a.starts_at)}–
                        {new Date(a.ends_at).toLocaleTimeString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        IST
                      </p>
                      <details>
                        <summary>Why this assignment?</summary>
                        <p>{a.reason}</p>
                      </details>
                    </div>
                  </article>
                ))}
              </div>
              {plan.unscheduled.length > 0 && (
                <div className={styles.unresolved}>
                  <h4>Needs a person’s review</h4>
                  {plan.unscheduled.map((j: Row) => (
                    <p key={j.job_id}>
                      <b>
                        {j.title ||
                          data.jobs.find((t: Row) => t.id === j.job_id)
                            ?.title ||
                          "Recorded work item"}
                      </b>{" "}
                      · {j.reason}
                    </p>
                  ))}
                </div>
              )}
              {active.state === "draft" && write && (
                <form onSubmit={decision} className={styles.approval}>
                  <label>
                    Approval or rejection note
                    <input
                      name="note"
                      minLength={3}
                      maxLength={500}
                      required
                      placeholder="What did you check?"
                    />
                  </label>
                  <button
                    className={styles.primary}
                    disabled={busy || !assignments.length || !plan.verified}
                  >
                    Approve {assignments.length} assignments
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      const form = e.currentTarget.closest("form")!;
                      if (form.reportValidity())
                        decision(
                          {
                            preventDefault() {},
                            currentTarget: form,
                          } as FormEvent<HTMLFormElement>,
                          "reject",
                        );
                    }}
                  >
                    Reject draft
                  </button>
                  <small>
                    Approval rechecks source changes, time windows, skills and
                    overlaps inside a transaction.
                  </small>
                </form>
              )}
            </section>
          ) : (
            <Empty>
              Build a draft to see proposed assignments, a baseline comparison
              and approval controls.
            </Empty>
          )}
          <details
            className={styles.capacity}
            open={availabilityOpen}
            onToggle={(e) => setAvailabilityOpen(e.currentTarget.open)}
          >
            <summary>Declared capacity & availability</summary>
            <p>
              Only verified non-clinical staff can be selected. Declared domains
              are not a professional certification or permission to perform
              repairs.
            </p>
            <div className={styles.windowList}>
              {data.windows.map((w: Row) => (
                <article key={w.id}>
                  <strong>
                    {data.staff.find((s: Row) => s.id === w.staff_id)?.name ||
                      "Staff no longer eligible"}
                  </strong>
                  <span>
                    {date(w.starts_at)}–{date(w.ends_at)} IST ·{" "}
                    {w.domains.join(", ")}
                  </span>
                  <small>{w.source}</small>
                  {write && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await api(base + "/availability/" + w.id, {
                            method: "PATCH",
                            body: JSON.stringify({
                              version: w.version,
                              active: !w.active,
                            }),
                          });
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {w.active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </article>
              ))}
            </div>
            {write && (
              <form onSubmit={availability} className={styles.availabilityForm}>
                <label>
                  Staff
                  <select name="staff" required>
                    {data.staff.map((s: Row) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {label(s.role)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Starts (your local time)
                  <input name="start" type="datetime-local" required />
                </label>
                <label>
                  Ends (your local time)
                  <input name="end" type="datetime-local" required />
                </label>
                <fieldset>
                  <legend>Declared inspection domains</legend>
                  {["water", "energy", "waste"].map((d) => (
                    <label key={d}>
                      <input type="checkbox" name="domain" value={d} />
                      {label(d)}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Declaration source
                  <input
                    name="source"
                    minLength={3}
                    maxLength={300}
                    required
                    placeholder="Who confirmed this availability?"
                  />
                </label>
                <button className={styles.primary} disabled={busy}>
                  Save declared window
                </button>
              </form>
            )}
          </details>
        </>
      )}
      {tab === "green" && (
        <>
          <section className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>EVIDENCE BEFORE CLAIMS</span>
              <h3>Resource use, with context.</h3>
              <p>
                Compare adjacent months only when source and reporting quality
                match. Bed-day intensity is used when both denominators exist.
              </p>
            </div>
            <button onClick={onOpenGreen}>
              Open Green Hospital records ↗
            </button>
          </section>
          <div className={styles.greenGrid}>
            {data.insights.length ? (
              data.insights.map((r: Row) => (
                <article className={styles.greenCard} key={r.metric}>
                  <header>
                    <span className={styles.leaf}>
                      <Leaf />
                    </span>
                    <h3>{metricNames[r.metric] || label(r.metric)}</h3>
                    <span className={styles.badge}>{label(r.quality)}</span>
                  </header>
                  <strong>
                    {r.change_percent > 0 ? "+" : ""}
                    {number(r.change_percent)}%
                  </strong>
                  <p>
                    {metricUnits[r.metric] || "Recorded units"} · {r.basis}
                  </p>
                  <svg
                    viewBox="0 0 220 90"
                    role="img"
                    aria-label={
                      r.metric +
                      " prior " +
                      r.previous +
                      ", current " +
                      r.current
                    }
                  >
                    <rect
                      x="35"
                      y={
                        80 -
                        (60 * r.previous) / Math.max(r.previous, r.current, 1)
                      }
                      width="45"
                      height={
                        (60 * r.previous) / Math.max(r.previous, r.current, 1)
                      }
                      rx="8"
                      fill="var(--lavender)"
                    />
                    <rect
                      x="135"
                      y={
                        80 -
                        (60 * r.current) / Math.max(r.previous, r.current, 1)
                      }
                      width="45"
                      height={
                        (60 * r.current) / Math.max(r.previous, r.current, 1)
                      }
                      rx="8"
                      fill="var(--purple)"
                    />
                  </svg>
                  <div className={styles.chartLabels}>
                    <span>
                      {r.previous_period}
                      <b>{number(r.previous)}</b>
                    </span>
                    <span>
                      {r.period}
                      <b>{number(r.current)}</b>
                    </span>
                  </div>
                  <span className={styles.badge}>
                    {r.review_suggested
                      ? "◷ Review suggested"
                      : "○ Recorded comparison"}
                  </span>
                  <details>
                    <summary>Why this appears</summary>
                    <p>{r.reason}</p>
                    <p>
                      Source: {r.source}. Case mix, weather and reporting
                      changes may affect consumption. This is not a
                      hospital-quality score.
                    </p>
                  </details>
                </article>
              ))
            ) : (
              <Empty>
                Comparable observations are not available. Add sourced monthly
                readings in Green Hospital.
              </Empty>
            )}
          </div>
          <section className={styles.note}>
            <h4>No unsupported “green” score</h4>
            <p>
              Repair completion, resource savings and environmental impact
              require recorded evidence. A draft plan does not prove that energy
              or water was saved.
            </p>
          </section>
        </>
      )}
      {tab === "usage" && (
        <>
          <section className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>
                SUSTAINABLE AI · LOCAL FIRST
              </span>
              <h3>Use less. Measure what we know.</h3>
              <p>{usage.scope}</p>
            </div>
          </section>
          <div className={styles.usageGrid}>
            {[
              [usage.requests, "Recorded requests"],
              [usage.cache_hits, "Cache reuses"],
              [usage.provider_attempts, "External call attempts"],
              [
                usage.unknown_token_requests
                  ? "Partial"
                  : "" + number(usage.reported_tokens),
                "Provider-reported tokens",
              ],
              [
                usage.mean_latency_ms === null
                  ? "Unavailable"
                  : number(usage.mean_latency_ms) + " ms",
                "Mean server latency",
              ],
              ["Unavailable", "Provider energy / carbon"],
            ].map(([v, t]) => (
              <article key={t}>
                <span>{t}</span>
                <strong>{v}</strong>
              </article>
            ))}
          </div>
          <div className={styles.note}>
            <h4>Built-in compute controls</h4>
            <ul>
              <li>
                Local policy agent and CP-SAT by default; no external model
                required.
              </li>
              <li>
                Identical source snapshots reuse a draft for{" "}
                {data.policy.cache_minutes} minutes.
              </li>
              <li>
                At most {data.policy.max_tool_steps} tools and{" "}
                {data.policy.max_provider_calls} external calls per run.
              </li>
              <li>
                Solver time budget: {data.policy.solver_seconds} seconds;{" "}
                {data.policy.max_jobs} jobs, {data.policy.max_windows} windows
                maximum.
              </li>
              <li>No prompts, API keys or patient records in usage events.</li>
            </ul>
            <p>
              Latency is not GPU time. External attempts are not confirmed
              billed calls. Provider energy, water and carbon savings are not
              available.
            </p>
          </div>
        </>
      )}
      {tab === "explain" && (
        <>
          <section className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>EXPLAINABLE OPERATIONS</span>
              <h3>Every step leaves a reason.</h3>
              <p>
                Constraint and rule explanations, rather than a clinical risk
                score or a causal claim.
              </p>
            </div>
          </section>
          {active ? (
            <>
              <div className={styles.trace}>
                {active.trace.map((t: Row) => (
                  <article key={t.step}>
                    <span className={styles.traceIcon}>{icons[t.tool]}</span>
                    <div>
                      <span className={styles.eyebrow}>
                        STEP {t.step} · {label(t.planner)}
                      </span>
                      <h4>{titles[t.tool]}</h4>
                      <p>{t.reason}</p>
                      <div className={styles.traceFacts}>
                        {Object.entries(t.result).map(([k, v]) => (
                          <span key={k}>
                            {label(k)}:{" "}
                            <b>
                              {typeof v === "boolean"
                                ? v
                                  ? "Yes"
                                  : "No"
                                : String(v)}
                            </b>
                          </span>
                        ))}
                      </div>
                    </div>
                    <small>{number(t.elapsed_ms)} ms</small>
                  </article>
                ))}
              </div>
              <div className={styles.explanationGrid}>
                <section>
                  <h4>Hard constraints</h4>
                  <ul>
                    {plan.constraints.map((x: string) => (
                      <li key={x}>✓ {x}</li>
                    ))}
                  </ul>
                  <p>
                    Independent feasibility check:{" "}
                    {plan.verified ? "passed" : "not passed"}
                  </p>
                </section>
                <section>
                  <h4>Assumptions & alternatives</h4>
                  <p>{active.assumptions}</p>
                  <p>
                    Baseline: {plan.objective.baseline}. Difference:{" "}
                    {plan.objective.point_difference} maintenance priority
                    points.
                  </p>
                  <p>
                    {plan.status === "OPTIMAL"
                      ? "The solver proved optimality for this bounded input and objective."
                      : "A bounded feasible or fallback result; global optimality is not claimed."}
                  </p>
                </section>
              </div>
              <details className={styles.note}>
                <summary>Provenance & run details</summary>
                <p>
                  Snapshot: <code>{active.input_hash}</code>
                </p>
                <p>
                  Created {date(active.created_at)} IST · {label(active.agent)}
                </p>
                <p>
                  Policy version:{" "}
                  {active.policy_snapshot?.version ||
                    "Not stored on this earlier draft"}
                </p>
                <p>{active.usage.note}</p>
                {active.provider_notes.map((n: string) => (
                  <p key={n}>{n}</p>
                ))}
              </details>
            </>
          ) : (
            <Empty>
              Build a plan to inspect its tool trace, hard constraints and
              baseline.
            </Empty>
          )}
        </>
      )}
      <section className={styles.demo}>
        <div>
          <h4>Explore with a fictional workshop</h4>
          <p>
            Add labelled resource observations, three inspection tickets and
            declared demo capacity. Existing readings are preserved.
          </p>
        </div>
        <button disabled={busy || !write || !data.demo} onClick={seed}>
          Load synthetic workshop
        </button>
      </section>
      <footer className={styles.footer}>
        <span>Non-clinical planning · human approval required</span>
        <span>Reported {date(data.reported_at)} IST</span>
        <button onClick={load} disabled={busy}>
          Refresh
        </button>
      </footer>
    </div>
  );
}
