/* DAI hospital workspace: all clinical and infrastructure records come from SQLite APIs. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? "—").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const n = (v) => Number(v || 0).toLocaleString("en-IN");
  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const shortDay = (v) =>
    v === null || v === undefined ? "—" : days[v]?.slice(0, 3) || "—";
  const fmt = (v) =>
    v
      ? new Date(String(v).slice(0, 10) + "T12:00:00").toLocaleDateString(
          "en-IN",
          { day: "numeric", month: "short", year: "numeric" },
        )
      : "—";
  const human = (v) => String(v ?? "—").replaceAll("_", " ");
  const cleanName = (v) =>
    String(v || "—")
      .replace(/^DAI SYNTHETIC /, "DAI · ")
      .replace(/^Dr SYNTHETIC /, "Dr. ")
      .replace(/^SYNTHETIC /, "");
  const apiBase = (window.DAI_API_BASE || "/api") + "/hospital-admin";
  const iconPaths = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    facility: "M4 21V5h16v16 M9 21v-6h6v6 M8 9h2 M14 9h2",
    organisation:
      "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M5 22v-3a7 7 0 0 1 14 0v3 M3 8v5 M21 8v5",
    units:
      "M12 3v5 M4 12h16 M4 12v6 M12 8v10 M20 12v6 M1 18h6v4H1z M9 18h6v4H9z M17 18h6v4h-6z",
    beds: "M3 5v15 M3 15h18v5 M3 10h18v5 M7 10V7h4v3",
    critical: "M3 12h4l3-8 4 16 3-8h4",
    clinics: "M4 4h16v17H4z M8 2v4 M16 2v4 M4 10h16 M9 15h6 M12 12v6",
    resources: "M3 7h18v14H3z M8 7V3h8v4 M8 14h8 M12 10v8",
    staffing: "M5 3h14v19H5z M9 2v4h6V2 M8 11h8 M8 15h8 M8 19h5",
    census: "M4 3v18h17 M8 17v-5 M13 17V7 M18 17v-8",
    referrals: "M3 7h15l-4-4 M21 17H6l4 4 M18 7l-4 4 M6 17l4-4",
    patients: "M8 3h8v4H8z M6 5H4v17h16V5h-2 M8 12h8 M8 16h8",
    audit: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h4 M15 16l2 2 4-4",
  };
  const svg = (id) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[id] || iconPaths.facility}"/></svg>`;
  const views = {
    overview: [
      "Facility overview",
      "Your hospital at a glance. Capacity, services and the people responsible for care.",
    ],
    facility: [
      "Facility master",
      "The hospital’s identity, accreditation and emergency participation.",
    ],
    organisation: [
      "Organisation & roles",
      "Fictional office holders with clear ownership of governance and coordination.",
    ],
    units: [
      "Departments & units",
      "OPD days, wards, labour rooms and doctors connected in one unit structure.",
    ],
    beds: [
      "Wards & beds",
      "Inspect bed availability, reserve incoming high-risk capacity and follow bed-state history.",
    ],
    critical: [
      "Critical & neonatal care",
      "Separate capacity and admission records for maternal, neonatal and paediatric care.",
    ],
    clinics: [
      "Clinics & services",
      "Weekly clinics with a named room, time and responsible clinical unit.",
    ],
    resources: [
      "Resources",
      "Equipment, daily blood stock, investigations and ambulance availability.",
    ],
    staffing: [
      "Staffing & rosters",
      "Sanctioned and in-position posts, clinicians and shift coverage.",
    ],
    census: [
      "Daily census",
      "Recorded admissions, discharges, births, neonatal occupancy and referral movement.",
    ],
    referrals: [
      "Referrals & SOS",
      "Follow the referring facility, receiving team, transport estimate and care readiness.",
    ],
    patients: [
      "Mother & child registry",
      "A connected record from registered hospital to unit, doctor, ward, delivery and child.",
    ],
    audit: [
      "Administration history",
      "Changes to facility records and bed states, with a reason and accountable role.",
    ],
  };
  const admin = [
    "overview",
    "facility",
    "organisation",
    "units",
    "beds",
    "critical",
    "clinics",
    "resources",
    "staffing",
  ];
  const operations = ["census", "referrals", "patients", "audit"];
  let catalog,
    base,
    extra,
    currentHospital = localStorage.getItem("dai_admin_hospital"),
    currentView = "overview",
    requestId = 0,
    toastTimer;
  let bedFilters = { ward: "", status: "", q: "", page: 1 },
    patientFilters = { q: "", page: 1 },
    unitFilter = "obg",
    staffTab = "posts",
    resourceTab = "equipment",
    bloodDate = "";
  const badge = (text, color = "purple") =>
    `<span class="hs-badge hs-badge-${color}">${esc(text)}</span>`;
  const status = (v) =>
    badge(
      human(v),
      [
        "available",
        "functional",
        "alive",
        "responded",
        "done",
        "given",
      ].includes(v)
        ? "green"
        : ["maintenance", "under maintenance", "pending", "overdue"].includes(v)
          ? "amber"
          : [
                "non-functional",
                "rejected_unverified",
                "missed",
                "neonatal death",
              ].includes(v)
            ? "red"
            : "purple",
    );
  const empty = (text = "No records for this selection.", detail = "") =>
    `<div class="hs-empty"><strong>${esc(text)}</strong>${esc(detail)}</div>`;
  const table = (headers, rows, options = "") =>
    `<div class="hs-table-wrap"><table ${options}><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? "—"}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">${empty()}</td></tr>`}</tbody></table></div>`;
  const card = (title, subtitle, body, action = "") =>
    `<section class="hs-card"><div class="hs-card-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${action}</div>${body}</section>`;
  const metric = (label, value, detail, icon = "◈") =>
    `<div class="hs-card hs-metric"><span class="hs-metric-icon">${icon}</span><span class="hs-metric-label">${esc(label)}</span><strong>${value}</strong><small>${esc(detail)}</small></div>`;
  const kv = (entries) =>
    `<dl class="hs-key-value">${entries.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${value ?? "—"}</dd>`).join("")}</dl>`;
  const enabled = (value, on = "Available", off = "Not available") =>
    badge(value ? on : off, value ? "green" : "amber");
  const button = (label, action, attrs = "", primary = false) =>
    `<button class="hs-button ${primary ? "hs-button-primary" : ""}" data-action="${action}" ${attrs}>${label}</button>`;
  const initials = (name) =>
    cleanName(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("toast").classList.remove("is-visible"),
      3500,
    );
  }
  async function api(route, options = {}) {
    const response = await fetch(apiBase + route, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-hospital-role": $("currentRole").value,
        ...options.headers,
      },
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "The hospital API is not available on this server. Restart the local backend and refresh.",
      );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Unable to load hospital data.");
    return data;
  }
  function dialog(title, html, eyebrow = "HOSPITAL RECORD") {
    $("dialogTitle").textContent = title;
    $("dialogEyebrow").textContent = eyebrow;
    $("dialogContent").innerHTML = html;
    if (!$("detailDialog").open) $("detailDialog").showModal();
  }
  function nav() {
    $("hospitalNav").innerHTML =
      `<span class="hs-nav-caption">ADMINISTRATION</span>${admin.map((v) => `<a href="#${v}" data-view="${v}">${svg(v)}<span>${views[v][0]}</span></a>`).join("")}<span class="hs-nav-caption">CARE OPERATIONS</span>${operations.map((v) => `<a href="#${v}" data-view="${v}">${svg(v)}<span>${views[v][0]}</span></a>`).join("")}`;
  }
  function route() {
    const view = location.hash.slice(1) || "overview";
    currentView = views[view] ? view : "overview";
    $("pageTitle").textContent = views[currentView][0];
    $("pageDescription").textContent = views[currentView][1];
    $("breadcrumb").textContent =
      "Hospital / " +
      (admin.includes(currentView) ? "Administration" : "Operations");
    document.querySelectorAll("[data-view]").forEach((a) => {
      const selected = a.dataset.view === currentView;
      a.classList.toggle("is-active", selected);
      if (selected) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) =>
        b.classList.toggle(
          "is-active",
          (b.dataset.mode === "administration") === admin.includes(currentView),
        ),
      );
    $("hospitalSidebar").classList.remove("is-open");
    $("menuToggle").setAttribute("aria-expanded", "false");
    if (base) loadView();
  }
  async function refresh() {
    const token = ++requestId;
    $("hospitalView").setAttribute("aria-busy", "true");
    $("connectionStatus").textContent = "Refreshing hospital records…";
    try {
      catalog = await api("/catalog");
      if (token !== requestId) return;
      if (!catalog.hospitals.some((h) => h.hospital_id === currentHospital))
        currentHospital = catalog.hospitals[0].hospital_id;
      $("hospitalSelect").innerHTML = catalog.hospitals
        .map(
          (h) =>
            `<option value="${esc(h.hospital_id)}">${esc(cleanName(h.name))} · ${esc(h.state)}</option>`,
        )
        .join("");
      $("hospitalSelect").value = currentHospital;
      base = await api("/" + encodeURIComponent(currentHospital));
      if (token !== requestId) return;
      $("snapshotBadge").textContent =
        "Snapshot · " + fmt(base.as_of_date);
      const role = base.roles.find(
        (r) => r.role_name === "Medical Superintendent",
      );
      $("accountName").textContent = role
        ? cleanName(role.person_name)
        : "Hospital administrator";
      $("connectionStatus").classList.remove("is-error");
      $("connectionStatus").textContent =
        `Connected to DAI dataset · ${base.facility.hospital_id} · Snapshot ${fmt(base.as_of_date)} · All identities fictional`;
      await loadView();
    } catch (error) {
      showError(error);
    }
  }
  function showError(error) {
    $("connectionStatus").classList.add("is-error");
    $("connectionStatus").textContent = "Hospital records unavailable";
    $("hospitalView").innerHTML =
      `<div class="hs-error"><strong>We couldn’t load the hospital dataset.</strong><p>${esc(error.message)}</p>${button("Try again", "refresh")}</div>`;
    $("hospitalView").setAttribute("aria-busy", "false");
  }
  async function loadView() {
    const token = ++requestId,
      view = currentView,
      hid = currentHospital;
    $("hospitalView").setAttribute("aria-busy", "true");
    $("hospitalView").innerHTML =
      '<div class="hs-loading"><span></span>Loading hospital records…</div>';
    try {
      let params = new URLSearchParams();
      if (view === "beds")
        Object.entries(bedFilters).forEach(([k, v]) => {
          if (v) params.set(k, v);
        });
      if (view === "patients")
        Object.entries(patientFilters).forEach(([k, v]) => {
          if (v) params.set(k, v);
        });
      if (view === "resources" && bloodDate) params.set("date", bloodDate);
      extra = ["overview", "facility", "organisation"].includes(view)
        ? null
        : await api(
            "/" +
              encodeURIComponent(hid) +
              "/" +
              view +
              (params.size ? "?" + params : ""),
          );
      if (
        token !== requestId ||
        hid !== currentHospital ||
        view !== currentView
      )
        return;
      $("hospitalView").innerHTML = render(view);
      $("hospitalView").setAttribute("aria-busy", "false");
    } catch (error) {
      if (token === requestId) showError(error);
    }
  }
  function facilityBanner() {
    const f = base.facility;
    return `<div class="hs-summary-banner"><span class="hs-avatar">✚</span><div><h2>${esc(cleanName(f.name))}</h2><p>${esc(f.tier)} · ${esc(f.district)}, ${esc(f.state)} · ${esc(f.hospital_id)}</p></div><div class="hs-banner-tags">${enabled(f.emergency_24x7, "24×7 emergency", "Emergency limited")}${enabled(f.is_sos_participating, "SOS participating", "Outside SOS network")}${f.nabh_accredited ? badge("NABH · synthetic", "purple") : ""}</div></div>`;
  }
  function occupancyBar(w = base.metrics) {
    const total = w.authorized_beds || w.total_beds || 1,
      o = w.occupied_beds ?? w.occupied ?? 0,
      a = w.available_beds ?? w.available ?? 0,
      r = w.reserved_beds ?? w.reserved ?? 0,
      m = w.maintenance_beds ?? w.maintenance ?? 0;
    return `<div class="hs-progress" aria-label="${o} occupied, ${a} available, ${r} reserved, ${m} in maintenance"><span style="width:${(o / total) * 100}%;background:#ac8dce"></span><span style="width:${(a / total) * 100}%;background:#a7cdbb"></span><span style="width:${(r / total) * 100}%;background:#98b7d7"></span><span style="width:${(m / total) * 100}%;background:#dfc6a1"></span></div>`;
  }
  const legend = () =>
    '<div class="hs-legend"><span><i style="background:#ac8dce"></i>Occupied</span><span><i style="background:#a7cdbb"></i>Available</span><span><i style="background:#98b7d7"></i>Reserved</span><span><i style="background:#dfc6a1"></i>Maintenance</span></div>';
  function readinessHTML(r) {
    return `<div class="hs-readiness">${[
      [
        "Bed capacity",
        r.beds_available,
        "Available inpatient beds",
        r.beds_available > 0,
      ],
      [
        "Blood stock",
        r.blood_units,
        "Packed red-cell units",
        r.blood_units > 0,
      ],
      [
        "Doctor on call",
        r.doctor_on_call ? "On duty" : "No cover",
        "At the snapshot time",
        r.doctor_on_call,
      ],
      [
        "Theatre readiness",
        r.theatre_available + " / " + r.theatre_total,
        "Theatres free of recorded delivery use",
        r.theatre_available > 0,
      ],
    ]
      .map(
        ([label, value, detail, ok]) =>
          `<div class="hs-ready-item">${badge(ok ? "Ready" : "Check needed", ok ? "green" : "amber")}<span>${label}</span><strong>${esc(value)}</strong><small>${detail}</small></div>`,
      )
      .join("")}</div>`;
  }
  function censusChart(rows) {
    const max = Math.max(
      1,
      ...rows.flatMap((r) => [r.admissions, r.discharges]),
    );
    return `<div class="hs-chart" role="img" aria-label="Daily admissions and discharges for the past seven days">${rows.map((r) => `<div class="hs-chart-day"><strong>${n(r.admissions)} / ${n(r.discharges)}</strong><div class="hs-chart-bars"><i style="height:${Math.max(2, (r.admissions / max) * 100)}%" title="${r.date}: ${r.admissions} admissions"></i><i style="height:${Math.max(2, (r.discharges / max) * 100)}%" title="${r.date}: ${r.discharges} discharges"></i></div><small>${esc(fmt(r.date).split(" ").slice(0, 2).join(" "))}</small></div>`).join("")}</div><div class="hs-legend"><span><i style="background:#c1acd9"></i>Admissions</span><span><i style="background:#a5cdbd"></i>Discharges</span></div>`;
  }
  function overview() {
    const m = base.metrics,
      c = base.counts,
      rate = m.authorized_beds
        ? Math.round((m.occupied_beds / m.authorized_beds) * 100)
        : 0;
    return (
      facilityBanner() +
      `<div class="hs-grid hs-grid-4">${metric("Authorised beds", n(m.authorized_beds), "Whole-hospital sanctioned capacity", "▤")}${metric("Functional beds", n(m.functional_beds), "Excludes maintenance beds", "⊞")}${metric("Bed occupancy", rate + "<em>%</em>", n(m.occupied_beds) + " occupied · " + n(m.available_beds) + " available", "◌")}${metric("Clinical units", n(c.units), n(c.doctors) + " doctors · " + n(base.departments.length) + " departments", "⌘")}</div><div class="hs-split hs-section-gap"><div class="hs-stack">${card(
        "Bed capacity",
        "Every bed links to a ward and admission history",
        `<div class="hs-card-body">${occupancyBar()}${legend()}<div class="hs-grid hs-grid-4 hs-section-gap">${[
          ["Available", m.available_beds],
          ["Occupied", m.occupied_beds],
          ["Reserved", m.reserved_beds],
          ["Maintenance", m.maintenance_beds],
        ]
          .map(
            ([t, v]) =>
              `<div class="hs-mini-stat"><span>${t}</span><b>${n(v)}</b></div>`,
          )
          .join("")}</div></div>`,
        `<a class="hs-card-action" href="#beds">View bed board →</a>`,
      )}${card("Daily movement", "Admissions and discharges from the recorded inpatient history", `<div class="hs-card-body">${censusChart(base.census)}</div>`, `<a class="hs-card-action" href="#census">Daily census →</a>`)}</div><div class="hs-stack">${card(
        "Care continuity",
        "The hospital’s linked maternal and child cohort",
        `<div class="hs-card-body">${kv([
          [
            "Registered mothers",
            `<a href="#patients">${n(c.mothers)} records →</a>`,
          ],
          ["Recorded deliveries", n(c.deliveries)],
          ["Open maternal care gaps", n(c.care_gaps)],
          ["Incoming referrals", n(c.referrals_in)],
          ["Outgoing referrals", n(c.referrals_out)],
          ["NICU level", esc(base.facility.has_nicu_level)],
          ["Labour tables", n(base.readiness.labour_tables_total)],
        ])}</div>`,
      )}${card(
        "Facility leadership",
        "Leadership and responsibilities",
        `<div class="hs-card-body">${base.roles
          .slice(0, 3)
          .map(
            (r) =>
              `<div class="hs-mini-stat"><span>${esc(r.role_name)}</span><b>${esc(cleanName(r.person_name))}</b></div>`,
          )
          .join("")}</div>`,
        `<a class="hs-card-action" href="#organisation">All roles →</a>`,
      )}</div></div><div class="hs-section-heading"><div><h2>Referral readiness</h2><p>Capacity at ${esc(base.snapshot_at.slice(11, 16))} on ${fmt(base.as_of_date)}</p></div><a class="hs-card-action" href="#referrals">Referrals & SOS →</a></div>${readinessHTML(base.readiness)}`
    );
  }
  function facility() {
    const f = base.facility,
      m = base.metrics;
    return (
      facilityBanner() +
      `<div class="hs-split">${card(
        "Facility master",
        "Core identity and location",
        `<div class="hs-card-body">${kv([
          ["Hospital ID", esc(f.hospital_id)],
          ["Facility name", esc(f.name)],
          ["Tier", esc(f.tier)],
          ["Ownership", esc(f.ownership)],
          ["Address", esc(f.address)],
          ["District / state", esc(f.district + " / " + f.state)],
          ["Pincode", esc(f.pincode)],
          ["Coordinates", esc(f.latitude + ", " + f.longitude)],
          ["Authorised beds", n(f.authorized_beds)],
          ["Functional beds", n(m.functional_beds)],
          [
            "NABH",
            enabled(
              f.nabh_accredited,
              "Accredited (synthetic)",
              "Not accredited",
            ),
          ],
          [
            "NABL",
            badge(
              f.nabl_status,
              f.nabl_status.startsWith("Accredited") ? "green" : "amber",
            ),
          ],
          ["Emergency 24×7", enabled(f.emergency_24x7)],
          [
            "SOS participation",
            enabled(
              f.is_sos_participating,
              "Participating",
              "Not participating",
            ),
          ],
        ])}</div>`,
        $("currentRole").value === "admin"
          ? button("Edit facility", "edit-facility", "", true)
          : "",
      )}${card(
        "Departments",
        "Department IDs link staff, units and care areas",
        table(
          ["Department", "Department ID"],
          base.departments.map((d) => [
            `<strong>${esc(d.name)}</strong>`,
            esc(d.department_id),
          ]),
        ),
      )}</div><div class="hs-section-gap">${card("Configuration notes", "Synthetic structure and assumptions", `<div class="hs-card-body hs-description">${base.assumptions.map((a) => `<p style="margin-bottom:10px">${esc(a)}</p>`).join("")}</div>`)}</div>`
    );
  }
  function organisation() {
    return `<div class="hs-summary-banner"><div><h2>Organisation & clinical governance</h2><p>All office holders are fictional. Clinical staff and administrative positions remain separate linked records.</p></div>${badge(n(base.roles.length) + " assigned roles", "purple")}</div><div class="hs-grid hs-grid-3">${base.roles.map((r) => `<article class="hs-card hs-role-card"><span class="hs-avatar">${esc(initials(r.person_name))}</span><div><h3>${esc(r.role_name)}</h3><p>${esc(cleanName(r.person_name))}</p><small>${esc(r.role_id)}</small><small>${esc(r.email)}</small></div></article>`).join("")}</div>`;
  }
  function unitsView() {
    const rows = extra.units.filter((u) => u.department === unitFilter),
      docs = extra.doctors.filter((d) => d.department === unitFilter);
    return `<div class="hs-unit-strip"><button data-unit-dept="obg" class="${unitFilter === "obg" ? "is-active" : ""}">Obstetrics & gynaecology</button><button data-unit-dept="paediatrics" class="${unitFilter === "paediatrics" ? "is-active" : ""}">Paediatrics</button></div>${card(
      unitFilter === "obg" ? "OBG unit structure" : "Paediatric unit structure",
      "Fixed weekly duties and the physical care locations",
      table(
        unitFilter === "obg"
          ? [
              "Unit",
              "ANC OPD",
              "Gynae OPD",
              "ANC ward",
              "Gynae ward",
              "Labour room",
              "OT day",
              "Doctors",
            ]
          : ["Unit", "OPD day", "Ward", "OPD room", "Doctors"],
        rows.map((u) =>
          unitFilter === "obg"
            ? [
                `<strong>${u.code === "FP" ? "Family planning" : "Unit " + esc(u.code)}</strong>`,
                shortDay(u.anc_day),
                shortDay(u.gynae_day),
                button(
                  esc(u.anc_ward),
                  "ward-beds",
                  `data-ward="${esc(u.anc_ward_id)}"`,
                ),
                esc(u.gynae_ward),
                esc(u.labour_room),
                shortDay(u.ot_day),
                n(u.doctors),
              ]
            : [
                `<strong>Unit ${esc(u.code)}</strong>`,
                shortDay(u.opd_day),
                button(
                  esc(u.anc_ward),
                  "ward-beds",
                  `data-ward="${esc(u.anc_ward_id)}"`,
                ),
                esc(u.room),
                n(u.doctors),
              ],
        ),
      ),
    )}<div class="hs-section-gap">${card(
      "Assigned doctors",
      "The assigned clinician and the mother’s unit use the same relationship",
      table(
        ["Doctor", "Specialty", "Unit", "Designation", "Weekly OPD"],
        docs.map((d) => [
          `<strong>${esc(cleanName(d.name))}</strong><small>${esc(d.doctor_id)}</small>`,
          esc(d.specialty),
          badge("Unit " + d.unit_code),
          esc(d.designation),
          extra.schedules
            .filter(
              (s) => s.doctor_id === d.doctor_id && s.clinic_type !== "OT list",
            )
            .map((s) => `${shortDay(s.day)} · ${esc(s.clinic_type)}`)
            .join("<br>"),
        ]),
      ),
    )}</div>`;
  }
  function pager(data, scope) {
    const max = Math.max(1, Math.ceil(data.total / data.page_size));
    return `<div class="hs-pager"><span>${n(data.total)} records · page ${data.page} of ${max}</span><button class="hs-button" data-page="${data.page - 1}" data-scope="${scope}" ${data.page <= 1 ? "disabled" : ""}>← Previous</button><button class="hs-button" data-page="${data.page + 1}" data-scope="${scope}" ${data.page >= max ? "disabled" : ""}>Next →</button></div>`;
  }
  function bedsView() {
    const m = base.metrics;
    return `<div class="hs-grid hs-grid-4">${metric("Available beds", n(m.available_beds), "Ready for allocation", "⊞")}${metric("Occupied beds", n(m.occupied_beds), "Linked to active admissions", "▣")}${metric("Reserved beds", n(m.reserved_beds), "For an incoming high-risk case", "◇")}${metric("Maintenance", n(m.maintenance_beds), "Excluded from functional capacity", "⚒")}</div><div class="hs-section-heading"><div><h2>Bed board</h2><p>Choose a bed to inspect its record and state history.</p></div>${badge(n(extra.wards.length) + " wards")}</div><form class="hs-filterbar" id="bedFilterForm"><input class="hs-search" name="q" value="${esc(bedFilters.q)}" placeholder="Search bed ID or admitted mother…" aria-label="Search beds"><select name="ward" aria-label="Filter by ward"><option value="">All wards</option>${extra.wards.map((w) => `<option value="${esc(w.ward_id)}" ${bedFilters.ward === w.ward_id ? "selected" : ""}>${esc(w.label)} · ${n(w.total_beds)} beds</option>`).join("")}</select><select name="status" aria-label="Filter by bed status"><option value="">All bed states</option>${["available", "occupied", "reserved", "maintenance"].map((s) => `<option ${bedFilters.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button class="hs-button">Apply filters</button></form><div class="hs-card"><div class="hs-card-head"><div><h2>${esc(extra.wards.find((w) => w.ward_id === bedFilters.ward)?.label || "All wards")}</h2><p>O₂ = oxygen supported · M = monitor attached</p></div>${legend()}</div>${extra.beds.length ? `<div class="hs-bed-grid">${extra.beds.map((b) => `<button class="hs-bed" data-status="${esc(b.status)}" data-action="bed-detail" data-bed="${esc(b.bed_id)}" aria-label="${esc(b.bed_id)}, ${esc(b.ward)}, ${esc(b.status)}">${svg("beds")}<b>${esc(b.bed_id.split("-").pop())}</b><small>${esc(b.status)}</small><span class="hs-bed-features">${b.oxygen_supported ? "O₂" : ""} ${b.monitor_attached ? "· M" : ""}</span></button>`).join("")}</div>` : empty("No beds match your filters.")}${pager(extra, "beds")}</div><div class="hs-section-heading"><div><h2>Ward capacity</h2><p>One record per ward, with counts calculated from its beds.</p></div></div><div class="hs-ward-cards">${extra.wards.map((w) => `<article class="hs-card hs-ward-card"><h3>${esc(w.label)}</h3><p class="hs-subtle">${esc(w.care_area)}</p><div class="hs-mini-stat"><span>${n(w.occupied)} occupied</span><b>${n(w.total_beds)} beds</b></div>${occupancyBar(w)}<div class="hs-mini-stat"><span>${n(w.available)} available</span><span>${n(w.maintenance)} maintenance</span></div>${button("Open ward →", "ward-beds", `data-ward="${esc(w.ward_id)}"`)}</article>`).join("")}</div>`;
  }
  function criticalView() {
    return `<div class="hs-grid hs-grid-3">${extra.units.map((u) => `<section class="hs-card hs-critical-card"><div style="display:flex;justify-content:space-between;gap:10px"><h3>${esc(u.name)}</h3>${badge(u.category)}</div><div class="hs-critical-count">${n(u.occupied)} <small>/ ${n(u.capacity)} beds occupied</small></div><div class="hs-mini-stat"><span>${n(u.available)} beds available</span><b>${n(u.ventilators)} functional ventilators</b></div>${button("Inspect beds →", "ward-beds", `data-ward="${esc(u.ward_id)}"`)}</section>`).join("") || empty("No critical-care unit configured for this hospital.", "Select a higher-tier facility to inspect NICU, PICU and HDU capacity.")}</div><div class="hs-section-gap">${card(
      "Critical-care admission log",
      "Each admission is linked to an existing bed, ward and patient",
      table(
        [
          "Patient / child",
          "Care unit",
          "Bed",
          "Admitted",
          "Discharged / current",
          "Birth details",
        ],
        extra.admissions.map((a) => [
          `<strong>${esc(a.child_id ? cleanName(a.patient_name) + " · " + a.birth_label : cleanName(a.patient_name))}</strong><small>${esc(a.patient_id)}</small>`,
          esc(a.ward),
          esc(a.bed_id.split("-").pop()),
          fmt(a.admitted_at),
          a.discharged_at
            ? fmt(a.discharged_at)
            : badge("Currently admitted", "purple"),
          a.child_id ? `${n(a.birth_weight_g)} g` : "—",
        ]),
      ),
    )}</div>`;
  }
  const serviceNames = {
    c_section: "Caesarean section",
    blood_transfusion: "Blood transfusion",
    mtp: "MTP",
    labour_room_24x7: "24×7 labour room",
    neonatal_resuscitation: "Neonatal resuscitation",
    vaccination_centre: "Vaccination centre",
    obstetric_hdu: "Obstetric HDU",
  };
  const testNames = {
    Hb: "Haemoglobin",
    HIV: "HIV",
    HBsAg: "HBsAg",
    VDRL: "VDRL",
    urine: "Urine analysis",
    blood_group_Rh: "Blood group & Rh",
    thyroid: "Thyroid function",
    USG: "Ultrasound / USG",
    OGTT: "OGTT",
    double_marker: "Double marker",
    triple_marker: "Triple marker",
    NIPT: "NIPT",
  };
  function servicesHTML(s) {
    return `<div class="hs-service-grid">${Object.entries(serviceNames)
      .map(
        ([k, label]) =>
          `<span class="hs-service ${s[k] ? "" : "is-off"}">${s[k] ? "✓" : "–"} ${label}</span>`,
      )
      .join(
        "",
      )}<span class="hs-service">${esc(s.emergency_obstetric_care)}</span></div>`;
  }
  function clinicsView() {
    return (
      card(
        "Weekly special clinics",
        "Rooms, timings and in-charge units",
        table(
          ["Clinic", "Day", "Time", "Room", "In-charge unit"],
          extra.clinics.map((c) => [
            `<strong>${esc(c.name)}</strong>`,
            days[c.day],
            esc(c.start_time + "–" + c.end_time),
            esc(c.room),
            badge(
              (c.department === "obg" ? "OBG" : "Paediatrics") +
                " · " +
                (c.unit_code === "FP"
                  ? "Family planning"
                  : "Unit " + c.unit_code),
            ),
          ]),
        ),
      ) +
      `<div class="hs-section-gap">${card("Hospital services", "Capabilities linked to referral readiness and delivery records", `<div class="hs-card-body">${servicesHTML(extra.services)}</div>`)}</div>`
    );
  }
  function resourcesView() {
    let content = "";
    if (resourceTab === "equipment")
      content = card(
        "Equipment register",
        "Installed assets, functional status and service dates",
        table(
          [
            "Equipment",
            "Ward / location",
            "Installed",
            "Functional",
            "Status",
            "Last service",
          ],
          extra.equipment.map((e) => [
            `<strong>${esc(e.type)}</strong><small>${esc(e.equipment_id)}</small>`,
            esc(e.ward),
            n(e.installed_quantity),
            n(e.functional_quantity),
            status(e.status),
            fmt(e.last_service_date),
          ]),
        ),
      );
    if (resourceTab === "blood") {
      const components = [...new Set(extra.blood.map((b) => b.component))],
        groups = [...new Set(extra.blood.map((b) => b.blood_group))];
      content =
        `<div class="hs-filterbar"><label class="hs-subtle">Daily snapshot <select id="bloodDate" aria-label="Blood stock date">${extra.blood_dates.map((d) => `<option value="${d.date}" ${(bloodDate || base.as_of_date) === d.date ? "selected" : ""}>${fmt(d.date)}</option>`).join("")}</select></label>${badge(base.facility.has_blood_bank ? "Blood bank available" : "No blood bank", base.facility.has_blood_bank ? "green" : "amber")}</div>` +
        card(
          "Blood stock by group & component",
          "A daily stock snapshot; availability is not a promise of issue",
          table(
            ["Blood group", ...components],
            groups.map((g) => [
              `<strong>${esc(g)}</strong>`,
              ...components.map((c) =>
                n(
                  extra.blood.find(
                    (b) => b.blood_group === g && b.component === c,
                  )?.units_available,
                ),
              ),
            ]),
          ),
        );
    }
    if (resourceTab === "lab")
      content =
        card(
          "Laboratory & imaging",
          "Investigations available at this hospital",
          `<div class="hs-card-body"><div class="hs-service-grid">${JSON.parse(
            extra.services.diagnostic_tests,
          )
            .map(
              (t) =>
                `<span class="hs-service">✓ ${esc(testNames[t] || t)}</span>`,
            )
            .join("")}</div></div>`,
        ) +
        `<div class="hs-section-gap">${card("Service capabilities", "Capabilities used by the linked care records", `<div class="hs-card-body">${servicesHTML(extra.services)}</div>`)}</div>`;
    if (resourceTab === "ambulances")
      content = card(
        "Ambulance register",
        "Fictional vehicle labels, equipment and availability",
        table(
          [
            "Ambulance",
            "Type",
            "Status",
            "Oxygen",
            "Neonatal transport",
            "Last service",
          ],
          extra.ambulances.map((a) => [
            `<strong>${esc(a.vehicle_label)}</strong><small>${esc(a.ambulance_id)}</small>`,
            esc(a.type),
            status(a.status),
            a.oxygen_supported ? "Yes" : "No",
            a.neonatal_transport ? "Yes" : "No",
            fmt(a.last_service_date),
          ]),
        ),
      );
    return `<div class="hs-unit-strip">${[
      ["equipment", "Equipment"],
      ["blood", "Blood bank"],
      ["lab", "Lab & imaging"],
      ["ambulances", "Ambulances"],
    ]
      .map(
        ([id, label]) =>
          `<button data-resource-tab="${id}" class="${resourceTab === id ? "is-active" : ""}">${label}</button>`,
      )
      .join("")}</div>${content}`;
  }
  function staffingView() {
    const sanctioned = extra.posts.reduce((n, p) => n + p.sanctioned, 0),
      filled = extra.posts.reduce((n, p) => n + p.in_position, 0);
    let content;
    if (staffTab === "posts")
      content = card(
        "Staff establishment",
        "Sanctioned and in-position posts",
        table(
          ["Cadre", "Sanctioned", "In position", "Vacant", "Filled"],
          extra.posts.map((p) => [
            `<strong>${esc(p.cadre)}</strong>`,
            n(p.sanctioned),
            n(p.in_position),
            badge(n(p.sanctioned - p.in_position), "amber"),
            `${Math.round((p.in_position / p.sanctioned) * 100)}%`,
          ]),
        ),
      );
    if (staffTab === "doctors")
      content = card(
        "Doctor directory",
        "Doctors link to a department, clinical unit and weekly OPD",
        table(
          [
            "Doctor",
            "Department / specialty",
            "Unit",
            "Designation",
            "Qualification",
            "Experience",
          ],
          extra.doctors.map((d) => [
            `<strong>${esc(cleanName(d.name))}</strong><small>${esc(d.registration_number)}</small>`,
            esc(d.specialty),
            d.unit_code ? badge("Unit " + d.unit_code) : "—",
            esc(d.designation),
            esc(d.qualification),
            n(d.experience_years) + " years",
          ]),
        ),
      );
    if (staffTab === "rosters")
      content = card(
        "Shift & on-call roster",
        "Coverage on " + fmt(base.as_of_date),
        table(
          ["Staff member", "Cadre / duty", "Ward", "Shift", "Time"],
          extra.rosters.map((r) => [
            `<strong>${esc(cleanName(r.name))}</strong><small>${esc(r.role)}</small>`,
            esc(r.designation),
            esc(r.ward || "Hospital-wide"),
            badge(r.shift, r.doctor_id ? "purple" : "green"),
            esc(r.start_time + "–" + r.end_time),
          ]),
        ),
      );
    return `<div class="hs-grid hs-grid-3">${metric("Sanctioned posts", n(sanctioned), "Configured establishment", "▤")}${metric("In-position staff", n(filled), "Across all recorded cadres", "♧")}${metric("Vacant posts", n(sanctioned - filled), "Positions to review", "◇")}</div><div class="hs-unit-strip hs-section-gap">${[
      ["posts", "Establishment"],
      ["doctors", "Doctor directory"],
      ["rosters", "Shift & on-call roster"],
    ]
      .map(
        ([id, label]) =>
          `<button data-staff-tab="${id}" class="${staffTab === id ? "is-active" : ""}">${label}</button>`,
      )
      .join("")}</div>${content}`;
  }
  function censusView() {
    const rows = extra.days,
      today = rows.at(-1);
    return `<div class="hs-grid hs-grid-4">${metric("Admissions today", n(today.admissions), "Recorded inpatient admissions", "↘")}${metric("Discharges today", n(today.discharges), "Completed inpatient stays", "↗")}${metric("Deliveries today", n(today.deliveries), "All recorded modes of delivery", "◌")}${metric("NICU occupancy", n(today.nicu_occupancy), "At the snapshot time", "⊞")}</div><div class="hs-section-gap">${card(
      "Seven-day hospital census",
      "Each count is calculated from admissions, deliveries or referral records",
      table(
        [
          "Date",
          "Admissions",
          "Discharges",
          "Normal",
          "Assisted",
          "Elective LSCS",
          "Emergency LSCS",
          "NICU occupied",
          "Referrals in",
          "Referrals out",
        ],
        rows.map((r) => [
          `<strong>${fmt(r.date)}</strong>`,
          n(r.admissions),
          n(r.discharges),
          n(r.normal),
          n(r.assisted),
          n(r.elective_lscs),
          n(r.emergency_lscs),
          n(r.nicu_occupancy),
          n(r.referrals_in),
          n(r.referrals_out),
        ]),
      ),
    )}</div>`;
  }
  function referralsView() {
    return (
      readinessHTML(extra.readiness) +
      `<div class="hs-section-gap">${card(
        "Referral chain",
        "Recorded referring and receiving facilities; transport times are synthetic estimates",
        table(
          [
            "Mother / pregnancy",
            "From → to",
            "Reason",
            "Receiving doctor",
            "Transport",
            "Recorded",
          ],
          extra.referrals.map((r) => [
            `<strong>${esc(cleanName(r.mother))}</strong><small>${esc(r.pregnancy_id)}</small>`,
            `<strong>${esc(cleanName(r.from_hospital))}</strong><small>↓ ${esc(cleanName(r.to_hospital))}</small>`,
            esc(r.reason),
            esc(cleanName(r.receiving_doctor)),
            n(r.transport_time_min) + " min",
            fmt(r.referred_at),
          ]),
        ),
      )}</div><div class="hs-section-gap">${card(
        "SOS event log",
        "Nearest eligible facility, authentication result and recorded response",
        table(
          [
            "Subject",
            "Required capability",
            "Authentication",
            "Nearest facility distance",
            "Response",
            "Outcome",
            "Allocated bed",
          ],
          extra.sos.map((s) => [
            `<strong>${esc(cleanName(s.mother))}</strong><small>${esc(s.child_id || s.mother_id)}</small>`,
            esc(human(s.required_capability)),
            badge(
              s.second_auth_passed
                ? "Second check confirmed"
                : "Second check rejected",
              s.second_auth_passed ? "green" : "red",
            ),
            Number(s.distance_km).toFixed(1) + " km",
            s.response_time_min ? n(s.response_time_min) + " min" : "—",
            status(s.outcome),
            esc(s.bed_allocated || "None"),
          ]),
        ),
      )}</div>`
    );
  }
  function patientsView() {
    return `<form id="patientFilterForm" class="hs-filterbar"><input class="hs-search" name="q" value="${esc(patientFilters.q)}" placeholder="Search mother name or ID…" aria-label="Search mothers"><button class="hs-button">Search registry</button>${badge(n(extra.total) + " registered mothers")}</form>${card(
      "Registered mothers",
      "Open a record to trace the hospital → unit → doctor → ward → labour-room chain",
      table(
        [
          "Mother",
          "Stage",
          "Unit",
          "Ward / labour room",
          "Assigned doctor",
          "Children",
          "Care gaps",
        ],
        extra.patients.map((m) => [
          `<button class="hs-table-link" data-action="patient-detail" data-mother="${esc(m.mother_id)}">${esc(cleanName(m.name))}</button><small>${esc(m.mother_id)}</small>`,
          `${esc(m.current_stage)}${m.confirmed_high_risk ? "<br>" + badge("Clinician-confirmed high risk", "amber") : ""}`,
          badge("Unit " + m.unit_code),
          `${esc(m.ward)}<small>${esc(m.labour_room)}</small>`,
          esc(cleanName(m.doctor)),
          n(m.children),
          n(m.care_gaps),
        ]),
      ) + pager(extra, "patients"),
    )}`;
  }
  function auditView() {
    return card(
      "Administration audit history",
      "Facility and bed-state changes saved in this prototype",
      extra.audit.length
        ? table(
            ["When", "Entity", "Action", "Details", "Actor"],
            extra.audit.map((a) => [
              esc(new Date(a.created_at).toLocaleString("en-IN")),
              esc(a.entity_type),
              esc(human(a.action)),
              esc(a.detail),
              esc(a.actor),
            ]),
          )
        : empty(
            "No administration changes yet.",
            "Edit a facility record or change an available bed state to create an auditable entry.",
          ),
    );
  }
  function render(view) {
    return {
      overview,
      facility,
      organisation,
      units: unitsView,
      beds: bedsView,
      critical: criticalView,
      clinics: clinicsView,
      resources: resourcesView,
      staffing: staffingView,
      census: censusView,
      referrals: referralsView,
      patients: patientsView,
      audit: auditView,
    }[view]();
  }
  function editFacility() {
    const f = base.facility;
    dialog(
      "Edit facility master",
      `<form id="facilityForm" class="hs-form"><label class="hs-field">Facility name<input name="name" maxlength="180" required value="${esc(f.name)}"></label><label class="hs-field">Fictional address<textarea name="address" maxlength="500" required>${esc(f.address)}</textarea></label><label class="hs-field">NABL status<select name="nabl_status">${["Accredited (synthetic)", "Not accredited", "Application pending"].map((s) => `<option ${f.nabl_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${[
        ["nabh_accredited", "NABH accredited"],
        ["emergency_24x7", "24×7 emergency service"],
        ["is_sos_participating", "Participates in SOS network"],
      ]
        .map(
          ([id, label]) =>
            `<label class="hs-checkbox"><input name="${id}" type="checkbox" ${f[id] ? "checked" : ""}>${label}</label>`,
        )
        .join(
          "",
        )}<p class="hs-form-message" role="status"></p><div class="hs-form-actions"><button type="button" class="hs-button" data-action="close-dialog">Cancel</button><button class="hs-button hs-button-primary">Save facility</button></div></form>`,
      "FACILITY MASTER",
    );
  }
  async function bedDetail(id) {
    const b = extra.beds.find((b) => b.bed_id === id);
    if (!b) return;
    const data = await api(
      `/${currentHospital}/beds/${encodeURIComponent(id)}/history`,
    );
    const editable =
      $("currentRole").value === "admin" && b.status !== "occupied";
    dialog(
      "Bed " + id.split("-").pop(),
      `${kv([
        ["Bed ID", esc(b.bed_id)],
        ["Ward", esc(b.ward)],
        ["Bed type", esc(b.bed_type)],
        ["Current state", status(b.status)],
        [
          "Oxygen / monitor",
          `${b.oxygen_supported ? "Oxygen supported" : "No oxygen"} · ${b.monitor_attached ? "Monitor attached" : "No monitor"}`,
        ],
        [
          "Current patient",
          esc(
            b.patient_name
              ? cleanName(b.patient_name)
              : b.current_patient_id || "None",
          ),
        ],
        ["Reserved for", esc(b.reserved_for_mother_id || "None")],
      ])}${editable ? `<div class="hs-section-heading"><h3>Update bed state</h3></div><form id="bedStateForm" data-bed="${esc(b.bed_id)}" data-expected="${esc(b.status)}" class="hs-form"><div class="hs-form-grid"><label class="hs-field">State<select name="status" id="bedStateSelect">${["available", "maintenance", "reserved"].map((s) => `<option ${b.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="hs-field" id="reserveMotherField" ${b.status === "reserved" ? "" : "hidden"}>Incoming high-risk mother<select name="mother_id"><option value="">Choose a linked case</option>${extra.incoming.map((m) => `<option value="${esc(m.mother_id)}" ${m.mother_id === b.reserved_for_mother_id ? "selected" : ""}>${esc(cleanName(m.name))} · ${esc(m.mother_id)}</option>`).join("")}</select></label></div><label class="hs-field">Reason<textarea name="reason" minlength="5" maxlength="500" required placeholder="Record the reason for this change…">${esc(b.reservation_reason || "")}</textarea></label><p class="hs-form-message" role="status"></p><div class="hs-form-actions"><button class="hs-button hs-button-primary">Save bed state</button></div></form>` : b.status === "occupied" ? '<p class="hs-description hs-section-gap">This bed is linked to an active admission. A clinical discharge must be recorded before changing its availability.</p>' : ""}<div class="hs-section-heading"><h3>Bed-state history</h3></div><ul class="hs-timeline">${data.history.map((h) => `<li><strong>${esc(human(h.status))}</strong><small>${esc(h.effective_at.replace("T", " · "))} · ${esc(h.actor)}</small><p>${esc(h.reason)}</p>${h.patient_id ? `<small>${esc(h.patient_id)}</small>` : ""}</li>`).join("")}</ul>`,
      "WARD · " + b.ward,
    );
  }
  async function patientDetail(id) {
    const d = await api(
        `/${currentHospital}/patients/${encodeURIComponent(id)}`,
      ),
      a = d.assignment,
      p = d.pregnancy;
    dialog(
      cleanName(d.mother.name),
      `<div class="hs-chain">${[
        ["Hospital", cleanName(base.facility.name)],
        ["Clinical unit", "OBG · " + a.unit_code],
        ["Assigned doctor", cleanName(a.doctor)],
        ["ANC ward", a.ward],
        ["Labour room", a.labour_room],
      ]
        .map(([k, v]) => `<div><small>${esc(k)}</small>${esc(v)}</div>`)
        .join("")}</div>${kv([
        ["Mother ID", esc(id)],
        ["Pregnancy ID", esc(p.pregnancy_id)],
        ["Stage", esc(p.current_stage)],
        ["Gestational age", n(p.current_gestational_week) + " weeks"],
        ["Plurality", esc(p.plurality)],
        ["LMP / EDD", fmt(p.lmp) + " / " + fmt(p.edd)],
        ["Language", esc(d.mother.preferred_language)],
        ["Registered district", esc(d.mother.district)],
        [
          "Risk validation",
          p.confirmed_high_risk
            ? badge("Clinician-confirmed high risk", "amber")
            : badge("No confirmed high-risk status", "green"),
        ],
      ])}<div class="hs-section-heading"><h3>Delivery & labour allocation</h3></div>${
        d.delivery.length
          ? table(
              ["Delivery", "Mode", "Unit / labour room", "Bed", "Recorded at"],
              d.delivery.map((v) => [
                esc(v.delivery_id),
                esc(v.mode),
                `Unit ${esc(v.unit_code)} · ${esc(v.labour_room)}<small>${esc(v.labour_table_id)}</small>`,
                esc(v.bed_id),
                esc(v.delivered_at.replace("T", " ")),
              ]),
            )
          : empty("No delivery recorded.")
      }<div class="hs-section-heading"><h3>Linked children</h3></div>${
        d.children.length
          ? table(
              ["Child", "DOB", "Birth weight", "Care", "Outcome"],
              d.children.map((c) => [
                `<strong>${esc(c.birth_label)}</strong><small>${esc(c.child_id)}</small>`,
                fmt(c.date_of_birth),
                n(c.birth_weight_g) + " g",
                c.nicu_admission
                  ? badge("NICU admission", "purple")
                  : badge("Routine newborn care", "green"),
                status(c.outcome),
              ]),
            )
          : empty("No live-born child records for this pregnancy.")
      }<div class="hs-section-heading"><h3>Expected vs recorded care</h3></div>${
        d.gaps.length
          ? table(
              ["Expected item", "Due", "Gap", "State"],
              d.gaps.map((g) => [
                esc(g.expected_item),
                fmt(g.due_date),
                esc(g.gap_type),
                status(g.status),
              ]),
            )
          : empty("No care gaps recorded.")
      }`,
      "CONNECTED MATERNAL RECORD",
    );
  }
  document.addEventListener("click", async (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.dataset.mode) {
      location.hash =
        btn.dataset.mode === "administration" ? "overview" : "census";
      return;
    }
    if (btn.dataset.unitDept) {
      unitFilter = btn.dataset.unitDept;
      $("hospitalView").innerHTML = render(currentView);
      return;
    }
    if (btn.dataset.resourceTab) {
      resourceTab = btn.dataset.resourceTab;
      $("hospitalView").innerHTML = render(currentView);
      return;
    }
    if (btn.dataset.staffTab) {
      staffTab = btn.dataset.staffTab;
      $("hospitalView").innerHTML = render(currentView);
      return;
    }
    if (btn.dataset.page) {
      const target = btn.dataset.scope === "beds" ? bedFilters : patientFilters;
      target.page = Number(btn.dataset.page);
      loadView();
      return;
    }
    try {
      if (btn.dataset.action === "refresh") await refresh();
      if (btn.dataset.action === "edit-facility") editFacility();
      if (btn.dataset.action === "close-dialog") $("detailDialog").close();
      if (btn.dataset.action === "ward-beds") {
        bedFilters = { ward: btn.dataset.ward, status: "", q: "", page: 1 };
        if (currentView === "beds") loadView();
        else location.hash = "beds";
      }
      if (btn.dataset.action === "bed-detail") await bedDetail(btn.dataset.bed);
      if (btn.dataset.action === "patient-detail")
        await patientDetail(btn.dataset.mother);
    } catch (error) {
      toast(error.message);
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "bedStateSelect")
      $("reserveMotherField").hidden = event.target.value !== "reserved";
    if (event.target.id === "bloodDate") {
      bloodDate = event.target.value;
      loadView();
    }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (
      ![
        "bedFilterForm",
        "patientFilterForm",
        "bedStateForm",
        "facilityForm",
      ].includes(form.id)
    )
      return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.id === "bedFilterForm") {
      bedFilters = { ...values, page: 1 };
      return loadView();
    }
    if (form.id === "patientFilterForm") {
      patientFilters = { ...values, page: 1 };
      return loadView();
    }
    const submit = form.querySelector(
      'button[type="submit"],button:not([type])',
    );
    if (submit) submit.disabled = true;
    try {
      if (form.id === "facilityForm") {
        for (const k of [
          "nabh_accredited",
          "emergency_24x7",
          "is_sos_participating",
        ])
          values[k] = Boolean(form.elements[k].checked);
        await api("/" + currentHospital + "/facility", {
          method: "PATCH",
          body: JSON.stringify(values),
        });
      } else
        await api(
          `/${currentHospital}/beds/${encodeURIComponent(form.dataset.bed)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...values,
              expected_status: form.dataset.expected,
            }),
          },
        );
      $("detailDialog").close();
      await refresh();
      toast(
        form.id === "facilityForm"
          ? "Facility changes saved."
          : "Bed state and history saved.",
      );
    } catch (error) {
      form.querySelector(".hs-form-message").textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  $("hospitalSelect").addEventListener("change", () => {
    currentHospital = $("hospitalSelect").value;
    localStorage.setItem("dai_admin_hospital", currentHospital);
    bedFilters = { ward: "", status: "", q: "", page: 1 };
    patientFilters = { q: "", page: 1 };
    refresh();
  });
  $("currentRole").addEventListener("change", () => {
    if (base && $("hospitalView").getAttribute("aria-busy") !== "true")
      $("hospitalView").innerHTML = render(currentView);
  });
  $("refreshHospital").addEventListener("click", refresh);
  $("menuToggle").addEventListener("click", () => {
    const open = $("hospitalSidebar").classList.toggle("is-open");
    $("menuToggle").setAttribute("aria-expanded", String(open));
  });
  $("detailDialog").addEventListener("click", (event) => {
    if (event.target === $("detailDialog")) $("detailDialog").close();
  });
  window.addEventListener("hashchange", route);
  nav();
  route();
  refresh();
})();
