"""Import the existing DAI synthetic dataset with deterministic UUID provenance."""

import argparse
import hashlib
import json
import os
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL
from sqlalchemy import select, func
from . import schema as s
from .db import database, initialize
from .security import ROLES, password_hash

ROOT = Path(__file__).resolve().parents[1]


def uid(kind, source):
    return (
        str(uuid5(NAMESPACE_URL, f"dai:synthetic:{kind}:{source}")) if source else None
    )


def stamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc) if value else None


def seed(engine, source=None, config=None):
    cfg = config or json.loads(
        "{" + (ROOT / "config.yaml").read_text().split("{", 1)[1]
    )
    # Config uses JSON-form YAML with leading comments.
    source = Path(
        source or os.getenv("DAI_SOURCE_DB") or ROOT / cfg["source_database"]
    ).resolve()
    initialize(engine)
    with engine.connect() as c:
        if c.scalar(select(func.count()).select_from(s.seed_manifest)):
            return {"status": "already imported"}
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row

    def rows(sql):
        return [dict(r) for r in src.execute(sql)]

    def records(name):
        return rows("SELECT * FROM " + name)

    snap = cfg["as_of_date"] + "T12:00:00+00:00"
    snapshot = stamp(snap)
    mothers = rows(
        "SELECT m.*,p.pregnancy_id,p.edd,p.current_gestational_week,p.current_stage,p.confirmed_high_risk,p.conditions FROM mothers m JOIN pregnancies p USING(mother_id) ORDER BY mother_id"
    )
    rng = random.Random(cfg["seed"])
    high = [m for m in mothers if m["confirmed_high_risk"]]
    low = [m for m in mothers if not m["confirmed_high_risk"]]
    rng.shuffle(high)
    rng.shuffle(low)
    n = min(cfg["cohort_size"], len(mothers))
    nh = min(round(n * cfg["clinician_high_risk_fraction"]), len(high))
    chosen = sorted(high[:nh] + low[: n - nh], key=lambda m: m["mother_id"])
    mids = {m["mother_id"] for m in chosen}
    pids = {m["pregnancy_id"]: m["mother_id"] for m in chosen}
    children = [r for r in records("newborns") if r["mother_id"] in mids]
    cids = {r["child_id"] for r in children}
    assignments = {r["mother_id"]: r for r in records("mother_unit_assignments")}
    doctors = records("doctors")
    doctor_units = {r["doctor_id"]: r["unit_id"] for r in records("doctor_units")}
    beds = records("beds")
    bed_states = {r["bed_id"]: r for r in records("hospital_bed_states")}
    hospitals = records("hospitals")
    labels = {r["ward_id"]: r for r in records("ward_labels")}
    source_patients = records("patients")
    admissions = records("admissions")
    facilities_by_patient = {r["patient_id"]: r["hospital_id"] for r in admissions}
    for m in mothers:
        facilities_by_patient[m["mother_id"]] = m["registered_hospital_id"]
    births = {r["delivery_id"]: r for r in records("delivery_records")}
    for ch in records("newborns"):
        facilities_by_patient[ch["child_id"]] = births[ch["delivery_id"]]["hospital_id"]
    demo_password = os.getenv("DAI_DEMO_PASSWORD", "Dai-Synthetic-2026!")
    hashed = password_hash(demo_password)
    counts = {}
    with engine.begin() as c:

        def add(table, source_id=None, **values):
            key = uid(table.name, source_id) if source_id else None
            payload = {"source_id": source_id, **values}
            if key:
                payload["id"] = key
            c.execute(table.insert().values(**payload))
            counts[table.name] = counts.get(table.name, 0) + 1
            return key

        for role, permissions in ROLES.items():
            for permission in sorted(permissions):
                add(
                    s.role_permission,
                    role + ":" + permission,
                    role=role,
                    permission=permission,
                )
        services = {r["hospital_id"]: r for r in records("hospital_services")}
        profiles = {r["hospital_id"]: r for r in records("facility_profiles")}
        for h in hospitals:
            hid = h["hospital_id"]
            hs = services[hid]
            functional = sum(
                1
                for b in rows(
                    "SELECT b.bed_id FROM beds b JOIN wards w USING(ward_id) WHERE w.hospital_id='"
                    + hid
                    + "'"
                )
                if bed_states[b["bed_id"]]["status"] != "maintenance"
            )
            add(
                s.facility,
                hid,
                name=h["name"],
                tier={
                    "Medical College Hospital": "MEDICAL_COLLEGE",
                    "District Hospital": "DISTRICT",
                    "PHC": "PHC",
                    "CHC": "CHC",
                }.get(h["tier"], "PRIVATE"),
                ownership=h["ownership"],
                address=profiles[hid]["address"],
                lat=h["latitude"],
                lng=h["longitude"],
                nabh_status="ACCREDITED_SYNTHETIC"
                if h["nabh_accredited"]
                else "NOT_ACCREDITED",
                nabl_status=profiles[hid]["nabl_status"],
                emergency_24x7=bool(h["emergency_24x7"]),
                sos_participating=bool(h["is_sos_participating"]),
                authorized_beds=h["total_beds"],
                functional_beds=functional,
                capabilities={
                    **hs,
                    "nicu_level": h["has_nicu_level"],
                    "blood_bank": bool(h["has_blood_bank"]),
                },
            )
        for r in records("administration_roles"):
            add(
                s.organisation_role,
                r["role_id"],
                facility_id=uid("facility", r["hospital_id"]),
                role_name=r["role_name"],
                fictional_holder_name=r["person_name"],
                email=r["email"],
                appointed_on=r["appointed_on"],
            )
        for d in records("departments"):
            add(
                s.department,
                d["department_id"],
                facility_id=uid("facility", d["hospital_id"]),
                name=d["name"],
            )
        for w in records("wards"):
            add(
                s.ward,
                w["ward_id"],
                facility_id=uid("facility", w["hospital_id"]),
                department_id=uid("department", w["department_id"]),
                name=labels[w["ward_id"]]["label"],
                care_area=labels[w["ward_id"]]["care_area"],
                capacity=w["capacity"],
            )
        for u in records("clinical_units"):
            add(
                s.unit,
                u["unit_id"],
                facility_id=uid("facility", u["hospital_id"]),
                department_id=uid("department", u["department_id"]),
                code=u["code"],
                anc_day=u["anc_day"],
                gynae_day=u["gynae_day"],
                opd_day=u["opd_day"],
                ot_day=u["ot_day"],
                ward_id=uid("ward", u["anc_ward_id"]),
                gynae_ward_id=uid("ward", u["gynae_ward_id"]),
                labour_room_id=uid("ward", u["labour_room_id"]),
                room=u["room"],
            )
        for cl in records("special_clinics"):
            add(
                s.clinic,
                cl["clinic_id"],
                facility_id=uid("facility", cl["hospital_id"]),
                unit_id=uid("unit", cl["unit_id"]),
                name=cl["name"],
                day=cl["day"],
                start_time=cl["start_time"],
                end_time=cl["end_time"],
                room=cl["room"],
            )
        for d in doctors:
            add(
                s.user,
                d["doctor_id"],
                facility_id=uid("facility", d["hospital_id"]),
                department_id=uid("department", d["department_id"]),
                unit_id=uid("unit", doctor_units.get(d["doctor_id"])),
                name=d["name"],
                email=d["doctor_id"].lower() + "@dai-synthetic.invalid",
                role="consultant",
                registration_no=d["registration_number"],
                verified=True,
                password_hash=hashed,
                details={
                    "specialty": d["specialty"],
                    "high_risk_certified": bool(d["high_risk_pregnancy_certified"]),
                },
            )
        anchor = hospitals[0]["hospital_id"]
        anchor_doc = next(
            d
            for d in doctors
            if d["hospital_id"] == anchor and d["doctor_id"] in doctor_units
        )
        for role in ROLES:
            add(
                s.user,
                "demo:" + role,
                facility_id=uid("facility", anchor),
                department_id=uid("department", anchor_doc["department_id"])
                if role in ("consultant", "resident")
                else None,
                unit_id=uid("unit", doctor_units[anchor_doc["doctor_id"]])
                if role in ("consultant", "resident")
                else None,
                name="SYNTHETIC " + role.replace("_", " ").title(),
                email=role + "@dai-synthetic.invalid",
                role=role,
                registration_no="NMC-FAKE-DEMO-" + role.upper()
                if role in ("consultant", "resident")
                else None,
                verified=True,
                password_hash=hashed,
                details={"demo": True, "high_risk_certified": role == "consultant"},
            )
        for p in source_patients:
            add(
                s.patient,
                p["patient_id"],
                facility_id=uid(
                    "facility", facilities_by_patient.get(p["patient_id"], anchor)
                ),
                name=p["synthetic_label"],
                subject_type=p["patient_type"],
            )
        for m in chosen:
            a = assignments[m["mother_id"]]
            flags = rows(
                "SELECT * FROM risk_flags WHERE pregnancy_id='"
                + m["pregnancy_id"]
                + "' AND validation_status='confirmed' AND validated_by_doctor_id IS NOT NULL"
            )
            validator = flags[0]["validated_by_doctor_id"] if flags else None
            if m["confirmed_high_risk"] and not validator:
                raise ValueError("Confirmed risk without original clinician validation")
            add(
                s.mother,
                m["mother_id"],
                patient_id=uid("patient", m["mother_id"]),
                registered_facility_id=uid("facility", m["registered_hospital_id"]),
                assigned_unit_id=uid("unit", a["unit_id"]),
                assigned_doctor_id=uid("portal_user", a["assigned_doctor_id"]),
                uhid="DAI-SYN-" + m["mother_id"],
                age=m["age"],
                edd=m["edd"],
                gestation_weeks=m["current_gestational_week"],
                clinician_high_risk=bool(m["confirmed_high_risk"]),
                high_risk_reason_by_clinician=m["conditions"] if validator else None,
                validated_by=uid("portal_user", validator),
                consent_flags={"synthetic_demo": True, "care_coordination": True},
                details={
                    "name": m["name"],
                    "stage": m["current_stage"],
                    "district": m["district"],
                    "state": m["state"],
                    "source_pregnancy_id": m["pregnancy_id"],
                },
            )
        for b in beds:
            st = bed_states[b["bed_id"]]
            status = st["status"].upper()
            # Reservations for mothers outside the selected cohort are not imported as active holds.
            if status == "RESERVED" and st["reserved_for_mother_id"] not in mids:
                status = "AVAILABLE"
            add(
                s.bed,
                b["bed_id"],
                ward_id=uid("ward", b["ward_id"]),
                label=b["bed_id"],
                type=b["bed_type"],
                has_oxygen=bool(b["oxygen_supported"]),
                has_monitor=bool(b["monitor_attached"]),
                has_ventilator=False,
                status=status,
                status_since=snapshot,
                current_patient_id=uid("patient", b["current_patient_id"])
                if status == "OCCUPIED"
                else None,
                version=1,
            )
            add(
                s.bed_state_history,
                "snapshot:" + b["bed_id"],
                bed_id=uid("bed", b["bed_id"]),
                status=status,
                patient_id=uid("patient", b["current_patient_id"])
                if status == "OCCUPIED"
                else None,
                reason="Imported validated DAI census snapshot",
                effective_at=snapshot,
            )
            if status == "RESERVED":
                add(
                    s.reservation,
                    "seed:" + b["bed_id"],
                    resource_type="bed",
                    bed_id=uid("bed", b["bed_id"]),
                    mother_id=uid("mother", st["reserved_for_mother_id"]),
                    expires_at=stamp("2026-10-20T18:00:00+00:00"),
                    state="ACTIVE",
                    accepted_by=uid("portal_user", "demo:hospital_admin"),
                )
        for a in admissions:
            if a["admitted_at"] <= snap and (
                not a["discharged_at"] or a["discharged_at"] > snap
            ):
                add(
                    s.admission,
                    a["admission_id"],
                    facility_id=uid("facility", a["hospital_id"]),
                    patient_id=uid("patient", a["patient_id"]),
                    bed_id=uid("bed", a["bed_id"]),
                    admitted_at=stamp(a["admitted_at"]),
                    discharged_at=None,
                )
        for ch in children:
            add(
                s.child,
                ch["child_id"],
                mother_id=uid("mother", ch["mother_id"]),
                patient_id=uid("patient", ch["child_id"]),
                birth_order=ch["birth_order"],
                date_of_birth=ch["date_of_birth"],
                birth_weight_g=ch["birth_weight_g"],
                details={
                    k: v for k, v in ch.items() if k not in ("mother_id", "child_id")
                },
            )
        for cr in records("critical_care_units"):
            count = src.execute(
                "SELECT capacity FROM wards WHERE ward_id=?", (cr["ward_id"],)
            ).fetchone()[0]
            vents = src.execute(
                "SELECT coalesce(sum(functional_quantity),0) FROM equipment WHERE ward_id=? AND type='ventilator'",
                (cr["ward_id"],),
            ).fetchone()[0]
            add(
                s.critical_unit,
                cr["critical_id"],
                facility_id=uid("facility", cr["hospital_id"]),
                ward_id=uid("ward", cr["ward_id"]),
                category=cr["category"],
                bed_count=count,
                ventilator_count=vents,
            )
        for r in records("blood_stock_snapshots"):
            add(
                s.blood_stock_snapshot,
                r["snapshot_id"],
                facility_id=uid("facility", r["hospital_id"]),
                blood_group=r["blood_group"],
                component=r["component"],
                units=r["units_available"],
                snapshot_at=r["snapshot_date"],
            )
        for r in records("staffing_establishment"):
            add(
                s.staff_post,
                r["post_id"],
                facility_id=uid("facility", r["hospital_id"]),
                cadre=r["cadre"],
                sanctioned=r["sanctioned"],
                in_position=r["in_position"],
            )
        for r in records("shift_rosters"):
            add(
                s.roster_entry,
                r["roster_id"],
                facility_id=uid("facility", r["hospital_id"]),
                user_id=uid("portal_user", r["doctor_id"]),
                ward_id=uid("ward", r["ward_id"]),
                roster_date=r["roster_date"],
                start_time=r["start_time"],
                end_time=r["end_time"],
                details={"role": r["role"], "source_staff_id": r["staff_id"]},
            )
        for r in records("ambulances"):
            add(
                s.ambulance,
                r["ambulance_id"],
                facility_id=uid("facility", r["hospital_id"]),
                label=r["vehicle_label"],
                type=r["type"],
                status=r["status"],
            )
        for r in records("investigations"):
            if r["pregnancy_id"] in pids:
                add(
                    s.investigation_order,
                    r["investigation_id"],
                    mother_id=uid("mother", pids[r["pregnancy_id"]]),
                    facility_id=uid("facility", r["hospital_id"]),
                    test=r["test_type"],
                    status=r["status"].upper(),
                    due_date=r["due_date"],
                    details={
                        "result_value": r["result_value"],
                        "completed_date": r["completed_date"],
                        "result_flag": r["result_flag"],
                    },
                )
        for r in records("care_gaps"):
            if r["subject_id"] in mids or r["subject_id"] in cids:
                add(
                    s.care_gap,
                    r["gap_id"],
                    mother_id=uid("mother", r["subject_id"])
                    if r["subject_id"] in mids
                    else None,
                    child_id=uid("child", r["subject_id"])
                    if r["subject_id"] in cids
                    else None,
                    order_id=uid("investigation_order", r["source_id"])
                    if r["source_table"] == "investigations"
                    else None,
                    expected_item=r["expected_item"],
                    due_date=r["due_date"],
                    status=r["status"].upper(),
                    details={
                        "source_table": r["source_table"],
                        "source_id": r["source_id"],
                        "reason": r["action_recommended"],
                    },
                )
        add(
            s.seed_manifest,
            "dai-source-v1",
            source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            as_of_date=cfg["as_of_date"],
            counts=counts.copy(),
            assumptions=cfg["assumptions"],
        )
    src.close()
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    args = parser.parse_args()
    print(json.dumps(seed(database(), args.source), indent=2))
