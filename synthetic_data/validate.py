#!/usr/bin/env python3
"""Independent audits of the exported SQLite and CSV dataset; nonzero on failure."""

from __future__ import annotations
import argparse
import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from pathlib import Path
from core import (
    ROOT,
    SPECS,
    AUTO_FLAGS,
    SEVERE,
    SCENARIOS,
    STAGES,
    columns,
    fk_specs,
    day,
    iso,
    stage,
    haversine,
    vaccine_due,
    vaccine_status,
    derive_gaps,
)


class Audit:
    def __init__(self):
        self.rules = {}
        self.current = None

    def begin(self, key, title):
        self.current = {
            "rule": key,
            "title": title,
            "checked": 0,
            "failures": 0,
            "examples": [],
        }
        self.rules[str(key)] = self.current

    def check(self, ok, detail):
        r = self.current
        r["checked"] += 1
        if not ok:
            r["failures"] += 1
            if len(r["examples"]) < 8:
                r["examples"].append(str(detail))

    def finish(self):
        for r in self.rules.values():
            print(
                f"{'PASS' if r['failures'] == 0 else 'FAIL'} | {str(r['rule']):>8} | {r['title']:<50} | checked={r['checked']:,} failures={r['failures']:,}"
            )
            for e in r["examples"]:
                print("    " + e)
        return all(r["failures"] == 0 for r in self.rules.values())


def dt(v):
    return datetime.fromisoformat(str(v))


def validate_output(out: Path, write_report=True):
    out = Path(out)
    cfg = json.loads((out / "config.snapshot.json").read_text())
    asof = day(cfg["as_of_date"])
    now = datetime.combine(asof, time(12))
    con = sqlite3.connect(out / "dai.db")
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    data = {
        t: [dict(r) for r in con.execute(f"SELECT * FROM {t} ORDER BY {columns(t)[0]}")]
        for t in SPECS
    }
    idx = {t: {r[columns(t)[0]]: r for r in rows} for t, rows in data.items()}
    a = Audit()
    h = idx["hospitals"]
    doctors = idx["doctors"]
    mothers = idx["mothers"]
    pregs = idx["pregnancies"]
    beds = idx["beds"]
    wards = idx["wards"]
    services = idx["hospital_services"]
    bypreg = defaultdict(list)
    for r in data["anc_visits"]:
        bypreg[r["pregnancy_id"]].append(r)
    refs = defaultdict(set)
    for r in data["referrals"]:
        refs[r["pregnancy_id"]].add(r["referred_to_hospital_id"])
        refs[r["pregnancy_id"]].add(r["referred_from_hospital_id"])
    conditions = {
        p["pregnancy_id"]: set(json.loads(p["conditions"])) for p in data["pregnancies"]
    }
    delivery = {d["pregnancy_id"]: d for d in data["delivery_records"]}
    a.begin(1, "All foreign keys and SQL integrity")
    fk_errors = con.execute("PRAGMA foreign_key_check").fetchall()
    a.check(not fk_errors, str(fk_errors))
    a.check(
        con.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "SQLite integrity"
    )
    for table, col, parent, key in fk_specs():
        for row in data[table]:
            a.check(
                row[col] is None or row[col] in idx[parent],
                f"{table}.{col}: {row[col]}",
            )
    for table, rows in data.items():
        a.check(len(rows) == len(idx[table]), f"Duplicate PK {table}")
    a.begin(2, "Doctor, department, hospital and referral match")
    for d in data["doctors"]:
        a.check(
            idx["departments"][d["department_id"]]["hospital_id"] == d["hospital_id"],
            d["doctor_id"],
        )
    clinical = [
        ("anc_visits", "doctor_id"),
        ("investigations", "ordered_by_doctor_id"),
        ("delivery_records", "delivering_doctor_id"),
        ("postpartum_visits", "doctor_id"),
        ("appointments", "doctor_id"),
    ]
    for table, col in clinical:
        for r in data[table]:
            a.check(
                doctors[r[col]]["hospital_id"] == r["hospital_id"],
                f"{table}:{r[col]} at {r['hospital_id']}",
            )
            p = pregs[r["pregnancy_id"]]
            home = mothers[p["mother_id"]]["registered_hospital_id"]
            a.check(
                r["hospital_id"] == home or r["hospital_id"] in refs[r["pregnancy_id"]],
                f"Missing referral {table}:{r[columns(table)[0]]}",
            )
    for r in data["referrals"]:
        a.check(
            doctors[r["referring_doctor_id"]]["hospital_id"]
            == r["referred_from_hospital_id"],
            r["referral_id"],
        )
        a.check(
            doctors[r["receiving_doctor_id"]]["hospital_id"]
            == r["referred_to_hospital_id"],
            r["referral_id"],
        )
    a.begin(3, "Assigned clinician works at registered hospital")
    for m in data["mothers"]:
        d = doctors[m["assigned_obgyn_id"]]
        a.check(d["hospital_id"] == m["registered_hospital_id"], m["mother_id"])
        a.check(
            d["specialty"] == "Obstetrician/Gynaecologist"
            or h[d["hospital_id"]]["tier"] == "PHC"
            and d["specialty"] == "Medical Officer",
            m["mother_id"],
        )
    a.begin(4, "Chronology and no future recorded events")
    future_allowed = {"due_date", "edd", "appointment_date"}
    for table, rows in data.items():
        for r in rows:
            for spec in SPECS[table].split(";"):
                col, typ = spec.strip().split()[:2]
                if typ not in ("DATE", "TIMESTAMP") or not r[col]:
                    continue
                if col in future_allowed:
                    continue
                if (
                    table == "pregnancies"
                    and col == "lmp"
                    and r["current_stage"] == "Preconception"
                ):
                    continue
                a.check(day(r[col]) <= asof, f"Future {table}.{col}: {r[col]}")
                if typ == "TIMESTAMP":
                    a.check(
                        dt(r[col]) <= now, f"After snapshot {table}.{col}: {r[col]}"
                    )
    for p in data["pregnancies"]:
        lmp = day(p["lmp"])
        end = day(p["outcome_date"]) if p["outcome_date"] else asof
        visits = sorted(bypreg[p["pregnancy_id"]], key=lambda v: v["visit_date"])
        dates = [v["visit_date"] for v in visits]
        a.check(
            len(dates) == len(set(dates)), f"Duplicate ANC date {p['pregnancy_id']}"
        )
        for v in visits:
            a.check(
                lmp < day(v["visit_date"]) <= end
                and (not p["outcome_date"] or day(v["visit_date"]) < end),
                v["visit_id"],
            )
            a.check(v["visit_date"] <= v["entered_at"], v["visit_id"])
        if p["outcome_date"]:
            a.check(lmp < end <= asof, p["pregnancy_id"])
    for d in data["delivery_records"]:
        a.check(dt(d["admitted_at"]) < dt(d["delivered_at"]), d["delivery_id"])
        a.check(
            d["discharged_at"] is None
            or dt(d["delivered_at"]) < dt(d["discharged_at"]),
            d["delivery_id"],
        )
    for r in data["postpartum_visits"]:
        d = delivery[r["pregnancy_id"]]
        birth = day(d["delivered_at"])
        a.check(day(r["visit_date"]) > birth, r["pnc_id"])
        a.check((day(r["visit_date"]) - birth).days == r["postpartum_day"], r["pnc_id"])
        if r["care_setting"] == "post_discharge":
            a.check(
                d["discharged_at"] is not None
                and dt(d["discharged_at"])
                <= datetime.combine(day(r["visit_date"]), time(10)),
                r["pnc_id"],
            )
    for r in data["investigations"]:
        a.check(
            (r["status"] == "done") == bool(r["completed_date"]), r["investigation_id"]
        )
        a.check(
            r["completed_date"] is not None
            or (r["result_value"] is None and r["result_flag"] is None),
            r["investigation_id"],
        )
        p = pregs[r["pregnancy_id"]]
        end = day(p["outcome_date"]) if p["outcome_date"] else asof
        a.check(
            day(p["lmp"]) <= day(r["ordered_date"]) <= day(r["due_date"]),
            r["investigation_id"],
        )
        if r["completed_date"]:
            a.check(
                day(r["ordered_date"]) <= day(r["completed_date"]) <= end,
                r["investigation_id"],
            )
    for r in data["vaccinations"]:
        if not r["given_date"]:
            continue
        birth = (
            day(idx["newborns"][r["child_id"]]["date_of_birth"])
            if r["child_id"]
            else day(pregs[r["pregnancy_id"]]["lmp"])
        )
        a.check(day(r["given_date"]) >= birth, r["vaccination_id"])
        if r["child_id"]:
            c = idx["newborns"][r["child_id"]]
            a.check(
                not c["death_date"] or r["given_date"] <= c["death_date"],
                r["vaccination_id"],
            )
    for r in data["appointments"]:
        if day(r["appointment_date"]) > asof:
            a.check(r["status"] in ("booked", "rescheduled"), r["appointment_id"])
    for r in data["growth_records"]:
        c = idx["newborns"][r["child_id"]]
        a.check(
            day(c["date_of_birth"]) <= day(r["measured_on"]) <= asof, r["growth_id"]
        )
        a.check(
            not c["death_date"] or r["measured_on"] <= c["death_date"], r["growth_id"]
        )
    a.begin(5, "Computed gestational week and stage")
    for p in data["pregnancies"]:
        end = day(p["outcome_date"]) if p["outcome_date"] else asof
        expected = max(0, (end - day(p["lmp"])).days // 7)
        a.check(p["current_gestational_week"] == expected, p["pregnancy_id"])
        a.check(p["current_stage"] == stage(p, asof), p["pregnancy_id"])
        for v in bypreg[p["pregnancy_id"]]:
            a.check(
                v["gestational_week_at_visit"]
                == (day(v["visit_date"]) - day(p["lmp"])).days // 7,
                v["visit_id"],
            )
    a.begin(6, "EDD, gestation and preterm/post-term labels")
    for p in data["pregnancies"]:
        a.check(day(p["edd"]) == day(p["lmp"]) + timedelta(days=280), p["pregnancy_id"])
    for d in data["delivery_records"]:
        ga = (day(d["delivered_at"]) - day(pregs[d["pregnancy_id"]]["lmp"])).days // 7
        a.check(ga == d["gestational_age_at_birth"], d["delivery_id"])
        a.check(
            d["birth_timing"]
            == ("preterm" if ga < 37 else "post-term" if ga >= 42 else "term"),
            d["delivery_id"],
        )
    a.begin(7, "Plurality, stillbirths and separate sibling records")
    siblings = defaultdict(list)
    for t in ("newborns", "stillbirths"):
        for c in data[t]:
            siblings[c["pregnancy_id"]].append((t, c))
    for p in data["pregnancies"]:
        children = siblings[p["pregnancy_id"]]
        if p["pregnancy_id"] in delivery:
            a.check(len(children) == p["plurality_count"], p["pregnancy_id"])
            a.check(
                sorted(c["birth_order"] for _, c in children)
                == list(range(1, p["plurality_count"] + 1)),
                p["pregnancy_id"],
            )
            d = delivery[p["pregnancy_id"]]
            for t, c in children:
                a.check(
                    c["mother_id"] == p["mother_id"]
                    and c["delivery_id"] == d["delivery_id"]
                    and c["date_of_birth"] == d["delivered_at"][:10],
                    c[columns(t)[0]],
                )
        else:
            a.check(not children, p["pregnancy_id"])
    a.begin(8, "Clinical values, risk evidence and validation")
    investigations = defaultdict(list)
    for r in data["investigations"]:
        investigations[r["pregnancy_id"]].append(r)
    flags = defaultdict(list)
    for f in data["risk_flags"]:
        flags[f["pregnancy_id"]].append(f)
    for p in data["pregnancies"]:
        pid = p["pregnancy_id"]
        cond = conditions[pid]
        hb = p["clinical_hb"]
        sbp = p["clinical_sbp"]
        dbp = p["clinical_dbp"]
        a.check(15 <= mothers[p["mother_id"]]["age"] <= 45, pid)
        for code, lo, hi in [
            ("anaemia_mild", 10, 10.999),
            ("anaemia_moderate", 7, 9.999),
            ("anaemia_severe", 0, 6.999),
        ]:
            if code in cond:
                a.check(lo <= hb <= hi, f"{pid}: {code} Hb={hb}")
        if not any(c.startswith("anaemia_") for c in cond):
            a.check(hb >= 11, pid)
        if cond & {
            "gestational_hypertension",
            "preeclampsia",
            "severe_preeclampsia",
            "eclampsia",
            "hellp",
        }:
            a.check(sbp >= 140 or dbp >= 90, f"{pid}: hypertension BP")
        if cond & {"severe_preeclampsia", "eclampsia", "hellp"}:
            a.check(sbp >= 160 or dbp >= 110, f"{pid}: severe BP")
        if "gdm" in cond:
            a.check(
                p["ogtt_2h_mg_dl"] >= cfg["clinical"]["gdm_threshold_2h_mg_dl"],
                f"{pid}: GDM OGTT",
            )
            done = [
                r
                for r in investigations[pid]
                if r["test_type"] == "OGTT" and r["status"] == "done"
            ]
            a.check(bool(done), f"{pid}: no completed diagnostic OGTT")
        for r in investigations[pid]:
            if r["test_type"] == "OGTT" and r["completed_date"]:
                a.check(
                    abs(float(r["result_value"]) - p["ogtt_2h_mg_dl"]) < 0.01,
                    r["investigation_id"],
                )
            if r["test_type"] == "Hb" and r["completed_date"]:
                a.check(
                    abs(float(r["result_value"]) - hb) < 0.01, r["investigation_id"]
                )
        for v in bypreg[pid]:
            a.check(
                abs(v["hb"] - hb) < 0.01
                and 50 <= v["bp_diastolic"] < v["bp_systolic"] <= 250,
                v["visit_id"],
            )
        auto = cond & AUTO_FLAGS
        if p["plurality_count"] == 2:
            auto |= {"twins"}
        if p["plurality_count"] == 3:
            auto |= {"triplets"}
        if p["plurality_count"] == 4:
            auto |= {"quadruplets"}
        actual = {f["risk_type"] for f in flags[pid] if f["raised_by"] == "rule engine"}
        a.check(auto <= actual, f"{pid}: missing automatic flags {auto - actual}")
        confirmed = False
        for f in flags[pid]:
            if f["validation_status"] == "confirmed":
                a.check(f["validated_by_doctor_id"] is not None, f["flag_id"])
                if f["validated_by_doctor_id"]:
                    dr = doctors[f["validated_by_doctor_id"]]
                    allowed = {
                        mothers[p["mother_id"]]["registered_hospital_id"]
                    } | refs[pid]
                    a.check(
                        dr["high_risk_pregnancy_certified"]
                        and dr["hospital_id"] in allowed,
                        f["flag_id"],
                    )
                if f["severity"] == "high":
                    confirmed = True
        a.check(bool(p["confirmed_high_risk"]) == confirmed, pid)
    singleton = []
    multiples = []
    for c in data["newborns"]:
        p = pregs[c["pregnancy_id"]]
        ga = c["gestational_age"]
        count = p["plurality_count"]
        a.check(500 <= c["birth_weight_g"] <= 5000 and 22 <= ga <= 43, c["child_id"])
        a.check(0 <= c["apgar_1min"] <= c["apgar_5min"] <= 10, c["child_id"])
        a.check(
            c["gestational_age"]
            == delivery[c["pregnancy_id"]]["gestational_age_at_birth"],
            c["child_id"],
        )
        (singleton if count == 1 else multiples).append(c)
    if singleton and multiples:
        for col in ("birth_weight_g", "gestational_age"):
            a.check(
                sum(c[col] for c in multiples) / len(multiples)
                < sum(c[col] for c in singleton) / len(singleton),
                f"Multiples average {col}",
            )
    for r in data["growth_records"]:
        a.check(
            bool(r["underweight"])
            == (r["weight_for_age_z"] is not None and r["weight_for_age_z"] < -2),
            r["growth_id"],
        )
        a.check(
            bool(r["stunting"])
            == (r["height_for_age_z"] is not None and r["height_for_age_z"] < -2),
            r["growth_id"],
        )
        a.check(
            bool(r["wasting"])
            == (r["weight_for_height_z"] is not None and r["weight_for_height_z"] < -2),
            r["growth_id"],
        )
    a.begin(9, "Delivery, NICU, transfusion and referral capabilities")
    for d in data["delivery_records"]:
        s = services[d["hospital_id"]]
        p = pregs[d["pregnancy_id"]]
        cond = conditions[p["pregnancy_id"]]
        if d["mode"].endswith("LSCS"):
            a.check(
                s["c_section"] and s["emergency_obstetric_care"] == "CEmOC",
                d["delivery_id"],
            )
        if d["transfusion_units"]:
            a.check(
                s["blood_transfusion"] and h[d["hospital_id"]]["has_blood_bank"],
                d["delivery_id"],
            )
        if p["plurality_count"] >= 3 or cond & {
            "severe_preeclampsia",
            "eclampsia",
            "hellp",
        }:
            a.check(
                h[d["hospital_id"]]["has_nicu_level"] in ("II", "III")
                and s["obstetric_hdu"],
                d["delivery_id"],
            )
        home = mothers[p["mother_id"]]["registered_hospital_id"]
        if d["hospital_id"] != home:
            r = idx["referrals"].get(d["referral_id"])
            a.check(
                r is not None
                and r["referred_from_hospital_id"] == home
                and r["referred_to_hospital_id"] == d["hospital_id"],
                d["delivery_id"],
            )
    for c in data["newborns"]:
        d = delivery[c["pregnancy_id"]]
        pd = doctors[c["paediatrician_id"]]
        a.check(
            pd["hospital_id"] == d["hospital_id"]
            and pd["specialty"] in ("Paediatrician", "Neonatologist"),
            c["child_id"],
        )
        if c["nicu_admission"]:
            b = beds.get(c["nicu_bed_id"])
            a.check(
                b is not None
                and wards[b["ward_id"]]["ward_type"] == "NICU"
                and wards[b["ward_id"]]["hospital_id"] == d["hospital_id"],
                c["child_id"],
            )
            a.check(h[d["hospital_id"]]["has_nicu_level"] != "none", c["child_id"])
            if any(
                dr["specialty"] == "Neonatologist"
                for dr in data["doctors"]
                if dr["hospital_id"] == d["hospital_id"]
            ):
                a.check(pd["specialty"] == "Neonatologist", c["child_id"])
    for b in data["blood_bank"]:
        a.check(
            h[b["hospital_id"]]["has_blood_bank"] or b["units_available"] == 0,
            b["blood_bank_id"],
        )
    a.begin(10, "Bed census, admissions and concurrent NICU capacity")
    ward_count = Counter(b["ward_id"] for b in data["beds"])
    total = Counter()
    for w in data["wards"]:
        a.check(ward_count[w["ward_id"]] == w["capacity"], w["ward_id"])
        total[w["hospital_id"]] += w["capacity"]
    for hospital in data["hospitals"]:
        a.check(
            total[hospital["hospital_id"]] == hospital["total_beds"],
            hospital["hospital_id"],
        )
    admissions_patient = defaultdict(list)
    admissions_bed = defaultdict(list)
    nicu_events = defaultdict(list)
    active_by_patient = {}
    for adm in data["admissions"]:
        start = dt(adm["admitted_at"])
        end = (
            dt(adm["discharged_at"])
            if adm["discharged_at"]
            else now + timedelta(days=100000)
        )
        a.check(start < end, adm["admission_id"])
        b = beds[adm["bed_id"]]
        w = wards[b["ward_id"]]
        a.check(
            w["hospital_id"] == adm["hospital_id"] and adm["ward_id"] == b["ward_id"],
            adm["admission_id"],
        )
        admissions_patient[adm["patient_id"]].append((start, end, adm["admission_id"]))
        admissions_bed[adm["bed_id"]].append((start, end, adm["admission_id"]))
        if start <= now < end:
            active_by_patient[adm["patient_id"]] = adm
        if w["ward_type"] == "NICU":
            nicu_events[adm["hospital_id"]].extend([(start, 1), (end, -1)])
    for mapping in (admissions_patient, admissions_bed):
        for key, intervals in mapping.items():
            intervals.sort()
            for left, right in zip(intervals, intervals[1:]):
                a.check(
                    left[1] <= right[0],
                    f"Overlapping stays {key}: {left[2]}/{right[2]}",
                )
    occupied = []
    for b in data["beds"]:
        if b["status"] == "occupied":
            occupied.append(b["current_patient_id"])
            adm = active_by_patient.get(b["current_patient_id"])
            a.check(adm is not None and adm["bed_id"] == b["bed_id"], b["bed_id"])
        else:
            a.check(b["current_patient_id"] is None, b["bed_id"])
    a.check(len(occupied) == len(set(occupied)), "Patient in multiple current beds")
    for pid, adm in active_by_patient.items():
        a.check(
            beds[adm["bed_id"]]["current_patient_id"] == pid,
            f"Active admission missing from bed census: {pid}",
        )
    for hid, events in nicu_events.items():
        capacity = sum(
            w["capacity"]
            for w in data["wards"]
            if w["hospital_id"] == hid and w["ward_type"] == "NICU"
        )
        live = 0
        for at, delta in sorted(events, key=lambda x: (x[0], x[1])):
            live += delta
            a.check(live <= capacity, f"{hid}: NICU census {live}/{capacity} at {at}")
    for hospital in data["hospitals"]:
        rows = [
            b
            for b in data["beds"]
            if wards[b["ward_id"]]["hospital_id"] == hospital["hospital_id"]
        ]
        rate = sum(b["status"] == "occupied" for b in rows) / len(rows)
        a.check(
            0.60 <= rate <= 0.95, f"{hospital['hospital_id']}: occupancy {rate:.3f}"
        )
    a.begin(11, "Daily doctor load and non-overlapping slots")
    load = Counter()
    schedule = defaultdict(list)
    appointment_slots = defaultdict(list)
    for s in data["doctor_schedules"]:
        schedule[(s["doctor_id"], s["day"])].append((s["start_time"], s["end_time"]))
    for key, slots in schedule.items():
        slots.sort()
        for left, right in zip(slots, slots[1:]):
            a.check(left[1] <= right[0], f"Overlapping weekly roster {key}")
    for r in data["appointments"]:
        key = (r["doctor_id"], r["appointment_date"])
        load[key] += 1
        appointment_slots[key].append((r["start_time"], r["end_time"]))
        roster = schedule[(r["doctor_id"], day(r["appointment_date"]).weekday())]
        a.check(
            any(st <= r["start_time"] < r["end_time"] <= en for st, en in roster),
            r["appointment_id"],
        )
    for key, count in load.items():
        a.check(count <= doctors[key[0]]["max_daily_patients"], str(key))
    for key, slots in appointment_slots.items():
        slots.sort()
        for left, right in zip(slots, slots[1:]):
            a.check(left[1] <= right[0], str(key))
    a.begin(12, "Functional equipment does not exceed installed assets")
    equipment = defaultdict(lambda: [0, 0])
    for e in data["equipment"]:
        a.check(
            0 <= e["functional_quantity"] <= e["installed_quantity"], e["equipment_id"]
        )
        a.check(
            bool(e["functional_quantity"]) == (e["status"] == "functional"),
            e["equipment_id"],
        )
        a.check(
            wards[e["ward_id"]]["hospital_id"] == e["hospital_id"], e["equipment_id"]
        )
        equipment[(e["ward_id"], e["type"])][0] += e["installed_quantity"]
        equipment[(e["ward_id"], e["type"])][1] += e["functional_quantity"]
    for key, (installed, functional) in equipment.items():
        a.check(functional <= installed, str(key))
    a.begin(13, "UIP due dates, dose timing, completeness and statuses")
    vax = {v[0]: v for v in cfg["vaccines"]}
    maternal = dict(cfg["maternal_vaccines"])
    seen = defaultdict(list)
    for r in data["vaccinations"]:
        if r["child_id"]:
            child = idx["newborns"][r["child_id"]]
            due = vaccine_due(child, vax[r["vaccine_code"]])
            seen[r["child_id"]].append(r["vaccine_code"])
            a.check(
                r["subject_id"] == r["child_id"]
                and r["pregnancy_id"] == child["pregnancy_id"],
                r["vaccination_id"],
            )
            if r["not_applicable_after_death"]:
                a.check(
                    child["death_date"] is not None
                    and due > day(child["death_date"])
                    and r["given_date"] is None,
                    r["vaccination_id"],
                )
        else:
            p = pregs[r["pregnancy_id"]]
            due = day(p["lmp"]) + timedelta(days=maternal[r["vaccine_code"]])
            a.check(
                r["mother_id"] == p["mother_id"] and r["subject_id"] == r["mother_id"],
                r["vaccination_id"],
            )
        a.check(day(r["due_date"]) == due, r["vaccination_id"])
        expected = vaccine_status(
            due, r["given_date"], asof, cfg["care"]["vaccine_grace_days"]
        )
        a.check(r["status"] == expected, r["vaccination_id"])
        if r["status"] == "given":
            a.check(
                r["given_date"] is not None
                and day(r["given_date"])
                >= due - timedelta(days=cfg["care"]["vaccine_allowed_early_days"]),
                r["vaccination_id"],
            )
        a.check(
            services[r["centre_hospital_id"]]["vaccination_centre"], r["vaccination_id"]
        )
    for c in data["newborns"]:
        a.check(sorted(seen[c["child_id"]]) == sorted(vax), c["child_id"])
    a.begin(14, "Care gaps re-derived from base records")
    fresh = derive_gaps(data, cfg)
    saved = sorted(data["care_gaps"], key=lambda r: r["gap_id"])
    a.check(len(fresh) == len(saved), f"Fresh={len(fresh)} saved={len(saved)}")
    bykey = {r["gap_id"]: r for r in fresh}
    for r in saved:
        a.check(r == bykey.get(r["gap_id"]), r["gap_id"])
    # Independently verify expected schedule inventories cannot be removed along
    # with a gap to make the comparison falsely pass.
    expected_anc = defaultdict(list)
    expected_pnc = defaultdict(list)
    for r in data["anc_expected"]:
        expected_anc[r["pregnancy_id"]].append(r["due_date"])
    for r in data["postpartum_expected"]:
        expected_pnc[r["pregnancy_id"]].append(r["due_date"])
    for p in data["pregnancies"]:
        cond = conditions[p["pregnancy_id"]]
        high = bool(
            cond
            & (
                SEVERE
                | {
                    "twins",
                    "triplets",
                    "quadruplets",
                    "gdm",
                    "preexisting_diabetes",
                    "gestational_hypertension",
                    "fgr",
                    "hiv_art",
                    "rh_alloimmunisation",
                }
            )
        )
        weeks = sorted(
            set(
                cfg["care"]["anc_weeks"]
                + (
                    list(range(8, 43, cfg["care"]["high_risk_interval_weeks"]))
                    if high
                    else []
                )
            )
        )
        end = day(p["outcome_date"]) if p["outcome_date"] else asof
        wanted = [
            iso(day(p["lmp"]) + timedelta(days=w * 7))
            for w in weeks
            if day(p["lmp"]) + timedelta(days=w * 7) <= end
            and (not p["outcome_date"] or day(p["lmp"]) + timedelta(days=w * 7) < end)
        ]
        a.check(
            sorted(wanted) == sorted(expected_anc[p["pregnancy_id"]]), p["pregnancy_id"]
        )
        pn = (
            [
                iso(day(p["outcome_date"]) + timedelta(days=n))
                for n in cfg["care"]["pnc_days"]
                if day(p["outcome_date"]) + timedelta(days=n) <= asof
            ]
            if p["pregnancy_id"] in delivery
            else []
        )
        a.check(
            sorted(pn) == sorted(expected_pnc[p["pregnancy_id"]]), p["pregnancy_id"]
        )
    a.begin(15, "SOS nearest eligible hospital and authentication")
    for r in data["emergency_events"]:
        eligible = []
        for hospital in data["hospitals"]:
            ss = services[hospital["hospital_id"]]
            cap = r["required_capability"]
            ok = hospital["is_sos_participating"] and hospital["emergency_24x7"]
            if cap == "c_section":
                ok = (
                    ok and ss["c_section"] and ss["emergency_obstetric_care"] == "CEmOC"
                )
            if cap == "complex_obstetric":
                ok = (
                    ok
                    and ss["c_section"]
                    and ss["obstetric_hdu"]
                    and hospital["has_nicu_level"] in ("II", "III")
                )
            if cap == "transfusion":
                ok = ok and ss["blood_transfusion"] and hospital["has_blood_bank"]
            if cap == "nicu":
                ok = ok and hospital["has_nicu_level"] != "none"
            if cap == "paediatric":
                ok = ok and any(
                    d["specialty"] == "Paediatrician"
                    and d["hospital_id"] == hospital["hospital_id"]
                    for d in data["doctors"]
                )
            if ok:
                eligible.append(
                    (
                        haversine(
                            r["trigger_latitude"],
                            r["trigger_longitude"],
                            hospital["latitude"],
                            hospital["longitude"],
                        ),
                        hospital["hospital_id"],
                    )
                )
        nearest = min(eligible)
        a.check(
            r["nearest_hospital_id"] == nearest[1]
            and abs(r["distance_km"] - nearest[0]) < 1e-5,
            r["event_id"],
        )
        if r["outcome"] == "rejected_unverified":
            a.check(
                not r["second_auth_passed"]
                and r["bed_allocated"] is None
                and r["response_time_min"] is None,
                r["event_id"],
            )
        if r["bed_allocated"]:
            adm = idx["admissions"][r["admission_id"]]
            a.check(
                r["first_auth_passed"]
                and r["second_auth_passed"]
                and wards[beds[r["bed_allocated"]]["ward_id"]]["hospital_id"]
                == r["nearest_hospital_id"]
                and adm["bed_id"] == r["bed_allocated"],
                r["event_id"],
            )
            a.check(
                adm["patient_id"] == (r["mother_id"] or r["child_id"]), r["event_id"]
            )
            a.check(
                dt(adm["admitted_at"])
                >= dt(r["triggered_at"]) + timedelta(minutes=r["response_time_min"]),
                r["event_id"],
            )
        if r["child_id"]:
            a.check(
                day(r["triggered_at"])
                >= day(idx["newborns"][r["child_id"]]["date_of_birth"]),
                r["event_id"],
            )
    a.check(
        any(r["outcome"] == "rejected_unverified" for r in data["emergency_events"]),
        "No rejected SOS example",
    )
    a.begin(16, "Fictional identifiers and synthetic provenance")
    for r in data["hospitals"]:
        a.check(
            r["name"].startswith("DAI SYNTHETIC ")
            and r["hospital_id"].startswith("HOSP-SYN-"),
            r["hospital_id"],
        )
    for d in data["doctors"]:
        a.check(
            d["name"].startswith("Dr SYNTHETIC ")
            and bool(re.fullmatch(r"NMC-FAKE-\d{6}", d["registration_number"])),
            d["doctor_id"],
        )
    for m in data["mothers"]:
        a.check(
            m["name"].startswith("SYNTHETIC ")
            and "-SYNTHETIC-" in m["phone"]
            and not m["contact_is_dialable"],
            m["mother_id"],
        )
        a.check(bool(re.fullmatch(r"9\d{9}", m["phone_numeric_core"])), m["mother_id"])
        a.check(
            m["caregiver_contact"] is None or "-SYNTHETIC-" in m["caregiver_contact"],
            m["mother_id"],
        )
    for p in data["patients"]:
        a.check(p["is_synthetic"] and "-SYN-" in p["patient_id"], p["patient_id"])
    readme = (ROOT / "README.md").read_text() if (ROOT / "README.md").exists() else ""
    a.check(
        "SYNTHETIC" in readme and "not dialable" in readme,
        "README synthetic/non-dialable notice",
    )
    # Extra requested domain checks, beyond the numbered rules.
    a.begin("coverage", "Scenario evidence, staffing, geography and prevalence")
    memberships = Counter(r["scenario"] for r in data["scenario_memberships"])
    required = cfg["minimum_examples_per_scenario"]
    for s in SCENARIOS:
        a.check(memberships[s] >= required, f"{s}: {memberships[s]} < {required}")
    for r in data["scenario_memberships"]:
        p = pregs[r["pregnancy_id"]]
        s = r["scenario"]
        cond = conditions[p["pregnancy_id"]]
        m = mothers[r["mother_id"]]
        ok = (
            s in cond
            or s == "normal_low_risk"
            and not cond
            and p["plurality_count"] == 1
            or s.startswith("stage:")
            and s[6:] == p["current_stage"]
            or s == p["outcome"]
            or s == "neonatal_death"
            and any(
                c["pregnancy_id"] == p["pregnancy_id"]
                and c["outcome"] == "neonatal death"
                for c in data["newborns"]
            )
            or s == "advanced_age"
            and m["age"] >= 35
        )
        a.check(ok, f"Unsupported scenario {s}: {r['pregnancy_id']}")
        if s == "adolescent":
            a.check(m["age"] < 18, r["membership_id"])
        if s == "advanced_age":
            a.check(m["age"] >= 35, r["membership_id"])
        if s == "neonatal_death":
            a.check(
                any(
                    c["pregnancy_id"] == p["pregnancy_id"]
                    and c["outcome"] == "neonatal death"
                    for c in data["newborns"]
                ),
                r["membership_id"],
            )
        if s == "prior_cs_vbac":
            a.check(
                p["prior_cesarean"] == 1
                and delivery[p["pregnancy_id"]]["mode"] == "normal",
                r["membership_id"],
            )
        if s == "down_screen_high":
            screens = [
                i
                for i in investigations[p["pregnancy_id"]]
                if i["result_flag"] == "high-risk screen"
            ]
            a.check(
                bool(screens)
                and all(
                    i["referral_id"]
                    and doctors[
                        idx["referrals"][i["referral_id"]]["receiving_doctor_id"]
                    ]["specialty"]
                    == "Fetal-Medicine specialist"
                    for i in screens
                ),
                r["membership_id"],
            )
        if s == "dropout":
            a.check(
                len(expected_anc[p["pregnancy_id"]]) - len(bypreg[p["pregnancy_id"]])
                >= 2,
                r["membership_id"],
            )
        if s == "migrated":
            a.check(p["prior_district"] and p["migration_date"], r["membership_id"])
        if s == "postpartum_depression":
            a.check(
                any(
                    v["pregnancy_id"] == p["pregnancy_id"]
                    and v["epds_score"] >= cfg["clinical"]["epds_positive_threshold"]
                    for v in data["postpartum_visits"]
                ),
                r["membership_id"],
            )
    for st in STAGES:
        a.check(
            sum(
                p["current_stage"] == st
                and not conditions[p["pregnancy_id"]]
                and p["plurality_count"] == 1
                for p in data["pregnancies"]
            )
            >= required,
            f"Normal low-risk singleton coverage: {st}",
        )
    a.check(len({x["state"] for x in data["hospitals"]}) >= 6, "Fewer than six states")
    for hospital in data["hospitals"]:
        geo = next(g for g in cfg["geography"] if g["state"] == hospital["state"])
        did = hospital["hospital_id"]
        ds = [d for d in data["doctors"] if d["hospital_id"] == did]
        a.check(
            hospital["district"] == geo["district"]
            and hospital["pincode"].startswith(geo["pincode_prefix"])
            and haversine(
                hospital["latitude"],
                hospital["longitude"],
                geo["latitude"],
                geo["longitude"],
            )
            < 5,
            did,
        )
        depnames = {d["name"] for d in data["departments"] if d["hospital_id"] == did}
        if "Obstetrics & Gynaecology" in depnames:
            a.check(
                sum(d["specialty"] == "Obstetrician/Gynaecologist" for d in ds) >= 2,
                did,
            )
        if "Paediatrics" in depnames:
            a.check(any(d["specialty"] == "Paediatrician" for d in ds), did)
        if hospital["has_nicu_level"] == "III":
            a.check(any(d["specialty"] == "Neonatologist" for d in ds), did)
        if hospital["tier"] == "PHC":
            a.check(all(d["specialty"] == "Medical Officer" for d in ds), did)
        if hospital["tier"] == "Medical College Hospital":
            a.check(
                {
                    "Professor",
                    "Associate Professor",
                    "Assistant Professor",
                    "Senior Resident",
                    "Junior Resident",
                }
                <= {d["designation"] for d in ds},
                did,
            )
        norm = cfg["msr_norms"][hospital["tier"]]
        a.check(
            norm["total_beds"][0] <= hospital["total_beds"] <= norm["total_beds"][1],
            did,
        )
    normal = [p for p in data["pregnancies"] if not p["is_edge_case_seed"]]
    twin_rate = sum(p["plurality_count"] == 2 for p in normal) / len(normal)
    triple_rate = sum(p["plurality_count"] >= 3 for p in normal) / len(normal)
    a.check(
        abs(twin_rate - cfg["prevalences"]["twins"])
        < max(0.006, 4 * (cfg["prevalences"]["twins"] / len(normal)) ** 0.5),
        f"Baseline twin prevalence {twin_rate:.4f}",
    )
    a.check(
        triple_rate < 0.001 or len(normal) < 2000,
        f"Baseline triplets+ {triple_rate:.4f}",
    )
    a.begin("formats", "CSV/SQLite same values, schema and deterministic hashes")
    manifest = json.loads((out / "manifest.json").read_text())
    for table, rows in data.items():
        path = out / "csv" / f"{table}.csv"
        with path.open(newline="") as f:
            reader = csv.DictReader(f)
            csvrows = list(reader)
            fields = reader.fieldnames
        a.check(fields == columns(table) and len(csvrows) == len(rows), table)
        lookup = {r[columns(table)[0]]: r for r in csvrows}
        for r in rows:
            exported = lookup.get(r[columns(table)[0]])
            a.check(exported is not None, table)
            if exported is None:
                continue
            for col in columns(table):
                actual = exported[col]
                value = r[col]
                if value is None:
                    ok = actual == ""
                elif isinstance(value, float):
                    try:
                        ok = abs(float(actual) - value) < max(1e-5, abs(value) * 1e-7)
                    except ValueError:
                        ok = False
                elif "BOOLEAN" in next(
                    s for s in SPECS[table].split(";") if s.strip().split()[0] == col
                ):
                    ok = (
                        actual.lower() in ("true", "1")
                        if value
                        else actual.lower() in ("false", "0")
                    )
                else:
                    ok = actual == str(value)
                a.check(ok, f"{table}.{col} {r[columns(table)[0]]}")
        a.check(
            hashlib.sha256(path.read_bytes()).hexdigest()
            == manifest["sha256"][str(path.relative_to(out))],
            f"Hash {table}",
        )
    a.check(
        len(re.findall(r"CREATE TABLE ", (out / "schema.sql").read_text()))
        == len(SPECS),
        "PostgreSQL DDL inventory",
    )
    con.close()
    passed = a.finish()
    if write_report:
        (out / "validation_report.json").write_text(
            json.dumps(
                {"passed": passed, "as_of_date": cfg["as_of_date"], "rules": a.rules},
                indent=2,
            )
            + "\n"
        )
    return passed


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=ROOT / "output")
    args = ap.parse_args()
    try:
        return 0 if validate_output(args.output.resolve()) else 1
    except (KeyError, ValueError, sqlite3.DatabaseError, OSError) as exc:
        print(f"FAIL | dataset cannot be validated: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
