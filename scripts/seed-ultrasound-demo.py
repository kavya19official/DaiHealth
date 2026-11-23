"""Seed demonstration ultrasound workspace scans for the local demo.

Creates synthetic, clearly-labelled demonstration scans for the seeded demo
mother (patient_account_id from users.id) reviewed by the seeded demo doctor.
Images are generated synthetically and encrypted with DAI_ULTRASOUND_IMAGE_KEY,
exactly as live uploads are. No real patient data is used.

Run from the repo root with the hospital portal venv:

    set -a && . ./.local/ultrasound-demo.env && set +a
    hospital_portal/.venv/bin/python scripts/seed-ultrasound-demo.py

Safe to re-run: rows are keyed by (patient, episode, doctor, facility, digest).
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

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
    rng = np.random.default_rng(abs(hash(seed)) % (2**32))
    return rng.integers(135, 155)


def quality_stats():
    return {"width": 800.0, "height": 540.0, "std": 52.4, "dynamic_range": 214.0, "focus": 9.8}


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
    key_hex = os.environ.get("DAI_ULTRASOUND_IMAGE_KEY", "")
    if len(key_hex) != 64:
        sys.exit("DAI_ULTRASOUND_IMAGE_KEY (64 hex chars) is required")
    cipher = AESGCM(bytes.fromhex(key_hex))
    now = datetime.now(timezone.utc)
    engine = create_engine("sqlite:///" + str(DB))
    scans = s.ultrasound_workspace_scan
    inserted = skipped = 0
    with engine.begin() as conn:
        existing = {r.image_digest for r in conn.execute(
            select(scans.c.image_digest).where(
                scans.c.doctor_account_id == DOCTOR_ACCOUNT_ID)).all()}
        for row in build_scans(now):
            if row["image_digest"] in existing:
                skipped += 1
                continue
            png = row.pop("_png")
            nonce = os.urandom(12)
            row["image_ciphertext"] = nonce + cipher.encrypt(
                nonce, png, row["id"].encode())
            conn.execute(scans.insert().values(**row))
            inserted += 1
    print(json.dumps({"inserted": inserted, "skipped": skipped, "db": str(DB)}))


if __name__ == "__main__":
    main()
