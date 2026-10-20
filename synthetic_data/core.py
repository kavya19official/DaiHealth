"""Schema and deterministic schedule logic shared by generation and validation."""

from __future__ import annotations
import calendar
import hashlib
import json
import math
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def config_load(path=ROOT / "config.yaml"):
    # This documented YAML subset is JSON with whole-line YAML comments.
    return json.loads(
        "\n".join(
            s
            for s in Path(path).read_text().splitlines()
            if not s.lstrip().startswith("#")
        )
    )


def day(value):
    return date.fromisoformat(str(value)[:10])


def iso(value):
    return value.isoformat() if value is not None else None


def add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


def haversine(a, b, c, d):
    a, b, c, d = map(math.radians, (a, b, c, d))
    return (
        6371.0088
        * 2
        * math.asin(
            min(
                1,
                math.sqrt(
                    math.sin((c - a) / 2) ** 2
                    + math.cos(a) * math.cos(c) * math.sin((d - b) / 2) ** 2
                ),
            )
        )
    )


def stage(p, asof):
    elapsed = (asof - day(p["lmp"])).days
    if p["outcome_date"]:
        after = (asof - day(p["outcome_date"])).days
        if after == 0:
            return "Delivered"
        if after <= 42:
            return "Postpartum 0-6wk"
        if after <= 365:
            return "Postpartum 6wk-1yr"
        return "Child-care"
    if elapsed < 0:
        return "Preconception"
    if p["labour_started_at"]:
        return "In-labour"
    if elapsed < 98:
        return "T1"
    if elapsed < 196:
        return "T2"
    return "T3"


def vaccine_due(child, vaccine):
    name, days, months = vaccine
    dob = day(child["date_of_birth"])
    return add_months(dob, months) if months else dob + timedelta(days=days)


def vaccine_status(due, given, asof, grace):
    if given:
        return "given"
    if due >= asof:
        return "due"
    return "overdue" if (asof - due).days <= grace else "missed"


# Each definition uses explicit FK constraints. Patients is a synthetic subject
# registry so polymorphic mother/child/background references are real SQL FKs.
SPECS = {
    "hospitals": "hospital_id TEXT PK;name TEXT NOT NULL;tier TEXT NOT NULL;district TEXT;state TEXT;pincode TEXT;latitude REAL;longitude REAL;ownership TEXT;nabh_accredited BOOLEAN;has_nicu_level TEXT;has_blood_bank BOOLEAN;has_ambulance_count INTEGER;is_sos_participating BOOLEAN;emergency_24x7 BOOLEAN;total_beds INTEGER;ot_count INTEGER;labour_table_count INTEGER",
    "departments": "department_id TEXT PK;hospital_id TEXT NOT NULL FK hospitals.hospital_id;name TEXT NOT NULL",
    "wards": "ward_id TEXT PK;hospital_id TEXT NOT NULL FK hospitals.hospital_id;department_id TEXT FK departments.department_id;ward_type TEXT;capacity INTEGER;oxygen_supported BOOLEAN",
    "patients": "patient_id TEXT PK;patient_type TEXT;synthetic_label TEXT;is_synthetic BOOLEAN",
    "beds": "bed_id TEXT PK;ward_id TEXT NOT NULL FK wards.ward_id;bed_type TEXT;status TEXT;oxygen_supported BOOLEAN;monitor_attached BOOLEAN;current_patient_id TEXT FK patients.patient_id",
    "equipment": "equipment_id TEXT PK;hospital_id TEXT FK hospitals.hospital_id;ward_id TEXT FK wards.ward_id;type TEXT;installed_quantity INTEGER;functional_quantity INTEGER;status TEXT;last_service_date DATE",
    "hospital_services": "hospital_id TEXT PK FK hospitals.hospital_id;c_section BOOLEAN;blood_transfusion BOOLEAN;mtp BOOLEAN;labour_room_24x7 BOOLEAN;emergency_obstetric_care TEXT;neonatal_resuscitation BOOLEAN;vaccination_centre BOOLEAN;diagnostic_tests TEXT;obstetric_hdu BOOLEAN",
    "blood_bank": "blood_bank_id TEXT PK;hospital_id TEXT FK hospitals.hospital_id;blood_group TEXT;units_available INTEGER",
    "doctors": "doctor_id TEXT PK;hospital_id TEXT NOT NULL FK hospitals.hospital_id;department_id TEXT NOT NULL FK departments.department_id;name TEXT;gender TEXT;specialty TEXT;designation TEXT;qualification TEXT;experience_years INTEGER;registration_number TEXT UNIQUE;languages_spoken TEXT;high_risk_pregnancy_certified BOOLEAN;max_daily_patients INTEGER",
    "doctor_schedules": "schedule_id TEXT PK;doctor_id TEXT FK doctors.doctor_id;day INTEGER;start_time TEXT;end_time TEXT;clinic_type TEXT;is_on_call BOOLEAN",
    "nurses_midwives": "staff_id TEXT PK;hospital_id TEXT FK hospitals.hospital_id;ward_id TEXT FK wards.ward_id;name TEXT;designation TEXT;languages_spoken TEXT",
    "mothers": "mother_id TEXT PK FK patients.patient_id;name TEXT;age INTEGER;district TEXT;state TEXT;pincode TEXT;preferred_language TEXT;literacy_level TEXT;digital_literacy TEXT;income_band TEXT;scheme_enrolment TEXT;home_latitude REAL;home_longitude REAL;phone TEXT;phone_numeric_core TEXT;contact_is_dialable BOOLEAN;caregiver_contact TEXT;registered_hospital_id TEXT NOT NULL FK hospitals.hospital_id;assigned_obgyn_id TEXT NOT NULL FK doctors.doctor_id;is_edge_case_seed BOOLEAN;dropout_probability REAL;distance_km REAL;messiness_tag TEXT",
    "pregnancies": "pregnancy_id TEXT PK;mother_id TEXT NOT NULL FK mothers.mother_id;lmp DATE NOT NULL;edd DATE NOT NULL;current_gestational_week INTEGER;current_stage TEXT;gravida INTEGER;para INTEGER;living_children INTEGER;plurality TEXT;plurality_count INTEGER;chorionicity TEXT;conception_type TEXT;prior_cesarean INTEGER;outcome TEXT;outcome_date DATE;labour_started_at TIMESTAMP;is_edge_case_seed BOOLEAN;confirmed_high_risk BOOLEAN;clinical_hb REAL;clinical_sbp INTEGER;clinical_dbp INTEGER;ogtt_2h_mg_dl REAL;conditions TEXT;prior_district TEXT;migration_date DATE",
    "referrals": "referral_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;referred_from_hospital_id TEXT FK hospitals.hospital_id;referred_to_hospital_id TEXT FK hospitals.hospital_id;reason TEXT;referred_at TIMESTAMP;transport_time_min INTEGER;referring_doctor_id TEXT FK doctors.doctor_id;receiving_doctor_id TEXT FK doctors.doctor_id",
    "anc_expected": "expected_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;gestational_week INTEGER;due_date DATE",
    "anc_visits": "visit_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;expected_id TEXT UNIQUE FK anc_expected.expected_id;visit_date DATE;gestational_week_at_visit INTEGER;hospital_id TEXT FK hospitals.hospital_id;doctor_id TEXT FK doctors.doctor_id;bp_systolic INTEGER;bp_diastolic INTEGER;weight_kg REAL;hb REAL;fundal_height_cm REAL;fetal_heart_rate INTEGER;urine_albumin TEXT;urine_sugar TEXT;ifa_given BOOLEAN;calcium_given BOOLEAN;td_dose_given INTEGER;notes_code TEXT;entered_at DATE",
    "investigations": "investigation_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;hospital_id TEXT FK hospitals.hospital_id;ordered_by_doctor_id TEXT FK doctors.doctor_id;test_type TEXT;ordered_date DATE;due_date DATE;completed_date DATE;gestational_week INTEGER;status TEXT;result_value TEXT;result_flag TEXT;referral_id TEXT FK referrals.referral_id",
    "risk_flags": "flag_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;risk_type TEXT;severity TEXT;raised_by TEXT;validated_by_doctor_id TEXT FK doctors.doctor_id;validation_status TEXT;date DATE",
    "admissions": "admission_id TEXT PK;patient_id TEXT NOT NULL FK patients.patient_id;hospital_id TEXT FK hospitals.hospital_id;ward_id TEXT FK wards.ward_id;bed_id TEXT FK beds.bed_id;admitted_at TIMESTAMP;discharged_at TIMESTAMP;admission_reason TEXT",
    "delivery_records": "delivery_id TEXT PK;pregnancy_id TEXT UNIQUE FK pregnancies.pregnancy_id;hospital_id TEXT FK hospitals.hospital_id;delivering_doctor_id TEXT FK doctors.doctor_id;mode TEXT;gestational_age_at_birth INTEGER;birth_timing TEXT;blood_loss_ml INTEGER;transfusion_units INTEGER;complications TEXT;ward_id TEXT FK wards.ward_id;bed_id TEXT FK beds.bed_id;admission_id TEXT FK admissions.admission_id;admitted_at TIMESTAMP;delivered_at TIMESTAMP;discharged_at TIMESTAMP;maternal_outcome TEXT;referral_id TEXT FK referrals.referral_id",
    "newborns": "child_id TEXT PK FK patients.patient_id;mother_id TEXT FK mothers.mother_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;delivery_id TEXT FK delivery_records.delivery_id;birth_order INTEGER;birth_label TEXT;date_of_birth DATE;sex TEXT;birth_weight_g INTEGER;apgar_1min INTEGER;apgar_5min INTEGER;gestational_age INTEGER;nicu_admission BOOLEAN;nicu_bed_id TEXT FK beds.bed_id;nicu_admission_id TEXT FK admissions.admission_id;outcome TEXT;death_date DATE;paediatrician_id TEXT FK doctors.doctor_id",
    "stillbirths": "stillbirth_id TEXT PK;mother_id TEXT FK mothers.mother_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;delivery_id TEXT FK delivery_records.delivery_id;birth_order INTEGER;date_of_birth DATE;sex TEXT;birth_weight_g INTEGER",
    "vaccinations": "vaccination_id TEXT PK;subject_id TEXT FK patients.patient_id;child_id TEXT FK newborns.child_id;mother_id TEXT FK mothers.mother_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;vaccine_code TEXT;due_date DATE;given_date DATE;status TEXT;centre_hospital_id TEXT FK hospitals.hospital_id;not_applicable_after_death BOOLEAN",
    "growth_records": "growth_id TEXT PK;child_id TEXT FK newborns.child_id;measured_on DATE;age_months INTEGER;weight_kg REAL;height_cm REAL;head_cm REAL;weight_for_age_z REAL;height_for_age_z REAL;weight_for_height_z REAL;underweight BOOLEAN;stunting BOOLEAN;wasting BOOLEAN;motor_check TEXT;language_check TEXT;social_check TEXT",
    "postpartum_expected": "expected_id TEXT PK;pregnancy_id TEXT FK pregnancies.pregnancy_id;postpartum_day INTEGER;due_date DATE",
    "postpartum_visits": "pnc_id TEXT PK;expected_id TEXT UNIQUE FK postpartum_expected.expected_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;visit_date DATE;postpartum_day INTEGER;hospital_id TEXT FK hospitals.hospital_id;doctor_id TEXT FK doctors.doctor_id;care_setting TEXT;epds_score INTEGER;breastfeeding_status TEXT;contraception_counselling BOOLEAN;hb_recheck REAL",
    "appointments": "appointment_id TEXT PK;subject_id TEXT FK patients.patient_id;mother_id TEXT FK mothers.mother_id;child_id TEXT FK newborns.child_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;doctor_id TEXT FK doctors.doctor_id;hospital_id TEXT FK hospitals.hospital_id;appointment_date DATE;start_time TEXT;end_time TEXT;status TEXT;reason TEXT",
    "care_gaps": "gap_id TEXT PK;subject_type TEXT;subject_id TEXT FK patients.patient_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;source_table TEXT;source_id TEXT;expected_item TEXT;due_date DATE;detected_on DATE;gap_type TEXT;severity TEXT;status TEXT;action_recommended TEXT;closed_on DATE",
    "emergency_events": "event_id TEXT PK;mother_id TEXT FK mothers.mother_id;child_id TEXT FK newborns.child_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;triggered_at TIMESTAMP;trigger_latitude REAL;trigger_longitude REAL;required_capability TEXT;first_auth_passed BOOLEAN;second_auth_family_contact TEXT;second_auth_doctor_id TEXT FK doctors.doctor_id;second_auth_passed BOOLEAN;nearest_hospital_id TEXT FK hospitals.hospital_id;distance_km REAL;response_time_min INTEGER;outcome TEXT;bed_allocated TEXT FK beds.bed_id;admission_id TEXT FK admissions.admission_id",
    "scenario_memberships": "membership_id TEXT PK;mother_id TEXT FK mothers.mother_id;pregnancy_id TEXT FK pregnancies.pregnancy_id;scenario TEXT;is_edge_case_seed BOOLEAN",
}


def columns(table):
    return [s.strip().split()[0] for s in SPECS[table].split(";")]


def pk(table):
    return columns(table)[0]


def fk_specs():
    for table, spec in SPECS.items():
        for field in spec.split(";"):
            m = re.search(r"FK (\w+)\.(\w+)", field)
            if m:
                yield table, field.strip().split()[0], m[1], m[2]


def ddl(postgres=False):
    statements = ["-- DAI SYNTHETIC DATA ONLY. No clinical compliance claim."]
    if not postgres:
        statements += ["PRAGMA foreign_keys = ON;"]
    for table, spec in SPECS.items():
        parts = []
        for field in spec.split(";"):
            field = field.strip().replace(" PK", " PRIMARY KEY NOT NULL")
            field = re.sub(r" FK (\w+)\.(\w+)", r" REFERENCES \1(\2)", field)
            if postgres:
                field = field.replace(" REAL", " DOUBLE PRECISION")
            parts.append(field)
        if table == "beds":
            parts.append("CHECK (status IN ('available','occupied','maintenance'))")
        if table == "hospitals":
            parts += [
                "CHECK (latitude BETWEEN 6 AND 38)",
                "CHECK (longitude BETWEEN 68 AND 98)",
            ]
        if table == "vaccinations":
            parts.append("CHECK ((child_id IS NOT NULL) <> (mother_id IS NOT NULL))")
        if table == "emergency_events":
            parts.append("CHECK ((child_id IS NOT NULL) <> (mother_id IS NOT NULL))")
        if table == "newborns":
            parts.append("UNIQUE (pregnancy_id,birth_order)")
        if table == "stillbirths":
            parts.append("UNIQUE (pregnancy_id,birth_order)")
        if table == "doctor_schedules":
            parts.append("CHECK (start_time < end_time)")
        statements.append(
            "CREATE TABLE " + table + " (\n  " + ",\n  ".join(parts) + "\n);"
        )
    for i, (t, c, _, _) in enumerate(fk_specs()):
        statements.append(f"CREATE INDEX idx_fk_{i} ON {t} ({c});")
    statements += [
        "CREATE UNIQUE INDEX one_current_bed_per_patient ON beds(current_patient_id) WHERE current_patient_id IS NOT NULL;"
    ]
    return "\n\n".join(statements) + "\n"


AUTO_FLAGS = {
    "twins",
    "triplets",
    "quadruplets",
    "anaemia_severe",
    "preeclampsia",
    "severe_preeclampsia",
    "placenta_praevia",
    "hiv_art",
    "prior_two_cs",
}
SEVERE = {
    "anaemia_severe",
    "preeclampsia",
    "severe_preeclampsia",
    "eclampsia",
    "hellp",
    "placenta_praevia",
    "abruption",
    "uterine_rupture",
    "pph",
    "aph",
    "obstructed_labour",
    "sepsis",
    "cord_prolapse",
    "prior_two_cs",
    "hiv_art",
}
EDGE_BUNDLES = [
    ["twins_dcda", "anaemia_mild"],
    ["twins_mcda", "anaemia_moderate"],
    ["twins_mcma", "fgr"],
    ["triplets", "preterm_labour"],
    ["quadruplets", "anaemia_severe"],
    ["adolescent", "dropout"],
    ["advanced_age", "hypothyroidism"],
    ["gdm", "polyhydramnios"],
    ["preexisting_diabetes", "gdm_screen_excluded"],
    ["gestational_hypertension", "oligohydramnios"],
    ["preeclampsia", "fgr"],
    ["severe_preeclampsia", "abruption", "aph"],
    ["eclampsia", "preterm_labour"],
    ["hellp", "pph"],
    ["hepatitis_b", "anaemia_mild"],
    ["hiv_art", "tb"],
    ["syphilis", "stillbirth"],
    ["rh_alloimmunisation", "anaemia_moderate"],
    ["placenta_praevia", "aph"],
    ["prior_cs_vbac", "post_term"],
    ["prior_two_cs", "pph"],
    ["pprom", "preterm_labour"],
    ["obstructed_labour", "uterine_rupture"],
    ["sepsis", "neonatal_death"],
    ["cord_prolapse"],
    ["shoulder_dystocia", "pph"],
    ["miscarriage"],
    ["ectopic"],
    ["down_screen_high", "migrated"],
    ["postpartum_depression", "breastfeeding_difficulty"],
]
STAGES = [
    "Preconception",
    "T1",
    "T2",
    "T3",
    "In-labour",
    "Delivered",
    "Postpartum 0-6wk",
    "Postpartum 6wk-1yr",
    "Child-care",
]
SCENARIOS = sorted(
    {x for b in EDGE_BUNDLES for x in b if x != "gdm_screen_excluded"}
    | {"normal_low_risk"}
    | {"stage:" + s for s in STAGES}
    | {"MTP", "molar"}
)


def derive_gaps(data, cfg):
    """Pure expected-versus-recorded comparison, independent of saved gaps."""
    out = []
    asof = day(cfg["as_of_date"])
    preg = {r["pregnancy_id"]: r for r in data["pregnancies"]}
    anc = {r["expected_id"]: r for r in data["anc_visits"]}
    pnc = {r["expected_id"]: r for r in data["postpartum_visits"]}

    def emit(
        kind,
        subject,
        subject_type,
        pid,
        src,
        rid,
        item,
        due,
        severity="medium",
        closed=None,
    ):
        if day(due) >= asof:
            return
        key = "|".join((kind, src, rid))
        out.append(
            dict(
                gap_id="GAP-" + hashlib.sha256(key.encode()).hexdigest()[:20],
                subject_type=subject_type,
                subject_id=subject,
                pregnancy_id=pid,
                source_table=src,
                source_id=rid,
                expected_item=item,
                due_date=due,
                detected_on=iso(day(due) + timedelta(days=1)),
                gap_type=kind,
                severity=severity,
                status="closed" if closed else "open",
                action_recommended={
                    "missed ANC visit": "Arrange ANC follow-up",
                    "missed PNC": "Arrange postnatal follow-up",
                    "missed vaccine": "Contact vaccination centre",
                    "overdue test": "Complete ordered investigation",
                    "unvalidated high-risk flag": "Request certified clinician validation",
                }[kind],
                closed_on=closed,
            )
        )

    for e in data["anc_expected"]:
        actual = anc.get(e["expected_id"])
        if not actual or day(actual["visit_date"]) > day(e["due_date"]) + timedelta(
            days=1
        ):
            emit(
                "missed ANC visit",
                preg[e["pregnancy_id"]]["mother_id"],
                "mother",
                e["pregnancy_id"],
                "anc_expected",
                e["expected_id"],
                f"ANC week {e['gestational_week']}",
                e["due_date"],
                closed=actual["visit_date"] if actual else None,
            )
    for e in data["postpartum_expected"]:
        actual = pnc.get(e["expected_id"])
        if not actual or day(actual["visit_date"]) > day(e["due_date"]) + timedelta(
            days=1
        ):
            emit(
                "missed PNC",
                preg[e["pregnancy_id"]]["mother_id"],
                "mother",
                e["pregnancy_id"],
                "postpartum_expected",
                e["expected_id"],
                f"PNC day {e['postpartum_day']}",
                e["due_date"],
                closed=actual["visit_date"] if actual else None,
            )
    for r in data["investigations"]:
        if not r["completed_date"] or day(r["completed_date"]) > day(
            r["due_date"]
        ) + timedelta(days=1):
            emit(
                "overdue test",
                preg[r["pregnancy_id"]]["mother_id"],
                "mother",
                r["pregnancy_id"],
                "investigations",
                r["investigation_id"],
                r["test_type"],
                r["due_date"],
                closed=r["completed_date"],
            )
    for r in data["vaccinations"]:
        if r["not_applicable_after_death"]:
            continue
        # A recorded birth dose is allowed within its configured clinical window;
        # later catch-up closes a gap with an auditable event date.
        if not r["given_date"] or day(r["given_date"]) > day(r["due_date"]) + timedelta(
            days=cfg["care"]["vaccine_grace_days"]
        ):
            due = iso(
                day(r["due_date"]) + timedelta(days=cfg["care"]["vaccine_grace_days"])
            )
            emit(
                "missed vaccine",
                r["subject_id"],
                "child" if r["child_id"] else "mother",
                r["pregnancy_id"],
                "vaccinations",
                r["vaccination_id"],
                r["vaccine_code"],
                due,
                closed=r["given_date"],
            )
    for r in data["risk_flags"]:
        if r["severity"] == "high" and r["validation_status"] == "pending":
            emit(
                "unvalidated high-risk flag",
                preg[r["pregnancy_id"]]["mother_id"],
                "mother",
                r["pregnancy_id"],
                "risk_flags",
                r["flag_id"],
                r["risk_type"],
                r["date"],
                "high",
            )
    return sorted(out, key=lambda r: r["gap_id"])
