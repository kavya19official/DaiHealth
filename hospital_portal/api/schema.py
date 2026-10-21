"""Portable relational schema. PostgreSQL uses native UUIDs; local preview uses SQLite."""

from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import (
    MetaData,
    Table,
    Column,
    String,
    Integer,
    Float,
    Boolean,
    DateTime,
    JSON,
    ForeignKey,
    Uuid,
    UniqueConstraint,
    CheckConstraint,
)

metadata = MetaData()


def now():
    return datetime.now(timezone.utc)


def table(name, *columns, constraints=()):
    return Table(
        name,
        metadata,
        Column(
            "id", Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
        ),
        Column("source_id", String, unique=True),
        Column("created_at", DateTime(timezone=True), nullable=False, default=now),
        Column(
            "updated_at",
            DateTime(timezone=True),
            nullable=False,
            default=now,
            onupdate=now,
        ),
        *columns,
        *constraints,
    )


def text(name, nullable=True):
    return Column(name, String, nullable=nullable)


def number(name, nullable=True):
    return Column(name, Integer, nullable=nullable)


def flag(name, default=False):
    return Column(name, Boolean, nullable=False, default=default)


def ref(name, target, nullable=True):
    return Column(
        name, Uuid(as_uuid=False), ForeignKey(target + ".id"), nullable=nullable
    )


def data(name="details"):
    return Column(name, JSON, nullable=False, default=dict)


facility = table(
    "facility",
    text("name", False),
    text("tier", False),
    text("ownership", False),
    text("address", False),
    Column("lat", Float, nullable=False),
    Column("lng", Float, nullable=False),
    text("abdm_facility_id"),
    text("nabh_status"),
    text("nabl_status"),
    flag("emergency_24x7"),
    flag("sos_participating"),
    number("authorized_beds", False),
    number("functional_beds", False),
    data("capabilities"),
    constraints=(
        CheckConstraint("authorized_beds >= functional_beds AND functional_beds >= 0"),
    ),
)
department = table(
    "department", ref("facility_id", "facility", False), text("name", False)
)
ward = table(
    "ward",
    ref("facility_id", "facility", False),
    ref("department_id", "department"),
    text("name", False),
    text("care_area", False),
    number("capacity", False),
)
unit = table(
    "unit",
    ref("facility_id", "facility", False),
    ref("department_id", "department", False),
    text("code", False),
    number("anc_day"),
    number("gynae_day"),
    number("opd_day"),
    number("ot_day"),
    ref("ward_id", "ward"),
    ref("gynae_ward_id", "ward"),
    ref("labour_room_id", "ward"),
    text("room"),
)
clinic = table(
    "clinic",
    ref("facility_id", "facility", False),
    ref("unit_id", "unit", False),
    text("name", False),
    number("day", False),
    text("start_time", False),
    text("end_time", False),
    text("room", False),
)
user = table(
    "portal_user",
    ref("facility_id", "facility", False),
    ref("department_id", "department"),
    ref("unit_id", "unit"),
    text("name", False),
    text("email", False),
    text("role", False),
    text("registration_no"),
    flag("verified"),
    text("password_hash", False),
    data(),
    constraints=(UniqueConstraint("email"),),
)
role_permission = table(
    "role_permission",
    text("role", False),
    text("permission", False),
    constraints=(UniqueConstraint("role", "permission"),),
)
patient = table(
    "patient",
    ref("facility_id", "facility", False),
    text("name", False),
    text("subject_type", False),
)
mother = table(
    "mother",
    ref("patient_id", "patient", False),
    ref("registered_facility_id", "facility", False),
    ref("assigned_unit_id", "unit", False),
    ref("assigned_doctor_id", "portal_user", False),
    text("uhid", False),
    text("abha_id"),
    number("age", False),
    text("edd"),
    number("gestation_weeks"),
    text("blood_group"),
    flag("clinician_high_risk"),
    text("high_risk_reason_by_clinician"),
    ref("validated_by", "portal_user"),
    data("consent_flags"),
    data(),
    constraints=(UniqueConstraint("uhid"),),
)
bed = table(
    "bed",
    ref("ward_id", "ward", False),
    text("label", False),
    text("type", False),
    flag("has_oxygen"),
    flag("has_monitor"),
    flag("has_ventilator"),
    text("status", False),
    Column("status_since", DateTime(timezone=True), nullable=False),
    ref("current_patient_id", "patient"),
    number("version", False),
    constraints=(
        CheckConstraint(
            "status IN ('AVAILABLE','OCCUPIED','CLEANING','MAINTENANCE','RESERVED')"
        ),
    ),
)
bed_state_history = table(
    "bed_state_history",
    ref("bed_id", "bed", False),
    text("previous_status"),
    text("status", False),
    ref("patient_id", "patient"),
    ref("actor_id", "portal_user"),
    text("reason", False),
    Column("effective_at", DateTime(timezone=True), nullable=False),
)
critical_unit = table(
    "critical_unit",
    ref("facility_id", "facility", False),
    ref("ward_id", "ward", False),
    text("category", False),
    number("bed_count", False),
    number("ventilator_count", False),
)
admission = table(
    "admission",
    ref("facility_id", "facility", False),
    ref("patient_id", "patient", False),
    ref("bed_id", "bed", False),
    Column("admitted_at", DateTime(timezone=True), nullable=False),
    Column("discharged_at", DateTime(timezone=True)),
    ref("actor_id", "portal_user"),
    text("discharge_summary"),
)
child = table(
    "child",
    ref("mother_id", "mother", False),
    ref("patient_id", "patient", False),
    number("birth_order", False),
    text("date_of_birth", False),
    number("birth_weight_g", False),
    data(),
)
anc_visit = table(
    "anc_visit",
    ref("mother_id", "mother", False),
    ref("doctor_id", "portal_user"),
    ref("facility_id", "facility", False),
    text("visit_date", False),
    data(),
)
investigation_order = table(
    "investigation_order",
    ref("mother_id", "mother", False),
    ref("facility_id", "facility", False),
    text("test", False),
    text("status", False),
    text("due_date"),
    data(),
)
investigation_result = table(
    "investigation_result",
    ref("order_id", "investigation_order", False),
    ref("uploaded_by", "portal_user"),
    data("values"),
    text("report_key"),
)
delivery_record = table(
    "delivery_record",
    ref("mother_id", "mother", False),
    ref("facility_id", "facility", False),
    ref("doctor_id", "portal_user", False),
    ref("labour_room_id", "ward", False),
    ref("bed_id", "bed", False),
    text("mode", False),
    text("delivered_at", False),
    data(),
)
birth_record = table(
    "birth_record",
    ref("delivery_id", "delivery_record", False),
    ref("child_id", "child", False),
    number("birth_order", False),
    data(),
)
vaccination_record = table(
    "vaccination_record",
    ref("child_id", "child"),
    ref("mother_id", "mother"),
    ref("facility_id", "facility", False),
    text("vaccine", False),
    text("due_date", False),
    text("given_date"),
    text("status", False),
)
postnatal_followup = table(
    "postnatal_followup",
    ref("mother_id", "mother", False),
    text("due_date", False),
    text("completed_at"),
    data(),
)
care_gap = table(
    "care_gap",
    ref("mother_id", "mother"),
    ref("child_id", "child"),
    ref("order_id", "investigation_order"),
    text("expected_item", False),
    text("due_date", False),
    text("status", False),
    data(),
)
blood_stock_snapshot = table(
    "blood_stock_snapshot",
    ref("facility_id", "facility", False),
    text("blood_group", False),
    text("component", False),
    number("units", False),
    text("snapshot_at", False),
)
blood_request = table(
    "blood_request",
    ref("facility_id", "facility", False),
    ref("mother_id", "mother", False),
    text("blood_group", False),
    text("component", False),
    number("units", False),
    text("status", False),
)
blood_issue_log = table(
    "blood_issue_log",
    ref("request_id", "blood_request"),
    ref("facility_id", "facility", False),
    number("units", False),
    data(),
)
inventory_item = table(
    "inventory_item",
    text("name", False),
    text("unit", False),
    number("reorder_level", False),
)
inventory_stock = table(
    "inventory_stock",
    ref("facility_id", "facility", False),
    ref("item_id", "inventory_item", False),
    number("quantity", False),
    text("expiry", False),
)
inventory_consumption = table(
    "inventory_consumption",
    ref("facility_id", "facility", False),
    ref("item_id", "inventory_item", False),
    number("quantity", False),
    text("consumed_at", False),
)
equipment = table(
    "equipment",
    ref("ward_id", "ward", False),
    text("type", False),
    text("status", False),
    text("last_service"),
    text("next_service_due"),
    number("usage_hours"),
    number("fault_count"),
    data(),
)
equipment_fault_log = table(
    "equipment_fault_log",
    ref("equipment_id", "equipment", False),
    text("status", False),
    data(),
)
staff_post = table(
    "staff_post",
    ref("facility_id", "facility", False),
    text("cadre", False),
    number("sanctioned", False),
    number("in_position", False),
)
shift = table(
    "shift",
    ref("facility_id", "facility", False),
    text("name", False),
    text("start_time", False),
    text("end_time", False),
)
roster_entry = table(
    "roster_entry",
    ref("facility_id", "facility", False),
    ref("user_id", "portal_user"),
    ref("ward_id", "ward"),
    text("roster_date", False),
    text("start_time", False),
    text("end_time", False),
    data(),
)
on_call_entry = table(
    "on_call_entry",
    ref("user_id", "portal_user", False),
    text("day", False),
    text("start_time", False),
    text("end_time", False),
)
leave = table(
    "staff_leave",
    ref("user_id", "portal_user", False),
    text("start_date", False),
    text("end_date", False),
    text("status", False),
)
ambulance = table(
    "ambulance",
    ref("facility_id", "facility", False),
    text("label", False),
    text("type", False),
    text("status", False),
    Column("gps_lat", Float),
    Column("gps_lng", Float),
    ref("driver_id", "portal_user"),
)
dispatch_log = table(
    "dispatch_log",
    ref("ambulance_id", "ambulance", False),
    ref("mother_id", "mother"),
    text("status", False),
    data(),
)
sos_request = table(
    "sos_request",
    ref("mother_id", "mother", False),
    Column("lat", Float),
    Column("lng", Float),
    text("trigger_time", False),
    flag("auth_layer_1_ok"),
    flag("auth_layer_2_ok"),
    text("status", False),
    ref("accepted_facility_id", "facility"),
)
sos_event_timeline = table(
    "sos_event_timeline",
    ref("sos_id", "sos_request", False),
    text("event", False),
    text("event_time", False),
    data(),
)
sos_abuse_log = table(
    "sos_abuse_log", ref("sos_id", "sos_request", False), text("reason", False)
)
referral = table(
    "referral",
    ref("from_facility_id", "facility", False),
    ref("to_facility_id", "facility", False),
    ref("mother_id", "mother", False),
    text("reason", False),
    text("status", False),
    data(),
)
readiness_check = table(
    "readiness_check",
    ref("mother_id", "mother", False),
    ref("facility_id", "facility", False),
    number("score", False),
    text("status", False),
    data("missing_items"),
    data("inputs"),
)
reservation = table(
    "reservation",
    text("resource_type", False),
    ref("bed_id", "bed"),
    ref("mother_id", "mother", False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    text("state", False),
    ref("accepted_by", "portal_user", False),
)
alert = table(
    "alert",
    ref("facility_id", "facility", False),
    text("type", False),
    text("severity", False),
    text("reason_text", False),
    data("inputs_json"),
    text("status", False),
)
worklist_item = table(
    "worklist_item",
    ref("facility_id", "facility", False),
    ref("mother_id", "mother"),
    ref("assigned_to", "portal_user"),
    text("status", False),
    data(),
)
review_case = table(
    "review_case",
    ref("facility_id", "facility", False),
    ref("mother_id", "mother"),
    text("type", False),
    text("status", False),
    data(),
)
audit_log = table(
    "audit_log",
    ref("actor_id", "portal_user"),
    text("action", False),
    text("entity_type", False),
    text("entity_id", False),
    data(),
)
consent_ledger = table(
    "consent_ledger",
    ref("mother_id", "mother", False),
    ref("actor_id", "portal_user"),
    text("purpose", False),
    flag("granted"),
)
break_glass_event = table(
    "break_glass_event",
    ref("mother_id", "mother", False),
    ref("actor_id", "portal_user", False),
    text("reason", False),
    text("status", False),
)
ml_prediction = table(
    "ml_prediction",
    ref("facility_id", "facility", False),
    text("model_name", False),
    text("target_date", False),
    Column("value", Float),
    Column("lower", Float),
    Column("upper", Float),
    data("explanation_json"),
    ref("accepted_by", "portal_user"),
)
ml_model_registry = table(
    "ml_model_registry",
    text("name", False),
    text("version", False),
    data("metrics"),
    text("trained_on", False),
    text("data_label", False),
)
seed_manifest = table(
    "seed_manifest",
    text("source_sha256", False),
    text("as_of_date", False),
    data("counts"),
    data("assumptions"),
)
auth_challenge = table(
    "auth_challenge",
    ref("user_id", "portal_user", False),
    text("otp_hash", False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    number("attempts", False),
    flag("consumed"),
)
auth_session = table(
    "auth_session",
    ref("user_id", "portal_user", False),
    text("refresh_hash", False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    flag("revoked"),
    ref("impersonated_by", "portal_user"),
)

organisation_role = table(
    "organisation_role",
    ref("facility_id", "facility", False),
    text("role_name", False),
    text("fictional_holder_name", False),
    text("email", False),
    text("appointed_on", False),
)
icu_admission_log = table(
    "icu_admission_log",
    ref("critical_unit_id", "critical_unit", False),
    ref("admission_id", "admission", False),
    data(),
)

# Facility-reported sustainability observations are separate from clinical records.
sustainability_measurement = table(
    "sustainability_measurement",
    ref("facility_id", "facility", False),
    ref("recorded_by", "portal_user", False),
    text("period", False),
    text("metric", False),
    Column("value", Float, nullable=False),
    text("quality", False),
    text("source", False),
    text("evidence", False),
    number("occupied_bed_days"),
    constraints=(
        UniqueConstraint("facility_id", "period", "metric"),
        CheckConstraint("value >= 0"),
        CheckConstraint("occupied_bed_days IS NULL OR occupied_bed_days > 0"),
    ),
)
sustainability_action = table(
    "sustainability_action",
    ref("facility_id", "facility", False),
    ref("owner_id", "portal_user", False),
    text("title", False),
    text("metric", False),
    Column("baseline", Float, nullable=False),
    Column("target", Float, nullable=False),
    text("unit", False),
    text("due_date", False),
    text("status", False),
    data(),
    constraints=(CheckConstraint("baseline >= 0 AND target >= 0"),),
)
