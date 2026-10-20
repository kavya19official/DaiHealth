"""Authenticated, read-only operational snapshots from the existing synthetic ledger.
No workflow approval, live reservation, forecast or clinical diagnosis is implied.
"""

import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from datetime import date, timedelta
from fastapi import Depends, HTTPException, Query
from sqlalchemy import select
from . import schema as s

LABEL = "Simulated on synthetic data"
SOURCE = Path(__file__).resolve().parents[2] / "backend/data/dai-hospital.db"
PERMISSIONS = {
    "beds": "bed.read",
    "critical": "bed.read",
    "blood": "blood.read",
    "equipment": "equipment.read",
    "staffing": "facility.read",
    "census": "facility.read",
    "organisation": "facility.read",
    "ambulances": "sos.read",
    "sos": "sos.read",
    "referrals": "referral.read",
    "appointments": "patient.read",
    "gaps": "patient.read",
    "readiness": "patient.read",
    "diagnostics": "diagnostics.read",
}


def register_workspace(app, engine, require, audit, roles):
    @contextmanager
    def source():
        path = Path(os.getenv("DAI_SOURCE_DB", str(SOURCE)))
        if not path.is_file():
            raise HTTPException(
                503,
                "Synthetic hospital ledger missing. Run synthetic_data/build_hospital_admin.py.",
            )
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def rows(db, sql, *args):
        return [dict(r) for r in db.execute(sql, args)]

    def context(u, c):
        facility = (
            c.execute(select(s.facility).where(s.facility.c.id == u["facility_id"]))
            .mappings()
            .one()
        )
        if not ({"patient.read", "diagnostics.read"} & roles[u["role"]]):
            return facility["source_id"], {}
        query = select(s.mother).where(
            s.mother.c.registered_facility_id == u["facility_id"]
        )
        if u["role"] in ("consultant", "resident"):
            query = query.where(s.mother.c.assigned_unit_id == u["unit_id"])
        if u["role"] == "resident":
            query = query.where(s.mother.c.assigned_doctor_id == u["id"])
        mothers = {m["source_id"]: dict(m) for m in c.execute(query).mappings()}
        return facility["source_id"], mothers

    def attach_mothers(items, mothers, c, u, view, key="mother_id"):
        result = []
        for item in items:
            m = mothers.get(item.get(key))
            if m:
                result.append(
                    {
                        **item,
                        "mother_name": m["details"]["name"],
                        "portal_mother_id": m["id"],
                    }
                )
                audit(
                    c,
                    u,
                    "read",
                    "mother",
                    m["id"],
                    {"view": view, "source": "synthetic operational ledger"},
                )
        return result

    def overview(db, hid, c, u, mothers):
        snap = db.execute(
            "SELECT value FROM hospital_metadata WHERE key='snapshot_at'"
        ).fetchone()[0]
        today = snap[:10]
        beds = rows(
            db,
            """SELECT count(*) total,sum(s.status='occupied') occupied,
            sum(s.status='available') available,sum(s.status='maintenance') maintenance,
            sum(s.status='reserved') reserved FROM beds b JOIN wards w USING(ward_id)
            JOIN hospital_bed_states s USING(bed_id) WHERE w.hospital_id=?""",
            hid,
        )[0]
        blood = rows(
            db,
            "SELECT coalesce(sum(units_available),0) units FROM blood_stock_snapshots WHERE hospital_id=? AND snapshot_date=? AND component='Packed red cells'",
            hid,
            today,
        )[0]["units"]
        failures = rows(
            db,
            "SELECT coalesce(sum(installed_quantity-functional_quantity),0) units FROM equipment WHERE hospital_id=?",
            hid,
        )[0]["units"]
        oncall = rows(
            db,
            "SELECT r.role,d.name,d.specialty,r.start_time,r.end_time FROM shift_rosters r JOIN doctors d USING(doctor_id) WHERE r.hospital_id=? AND r.roster_date=? AND r.start_time<=? AND r.end_time>? ORDER BY d.specialty",
            hid,
            today,
            snap[11:16],
            snap[11:16],
        )
        critical = rows(
            db,
            """SELECT cc.name,cc.category,w.capacity,
            sum(s.status='occupied') occupied,sum(s.status='available') available,
            (SELECT coalesce(sum(e.functional_quantity),0) FROM equipment e WHERE e.ward_id=cc.ward_id AND e.type='ventilator') ventilators
            FROM critical_care_units cc JOIN wards w USING(ward_id) JOIN beds b USING(ward_id)
            JOIN hospital_bed_states s USING(bed_id) WHERE cc.hospital_id=? GROUP BY cc.critical_id ORDER BY cc.name""",
            hid,
        )
        days = []
        for ago in range(6, -1, -1):
            day = (date.fromisoformat(today) - timedelta(days=ago)).isoformat()
            values = rows(
                db,
                """SELECT count(*) deliveries,sum(mode='normal') normal,
                sum(mode='assisted') assisted,sum(mode='elective LSCS') elective_lscs,
                sum(mode='emergency LSCS') emergency_lscs FROM delivery_records WHERE hospital_id=? AND substr(delivered_at,1,10)=?""",
                hid,
                day,
            )[0]
            values.update(
                rows(
                    db,
                    """SELECT
                (SELECT count(*) FROM admissions WHERE hospital_id=? AND substr(admitted_at,1,10)=?) admissions,
                (SELECT count(*) FROM admissions WHERE hospital_id=? AND substr(discharged_at,1,10)=?) discharges,
                (SELECT count(*) FROM referrals WHERE referred_to_hospital_id=? AND substr(referred_at,1,10)=?) referrals_in,
                (SELECT count(*) FROM referrals WHERE referred_from_hospital_id=? AND substr(referred_at,1,10)=?) referrals_out""",
                    hid,
                    day,
                    hid,
                    day,
                    hid,
                    day,
                    hid,
                    day,
                )[0]
            )
            days.append({"date": day, **values})
        pending = rows(
            db,
            "SELECT count(*) n FROM emergency_events WHERE nearest_hospital_id=? AND second_auth_passed=0",
            hid,
        )[0]["n"]
        upcoming = []
        if "patient.read" in roles[u["role"]]:
            for m in sorted(mothers.values(), key=lambda m: m["edd"] or "9999"):
                if m["clinician_high_risk"] and m["details"]["stage"] in (
                    "T3",
                    "In-labour",
                    "T2",
                ):
                    audit(
                        c,
                        u,
                        "read",
                        "mother",
                        m["id"],
                        {"view": "clinician-confirmed arrival worklist"},
                    )
                    upcoming.append(
                        {
                            "id": m["id"],
                            "name": m["details"]["name"],
                            "edd": m["edd"],
                            "stage": m["details"]["stage"],
                            "gestation_weeks": m["gestation_weeks"],
                            "reason": m["high_risk_reason_by_clinician"],
                            "unit_id": m["assigned_unit_id"],
                        }
                    )
                    if len(upcoming) == 6:
                        break
        return {
            "snapshot_at": snap,
            "beds": beds,
            "critical": critical,
            "blood_units": blood,
            "equipment_unavailable": failures,
            "on_call": oncall,
            "delivery_history": days,
            "unverified_sos": pending,
            "arrivals": upcoming,
            "cohort_mothers": len(mothers),
            "alerts": [
                {
                    "title": "Equipment needing attention",
                    "value": failures,
                    "reason": "Installed units minus functional units in the source ledger.",
                    "target": "equipment",
                },
                {
                    "title": "SOS rejected at verification",
                    "value": pending,
                    "reason": "Recorded events that did not pass the second authentication step.",
                    "target": "sos",
                },
            ],
        }

    @app.get("/api/workspace/summary")
    def summary(u=Depends(require("facility.read"))):
        with engine.begin() as c, source() as db:
            hid, mothers = context(u, c)
            result = overview(db, hid, c, u, mothers)
            return {
                **result,
                "data_label": LABEL,
                "mode": "recorded snapshot — read only",
            }

    @app.get("/api/workspace/{view}")
    def workspace(
        view: str,
        page: int = Query(1, ge=1),
        q: str = Query("", max_length=100),
        status: str = "",
        ward: str = "",
        u=Depends(require("facility.read")),
    ):
        if view not in PERMISSIONS:
            raise HTTPException(404, "Unknown workspace view")
        if (
            "facility.write" not in roles[u["role"]]
            and PERMISSIONS[view] not in roles[u["role"]]
        ):
            raise HTTPException(403, "Permission denied")
        with engine.begin() as c, source() as db:
            hid, mothers = context(u, c)
            today = db.execute(
                "SELECT value FROM hospital_metadata WHERE key='as_of_date'"
            ).fetchone()[0]
            result = {
                "data_label": LABEL,
                "as_of_date": today,
                "mode": "Recorded synthetic snapshot · read only",
                "items": [],
            }
            if view == "beds":
                where = ["w.hospital_id=?"]
                args = [hid]
                if status:
                    where.append("s.status=?")
                    args.append(status.lower())
                if ward:
                    where.append("b.ward_id=?")
                    args.append(ward)
                if q:
                    where.append("(b.bed_id LIKE ? OR l.label LIKE ?)")
                    args.extend(["%" + q + "%"] * 2)
                joins = "beds b JOIN wards w USING(ward_id) JOIN ward_labels l USING(ward_id) JOIN hospital_bed_states s USING(bed_id)"
                result["total"] = db.execute(
                    f"SELECT count(*) FROM {joins} WHERE " + " AND ".join(where), args
                ).fetchone()[0]
                result["items"] = rows(
                    db,
                    f"SELECT b.bed_id,b.bed_type,b.oxygen_supported,b.monitor_attached,l.label ward,l.care_area,s.status,s.updated_at FROM {joins} WHERE "
                    + " AND ".join(where)
                    + " ORDER BY l.label,b.bed_id LIMIT 60 OFFSET ?",
                    *args,
                    (page - 1) * 60,
                )
                result["wards"] = rows(
                    db,
                    "SELECT w.ward_id,l.label,w.capacity FROM wards w JOIN ward_labels l USING(ward_id) WHERE w.hospital_id=? ORDER BY l.label",
                    hid,
                )
                result.update(page=page, page_size=60)
            elif view == "critical":
                result["items"] = overview(db, hid, c, u, {})["critical"]
                result["admissions"] = rows(
                    db,
                    "SELECT a.admission_id,a.admitted_at,a.discharged_at,l.label ward,a.admission_reason FROM admissions a JOIN critical_care_units cc USING(ward_id) JOIN ward_labels l USING(ward_id) WHERE a.hospital_id=? ORDER BY a.admitted_at DESC LIMIT 40",
                    hid,
                )
            elif view == "blood":
                result["items"] = rows(
                    db,
                    "SELECT blood_group,component,units_available,snapshot_date FROM blood_stock_snapshots WHERE hospital_id=? AND snapshot_date=? ORDER BY component,blood_group",
                    hid,
                    today,
                )
            elif view == "equipment":
                result["items"] = rows(
                    db,
                    "SELECT e.*,l.label ward FROM equipment e JOIN ward_labels l USING(ward_id) WHERE e.hospital_id=? ORDER BY e.type,l.label",
                    hid,
                )
            elif view == "staffing":
                result["posts"] = rows(
                    db,
                    "SELECT cadre,sanctioned,in_position FROM staffing_establishment WHERE hospital_id=? ORDER BY cadre",
                    hid,
                )
                result["items"] = rows(
                    db,
                    "SELECT d.name,d.specialty,d.designation,d.qualification,d.experience_years,u.code unit_code FROM doctors d LEFT JOIN doctor_units du USING(doctor_id) LEFT JOIN clinical_units u USING(unit_id) WHERE d.hospital_id=? ORDER BY d.specialty,u.code",
                    hid,
                )
                result["rosters"] = rows(
                    db,
                    "SELECT coalesce(d.name,n.name) name,r.role,r.shift,r.start_time,r.end_time,l.label ward FROM shift_rosters r LEFT JOIN doctors d USING(doctor_id) LEFT JOIN nurses_midwives n USING(staff_id) LEFT JOIN ward_labels l USING(ward_id) WHERE r.hospital_id=? AND r.roster_date=? ORDER BY r.start_time,r.role",
                    hid,
                    today,
                )
            elif view == "census":
                result["items"] = overview(db, hid, c, u, {})["delivery_history"]
            elif view == "organisation":
                result["items"] = rows(
                    db,
                    "SELECT role_name,person_name,email,appointed_on FROM administration_roles WHERE hospital_id=?",
                    hid,
                )
            elif view == "ambulances":
                result["items"] = rows(
                    db,
                    "SELECT vehicle_label,type,status,oxygen_supported,neonatal_transport,last_service_date FROM ambulances WHERE hospital_id=?",
                    hid,
                )
            elif view == "sos":
                result["items"] = rows(
                    db,
                    "SELECT event_id,triggered_at,required_capability,first_auth_passed,second_auth_passed,distance_km,response_time_min,outcome FROM emergency_events WHERE nearest_hospital_id=? ORDER BY triggered_at DESC LIMIT 60",
                    hid,
                )
            elif view == "referrals":
                raw = rows(
                    db,
                    "SELECT r.referral_id,p.mother_id,r.reason,r.referred_at,r.transport_time_min,a.name from_facility,b.name to_facility FROM referrals r JOIN pregnancies p USING(pregnancy_id) JOIN hospitals a ON a.hospital_id=r.referred_from_hospital_id JOIN hospitals b ON b.hospital_id=r.referred_to_hospital_id WHERE r.referred_from_hospital_id=? OR r.referred_to_hospital_id=? ORDER BY r.referred_at DESC",
                    hid,
                    hid,
                )
                if "facility.write" in roles[u["role"]]:
                    incoming_ids = {r["mother_id"] for r in raw}
                    if incoming_ids:
                        referred = c.execute(
                            select(s.mother).where(
                                s.mother.c.source_id.in_(incoming_ids)
                            )
                        ).mappings()
                        mothers = {
                            **mothers,
                            **{m["source_id"]: dict(m) for m in referred},
                        }
                result["items"] = attach_mothers(raw, mothers, c, u, view)
            elif view == "appointments":
                raw = rows(
                    db,
                    "SELECT a.appointment_id,a.mother_id,a.appointment_date,a.start_time,a.end_time,a.status,a.reason,d.name doctor FROM appointments a JOIN doctors d USING(doctor_id) WHERE a.hospital_id=? ORDER BY a.appointment_date DESC",
                    hid,
                )
                result["items"] = attach_mothers(
                    [r for r in raw if r["mother_id"] in mothers][:100],
                    mothers,
                    c,
                    u,
                    view,
                )
            elif view == "gaps":
                raw = rows(
                    db,
                    "SELECT gap_id,subject_id mother_id,expected_item,due_date,gap_type,severity,status,action_recommended FROM care_gaps WHERE subject_type='mother' AND status='open' ORDER BY due_date",
                )
                result["items"] = attach_mothers(
                    [r for r in raw if r["mother_id"] in mothers][:100],
                    mothers,
                    c,
                    u,
                    view,
                )
            elif view == "diagnostics":
                raw = rows(
                    db,
                    "SELECT i.investigation_id,p.mother_id,i.test_type,i.ordered_date,i.due_date,i.completed_date,i.status,i.result_flag FROM investigations i JOIN pregnancies p USING(pregnancy_id) WHERE i.hospital_id=? ORDER BY i.ordered_date DESC",
                    hid,
                )
                result["items"] = attach_mothers(
                    [r for r in raw if r["mother_id"] in mothers][:100],
                    mothers,
                    c,
                    u,
                    view,
                )
            elif view == "readiness":
                result["summary"] = overview(db, hid, c, u, mothers)
                result["items"] = result["summary"]["arrivals"]
                result["services"] = rows(
                    db, "SELECT * FROM hospital_services WHERE hospital_id=?", hid
                )[0]
            return result
