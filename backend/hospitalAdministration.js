"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const DEFAULT_DB = path.join(__dirname, "data", "dai-hospital.db");

function registerHospitalAdministration(app, options = {}) {
  const file = options.dbPath || process.env.DAI_HOSPITAL_DB || DEFAULT_DB;
  let database;
  function db() {
    if (database) return database;
    if (
      !fs.existsSync(file) &&
      !options.dbPath &&
      !process.env.DAI_HOSPITAL_DB
    ) {
      const builder = path.join(
        __dirname,
        "..",
        "synthetic_data",
        "build_hospital_admin.py",
      );
      execFileSync(process.env.PYTHON_BIN || "python3", [builder], {
        timeout: 120000,
        stdio: "pipe",
      });
    }
    database = new DatabaseSync(file);
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    return database;
  }
  const all = (sql, ...args) =>
    db()
      .prepare(sql)
      .all(...args);
  const one = (sql, ...args) =>
    db()
      .prepare(sql)
      .get(...args);
  const meta = (key) =>
    one("SELECT value FROM hospital_metadata WHERE key=?", key)?.value;
  const state = "COALESCE(s.status,b.status)";
  const wardJoin =
    "beds b JOIN wards w USING(ward_id) JOIN ward_labels l USING(ward_id) LEFT JOIN hospital_bed_states s USING(bed_id)";
  function wards(hid) {
    return all(
      `SELECT w.*,l.label,l.care_area,count(b.bed_id) total_beds,
      sum(${state}='available') available,sum(${state}='occupied') occupied,
      sum(${state}='maintenance') maintenance,sum(${state}='reserved') reserved,
      sum(b.oxygen_supported) oxygen_beds,sum(b.monitor_attached) monitored_beds
      FROM ${wardJoin} WHERE w.hospital_id=? GROUP BY w.ward_id ORDER BY l.care_area,l.label`,
      hid,
    );
  }
  function metrics(hid) {
    return one(
      `SELECT count(*) authorized_beds,sum(${state}<>'maintenance') functional_beds,
      sum(${state}='occupied') occupied_beds,sum(${state}='available') available_beds,
      sum(${state}='maintenance') maintenance_beds,sum(${state}='reserved') reserved_beds
      FROM ${wardJoin} WHERE w.hospital_id=?`,
      hid,
    );
  }
  function readiness(hid) {
    const snapshot = meta("snapshot_at"),
      today = meta("as_of_date");
    const date = new Date(today + "T00:00:00Z"),
      weekday = (date.getUTCDay() + 6) % 7;
    const facility = one("SELECT * FROM hospitals WHERE hospital_id=?", hid);
    const beds = metrics(hid);
    const neonatal = one(
      `SELECT count(*) total,sum(${state}='available') available FROM ${wardJoin} WHERE w.hospital_id=? AND w.ward_type='NICU'`,
      hid,
    );
    const onCall = all(
      `SELECT r.*,d.name,d.specialty FROM shift_rosters r JOIN doctors d USING(doctor_id)
      WHERE r.hospital_id=? AND r.roster_date=? AND r.start_time<=? AND r.end_time>?`,
      hid,
      today,
      snapshot.slice(11, 16),
      snapshot.slice(11, 16),
    );
    const blood = one(
      "SELECT coalesce(sum(units_available),0) units FROM blood_stock_snapshots WHERE hospital_id=? AND snapshot_date=? AND component=?",
      hid,
      today,
      "Packed red cells",
    );
    const activeOT = one(
      `SELECT count(*) n FROM delivery_records d JOIN delivery_allocations a USING(delivery_id)
      WHERE d.hospital_id=? AND d.mode LIKE '%LSCS' AND a.started_at<=? AND a.ended_at>?`,
      hid,
      snapshot,
      snapshot,
    ).n;
    const activeLabour = one(
      `SELECT count(*) n FROM delivery_allocations a JOIN labour_tables t ON t.table_id=a.labour_table_id WHERE t.hospital_id=? AND a.started_at<=? AND a.ended_at>?`,
      hid,
      snapshot,
      snapshot,
    ).n;
    return {
      snapshot_at: snapshot,
      weekday,
      beds_available: beds.available_beds,
      nicu_available: neonatal.available || 0,
      blood_units: blood.units,
      doctor_on_call: onCall.length > 0,
      on_call: onCall,
      theatre_available: Math.max(0, facility.ot_count - activeOT),
      theatre_total: facility.ot_count,
      labour_tables_available: Math.max(
        0,
        facility.labour_table_count - activeLabour,
      ),
      labour_tables_total: facility.labour_table_count,
    };
  }
  function units(hid) {
    return all(
      `SELECT u.*,a.label anc_ward,g.label gynae_ward,l.label labour_room,
      (SELECT count(*) FROM doctor_units du WHERE du.unit_id=u.unit_id) doctors,
      (SELECT count(*) FROM mother_unit_assignments m WHERE m.unit_id=u.unit_id) mothers
      FROM clinical_units u LEFT JOIN ward_labels a ON a.ward_id=u.anc_ward_id
      LEFT JOIN ward_labels g ON g.ward_id=u.gynae_ward_id LEFT JOIN ward_labels l ON l.ward_id=u.labour_room_id
      WHERE u.hospital_id=? ORDER BY u.department,CASE u.code WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3 WHEN 'IV' THEN 4 WHEN 'V' THEN 5 WHEN 'VI' THEN 6 ELSE 7 END`,
      hid,
    );
  }
  function census(hid) {
    const today = meta("as_of_date"),
      result = [];
    for (let ago = 6; ago >= 0; ago--) {
      const date = new Date(today + "T00:00:00Z");
      date.setUTCDate(date.getUTCDate() - ago);
      const day = date.toISOString().slice(0, 10),
        at = ago === 0 ? meta("snapshot_at") : day + "T23:59:59";
      result.push({
        date: day,
        ...one(
          `SELECT
        (SELECT count(*) FROM admissions WHERE hospital_id=? AND substr(admitted_at,1,10)=?) admissions,
        (SELECT count(*) FROM admissions WHERE hospital_id=? AND substr(discharged_at,1,10)=?) discharges,
        (SELECT count(*) FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=?) deliveries,
        (SELECT count(*) FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=? AND mode='normal') normal,
        (SELECT count(*) FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=? AND mode='assisted') assisted,
        (SELECT count(*) FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=? AND mode='elective LSCS') elective_lscs,
        (SELECT count(*) FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=? AND mode='emergency LSCS') emergency_lscs,
        (SELECT count(*) FROM admissions a JOIN wards w USING(ward_id) WHERE a.hospital_id=? AND w.ward_type='NICU' AND a.admitted_at<=? AND (a.discharged_at IS NULL OR a.discharged_at>?)) nicu_occupancy,
        (SELECT count(*) FROM referrals WHERE referred_to_hospital_id=? AND substr(referred_at,1,10)=?) referrals_in,
        (SELECT count(*) FROM referrals WHERE referred_from_hospital_id=? AND substr(referred_at,1,10)=?) referrals_out`,
          hid,
          day,
          hid,
          day,
          hid,
          day,
          hid,
          day,
          hid,
          day,
          hid,
          day,
          hid,
          day,
          hid,
          at,
          at,
          hid,
          day,
          hid,
          day,
        ),
      });
    }
    return result;
  }
  const route = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      console.error("Hospital administration:", error.message);
      res
        .status(503)
        .json({
          error:
            "Hospital dataset unavailable. Run npm run hospital:seed in backend, then refresh.",
        });
    }
  };
  app.get(
    "/api/hospital-admin/catalog",
    route((req, res) => {
      res.json({
        synthetic: true,
        as_of_date: meta("as_of_date"),
        hospitals: all(
          `SELECT h.*,(SELECT count(*) FROM mothers m WHERE m.registered_hospital_id=h.hospital_id) mothers FROM hospitals h ORDER BY hospital_id`,
        ),
      });
    }),
  );
  app.get(
    "/api/hospital-admin/:hospitalId",
    route((req, res) => {
      const hid = req.params.hospitalId;
      const facility = one(
        "SELECT h.*,p.* FROM hospitals h JOIN facility_profiles p USING(hospital_id) WHERE h.hospital_id=?",
        hid,
      );
      if (!facility)
        return res.status(404).json({ error: "Hospital not found" });
      const departments = all(
        "SELECT * FROM departments WHERE hospital_id=? ORDER BY name",
        hid,
      );
      const counts = one(
        `SELECT
      (SELECT count(*) FROM mothers WHERE registered_hospital_id=?) mothers,
      (SELECT count(*) FROM doctors WHERE hospital_id=?) doctors,
      (SELECT count(*) FROM clinical_units WHERE hospital_id=? AND code<>'FP') units,
      (SELECT count(*) FROM care_gaps g JOIN mothers m ON m.mother_id=g.subject_id WHERE m.registered_hospital_id=? AND g.status='open') care_gaps,
      (SELECT count(*) FROM referrals WHERE referred_to_hospital_id=?) referrals_in,
      (SELECT count(*) FROM referrals WHERE referred_from_hospital_id=?) referrals_out,
      (SELECT count(*) FROM delivery_records WHERE hospital_id=?) deliveries`,
        hid,
        hid,
        hid,
        hid,
        hid,
        hid,
        hid,
      );
      res.json({
        synthetic: true,
        as_of_date: meta("as_of_date"),
        snapshot_at: meta("snapshot_at"),
        facility,
        departments,
        metrics: metrics(hid),
        counts,
        readiness: readiness(hid),
        wards: wards(hid),
        units: units(hid),
        assumptions: JSON.parse(meta("assumptions")),
        roles: all(
          "SELECT * FROM administration_roles WHERE hospital_id=?",
          hid,
        ),
        census: census(hid),
      });
    }),
  );
  app.get(
    "/api/hospital-admin/:hospitalId/:view",
    route((req, res) => {
      const hid = req.params.hospitalId,
        view = req.params.view,
        today = meta("as_of_date");
      if (!one("SELECT hospital_id FROM hospitals WHERE hospital_id=?", hid))
        return res.status(404).json({ error: "Hospital not found" });
      const doctorRows = () =>
        all(
          `SELECT d.*,u.code unit_code,u.department,du.unit_id FROM doctors d LEFT JOIN doctor_units du USING(doctor_id) LEFT JOIN clinical_units u USING(unit_id) WHERE d.hospital_id=? ORDER BY u.department,u.code,d.name`,
          hid,
        );
      if (view === "units")
        return res.json({
          units: units(hid),
          doctors: doctorRows(),
          schedules: all(
            "SELECT s.*,d.name,u.code unit_code,u.department FROM doctor_schedules s JOIN doctors d USING(doctor_id) LEFT JOIN doctor_units du USING(doctor_id) LEFT JOIN clinical_units u USING(unit_id) WHERE d.hospital_id=? ORDER BY s.day,s.start_time",
            hid,
          ),
        });
      if (view === "clinics")
        return res.json({
          clinics: all(
            "SELECT c.*,u.code unit_code,u.department FROM special_clinics c JOIN clinical_units u USING(unit_id) WHERE c.hospital_id=? ORDER BY c.day,c.start_time",
            hid,
          ),
          services: one(
            "SELECT * FROM hospital_services WHERE hospital_id=?",
            hid,
          ),
        });
      if (view === "resources") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
          ? req.query.date
          : today;
        return res.json({
          equipment: all(
            "SELECT e.*,l.label ward FROM equipment e JOIN ward_labels l USING(ward_id) WHERE e.hospital_id=? ORDER BY e.type,l.label",
            hid,
          ),
          blood: all(
            "SELECT * FROM blood_stock_snapshots WHERE hospital_id=? AND snapshot_date=? ORDER BY blood_group,component",
            hid,
            date,
          ),
          blood_dates: all(
            "SELECT DISTINCT snapshot_date date FROM blood_stock_snapshots WHERE hospital_id=? ORDER BY date DESC",
            hid,
          ),
          ambulances: all("SELECT * FROM ambulances WHERE hospital_id=?", hid),
          services: one(
            "SELECT * FROM hospital_services WHERE hospital_id=?",
            hid,
          ),
        });
      }
      if (view === "staffing") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
          ? req.query.date
          : today;
        return res.json({
          posts: all(
            "SELECT * FROM staffing_establishment WHERE hospital_id=?",
            hid,
          ),
          doctors: doctorRows(),
          rosters: all(
            `SELECT r.*,coalesce(d.name,n.name) name,coalesce(d.specialty,n.designation) designation,l.label ward FROM shift_rosters r LEFT JOIN doctors d USING(doctor_id) LEFT JOIN nurses_midwives n USING(staff_id) LEFT JOIN ward_labels l USING(ward_id) WHERE r.hospital_id=? AND r.roster_date=? ORDER BY r.start_time,r.role`,
            hid,
            date,
          ),
        });
      }
      if (view === "critical")
        return res.json({
          units: all(
            `SELECT c.*,w.capacity,
      (SELECT count(*) FROM beds b JOIN hospital_bed_states s USING(bed_id) WHERE b.ward_id=c.ward_id AND s.status='occupied') occupied,
      (SELECT count(*) FROM beds b JOIN hospital_bed_states s USING(bed_id) WHERE b.ward_id=c.ward_id AND s.status='available') available,
      (SELECT coalesce(sum(e.functional_quantity),0) FROM equipment e WHERE e.ward_id=c.ward_id AND e.type='ventilator') ventilators
      FROM critical_care_units c JOIN wards w USING(ward_id) WHERE c.hospital_id=? ORDER BY c.category,c.name`,
            hid,
          ),
          admissions: all(
            `SELECT a.*,l.label ward,coalesce(m.name,'SYNTHETIC background inpatient') patient_name,c.child_id,c.birth_label,c.birth_weight_g
      FROM admissions a JOIN critical_care_units cc USING(ward_id) JOIN ward_labels l USING(ward_id)
      LEFT JOIN newborns c ON c.child_id=a.patient_id LEFT JOIN mothers m ON m.mother_id=coalesce(c.mother_id,a.patient_id)
      WHERE a.hospital_id=? ORDER BY (c.child_id IS NOT NULL) DESC,a.admitted_at DESC LIMIT 60`,
            hid,
          ),
        });
      if (view === "beds") {
        const filter = ["w.hospital_id=?"],
          args = [hid];
        if (req.query.ward) {
          filter.push("b.ward_id=?");
          args.push(req.query.ward);
        }
        if (
          ["available", "occupied", "maintenance", "reserved"].includes(
            req.query.status,
          )
        ) {
          filter.push(state + "=?");
          args.push(req.query.status);
        }
        if (req.query.q) {
          filter.push(
            "(b.bed_id LIKE ? OR coalesce(m.name,'') LIKE ? OR coalesce(s.reserved_for_mother_id,'') LIKE ?)",
          );
          args.push(
            "%" + String(req.query.q).slice(0, 100) + "%",
            "%" + String(req.query.q).slice(0, 100) + "%",
            "%" + String(req.query.q).slice(0, 100) + "%",
          );
        }
        const join = `${wardJoin} LEFT JOIN mothers m ON m.mother_id=b.current_patient_id`;
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1),
          limit = 60;
        const total = one(
          `SELECT count(*) n FROM ${join} WHERE ${filter.join(" AND ")}`,
          ...args,
        ).n;
        return res.json({
          page,
          total,
          page_size: limit,
          wards: wards(hid),
          beds: all(
            `SELECT b.*,l.label ward,l.care_area,${state} status,m.name patient_name,s.reserved_for_mother_id,s.reservation_reason FROM ${join} WHERE ${filter.join(" AND ")} ORDER BY l.label,b.bed_id LIMIT ? OFFSET ?`,
            ...args,
            limit,
            (page - 1) * limit,
          ),
          incoming: all(
            `SELECT DISTINCT m.mother_id,m.name,p.pregnancy_id,u.code unit_code FROM mothers m JOIN pregnancies p USING(mother_id) JOIN mother_unit_assignments mu USING(mother_id) JOIN clinical_units u ON u.unit_id=mu.unit_id WHERE p.confirmed_high_risk=1 AND p.outcome='ongoing' AND (m.registered_hospital_id=? OR EXISTS(SELECT 1 FROM referrals r WHERE r.pregnancy_id=p.pregnancy_id AND r.referred_to_hospital_id=?)) LIMIT 100`,
            hid,
            hid,
          ),
        });
      }
      if (view === "patients") {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1),
          q = "%" + String(req.query.q || "").slice(0, 100) + "%",
          args = [hid, q, q];
        const total = one(
          "SELECT count(*) n FROM mothers WHERE registered_hospital_id=? AND (name LIKE ? OR mother_id LIKE ?)",
          ...args,
        ).n;
        return res.json({
          page,
          total,
          page_size: 25,
          patients: all(
            `SELECT m.*,p.pregnancy_id,p.current_stage,p.current_gestational_week,p.plurality,p.confirmed_high_risk,u.code unit_code,wl.label ward,lr.label labour_room,d.name doctor,
        (SELECT count(*) FROM newborns c WHERE c.mother_id=m.mother_id) children,
        (SELECT count(*) FROM care_gaps g WHERE g.subject_id=m.mother_id AND g.status='open') care_gaps
        FROM mothers m JOIN pregnancies p USING(mother_id) JOIN mother_unit_assignments mu USING(mother_id) JOIN clinical_units u ON u.unit_id=mu.unit_id
        JOIN ward_labels wl ON wl.ward_id=mu.ward_id LEFT JOIN ward_labels lr ON lr.ward_id=mu.labour_room_id JOIN doctors d ON d.doctor_id=mu.assigned_doctor_id
        WHERE m.registered_hospital_id=? AND (m.name LIKE ? OR m.mother_id LIKE ?) ORDER BY m.name LIMIT 25 OFFSET ?`,
            ...args,
            (page - 1) * 25,
          ),
        });
      }
      if (view === "referrals")
        return res.json({
          readiness: readiness(hid),
          referrals: all(
            `SELECT r.*,a.name from_hospital,b.name to_hospital,m.name mother,m.mother_id,p.current_stage,p.outcome,d.name receiving_doctor
      FROM referrals r JOIN hospitals a ON a.hospital_id=r.referred_from_hospital_id JOIN hospitals b ON b.hospital_id=r.referred_to_hospital_id JOIN pregnancies p USING(pregnancy_id) JOIN mothers m USING(mother_id) JOIN doctors d ON d.doctor_id=r.receiving_doctor_id
      WHERE r.referred_from_hospital_id=? OR r.referred_to_hospital_id=? ORDER BY r.referred_at DESC LIMIT 100`,
            hid,
            hid,
          ),
          sos: all(
            `SELECT e.*,coalesce(m.name,cm.name) mother,c.birth_label FROM emergency_events e LEFT JOIN mothers m ON m.mother_id=e.mother_id LEFT JOIN newborns c ON c.child_id=e.child_id LEFT JOIN mothers cm ON cm.mother_id=c.mother_id WHERE e.nearest_hospital_id=? ORDER BY triggered_at DESC`,
            hid,
          ),
        });
      if (view === "census")
        return res.json({ days: census(hid), metrics: metrics(hid) });
      if (view === "audit")
        return res.json({
          audit: all(
            "SELECT * FROM administration_audit WHERE hospital_id=? ORDER BY audit_id DESC LIMIT 100",
            hid,
          ),
        });
      res.status(404).json({ error: "Unknown hospital view" });
    }),
  );
  app.get(
    "/api/hospital-admin/:hospitalId/beds/:bedId/history",
    route((req, res) => {
      const bed = one(
        "SELECT b.*,l.label ward,w.hospital_id FROM beds b JOIN wards w USING(ward_id) JOIN ward_labels l USING(ward_id) WHERE b.bed_id=? AND w.hospital_id=?",
        req.params.bedId,
        req.params.hospitalId,
      );
      if (!bed) return res.status(404).json({ error: "Bed not found" });
      res.json({
        bed,
        history: all(
          "SELECT * FROM bed_state_history WHERE bed_id=? ORDER BY effective_at DESC,history_id DESC LIMIT 40",
          bed.bed_id,
        ),
      });
    }),
  );
  app.get(
    "/api/hospital-admin/:hospitalId/patients/:motherId",
    route((req, res) => {
      const m = one(
        "SELECT * FROM mothers WHERE mother_id=? AND registered_hospital_id=?",
        req.params.motherId,
        req.params.hospitalId,
      );
      if (!m)
        return res
          .status(404)
          .json({ error: "Mother not found in this hospital" });
      res.json({
        mother: m,
        assignment: one(
          `SELECT a.*,u.code unit_code,l.label ward,lr.label labour_room,d.name doctor FROM mother_unit_assignments a JOIN clinical_units u USING(unit_id) JOIN ward_labels l ON l.ward_id=a.ward_id LEFT JOIN ward_labels lr ON lr.ward_id=a.labour_room_id JOIN doctors d ON d.doctor_id=a.assigned_doctor_id WHERE mother_id=?`,
          m.mother_id,
        ),
        pregnancy: one(
          "SELECT * FROM pregnancies WHERE mother_id=?",
          m.mother_id,
        ),
        children: all(
          "SELECT c.*,d.hospital_id,h.name hospital FROM newborns c JOIN delivery_records d USING(delivery_id) JOIN hospitals h USING(hospital_id) WHERE c.mother_id=?",
          m.mother_id,
        ),
        delivery: all(
          `SELECT d.*,a.labour_room_id,l.label labour_room,a.labour_table_id,u.code unit_code FROM delivery_records d JOIN pregnancies p USING(pregnancy_id) JOIN delivery_allocations a USING(delivery_id) JOIN ward_labels l ON l.ward_id=a.labour_room_id JOIN clinical_units u USING(unit_id) WHERE p.mother_id=?`,
          m.mother_id,
        ),
        gaps: all(
          "SELECT * FROM care_gaps WHERE subject_id=? ORDER BY due_date DESC LIMIT 20",
          m.mother_id,
        ),
      });
    }),
  );
  function canEdit(req, res) {
    if (req.get("x-hospital-role") !== "admin") {
      res
        .status(403)
        .json({
          error:
            "Select the administrator role to change this synthetic facility.",
        });
      return false;
    }
    return true;
  }
  app.patch(
    "/api/hospital-admin/:hospitalId/facility",
    route((req, res) => {
      if (!canEdit(req, res)) return;
      const hid = req.params.hospitalId,
        b = req.body || {};
      if (!one("SELECT * FROM hospitals WHERE hospital_id=?", hid))
        return res.status(404).json({ error: "Hospital not found" });
      if (
        typeof b.name !== "string" ||
        !b.name.trim().startsWith("DAI SYNTHETIC ") ||
        b.name.length > 180
      )
        return res
          .status(400)
          .json({
            error:
              "Keep the DAI SYNTHETIC name prefix and use at most 180 characters.",
          });
      if (
        typeof b.address !== "string" ||
        !b.address.trim() ||
        b.address.length > 500
      )
        return res
          .status(400)
          .json({
            error: "A fictional address is required (up to 500 characters).",
          });
      if (
        ![
          "Accredited (synthetic)",
          "Not accredited",
          "Application pending",
        ].includes(b.nabl_status)
      )
        return res.status(400).json({ error: "Invalid NABL status" });
      db().exec("BEGIN IMMEDIATE");
      try {
        db()
          .prepare(
            "UPDATE hospitals SET name=?,nabh_accredited=?,emergency_24x7=?,is_sos_participating=? WHERE hospital_id=?",
          )
          .run(
            b.name.trim(),
            Number(b.nabh_accredited === true),
            Number(b.emergency_24x7 === true),
            Number(b.is_sos_participating === true),
            hid,
          );
        db()
          .prepare(
            "UPDATE facility_profiles SET address=?,nabl_status=?,updated_at=? WHERE hospital_id=?",
          )
          .run(b.address.trim(), b.nabl_status, meta("snapshot_at"), hid);
        db()
          .prepare(
            "INSERT INTO administration_audit(hospital_id,entity_type,entity_id,action,detail,actor,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            hid,
            "facility",
            hid,
            "facility_updated",
            "Facility master and service flags updated.",
            "Synthetic administrator",
            new Date().toISOString(),
          );
        db().exec("COMMIT");
      } catch (error) {
        db().exec("ROLLBACK");
        throw error;
      }
      res.json({ message: "Facility changes saved" });
    }),
  );
  app.patch(
    "/api/hospital-admin/:hospitalId/beds/:bedId",
    route((req, res) => {
      if (!canEdit(req, res)) return;
      const hid = req.params.hospitalId,
        bed = one(
          "SELECT b.*,w.hospital_id,s.status effective_status FROM beds b JOIN wards w USING(ward_id) JOIN hospital_bed_states s USING(bed_id) WHERE b.bed_id=? AND w.hospital_id=?",
          req.params.bedId,
          hid,
        ),
        b = req.body || {};
      if (!bed) return res.status(404).json({ error: "Bed not found" });
      if (bed.effective_status === "occupied")
        return res
          .status(409)
          .json({
            error:
              "This bed has an active admission. Discharge must be recorded before changing its availability.",
          });
      if (b.expected_status !== bed.effective_status)
        return res
          .status(409)
          .json({ error: "Bed state changed. Refresh before saving." });
      if (!["available", "maintenance", "reserved"].includes(b.status))
        return res.status(400).json({ error: "Invalid bed status" });
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      if (reason.length < 5 || reason.length > 500)
        return res
          .status(400)
          .json({ error: "Add a reason between 5 and 500 characters." });
      if (
        b.status === "reserved" &&
        !one(
          `SELECT m.mother_id FROM mothers m JOIN pregnancies p USING(mother_id) WHERE m.mother_id=? AND p.confirmed_high_risk=1 AND p.outcome='ongoing' AND (m.registered_hospital_id=? OR EXISTS(SELECT 1 FROM referrals r WHERE r.pregnancy_id=p.pregnancy_id AND r.referred_to_hospital_id=?))`,
          b.mother_id || "",
          hid,
          hid,
        )
      )
        return res
          .status(400)
          .json({
            error:
              "Choose an ongoing high-risk mother registered here or referred to this hospital.",
          });
      db().exec("BEGIN IMMEDIATE");
      try {
        db()
          .prepare(
            "UPDATE hospital_bed_states SET status=?,reserved_for_mother_id=?,reservation_reason=?,updated_at=? WHERE bed_id=?",
          )
          .run(
            b.status,
            b.status === "reserved" ? b.mother_id : null,
            b.status === "reserved" ? reason : null,
            meta("snapshot_at"),
            bed.bed_id,
          );
        db()
          .prepare(
            "INSERT INTO bed_state_history(bed_id,previous_status,status,mother_id,effective_at,reason,actor) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            bed.bed_id,
            bed.effective_status,
            b.status,
            b.status === "reserved" ? b.mother_id : null,
            meta("snapshot_at"),
            reason,
            "Synthetic administrator",
          );
        db()
          .prepare(
            "INSERT INTO administration_audit(hospital_id,entity_type,entity_id,action,detail,actor,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            hid,
            "bed",
            bed.bed_id,
            "bed_status_updated",
            `${bed.effective_status} → ${b.status}: ${reason}`,
            "Synthetic administrator",
            new Date().toISOString(),
          );
        db().exec("COMMIT");
      } catch (error) {
        db().exec("ROLLBACK");
        throw error;
      }
      res.json({ message: "Bed state saved with history" });
    }),
  );
  return {
    close() {
      database?.close();
      database = undefined;
    },
    file,
  };
}
module.exports = registerHospitalAdministration;
