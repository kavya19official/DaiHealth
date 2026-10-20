#!/usr/bin/env python3
"""Enrich a copy of the DAI dataset with relational hospital administration data.
Standard library only. Never writes to the source dataset.
"""

from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DDL = """
CREATE TABLE hospital_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE facility_profiles(hospital_id TEXT PRIMARY KEY REFERENCES hospitals(hospital_id), address TEXT NOT NULL,nabl_status TEXT NOT NULL,authorized_beds INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE administration_roles(role_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),role_name TEXT NOT NULL,person_name TEXT NOT NULL,email TEXT NOT NULL,appointed_on TEXT NOT NULL);
CREATE TABLE ward_labels(ward_id TEXT PRIMARY KEY REFERENCES wards(ward_id),label TEXT NOT NULL,care_area TEXT NOT NULL);
CREATE TABLE clinical_units(unit_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),department_id TEXT NOT NULL REFERENCES departments(department_id),department TEXT NOT NULL,code TEXT NOT NULL,anc_day INTEGER,gynae_day INTEGER,opd_day INTEGER,ot_day INTEGER,anc_ward_id TEXT REFERENCES wards(ward_id),gynae_ward_id TEXT REFERENCES wards(ward_id),labour_room_id TEXT REFERENCES wards(ward_id),room TEXT NOT NULL);
CREATE TABLE doctor_units(doctor_id TEXT PRIMARY KEY REFERENCES doctors(doctor_id),unit_id TEXT NOT NULL REFERENCES clinical_units(unit_id));
CREATE TABLE mother_unit_assignments(mother_id TEXT PRIMARY KEY REFERENCES mothers(mother_id),pregnancy_id TEXT NOT NULL REFERENCES pregnancies(pregnancy_id),hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),unit_id TEXT NOT NULL REFERENCES clinical_units(unit_id),ward_id TEXT NOT NULL REFERENCES wards(ward_id),labour_room_id TEXT REFERENCES wards(ward_id),assigned_doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id));
CREATE TABLE special_clinics(clinic_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),unit_id TEXT NOT NULL REFERENCES clinical_units(unit_id),name TEXT NOT NULL,day INTEGER NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,room TEXT NOT NULL);
CREATE TABLE critical_care_units(critical_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),ward_id TEXT UNIQUE NOT NULL REFERENCES wards(ward_id),name TEXT NOT NULL,category TEXT NOT NULL);
CREATE TABLE labour_tables(table_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),ward_id TEXT NOT NULL REFERENCES wards(ward_id),label TEXT NOT NULL);
CREATE TABLE delivery_allocations(delivery_id TEXT PRIMARY KEY REFERENCES delivery_records(delivery_id),unit_id TEXT NOT NULL REFERENCES clinical_units(unit_id),labour_room_id TEXT NOT NULL REFERENCES wards(ward_id),labour_table_id TEXT NOT NULL REFERENCES labour_tables(table_id),bed_id TEXT NOT NULL REFERENCES beds(bed_id),started_at TEXT NOT NULL,ended_at TEXT NOT NULL);
CREATE TABLE hospital_bed_states(bed_id TEXT PRIMARY KEY REFERENCES beds(bed_id),status TEXT NOT NULL CHECK(status IN ('available','occupied','maintenance','reserved')),reserved_for_mother_id TEXT REFERENCES mothers(mother_id),reservation_reason TEXT,updated_at TEXT NOT NULL);
CREATE TABLE bed_state_history(history_id INTEGER PRIMARY KEY,bed_id TEXT NOT NULL REFERENCES beds(bed_id),previous_status TEXT,status TEXT NOT NULL,patient_id TEXT REFERENCES patients(patient_id),mother_id TEXT REFERENCES mothers(mother_id),effective_at TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL);
CREATE TABLE blood_stock_snapshots(snapshot_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),snapshot_date TEXT NOT NULL,blood_group TEXT NOT NULL,component TEXT NOT NULL,units_available INTEGER NOT NULL CHECK(units_available>=0),UNIQUE(hospital_id,snapshot_date,blood_group,component));
CREATE TABLE ambulances(ambulance_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),vehicle_label TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,oxygen_supported INTEGER NOT NULL,neonatal_transport INTEGER NOT NULL,last_service_date TEXT NOT NULL);
CREATE TABLE staffing_establishment(post_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),cadre TEXT NOT NULL,sanctioned INTEGER NOT NULL,in_position INTEGER NOT NULL CHECK(in_position<=sanctioned));
CREATE TABLE shift_rosters(roster_id TEXT PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),doctor_id TEXT REFERENCES doctors(doctor_id),staff_id TEXT REFERENCES nurses_midwives(staff_id),ward_id TEXT REFERENCES wards(ward_id),roster_date TEXT NOT NULL,shift TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,role TEXT NOT NULL,CHECK((doctor_id IS NOT NULL)<>(staff_id IS NOT NULL)));
CREATE TABLE administration_audit(audit_id INTEGER PRIMARY KEY,hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX idx_blood_snapshot ON blood_stock_snapshots(hospital_id,snapshot_date);
CREATE INDEX idx_roster_day ON shift_rosters(hospital_id,roster_date);
CREATE INDEX idx_mother_unit ON mother_unit_assignments(hospital_id,unit_id);
CREATE INDEX idx_delivery_room ON delivery_allocations(labour_room_id,started_at,ended_at);
CREATE INDEX idx_bed_history ON bed_state_history(bed_id,effective_at);
"""


def build(source: Path, destination: Path, config: Path):
    cfg = json.loads(config.read_text())
    snapshot = json.loads((source.parent / "config.snapshot.json").read_text())[
        "as_of_date"
    ]
    now = snapshot + "T" + cfg["snapshot_time"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(".building.db")
    temp.unlink(missing_ok=True)
    src = sqlite3.connect(source)
    db = sqlite3.connect(temp)
    src.backup(db)
    src.close()
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(DDL)

    def rows(sql, args=()):
        return [dict(r) for r in db.execute(sql, args)]

    def add(table, **record):
        db.execute(
            f"INSERT INTO {table} ({','.join(record)}) VALUES ({','.join('?' for _ in record)})",
            list(record.values()),
        )

    for key, value in {
        "schema_version": str(cfg["version"]),
        "as_of_date": snapshot,
        "snapshot_at": now,
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "synthetic": "true",
        "assumptions": json.dumps(cfg["assumptions"]),
    }.items():
        add("hospital_metadata", key=key, value=value)
    # Snapshot wards are split into named clinical locations. Existing bed and
    # admission references are moved together; total authorised capacity is preserved.
    serial = 0

    def split(hid, typ, names, care_area):
        nonlocal serial
        existing = rows(
            "SELECT * FROM wards WHERE hospital_id=? AND ward_type=?", (hid, typ)
        )
        if not existing:
            return {}
        original = existing[0]
        bedrows = rows(
            "SELECT bed_id FROM beds WHERE ward_id=? ORDER BY bed_id",
            (original["ward_id"],),
        )
        if len(bedrows) < len(names):
            names = names[: len(bedrows)]
        result = {}
        for i, name in enumerate(names):
            wid = (
                original["ward_id"]
                if i == 0
                else f"WARD-ADMIN-SYN-{hid[-4:]}-{serial:04d}"
            )
            serial += 1
            selected = bedrows[i :: len(names)]
            if i:
                add(
                    "wards",
                    ward_id=wid,
                    hospital_id=hid,
                    department_id=original["department_id"],
                    ward_type=typ,
                    capacity=len(selected),
                    oxygen_supported=original["oxygen_supported"],
                )
            else:
                db.execute(
                    "UPDATE wards SET capacity=? WHERE ward_id=?", (len(selected), wid)
                )
            add("ward_labels", ward_id=wid, label=name, care_area=care_area)
            for b in selected:
                bid = b["bed_id"]
                db.execute("UPDATE beds SET ward_id=? WHERE bed_id=?", (wid, bid))
                db.execute("UPDATE admissions SET ward_id=? WHERE bed_id=?", (wid, bid))
                db.execute(
                    "UPDATE delivery_records SET ward_id=? WHERE bed_id=?", (wid, bid)
                )
            result[name] = wid
        return result

    hospitals = rows("SELECT * FROM hospitals ORDER BY hospital_id")
    hospital_units = {}
    primary_doctors = {}
    labels = {}
    for hi, h in enumerate(hospitals):
        hid = h["hospital_id"]
        large = h["tier"] in cfg["large_hospital_tiers"]
        n = (
            6
            if large
            else 2
            if h["tier"] in ("District Hospital", "Private Multispecialty")
            else 1
        )
        add(
            "facility_profiles",
            hospital_id=hid,
            address=f"Synthetic Care Campus {hi + 1}, Sector {hi + 2}, {h['district']}, {h['state']} {h['pincode']}",
            nabl_status="Accredited (synthetic)"
            if h["tier"] in ("Medical College Hospital", "Private Multispecialty")
            else "Not accredited",
            authorized_beds=h["total_beds"],
            updated_at=now,
        )
        firstnames = [
            "Kavini",
            "Nirav",
            "Rewati",
            "Anagha",
            "Kayal",
            "Padmika",
            "Maithili",
            "Rupali",
            "Anvita",
        ]
        for ri, role in enumerate(cfg["roles"]):
            add(
                "administration_roles",
                role_id=f"ROLE-SYN-{hi + 1:03d}-{ri + 1:02d}",
                hospital_id=hid,
                role_name=role,
                person_name=f"Dr SYNTHETIC {firstnames[(ri + hi) % len(firstnames)]} {hi + 1:03d}{ri + 1:02d}",
                email=f"role-{hi + 1}-{ri + 1}@dai-synthetic.invalid",
                appointed_on="2026-01-01",
            )
        anc_names = ["Ward " + u["anc_ward"] for u in cfg["obg_units"][:n]]
        anc = split(hid, "general ANC ward", anc_names, "Obstetric ward")
        if not anc:
            anc = {}
        gyn_names = ["Ward 10G", "Ward 6"] if n == 6 else ["Gynae ward"]
        # PNC and postnatal care retain their own locations; a portion of general
        # medical beds supplies the additional configured gynae/HDU locations.
        general = rows(
            "SELECT * FROM wards WHERE hospital_id=? AND ward_type='general medicine/surgery'",
            (hid,),
        )
        gyn = {}
        if general:
            w = general[0]
            candidates = rows(
                "SELECT bed_id FROM beds WHERE ward_id=? ORDER BY bed_id DESC",
                (w["ward_id"],),
            )
            for gi, name in enumerate(gyn_names):
                count = min(
                    12 if large else 6, max(1, len(candidates) // (len(gyn_names) + 3))
                )
                picked = candidates[:count]
                candidates = candidates[count:]
                wid = f"WARD-GYN-SYN-{hi + 1:03d}-{gi + 1}"
                add(
                    "wards",
                    ward_id=wid,
                    hospital_id=hid,
                    department_id=next(
                        (
                            d["department_id"]
                            for d in rows(
                                "SELECT * FROM departments WHERE hospital_id=?", (hid,)
                            )
                            if d["name"] == "Obstetrics & Gynaecology"
                        ),
                        w["department_id"],
                    ),
                    ward_type="gynae ward",
                    capacity=len(picked),
                    oxygen_supported=1,
                )
                add("ward_labels", ward_id=wid, label=name, care_area="Gynaecology")
                gyn[name] = wid
                for b in picked:
                    db.execute(
                        "UPDATE beds SET ward_id=?,bed_type=? WHERE bed_id=?",
                        (wid, "gynae ward", b["bed_id"]),
                    )
                    db.execute(
                        "UPDATE admissions SET ward_id=? WHERE bed_id=?",
                        (wid, b["bed_id"]),
                    )
                    db.execute(
                        "UPDATE delivery_records SET ward_id=? WHERE bed_id=?",
                        (wid, b["bed_id"]),
                    )
                db.execute(
                    "UPDATE wards SET capacity=capacity-? WHERE ward_id=?",
                    (len(picked), w["ward_id"]),
                )
        lr = split(
            hid, "labour room", ["LR-I", "LR-II"] if n == 6 else ["LR-I"], "Labour room"
        )
        nicu = split(
            hid, "NICU", ["Inborn NICU", "Outborn NICU"], "Neonatal intensive care"
        )
        ped = split(
            hid,
            "paediatric ward",
            ["Ward 21", "Ward 20", "Ward 18"] if n == 6 else ["Paediatric ward"],
            "Paediatrics",
        )
        labels[hid] = {**anc, **gyn, **lr, **nicu, **ped}
        # Fix the flagship HDU to the user-supplied 15-bed synthetic configuration.
        hdu = rows(
            "SELECT * FROM wards WHERE hospital_id=? AND ward_type='obstetric ICU/HDU'",
            (hid,),
        )
        if hi == 0 and hdu:
            w = hdu[0]
            excess = rows(
                "SELECT bed_id FROM beds WHERE ward_id=? ORDER BY bed_id",
                (w["ward_id"],),
            )[cfg["flagship_obstetric_hdu_beds"] :]
            target = next(iter(anc.values()))
            for b in excess:
                db.execute(
                    "UPDATE beds SET ward_id=?,bed_type=? WHERE bed_id=?",
                    (target, "general ANC ward", b["bed_id"]),
                )
                db.execute(
                    "UPDATE admissions SET ward_id=? WHERE bed_id=?",
                    (target, b["bed_id"]),
                )
                db.execute(
                    "UPDATE delivery_records SET ward_id=? WHERE bed_id=?",
                    (target, b["bed_id"]),
                )
            db.execute(
                "UPDATE wards SET capacity=capacity-? WHERE ward_id=?",
                (len(excess), w["ward_id"]),
            )
            db.execute(
                "UPDATE wards SET capacity=capacity+? WHERE ward_id=?",
                (len(excess), target),
            )
        # Paediatric HDU is a distinct location, carved from paediatric ICU capacity.
        picu = split(
            hid,
            "paediatric ICU",
            ["PICU", "Paediatric HDU"],
            "Paediatric critical care",
        )
        for wid, name, category in (
            [(wid, name, "neonatal") for name, wid in nicu.items()]
            + [(wid, name, "paediatric") for name, wid in picu.items()]
            + [(w["ward_id"], "Obstetric HDU / CCU", "obstetric") for w in hdu]
        ):
            if not rows("SELECT * FROM ward_labels WHERE ward_id=?", (wid,)):
                add("ward_labels", ward_id=wid, label=name, care_area="Critical care")
            add(
                "critical_care_units",
                critical_id=f"CRIT-SYN-{wid}",
                hospital_id=hid,
                ward_id=wid,
                name=name,
                category=category,
            )
        depts = {
            r["name"]: r["department_id"]
            for r in rows("SELECT * FROM departments WHERE hospital_id=?", (hid,))
        }
        hospital_units[hid] = {"obg": [], "paediatrics": []}
        for index, u in enumerate(cfg["obg_units"][:n]):
            fallback = next(iter(anc.values()), None)
            if not fallback:
                continue
            uid = f"UNIT-SYN-{hi + 1:03d}-OBG-{u['code']}"
            add(
                "clinical_units",
                unit_id=uid,
                hospital_id=hid,
                department_id=depts.get(
                    "Obstetrics & Gynaecology", depts.get("General Medicine")
                ),
                department="obg",
                code=u["code"],
                anc_day=u["anc_day"],
                gynae_day=u["gynae_day"],
                opd_day=None,
                ot_day=u["ot_day"],
                anc_ward_id=anc.get("Ward " + u["anc_ward"], fallback),
                gynae_ward_id=gyn.get(
                    "Ward " + u["gynae_ward"], next(iter(gyn.values()), fallback)
                ),
                labour_room_id=lr.get(u["labour_room"], next(iter(lr.values()), None)),
                room=f"ANC-{index + 1:02d}",
            )
            hospital_units[hid]["obg"].append(uid)
        if "Obstetrics & Gynaecology" in depts:
            ref = rows(
                "SELECT * FROM clinical_units WHERE unit_id=?",
                (hospital_units[hid]["obg"][0],),
            )[0]
            add(
                "clinical_units",
                unit_id=f"UNIT-SYN-{hi + 1:03d}-OBG-FP",
                hospital_id=hid,
                department_id=depts["Obstetrics & Gynaecology"],
                department="obg",
                code="FP",
                anc_day=None,
                gynae_day=None,
                opd_day=3,
                ot_day=None,
                anc_ward_id=ref["anc_ward_id"],
                gynae_ward_id=ref["gynae_ward_id"],
                labour_room_id=None,
                room="FP-01",
            )
        for u in cfg["paediatric_units"][:n] if ped else []:
            uid = f"UNIT-SYN-{hi + 1:03d}-PED-{u['code']}"
            add(
                "clinical_units",
                unit_id=uid,
                hospital_id=hid,
                department_id=depts["Paediatrics"],
                department="paediatrics",
                code=u["code"],
                anc_day=None,
                gynae_day=None,
                opd_day=u["opd_day"],
                ot_day=None,
                anc_ward_id=ped.get("Ward " + u["ward"], next(iter(ped.values()))),
                gynae_ward_id=None,
                labour_room_id=None,
                room=f"PED-{u['code']}",
            )
            hospital_units[hid]["paediatrics"].append(uid)
        docs = rows(
            "SELECT * FROM doctors WHERE hospital_id=? ORDER BY doctor_id", (hid,)
        )
        counters = defaultdict(int)
        for d in docs:
            kind = (
                "obg"
                if d["specialty"]
                in (
                    "Obstetrician/Gynaecologist",
                    "Medical Officer",
                    "Fetal-Medicine specialist",
                )
                else "paediatrics"
                if d["specialty"] in ("Paediatrician", "Neonatologist")
                else None
            )
            if kind and hospital_units[hid][kind]:
                uid = hospital_units[hid][kind][
                    counters[kind] % len(hospital_units[hid][kind])
                ]
                counters[kind] += 1
                add("doctor_units", doctor_id=d["doctor_id"], unit_id=uid)
                primary_doctors[d["doctor_id"]] = uid
        fp_id = f"UNIT-SYN-{hi + 1:03d}-OBG-FP"
        if rows("SELECT unit_id FROM clinical_units WHERE unit_id=?", (fp_id,)):
            did = f"DOCTOR-FP-SYN-{hi + 1:03d}"
            add(
                "doctors",
                doctor_id=did,
                hospital_id=hid,
                department_id=depts["Obstetrics & Gynaecology"],
                name=f"Dr SYNTHETIC Nivara {hi + 1:03d} FP",
                gender="female",
                specialty="Obstetrician/Gynaecologist",
                designation="Consultant",
                qualification="MS OBG",
                experience_years=12,
                registration_number=f"NMC-FAKE-{900000 + hi + 1:06d}",
                languages_spoken=docs[0]["languages_spoken"],
                high_risk_pregnancy_certified=1,
                max_daily_patients=18,
            )
            add("doctor_units", doctor_id=did, unit_id=fp_id)
            primary_doctors[did] = fp_id
        for clinic in cfg["clinics"]:
            unit = rows(
                "SELECT unit_id FROM clinical_units WHERE hospital_id=? AND department=? AND code=?",
                (hid, clinic["department"], clinic["unit"]),
            )
            if not unit:
                if not hospital_units[hid][clinic["department"]]:
                    continue
                uid = hospital_units[hid][clinic["department"]][0]
            else:
                uid = unit[0]["unit_id"]
            if h["tier"] == "PHC" and clinic["name"] not in ("High-risk pregnancy",):
                continue
            add(
                "special_clinics",
                clinic_id=f"CLINIC-SYN-{hi + 1:03d}-{cfg['clinics'].index(clinic) + 1:02d}",
                hospital_id=hid,
                unit_id=uid,
                name=clinic["name"],
                day=clinic["day"],
                start_time=clinic["start"],
                end_time=clinic["end"],
                room=clinic["room"],
            )
        for i in range(h["labour_table_count"]):
            if not lr:
                break
            wid = list(lr.values())[i % len(lr)]
            add(
                "labour_tables",
                table_id=f"LT-SYN-{hi + 1:03d}-{i + 1:02d}",
                hospital_id=hid,
                ward_id=wid,
                label=f"{next(k for k, v in lr.items() if v == wid)} · table {i // len(lr) + 1}",
            )
        # Equipment required by this hospital prototype, in addition to base assets.
        for typ, target in cfg["equipment"].items():
            target_wards = (
                list(anc.values())
                if target == "anc"
                else list(lr.values())
                if target == "labour"
                else list(nicu.values())
                if target == "nicu"
                else [
                    r["ward_id"]
                    for r in rows(
                        "SELECT ward_id FROM critical_care_units WHERE hospital_id=?",
                        (hid,),
                    )
                ]
            )
            for wid in target_wards:
                if not rows(
                    "SELECT equipment_id FROM equipment WHERE ward_id=? AND type=?",
                    (wid, typ),
                ):
                    add(
                        "equipment",
                        equipment_id=f"EQ-ADMIN-SYN-{hi + 1:03d}-{wid}-{typ.replace(' ', '-')}",
                        hospital_id=hid,
                        ward_id=wid,
                        type=typ,
                        installed_quantity=1,
                        functional_quantity=1,
                        status="functional",
                        last_service_date="2026-10-01",
                    )
        for b in rows("SELECT * FROM blood_bank WHERE hospital_id=?", (hid,)):
            for ago in range(7):
                for ci, (component, ratio) in enumerate(
                    cfg["blood_components"].items()
                ):
                    add(
                        "blood_stock_snapshots",
                        snapshot_id=f"BLOOD-SYN-{hi + 1}-{b['blood_group']}-{ago}-{ci}",
                        hospital_id=hid,
                        snapshot_date=(
                            date.fromisoformat(snapshot) - timedelta(days=ago)
                        ).isoformat(),
                        blood_group=b["blood_group"],
                        component=component,
                        units_available=max(
                            0,
                            round(b["units_available"] * ratio)
                            + (ago % 3 - 1 if b["units_available"] else 0),
                        ),
                    )
        for i in range(h["has_ambulance_count"]):
            typ = (
                "Neonatal transport" if i == 2 and nicu else "ALS" if i == 1 else "BLS"
            )
            add(
                "ambulances",
                ambulance_id=f"AMB-SYN-{hi + 1:03d}-{i + 1:02d}",
                hospital_id=hid,
                vehicle_label=f"SYNTHETIC ambulance {hi + 1:03d}-{i + 1:02d}",
                type=typ,
                status="available" if i % 4 != 3 else "maintenance",
                oxygen_supported=1,
                neonatal_transport=int(typ == "Neonatal transport"),
                last_service_date="2026-09-30",
            )
    # Each mother has one explicit unit/ward/LR/doctor chain at her registered hospital.
    for m in rows(
        "SELECT m.*,p.pregnancy_id FROM mothers m JOIN pregnancies p USING(mother_id)"
    ):
        uid = primary_doctors[m["assigned_obgyn_id"]]
        unit = rows("SELECT * FROM clinical_units WHERE unit_id=?", (uid,))[0]
        add(
            "mother_unit_assignments",
            mother_id=m["mother_id"],
            pregnancy_id=m["pregnancy_id"],
            hospital_id=m["registered_hospital_id"],
            unit_id=uid,
            ward_id=unit["anc_ward_id"],
            labour_room_id=unit["labour_room_id"],
            assigned_doctor_id=m["assigned_obgyn_id"],
        )
    # Unit OPD/OT weekly slots, replacing the generic schedule for linked clinicians.
    for did, uid in primary_doctors.items():
        u = rows("SELECT * FROM clinical_units WHERE unit_id=?", (uid,))[0]
        db.execute("DELETE FROM doctor_schedules WHERE doctor_id=?", (did,))
        for kind, weekday in [
            ("ANC clinic", u["anc_day"]),
            ("Gynae OPD", u["gynae_day"]),
            (
                "Family planning" if u["code"] == "FP" else "Well-baby clinic",
                u["opd_day"],
            ),
            ("OT list", u["ot_day"]),
        ]:
            if weekday is not None:
                add(
                    "doctor_schedules",
                    schedule_id=f"SCH-ADMIN-{did}-{kind}",
                    doctor_id=did,
                    day=weekday,
                    start_time="14:00" if kind == "Family planning" else "08:00",
                    end_time="16:00" if kind == "Family planning" else "13:00",
                    clinic_type=kind,
                    is_on_call=0,
                )
    # Keep every appointment on a real weekly slot and respect daily capacity.
    loads = defaultdict(int)
    for ap in rows(
        "SELECT a.*,d.max_daily_patients FROM appointments a JOIN doctors d USING(doctor_id) ORDER BY a.appointment_date,a.appointment_id"
    ):
        slots = rows(
            "SELECT * FROM doctor_schedules WHERE doctor_id=? AND is_on_call=0 ORDER BY day,start_time",
            (ap["doctor_id"],),
        )
        dt = date.fromisoformat(ap["appointment_date"])
        direction = 1 if dt > date.fromisoformat(snapshot) else -1
        while True:
            valid = [s for s in slots if s["day"] == dt.weekday()]
            key = (ap["doctor_id"], dt.isoformat())
            if valid and loads[key] < ap["max_daily_patients"]:
                break
            dt += timedelta(days=direction)
        minute = 8 * 60 + loads[key] * 10
        loads[key] += 1
        db.execute(
            "UPDATE appointments SET appointment_date=?,start_time=?,end_time=? WHERE appointment_id=?",
            (
                dt.isoformat(),
                f"{minute // 60:02d}:{minute % 60:02d}",
                f"{(minute + 10) // 60:02d}:{(minute + 10) % 60:02d}",
                ap["appointment_id"],
            ),
        )
    # Link every birth to an existing unit and one free labour table at birth.
    occupied = defaultdict(list)
    for d in rows("SELECT * FROM delivery_records ORDER BY delivered_at,delivery_id"):
        ma = rows(
            "SELECT * FROM mother_unit_assignments WHERE pregnancy_id=?",
            (d["pregnancy_id"],),
        )[0]
        uid = (
            ma["unit_id"]
            if ma["hospital_id"] == d["hospital_id"]
            else primary_doctors[d["delivering_doctor_id"]]
        )
        u = rows("SELECT * FROM clinical_units WHERE unit_id=?", (uid,))[0]
        delivering = rows(
            'SELECT d.doctor_id FROM doctor_units du JOIN doctors d USING(doctor_id) WHERE du.unit_id=? AND d.specialty IN ("Obstetrician/Gynaecologist","Medical Officer") ORDER BY d.doctor_id',
            (uid,),
        )[0]["doctor_id"]
        db.execute(
            "UPDATE delivery_records SET delivering_doctor_id=? WHERE delivery_id=?",
            (delivering, d["delivery_id"]),
        )
        birth = datetime.fromisoformat(d["delivered_at"])
        start = birth - timedelta(minutes=45)
        end = birth + timedelta(minutes=30)
        tables = rows(
            "SELECT * FROM labour_tables WHERE hospital_id=? AND ward_id=? ORDER BY table_id",
            (d["hospital_id"], u["labour_room_id"]),
        )
        chosen = None
        for attempt in range(6):
            chosen = next(
                (
                    t
                    for t in tables
                    if not any(
                        start < e and s < end for s, e in occupied[t["table_id"]]
                    )
                ),
                None,
            )
            if chosen:
                break
            birth -= timedelta(minutes=90)
            start = birth - timedelta(minutes=45)
            end = birth + timedelta(minutes=30)
        if chosen:
            db.execute(
                "UPDATE delivery_records SET delivered_at=? WHERE delivery_id=?",
                (birth.isoformat(), d["delivery_id"]),
            )
        if chosen is None:
            raise RuntimeError(
                f"No free labour table for {d['delivery_id']}; increase configured tables."
            )
        if chosen["ward_id"] != u["labour_room_id"]:
            candidate = rows(
                "SELECT u.*,du.doctor_id FROM clinical_units u JOIN doctor_units du USING(unit_id) WHERE u.hospital_id=? AND u.labour_room_id=?",
                (d["hospital_id"], chosen["ward_id"]),
            )[0]
            uid = candidate["unit_id"]
            db.execute(
                "UPDATE delivery_records SET delivering_doctor_id=? WHERE delivery_id=?",
                (candidate["doctor_id"], d["delivery_id"]),
            )
        occupied[chosen["table_id"]].append((start, end))
        add(
            "delivery_allocations",
            delivery_id=d["delivery_id"],
            unit_id=uid,
            labour_room_id=chosen["ward_id"],
            labour_table_id=chosen["table_id"],
            bed_id=d["bed_id"],
            started_at=start.isoformat(),
            ended_at=end.isoformat(),
        )
    # Give every staff shift its own fictional worker, instead of one worker on 24h duty.
    for w in rows("SELECT * FROM wards ORDER BY ward_id"):
        staff = rows("SELECT * FROM nurses_midwives WHERE ward_id=?", (w["ward_id"],))
        for i in range(len(staff), 3):
            sid = f"NURSE-ADMIN-SYN-{w['ward_id']}-{i}"
            add(
                "nurses_midwives",
                staff_id=sid,
                hospital_id=w["hospital_id"],
                ward_id=w["ward_id"],
                name=f"SYNTHETIC Nurse {w['ward_id'][-4:]} {i + 1}",
                designation="Nurse-midwife",
                languages_spoken="Hindi,English",
            )
            staff.append({"staff_id": sid})
        for ago in range(7):
            rd = (date.fromisoformat(snapshot) - timedelta(days=ago)).isoformat()
            for i, (name, start, end) in enumerate(
                [
                    ("Night", "00:00", "08:00"),
                    ("Day", "08:00", "16:00"),
                    ("Evening", "16:00", "23:59"),
                ]
            ):
                add(
                    "shift_rosters",
                    roster_id=f"ROSTER-SYN-{w['ward_id']}-{ago}-{i}",
                    hospital_id=w["hospital_id"],
                    doctor_id=None,
                    staff_id=staff[i]["staff_id"],
                    ward_id=w["ward_id"],
                    roster_date=rd,
                    shift=name,
                    start_time=start,
                    end_time=end,
                    role="Ward nursing cover",
                )
    for hi, h in enumerate(hospitals):
        hid = h["hospital_id"]
        docs = rows("SELECT * FROM doctors WHERE hospital_id=?", (hid,))
        for ago in range(7):
            rd = date.fromisoformat(snapshot) - timedelta(days=ago)
            free = [
                d
                for d in docs
                if not rows(
                    "SELECT * FROM doctor_schedules WHERE doctor_id=? AND day=? AND start_time<? AND end_time>?",
                    (d["doctor_id"], rd.weekday(), "16:00", "08:00"),
                )
            ]
            doctor = (free or docs)[ago % len(free or docs)]
            add(
                "shift_rosters",
                roster_id=f"ONCALL-SYN-{hi + 1}-{ago}",
                hospital_id=hid,
                doctor_id=doctor["doctor_id"],
                staff_id=None,
                ward_id=None,
                roster_date=rd.isoformat(),
                shift="Day on-call",
                start_time="08:00",
                end_time="16:00",
                role="Hospital on-call clinician",
            )
        nurses = rows(
            "SELECT count(*) n FROM nurses_midwives WHERE hospital_id=?", (hid,)
        )[0]["n"]
        bycadre = defaultdict(int)
        for d in docs:
            bycadre[d["designation"]] += 1
        bycadre.update(
            {
                "Nurse / midwife": nurses,
                "Lab technician": max(2, len(docs) // 3),
                "Ambulance driver": h["has_ambulance_count"],
                "Administrative officer": len(cfg["roles"]),
            }
        )
        for i, (cadre, filled) in enumerate(bycadre.items()):
            add(
                "staffing_establishment",
                post_id=f"POST-SYN-{hi + 1}-{i}",
                hospital_id=hid,
                cadre=cadre,
                sanctioned=filled + max(1, filled // 6),
                in_position=filled,
            )
    # Seed history from actual admissions; current snapshot is the final state.
    for a in rows("SELECT * FROM admissions ORDER BY admitted_at,admission_id"):
        add(
            "bed_state_history",
            bed_id=a["bed_id"],
            previous_status="available",
            status="occupied",
            patient_id=a["patient_id"],
            mother_id=None,
            effective_at=a["admitted_at"],
            reason=a["admission_reason"],
            actor="Synthetic dataset",
        )
        if a["discharged_at"]:
            add(
                "bed_state_history",
                bed_id=a["bed_id"],
                previous_status="occupied",
                status="available",
                patient_id=a["patient_id"],
                mother_id=None,
                effective_at=a["discharged_at"],
                reason="Discharged from recorded admission",
                actor="Synthetic dataset",
            )
    for b in rows("SELECT * FROM beds"):
        add(
            "hospital_bed_states",
            bed_id=b["bed_id"],
            status=b["status"],
            reserved_for_mother_id=None,
            reservation_reason=None,
            updated_at=now,
        )
        add(
            "bed_state_history",
            bed_id=b["bed_id"],
            previous_status=None,
            status=b["status"],
            patient_id=b["current_patient_id"],
            mother_id=None,
            effective_at=now,
            reason="Verified synthetic snapshot",
            actor="Synthetic dataset",
        )
    # A small, explicit incoming-case reservation sample, linked to an ongoing
    # clinician-confirmed high-risk pregnancy at a capable facility.
    for h in hospitals:
        if h["tier"] not in (
            "Medical College Hospital",
            "District Hospital",
            "Private Multispecialty",
        ):
            continue
        candidates = rows(
            'SELECT m.mother_id,a.ward_id FROM mothers m JOIN pregnancies p USING(mother_id) JOIN mother_unit_assignments a USING(mother_id) WHERE m.registered_hospital_id=? AND p.confirmed_high_risk=1 AND p.outcome="ongoing" AND NOT EXISTS(SELECT 1 FROM admissions x WHERE x.patient_id=m.mother_id AND x.discharged_at IS NULL) ORDER BY m.mother_id',
            (h["hospital_id"],),
        )
        for case in candidates:
            bed = rows(
                'SELECT b.bed_id FROM beds b JOIN hospital_bed_states s USING(bed_id) WHERE b.ward_id=? AND s.status="available" ORDER BY b.bed_id LIMIT 1',
                (case["ward_id"],),
            )
            if not bed:
                continue
            bid = bed[0]["bed_id"]
            reason = (
                "Incoming clinician-confirmed high-risk case — synthetic reservation"
            )
            db.execute(
                'UPDATE hospital_bed_states SET status="reserved",reserved_for_mother_id=?,reservation_reason=? WHERE bed_id=?',
                (case["mother_id"], reason, bid),
            )
            add(
                "bed_state_history",
                bed_id=bid,
                previous_status="available",
                status="reserved",
                patient_id=None,
                mother_id=case["mother_id"],
                effective_at=now,
                reason=reason,
                actor="Synthetic bed coordinator",
            )
            break
    # All remaining wards get a readable, stable location label.
    for w in rows(
        "SELECT * FROM wards WHERE ward_id NOT IN (SELECT ward_id FROM ward_labels)"
    ):
        add(
            "ward_labels",
            ward_id=w["ward_id"],
            label=w["ward_type"].capitalize(),
            care_area=w["ward_type"],
        )
    db.commit()
    errors = validate(db, cfg)
    if errors:
        raise RuntimeError("\n".join(errors[:20]))
    db.execute("PRAGMA optimize")
    db.close()
    temp.replace(destination)
    report = {
        "passed": True,
        "source": source.name,
        "output": destination.name,
        "as_of_date": snapshot,
        "checks": [
            "foreign keys",
            "ward and hospital bed totals",
            "six-unit mappings",
            "mother-unit-doctor-ward chain",
            "delivery allocation capacity",
            "unit OPD schedules",
            "appointment capacity",
            "NICU admission intervals",
            "critical HDU beds",
        ],
    }
    destination.with_suffix(".validation.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps(report, indent=2))


def validate(db, cfg):
    errors = []

    def fail(sql, title):
        n = db.execute(sql).fetchone()[0]
        if n:
            errors.append(f"{title}: {n}")

    if db.execute("PRAGMA foreign_key_check").fetchall():
        errors.append("Foreign key violations")
    fail(
        "SELECT count(*) FROM wards w WHERE capacity<>(SELECT count(*) FROM beds b WHERE b.ward_id=w.ward_id)",
        "Ward capacity mismatch",
    )
    fail(
        "SELECT count(*) FROM hospitals h WHERE total_beds<>(SELECT count(*) FROM beds b JOIN wards w USING(ward_id) WHERE w.hospital_id=h.hospital_id)",
        "Hospital capacity mismatch",
    )
    fail(
        "SELECT count(*) FROM mother_unit_assignments m JOIN doctor_units d ON d.doctor_id=m.assigned_doctor_id JOIN clinical_units u ON u.unit_id=m.unit_id WHERE m.unit_id<>d.unit_id OR m.hospital_id<>u.hospital_id OR m.ward_id<>u.anc_ward_id OR m.labour_room_id<>u.labour_room_id",
        "Mother assignment mismatch",
    )
    fail(
        "SELECT count(*) FROM delivery_allocations a JOIN delivery_records d USING(delivery_id) JOIN labour_tables t ON t.table_id=a.labour_table_id JOIN clinical_units u ON u.unit_id=a.unit_id JOIN doctor_units du ON du.doctor_id=d.delivering_doctor_id WHERE d.hospital_id<>t.hospital_id OR t.ward_id<>a.labour_room_id OR u.labour_room_id<>a.labour_room_id OR du.unit_id<>a.unit_id",
        "Delivery location mismatch",
    )
    fail(
        "SELECT count(*) FROM delivery_allocations a JOIN delivery_allocations b ON a.labour_table_id=b.labour_table_id AND a.delivery_id<b.delivery_id AND a.started_at<b.ended_at AND b.started_at<a.ended_at",
        "Labour table overlap",
    )
    fail(
        "SELECT count(*) FROM (SELECT doctor_id,appointment_date,count(*) n FROM appointments GROUP BY 1,2) a JOIN doctors d USING(doctor_id) WHERE a.n>d.max_daily_patients",
        "Doctor daily load",
    )
    fail(
        'SELECT count(*) FROM appointments a WHERE NOT EXISTS(SELECT 1 FROM doctor_schedules s WHERE s.doctor_id=a.doctor_id AND s.day=(CAST(strftime("%w",a.appointment_date) AS INTEGER)+6)%7 AND s.start_time<=a.start_time AND s.end_time>=a.end_time)',
        "Appointment outside weekly OPD",
    )
    for h in db.execute(
        "SELECT hospital_id FROM hospitals WHERE tier='Medical College Hospital'"
    ):
        for kind in ("obg", "paediatrics"):
            count = db.execute(
                'SELECT count(*) FROM clinical_units WHERE hospital_id=? AND department=? AND code<>"FP"',
                (h[0], kind),
            ).fetchone()[0]
            if count != 6:
                errors.append(f"{h[0]} {kind} has {count} clinical units")
    for did, day_, kind in db.execute(
        "SELECT doctor_id,day,clinic_type FROM doctor_schedules WHERE doctor_id IN (SELECT doctor_id FROM doctor_units)"
    ):
        u = db.execute(
            "SELECT u.* FROM clinical_units u JOIN doctor_units d USING(unit_id) WHERE d.doctor_id=?",
            (did,),
        ).fetchone()
        expected = {
            "ANC clinic": u["anc_day"],
            "Gynae OPD": u["gynae_day"],
            "Well-baby clinic": u["opd_day"],
            "Family planning": u["opd_day"],
            "OT list": u["ot_day"],
        }[kind]
        if day_ != expected:
            errors.append(f"{did} schedule not aligned to unit")
    # Exclusive inpatient intervals are unchanged by ward relabeling/splitting.
    fail(
        'SELECT count(*) FROM admissions a JOIN admissions b ON a.bed_id=b.bed_id AND a.admission_id<b.admission_id AND a.admitted_at<coalesce(b.discharged_at,"9999") AND b.admitted_at<coalesce(a.discharged_at,"9999")',
        "Inpatient bed overlap",
    )
    flagship = db.execute(
        "SELECT hospital_id FROM hospitals ORDER BY hospital_id LIMIT 1"
    ).fetchone()[0]
    n = db.execute(
        "SELECT capacity FROM wards WHERE hospital_id=? AND ward_type='obstetric ICU/HDU'",
        (flagship,),
    ).fetchone()
    if n and n[0] != cfg["flagship_obstetric_hdu_beds"]:
        errors.append("Flagship HDU count")
    return errors


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, default=ROOT / "output/dai.db")
    p.add_argument(
        "--output", type=Path, default=ROOT.parent / "backend/data/dai-hospital.db"
    )
    p.add_argument("--config", type=Path, default=ROOT / "hospital_admin_config.json")
    a = p.parse_args()
    build(a.source, a.output, a.config)
