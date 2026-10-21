"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OperationalOverview, SnapshotView } from "./operations";
import { ForecastPanel } from "./forecasts";
type Row = Record<string, any>;
type User = {
  id: string;
  name: string;
  role: string;
  facility_id: string;
  permissions: string[];
  demo: boolean;
};
const label = "Simulated on synthetic data";
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const operationNav = [
  ["overview", "Today’s overview", "◈"],
  ["patients", "Patient registry", "♡"],
  ["appointments", "Appointments & queue", "◷"],
  ["gaps", "Care-gap worklist", "☷"],
  ["readiness", "Delivery readiness", "✚"],
  ["critical", "Critical & neonatal care", "⌁"],
  ["referrals", "Referrals & handovers", "⇄"],
  ["sos", "SOS & emergency inbox", "◉"],
  ["diagnostics", "Diagnostics & results", "▤"],
];
const administrationNav = [
  ["adminOverview", "Administration overview", "◈"],
  ["forecasts", "ML forecasts & stock planning", "⌁"],
  ["facility", "Facility master", "✚"],
  ["organisation", "Organisation & roles", "♧"],
  ["structure", "Departments & units", "▦"],
  ["beds", "Wards & bed board", "▱"],
  ["clinics", "Clinics & services", "▤"],
  ["blood", "Blood bank snapshot", "♦"],
  ["staffing", "Staffing & on-call roster", "♧"],
  ["equipment", "Equipment & resources", "✣"],
  ["ambulances", "Ambulance fleet", "⇢"],
  ["census", "Daily census", "▥"],
  ["audit", "Access & audit", "◎"],
  ["credentials", "Credential verification", "✓"],
  ["roadmap", "Build phases", "↗"],
];
const workspacePermissions: Record<string, string> = {
  forecasts: "forecast.read",
  beds: "bed.read",
  critical: "bed.read",
  blood: "blood.read",
  equipment: "equipment.read",
  staffing: "facility.read",
  census: "facility.read",
  organisation: "facility.read",
  ambulances: "sos.read",
  sos: "sos.read",
  referrals: "referral.read",
  appointments: "patient.read",
  gaps: "patient.read",
  readiness: "patient.read",
  diagnostics: "diagnostics.read",
  patients: "patient.read",
  audit: "audit.read",
  credentials: "user.verify",
};
const snapshotViews = new Set([
  "beds",
  "critical",
  "blood",
  "equipment",
  "staffing",
  "census",
  "organisation",
  "ambulances",
  "sos",
  "referrals",
  "appointments",
  "gaps",
  "readiness",
  "diagnostics",
]);
const titles: Record<string, [string, string]> = {
  forecasts: [
    "ML forecasts & stock planning",
    "Forecast demand, compare evidence and plan resources—with every clinical decision staying with people.",
  ],
  overview: [
    "Today’s overview",
    "Keep every handover moving. One shared view of patients, people and care readiness.",
  ],
  adminOverview: [
    "Administration overview",
    "Know your hospital’s capacity, resources and responsible teams.",
  ],
  beds: [
    "Wards & bed board",
    "Explore recorded bed availability across obstetric, neonatal and paediatric care.",
  ],
  critical: [
    "Critical & neonatal care",
    "Separate capacity and admission records for OBG HDU, NICU, PICU and paediatric HDU.",
  ],
  blood: [
    "Blood bank snapshot",
    "Blood groups, components and available units in one connected stock view.",
  ],
  staffing: [
    "Staffing & on-call roster",
    "Sanctioned posts, clinical unit assignments and shift coverage.",
  ],
  equipment: [
    "Equipment & resources",
    "See what is installed, what is functional and where each resource belongs.",
  ],
  organisation: [
    "Organisation & roles",
    "Fictional office holders with clear responsibility for administration and care coordination.",
  ],
  ambulances: [
    "Ambulance fleet",
    "A recorded view of ALS, BLS and neonatal transport capability.",
  ],
  census: ["Daily census", "Recorded delivery activity, by date and mode."],
  appointments: [
    "Appointments & queue",
    "Browse the recorded appointment list and attendance status for your care cohort.",
  ],
  gaps: [
    "Care-gap worklist",
    "Expected care versus recorded completion, with the next follow-up action.",
  ],
  readiness: [
    "Delivery readiness",
    "Bring clinician-confirmed arrivals, blood, beds and roster cover into one preparation view.",
  ],
  referrals: [
    "Referrals & handovers",
    "Follow the referring facility, receiving hospital, reason and transport time.",
  ],
  sos: [
    "SOS & emergency inbox",
    "Review recorded SOS verification, capability requirements and response history.",
  ],
  diagnostics: [
    "Diagnostics & results",
    "Recorded investigation orders, due dates and completion status.",
  ],
  facility: [
    "Facility master",
    "Identity, accreditation and emergency capabilities, linked to the imported DAI facility.",
  ],
  structure: [
    "Departments & units",
    "A consistent path from clinical unit to ward, labour room and assigned doctor.",
  ],
  clinics: [
    "Clinics & services",
    "Weekly care, with a room, time and accountable clinical unit.",
  ],
  patients: [
    "My patients",
    "Only records permitted by your facility, unit and assignment. Every read is audited.",
  ],
  credentials: [
    "Credential verification",
    "Synthetic clinical identities require a registration number, department and administrator verification.",
  ],
  audit: [
    "Access & audit",
    "A traceable record of patient access, authentication and accepted changes.",
  ],
  roadmap: [
    "Build phases",
    "Acceptance gates keep the readiness layer honest as each workflow becomes available.",
  ],
};
const nice = (v: unknown) => String(v ?? "—").replaceAll("_", " ");
const compact = (v: string) =>
  v?.replace("DAI SYNTHETIC ", "DAI · ").replace("Dr SYNTHETIC ", "Dr. ") ||
  "—";
function Pill({
  children,
  color = "purple",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return <span className={"pill " + color}>{children}</span>;
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-scroll">
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
                {r.map((c, j) => (
                  <td key={j}>{c ?? "—"}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                <div className="empty">No records in your permitted scope.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Row | null>(null);
  const [view, setView] = useState("overview");
  const [mode, setMode] = useState<"operations" | "administration">(
    "operations",
  );
  const [summary, setSummary] = useState<Row | null>(null);
  const [forecastReport, setForecastReport] = useState<Row | null>(null);
  const [workspaceData, setWorkspaceData] = useState<Row | null>(null);
  const [filters, setFilters] = useState<Row>({
    page: 1,
    q: "",
    status: "",
    ward: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Row | null>(null);
  const [email, setEmail] = useState("hospital_admin@dai-synthetic.invalid");
  const [password, setPassword] = useState("Dai-Synthetic-2026!");
  const [otp, setOtp] = useState("");
  const [records, setRecords] = useState<Row[]>([]);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patient, setPatient] = useState<Row | null>(null);
  const [editor, setEditor] = useState<Row | null>(null);
  const [notification, setNotification] = useState("");
  const [menu, setMenu] = useState(false);
  const api = useCallback(
    async (path: string, options: RequestInit = {}, access = token) => {
      const response = await fetch("/api" + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-dai-client": "portal",
          ...(access ? { Authorization: "Bearer " + access } : {}),
          ...options.headers,
        },
      });
      const result = await response.json();
      if (
        !response.ok &&
        response.status === 404 &&
        path.startsWith("/workspace/")
      )
        throw new Error(
          "The richer workspace needs the updated backend. Restart your FastAPI terminal once, then refresh.",
        );
      if (!response.ok)
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : JSON.stringify(result.detail),
        );
      return result;
    },
    [token],
  );
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    if (!user) return;
    const sequence = ++loadSequence.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });
      const extraPath =
        view === "forecasts"
          ? "/ml/forecast"
          : snapshotViews.has(view)
            ? "/workspace/" + view + "?" + params.toString()
            : view === "patients"
              ? "/patients?limit=25&offset=" +
                (filters.page - 1) * 25 +
                "&q=" +
                encodeURIComponent(filters.q || "")
              : view === "credentials"
                ? "/users"
                : view === "audit"
                  ? "/audit"
                  : null;
      const [structure, nextSummary, extra] = await Promise.all([
        api("/facilities/" + user.facility_id + "/structure"),
        api("/workspace/summary"),
        extraPath ? api(extraPath) : Promise.resolve(null),
      ]);
      if (sequence !== loadSequence.current) return;
      setData(structure);
      setSummary(nextSummary);
      if (view === "forecasts") setForecastReport(extra);
      else if (snapshotViews.has(view)) setWorkspaceData(extra);
      else if (extra) {
        setRecords(extra.items);
        if (view === "patients") setPatientTotal(extra.total);
      }
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setBusy(false);
    }
  }, [api, user, view, filters]);
  useEffect(() => {
    load();
  }, [load]);
  async function session(result: Row, resetNavigation = true) {
    setToken(result.access_token);
    const me = await api("/me", {}, result.access_token);
    setUser(me);
    if (resetNavigation) {
      setData(null);
      setRecords([]);
      setPatient(null);
      setView("overview");
      setMode("operations");
      setSummary(null);
      setWorkspaceData(null);
      setFilters({ page: 1, q: "", status: "", ward: "" });
    }
    setChallenge(null);
    setOtp("");
  }
  useEffect(() => {
    api("/auth/refresh", { method: "POST" }, "")
      .then((result) => session(result, false))
      .catch(() => {}); /* access tokens stay in memory */
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(
      () =>
        api("/auth/refresh", { method: "POST" })
          .then((result) => session(result, false))
          .catch(() => {
            setUser(null);
            setToken("");
            setError("Session expired. Please sign in again.");
          }),
      8 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [user, api]);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge)
        await session(
          await api(
            "/auth/otp",
            {
              method: "POST",
              body: JSON.stringify({
                challenge_id: challenge.challenge_id,
                code: otp,
              }),
            },
            "",
          ),
        );
      else
        setChallenge(
          await api(
            "/auth/login",
            { method: "POST", body: JSON.stringify({ email, password }) },
            "",
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || !user) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    let payload: Row = {};
    form.forEach((value, key) => {
      payload[key] = String(value);
    });
    try {
      if (editor.kind === "facility") {
        payload.emergency_24x7 = form.has("emergency_24x7");
        payload.sos_participating = form.has("sos_participating");
        payload.capabilities = { ...editor.record.capabilities };
        for (const key of [
          "c_section",
          "blood_transfusion",
          "blood_bank",
          "neonatal_resuscitation",
          "labour_room_24x7",
        ]) {
          payload.capabilities[key] = form.has("cap_" + key);
          delete payload["cap_" + key];
        }
        await api("/facilities/" + user.facility_id, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        for (const key of ["anc_day", "gynae_day", "opd_day", "ot_day", "day"])
          if (key in payload)
            payload[key] = payload[key] === "" ? null : Number(payload[key]);
        for (const key of ["ward_id", "gynae_ward_id", "labour_room_id"])
          if (key in payload && payload[key] === "") payload[key] = null;
        await api(
          "/facilities/" +
            user.facility_id +
            "/structure/" +
            editor.kind +
            (editor.record?.id ? "/" + editor.record.id : ""),
          {
            method: editor.record?.id ? "PATCH" : "POST",
            body: JSON.stringify(payload),
          },
        );
      }
      setEditor(null);
      setNotification("Saved with an administration audit entry.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind: string, row: Row) {
    setEditor({ kind: "delete", targetKind: kind, record: row });
  }
  async function confirmRemove() {
    if (!editor || !user) return;
    try {
      await api(
        "/facilities/" +
          user.facility_id +
          "/structure/" +
          editor.targetKind +
          "/" +
          editor.record.id,
        { method: "DELETE" },
      );
      setEditor(null);
      setNotification("Removed the unused structure record.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const canEdit = user?.permissions.includes("facility.write");
  const facility = data?.facility;
  const departmentName = (id: string) =>
    data?.departments.find((d: Row) => d.id === id)?.name || "—";
  const wardName = (id: string) =>
    data?.wards.find((w: Row) => w.id === id)?.name || "—";
  const unitName = (id: string) =>
    data?.units.find((u: Row) => u.id === id)?.code || "—";
  const actions = (kind: string, r: Row) =>
    canEdit ? (
      <div className="row-actions">
        <button
          className="text-button"
          onClick={() => setEditor({ kind, record: r })}
        >
          Edit
        </button>
        <button className="text-button danger" onClick={() => remove(kind, r)}>
          Delete
        </button>
      </div>
    ) : (
      <Pill color="neutral">Read only</Pill>
    );
  if (!user)
    return (
      <main className="login-shell">
        <section className="login-story">
          <a className="brand" href="/">
            दाई{" "}
            <span>
              DAI
              <br />
              <small>HOSPITAL READINESS</small>
            </span>
          </a>
          <div>
            <Pill>{label}</Pill>
            <h1>
              Ready for the
              <br />
              next handover.
            </h1>
            <p>
              Connect the care team, the facility and the next step in a
              mother’s journey.
            </p>
            <div className="loop">
              Care gap <span>→</span> Action <span>→</span> Access
              <br />
              Completion <span>→</span> Continuity
            </div>
          </div>
          <small>
            A readiness and coordination layer for the hospital team.
          </small>
        </section>
        <section className="login-card">
          <div className="eyebrow">DAI HOSPITAL PORTAL · PHASE 1</div>
          <h2>
            {challenge ? "Verify your sign-in" : "Welcome to your workspace"}
          </h2>
          <p>
            {challenge
              ? "Second-factor delivery is simulated in this synthetic demo."
              : "Sign in to a scoped, audited workspace."}
          </p>
          <form onSubmit={login}>
            {!challenge ? (
              <>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <div className="notice">
                  <strong>Local synthetic demo account</strong>
                  <span>hospital_admin@dai-synthetic.invalid</span>
                  <span>Password: Dai-Synthetic-2026!</span>
                </div>
              </>
            ) : (
              <>
                <div className="notice">
                  <strong>Simulated OTP: {challenge.demo_otp}</strong>
                  <span>
                    This code is displayed only in explicit demo mode. No SMS is
                    sent.
                  </span>
                </div>
                <label>
                  Six-digit verification code
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    autoFocus
                  />
                </label>
              </>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : challenge
                  ? "Verify & enter workspace"
                  : "Continue to verification"}{" "}
              →
            </button>
            {challenge && (
              <button
                type="button"
                className="text-button"
                onClick={() => setChallenge(null)}
              >
                Back to sign in
              </button>
            )}
          </form>
          <p className="small">
            All people and records are fictional. Clinical decisions remain with
            clinicians.
          </p>
        </section>
      </main>
    );
  const canOpen = (id: string) => {
    const permission = workspacePermissions[id];
    return (
      !permission ||
      (snapshotViews.has(id) && user.permissions.includes("facility.write")) ||
      user.permissions.includes(permission)
    );
  };
  const allowed = (
    mode === "operations" ? operationNav : administrationNav
  ).filter(([id]) => canOpen(id));
  function navigate(id: string) {
    setView(id);
    setFilters({ page: 1, q: "", status: "", ward: "" });
    setMode(
      administrationNav.some(([view]) => view === id)
        ? "administration"
        : "operations",
    );
    setWorkspaceData(null);
    setMenu(false);
    setNotification("");
  }
  return (
    <div className="portal-shell">
      <a className="skip" href="#main">
        Skip to workspace
      </a>
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <a className="brand" href="/">
          दाई{" "}
          <span>
            DAI<small>HOSPITAL READINESS</small>
          </span>
        </a>
        <div className="sidebar-workspace-label">
          <span className="dot" /> Hospital workspace
        </div>
        <div className="eyebrow nav-label">
          {mode === "operations"
            ? "CARE OPERATIONS"
            : "HOSPITAL ADMINISTRATION"}
        </div>
        <nav>
          {allowed.map(([id, title, icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                navigate(id);
              }}
            >
              <span aria-hidden>{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <footer>
          <span className="dot" /> Synthetic care network
          <p>
            Connected records.
            <br />
            Clear responsibility.
          </p>
          <button
            className="text-button"
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setToken("");
              setUser(null);
            }}
          >
            Sign out ↗
          </button>
        </footer>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div className="facility-label">
            <small>YOUR FACILITY</small>
            <strong>
              {facility ? compact(facility.name) : "Loading facility…"}
            </strong>
          </div>
          <Pill>{label}</Pill>
          <button
            className="icon-button"
            onClick={load}
            aria-label="Refresh workspace"
          >
            ↻
          </button>
        </header>
        <main id="main" className="page">
          <div className="workspace-toolbar">
            <div className="workspace-switch" aria-label="Workspace area">
              {(["operations", "administration"] as const).map((area) => (
                <button
                  key={area}
                  className={mode === area ? "active" : ""}
                  aria-pressed={mode === area}
                  onClick={() =>
                    navigate(
                      area === "operations" ? "overview" : "adminOverview",
                    )
                  }
                >
                  {area === "operations" ? "Operations" : "Administration"}
                </button>
              ))}
            </div>
            <span className="snapshot-caption">
              <i /> Connected · recorded synthetic workspace
            </span>
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                HOSPITAL /{" "}
                {mode === "operations" ? "OPERATIONS" : "ADMINISTRATION"}
              </div>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            <div className="account">
              <span className="avatar">DA</span>
              <div>
                <strong>{nice(user.role)}</strong>
                {user.demo && (
                  <select
                    aria-label="Demo role"
                    value={user.role}
                    onChange={async (e) => {
                      try {
                        await session(
                          await api("/demo/switch", {
                            method: "POST",
                            body: JSON.stringify({ role: e.target.value }),
                          }),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {[
                      "hospital_admin",
                      "consultant",
                      "resident",
                      "nurse",
                      "bed_manager",
                      "blood_bank",
                      "pharmacist",
                      "lab_technician",
                      "dispatcher",
                      "biomedical",
                      "phc_user",
                      "quality_officer",
                      "front_desk",
                    ].map((r) => (
                      <option key={r} value={r}>
                        {nice(r)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notification && (
            <div className="notice" role="status">
              {notification}
            </div>
          )}
          {busy && (
            <div className="loading" role="status">
              Updating linked records…
            </div>
          )}
          {data && (
            <>
              {view === "forecasts" &&
                (forecastReport ? (
                  <ForecastPanel report={forecastReport} />
                ) : (
                  <div className="empty">
                    Train the synthetic forecast models to populate this view.
                  </div>
                ))}
              {(view === "overview" || view === "adminOverview") && summary && (
                <OperationalOverview
                  summary={summary}
                  structure={data}
                  navigate={navigate}
                  canOpen={canOpen}
                  admin={view === "adminOverview"}
                />
              )}
              {snapshotViews.has(view) && (
                <>
                  <div className="snapshot-notice">
                    <span>◷</span> Recorded snapshot ·{" "}
                    {summary?.snapshot_at?.slice(0, 10) || "2026-10-20"} ·
                    Read-only data view
                  </div>
                  {workspaceData && summary ? (
                    <SnapshotView
                      key={view}
                      view={view}
                      data={workspaceData}
                      summary={summary}
                      filters={filters}
                      setFilters={setFilters}
                      navigate={navigate}
                    />
                  ) : (
                    <div className="empty">
                      Loading connected hospital records…
                    </div>
                  )}
                </>
              )}
              {view === "facility" && (
                <>
                  <section className="card">
                    <div className="card-head">
                      <div>
                        <h2>{compact(facility.name)}</h2>
                        <p>{facility.source_id}</p>
                      </div>
                      {canEdit && (
                        <button
                          className="primary"
                          onClick={() =>
                            setEditor({ kind: "facility", record: facility })
                          }
                        >
                          Edit facility
                        </button>
                      )}
                    </div>
                    <dl className="details">
                      {[
                        ["Tier", nice(facility.tier)],
                        ["Ownership", nice(facility.ownership)],
                        ["Address", facility.address],
                        ["Coordinates", facility.lat + ", " + facility.lng],
                        ["NABH", nice(facility.nabh_status)],
                        ["NABL", facility.nabl_status],
                        [
                          "ABDM facility ID",
                          facility.abdm_facility_id ||
                            "Not connected · roadmap",
                        ],
                        [
                          "Authorized / functional beds",
                          facility.authorized_beds +
                            " / " +
                            facility.functional_beds,
                        ],
                        [
                          "24×7 emergency",
                          facility.emergency_24x7 ? "Enabled" : "Disabled",
                        ],
                        [
                          "SOS participation",
                          facility.sos_participating ? "Enabled" : "Disabled",
                        ],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="card-head">
                      <h3>Configured capabilities</h3>
                    </div>
                    <div className="permission-list">
                      {Object.entries(facility.capabilities)
                        .filter(([key]) => key !== "hospital_id")
                        .map(([key, value]) => (
                          <Pill key={key} color={value ? "green" : "neutral"}>
                            {nice(key)}:{" "}
                            {typeof value === "boolean"
                              ? value
                                ? "Yes"
                                : "No"
                              : String(value)}
                          </Pill>
                        ))}
                    </div>
                  </section>
                  <section className="card">
                    <div className="card-head">
                      <h2>Organisation & accountable roles</h2>
                      <Pill>Fictional office holders</Pill>
                    </div>
                    <Table
                      headers={["Role", "Fictional name", "Demo email"]}
                      rows={(data.organisation || []).map((r: Row) => [
                        r.role_name,
                        compact(r.fictional_holder_name),
                        r.email,
                      ])}
                    />
                  </section>
                </>
              )}
              {view === "structure" && (
                <>
                  <section className="card">
                    <div className="card-head">
                      <div>
                        <h2>Clinical units</h2>
                        <p>
                          Days follow the supplied six-unit OBG and paediatric
                          schedules.
                        </p>
                      </div>
                      {canEdit && (
                        <button
                          className="primary"
                          onClick={() => setEditor({ kind: "units" })}
                        >
                          + Add unit
                        </button>
                      )}
                    </div>
                    <Table
                      headers={[
                        "Unit",
                        "Department",
                        "ANC / OPD",
                        "Gynae",
                        "ANC ward",
                        "Gynae ward",
                        "Labour room",
                        "OT",
                        "",
                      ]}
                      rows={data.units.map((u: Row) => [
                        <strong key={u.id}>Unit {u.code}</strong>,
                        departmentName(u.department_id),
                        days[u.anc_day ?? u.opd_day] || "—",
                        days[u.gynae_day] || "—",
                        wardName(u.ward_id),
                        wardName(u.gynae_ward_id),
                        wardName(u.labour_room_id),
                        days[u.ot_day] || "—",
                        actions("units", u),
                      ])}
                    />
                  </section>
                  <section className="card">
                    <div className="card-head">
                      <h2>Departments</h2>
                      {canEdit && (
                        <button
                          className="secondary"
                          onClick={() => setEditor({ kind: "departments" })}
                        >
                          + Add department
                        </button>
                      )}
                    </div>
                    <Table
                      headers={["Department", "Source ID", ""]}
                      rows={data.departments.map((d: Row) => [
                        d.name,
                        d.source_id,
                        actions("departments", d),
                      ])}
                    />
                  </section>
                </>
              )}
              {view === "clinics" && (
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Special clinics</h2>
                      <p>Schedules are configurable synthetic placeholders.</p>
                    </div>
                    {canEdit && (
                      <button
                        className="primary"
                        onClick={() => setEditor({ kind: "clinics" })}
                      >
                        + Add clinic
                      </button>
                    )}
                  </div>
                  <Table
                    headers={[
                      "Clinic",
                      "Day",
                      "Time",
                      "Room",
                      "In-charge unit",
                      "",
                    ]}
                    rows={data.clinics.map((c: Row) => [
                      <strong key={c.id}>{c.name}</strong>,
                      days[c.day],
                      c.start_time + " – " + c.end_time,
                      c.room,
                      "Unit " + unitName(c.unit_id),
                      actions("clinics", c),
                    ])}
                  />
                </section>
              )}
              {view === "patients" && (
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Permitted care records</h2>
                      <p>
                        Browse your permitted cohort with search and pagination.
                        Every opened record is audited.
                      </p>
                    </div>
                    <Pill color="green">Read access audited</Pill>
                  </div>
                  <div className="snapshot-toolbar">
                    <label>
                      Find a mother
                      <input
                        placeholder="Search fictional name or source ID"
                        value={filters.q || ""}
                        onChange={(e) =>
                          setFilters({ ...filters, q: e.target.value, page: 1 })
                        }
                      />
                    </label>
                    <span className="small">
                      {patientTotal.toLocaleString("en-IN")} permitted records
                    </span>
                  </div>
                  <Table
                    headers={[
                      "Mother",
                      "Stage",
                      "Age",
                      "Unit",
                      "Clinician-recorded status",
                      "",
                    ]}
                    rows={records.map((m) => [
                      compact(m.details.name),
                      m.details.stage,
                      m.age,
                      "Unit " + unitName(m.assigned_unit_id),
                      <Pill
                        key={m.id}
                        color={m.clinician_high_risk ? "amber" : "neutral"}
                      >
                        {m.clinician_high_risk
                          ? "Clinician-confirmed high-risk"
                          : "No confirmed high-risk flag"}
                      </Pill>,
                      <button
                        key={m.id}
                        className="text-button"
                        onClick={async () => {
                          try {
                            setPatient(await api("/patients/" + m.id));
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Open record ↗
                      </button>,
                    ])}
                  />
                  <div className="pagination">
                    <button
                      className="secondary"
                      disabled={filters.page <= 1}
                      onClick={() =>
                        setFilters({ ...filters, page: filters.page - 1 })
                      }
                    >
                      ← Previous
                    </button>
                    <span>
                      Page {filters.page} of{" "}
                      {Math.max(1, Math.ceil(patientTotal / 25))}
                    </span>
                    <button
                      className="secondary"
                      disabled={filters.page * 25 >= patientTotal}
                      onClick={() =>
                        setFilters({ ...filters, page: filters.page + 1 })
                      }
                    >
                      Next →
                    </button>
                  </div>
                </section>
              )}
              {view === "credentials" && (
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Clinical identity checks</h2>
                      <p>
                        Verification is simulated; no NMC or HPR lookup is
                        performed.
                      </p>
                    </div>
                    <Pill>{label}</Pill>
                  </div>
                  <Table
                    headers={[
                      "Fictional clinician",
                      "Role",
                      "Registration",
                      "Department",
                      "Status",
                      "",
                    ]}
                    rows={records
                      .filter((r) =>
                        ["consultant", "resident"].includes(r.role),
                      )
                      .map((r) => [
                        compact(r.name),
                        nice(r.role),
                        r.registration_no,
                        departmentName(r.department_id),
                        <Pill key={r.id} color={r.verified ? "green" : "amber"}>
                          {r.verified ? "Verified (synthetic)" : "Unverified"}
                        </Pill>,
                        <button
                          key={r.id}
                          className="text-button"
                          onClick={() =>
                            setEditor({ kind: "verification", record: r })
                          }
                        >
                          Review
                        </button>,
                      ])}
                  />
                </section>
              )}
              {view === "audit" && (
                <section className="card">
                  <div className="card-head">
                    <h2>Accountable access</h2>
                    <p>Latest 100 entries from your facility.</p>
                  </div>
                  <Table
                    headers={["Time", "Action", "Entity", "Record", "Inputs"]}
                    rows={records.map((r) => [
                      new Date(r.created_at).toLocaleString("en-IN"),
                      r.action,
                      r.entity_type,
                      r.entity_id,
                      JSON.stringify(r.details),
                    ])}
                  />
                </section>
              )}
              {view === "roadmap" && (
                <>
                  <section className="card">
                    <div className="card-head">
                      <div>
                        <h2>Build one accepted phase at a time.</h2>
                        <p>
                          The supplied document references a missing phase plan;
                          this sequence preserves its dependencies.
                        </p>
                      </div>
                    </div>
                    <div className="phase-list">
                      {[
                        [
                          "01",
                          "Foundation & access",
                          "In review",
                          "Next.js, FastAPI, UUID schema, existing data import, M1 structure CRUD and M2 scoped access. Local API checks pass; PostgreSQL/PostGIS deployment still pending.",
                        ],
                        [
                          "02",
                          "Beds & clinical capacity",
                          "Planned",
                          "M3 admissions, M4 live bed twin and M5 labour room, theatres and neonatal capacity. WebSocket channels and reservations with expiry.",
                        ],
                        [
                          "03",
                          "Completion & continuity",
                          "Planned",
                          "M6 separate newborn records, birth doses and PNC; M7 simulated diagnostics with working care-gap closure.",
                        ],
                        [
                          "04",
                          "Readiness, referral & SOS",
                          "Planned",
                          "On-call and blood availability, clinician-confirmed arrivals, human-accepted referrals and two-step SOS.",
                        ],
                        [
                          "05",
                          "Operational ML forecasts",
                          "Trained on synthetic data",
                          "Delivery load, NICU admission counts and eight stock-demand targets: trained models, 24-month scenario history and time-ordered evaluation. Live inventory writes, external integrations and quality reporting remain roadmap.",
                        ],
                      ].map(([n, title, status, detail]) => (
                        <div key={n}>
                          <span className="phase-number">{n}</span>
                          <div>
                            <h3>
                              {title}{" "}
                              <Pill color={n === "01" ? "amber" : "neutral"}>
                                {status}
                              </Pill>
                            </h3>
                            <p>{detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="card">
                    <div className="card-head">
                      <h2>Assumptions requiring verification</h2>
                    </div>
                    <ul className="assumptions">
                      {data.provenance?.assumptions.map((a: string) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {patient && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="patient-title"
            className="modal"
          >
            <div className="card-head">
              <div>
                <div className="eyebrow">AUDITED SYNTHETIC RECORD</div>
                <h2 id="patient-title">
                  {compact(patient.mother.details.name)}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPatient(null)}
                aria-label="Close patient record"
              >
                ×
              </button>
            </div>
            <dl className="details">
              <div>
                <dt>Registered unit</dt>
                <dd>Unit {patient.unit.code}</dd>
              </div>
              <div>
                <dt>Assigned doctor</dt>
                <dd>{compact(patient.doctor.name)}</dd>
              </div>
              <div>
                <dt>Ward / labour room</dt>
                <dd>
                  {wardName(patient.unit.ward_id)} /{" "}
                  {wardName(patient.unit.labour_room_id)}
                </dd>
              </div>
              <div>
                <dt>Source mother</dt>
                <dd>{patient.mother.source_id}</dd>
              </div>
            </dl>
            <div className="card-head">
              <h3>Children · separate identities</h3>
            </div>
            <Table
              headers={[
                "Child source ID",
                "Birth order",
                "Birth date",
                "Weight",
              ]}
              rows={patient.children.map((c: Row) => [
                c.source_id,
                c.birth_order,
                c.date_of_birth,
                c.birth_weight_g + " g",
              ])}
            />
            <div className="callout">
              Clinical workflows and family timeline updates are scheduled for
              Phase 3.
            </div>
          </section>
        </div>
      )}
      {editor && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <div className="card-head">
              <h2 id="edit-title">
                {editor.kind === "verification"
                  ? "Review synthetic credentials"
                  : editor.kind === "delete"
                    ? "Delete unused record"
                    : (editor.record ? "Edit " : "Add ") + nice(editor.kind)}
              </h2>
              <button
                className="icon-button"
                onClick={() => {
                  setEditor(null);
                  setError("");
                }}
                aria-label="Close editor"
              >
                ×
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {editor.kind === "verification" ? (
              <div className="form-body">
                <p>
                  Review {compact(editor.record.name)}. Registration:{" "}
                  {editor.record.registration_no || "missing"}; department:{" "}
                  {departmentName(editor.record.department_id)}. This is a
                  synthetic credential check.
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await api("/users/" + editor.record.id + "/verify", {
                        method: "POST",
                        body: JSON.stringify({
                          verified: !editor.record.verified,
                        }),
                      });
                      setEditor(null);
                      setNotification(
                        "Credential decision recorded in the audit log.",
                      );
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {editor.record.verified
                    ? "Revoke verification"
                    : "Confirm verification"}
                </button>
              </div>
            ) : editor.kind === "delete" ? (
              <div className="form-body">
                <p>
                  Delete {editor.record.name || "Unit " + editor.record.code}?
                  Linked records prevent deletion.
                </p>
                <button className="primary" onClick={confirmRemove}>
                  Confirm deletion
                </button>
              </div>
            ) : (
              <form onSubmit={save} className="form-body">
                {editor.kind === "facility" ? (
                  <>
                    <label>
                      Fictional facility name
                      <input
                        name="name"
                        defaultValue={editor.record.name}
                        required
                      />
                    </label>
                    <label>
                      Address
                      <textarea
                        name="address"
                        defaultValue={editor.record.address}
                        required
                      />
                    </label>
                    <label>
                      NABH status
                      <select
                        name="nabh_status"
                        defaultValue={editor.record.nabh_status}
                      >
                        <option>ACCREDITED_SYNTHETIC</option>
                        <option>NOT_ACCREDITED</option>
                        <option>APPLICATION_PENDING</option>
                      </select>
                    </label>
                    <label>
                      NABL status
                      <select
                        name="nabl_status"
                        defaultValue={editor.record.nabl_status}
                      >
                        <option>Accredited (synthetic)</option>
                        <option>Not accredited</option>
                        <option>Application pending</option>
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="emergency_24x7"
                        defaultChecked={editor.record.emergency_24x7}
                      />
                      24×7 emergency service
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="sos_participating"
                        defaultChecked={editor.record.sos_participating}
                      />
                      Participating in SOS network
                    </label>
                    <h3>Facility capabilities</h3>
                    <p className="small">
                      Changes are explicit administrator decisions. Capacity
                      migration is separately gated.
                    </p>
                    {[
                      "c_section",
                      "blood_transfusion",
                      "blood_bank",
                      "neonatal_resuscitation",
                      "labour_room_24x7",
                    ].map((key) => (
                      <label className="checkbox" key={key}>
                        <input
                          type="checkbox"
                          name={"cap_" + key}
                          defaultChecked={Boolean(
                            editor.record.capabilities[key],
                          )}
                        />
                        {nice(key)}
                      </label>
                    ))}
                  </>
                ) : editor.kind === "departments" ? (
                  <label>
                    Department name
                    <input
                      name="name"
                      defaultValue={editor.record?.name}
                      required
                      maxLength={180}
                    />
                  </label>
                ) : editor.kind === "units" ? (
                  <>
                    <label>
                      Unit code
                      <input
                        name="code"
                        defaultValue={editor.record?.code}
                        required
                        maxLength={20}
                      />
                    </label>
                    <label>
                      Department
                      <select
                        name="department_id"
                        defaultValue={editor.record?.department_id}
                      >
                        {data?.departments.map((d: Row) => (
                          <option value={d.id} key={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      {["anc_day", "gynae_day", "opd_day", "ot_day"].map(
                        (k) => (
                          <label key={k}>
                            {nice(k)}
                            <select
                              name={k}
                              defaultValue={editor.record?.[k] ?? ""}
                            >
                              <option value="">Not applicable</option>
                              {days.map((d, i) => (
                                <option value={i} key={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                      {["ward_id", "gynae_ward_id", "labour_room_id"].map(
                        (k) => (
                          <label key={k}>
                            {nice(k)}
                            <select
                              name={k}
                              defaultValue={editor.record?.[k] ?? ""}
                            >
                              <option value="">Not assigned</option>
                              {data?.wards.map((w: Row) => (
                                <option value={w.id} key={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                    </div>
                    <label>
                      Room
                      <input
                        name="room"
                        defaultValue={editor.record?.room || "SYNTHETIC-OPD"}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Clinic name
                      <input
                        name="name"
                        defaultValue={editor.record?.name}
                        required
                      />
                    </label>
                    <label>
                      In-charge unit
                      <select
                        name="unit_id"
                        defaultValue={editor.record?.unit_id}
                      >
                        {data?.units.map((u: Row) => (
                          <option key={u.id} value={u.id}>
                            {departmentName(u.department_id)} · {u.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Day
                      <select name="day" defaultValue={editor.record?.day ?? 0}>
                        {days.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Start time
                        <input
                          name="start_time"
                          type="time"
                          defaultValue={editor.record?.start_time || "09:00"}
                          required
                        />
                      </label>
                      <label>
                        End time
                        <input
                          name="end_time"
                          type="time"
                          defaultValue={editor.record?.end_time || "13:00"}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Room
                      <input
                        name="room"
                        defaultValue={editor.record?.room || "SYNTHETIC-OPD"}
                        required
                      />
                    </label>
                  </>
                )}
                <button className="primary" disabled={busy}>
                  Accept & save changes
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
