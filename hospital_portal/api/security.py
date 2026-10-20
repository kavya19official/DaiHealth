"""Authentication primitives and a deny-by-default permission catalogue."""

import hashlib
import hmac
import secrets

ROLES = {
    "hospital_admin": {
        "facility.read",
        "facility.write",
        "patient.read",
        "bed.read",
        "bed.write",
        "audit.read",
        "user.verify",
        "demo.switch",
    },
    "consultant": {"facility.read", "patient.read", "risk.validate", "bed.read"},
    "resident": {"facility.read", "patient.read", "bed.read"},
    "nurse": {"facility.read", "bed.read", "bed.write"},
    "bed_manager": {"facility.read", "bed.read", "bed.write"},
    "blood_bank": {"facility.read", "blood.read", "blood.write"},
    "pharmacist": {"facility.read", "inventory.read", "inventory.write"},
    "lab_technician": {"facility.read", "diagnostics.read", "diagnostics.write"},
    "dispatcher": {"facility.read", "sos.read", "sos.write"},
    "biomedical": {"facility.read", "equipment.read", "equipment.write"},
    "phc_user": {"facility.read", "referral.read", "referral.write", "patient.read"},
    "quality_officer": {"facility.read", "audit.read", "quality.read"},
    "front_desk": {"facility.read", "registration.write", "bed.read"},
}
CLINICAL = {"consultant", "resident"}


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 260000
    ).hex()
    return f"pbkdf2_sha256${salt}${digest}"


def verify_password(password, stored):
    try:
        _, salt, digest = stored.split("$")
        return hmac.compare_digest(
            hashlib.pbkdf2_hmac(
                "sha256", password.encode(), salt.encode(), 260000
            ).hex(),
            digest,
        )
    except (ValueError, AttributeError):
        return False


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()
