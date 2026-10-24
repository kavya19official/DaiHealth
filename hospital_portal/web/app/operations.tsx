"use client";
import { useState } from "react";
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
          "appointments",
          "Appointments & queue",
          "Review the recorded clinic list",
          "◷",
        ],
        ["patients", "Find a patient", "Open linked care records", "⌕"],
        ["gaps", "Care-gap worklist", "Review missing recorded care", "♡"],
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
  const [tab, setTab] = useState("posts");
  const rows: Row[] = data.items || [];
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
    return (
      <>
        <div className="critical-grid">
          {rows.map((c) => (
            <section className="card critical-card" key={c.name}>
              <span className="critical-icon">✚</span>
              <h2>{c.name}</h2>
              <strong>
                {c.occupied}
                <small> / {c.capacity}</small>
              </strong>
              <div className="capacity-track">
                <i style={{ width: (c.occupied / c.capacity) * 100 + "%" }} />
              </div>
              <p>
                {c.available} beds available · {c.ventilators || 0} functional
                ventilators
              </p>
              <span className="pill neutral">Recorded snapshot</span>
            </section>
          ))}
        </div>
        <Card
          title="Critical-care admission log"
          hint="Recent recorded admissions. Patient identities are omitted from this capacity view."
        >
          <Table
            headers={[
              "Admission ID",
              "Care location",
              "Admitted",
              "Discharged",
              "Reason",
            ]}
            rows={(data.admissions || []).map((r: Row) => [
              r.admission_id,
              r.ward,
              r.admitted_at,
              r.discharged_at || "Currently admitted",
              nice(r.admission_reason),
            ])}
          />
        </Card>
      </>
    );
  if (view === "blood") {
    const groups = Array.from(new Set(rows.map((r) => r.blood_group)));
    return (
      <>
        <div className="blood-groups">
          {groups.map((g) => (
            <div className="card blood-group" key={g}>
              <span>♦</span>
              <h2>{g}</h2>
              <strong>
                {count(
                  rows
                    .filter((r) => r.blood_group === g)
                    .reduce((n, r) => n + r.units_available, 0),
                )}
              </strong>
              <small>units across components</small>
            </div>
          ))}
        </div>
        <Card
          title="Blood bank stock"
          hint="Latest daily component snapshot. This is stock visibility, not a cross-match or issue approval."
        >
          <Table
            headers={[
              "Blood group",
              "Component",
              "Units available",
              "Snapshot",
            ]}
            rows={rows.map((r) => [
              <strong key={r.blood_group}>{r.blood_group}</strong>,
              r.component,
              r.units_available,
              r.snapshot_date,
            ])}
          />
        </Card>
      </>
    );
  }
  if (view === "staffing")
    return (
      <Card
        title="People & coverage"
        hint="Sanctioned posts, fictional clinicians and the snapshot shift roster."
      >
        <div className="inner-tabs">
          {[
            ["posts", "Staff establishment"],
            ["doctors", "Doctors & units"],
            ["rosters", "Shift & on-call roster"],
          ].map(([id, title]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </div>
        {tab === "posts" ? (
          <Table
            headers={["Cadre", "Sanctioned", "In position", "Vacancies"]}
            rows={data.posts.map((r: Row) => [
              r.cadre,
              r.sanctioned,
              r.in_position,
              r.sanctioned - r.in_position,
            ])}
          />
        ) : tab === "doctors" ? (
          <Table
            headers={[
              "Fictional clinician",
              "Specialty",
              "Designation",
              "Qualification",
              "Unit",
              "Experience",
            ]}
            rows={rows.map((r) => [
              name(r.name),
              r.specialty,
              r.designation,
              r.qualification,
              r.unit_code || "—",
              r.experience_years + " years",
            ])}
          />
        ) : (
          <Table
            headers={["Staff member", "Role", "Shift", "Time", "Ward"]}
            rows={data.rosters.map((r: Row) => [
              name(r.name),
              r.role,
              r.shift,
              r.start_time + "–" + r.end_time,
              r.ward,
            ])}
          />
        )}
      </Card>
    );
  if (view === "readiness")
    return (
      <>
        <div className="metrics">
          <Metric
            title="Available beds"
            value={summary.beds.available}
            detail="Recorded source availability"
          />
          <Metric
            title="PRBC units"
            value={summary.blood_units}
            detail="All groups; matching is still required"
          />
          <Metric
            title="Roster on call"
            value={summary.on_call.length}
            detail="At snapshot time"
          />
          <Metric
            title="C-section service"
            value={data.services.c_section ? "Configured" : "Not configured"}
            detail={data.services.emergency_obstetric_care}
          />
        </div>
        <Card
          title="Arrival preparation worklist"
          hint="Clinician-confirmed flags are preserved. Availability does not establish that a patient is clinically safe."
        >
          <Table
            headers={[
              "Mother",
              "Stage",
              "Gestation",
              "EDD",
              "Clinician-recorded reason",
            ]}
            rows={rows.map((r) => [
              name(r.name),
              r.stage,
              r.gestation_weeks + " weeks",
              r.edd,
              r.reason,
            ])}
          />
          <div className="callout">
            Individual blood matching, OT booking, reservations and
            receiving-team acceptance require human confirmation in the later
            workflow phase.
          </div>
        </Card>
      </>
    );
  const views: Record<
    string,
    {
      title: string;
      hint: string;
      headers: string[];
      row: (r: Row) => React.ReactNode[];
    }
  > = {
    equipment: {
      title: "Equipment & biomedical resources",
      hint: "Installed and functional quantities are read from the same ward ledger.",
      headers: [
        "Equipment",
        "Ward",
        "Installed",
        "Functional",
        "Status",
        "Last service",
      ],
      row: (r) => [
        nice(r.type),
        r.ward,
        r.installed_quantity,
        r.functional_quantity,
        state(r.status),
        r.last_service_date,
      ],
    },
    organisation: {
      title: "Organisation & responsible officers",
      hint: "All office holders are fictional.",
      headers: ["Role", "Fictional office holder", "Demo email", "Appointed"],
      row: (r) => [r.role_name, name(r.person_name), r.email, r.appointed_on],
    },
    ambulances: {
      title: "Ambulance fleet",
      hint: "Vehicle status is a recorded snapshot. GPS tracking and dispatch actions are not live.",
      headers: [
        "Vehicle",
        "Type",
        "Status",
        "Oxygen",
        "Neonatal transport",
        "Last service",
      ],
      row: (r) => [
        r.vehicle_label,
        r.type,
        state(r.status),
        r.oxygen_supported ? "Yes" : "No",
        r.neonatal_transport ? "Yes" : "No",
        r.last_service_date,
      ],
    },
    census: {
      title: "Daily delivery census",
      hint: "Recorded events from the operating ledger; these are not model forecasts.",
      headers: [
        "Date",
        "Admissions",
        "Discharges",
        "Referrals in / out",
        "Total deliveries",
        "Normal",
        "Assisted",
        "Elective LSCS",
        "Emergency LSCS",
      ],
      row: (r) => [
        r.date,
        r.admissions,
        r.discharges,
        r.referrals_in + " / " + r.referrals_out,
        r.deliveries,
        r.normal || 0,
        r.assisted || 0,
        r.elective_lscs || 0,
        r.emergency_lscs || 0,
      ],
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
    diagnostics: {
      title: "Diagnostics & result flow",
      hint: "Recorded orders within your cohort. Upload and automatic care-gap completion remain a separate workflow.",
      headers: [
        "Mother",
        "Test",
        "Ordered",
        "Due",
        "Completed",
        "Status",
        "Result flag",
      ],
      row: (r) => [
        name(r.mother_name),
        nice(r.test_type),
        r.ordered_date,
        r.due_date,
        r.completed_date || "Pending",
        state(r.status),
        nice(r.result_flag),
      ],
    },
  };
  const v = views[view];
  return v ? (
    <Card title={v.title} hint={v.hint}>
      <Table headers={v.headers} rows={rows.map(v.row)} />
    </Card>
  ) : (
    <div className="empty">Select a workspace view.</div>
  );
}
