"""Seed demonstration ultrasound workspace scans for the local demo.

Without --manifest, creates the legacy hard-coded synthetic demo scans. With
--manifest, seeds the synthetic cohort exported by the Node clinical-foundation
seeder, preserving its canonical account, facility and episode identifiers.
Images are encrypted with DAI_ULTRASOUND_IMAGE_KEY, exactly as live uploads are.
No real patient data is used.

Run from the repo root with the hospital portal venv:

    set -a && . ./.local/ultrasound-demo.env && set +a
    hospital_portal/.venv/bin/python scripts/seed-ultrasound-demo.py
    hospital_portal/.venv/bin/python scripts/seed-ultrasound-demo.py \
        --manifest .local/clinical-foundation-ultrasound.json

Safe to re-run: rows are keyed by (patient, doctor, facility, episode, digest).
"""
import argparse
import hashlib
import json
import math
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hospital_portal"))

import numpy as np
from PIL import Image
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import create_engine, select

from api import schema as s

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / ".local" / "portal.db"
PATIENT_ACCOUNT_ID = 151      # mother@dai-synthetic.invalid
DOCTOR_ACCOUNT_ID = 24        # doctor@dai-synthetic.invalid
FACILITY_REF = "05bfef8fd39659f9b367ec5762e633d4"
EPISODE = "2025-10-13"        # recorded LMP anchor for the demo pregnancy
PREGNANCY = {"stage": "pregnant", "lmp": "2025-10-13", "edd": "2026-07-20",
             "gestation_weeks": 32, "demo": True}
DEMO_NOTE = ("PUBLIC DEMONSTRATION IMAGE — NOT THIS PATIENT'S ACTUAL SCAN — "
             "NOT FOR CLINICAL USE.")
SYNTHETIC_LABEL = "Synthetic"
SYNTHETIC_NOTE = (f"{DEMO_NOTE}\nSYNTHETIC DATA — measurements, findings and review "
                  "events are generated for demonstration only.")
ALLOWED_SCAN_STATES = {"released", "under_review", "pending"}
ASSETS = ROOT / "frontend" / "assets" / "ultrasound-demo"
# Real CC BY 4.0 ultrasound frames (see frontend/assets/ultrasound-demo/CREDITS.md).
SCAN_IMAGES = {
    "anomaly_20w": "brain_1012.png",
    "growth_32w": "abdomen_1427.png",
    "growth_34w": "femur_1135.png",
    "growth_35w": "thorax_1466.png",
    "profile_19w": "profile_14.png",
    "brain_alt": "brain_1013.png",
}
# Second synthetic mother visible to the same demo doctor (no patient login exists
# for her; scans appear in the clinician workspace only).
PATIENT_ACCOUNT_ID_2 = 188


def scan_image(key):
    """Load a real demonstration ultrasound frame (PNG bytes)."""
    return (ASSETS / SCAN_IMAGES[key]).read_bytes()


def measurements(scan_date, weeks, trimester):
    ga = weeks
    bpd = round(60 + ga * 1.15, 1)          # mm, Hadlock-ish trajectory
    hc = round(160 + ga * 3.4, 1)
    ac = round(90 + ga * 3.1, 1) if trimester == 2 else round(240 + (ga - 28) * 12, 1)
    fl = round(30 + ga * 1.05, 1)
    efw = int(round(3200 * (ga / 40.0) ** 3))  # Hadlock-style cubic estimate, grams
    return {
        "demo": True,
        "scan_date": scan_date,
        "gestational_age_weeks": ga,
        "bpd_mm": bpd, "hc_mm": hc, "ac_mm": ac, "fl_mm": fl,
        "estimated_fetal_weight_g": efw,
        "fetal_heart_rate_bpm": int(rng_hr(scan_date)),
        "placenta": "posterior, not praevia" if trimester == 2 else "fundal, grade I",
        "amniotic_fluid": "normal (AFI 9.2 cm)" if trimester == 3 else "adequate",
        "presentation": "cephalic" if trimester == 3 else "variable",
        "note": DEMO_NOTE,
    }


def rng_hr(seed):
    digest = hashlib.sha256(seed.encode()).digest()
    return np.random.default_rng(int.from_bytes(digest[:4], "big")).integers(135, 155)


def quality_stats():
    return {"width": 800.0, "height": 540.0, "std": 52.4, "dynamic_range": 214.0, "focus": 9.8}


def manifest_error(path, message):
    raise ValueError(f"Invalid ultrasound manifest at {path}: {message}")


def manifest_object(value, path):
    if not isinstance(value, dict):
        manifest_error(path, "expected an object")
    return value


def manifest_list(value, path):
    if not isinstance(value, list):
        manifest_error(path, "expected an array")
    return value


def manifest_text(value, path, max_length=None):
    if not isinstance(value, str) or not value.strip():
        manifest_error(path, "expected a non-empty string")
    if max_length is not None and len(value) > max_length:
        manifest_error(path, f"must be at most {max_length} characters")
    return value


def manifest_id(value, path):
    if type(value) is not int or not 0 < value <= 2147483647:
        manifest_error(path, "expected a positive 32-bit integer ID")
    return value


def manifest_facility(value, path):
    value = manifest_text(value, path, 64)
    try:
        UUID(value)
    except ValueError:
        manifest_error(path, "expected a UUID facility reference")
    return value


def manifest_date(value, path):
    value = manifest_text(value, path)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        manifest_error(path, "expected an ISO date (YYYY-MM-DD)")
    if parsed.isoformat() != value:
        manifest_error(path, "expected an ISO date (YYYY-MM-DD)")
    return value


def manifest_weeks(value, path):
    if (type(value) not in (int, float) or value <= 0
            or isinstance(value, float) and not math.isfinite(value)):
        manifest_error(path, "expected a positive number of weeks")
    return value


def manifest_label(value, path):
    if value != SYNTHETIC_LABEL:
        manifest_error(path, f"expected data_label {SYNTHETIC_LABEL!r}")
    return value


def load_manifest(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read ultrasound manifest {path}: {exc}") from None


def build_manifest_scans(manifest, now):
    """Validate a Node cohort manifest and build encrypted-scan insert rows."""
    manifest = manifest_object(manifest, "$")
    manifest_text(manifest.get("version"), "$.version")
    manifest_label(manifest.get("data_label"), "$.data_label")
    manifest_date(manifest.get("as_of_date"), "$.as_of_date")
    manifest_text(manifest.get("notice"), "$.notice")

    doctor_ids = set()
    for index, doctor in enumerate(manifest_list(manifest.get("doctors"), "$.doctors")):
        path = f"$.doctors[{index}]"
        doctor = manifest_object(doctor, path)
        doctor_id = manifest_id(doctor.get("id"), f"{path}.id")
        if doctor_id in doctor_ids:
            manifest_error(f"{path}.id", "duplicate doctor ID")
        doctor_ids.add(doctor_id)
        manifest_text(doctor.get("email"), f"{path}.email")
        manifest_text(doctor.get("full_name"), f"{path}.full_name")

    rows = []
    for patient_index, patient in enumerate(manifest_list(manifest.get("patients"), "$.patients")):
        path = f"$.patients[{patient_index}]"
        patient = manifest_object(patient, path)
        patient_id = manifest_id(patient.get("id"), f"{path}.id")
        manifest_text(patient.get("email"), f"{path}.email")
        doctor_id = manifest_id(patient.get("doctor_id"), f"{path}.doctor_id")
        if doctor_id not in doctor_ids:
            manifest_error(f"{path}.doctor_id", "does not match a manifest doctor")
        facility_ref = manifest_facility(patient.get("facility_ref"), f"{path}.facility_ref")
        episode = manifest_text(patient.get("episode"), f"{path}.episode", 40)

        context_path = f"{path}.pregnancy_context"
        context = manifest_object(patient.get("pregnancy_context"), context_path)
        stage = manifest_text(context.get("stage"), f"{context_path}.stage", 40)
        lmp = manifest_date(context.get("lmp"), f"{context_path}.lmp")
        edd = manifest_date(context.get("edd"), f"{context_path}.edd")
        gestation_weeks = manifest_weeks(context.get("gestation_weeks"),
                                         f"{context_path}.gestation_weeks")
        manifest_label(context.get("data_label"), f"{context_path}.data_label")
        if context.get("demo") is not True:
            manifest_error(f"{context_path}.demo", "expected true")

        for scan_index, scan in enumerate(manifest_list(patient.get("scans"), f"{path}.scans")):
            scan_path = f"{path}.scans[{scan_index}]"
            scan = manifest_object(scan, scan_path)
            manifest_text(scan.get("key"), f"{scan_path}.key", 120)
            image_key = manifest_text(scan.get("image"), f"{scan_path}.image")
            if image_key not in SCAN_IMAGES:
                manifest_error(f"{scan_path}.image",
                               f"unknown image key {image_key!r}; choose from {sorted(SCAN_IMAGES)}")
            state = manifest_text(scan.get("state"), f"{scan_path}.state")
            if state not in ALLOWED_SCAN_STATES:
                manifest_error(f"{scan_path}.state",
                               f"expected one of {sorted(ALLOWED_SCAN_STATES)}")
            scan_type = manifest_text(scan.get("scan_type"), f"{scan_path}.scan_type", 80)
            scan_date = manifest_date(scan.get("scan_date"), f"{scan_path}.scan_date")
            scan_week = manifest_weeks(scan.get("scan_week"), f"{scan_path}.scan_week")
            manifest_label(scan.get("data_label"), f"{scan_path}.data_label")

            png = scan_image(image_key)
            digest = hashlib.sha256(png).hexdigest()
            created = datetime.combine(date.fromisoformat(scan_date), time(9),
                                       tzinfo=timezone.utc)
            trimester = 1 if scan_week < 14 else 2 if scan_week < 28 else 3
            measure = measurements(scan_date, scan_week, trimester)
            measure.update(scan_type=scan_type, data_label=SYNTHETIC_LABEL,
                           note=f"{SYNTHETIC_NOTE}\nSynthetic {scan_type} biometry; "
                                "not measured from the image.")
            released = state == "released"
            default_findings = (f"Synthetic {scan_type} demonstration record. Biometry, "
                                "fluid and placental descriptions are scripted and are not "
                                "patient-specific interpretations.")
            findings = (f"{SYNTHETIC_NOTE}\n" + manifest_text(
                scan.get("findings") or default_findings,
                f"{scan_path}.findings", 2000)) if released else None
            instructions = (f"{SYNTHETIC_NOTE}\n" + manifest_text(
                scan.get("instructions") or "Arrange follow-up through the authorised "
                "clinical team; this is a demonstration workflow only.",
                f"{scan_path}.instructions", 2000)) if released else None
            review_note = (f"{SYNTHETIC_NOTE}\n" + manifest_text(
                scan.get("review_note") or "Synthetic scripted review_complete event; "
                "no approved model ran.", f"{scan_path}.review_note", 2000)) if released else None
            rows.append(dict(
                id=str(uuid4()), patient_account_id=patient_id,
                doctor_account_id=doctor_id, facility_ref=facility_ref,
                episode=episode, image_digest=digest, image_ciphertext=None,
                image_expires_at=now + timedelta(days=60),
                pregnancy_context={
                    "stage": stage, "lmp": lmp, "edd": edd,
                    "gestation_weeks": gestation_weeks,
                    "data_label": SYNTHETIC_LABEL, "demo": True,
                    "scan_ga_weeks": scan_week, "scan_date": scan_date,
                },
                analysis={
                    "state": "model_unavailable", "quality": quality_stats(),
                    "reasons": ["no_approved_model"], "measurements": measure,
                    "data_label": SYNTHETIC_LABEL, "demo": True,
                },
                revision=2 if released else 1,
                started_at=created + timedelta(hours=2) if state != "pending" else None,
                reviewed_at=created + timedelta(days=1) if released else None,
                released_at=created + timedelta(days=1, hours=4) if released else None,
                decision="review_complete" if released else None,
                review_note=review_note,
                findings=findings, instructions=instructions,
                created_at=created, _png=png,
            ))
    return rows


def scan_scope(row):
    return (row["patient_account_id"], row["doctor_account_id"],
            row["facility_ref"], row["episode"], row["image_digest"])


def build_scans(now):
    scans = [
        # 1. Released T2 anatomy scan (~20w) — full report visible to mother.
        dict(
            days_ago=104, weeks=20, trimester=2, image="anomaly_20w",
            findings=(f"{DEMO_NOTE}\nSingle live fetus, cephalic presentation. "
                      "Four-chamber heart view obtained; outflow tracts partially visualised. "
                      "No gross structural abnormality identified on this screening sweep."),
            instructions=("Book anomaly-scan follow-up with Dr Hemangini Batra. "
                          "Continue folic acid and iron supplementation. "
                          "Report promptly for reduced fetal movements or bleeding."),
            decision="review_complete",
            note="Screening sweep; measurements within expected range for dates.",
            released=True,
        ),
        # 2. Released T3 growth scan (~32w) — EFW, FHR, AFI, placenta.
        dict(
            days_ago=21, weeks=32, trimester=3, image="growth_32w",
            findings=(f"{DEMO_NOTE}\nSingle live fetus, cephalic, engaged in pelvis. "
                      "Biometry appropriate for gestational age. Placenta fundal grade I, "
                      "clear of the internal os. Amniotic fluid volume normal."),
            instructions=("Growth scan in 3 weeks. Discuss birth-plan preferences at next visit. "
                          "Seek urgent review for leaking, bleeding or absent movements."),
            decision="review_complete",
            note="EFW tracking 45th centile; AFI normal; no evidence of growth restriction.",
            released=True,
        ),
        # 3. Under review — doctor started but has not released.
        dict(
            days_ago=2, weeks=34, trimester=3, image="growth_34w",
            findings=None, instructions=None, decision=None, note=None,
            started=True, released=False,
        ),
        # 4. Pending — awaiting clinician review (demo of live review flow).
        dict(
            days_ago=0, weeks=35, trimester=3, image="growth_35w",
            findings=None, instructions=None, decision=None, note=None,
            started=False, released=False,
        ),
    ]
    rows = []
    for spec in scans:
        created = now - timedelta(days=spec["days_ago"], hours=hash(spec["image"]) % 9)
        scan_date = created.date().isoformat()
        import hashlib
        png = scan_image(spec["image"])
        digest = hashlib.sha256(png).hexdigest()
        measure = measurements(scan_date, spec["weeks"], spec["trimester"])
        measure["scan_type"] = "anomaly" if spec["trimester"] == 2 else "growth"
        analysis = {
            "state": "model_unavailable",
            "quality": quality_stats(),
            "reasons": ["no_approved_model"],
            "measurements": measure,
        }
        reviewed_at = created + timedelta(hours=30) if spec["released"] else None
        released_at = created + timedelta(hours=52) if spec["released"] else None
        started_at = created + timedelta(hours=6) if spec.get("started") or spec["released"] else None
        rows.append(dict(
            id=str(uuid4()), patient_account_id=PATIENT_ACCOUNT_ID,
            doctor_account_id=DOCTOR_ACCOUNT_ID, facility_ref=FACILITY_REF,
            episode=EPISODE, image_digest=digest, image_ciphertext=None,  # filled below
            image_expires_at=now + timedelta(days=60),
            pregnancy_context={**PREGNANCY, "scan_ga_weeks": spec["weeks"],
                               "scan_date": scan_date},
            analysis=analysis, revision=2 if spec["released"] else 1,
            started_at=started_at, reviewed_at=reviewed_at, released_at=released_at,
            decision=spec["decision"], review_note=spec["note"],
            findings=spec["findings"], instructions=spec["instructions"],
            created_at=created, _png=png,
        ))
    # Second mother: two scans for clinician-side variety (different patient,
    # different images and gestational ages).
    for spec in (
        dict(days_ago=45, weeks=19, trimester=2, image="profile_19w",
             findings=(f"{DEMO_NOTE}\nDating scan: single live fetus in longitudinal lie. "
                       "Crown-rump length consistent with recorded LMP."),
             instructions="Return for anomaly scan at 20-22 weeks.",
             decision="review_complete", note="Early dating scan; correlate clinically.", released=True),
        dict(days_ago=9, weeks=28, trimester=3, image="brain_alt",
             findings=None, instructions=None, decision=None, note=None,
             started=False, released=False),
    ):
        created = now - timedelta(days=spec["days_ago"], hours=5)
        scan_date = created.date().isoformat()
        png = scan_image(spec["image"])
        import hashlib
        digest = hashlib.sha256(png).hexdigest()
        measure = measurements(scan_date, spec["weeks"], spec["trimester"])
        measure["scan_type"] = "dating" if spec["weeks"] < 22 else "growth"
        rows.append(dict(
            id=str(uuid4()), patient_account_id=PATIENT_ACCOUNT_ID_2,
            doctor_account_id=DOCTOR_ACCOUNT_ID, facility_ref=FACILITY_REF,
            episode="2025-12-01", image_digest=digest, image_ciphertext=None,
            image_expires_at=now + timedelta(days=60),
            pregnancy_context={"stage": "pregnant", "lmp": "2025-12-01",
                               "edd": "2026-09-07", "gestation_weeks": spec["weeks"],
                               "scan_ga_weeks": spec["weeks"], "scan_date": scan_date, "demo": True},
            analysis={"state": "model_unavailable", "quality": quality_stats(),
                      "reasons": ["no_approved_model"], "measurements": measure},
            revision=2 if spec["released"] else 1,
            started_at=created + timedelta(hours=6) if spec["released"] else None,
            reviewed_at=created + timedelta(hours=30) if spec["released"] else None,
            released_at=created + timedelta(hours=52) if spec["released"] else None,
            decision=spec["decision"], review_note=spec["note"],
            findings=spec["findings"], instructions=spec["instructions"],
            created_at=created, _png=png,
        ))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, metavar="PATH",
                        help="JSON cohort exported by the Node synthetic seeder")
    args = parser.parse_args()
    key_hex = os.environ.get("DAI_ULTRASOUND_IMAGE_KEY", "")
    if len(key_hex) != 64:
        sys.exit("DAI_ULTRASOUND_IMAGE_KEY (64 hex chars) is required")
    cipher = AESGCM(bytes.fromhex(key_hex))
    now = datetime.now(timezone.utc)
    try:
        rows = (build_manifest_scans(load_manifest(args.manifest), now)
                if args.manifest else build_scans(now))
    except (OSError, ValueError) as exc:
        sys.exit(str(exc))
    engine = create_engine("sqlite:///" + str(DB))
    scans = s.ultrasound_workspace_scan
    scope_columns = (scans.c.patient_account_id, scans.c.doctor_account_id,
                     scans.c.facility_ref, scans.c.episode, scans.c.image_digest)
    inserted = skipped = 0
    with engine.begin() as conn:
        existing = {tuple(row) for row in conn.execute(select(*scope_columns)).all()}
        for row in rows:
            scope = scan_scope(row)
            if scope in existing:
                skipped += 1
                continue
            png = row.pop("_png")
            nonce = os.urandom(12)
            row["image_ciphertext"] = nonce + cipher.encrypt(
                nonce, png, row["id"].encode())
            conn.execute(scans.insert().values(**row))
            existing.add(scope)
            inserted += 1
    print(json.dumps({"inserted": inserted, "skipped": skipped, "db": str(DB)}))


if __name__ == "__main__":
    main()
