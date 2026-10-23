"use client";
import { useCallback, useEffect, useState } from "react";
type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
const profileFields = [
  "organisation",
  "address",
  "pincode",
  "latitude",
  "longitude",
  "hours",
  "contact",
  "emergency_contact",
  "verification_documents",
];
const serviceFields = [
  "name",
  "department_id",
  "clinician_id",
  "capacity",
  "starts_at",
  "ends_at",
  "contact",
  "closure_reason",
  "available",
  "accepts_referrals",
];
const staffFields = [
  "name",
  "email",
  "role",
  "department_id",
  "unit_id",
  "registration_no",
  "verified",
  "active",
];
export function AdministrationPanel({ api }: { api: Api }) {
  const [data, setData] = useState<Row | null>(null);
  const [section, setSection] = useState("profile");
  const [draft, setDraft] = useState<Row>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api("/administration"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  function edit(kind: string, row?: Row) {
    setSection(kind);
    setMessage("");
    setError("");
    setDraft(
      row
        ? {
            ...(row.payload || row),
            id: row.id,
            version: row.version,
            reason: "",
          }
        : {
            version: 0,
            available: true,
            active: true,
            verified: false,
            accepts_referrals: false,
          },
    );
  }
  useEffect(() => {
    if (data && section === "profile") {
      const row = data.records.find((r: Row) => r.kind === "profile");
      setDraft(
        row
          ? { ...row.payload, version: row.version, reason: "" }
          : { version: 0 },
      );
    }
  }, [data, section]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fields =
        section === "profile"
          ? profileFields
          : section === "service"
            ? serviceFields
            : staffFields;
      const body: Row = { version: draft.version || 0, reason: draft.reason };
      fields.forEach((k) => {
        let v = draft[k];
        if (["capacity", "latitude", "longitude"].includes(k))
          v = v === "" || v == null ? undefined : Number(v);
        if (["department_id", "unit_id", "clinician_id"].includes(k))
          v = v || null;
        if (["starts_at", "ends_at"].includes(k))
          v = v ? new Date(v).toISOString() : null;
        if (k === "verification_documents")
          v =
            typeof v === "string"
              ? v
                  .split("\n")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : v || [];
        if (v !== undefined) body[k] = v;
      });
      const path =
        section === "profile"
          ? "/administration/profile"
          : section === "service"
            ? "/administration/services/" + (draft.id || crypto.randomUUID())
            : "/administration/staff";
      const result = await api(path, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setMessage(
        result.invitation_token
          ? "Open " +
              window.location.origin +
              (process.env.NEXT_PUBLIC_DAI_BASE_PATH || "") +
              "/invitation and use this token (valid 48 hours; copy now): " +
              result.invitation_token
          : "Saved with correction history.",
      );
      setDraft({
        ...draft,
        id: result.id,
        version: result.version,
        reason: "",
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return <p role="status">{error || "Loading facility administration…"}</p>;
  const fields =
    section === "profile"
      ? profileFields
      : section === "service"
        ? serviceFields
        : staffFields;
  return (
    <div className="admin-manager">
      <div className="toolbar">
        {[
          ["profile", "Facility onboarding"],
          ["service", "Services & slots"],
          ["staff", "Staff & access"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => edit(k)} aria-pressed={section === k}>
            {label}
          </button>
        ))}
      </div>
      <p>
        Manage the current facility only. Existing departments, wards and care
        capacity remain under Departments & units and Wards & bed board.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status" style={{ overflowWrap: "anywhere" }}>
          {message}
        </p>
      )}
      {section === "profile" && (
        <section>
          <label>
            Upload verification PDF (up to 5 MB)
            <input
              type="file"
              accept="application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError("");
                try {
                  const r = await api("/administration/documents", {
                    method: "POST",
                    headers: { "Content-Type": "application/pdf" },
                    body: await file.arrayBuffer(),
                  });
                  setDraft((d) => ({
                    ...d,
                    verification_documents: [
                      ...(Array.isArray(d.verification_documents)
                        ? d.verification_documents
                        : (d.verification_documents || "")
                            .split("\n")
                            .filter(Boolean)),
                      r.payload.reference,
                    ],
                  }));
                  setMessage(
                    "Document uploaded. Save the profile to attach its reference.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
          {data.records
            .filter((r: Row) => r.kind === "document")
            .map((r: Row) => (
              <p key={r.id}>
                {r.payload.reference}{" "}
                <button
                  onClick={async () => {
                    try {
                      const doc = await api(
                        "/administration/documents/" + r.id,
                      );
                      const bytes = Uint8Array.from(
                        atob(doc.content),
                        (c: string) => c.charCodeAt(0),
                      );
                      const url = URL.createObjectURL(
                        new Blob([bytes], { type: "application/pdf" }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "verification-" + r.id + ".pdf";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Download
                </button>
              </p>
            ))}
        </section>
      )}
      <div className="admin-manager-grid">
        <form onSubmit={save}>
          <h2>
            {section === "profile"
              ? "Organisation profile"
              : section === "service"
                ? "Service availability / appointment slot"
                : "Invite or update staff"}
          </h2>
          {fields.map((k) => {
            const label = k.replaceAll("_", " ");
            const options =
              k === "role"
                ? data.roles.map((r: string) => ({ id: r, name: r }))
                : k === "department_id"
                  ? data.departments
                  : k === "unit_id"
                    ? data.units.filter(
                        (r: Row) => r.department_id === draft.department_id,
                      )
                    : k === "clinician_id"
                      ? [
                          ...data.users,
                          ...data.affiliations
                            .filter((r: Row) => r.user_id)
                            .map((r: Row) => ({ ...r, id: r.user_id })),
                        ].filter(
                          (r: Row) =>
                            r.department_id === draft.department_id &&
                            ["consultant", "resident"].includes(r.role),
                        )
                      : null;
            return (
              <label
                key={k}
                style={{
                  display: "grid",
                  gap: 4,
                  marginBottom: 12,
                  textTransform: "capitalize",
                }}
              >
                {label}
                {options ? (
                  <select
                    value={draft[k] || ""}
                    required={
                      (["role", "department_id"].includes(k) &&
                        section !== "staff") ||
                      k === "role"
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [k]: e.target.value,
                        ...(k === "department_id"
                          ? { unit_id: "", clinician_id: "" }
                          : {}),
                      })
                    }
                  >
                    <option value="">Select / none</option>
                    {options.map((r: Row) => (
                      <option key={r.id} value={r.id}>
                        {r.name || r.code}
                      </option>
                    ))}
                  </select>
                ) : [
                    "available",
                    "active",
                    "verified",
                    "accepts_referrals",
                  ].includes(k) ? (
                  <input
                    type="checkbox"
                    checked={!!draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.checked })
                    }
                  />
                ) : k === "verification_documents" ? (
                  <>
                    <textarea
                      value={
                        Array.isArray(draft[k])
                          ? draft[k].join("\n")
                          : draft[k] || ""
                      }
                      onChange={(e) =>
                        setDraft({ ...draft, [k]: e.target.value })
                      }
                    />
                    <small>
                      Document references, one per line. These references do not
                      verify the facility or upload files.
                    </small>
                  </>
                ) : (
                  <input
                    required={
                      ![
                        "starts_at",
                        "ends_at",
                        "closure_reason",
                        "registration_no",
                      ].includes(k)
                    }
                    type={
                      k.endsWith("_at")
                        ? "datetime-local"
                        : ["capacity", "latitude", "longitude"].includes(k)
                          ? "number"
                          : k === "email"
                            ? "email"
                            : "text"
                    }
                    step="any"
                    value={
                      k.endsWith("_at") && draft[k]
                        ? new Date(
                            new Date(draft[k]).getTime() -
                              new Date(draft[k]).getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : (draft[k] ?? "")
                    }
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.value })
                    }
                  />
                )}
              </label>
            );
          })}
          <label>
            Reason for this change
            <textarea
              required
              minLength={5}
              value={draft.reason || ""}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
          <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
        <section>
          <h2>Saved records</h2>
          {section === "profile" ? (
            <p>
              Profile changes retain the previous values and reason in Access &
              audit. Service capacity is a reported operational value; it does
              not reserve beds or book patients.
            </p>
          ) : section === "service" ? (
            data.records
              .filter((r: Row) => r.kind === "service")
              .map((r: Row) => (
                <article key={r.id}>
                  <h3>{r.payload.name}</h3>
                  <p>
                    {r.payload.available ? "Available" : "Temporarily closed"} ·
                    Capacity {r.payload.capacity} ·{" "}
                    {r.payload.accepts_referrals
                      ? "Accepting referrals"
                      : "Referrals unavailable"}
                  </p>
                  <p>
                    {r.payload.starts_at
                      ? new Date(r.payload.starts_at).toLocaleString()
                      : "No timed slot"}
                  </p>
                  <button onClick={() => edit("service", r)}>Edit</button>
                </article>
              ))
          ) : (
            <>
              {data.affiliations.map((r: Row) => (
                <article key={r.id}>
                  <h3>{r.name}</h3>
                  <p>
                    {r.email} · {r.role} · {r.active ? "Active" : "Inactive"} ·{" "}
                    {r.verified ? "Credentials verified" : "Unverified"}
                  </p>
                  <button onClick={() => edit("staff", r)}>Edit access</button>
                </article>
              ))}
              <h3>Existing home-facility accounts</h3>
              {data.users
                .filter(
                  (r: Row) =>
                    !data.affiliations.some((a: Row) => a.user_id === r.id),
                )
                .map((r: Row) => (
                  <p key={r.id}>
                    {r.name} — {r.role}{" "}
                    <button
                      onClick={() =>
                        edit("staff", { ...r, version: 0, active: true })
                      }
                    >
                      Manage
                    </button>
                  </p>
                ))}
              <p>
                For an existing clinician at another facility, enter their
                account email to create a separate affiliation. Invitations are
                copied manually; no email is sent.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function AffiliationSwitcher({
  api,
  onSwitch,
}: {
  api: Api;
  onSwitch: () => Promise<void>;
}) {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/affiliations")
      .then((r) => setItems(r.items))
      .catch(() => {});
  }, [api]);
  return items.length ? (
    <div>
      <label>
        Facility context{" "}
        <select
          defaultValue=""
          onChange={async (e) => {
            if (!e.target.value) return;
            try {
              await api("/affiliations/" + e.target.value + "/switch", {
                method: "POST",
              });
              await onSwitch();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <option value="">Choose authorised affiliation</option>
          {items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.role}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  ) : null;
}

export function InvitationAcceptance({ api }: { api: Api }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return (
    <details>
      <summary>Accept a staff invitation</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api("/administration/invitations/accept", {
              method: "POST",
              body: JSON.stringify({ token, password }),
            });
            setMessage(r.status);
            setToken("");
            setPassword("");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label>
          Invitation token
          <input
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button>Accept invitation</button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}

export function PatientStaffRecords({
  api,
  motherId,
  role,
}: {
  api: Api;
  motherId: string;
  role: string;
}) {
  const [items, setItems] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Row>({
    kind: "visit",
    status: "planned",
    occurred_on: new Date().toLocaleDateString("en-CA"),
    version: 0,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setItems((await api("/patients/" + motherId + "/staff-records")).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, motherId]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section>
      <h3>Visits, care plans, referrals & test updates</h3>
      <p>
        Recorded staff notes supplement the imported record. Referral notes do
        not transmit a referral to another hospital.
      </p>
      {error && <p role="alert">{error}</p>}
      {items.map((r) => (
        <article key={r.id}>
          <h4>{r.payload.title}</h4>
          <p>
            {r.payload.kind.replaceAll("_", " ")} · {r.payload.status} ·{" "}
            {r.payload.occurred_on}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.payload.notes}</p>
          {["consultant", "resident"].includes(role) && (
            <button
              onClick={() =>
                setDraft({
                  ...r.payload,
                  id: r.id,
                  version: r.version,
                  reason: "",
                })
              }
            >
              Correct / update
            </button>
          )}
        </article>
      ))}
      {["consultant", "resident"].includes(role) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const { id, recorded_by, mother_id, ...body } = draft;
              await api(
                "/patients/" +
                  motherId +
                  "/staff-records/" +
                  (id || crypto.randomUUID()),
                { method: "PUT", body: JSON.stringify(body) },
              );
              setDraft({
                kind: "visit",
                status: "planned",
                occurred_on: new Date().toLocaleDateString("en-CA"),
                version: 0,
              });
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Record type
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {["visit", "care_plan", "referral", "test_status"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              {["planned", "in_progress", "completed", "cancelled"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Record date
            <input
              required
              type="date"
              value={draft.occurred_on}
              onChange={(e) =>
                setDraft({ ...draft, occurred_on: e.target.value })
              }
            />
          </label>
          <label>
            Title
            <input
              required
              minLength={3}
              maxLength={180}
              value={draft.title || ""}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Notes
            <textarea
              required
              minLength={5}
              maxLength={4000}
              value={draft.notes || ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <label>
            Reason for entry / correction
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={draft.reason || ""}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
          <button disabled={busy}>{busy ? "Saving…" : "Save record"}</button>
          <button
            type="button"
            onClick={() =>
              setDraft({
                kind: "visit",
                status: "planned",
                occurred_on: new Date().toLocaleDateString("en-CA"),
                version: 0,
              })
            }
          >
            New record
          </button>
        </form>
      )}
    </section>
  );
}

export function ReferralInbox({
  api,
  facilityId,
  role,
}: {
  api: Api;
  facilityId: string;
  role: string;
}) {
  const [data, setData] = useState<Row>({ items: [], destinations: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api("/care-referrals"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section>
      <h2>Receiving facility handoffs</h2>
      <p>
        Consented handoff summaries only. Acceptance does not grant access to
        the full patient record. Create a referral from an authorised patient’s
        record.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data.items.length && <p>No new handoffs for this facility.</p>}
      {data.items.map((r: Row) => (
        <article key={r.id}>
          <h3>{r.reason}</h3>
          <p>
            {r.status} ·{" "}
            {r.to_facility_id === facilityId ? "Incoming" : "Outgoing"}
          </p>
          <p>{r.details.summary}</p>
          <p>{r.details.outcome_notes}</p>
          {r.to_facility_id === facilityId &&
            ["hospital_admin", "consultant"].includes(role) && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  const form = new FormData(e.currentTarget);
                  try {
                    await api("/care-referrals/" + r.id, {
                      method: "PATCH",
                      body: JSON.stringify({
                        status: form.get("status"),
                        notes: form.get("notes"),
                        version: r.details.version,
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
                <label>
                  Next action
                  <select name="status">
                    {(r.status === "requested"
                      ? ["accepted", "rejected"]
                      : r.status === "accepted"
                        ? ["arrived"]
                        : r.status === "arrived" && role === "consultant"
                          ? ["completed"]
                          : []
                    ).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Handoff evidence / outcome
                  <textarea name="notes" required minLength={5} />
                </label>
                {!["completed", "rejected"].includes(r.status) && (
                  <button disabled={busy}>Record action</button>
                )}
              </form>
            )}
        </article>
      ))}
    </section>
  );
}

export function CreateReferral({
  api,
  motherId,
}: {
  api: Api;
  motherId: string;
}) {
  const [destinations, setDestinations] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/care-referrals")
      .then((r) => setDestinations(r.destinations))
      .catch((e) => setMessage(e.message));
  }, [api]);
  return (
    <details>
      <summary>Refer to another facility</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          try {
            await api("/care-referrals", {
              method: "POST",
              body: JSON.stringify({
                mother_id: motherId,
                to_facility_id: form.get("destination"),
                reason: form.get("reason"),
                summary: form.get("summary"),
              }),
            });
            setMessage(
              "Referral sent to the receiving facility inbox. Track it under Facility handoffs.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label>
          Receiving facility
          <select required name="destination">
            <option value="">Select facility</option>
            {destinations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Referral reason
          <input required minLength={5} maxLength={1000} name="reason" />
        </label>
        <label>
          Authorised handoff summary
          <textarea required minLength={5} maxLength={4000} name="summary" />
        </label>
        <button>Send handoff</button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
