"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OperationalOverview, SnapshotView } from "./operations";
import { ForecastPanel } from "./forecasts";
import { CarePanel, PatientCoordination } from "./care";
import { AffiliationSwitcher, InvitationAcceptance, PatientStaffRecords, CreateReferral } from "./administration";
import { SustainabilityPanel } from "./sustainability";
import { GoldenHourLayer } from "./golden-hour";
import { IncomingCare } from "./incoming-care";
import { PatientCareHub } from "./patient-care-hub";
import { AshaCopilot } from "./asha";
import { ClinicalMonitoring, PatientMonitoring } from "./clinical-monitor";
type Row = Record<string, any>;
type NavItem = readonly [string, string];
type NavGroup = { label: string; items: readonly NavItem[] };
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
  ["incomingCare", "Incoming care", "✚"],
  ["patientCare", "Patient Care Hub", "♡"],
  ["careReviews", "Clinical review & summaries", "▤"],
  ["clinicalMonitor", "Clinical monitoring", "▥"],
  ["readiness", "Delivery readiness", "✚"],
  ["capacity", "Capacity & readiness", "▱"],
  ["care-gap-map", "District care gap map", "⌖"],
  ["critical", "Critical & neonatal care", "⌁"],
  ["diagnostics", "Diagnostics & results", "▤"],
  ["ashaCopilot", "Community care", "⌂"],
];
const administrationGroups: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [["adminOverview", "Administration dashboard"]],
  },
  {
    label: "Facility setup",
    items: [
      ["facility", "Facility profile"],
      ["structure", "Clinical structure"],
      ["clinics", "Clinics & services"],
    ],
  },
  {
    label: "Workforce",
    items: [
      ["organisation", "Roles & responsibilities"],
      ["staffing", "Staffing & on-call"],
    ],
  },
  {
    label: "Capacity & resources",
    items: [
      ["beds", "Wards & bed board"],
      ["blood", "Blood bank"],
      ["equipment", "Equipment"],
      ["ambulances", "Ambulances"],
    ],
  },
  {
    label: "Insights & planning",
    items: [
      ["census", "Daily activity & census"],
      ["forecasts", "Forecasts & stock planning"],
      ["sustainability", "Green hospital"],
    ],
  },
  {
    label: "Governance",
    items: [["audit", "Access & audit"]],
  },
] as const;
const administrationNav = administrationGroups.flatMap((group) => group.items);
const workspacePermissions: Record<string, string> = {
  incomingCare: "coordination.read",
  patientCare: "patient.read",
  careTasks: "care.read",
  careReviews: "care.read",
  followups: "coordination.read",
  clinicalMonitor: "monitor.read",
  sustainability: "green.read",
  forecasts: "forecast.read",
  "care-gap-map": "quality.read",
  "quality-board": "quality.read",
  capacity: "facility.read",
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
  ashaCopilot: "asha.read",
  audit: "audit.read",
};
const snapshotViews = new Set([
  "care-gap-map",
  "quality-board",
  "capacity",
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
  "care-gap-map": ["District care gap map", "Privacy-protected synthetic outreach patterns with role-scoped drill-down."],
  "quality-board": ["Ward quality dashboard", "Suppressed recorded measures; no hospital ranking."],
  capacity: ["Capacity & readiness", "Recorded beds, blood and scheduled staff; freshness is shown without ranking facilities."],
  goldenHour: ["Golden hour", "Emergency arrivals, patient requests and facility transfers in one coordinated workspace."],
  incomingCare: ["Incoming care", "Emergency arrivals, patient requests and facility transfers in one coordinated workspace."],
  patientCare: ["Patient Care Hub", "Patients, appointments, care gaps and follow-ups in one connected workspace."],
  careTasks: [
    "Follow-up & outreach",
    "Owned care tasks, access barriers and evidence-backed follow-through.",
  ],
  careReviews: [
    "Clinical review & summaries",
    "Recorded concerns, human acknowledgement and clinician-approved next steps.",
  ],
  clinicalMonitor: ["Clinical monitoring", "Prioritized antenatal findings and evidence for clinician review."],
  followups: ["Follow-up worklist", "Patient-visible tasks with a clear owner, due date and shared completion state."],
  ashaCopilot: [
    "ASHA Copilot",
    "Offline-first community visits, village routes, voice notes and health-camp updates.",
  ],
  sustainability: [
    "Green hospital",
    "Resource observations and accountable actions, without unsupported impact claims.",
  ],
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
  census: ["Daily activity & census", "Recorded patient flow and delivery activity, grouped into a clearer operational view."],
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
  audit: [
    "Access & audit",
    "A traceable record of patient access, authentication and accepted changes.",
  ],
};
const nice = (v: unknown) => String(v ?? "—").replaceAll("_", " ");
const compact = (v: string) =>
  v?.replace("DAI SYNTHETIC ", "DAI · ").replace("Dr SYNTHETIC ", "Dr. ") ||
  "—";
function HospitalNavIcon({ name }: { name: string }) {
  const type: Record<string, string> = {
    overview: "home", adminOverview: "home", incomingCare: "activity", patientCare: "heart",
    careReviews: "file", clinicalMonitor: "activity", readiness: "shield", capacity: "grid",
    "care-gap-map": "search", critical: "activity", diagnostics: "clipboard", ashaCopilot: "user",
    forecasts: "trend", sustainability: "heart", facility: "home",
    organisation: "user", structure: "grid", beds: "grid", clinics: "calendar", blood: "droplet",
    staffing: "user", equipment: "settings", ambulances: "arrow", census: "clipboard", audit: "shield",
  };
  const icon = type[name] || "grid";
  return <svg className="hospital-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icon === "home" && <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>}
    {icon === "heart" && <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>}
    {icon === "user" && <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>}
    {icon === "calendar" && <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>}
    {icon === "file" && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>}
    {icon === "search" && <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>}
    {icon === "activity" && <path d="M3 12h4l3-7 4 14 3-7h4"/>}
    {icon === "shield" && <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>}
    {icon === "grid" && <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>}
    {icon === "droplet" && <><path d="M12 2.5S5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z"/><path d="M9.5 16.5c.7 1 1.6 1.5 2.8 1.5"/></>}
    {icon === "trend" && <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>}
    {icon === "clipboard" && <><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/></>}
    {icon === "settings" && <><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>}
    {icon === "arrow" && <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>}
  </svg>;
}
const auditGroup = (action: unknown) => {
  const value = String(action || "").toLowerCase();
  if (/login|logout|auth|otp|session|verify|credential|permission|access/.test(value)) return "Security & access";
  if (/read|view|open|search|list|export/.test(value)) return "Record views";
  return "Administrative changes";
};
const auditActionLabel = (action: unknown) => {
  const value = String(action || "activity").toLowerCase();
  if (value === "read") return "viewed";
  if (/create|add/.test(value)) return "created";
  if (/update|edit|patch/.test(value)) return "updated";
  if (/delete|remove/.test(value)) return "deleted";
  if (/verify|approve|accept/.test(value)) return "verified";
  if (/login|sign_in/.test(value)) return "signed in to";
  return nice(value);
};
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
  const [sessionChecked, setSessionChecked] = useState(false);
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
    area: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Row | null>(null);
  const [email, setEmail] = useState("hospital_admin@dai-synthetic.invalid");
  const [password, setPassword] = useState(process.env.NEXT_PUBLIC_DAI_HOSTED_DEMO === "true" ? "" : "Dai-Synthetic-2026!");
  const [otp, setOtp] = useState("");
  const [records, setRecords] = useState<Row[]>([]);
  const [auditFilters, setAuditFilters] = useState({
    query: "",
    action: "",
    entity: "",
    group: "",
  });
  const [patientTotal, setPatientTotal] = useState(0);
  const [patient, setPatient] = useState<Row | null>(null);
  const [editor, setEditor] = useState<Row | null>(null);
  const [notification, setNotification] = useState("");
  const [menu, setMenu] = useState(false);
  const [openAdminGroup, setOpenAdminGroup] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => {
    setMenu(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  }, []);
  useEffect(() => {
    if (!menu) return;
    closeMenuButton.current?.focus();
    const breakpoint = matchMedia("(max-width: 1024px)");
    const resize = () => { if (!breakpoint.matches) setMenu(false); };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    breakpoint.addEventListener("change", resize);
    document.addEventListener("keydown", handleEscape);
    return () => {
      breakpoint.removeEventListener("change", resize);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menu, closeMenu]);
  const api = useCallback(
    async (path: string, options: RequestInit = {}, access = token) => {
      const response = await fetch((process.env.NEXT_PUBLIC_DAI_BASE_PATH || "") + "/api" + path, {
        ...options,
        credentials: "same-origin",
        signal: options.signal || AbortSignal.timeout(15000),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-dai-client": "portal",
          ...(access ? { Authorization: "Bearer " + access } : {}),
          ...options.headers,
        },
      });
      const result = await response.json().catch(() => { throw new Error("The hospital service returned an unreadable response. Refresh or restart npm start, then try again."); });
      if (
        !response.ok &&
        response.status === 404 &&
        path.startsWith("/workspace/")
      )
        throw new Error(
          "The richer workspace needs the updated backend. Restart your FastAPI terminal once, then refresh.",
        );
      if (!response.ok)
        throw Object.assign(new Error(
          typeof result.detail === "string"
            ? result.detail
            : typeof result.error === "string" ? result.error : JSON.stringify(result.detail),
        ), { status: response.status });
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
      if (view === "clinicalMonitor") { if (sequence === loadSequence.current) setData(null); return; }
      if (view === "incomingCare" || view === "patientCare" || view === "followups" || view === "ashaCopilot") { const structure = await api("/facilities/" + user.facility_id + "/structure"); if (sequence === loadSequence.current) setData(structure); return; }
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
    if (!resetNavigation && me.role === "asha") {
      setView(current => current === "overview" ? "ashaCopilot" : current);
    }
    if (resetNavigation) {
      setData(null);
      setRecords([]);
      setPatient(null);
      setView(me.role === "asha" ? "ashaCopilot" : "overview");
      setMode("operations");
      setSummary(null);
      setWorkspaceData(null);
      setFilters({ page: 1, q: "", status: "", ward: "", area: "" });
    }
    setChallenge(null);
    setOtp("");
  }
  const initialRestore = useRef<Promise<void> | null>(null);
  useEffect(() => {
    // React development effects can run twice. Rotate the refresh cookie only once.
    if (initialRestore.current) return;
    initialRestore.current = api("/auth/refresh", { method: "POST" }, "")
      .then((result) => session(result, false))
      .catch(() => {})
      .finally(() => setSessionChecked(true)); /* access tokens stay in memory */
  }, []);
  useEffect(() => {
    if (!user) return;
    let refreshing = false;
    async function renew() {
      if (!navigator.onLine || refreshing) return;
      refreshing = true;
      try {
        const result = await api("/auth/refresh", { method: "POST" });
        await session(result, false);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403) {
          setUser(null);
          setToken("");
          setError("Session expired. Please sign in again.");
        }
      } finally {
        refreshing = false;
      }
    }
    const timer = setInterval(renew, 8 * 60 * 1000);
    window.addEventListener("online", renew);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", renew);
    };
  }, [user, api]);
  useEffect(() => {
    if (sessionChecked && !user && process.env.NEXT_PUBLIC_DAI_BASE_PATH)
      window.location.replace("/auth.html?role=hospital");
  }, [sessionChecked, user]);
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
  const auditActions = [...new Set(records.map((r) => String(r.action || "")).filter(Boolean))].sort();
  const auditEntities = [...new Set(records.map((r) => String(r.entity_type || "")).filter(Boolean))].sort();
  const filteredAuditRecords = records.filter((record) => {
    const query = auditFilters.query.trim().toLowerCase();
    const searchable = [
      record.actor_name,
      record.actor_role,
      record.action,
      record.entity_type,
      record.entity_id,
      JSON.stringify(record.details || {}),
    ].join(" ").toLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (!auditFilters.action || record.action === auditFilters.action) &&
      (!auditFilters.entity || record.entity_type === auditFilters.entity) &&
      (!auditFilters.group || auditGroup(record.action) === auditFilters.group)
    );
  });
  const groupedAuditRecords = ["Record views", "Administrative changes", "Security & access"]
    .map((group) => ({ group, items: filteredAuditRecords.filter((record) => auditGroup(record.action) === group) }))
    .filter(({ items }) => items.length);
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
  if (!user && process.env.NEXT_PUBLIC_DAI_BASE_PATH)
    return <main className="login-shell"><p role="status">Opening DAI sign in…</p></main>;
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
          <InvitationAcceptance api={api}/>
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
                  <strong>Local demo account</strong>
                  <span>hospital_admin@dai-synthetic.invalid</span>
                  <span>{process.env.NEXT_PUBLIC_DAI_HOSTED_DEMO === "true" ? "Use the demo account password provided by the DAI team." : "Password: Dai-Synthetic-2026!"}</span>
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
    if(id === "capacity") return user.permissions.includes("facility.write") || ["bed.read","blood.read","facility.read"].every(p=>user.permissions.includes(p));
    const permission = workspacePermissions[id];
    return (
      !permission ||
      (snapshotViews.has(id) && user.permissions.includes("facility.write")) ||
      user.permissions.includes(permission)
    );
  };
  const allowedOperations = operationNav.filter(([id]) => canOpen(id));
  const allowedAdministrationGroups = administrationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(([id]) => canOpen(id)),
    }))
    .filter((group) => group.items.length);
  function navigate(id: string) {
    setView(id);
    setFilters({ page: 1, q: "", status: "", ward: "", area: "" });
    setMode(
      administrationNav.some(([view]) => view === id)
        ? "administration"
        : "operations",
    );
    setWorkspaceData(null);
    if (menu) closeMenu();
    setNotification("");
  }
  return (
    <div className="portal-shell" data-menu-open={menu || undefined}>
      {user.permissions.includes("coordination.read") && <GoldenHourLayer key={user.id + user.facility_id} api={api} permissions={user.permissions} onOpenBoard={() => navigate("incomingCare")} />}
      <a className="skip" href="#main">
        Skip to workspace
      </a>
      {menu && <button className="workspace-menu-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={closeMenu} />}
      <aside id="hospital-navigation" className={"sidebar " + (menu ? "open" : "")}>
        <button type="button" className="workspace-menu-close" ref={closeMenuButton} onClick={closeMenu}>
          Close navigation
        </button>
        <a className="brand" href="/">
          दाई{" "}
          <span>
            DAI<small>YOUR CARE COMPANION</small>
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
          {mode === "operations" ? (
            allowedOperations.map(([id, title]) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                aria-current={view === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <HospitalNavIcon name={id} />
                {title}
              </button>
            ))
          ) : (
            allowedAdministrationGroups.map((group) => {
              const active = group.items.some(([id]) => id === view);
              const directItem = group.items.length === 1 ? group.items[0] : null;
              if (directItem) {
                const [id, title] = directItem;
                return (
                  <button
                    key={id}
                    className={view === id ? "active" : ""}
                    aria-current={view === id ? "page" : undefined}
                    onClick={() => navigate(id)}
                  >
                    <HospitalNavIcon name={id} />
                    {title}
                  </button>
                );
              }
              return (
                <details className="sidebar-nav-group" key={group.label} open={active || openAdminGroup === group.label}>
                  <summary onClick={(event) => {
                    event.preventDefault();
                    setOpenAdminGroup((current) => current === group.label ? "" : group.label);
                  }}>
                    <span>{group.label}</span>
                    <i aria-hidden="true">⌄</i>
                  </summary>
                  <div>
                    {group.items.map(([id, title]) => (
                      <button
                        key={id}
                        className={view === id ? "active" : ""}
                        aria-current={view === id ? "page" : undefined}
                        onClick={() => navigate(id)}
                      >
                        <HospitalNavIcon name={id} />
                        {title}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })
          )}
        </nav>
        <footer>
          <div className="sidebar-care-card">
            <svg className="sidebar-care-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <div>
              <strong>Connected care. Clear responsibility.</strong>
              <button
                className="text-button"
                onClick={async () => {
                  await api("/auth/logout", { method: "POST" });
                  setToken("");
                  setUser(null);
                }}
              >
                Sign out →
              </button>
            </div>
          </div>
        </footer>
      </aside>
      <div className="workspace" inert={menu || undefined}>
        <header className="topbar">
          <button
            className="menu-button"
            ref={menuButton}
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
            aria-expanded={menu}
            aria-controls="hospital-navigation"
          >
            ☰
          </button>
          <div className="facility-label">
            <small>YOUR FACILITY</small>
            <strong>
              {facility ? compact(facility.name) : "Loading facility…"}
            </strong>
          </div>
          <span data-dai-language-slot />
          <details className="demo-info"><summary>About this demo</summary><p>Fictional people, facilities and synthetic records. Forecasts are demonstrations and are not validated on real hospital activity.</p></details>
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
            <span className={"snapshot-caption" + (error ? " needs-attention" : "")}>
              <i /> {error ? "Refresh needed · last request failed" : busy ? "Refreshing recorded workspace…" : "Connected · recorded workspace"}
            </span>
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                HOSPITAL /{" "}
                {mode === "operations" ? "OPERATIONS" : "ADMINISTRATION"}
              </div>
              <AffiliationSwitcher api={api} onSwitch={async()=>{const next=await api("/me");setUser(next);setPatient(null);setData(null);setRecords([]);setWorkspaceData(null);setSummary(null);setNotification("Facility context updated. Showing this facility’s authorised records.");}}/>
              <h1>{(titles[view] ?? [view, ""])[0]}</h1>
              <p>{(titles[view] ?? [view, ""])[1]}</p>
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
          {view === "incomingCare" && (
            <IncomingCare key={user.id+user.facility_id} api={api} permissions={user.permissions} role={user.role} facilityId={user.facility_id}/>
          )}
          {view === "patientCare" && (
            <PatientCareHub
              key={user.id+user.facility_id}
              api={api}
              openPatient={async id => {
                try {
                  setPatient(await api("/patients/" + id));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          )}
          {view === "clinicalMonitor" && user.permissions.includes("monitor.read") && <ClinicalMonitoring
            key={user.id+user.facility_id} api={api} canReview={user.permissions.includes("monitor.review")}
            openPatient={async id=>{setPatient(await api("/patients/"+id));}}/>}
          {view === "ashaCopilot" && <AshaCopilot key={user.id+user.facility_id} api={api} user={user}/>}
          {data && (
            <>
              {(view === "careTasks" || view === "careReviews") && (
                <CarePanel
                  key={user.id + view}
                  api={api}
                  permissions={user.permissions}
                  role={user.role}
                  userId={user.id}
                  reviews={view === "careReviews"}
                />
              )}
              {view === "sustainability" && (
                <SustainabilityPanel
                  key={user.id}
                  api={api}
                  permissions={user.permissions}
                />
              )}
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
                  <section className="facility-master card">
                    <header className="facility-master-hero">
                      <div className="facility-master-identity">
                        <span className="facility-master-mark" aria-hidden="true">✚</span>
                        <div>
                          <span className="eyebrow">Facility profile</span>
                          <h2>{compact(facility.name)}</h2>
                          <p>{facility.source_id} · {facility.address}</p>
                        </div>
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
                    </header>

                    <div className="facility-summary-grid">
                      <article className="facility-summary-card">
                        <div className="facility-summary-title"><span aria-hidden="true">⌂</span><h3>Identity & location</h3></div>
                        <dl>
                          <div><dt>Facility tier</dt><dd>{nice(facility.tier)}</dd></div>
                          <div><dt>Ownership</dt><dd>{nice(facility.ownership)}</dd></div>
                          <div><dt>Coordinates</dt><dd>{facility.lat}, {facility.lng}</dd></div>
                        </dl>
                      </article>

                      <article className="facility-summary-card">
                        <div className="facility-summary-title"><span aria-hidden="true">✓</span><h3>Accreditation</h3></div>
                        <dl>
                          <div><dt>NABH</dt><dd>{nice(facility.nabh_status)}</dd></div>
                          <div><dt>NABL</dt><dd>{facility.nabl_status}</dd></div>
                          <div><dt>ABDM facility ID</dt><dd>{facility.abdm_facility_id || "Not connected"}</dd></div>
                        </dl>
                      </article>

                      <article className="facility-summary-card facility-capacity-card">
                        <div className="facility-summary-title"><span aria-hidden="true">▱</span><h3>Bed capacity</h3></div>
                        <div className="facility-capacity-numbers">
                          <div><strong>{facility.authorized_beds}</strong><span>Authorized beds</span></div>
                          <div><strong>{facility.functional_beds}</strong><span>Functional beds</span></div>
                        </div>
                        <p>{Math.max(0, Number(facility.authorized_beds) - Number(facility.functional_beds))} beds currently not functional</p>
                      </article>

                      <article className="facility-summary-card">
                        <div className="facility-summary-title"><span aria-hidden="true">＋</span><h3>Emergency readiness</h3></div>
                        <div className="facility-status-list">
                          <div><span>24×7 emergency</span><b className={facility.emergency_24x7 ? "ready" : "inactive"}>{facility.emergency_24x7 ? "Enabled" : "Disabled"}</b></div>
                          <div><span>SOS participation</span><b className={facility.sos_participating ? "ready" : "inactive"}>{facility.sos_participating ? "Enabled" : "Disabled"}</b></div>
                        </div>
                      </article>
                    </div>

                    <section className="facility-capabilities">
                      <div>
                        <span className="eyebrow">Services</span>
                        <h3>Configured capabilities</h3>
                        <p>Services currently recorded for this facility.</p>
                      </div>
                      <div className="facility-capability-grid">
                      {Object.entries(facility.capabilities)
                        .filter(([key]) => key !== "hospital_id")
                        .map(([key, value]) => (
                          <div className={value ? "available" : "unavailable"} key={key}>
                            <span aria-hidden="true">{value ? "✓" : "—"}</span>
                            <strong>{nice(key)}</strong>
                            <small>{typeof value === "boolean" ? (value ? "Available" : "Not available") : String(value)}</small>
                          </div>
                        ))}
                      </div>
                    </section>
                  </section>
                  <section className="card facility-roles-card">
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
                      <p>Unit days, rooms and timings.</p>
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
              {view === "audit" && (
                <section className="audit-workspace">
                  <div className="audit-summary-grid">
                    {["Record views", "Administrative changes", "Security & access"].map((group) => (
                      <button
                        key={group}
                        className={auditFilters.group === group ? "active" : ""}
                        onClick={() => setAuditFilters({ ...auditFilters, group: auditFilters.group === group ? "" : group })}
                      >
                        <span>{group === "Record views" ? "◉" : group === "Administrative changes" ? "✎" : "✓"}</span>
                        <strong>{records.filter((record) => auditGroup(record.action) === group).length}</strong>
                        <small>{group}</small>
                      </button>
                    ))}
                  </div>

                  <section className="audit-filter-card card">
                    <div className="audit-filter-intro">
                      <div>
                        <h2>Find activity</h2>
                        <p>Search the latest 100 permitted events from this facility.</p>
                      </div>
                      <span>{filteredAuditRecords.length} matching events</span>
                    </div>
                    <div className="audit-filters">
                      <label className="audit-search">
                        <span>Search activity</span>
                        <input
                          type="search"
                          value={auditFilters.query}
                          onChange={(event) => setAuditFilters({ ...auditFilters, query: event.target.value })}
                          placeholder="Search staff, action, record or ID"
                        />
                      </label>
                      <label>
                        <span>Action</span>
                        <select value={auditFilters.action} onChange={(event) => setAuditFilters({ ...auditFilters, action: event.target.value })}>
                          <option value="">All actions</option>
                          {auditActions.map((action) => <option value={action} key={action}>{nice(action)}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Record type</span>
                        <select value={auditFilters.entity} onChange={(event) => setAuditFilters({ ...auditFilters, entity: event.target.value })}>
                          <option value="">All record types</option>
                          {auditEntities.map((entity) => <option value={entity} key={entity}>{nice(entity)}</option>)}
                        </select>
                      </label>
                      <button className="secondary" onClick={() => setAuditFilters({ query: "", action: "", entity: "", group: "" })}>Clear filters</button>
                    </div>
                  </section>

                  {groupedAuditRecords.length ? groupedAuditRecords.map(({ group, items }) => (
                    <section className="audit-group card" key={group}>
                      <header>
                        <div><h2>{group}</h2><p>{group === "Record views" ? "Patient and facility records opened by authorised users." : group === "Administrative changes" ? "Updates that changed hospital or care information." : "Sign-in, permissions and verification-related activity."}</p></div>
                        <span>{items.length} events</span>
                      </header>
                      <div className="audit-event-list">
                        {items.map((record) => (
                          <article className="audit-event" key={record.id}>
                            <span className="audit-event-icon" aria-hidden="true">{group === "Record views" ? "◉" : group === "Administrative changes" ? "✎" : "✓"}</span>
                            <div className="audit-event-main">
                              <strong>{compact(record.actor_name || "Authorised user")} <b>{auditActionLabel(record.action)}</b> {nice(record.entity_type)} record</strong>
                              <span>{new Date(record.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {nice(record.actor_role || "authorised staff")}</span>
                            </div>
                            <Pill color={group === "Security & access" ? "green" : "purple"}>{nice(record.action)}</Pill>
                            <details>
                              <summary>Technical details</summary>
                              <dl>
                                <div><dt>Record ID</dt><dd>{record.entity_id || "—"}</dd></div>
                                <div><dt>Event ID</dt><dd>{record.id || "—"}</dd></div>
                                <div><dt>Inputs</dt><dd><code>{JSON.stringify(record.details || {}, null, 2)}</code></dd></div>
                              </dl>
                            </details>
                          </article>
                        ))}
                      </div>
                    </section>
                  )) : <div className="empty audit-empty">No audit events match these filters.</div>}
                </section>
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
                <div className="eyebrow">AUDITED PATIENT RECORD</div>
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
            {user.permissions.includes("monitor.read") && <PatientMonitoring key={patient.mother.id} api={api} motherId={patient.mother.id}/>}
            {user.permissions.includes("care.read") && (
              <PatientCoordination
                key={patient.mother.id}
                api={api}
                motherId={patient.mother.id}
              />
            )}
            {["consultant","resident"].includes(user.role) && <CreateReferral key={patient.mother.id+"referral"} api={api} motherId={patient.mother.id}/>}
            {user.permissions.includes("care.read") && <PatientStaffRecords key={patient.mother.id+user.facility_id} api={api} motherId={patient.mother.id} role={user.role}/>}
            <div className="callout">
              Imported clinical observations remain unchanged. Confirmed
              summaries and operational follow-through are shown separately.
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
