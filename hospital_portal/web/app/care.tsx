"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
const nice = (x: unknown) => String(x ?? "—").replaceAll("_", " ");
const compact = (x: string) =>
  x?.replace("Dr SYNTHETIC ", "Dr. ").replace(/^SYNTHETIC /, "Demo ") || "—";
const barriers = [
  "none",
  "transport",
  "cost",
  "language",
  "unreachable",
  "appointment_unavailable",
  "records_missing",
  "other",
];
const stamp = (x: string) => new Date(x).toLocaleString("en-IN");
function Badge({ status }: { status: string }) {
  return (
    <span
      className={
        "pill " +
        (/completed|approved|closed/.test(status)
          ? "green"
          : /escalated|correction/.test(status)
            ? "amber"
            : "neutral")
      }
    >
      {nice(status)}
    </span>
  );
}
function History({ items }: { items: Row[] }) {
  return (
    <details className="care-history">
      <summary>History & evidence · {items.length}</summary>
      {items.map((h, i) => (
        <div key={i}>
          <strong>
            {nice(h.action)} · {h.actor}
          </strong>
          <p>
            {stamp(h.at)} · {h.notes}
          </p>
          {h.outcome && (
            <p>
              {nice(h.outcome)} · {nice(h.barrier)}
            </p>
          )}
          {h.evidence && <p>Evidence: {h.evidence}</p>}
          {h.previous_content && <p>Previous draft: {h.previous_content}</p>}
        </div>
      ))}
    </details>
  );
}
export function CarePanel({
  api,
  permissions,
  role,
  userId,
  reviews = false,
}: {
  api: Api;
  permissions: string[];
  role: string;
  userId: string;
  reviews?: boolean;
}) {
  const [options, setOptions] = useState<Row>({
    mothers: [],
    children: [],
    staff: [],
  });
  const [items, setItems] = useState<Row[]>([]),
    [gaps, setGaps] = useState<Row[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [gapPage, setGapPage] = useState(1),
    [gapTotal, setGapTotal] = useState(0);
  const [status, setStatus] = useState(""),
    [mother, setMother] = useState(""),
    [child, setChild] = useState(""),
    [sourceGap, setSourceGap] = useState<Row | null>(null);
  const [editor, setEditor] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [searchDraft, setSearchDraft] = useState("");
  const canWrite = permissions.includes("care.write"),
    canReview = permissions.includes("care.review"),
    clinical = ["consultant", "resident"].includes(role);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [pick, list, gap] = await Promise.all([
        api("/care/options?q=" + encodeURIComponent(search)),
        api(
          `/care/${reviews ? "reviews" : "tasks"}?page=${page}&status=${encodeURIComponent(status)}`,
        ),
        reviews ? Promise.resolve(null) : api("/care/gaps?page=" + gapPage),
      ]);
      setOptions(pick);
      setItems(list.items);
      setTotal(list.total);
      if (gap) {
        setGaps(gap.items);
        setGapTotal(gap.total);
      }
    } catch (e) {
      setItems([]);
      setGaps([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, reviews, page, status, gapPage, search]);
  useEffect(() => {
    load();
  }, [load]);
  async function save(path: string, body: Row, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setEditor(null);
      setSourceGap(null);
      setNotice(
        "Saved to the local portal. History and ownership are recorded.",
      );
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function patientFields() {
    return (
      <>
        <label>
          Find a patient
          <input
            placeholder="Search patient name"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setSearch(searchDraft);
            setSourceGap(null);
          }}
        >
          Search patients
        </button>
        <label>
          Patient · first 50 matching records
          <select
            name="mother_id"
            required
            value={mother}
            onChange={(e) => {
              setMother(e.target.value);
              setChild("");
              setSourceGap(null);
            }}
          >
            <option value="">Choose an authorised patient</option>
            {options.mothers.map((m: Row) => (
              <option key={m.id} value={m.id}>
                {compact(m.details.name)} · {m.source_id}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  function ownerChoices(mid: string) {
    const task = items.find((r: Row) => r.mother_id === mid);
    const m =
      options.mothers.find((p: Row) => p.id === mid) ||
      (task
        ? {
            assigned_unit_id: task.mother_unit_id,
            assigned_doctor_id: task.mother_doctor_id,
          }
        : null);
    return options.staff.filter(
      (s: Row) =>
        !["resident", "consultant"].includes(s.role) ||
        (s.unit_id === m?.assigned_unit_id &&
          (s.role !== "resident" || s.id === m?.assigned_doctor_id)),
    );
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      values = Object.fromEntries(new FormData(form));
    const body: Row = reviews
      ? {
          mother_id: mother,
          kind: values.kind,
          title: values.title,
          content: values.content,
          source: values.source,
        }
      : {
          mother_id: mother,
          child_id: child || null,
          gap_id: sourceGap?.id || null,
          title: values.title,
          kind: values.kind,
          assigned_to: values.assigned_to,
          due_date: values.due_date,
          notes: values.notes,
        };
    if (await save("/care/" + (reviews ? "reviews" : "tasks"), body)) {
      form.reset();
      setMother("");
      setChild("");
    }
  }
  async function act(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor) return;
    const v = Object.fromEntries(new FormData(e.currentTarget));
    let payload: Row;
    if (editor.action === "revise")
      payload = {
        version: editor.row.details.version,
        content: v.content,
        source: v.source,
        reason: v.notes,
      };
    else
      payload = {
        version: editor.row.details.version,
        action: editor.action,
        notes: v.notes,
        ...(!reviews
          ? {
              barrier: v.barrier,
              outcome: v.outcome,
              evidence: v.evidence,
              assigned_to: v.assigned_to || null,
            }
          : {}),
      };
    await save(
      `/care/${reviews ? "reviews" : "tasks"}/${editor.row.id}${editor.action === "revise" ? "" : "/actions"}`,
      payload,
      editor.action === "revise" ? "PATCH" : "POST",
    );
  }
  async function useGap(g: Row) {
    setError("");
    setBusy(true);
    try {
      const detail = await api("/patients/" + g.subject_mother_id);
      setOptions((o: Row) => ({
        ...o,
        mothers: [
          detail.mother,
          ...o.mothers.filter((m: Row) => m.id !== detail.mother.id),
        ],
        children: [
          ...o.children.filter((ch: Row) => ch.mother_id !== detail.mother.id),
          ...detail.children,
        ],
      }));
      setSourceGap(g);
      setMother(g.subject_mother_id);
      setChild(g.child_id || "");
      setNotice(
        "Source gap selected. Enter the owner, due date and next action below.",
      );
      document
        .getElementById("care-create")
        ?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="care-workspace">
      <div className="module-intro">
        <div>
          <div className="eyebrow">
            {reviews ? "CLINICIAN REVIEW" : "OWNERSHIP TO FOLLOW-THROUGH"}
          </div>
          <h2>
            {reviews
              ? "A human reviews every next step"
              : "Turn a missed milestone into owned work"}
          </h2>
          <p>
            {reviews
              ? "Draft visit instructions and review requests from recorded facts. Approval never changes a risk label or generates a prescription."
              : "Track contact attempts, access barriers, escalation and evidence. Completing a task does not rewrite imported clinical records."}
          </p>
        </div>
        <button className="secondary" onClick={load} disabled={busy}>
          ↻ Refresh
        </button>
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
      {busy && <p role="status">Loading / saving linked records…</p>}
      {!reviews && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Recorded gaps needing follow-through</h2>
              <p>
                Preserved source records · link one task per gap ·{" "}
                {gapTotal.toLocaleString("en-IN")} in your permitted cohort
              </p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Patient / milestone</th>
                  <th>Due</th>
                  <th>Recorded state</th>
                  <th>Follow-through</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{compact(g.mother_name)}</strong>
                      <p>
                        {g.expected_item}
                        {g.child_id ? " · Child record linked" : ""}
                      </p>
                    </td>
                    <td>{g.due_date}</td>
                    <td>
                      <Badge status={g.status} />
                    </td>
                    <td>
                      {g.task ? (
                        <Badge status={g.task.status} />
                      ) : canWrite ? (
                        <button className="secondary" onClick={() => useGap(g)}>
                          Assign follow-up
                        </button>
                      ) : (
                        "Unassigned"
                      )}
                    </td>
                  </tr>
                ))}
                {!gaps.length && (
                  <tr>
                    <td colSpan={4}>No matching source gaps available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="care-pagination">
            <button
              className="secondary"
              disabled={busy || gapPage === 1}
              onClick={() => setGapPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {gapPage}</span>
            <button
              className="secondary"
              disabled={busy || gapPage * 25 >= gapTotal}
              onClick={() => setGapPage((p) => p + 1)}
            >
              Next gaps
            </button>
          </div>
        </section>
      )}
      <div className="care-columns">
        <section className="card" id="care-create">
          <div className="card-head">
            <div>
              <h2>
                {reviews ? "Create a review draft" : "Create a care task"}
              </h2>
              <p>
                {reviews
                  ? "Only consultant-approved summaries appear as confirmed next steps."
                  : "Keep maternal and child identities separate, with an explicit linked record."}
              </p>
            </div>
          </div>
          {canWrite ? (
            <form className="form-body care-form" onSubmit={create}>
              {patientFields()}
              {sourceGap && (
                <div className="notice">
                  Linked: {sourceGap.expected_item} · {sourceGap.due_date}
                  <button type="button" onClick={() => setSourceGap(null)}>
                    Clear
                  </button>
                </div>
              )}
              <label>
                {reviews ? "Draft type" : "Follow-up type"}
                <select
                  name="kind"
                  key={sourceGap?.id || "type"}
                  defaultValue={sourceGap?.child_id ? "newborn" : undefined}
                >
                  {(reviews
                    ? clinical
                      ? ["clinician_review", "visit_summary"]
                      : ["clinician_review"]
                    : [
                        "follow_up",
                        "referral_follow_up",
                        "postpartum",
                        "newborn",
                        "investigation",
                      ]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {nice(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title / next action
                <input
                  name="title"
                  key={sourceGap?.id || "title"}
                  defaultValue={
                    sourceGap ? `Follow up: ${sourceGap.expected_item}` : ""
                  }
                  required
                  minLength={3}
                  maxLength={180}
                />
              </label>
              {reviews ? (
                <>
                  <label>
                    Recorded concern / plain-language next steps
                    <textarea
                      name="content"
                      required
                      minLength={5}
                      maxLength={4000}
                    />
                  </label>
                  <label>
                    Source visit / report reference
                    <input
                      name="source"
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Child · optional unless newborn follow-up
                    <select
                      name="child"
                      value={child}
                      onChange={(e) => setChild(e.target.value)}
                    >
                      <option value="">Mother record only</option>
                      {options.children
                        .filter((c: Row) => c.mother_id === mother)
                        .map((c: Row) => (
                          <option key={c.id} value={c.id}>
                            {c.source_id} · Birth order {c.birth_order}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Accountable owner
                    <select name="assigned_to" required>
                      <option value="">Choose authorised staff</option>
                      {ownerChoices(mother).map((s: Row) => (
                        <option key={s.id} value={s.id}>
                          {compact(s.name)} · {nice(s.role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Due date
                    <input name="due_date" type="date" required />
                  </label>
                  <label>
                    Context / handover notes
                    <textarea name="notes" maxLength={2000} />
                  </label>
                </>
              )}
              <button className="primary" disabled={busy || !mother}>
                {reviews ? "Save for review" : "Assign task"}
              </button>
            </form>
          ) : (
            <div className="empty">Your role has read-only access.</div>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{reviews ? "Review inbox" : "Owned follow-up queue"}</h2>
              <p>
                {total} records · scoped to your facility, unit and patient
                assignment
              </p>
            </div>
            {!reviews && (
              <select
                aria-label="Task status"
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value);
                }}
              >
                <option value="">All states</option>
                {["open", "in_progress", "escalated", "completed"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            )}
          </div>
          <div className="care-records">
            {items.map((row) => {
              const d = row.details;
              return (
                <article className="care-record" key={row.id}>
                  <div className="care-record-heading">
                    <Badge status={row.status} />
                    <span className="small">Version {d.version}</span>
                  </div>
                  <h3>{d.title}</h3>
                  <p>
                    <strong>{compact(row.mother_name)}</strong> ·{" "}
                    {row.mother_source_id}
                  </p>
                  {reviews ? (
                    <>
                      <p className="care-prose">{d.content}</p>
                      <p className="small">
                        Source: {d.source} · Author: {compact(d.author)}
                      </p>
                      {row.status === "approved" && (
                        <p className="notice">
                          Clinician-approved next steps · visible in the
                          authorised patient timeline.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>
                        {nice(d.kind)} · Due {d.due_date}
                      </p>
                      <p>
                        Owner:{" "}
                        {compact(
                          options.staff.find(
                            (s: Row) => s.id === row.assigned_to,
                          )?.name || row.assigned_to,
                        )}
                      </p>
                      {d.child_id && (
                        <p className="small">
                          Separate child record: {d.child_id}
                        </p>
                      )}
                      <p>{d.notes}</p>
                      {d.barrier !== "none" && (
                        <span className="pill amber">
                          Barrier: {nice(d.barrier)}
                        </span>
                      )}
                    </>
                  )}
                  <div className="care-buttons">
                    {reviews ? (
                      <>
                        {canReview && row.status === "pending_review" && (
                          <button
                            className="secondary"
                            onClick={() =>
                              setEditor({ row, action: "acknowledge" })
                            }
                          >
                            Acknowledge
                          </button>
                        )}
                        {canReview &&
                          ["pending_review", "acknowledged"].includes(
                            row.status,
                          ) &&
                          row.type === "visit_summary" && (
                            <button
                              className="primary"
                              onClick={() =>
                                setEditor({ row, action: "approve" })
                              }
                            >
                              Approve summary
                            </button>
                          )}
                        {canReview &&
                          [
                            "pending_review",
                            "acknowledged",
                            "approved",
                          ].includes(row.status) &&
                          row.type === "visit_summary" && (
                            <button
                              className="secondary"
                              onClick={() =>
                                setEditor({ row, action: "request_correction" })
                              }
                            >
                              Request correction
                            </button>
                          )}
                        {clinical &&
                          row.type === "visit_summary" &&
                          row.status === "needs_correction" && (
                            <button
                              className="primary"
                              onClick={() =>
                                setEditor({ row, action: "revise" })
                              }
                            >
                              Revise draft
                            </button>
                          )}
                        {canReview &&
                          row.type === "clinician_review" &&
                          row.status === "acknowledged" && (
                            <button
                              className="primary"
                              onClick={() =>
                                setEditor({ row, action: "close" })
                              }
                            >
                              Close with findings
                            </button>
                          )}
                      </>
                    ) : canWrite ? (
                      <>
                        {row.status !== "completed" ? (
                          <>
                            {row.assigned_to === userId &&
                              ["open", "escalated"].includes(row.status) && (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    setEditor({ row, action: "acknowledge" })
                                  }
                                >
                                  Acknowledge
                                </button>
                              )}
                            {[
                              "contact",
                              "reassign",
                              "escalate",
                              "complete",
                            ].map((a) => (
                              <button
                                className={
                                  a === "complete" ? "primary" : "secondary"
                                }
                                key={a}
                                onClick={() => setEditor({ row, action: a })}
                              >
                                {nice(a)}
                              </button>
                            ))}
                          </>
                        ) : (
                          <button
                            className="secondary"
                            onClick={() => setEditor({ row, action: "reopen" })}
                          >
                            Reopen
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                  <History items={d.history || []} />
                </article>
              );
            })}
            {!items.length && (
              <div className="empty">
                No {reviews ? "review drafts" : "care tasks"} yet. Create one
                from an authorised patient record.
              </div>
            )}
          </div>
          <div className="care-pagination">
            <button
              className="secondary"
              disabled={busy || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary"
              disabled={busy || page * 25 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>
      </div>
      {editor && (
        <div className="modal-backdrop">
          <section
            className="modal care-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="care-action-title"
          >
            <div className="card-head">
              <div>
                <div className="eyebrow">STAFF CONFIRMATION</div>
                <h2 id="care-action-title">{nice(editor.action)}</h2>
                <p>{editor.row.details.title}</p>
              </div>
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
            <form className="form-body care-form" onSubmit={act}>
              <label>
                Notes / reason
                <textarea
                  autoFocus
                  name="notes"
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </label>
              {editor.action === "revise" && (
                <>
                  <label>
                    Corrected content
                    <textarea
                      name="content"
                      defaultValue={editor.row.details.content}
                      required
                      minLength={5}
                      maxLength={4000}
                    />
                  </label>
                  <label>
                    Source reference
                    <input
                      name="source"
                      defaultValue={editor.row.details.source}
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                  </label>
                </>
              )}
              {!reviews && (
                <>
                  {editor.action === "reassign" && (
                    <label>
                      New owner
                      <select name="assigned_to" required>
                        {ownerChoices(editor.row.mother_id).map((s: Row) => (
                          <option key={s.id} value={s.id}>
                            {compact(s.name)} · {nice(s.role)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Access barrier
                    <select
                      name="barrier"
                      defaultValue={editor.row.details.barrier || "none"}
                    >
                      {barriers.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Outcome
                    <select
                      name="outcome"
                      required
                      defaultValue={
                        editor.action === "contact"
                          ? "reached"
                          : "not_applicable"
                      }
                    >
                      {(editor.action === "contact"
                        ? ["reached", "no_answer"]
                        : editor.action === "complete"
                          ? [
                              ...(clinical ? ["care_completed"] : []),
                              "follow_up_booked",
                              "unable_to_access",
                              "needs_clinician_review",
                            ]
                          : ["not_applicable"]
                      ).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Evidence / visit or report reference
                    <input
                      name="evidence"
                      required={editor.action === "complete"}
                      maxLength={1000}
                    />
                  </label>
                </>
              )}
              <button className="primary" disabled={busy}>
                Confirm & record history
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export function PatientCoordination({
  api,
  motherId,
}: {
  api: Api;
  motherId: string;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/patients/${motherId}/coordination`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, motherId]);
  return (
    <section className="patient-care-timeline">
      <h3>Care coordination & confirmed next steps</h3>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading coordination history…</p>}
      {data && (
        <>
          {data.approved_summaries.map((r: Row) => (
            <article className="care-record" key={r.id}>
              <Badge status={r.status} />
              <h3>{r.details.title}</h3>
              <p className="care-prose">{r.details.content}</p>
              <p className="small">Source: {r.details.source}</p>
            </article>
          ))}
          {data.tasks.map((r: Row) => (
            <article className="care-record" key={r.id}>
              <Badge status={r.status} />
              <h3>{r.details.title}</h3>
              <p>
                Due {r.details.due_date} · {nice(r.details.kind)}
              </p>
              <History items={r.details.history || []} />
            </article>
          ))}
          {!data.tasks.length && !data.approved_summaries.length && (
            <p>No saved tasks or approved summaries yet.</p>
          )}
        </>
      )}
    </section>
  );
}
