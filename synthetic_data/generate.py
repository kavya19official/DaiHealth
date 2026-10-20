#!/usr/bin/env python3
"""Generate relational DAI fixtures. Python 3.11+, no external services."""

from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
from faker import Faker
from core import (
    ROOT,
    SPECS,
    SEVERE,
    EDGE_BUNDLES,
    STAGES,
    SCENARIOS,
    columns,
    ddl,
    config_load,
    day,
    iso,
    stage,
    vaccine_due,
    vaccine_status,
    haversine,
    add_months,
    derive_gaps,
)

BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
DEPARTMENTS = [
    "Obstetrics & Gynaecology",
    "Paediatrics",
    "Neonatology",
    "Anaesthesia",
    "Radiology",
    "Pathology",
    "Emergency/Casualty",
    "Blood Bank",
    "Pharmacy",
    "Medical Records",
]
SPECIALTIES = {
    "Obstetrician/Gynaecologist": "Obstetrics & Gynaecology",
    "Paediatrician": "Paediatrics",
    "Neonatologist": "Neonatology",
    "Anaesthetist": "Anaesthesia",
    "Radiologist": "Radiology",
    "Fetal-Medicine specialist": "Obstetrics & Gynaecology",
    "Medical Officer": "General Medicine",
}


class Generator:
    def __init__(self, cfg):
        self.cfg = cfg
        self.rng = np.random.default_rng(cfg["seed"])
        self.fake = Faker("en_IN")
        self.fake.seed_instance(cfg["seed"])
        self.today = day(cfg["as_of_date"])
        self.now = datetime.combine(self.today, time(12))
        self.data = {t: [] for t in SPECS}
        self.count = Counter()
        self.booking = defaultdict(list)
        self.hosp = {}
        self.depts = {}
        self.wards = defaultdict(dict)
        self.beds = defaultdict(list)
        self.docs = defaultdict(list)
        self.byid = {t: {} for t in SPECS}
        self.app_load = Counter()

    def integer(self, a, b):
        return int(self.rng.integers(a, b + 1))

    def uniform(self, a, b):
        return float(self.rng.uniform(a, b))

    def chance(self, p):
        return bool(self.rng.random() < p)

    def choice(self, values):
        return values[self.integer(0, len(values) - 1)]

    def weighted(self, weights):
        keys = list(weights)
        probs = np.array(list(weights.values()), dtype=float)
        probs /= probs.sum()
        return keys[int(self.rng.choice(len(keys), p=probs))]

    def add(self, table, **values):
        key = columns(table)[0]
        if key not in values:
            self.count[table] += 1
            values[key] = f"{table.upper()}-SYN-{self.count[table]:07d}"
        row = {c: values.get(c) for c in columns(table)}
        self.data[table].append(row)
        self.byid[table][row[key]] = row
        return row

    def subject(self, id, kind):
        self.add(
            "patients",
            patient_id=id,
            patient_type=kind,
            synthetic_label=id,
            is_synthetic=True,
        )

    def doctor(self, hid, specialty=None):
        docs = self.docs[hid]
        if specialty:
            matches = [d for d in docs if d["specialty"] == specialty]
            if matches:
                return self.choice(matches)
        matches = [
            d
            for d in docs
            if d["specialty"] in ("Obstetrician/Gynaecologist", "Medical Officer")
        ]
        return self.choice(matches or docs)

    def stamp(self, d, hour=9):
        return datetime.combine(d, time(hour))

    def book(self, patient, hid, types, start, end, reason):
        # Interval resource allocation prevents historical and current collisions.
        for a in self.data["admissions"]:
            if a["patient_id"] == patient:
                old_end = (
                    datetime.fromisoformat(a["discharged_at"])
                    if a["discharged_at"]
                    else self.now + timedelta(days=10000)
                )
                if start < old_end and datetime.fromisoformat(a["admitted_at"]) < end:
                    return None
        for typ in types:
            for b in self.beds[(hid, typ)]:
                if b["status"] == "maintenance":
                    continue
                periods = self.booking[b["bed_id"]]
                if any(start < e and s < end for s, e in periods):
                    continue
                periods.append((start, end))
                a = self.add(
                    "admissions",
                    patient_id=patient,
                    hospital_id=hid,
                    ward_id=b["ward_id"],
                    bed_id=b["bed_id"],
                    admitted_at=iso(start),
                    discharged_at=iso(end) if end <= self.now else None,
                    admission_reason=reason,
                )
                if start <= self.now < end:
                    b["status"] = "occupied"
                    b["current_patient_id"] = patient
                return a
        return None

    def build_infrastructure(self):
        for i in range(self.cfg["hospitals"]):
            geo = self.cfg["geography"][i % len(self.cfg["geography"])]
            tier = self.cfg["hospital_tier_cycle"][
                i % len(self.cfg["hospital_tier_cycle"])
            ]
            norm = self.cfg["msr_norms"][tier]
            hid = f"HOSP-SYN-{i + 1:04d}"
            big = tier in (
                "Medical College Hospital",
                "District Hospital",
                "Private Multispecialty",
            )
            h = self.add(
                "hospitals",
                hospital_id=hid,
                name=f"DAI SYNTHETIC {geo['district']} Facility {i + 1:04d}",
                tier=tier,
                district=geo["district"],
                state=geo["state"],
                pincode=geo["pincode_prefix"] + f"{self.integer(1, 99):03d}",
                latitude=round(geo["latitude"] + self.uniform(-0.018, 0.018), 6),
                longitude=round(geo["longitude"] + self.uniform(-0.018, 0.018), 6),
                ownership="private"
                if tier == "Private Multispecialty"
                else ("trust" if i % 7 == 6 else "govt"),
                nabh_accredited=big and i % 2 == 0,
                has_nicu_level=norm["nicu_level"],
                has_blood_bank=big,
                has_ambulance_count=self.integer(1, 5) if big else 1,
                is_sos_participating=tier != "PHC" or i % 2 == 0,
                emergency_24x7=True,
                total_beds=self.integer(*norm["total_beds"]),
                ot_count=self.integer(*norm["ot_count"]),
                labour_table_count=self.integer(*norm["labour_tables"]),
            )
            self.hosp[hid] = h
            depnames = (
                ["General Medicine", "Emergency/Casualty", "Pharmacy"]
                if tier == "PHC"
                else DEPARTMENTS.copy()
            )
            if tier == "CHC":
                depnames = [
                    n for n in depnames if n not in ("Neonatology", "Blood Bank")
                ]
            for name in depnames:
                d = self.add("departments", hospital_id=hid, name=name)
                self.depts[(hid, name)] = d["department_id"]
            total = h["total_beds"]
            capacities = {}
            if norm["nicu_level"] != "none":
                capacities["NICU"] = self.integer(*norm["nicu_beds"])
            if norm["icu_ratio"]:
                capacities["obstetric ICU/HDU"] = max(
                    1, round(total * norm["icu_ratio"] / 2)
                )
                capacities["paediatric ICU"] = max(
                    1, round(total * norm["icu_ratio"] / 2)
                )
            weights = norm["ward_weights"]
            remaining = total - sum(capacities.values())
            eligible = {k: v for k, v in weights.items() if k not in capacities}
            # Every configured ward gets one bed; remainder follows tier weights.
            if remaining < len(eligible):
                eligible = dict(list(eligible.items())[:remaining])
            for k in eligible:
                capacities[k] = 1
            extra = remaining - len(eligible)
            alloc = (
                self.rng.multinomial(
                    extra, np.array(list(eligible.values())) / sum(eligible.values())
                )
                if extra
                else [0] * len(eligible)
            )
            for k, n in zip(eligible, alloc):
                capacities[k] += int(n)
            for typ, cap in capacities.items():
                dep = (
                    "Paediatrics"
                    if typ in ("paediatric ward", "paediatric ICU", "SNCU", "KMC unit")
                    else "Neonatology"
                    if typ == "NICU"
                    else "Obstetrics & Gynaecology"
                )
                w = self.add(
                    "wards",
                    hospital_id=hid,
                    department_id=self.depts.get(
                        (hid, dep), self.depts.get((hid, "General Medicine"))
                    ),
                    ward_type=typ,
                    capacity=cap,
                    oxygen_supported=typ
                    in (
                        "NICU",
                        "obstetric ICU/HDU",
                        "paediatric ICU",
                        "labour room",
                        "emergency/casualty",
                    ),
                )
                self.wards[hid][typ] = w
                for _ in range(cap):
                    b = self.add(
                        "beds",
                        ward_id=w["ward_id"],
                        bed_type=typ,
                        status="available",
                        oxygen_supported=w["oxygen_supported"],
                        monitor_attached=typ
                        in ("NICU", "obstetric ICU/HDU", "paediatric ICU"),
                        current_patient_id=None,
                    )
                    self.beds[(hid, typ)].append(b)
            for typ, minimum in norm["equipment_minimums"].items():
                target = self.cfg["equipment_ward"][typ]
                ward = (
                    self.wards[hid].get(target)
                    or self.wards[hid].get("SNCU")
                    or next(iter(self.wards[hid].values()))
                )
                for _ in range(minimum + self.integer(0, max(0, minimum // 5))):
                    # Quantity-level asset rows: installed_quantity is always one.
                    status = self.weighted(
                        {
                            "functional": 1
                            - self.cfg["prevalences"]["equipment_nonfunctional"]
                            - self.cfg["prevalences"]["equipment_maintenance"],
                            "non-functional": self.cfg["prevalences"][
                                "equipment_nonfunctional"
                            ],
                            "under maintenance": self.cfg["prevalences"][
                                "equipment_maintenance"
                            ],
                        }
                    )
                    self.add(
                        "equipment",
                        hospital_id=hid,
                        ward_id=ward["ward_id"],
                        type=typ,
                        installed_quantity=1,
                        functional_quantity=int(status == "functional"),
                        status=status,
                        last_service_date=iso(
                            self.today - timedelta(days=self.integer(1, 365))
                        ),
                    )
            tests = ["Hb", "HIV", "HBsAg", "VDRL", "urine", "blood_group_Rh", "thyroid"]
            if tier != "PHC":
                tests += ["USG", "OGTT"]
            if big:
                tests += ["double_marker", "triple_marker"]
            if tier in ("Medical College Hospital", "Private Multispecialty"):
                tests += ["NIPT"]
            self.add(
                "hospital_services",
                hospital_id=hid,
                c_section=big,
                blood_transfusion=big,
                mtp=tier != "PHC",
                labour_room_24x7=True,
                emergency_obstetric_care="CEmOC" if big else "BEmOC",
                neonatal_resuscitation=True,
                vaccination_centre=True,
                diagnostic_tests=json.dumps(tests),
                obstetric_hdu="obstetric ICU/HDU" in self.wards[hid],
            )
            for group in BLOOD:
                self.add(
                    "blood_bank",
                    hospital_id=hid,
                    blood_group=group,
                    units_available=self.integer(3, 40) if big else 0,
                )
            for w in self.wards[hid].values():
                self.add(
                    "nurses_midwives",
                    hospital_id=hid,
                    ward_id=w["ward_id"],
                    name=f"SYNTHETIC Staff {self.fake.first_name()} {w['ward_id'][-7:]}",
                    designation="Nurse-midwife",
                    languages_spoken=f"{geo['language']},English",
                )

    def build_doctors(self):
        for i, h in enumerate(self.hosp.values()):
            hid = h["hospital_id"]
            norm = self.cfg["msr_norms"][h["tier"]]
            geo = self.cfg["geography"][i % 6]
            specs = []
            if h["tier"] == "PHC":
                specs = [("Medical Officer", "Medical Officer")]
            else:
                pyramid = (
                    [
                        "Professor",
                        "Associate Professor",
                        "Assistant Professor",
                        "Senior Resident",
                        "Junior Resident",
                    ]
                    if h["tier"] == "Medical College Hospital"
                    else ["Consultant"]
                )
                specs += [
                    ("Obstetrician/Gynaecologist", pyramid[k % len(pyramid)])
                    for k in range(max(2, norm["obg_count"]))
                ]
                specs += [
                    ("Paediatrician", pyramid[k % len(pyramid)])
                    for k in range(max(1, norm["paediatricians"]))
                ]
                if h["has_nicu_level"] != "none":
                    specs += [("Neonatologist", "Consultant")]
                if h["tier"] in ("Medical College Hospital", "Private Multispecialty"):
                    specs += [("Fetal-Medicine specialist", "Consultant")]
                specs += [("Anaesthetist", "Consultant"), ("Radiologist", "Consultant")]
            for specialty, designation in specs:
                q = {
                    "Obstetrician/Gynaecologist": "MS OBG",
                    "Paediatrician": "MD Paediatrics",
                    "Neonatologist": "DM Neonatology",
                    "Medical Officer": "MBBS",
                    "Anaesthetist": "MD Anaesthesia",
                    "Radiologist": "MD Radiology",
                    "Fetal-Medicine specialist": "DNB OBG + Fetal Medicine Fellowship",
                }[specialty]
                age_experience = {
                    "Professor": [15, 30],
                    "Associate Professor": [10, 20],
                    "Assistant Professor": [5, 12],
                    "Senior Resident": [3, 7],
                    "Junior Resident": [0, 3],
                }.get(designation, [5, 20])
                d = self.add(
                    "doctors",
                    hospital_id=hid,
                    department_id=self.depts[(hid, SPECIALTIES[specialty])],
                    name=f"Dr SYNTHETIC {self.fake.first_name()} {self.choice(geo['surnames'])} {len(self.data['doctors']) + 1:05d}",
                    gender=self.choice(["female", "male"]),
                    specialty=specialty,
                    designation=designation,
                    qualification=q,
                    experience_years=self.integer(*age_experience),
                    registration_number=f"NMC-FAKE-{len(self.data['doctors']) + 1:06d}",
                    languages_spoken=f"{geo['language']},Hindi,English",
                    high_risk_pregnancy_certified=specialty
                    in ("Obstetrician/Gynaecologist", "Fetal-Medicine specialist")
                    and designation != "Junior Resident",
                    max_daily_patients=self.integer(
                        *self.cfg["care"]["max_daily_patients"]
                    ),
                )
                self.docs[hid].append(d)
                for weekday in range(6):
                    clinic = (
                        "ANC clinic"
                        if specialty
                        in ("Medical Officer", "Obstetrician/Gynaecologist")
                        else "Well-baby clinic"
                        if specialty in ("Paediatrician", "Neonatologist")
                        else "High-risk clinic"
                    )
                    if weekday == 2 and d["high_risk_pregnancy_certified"]:
                        clinic = "High-risk clinic"
                    if weekday == 4 and specialty == "Paediatrician":
                        clinic = "Immunisation clinic"
                    self.add(
                        "doctor_schedules",
                        doctor_id=d["doctor_id"],
                        day=weekday,
                        start_time="08:00",
                        end_time="14:00",
                        clinic_type=clinic,
                        is_on_call=False,
                    )
                    if weekday % 2 == 0:
                        self.add(
                            "doctor_schedules",
                            doctor_id=d["doctor_id"],
                            day=weekday,
                            start_time="14:00",
                            end_time="22:00",
                            clinic_type="Emergency on-call",
                            is_on_call=True,
                        )

    def referral(self, p, from_h, to_h, reason, when):
        return self.add(
            "referrals",
            pregnancy_id=p["pregnancy_id"],
            referred_from_hospital_id=from_h,
            referred_to_hospital_id=to_h,
            reason=reason,
            referred_at=iso(when),
            transport_time_min=max(
                10,
                round(
                    haversine(
                        self.hosp[from_h]["latitude"],
                        self.hosp[from_h]["longitude"],
                        self.hosp[to_h]["latitude"],
                        self.hosp[to_h]["longitude"],
                    )
                    / 0.7
                ),
            ),
            referring_doctor_id=self.doctor(from_h)["doctor_id"],
            receiving_doctor_id=self.doctor(to_h)["doctor_id"],
        )

    def capable(self, hid, capability):
        h = self.hosp[hid]
        s = self.byid["hospital_services"][hid]
        if capability == "c_section":
            return s["c_section"] and s["emergency_obstetric_care"] == "CEmOC"
        if capability == "complex_obstetric":
            return (
                s["c_section"]
                and s["obstetric_hdu"]
                and h["has_nicu_level"] in ("II", "III")
            )
        if capability == "nicu":
            return h["has_nicu_level"] != "none"
        if capability == "paediatric":
            return any(d["specialty"] == "Paediatrician" for d in self.docs[hid])
        if capability == "transfusion":
            return s["blood_transfusion"] and h["has_blood_bank"]
        return True

    def nearest(self, lat, lon, capability, sos=False):
        eligible = [
            h
            for h in self.hosp.values()
            if self.capable(h["hospital_id"], capability)
            and (not sos or h["is_sos_participating"] and h["emergency_24x7"])
        ]
        return min(
            eligible,
            key=lambda h: (
                haversine(lat, lon, h["latitude"], h["longitude"]),
                h["hospital_id"],
            ),
        )

    def build_population(self):
        cfg = self.cfg
        n = cfg["patients"]
        reps = cfg["minimum_examples_per_scenario"]
        edge_count = max(len(EDGE_BUNDLES) * reps, round(n * cfg["edge_case_fraction"]))
        forced_count = len(STAGES) * reps + 2 * reps
        if n < edge_count + forced_count:
            raise ValueError(
                f"At least {len(EDGE_BUNDLES) * reps + forced_count} mothers are needed for 15 examples of every scenario; use --patients 1000 or more."
            )
        for i in range(n):
            edge = i < edge_count
            forced = None
            geo = cfg["geography"][i % 6]
            h = list(self.hosp.values())[i % len(self.hosp)]
            hid = h["hospital_id"]
            # Match residential region to registered hospital before referrals.
            geo = next(g for g in cfg["geography"] if g["state"] == h["state"])
            cond = set(EDGE_BUNDLES[(i // reps) % len(EDGE_BUNDLES)]) if edge else set()
            if not edge and i - edge_count < forced_count:
                j = (i - edge_count) // reps
                forced = (
                    STAGES[j]
                    if j < len(STAGES)
                    else ("MTP" if j == len(STAGES) else "molar")
                )
            age = int(
                np.clip(
                    round(
                        self.rng.normal(
                            cfg["clinical"]["age_mean"], cfg["clinical"]["age_sd"]
                        )
                    ),
                    18,
                    40,
                )
            )
            if "adolescent" in cond:
                age = self.integer(15, 17)
            if "advanced_age" in cond:
                age = self.integer(35, 45)
            if forced in STAGES:
                age = self.integer(22, 30)
            if age >= 35:
                cond.add("advanced_age")
            if not edge and forced is None:
                # Anaemia and metabolic categories are mutually exclusive draws.
                pr = cfg["prevalences"]["conditions"]
                a = self.rng.random()
                if a < pr["anaemia_severe"]:
                    cond.add("anaemia_severe")
                elif a < pr["anaemia_severe"] + pr["anaemia_moderate"]:
                    cond.add("anaemia_moderate")
                elif a < sum(
                    pr[x]
                    for x in ("anaemia_severe", "anaemia_moderate", "anaemia_mild")
                ):
                    cond.add("anaemia_mild")
                for c, pval in pr.items():
                    if c.startswith("anaemia"):
                        continue
                    if self.chance(pval):
                        cond.add(c)
                if "preexisting_diabetes" in cond:
                    cond.discard("gdm")
                if "preeclampsia" in cond:
                    cond.discard("gestational_hypertension")
                r = self.rng.random()
                if r < cfg["prevalences"]["triplets_plus"]:
                    cond.add("triplets")
                elif (
                    r
                    < cfg["prevalences"]["triplets_plus"] + cfg["prevalences"]["twins"]
                ):
                    cond.add(self.weighted(cfg["prevalences"]["twin_chorionicity"]))
            multiplicity = (
                4
                if "quadruplets" in cond
                else 3
                if "triplets" in cond
                else 2
                if any(c.startswith("twins_") for c in cond)
                else 1
            )
            if multiplicity == 2:
                cond.add("twins")
            literacy = (
                "low"
                if self.chance(cfg["prevalences"]["low_literacy"])
                else self.choice(["medium", "high"])
            )
            income = (
                "low"
                if self.chance(cfg["prevalences"]["low_income"])
                else self.choice(["middle", "high"])
            )
            lat = round(geo["latitude"] + self.uniform(-0.12, 0.12), 6)
            lon = round(
                geo["longitude"]
                + self.uniform(-0.12, 0.005 if geo["state"] == "Tamil Nadu" else 0.12),
                6,
            )
            distance = haversine(lat, lon, h["latitude"], h["longitude"])
            dropout = min(
                cfg["care"]["max_dropout"],
                cfg["care"]["baseline_dropout"]
                + (literacy == "low") * cfg["care"]["literacy_dropout_add"]
                + (income == "low") * cfg["care"]["income_dropout_add"]
                + distance * cfg["care"]["distance_dropout_per_km"]
                + (age < 18) * cfg["care"]["adolescent_dropout_add"],
            )
            if "dropout" in cond:
                dropout = cfg["care"]["max_dropout"]
            mid = f"MOTHER-SYN-{i + 1:07d}"
            self.subject(mid, "mother")
            doctor = self.doctor(hid)
            numeric = "9" + f"{self.integer(0, 999999999):09d}"
            m = self.add(
                "mothers",
                mother_id=mid,
                name=f"SYNTHETIC {self.choice(geo['names'])} {self.choice(geo['surnames'])} {i + 1:07d}",
                age=age,
                district=geo["district"],
                state=geo["state"],
                pincode=geo["pincode_prefix"] + f"{self.integer(1, 99):03d}",
                preferred_language=geo["language"],
                literacy_level=literacy,
                digital_literacy="low"
                if literacy == "low"
                else self.choice(["medium", "high"]),
                income_band=income,
                scheme_enrolment=self.choice(["PMJAY", "PMMVY", "JSY", "none"]),
                home_latitude=lat,
                home_longitude=lon,
                phone=f"{numeric}-SYNTHETIC-{i + 1:07d}",
                phone_numeric_core=numeric,
                contact_is_dialable=False,
                caregiver_contact=f"9{self.integer(0, 999999999):09d}-SYNTHETIC-CG-{i + 1:07d}",
                registered_hospital_id=hid,
                assigned_obgyn_id=doctor["doctor_id"],
                is_edge_case_seed=(edge or forced in ("MTP", "molar")),
                dropout_probability=round(dropout, 5),
                distance_km=round(distance, 3),
                messiness_tag=None,
            )
            if self.chance(cfg["prevalences"]["messiness"]):
                m["messiness_tag"] = self.choice(
                    ["missing_optional_contact", "late_entry", "similar_name"]
                )
                if m["messiness_tag"] == "missing_optional_contact":
                    m["caregiver_contact"] = None
                if m["messiness_tag"] == "similar_name" and i > 0:
                    previous = self.data["mothers"][-2]
                    m["name"] = (
                        " ".join(previous["name"].split()[:-1]) + f" {i + 1:07d}"
                    )
            outcome = cfg["prevalences"]["outcomes"]
            outcome = self.weighted(outcome)
            if edge:
                outcome = "live birth"
            for c, oc in [
                ("miscarriage", "miscarriage"),
                ("ectopic", "ectopic"),
                ("stillbirth", "stillbirth"),
            ]:
                if c in cond:
                    outcome = oc
            if forced in ("MTP", "molar"):
                outcome = forced
            if forced in STAGES:
                outcome = "ongoing" if forced in STAGES[:5] else "live birth"
            if edge and ("dropout" in cond or "down_screen_high" in cond):
                outcome = "ongoing"
            ga = self.integer(*cfg["clinical"]["normal_gestation_weeks"])
            if multiplicity > 1:
                ga = self.integer(
                    *cfg["clinical"][
                        "multiple_gestation_weeks"
                        if multiplicity == 2
                        else "triplet_gestation_weeks"
                        if multiplicity == 3
                        else "quadruplet_gestation_weeks"
                    ]
                )
            if cond & {
                "preterm_labour",
                "pprom",
                "severe_preeclampsia",
                "eclampsia",
                "hellp",
                "abruption",
            }:
                ga = self.integer(*cfg["clinical"]["severe_gestation_weeks"])
            if "post_term" in cond:
                ga = 42
            if outcome == "stillbirth":
                ga = self.integer(28, 38)
            if outcome in ("miscarriage", "ectopic", "MTP", "molar"):
                ga = (
                    self.integer(6, 18) if outcome != "ectopic" else self.integer(6, 10)
                )
            outdate = None
            labour = None
            if outcome == "ongoing":
                target = (
                    forced
                    if forced in STAGES[:5]
                    else self.weighted(cfg["prevalences"]["stages"])
                )
                elapsed = {
                    "Preconception": -14,
                    "T1": 70,
                    "T2": 140,
                    "T3": 224,
                    "In-labour": 273,
                }[target]
                if not forced and not edge:
                    elapsed = self.integer(
                        *{
                            "Preconception": [-30, -7],
                            "T1": [14, 97],
                            "T2": [98, 195],
                            "T3": [196, 272],
                            "In-labour": [259, 286],
                        }[target]
                    )
                if edge:
                    elapsed = 231
                    target = "T3"
                lmp = self.today - timedelta(days=elapsed)
                if target == "In-labour":
                    labour = iso(self.now - timedelta(hours=4))
                # Conditions that arise later are never attached before that time.
                if elapsed < 168:
                    cond -= {"gdm", "preeclampsia", "gestational_hypertension", "fgr"}
                if elapsed < 182:
                    cond.discard("gdm")
            else:
                ago = self.integer(10, cfg["care"]["historical_child_days_max"])
                if edge:
                    ago = self.integer(20, 300)
                if forced == "Delivered":
                    ago = 0
                if forced == "Postpartum 0-6wk":
                    ago = 20
                if forced == "Postpartum 6wk-1yr":
                    ago = 180
                if forced == "Child-care":
                    ago = 600
                if "postpartum_depression" in cond:
                    ago = 50
                outdate = self.today - timedelta(days=ago)
                lmp = outdate - timedelta(days=ga * 7)
            if outcome != "ongoing" and ga < 24:
                cond -= {"gdm", "preeclampsia", "gestational_hypertension", "fgr"}
            hb = round(self.uniform(*cfg["clinical"]["normal_hb"]), 1)
            for severity in ("mild", "moderate", "severe"):
                if f"anaemia_{severity}" in cond:
                    hb = round(
                        self.uniform(*cfg["clinical"][f"anaemia_{severity}_hb"]), 1
                    )
            severe = bool(cond & {"severe_preeclampsia", "eclampsia", "hellp"})
            hypertensive = bool(
                cond
                & {
                    "gestational_hypertension",
                    "preeclampsia",
                    "severe_preeclampsia",
                    "eclampsia",
                    "hellp",
                }
            )
            sbp = self.integer(
                *cfg["clinical"][
                    "severe_sbp"
                    if severe
                    else "hypertension_sbp"
                    if hypertensive
                    else "normal_sbp"
                ]
            )
            dbp = self.integer(
                *cfg["clinical"][
                    "severe_dbp"
                    if severe
                    else "hypertension_dbp"
                    if hypertensive
                    else "normal_dbp"
                ]
            )
            ogtt = round(
                self.uniform(
                    *cfg["clinical"][
                        "ogtt_gdm_2h_mg_dl"
                        if "gdm" in cond or "preexisting_diabetes" in cond
                        else "ogtt_normal_2h_mg_dl"
                    ]
                ),
                1,
            )
            prior = 2 if "prior_two_cs" in cond else 1 if "prior_cs_vbac" in cond else 0
            para = max(prior, self.integer(0, 2))
            gravida = para + 1
            living = max(0, para - self.integer(0, min(1, para)))
            p = self.add(
                "pregnancies",
                mother_id=mid,
                lmp=iso(lmp),
                edd=iso(lmp + timedelta(days=280)),
                current_gestational_week=max(
                    0,
                    ((self.today - lmp).days if not outdate else (outdate - lmp).days)
                    // 7,
                ),
                current_stage=None,
                gravida=gravida,
                para=para,
                living_children=living,
                plurality={1: "singleton", 2: "twins", 3: "triplets", 4: "quadruplets"}[
                    multiplicity
                ],
                plurality_count=multiplicity,
                chorionicity=next(
                    (x.split("_")[1].upper() for x in cond if x.startswith("twins_")),
                    None,
                )
                if multiplicity == 2
                else (
                    "TCTA"
                    if multiplicity == 3
                    else "QCQA"
                    if multiplicity == 4
                    else None
                ),
                conception_type=self.choice(["natural", "IVF", "IUI"])
                if multiplicity > 1
                else "natural",
                prior_cesarean=prior,
                outcome=outcome,
                outcome_date=iso(outdate),
                labour_started_at=labour,
                is_edge_case_seed=(edge or forced in ("MTP", "molar")),
                confirmed_high_risk=False,
                clinical_hb=hb,
                clinical_sbp=sbp,
                clinical_dbp=dbp,
                ogtt_2h_mg_dl=ogtt,
                conditions=json.dumps(sorted(cond)),
                prior_district="Kanpur Nagar" if "migrated" in cond else None,
                migration_date=iso(lmp + timedelta(days=140))
                if "migrated" in cond
                else None,
            )
            p["current_stage"] = stage(p, self.today)
            self.build_care(m, p, cond, hid, outdate, ga)
            if i % 1000 == 0:
                print(f"Generated {i + 1:,}/{n:,} mothers", flush=True)

    def build_care(self, m, p, cond, hid, outdate, ga):
        cfg = self.cfg
        pid = p["pregnancy_id"]
        mid = m["mother_id"]
        lmp = day(p["lmp"])
        end = outdate or self.today
        elapsed = (end - lmp).days
        risk = bool(
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
        # Explicit referral for certified validation and higher-capability birth.
        target = self.nearest(
            m["home_latitude"], m["home_longitude"], "complex_obstetric"
        )
        ref = None
        if risk and target["hospital_id"] != hid and elapsed >= 56:
            ref = self.referral(
                p,
                hid,
                target["hospital_id"],
                "High-risk specialist assessment",
                self.stamp(lmp + timedelta(days=56), 7),
            )
        valid_hid = target["hospital_id"] if ref else hid
        certified = [
            d for d in self.docs[valid_hid] if d["high_risk_pregnancy_certified"]
        ]
        for c in sorted(
            cond
            - {
                "gdm_screen_excluded",
                "migrated",
                "dropout",
                "postpartum_depression",
                "breastfeeding_difficulty",
                "miscarriage",
                "ectopic",
                "stillbirth",
                "neonatal_death",
            }
        ):
            # A rule flag is a finding, not automatically a confirmed diagnosis.
            high = (
                c in SEVERE
                or c in ("twins", "triplets", "quadruplets")
                or c.startswith("twins_")
            )
            confirmed = bool(certified) and (
                m["is_edge_case_seed"] or not self.chance(m["dropout_probability"])
            )
            flagdate = min(
                end,
                lmp
                + timedelta(
                    days=196
                    if c
                    in {
                        "gdm",
                        "gestational_hypertension",
                        "preeclampsia",
                        "severe_preeclampsia",
                        "eclampsia",
                        "hellp",
                        "fgr",
                    }
                    else 56
                ),
            )
            if flagdate > self.today:
                continue
            self.add(
                "risk_flags",
                pregnancy_id=pid,
                risk_type=c,
                severity="high" if high else "medium",
                raised_by="rule engine",
                validated_by_doctor_id=self.choice(certified)["doctor_id"]
                if confirmed
                else None,
                validation_status="confirmed" if confirmed else "pending",
                date=iso(flagdate),
            )
            if high and confirmed:
                p["confirmed_high_risk"] = True
        old_hid = None
        if "migrated" in cond:
            old_hid = next(
                h["hospital_id"]
                for h in self.hosp.values()
                if h["district"] != m["district"]
            )
            p["prior_district"] = self.hosp[old_hid]["district"]
            self.referral(
                p,
                old_hid,
                hid,
                "Residence migrated mid-pregnancy; transfer ANC record",
                self.stamp(day(p["migration_date"]), 7),
            )
        weeks = sorted(
            set(
                cfg["care"]["anc_weeks"]
                + (
                    list(range(8, 43, cfg["care"]["high_risk_interval_weeks"]))
                    if risk
                    else []
                )
            )
        )
        for w in weeks:
            due = lmp + timedelta(days=w * 7)
            if due > end or (outdate is not None and due >= outdate):
                continue
            e = self.add(
                "anc_expected", pregnancy_id=pid, gestational_week=w, due_date=iso(due)
            )
            if self.chance(m["dropout_probability"]) and w != 8:
                continue
            if "dropout" in cond and w > 12:
                continue
            late = 2 if m["messiness_tag"] == "late_entry" else 0
            visit = min(
                due + timedelta(days=late), end - timedelta(days=1) if outdate else end
            )
            vh = (
                old_hid
                if old_hid and w < 20
                else ref["referred_to_hospital_id"]
                if ref and w >= 20
                else hid
            )
            vd = self.doctor(vh)
            hb = p["clinical_hb"]
            bp = (
                p["clinical_sbp"]
                if w >= 20
                else self.integer(*cfg["clinical"]["normal_sbp"])
            )
            dp = (
                p["clinical_dbp"]
                if w >= 20
                else self.integer(*cfg["clinical"]["normal_dbp"])
            )
            self.add(
                "anc_visits",
                pregnancy_id=pid,
                expected_id=e["expected_id"],
                visit_date=iso(visit),
                gestational_week_at_visit=(visit - lmp).days // 7,
                hospital_id=vh,
                doctor_id=vd["doctor_id"],
                bp_systolic=bp,
                bp_diastolic=dp,
                weight_kg=round(
                    48
                    + w * cfg["care"]["visit_weight_gain_kg_per_week"]
                    + self.uniform(-3, 3),
                    1,
                ),
                hb=hb,
                fundal_height_cm=round(w + self.uniform(-2, 2), 1) if w >= 20 else None,
                fetal_heart_rate=self.integer(120, 160) if w >= 12 else None,
                urine_albumin="2+" if bp >= 160 else "1+" if bp >= 140 else "negative",
                urine_sugar="positive" if "gdm" in cond else "negative",
                ifa_given=True,
                calcium_given=w >= 14,
                td_dose_given=1 if w == 12 else 2 if w == 16 else 0,
                notes_code="HIGH_RISK_REVIEW" if risk else "ROUTINE",
                entered_at=iso(
                    min(self.today, visit + timedelta(days=2 if late else 0))
                ),
            )
        for test, w in cfg["investigations"]:
            due = lmp + timedelta(days=w * 7)
            if due > end or (outdate and due >= outdate):
                continue
            if test == "OGTT" and "preexisting_diabetes" in cond:
                continue
            if test in ("double_marker", "triple_marker") and test == (
                "triple_marker" if iif(pid) % 2 == 0 else "double_marker"
            ):
                continue
            done = (test == "OGTT" and "gdm" in cond) or not self.chance(
                m["dropout_probability"]
            )
            completed = (
                min(
                    end,
                    due
                    + timedelta(days=2 if m["messiness_tag"] == "late_entry" else 0),
                )
                if done
                else None
            )
            ih = hid
            ir = None
            if test in (
                "double_marker",
                "triple_marker",
                "USG_dating_NT",
                "anomaly_scan",
                "growth_scan",
                "OGTT",
            ) and test not in json.loads(
                self.byid["hospital_services"][hid]["diagnostic_tests"]
            ):
                ih = target["hospital_id"]
                if ih != hid:
                    ir = self.referral(
                        p,
                        hid,
                        ih,
                        f"Investigation: {test}",
                        self.stamp(due - timedelta(days=1), 8),
                    )
            value = {
                "blood_group_Rh": "O negative"
                if "rh_alloimmunisation" in cond
                else self.choice(BLOOD),
                "Hb": str(p["clinical_hb"]),
                "OGTT": str(p["ogtt_2h_mg_dl"]),
                "HIV": "positive_on_ART" if "hiv_art" in cond else "negative",
                "HBsAg": "positive" if "hepatitis_b" in cond else "negative",
                "VDRL": "reactive" if "syphilis" in cond else "nonreactive",
                "thyroid": "TSH 7.5 mIU/L"
                if "hypothyroidism" in cond
                else "TSH 2.0 mIU/L",
            }.get(test, "within_expected_range")
            highscreen = "down_screen_high" in cond and test in (
                "double_marker",
                "triple_marker",
            )
            if highscreen:
                completed = due
                value = "screen_positive_trisomy21_1_in_100"
                fetal = [
                    h
                    for h in self.hosp.values()
                    if any(
                        d["specialty"] == "Fetal-Medicine specialist"
                        for d in self.docs[h["hospital_id"]]
                    )
                ]
                fh = min(
                    fetal,
                    key=lambda h: haversine(
                        m["home_latitude"],
                        m["home_longitude"],
                        h["latitude"],
                        h["longitude"],
                    ),
                )
                # Even an internal referral has explicit source/destination and specialist.
                ir = self.referral(
                    p,
                    ih,
                    fh["hospital_id"],
                    "High-risk Down syndrome screen: fetal-medicine referral",
                    self.stamp(due, 10),
                )
                ir["receiving_doctor_id"] = self.doctor(
                    fh["hospital_id"], "Fetal-Medicine specialist"
                )["doctor_id"]
            self.add(
                "investigations",
                pregnancy_id=pid,
                hospital_id=ih,
                ordered_by_doctor_id=self.doctor(ih)["doctor_id"],
                test_type=test,
                ordered_date=iso(due - timedelta(days=7)),
                due_date=iso(due),
                completed_date=iso(completed),
                gestational_week=w,
                status="done"
                if completed
                else "overdue"
                if due < self.today
                else "pending",
                result_value=value if completed else None,
                result_flag=(
                    "high-risk screen"
                    if highscreen
                    else "abnormal"
                    if value in ("positive_on_ART", "positive", "reactive")
                    or (test == "Hb" and p["clinical_hb"] < 11)
                    or (test == "OGTT" and "gdm" in cond)
                    else "normal"
                )
                if completed
                else None,
                referral_id=ir["referral_id"] if ir else None,
            )
        delivery = None
        if outdate and p["outcome"] in ("live birth", "stillbirth"):
            delivery = self.build_delivery(m, p, cond, hid, outdate, ga, target, ref)
            self.build_children(m, p, cond, delivery, outdate, ga)
            self.build_pnc(m, p, cond, delivery, outdate)
        # Maternal Td is subject-specific, not attached to a child.
        for code, offset in cfg["maternal_vaccines"]:
            due = lmp + timedelta(days=offset)
            if due > end:
                continue
            given = due if not self.chance(m["dropout_probability"]) else None
            self.add(
                "vaccinations",
                subject_id=mid,
                mother_id=mid,
                child_id=None,
                pregnancy_id=pid,
                vaccine_code=code,
                due_date=iso(due),
                given_date=iso(given),
                status=vaccine_status(
                    due, given, self.today, cfg["care"]["vaccine_grace_days"]
                ),
                centre_hospital_id=hid,
                not_applicable_after_death=False,
            )
        if p["labour_started_at"]:
            target = self.nearest(
                m["home_latitude"], m["home_longitude"], "complex_obstetric"
            )
            self.book(
                mid,
                target["hospital_id"],
                ["labour room", "general ANC ward"],
                self.now - timedelta(hours=4),
                self.now + timedelta(days=2),
                "In-labour",
            )
        memberships = {c for c in cond if c in SCENARIOS} | {
            "stage:" + p["current_stage"]
        }
        if not cond and p["plurality_count"] == 1:
            memberships.add("normal_low_risk")
        if p["outcome"] in ("MTP", "molar", "miscarriage", "ectopic", "stillbirth"):
            memberships.add(p["outcome"])
        if any(
            c["pregnancy_id"] == pid and c["outcome"] == "neonatal death"
            for c in self.data["newborns"]
        ):
            memberships.add("neonatal_death")
        for c in sorted(memberships):
            self.add(
                "scenario_memberships",
                mother_id=mid,
                pregnancy_id=pid,
                scenario=c,
                is_edge_case_seed=m["is_edge_case_seed"],
            )

    def build_delivery(self, m, p, cond, hid, outdate, ga, target, ref):
        cfg = self.cfg
        original = hid
        emergency = bool(
            cond
            & {
                "severe_preeclampsia",
                "eclampsia",
                "hellp",
                "abruption",
                "obstructed_labour",
                "uterine_rupture",
                "cord_prolapse",
            }
        )
        mode = (
            "emergency LSCS"
            if emergency
            else "elective LSCS"
            if cond
            & {
                "placenta_praevia",
                "prior_two_cs",
                "twins_mcma",
                "triplets",
                "quadruplets",
            }
            else "normal"
        )
        if (
            mode == "normal"
            and "prior_cs_vbac" not in cond
            and "shoulder_dystocia" not in cond
            and self.chance(cfg["prevalences"]["caesarean"])
        ):
            mode = "elective LSCS"
        if "shoulder_dystocia" in cond:
            mode = "assisted"
        needs_complex = p["plurality_count"] >= 3 or bool(
            cond & {"severe_preeclampsia", "eclampsia", "hellp"}
        )
        # PHCs/CHCs refer deliveries upward; high-risk babies stay at NICU hospitals.
        capability = "complex_obstetric" if needs_complex else "nicu"
        if (
            not self.capable(hid, capability)
            or self.hosp[hid]["tier"] in ("PHC", "CHC")
            or mode.endswith("LSCS")
            and not self.capable(hid, "c_section")
        ):
            hid = target["hospital_id"]
        start = self.stamp(outdate, 7) - timedelta(
            days=cfg["care"]["delivery_admission_days"]
        )
        birth = self.stamp(outdate, 9)
        end = birth + timedelta(
            days=cfg["care"]["cs_stay_days"]
            if mode.endswith("LSCS")
            else cfg["care"]["normal_stay_days"]
        )
        if hid != original:
            ref = self.referral(
                p,
                original,
                hid,
                "Higher-level delivery: "
                + (
                    "complex obstetric"
                    if needs_complex
                    else "NICU and operative backup"
                ),
                start - timedelta(hours=2),
            )
        adm = self.book(
            m["mother_id"],
            hid,
            ["postnatal ward", "general ANC ward", "PNC", "obstetric ICU/HDU"],
            start,
            end,
            "Delivery",
        )
        if adm is None:
            raise RuntimeError(
                f"No delivery bed at {hid} on {outdate}; increase configured capacity or hospital count."
            )
        haem = bool(cond & {"pph", "aph", "abruption", "uterine_rupture"})
        blood = (
            self.integer(1200, 2500)
            if haem
            else self.integer(500, 900)
            if mode.endswith("LSCS")
            else self.integer(150, 450)
        )
        return self.add(
            "delivery_records",
            pregnancy_id=p["pregnancy_id"],
            hospital_id=hid,
            delivering_doctor_id=self.doctor(hid)["doctor_id"],
            mode=mode,
            gestational_age_at_birth=ga,
            birth_timing="preterm" if ga < 37 else "post-term" if ga >= 42 else "term",
            blood_loss_ml=blood,
            transfusion_units=2 if haem else 0,
            complications=json.dumps(
                sorted(
                    cond
                    & {
                        "pph",
                        "aph",
                        "obstructed_labour",
                        "uterine_rupture",
                        "sepsis",
                        "cord_prolapse",
                        "shoulder_dystocia",
                        "abruption",
                        "eclampsia",
                        "hellp",
                    }
                )
            ),
            ward_id=adm["ward_id"],
            bed_id=adm["bed_id"],
            admission_id=adm["admission_id"],
            admitted_at=adm["admitted_at"],
            delivered_at=iso(birth),
            discharged_at=adm["discharged_at"],
            maternal_outcome="survived",
            referral_id=ref["referral_id"] if ref else None,
        )

    def build_children(self, m, p, cond, d, outdate, ga):
        cfg = self.cfg
        hid = d["hospital_id"]
        count = p["plurality_count"]
        born = datetime.fromisoformat(d["delivered_at"])
        for order in range(1, count + 1):
            weight = int(
                np.clip(
                    round(
                        self.rng.normal(
                            cfg["clinical"]["singleton_birth_weight_g_mean"]
                            - (count - 1) * cfg["clinical"]["multiple_weight_penalty_g"]
                            - max(0, 38 - ga)
                            * cfg["clinical"]["prematurity_weight_penalty_g_per_week"]
                            - (400 if "fgr" in cond else 0),
                            cfg["clinical"]["birth_weight_sd_g"],
                        )
                    ),
                    600,
                    4700,
                )
            )
            sex = "male" if self.chance(cfg["prevalences"]["male_birth"]) else "female"
            if p["outcome"] == "stillbirth":
                self.add(
                    "stillbirths",
                    mother_id=m["mother_id"],
                    pregnancy_id=p["pregnancy_id"],
                    delivery_id=d["delivery_id"],
                    birth_order=order,
                    date_of_birth=iso(outdate),
                    sex=sex,
                    birth_weight_g=weight,
                )
                continue
            cid = f"CHILD-SYN-{len(self.data['newborns']) + 1:07d}"
            self.subject(cid, "child")
            nicu = (
                ga < 35
                or weight < 1800
                or count >= 3
                or "neonatal_death" in cond
                or self.chance(
                    cfg["prevalences"][
                        "nicu_multiple" if count > 1 else "nicu_singleton"
                    ]
                )
            )
            dead = "neonatal_death" in cond or (
                outdate < self.today
                and self.chance(cfg["prevalences"]["newborn_death"])
            )
            death = (
                outdate + timedelta(days=1) if dead and outdate < self.today else None
            )
            adm = None
            if nicu:
                nicu_end = (
                    min(
                        born + timedelta(days=cfg["care"]["nicu_stay_days"]),
                        self.stamp(death, 9),
                    )
                    if death
                    else born + timedelta(days=cfg["care"]["nicu_stay_days"])
                )
                adm = self.book(
                    cid, hid, ["NICU"], born, nicu_end, "Neonatal intensive care"
                )
                if adm is None:
                    raise RuntimeError(f"NICU capacity exceeded at {hid} on {outdate}.")
            docs = (
                [x for x in self.docs[hid] if x["specialty"] == "Neonatologist"]
                if nicu
                else []
            )
            pediatric = self.choice(docs) if docs else self.doctor(hid, "Paediatrician")
            apgar1 = self.integer(4, 7) if nicu else self.integer(7, 9)
            apgar5 = max(apgar1, self.integer(7, 9) if nicu else self.integer(8, 10))
            child = self.add(
                "newborns",
                child_id=cid,
                mother_id=m["mother_id"],
                pregnancy_id=p["pregnancy_id"],
                delivery_id=d["delivery_id"],
                birth_order=order,
                birth_label="singleton"
                if count == 1
                else f"{p['plurality']} {chr(64 + order)}",
                date_of_birth=iso(outdate),
                sex=sex,
                birth_weight_g=weight,
                apgar_1min=apgar1,
                apgar_5min=apgar5,
                gestational_age=ga,
                nicu_admission=nicu,
                nicu_bed_id=adm["bed_id"] if adm else None,
                nicu_admission_id=adm["admission_id"] if adm else None,
                outcome="neonatal death" if death else "alive",
                death_date=iso(death),
                paediatrician_id=pediatric["doctor_id"],
            )
            for vaccine in cfg["vaccines"]:
                due = vaccine_due(child, vaccine)
                given = None
                na = death is not None and due > death
                if (
                    due <= self.today
                    and not na
                    and not self.chance(
                        m["dropout_probability"]
                        * cfg["care"]["missed_vaccine_multiplier"]
                    )
                ):
                    latest = min(self.today, death) if death else self.today
                    given = min(
                        latest,
                        due
                        + timedelta(
                            days=0
                            if vaccine[1] == 0 and vaccine[2] == 0
                            else self.integer(0, 5)
                        ),
                    )
                self.add(
                    "vaccinations",
                    subject_id=cid,
                    child_id=cid,
                    mother_id=None,
                    pregnancy_id=p["pregnancy_id"],
                    vaccine_code=vaccine[0],
                    due_date=iso(due),
                    given_date=iso(given),
                    status=vaccine_status(
                        due, given, self.today, cfg["care"]["vaccine_grace_days"]
                    ),
                    centre_hospital_id=hid,
                    not_applicable_after_death=na,
                )
            maxdate = min(self.today, death) if death else self.today
            for months in [0, 1, 2, 3, 6, 9, 12, 18, 24]:
                measured = add_months(outdate, months)
                if measured > maxdate:
                    continue
                z = float(
                    np.clip(
                        self.rng.normal(
                            -0.45 if m["income_band"] == "low" else -0.05, 0.9
                        ),
                        -3.5,
                        2.5,
                    )
                )
                hz = float(np.clip(self.rng.normal(-0.45, 0.95), -3.5, 2.5))
                wz = round(z - hz * 0.3, 2)
                # Illustrative age curves, with preterm growth to term-equivalent
                # age before using a WHO-like reference (never WHO LMS claims).
                gm = cfg["growth_model"]
                correction = (40 - ga) / 4.345 if ga < 37 else 0
                birth_cm = 49.9 - max(0, 40 - ga)
                birth_head = 34.5 - max(0, 40 - ga) * 0.6
                if months < correction:
                    fraction = months / correction
                    kg = weight / 1000 + (3.3 - weight / 1000) * fraction
                    cm = birth_cm + (49.9 - birth_cm) * fraction
                    hc = birth_head + (34.5 - birth_head) * fraction
                    z = hz = wz = None
                else:
                    corrected = max(0, months - correction)

                    def interp(key):
                        return float(np.interp(corrected, gm["months"], gm[key]))

                    wm = interp("weight_median_kg") + (
                        gm["female_weight_offset_kg"] if sex == "female" else 0
                    )
                    hm = interp("height_median_cm") + (
                        gm["female_height_offset_cm"] if sex == "female" else 0
                    )
                    kg = (
                        weight / 1000
                        if months == 0
                        else max(0.5, wm + z * interp("weight_sd_kg"))
                    )
                    cm = birth_cm if months == 0 else hm + hz * interp("height_sd_cm")
                    hc = interp("head_median_cm")
                    if months == 0:
                        z = (kg - wm) / interp("weight_sd_kg")
                        hz = (cm - hm) / interp("height_sd_cm")
                        wz = z - hz * 0.3
                    z = round(z, 2)
                    hz = round(hz, 2)
                    wz = round(wz, 2)
                self.add(
                    "growth_records",
                    child_id=cid,
                    measured_on=iso(measured),
                    age_months=months,
                    weight_kg=round(float(kg), 2),
                    height_cm=round(float(cm), 1),
                    head_cm=round(float(hc), 1),
                    weight_for_age_z=z,
                    height_for_age_z=hz,
                    weight_for_height_z=wz,
                    underweight=z is not None and z < -2,
                    stunting=hz is not None and hz < -2,
                    wasting=wz is not None and wz < -2,
                    motor_check="preterm_followup"
                    if z is None
                    else "review"
                    if z < -2
                    else "age_appropriate",
                    language_check="age_appropriate",
                    social_check="age_appropriate",
                )

    def build_pnc(self, m, p, cond, d, outdate):
        for offset in self.cfg["care"]["pnc_days"]:
            due = outdate + timedelta(days=offset)
            if due > self.today:
                continue
            e = self.add(
                "postpartum_expected",
                pregnancy_id=p["pregnancy_id"],
                postpartum_day=offset,
                due_date=iso(due),
            )
            if self.chance(m["dropout_probability"]) and not (
                m["is_edge_case_seed"] and "postpartum_depression" in cond
            ):
                continue
            inpatient = d["discharged_at"] is None or self.stamp(
                due, 10
            ) < datetime.fromisoformat(d["discharged_at"])
            self.add(
                "postpartum_visits",
                expected_id=e["expected_id"],
                pregnancy_id=p["pregnancy_id"],
                visit_date=iso(due),
                postpartum_day=offset,
                hospital_id=d["hospital_id"],
                doctor_id=self.doctor(d["hospital_id"])["doctor_id"],
                care_setting="inpatient" if inpatient else "post_discharge",
                epds_score=self.integer(14, 22)
                if "postpartum_depression" in cond
                else self.integer(0, 9),
                breastfeeding_status="difficulty"
                if "breastfeeding_difficulty" in cond
                else "established",
                contraception_counselling=True,
                hb_recheck=round(max(6, p["clinical_hb"] + 0.3), 1),
            )

    def build_appointments(self):
        children = defaultdict(list)
        for c in self.data["newborns"]:
            children[c["mother_id"]].append(c)
        visits = defaultdict(list)
        for v in self.data["anc_visits"]:
            visits[v["pregnancy_id"]].append(v)
        for p in self.data["pregnancies"]:
            m = self.byid["mothers"][p["mother_id"]]
            doc = self.byid["doctors"][m["assigned_obgyn_id"]]
            # Every mother gets a future clinic appointment; children get their own.
            candidates = [
                (
                    self.today + timedelta(days=self.integer(1, 45)),
                    "booked",
                    m["mother_id"],
                    None,
                    doc,
                    "Continuity follow-up",
                )
            ]
            if visits[p["pregnancy_id"]]:
                v = visits[p["pregnancy_id"]][-1]
                candidates.append(
                    (
                        day(v["visit_date"]),
                        "attended",
                        m["mother_id"],
                        None,
                        self.byid["doctors"][v["doctor_id"]],
                        "ANC review",
                    )
                )
            for child in children[m["mother_id"]]:
                if child["outcome"] == "alive":
                    candidates.append(
                        (
                            self.today + timedelta(days=self.integer(1, 45)),
                            "booked",
                            child["child_id"],
                            child["child_id"],
                            self.byid["doctors"][child["paediatrician_id"]],
                            "Well-baby clinic",
                        )
                    )
            for dt, status, subject, cid, doctor, reason in candidates:
                while (
                    dt.weekday() == 6
                    or self.app_load[(doctor["doctor_id"], iso(dt))]
                    >= doctor["max_daily_patients"]
                ):
                    dt += timedelta(days=1 if status == "booked" else -1)
                key = (doctor["doctor_id"], iso(dt))
                slot = self.app_load[key]
                self.app_load[key] += 1
                minute = 8 * 60 + slot * 10
                st = f"{minute // 60:02d}:{minute % 60:02d}"
                en = f"{(minute + 10) // 60:02d}:{(minute + 10) % 60:02d}"
                if status == "attended" and self.chance(m["dropout_probability"]):
                    status = self.choice(["missed", "cancelled", "rescheduled"])
                self.add(
                    "appointments",
                    subject_id=subject,
                    mother_id=None if cid else m["mother_id"],
                    child_id=cid,
                    pregnancy_id=p["pregnancy_id"],
                    doctor_id=doctor["doctor_id"],
                    hospital_id=doctor["hospital_id"],
                    appointment_date=iso(dt),
                    start_time=st,
                    end_time=en,
                    status=status,
                    reason=reason,
                )

    def emergencies(self):
        candidates = [
            m
            for m in self.data["mothers"]
            if self.chance(self.cfg["prevalences"]["emergency_event"])
        ]
        pregs = {p["mother_id"]: p for p in self.data["pregnancies"]}
        kids = defaultdict(list)
        for child in self.data["newborns"]:
            if child["outcome"] == "alive" and child["date_of_birth"] < iso(self.today):
                kids[child["mother_id"]].append(child)
        for i, m in enumerate(candidates):
            p = pregs[m["mother_id"]]
            child = (
                self.choice(kids[m["mother_id"]])
                if kids[m["mother_id"]]
                and self.chance(self.cfg["prevalences"]["emergency_child_share"])
                else None
            )
            cap = (
                (
                    "nicu"
                    if (self.today - day(child["date_of_birth"])).days < 28
                    else "paediatric"
                )
                if child
                else self.choice(
                    ["c_section", "complex_obstetric", "transfusion", "basic"]
                )
            )
            hid = self.nearest(m["home_latitude"], m["home_longitude"], cap, True)[
                "hospital_id"
            ]
            rejected = i == 0 or self.chance(self.cfg["prevalences"]["sos_rejected"])
            first = True
            distance = haversine(
                m["home_latitude"],
                m["home_longitude"],
                self.hosp[hid]["latitude"],
                self.hosp[hid]["longitude"],
            )
            response = max(5, round(10 + distance / 0.65))
            eventtime = self.now - timedelta(minutes=response + 120 + i % 120)
            if child:
                eventtime = max(eventtime, self.stamp(day(child["date_of_birth"]), 10))
            arrival = eventtime + timedelta(minutes=response)
            adm = None
            if not rejected:
                subject = child["child_id"] if child else m["mother_id"]
                types = (
                    ["NICU"]
                    if cap == "nicu"
                    else ["paediatric ward", "emergency/casualty"]
                    if child
                    else ["emergency/casualty", "general ANC ward", "postnatal ward"]
                )
                if arrival < self.now - timedelta(hours=1):
                    adm = self.book(
                        subject,
                        hid,
                        types,
                        arrival,
                        self.now - timedelta(hours=1),
                        "SOS observation",
                    )
            validator = self.doctor(hid)
            distance = haversine(
                m["home_latitude"],
                m["home_longitude"],
                self.hosp[hid]["latitude"],
                self.hosp[hid]["longitude"],
            )
            self.add(
                "emergency_events",
                mother_id=None if child else m["mother_id"],
                child_id=child["child_id"] if child else None,
                pregnancy_id=p["pregnancy_id"],
                triggered_at=iso(eventtime),
                trigger_latitude=m["home_latitude"],
                trigger_longitude=m["home_longitude"],
                required_capability=cap,
                first_auth_passed=first,
                second_auth_family_contact=m["caregiver_contact"] if rejected else None,
                second_auth_doctor_id=validator["doctor_id"] if not rejected else None,
                second_auth_passed=not rejected,
                nearest_hospital_id=hid,
                distance_km=round(distance, 6),
                response_time_min=response if not rejected else None,
                outcome="rejected_unverified"
                if rejected
                else "responded"
                if adm
                else "verified_no_bed",
                bed_allocated=adm["bed_id"] if adm else None,
                admission_id=adm["admission_id"] if adm else None,
            )

    def current_occupancy(self):
        # General inpatient placeholders keep hospital-wide occupancy coherent
        # without pretending all general-medicine patients are pregnant mothers.
        for h in self.hosp.values():
            bounds = self.cfg["msr_norms"][h["tier"]]["occupancy"]
            target = self.uniform(*bounds)
            wardlist = list(self.wards[h["hospital_id"]].values())
            target_count = min(
                int(h["total_beds"] * 0.95),
                max(
                    int(np.ceil(h["total_beds"] * 0.60)),
                    round(h["total_beds"] * target),
                ),
            )
            wants = {w["ward_id"]: int(w["capacity"] * target) for w in wardlist}
            while sum(wants.values()) < target_count:
                for w in wardlist:
                    if sum(wants.values()) >= target_count:
                        break
                    if wants[w["ward_id"]] < w["capacity"]:
                        wants[w["ward_id"]] += 1
            for w in wardlist:
                beds = self.beds[(h["hospital_id"], w["ward_type"])]
                want = wants[w["ward_id"]]
                occupied = sum(b["status"] == "occupied" for b in beds)
                for b in beds:
                    if occupied >= want:
                        break
                    if b["status"] != "available":
                        continue
                    pid = f"INPATIENT-SYN-{len(self.data['patients']) + 1:07d}"
                    self.subject(pid, "background_inpatient")
                    start = self.now - timedelta(hours=1)
                    end = self.now + timedelta(days=1)
                    # Book this specific bed, excluding active historical stays.
                    if any(start < e and s < end for s, e in self.booking[b["bed_id"]]):
                        self.data["patients"].pop()
                        del self.byid["patients"][pid]
                        continue
                    self.booking[b["bed_id"]].append((start, end))
                    self.add(
                        "admissions",
                        patient_id=pid,
                        hospital_id=h["hospital_id"],
                        ward_id=w["ward_id"],
                        bed_id=b["bed_id"],
                        admitted_at=iso(start),
                        discharged_at=None,
                        admission_reason="Synthetic background hospital census",
                    )
                    b["status"] = "occupied"
                    b["current_patient_id"] = pid
                    occupied += 1
                # Mark a small number of free beds unavailable for maintenance.
                for b in beds:
                    if b["status"] == "available" and self.chance(
                        self.cfg["prevalences"]["equipment_maintenance"]
                    ):
                        b["status"] = "maintenance"

    def run(self):
        self.build_infrastructure()
        self.build_doctors()
        self.build_population()
        self.build_appointments()
        self.data["care_gaps"] = derive_gaps(self.data, self.cfg)
        self.emergencies()
        self.current_occupancy()
        return self.data


def iif(pid):
    return int(pid.rsplit("-", 1)[1])


def export(data, cfg, out):
    out.mkdir(parents=True, exist_ok=True)
    (out / "csv").mkdir(exist_ok=True)
    dbpath = out / "dai.db"
    if dbpath.exists():
        dbpath.unlink()
    con = sqlite3.connect(dbpath)
    con.executescript(ddl())
    con.execute("PRAGMA foreign_keys=ON")
    for table, rows in data.items():
        cols = columns(table)
        pd.DataFrame(rows, columns=cols).to_csv(
            out / "csv" / f"{table}.csv", index=False, float_format="%.8g"
        )
        if rows:
            con.executemany(
                f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                [
                    [
                        int(v) if isinstance(v, (bool, np.bool_)) else v
                        for v in (r[c] for c in cols)
                    ]
                    for r in rows
                ],
            )
    con.commit()
    if con.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("SQLite FK failure")
    con.close()
    (out / "schema.sql").write_text(ddl(postgres=True))
    (out / "config.snapshot.json").write_text(json.dumps(cfg, indent=2) + "\n")
    tables = {t: len(r) for t, r in data.items()}
    scenarios = Counter(r["scenario"] for r in data["scenario_memberships"])
    edge = Counter(
        r["scenario"] for r in data["scenario_memberships"] if r["is_edge_case_seed"]
    )
    manifest = {
        "synthetic": True,
        "seed": cfg["seed"],
        "as_of_date": cfg["as_of_date"],
        "tables": tables,
        "scenario_counts": dict(sorted(scenarios.items())),
        "edge_scenario_counts": dict(sorted(edge.items())),
        "edge_mothers": sum(r["is_edge_case_seed"] for r in data["mothers"]),
        "sha256": {
            str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((out / "csv").glob("*.csv"))
        },
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        "\nTABLE ROW COUNTS\n"
        + pd.DataFrame(list(tables.items()), columns=["table", "rows"]).to_string(
            index=False
        )
    )
    print(
        "\nSCENARIO COUNTS\n"
        + pd.DataFrame(
            [(s, scenarios[s], edge[s]) for s in SCENARIOS],
            columns=["scenario", "all_mothers", "oversampled"],
        ).to_string(index=False)
    )
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "config.yaml")
    ap.add_argument("--hospitals", type=int)
    ap.add_argument("--patients", type=int)
    ap.add_argument("--seed", type=int)
    ap.add_argument("--output", type=Path, default=ROOT / "output")
    args = ap.parse_args()
    cfg = config_load(args.config)
    for key in ("hospitals", "patients", "seed"):
        if getattr(args, key) is not None:
            cfg[key] = getattr(args, key)
    if cfg["hospitals"] < 6:
        ap.error(
            "At least 6 hospitals are required to cover all six configured states."
        )
    out = args.output.resolve()
    temp = out.with_name(out.name + ".building")
    if out.exists() and any(out.iterdir()):
        manifest = out / "manifest.json"
        if not manifest.exists() or not json.loads(manifest.read_text()).get(
            "synthetic"
        ):
            ap.error(
                "Refusing to replace a non-generator directory. Select an empty output directory."
            )
    if temp.exists():
        shutil.rmtree(temp)
    try:
        data = Generator(cfg).run()
        export(data, cfg, temp)
        from validate import validate_output

        if not validate_output(temp):
            raise RuntimeError(
                "Validation failed; incomplete output retained in " + str(temp)
            )
        if out.exists():
            shutil.rmtree(out)
        temp.rename(out)
        print(f"\nCOMPLETE: {out}")
    except (ValueError, RuntimeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
