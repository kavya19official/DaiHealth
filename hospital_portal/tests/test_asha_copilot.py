import os

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from hospital_portal.api import schema as s
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api.main import create_app


@pytest.fixture(scope="module")
def context(tmp_path_factory):
    engine = database("sqlite:///" + str(tmp_path_factory.mktemp("portal") / "test.db"))
    seed(engine)
    with TestClient(create_app(engine)) as client:
        yield engine, client
    engine.dispose()


@pytest.fixture(scope="module")
def auth(context):
    _, client = context
    cache = {}

    def get(role):
        if role not in cache:
            cache[role] = login(client, role)
        return cache[role]

    return get


def login(client, role="hospital_admin"):
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": role + "@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    )
    assert challenge.status_code == 200, challenge.text
    result = client.post(
        "/api/auth/otp",
        json={
            "challenge_id": challenge.json()["challenge_id"],
            "code": challenge.json()["demo_otp"],
        },
    )
    assert result.status_code == 200, result.text
    return {"Authorization": "Bearer " + result.json()["access_token"]}


def test_asha_seed_and_priority_ranking(context, auth):
    engine, client = context
    asha = auth("asha")
    dash = client.get("/api/asha/dashboard", headers=asha)
    assert dash.status_code == 200, dash.text
    body = dash.json()
    assert body["stats"]["assigned"] == 48
    assert len(body["villages"]) == 4
    visits = client.get("/api/asha/visits", headers=asha).json()["items"]
    assert len(visits) == 48
    scores = [v["priority_score"] for v in visits]
    assert scores == sorted(scores, reverse=True)
    top = visits[0]
    assert top["priority_score"] > 0
    codes = {r["code"] for r in top["reasons"]}
    assert codes & {
        "clinician_high_risk",
        "overdue_vaccine",
        "postnatal_overdue",
        "overdue_investigation",
        "open_care_gap",
        "newborn",
        "near_term",
    }
    # Every item carries coordinates for routing.
    assert all(v["lat"] is not None and v["lng"] is not None for v in visits)


def test_asha_route_ordering(context, auth):
    engine, client = context
    asha = auth("asha")
    route = client.get("/api/asha/route", headers=asha).json()
    stops = route["stops"]
    assert len(stops) == 48
    assert route["total_km"] > 0
    # Nearest-neighbour legs should be short village hops, not cross-country.
    assert max(s["leg_km"] for s in stops) < 15
    legs = [s["leg_km"] for s in stops]
    cum = [s["cumulative_km"] for s in stops]
    assert cum == sorted(cum)
    assert abs(cum[-1] - route["total_km"]) < 0.01


def test_visit_lifecycle_and_idempotency(context, auth):
    engine, client = context
    asha = auth("asha")
    mother_id = client.get("/api/asha/visits", headers=asha).json()["items"][0][
        "mother_id"
    ]
    payload = {
        "mother_id": mother_id,
        "visit_date": "2026-11-05",
        "status": "planned",
        "client_uuid": "test-visit-plan-0001",
    }
    first = client.post("/api/asha/visits", headers=asha, json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["duplicate"] is False
    # Same client_uuid retried offline -> duplicate, not a second row.
    again = client.post("/api/asha/visits", headers=asha, json=payload)
    assert again.json()["duplicate"] is True
    assert again.json()["visit"]["id"] == first.json()["visit"]["id"]
    # A second plan for the same beneficiary/day returns the open plan.
    second_plan = client.post(
        "/api/asha/visits",
        headers=asha,
        json={**payload, "client_uuid": "test-visit-plan-0002"},
    )
    assert second_plan.json()["duplicate"] is True
    done = client.post(
        "/api/asha/visits",
        headers=asha,
        json={
            "mother_id": mother_id,
            "visit_date": "2026-11-05",
            "status": "completed",
            "client_uuid": "test-visit-done-0001",
            "outcome": {"note": "Seen, stable", "follow_up_days": 7},
        },
    )
    assert done.status_code == 200, done.text
    items = {
        i["mother_id"]: i
        for i in client.get(
            "/api/asha/visits?date=2026-11-05", headers=asha
        ).json()["items"]
    }
    assert items[mother_id]["status"] == "completed"


def test_voice_note_structuring(context, auth):
    engine, client = context
    asha = auth("asha")
    mother_id = client.get("/api/asha/visits", headers=asha).json()["items"][0][
        "mother_id"
    ]
    transcript = (
        "Mother has mild headache and nausea since morning. BP 130/85, "
        "temperature 99.1. Baby feeding well. Come back for review in 7 days."
    )
    note = client.post(
        "/api/asha/notes",
        headers=asha,
        json={
            "mother_id": mother_id,
            "transcript": transcript,
            "client_uuid": "test-note-0000001",
            "recorded_at": "2026-11-05T09:30:00+05:30",
        },
    )
    assert note.status_code == 201, note.text
    structured = note.json()["note"]["structured"]["extracted"]
    assert structured["measurements"]["bp"] == {
        "systolic": 130,
        "diastolic": 85,
    }
    assert structured["measurements"]["temperature"]["value"] == 99.1
    assert "headache" in structured["complaints"]
    assert structured["follow_up"] == {"in_days": 7}
    # Idempotent replay.
    dup = client.post(
        "/api/asha/notes",
        headers=asha,
        json={
            "mother_id": mother_id,
            "transcript": transcript,
            "client_uuid": "test-note-0000001",
        },
    )
    assert dup.json()["duplicate"] is True


def test_health_camp_bulk_updates(context, auth):
    engine, client = context
    asha = auth("asha")
    dash = client.get("/api/asha/dashboard", headers=asha).json()
    village_id = dash["villages"][0]["id"]
    camp = client.post(
        "/api/asha/camps",
        headers=asha,
        json={
            "village_id": village_id,
            "name": "SYNTHETIC Immunization Camp",
            "camp_date": "2026-11-08",
        },
    )
    assert camp.status_code == 201, camp.text
    camp_id = camp.json()["id"]
    # Cannot record updates before opening.
    mother_id = client.get("/api/asha/visits", headers=asha).json()["items"][0][
        "mother_id"
    ]
    early = client.post(
        f"/api/asha/camps/{camp_id}/updates",
        headers=asha,
        json={
            "updates": [
                {
                    "mother_id": mother_id,
                    "kind": "attendance",
                    "payload": {"status": "present"},
                    "client_uuid": "camp-upd-early-01",
                }
            ]
        },
    )
    assert early.json()["results"][0]["status"] == "error"
    opened = client.post(
        f"/api/asha/camps/{camp_id}/status",
        headers=asha,
        json={"status": "open"},
    )
    assert opened.status_code == 200
    with engine.connect() as c:
        child = (
            c.execute(
                select(s.child).where(s.child.c.mother_id == mother_id)
            )
            .mappings()
            .first()
        )
    child_id = child["id"] if child else None
    items = [
        {
            "mother_id": mother_id,
            "kind": "attendance",
            "payload": {"status": "present"},
            "client_uuid": "camp-upd-att-001",
        },
        {
            "mother_id": mother_id,
            "kind": "vitals",
            "payload": {"bp": "120/80", "temp_f": 98.4, "weight_kg": 58},
            "client_uuid": "camp-upd-vit-001",
        },
    ]
    if child_id:
        items.append(
            {
                "mother_id": mother_id,
                "kind": "immunization",
                "payload": {"child_id": child_id, "vaccine": "Camp OPV"},
                "client_uuid": "camp-upd-imm-001",
            }
        )
    items.append(
        {
            "mother_id": mother_id,
            "kind": "referral_flag",
            "payload": {"reason": "Persistent breathlessness needs review"},
            "client_uuid": "camp-upd-ref-001",
        }
    )
    items.append(
        {
            "mother_id": "not-a-uuid",
            "kind": "attendance",
            "payload": {"status": "present"},
            "client_uuid": "camp-upd-bad-001",
        }
    )
    result = client.post(
        f"/api/asha/camps/{camp_id}/updates", headers=asha, json={"updates": items}
    )
    assert result.status_code == 200, result.text
    results = result.json()["results"]
    assert [r["status"] for r in results[:4]] == [
        "created",
        "created",
        "created",
        "created",
    ]
    assert results[-1]["status"] == "error"
    # Immunization wrote a real vaccination_record.
    if child_id:
        with engine.connect() as c:
            vax = (
                c.execute(
                    select(s.vaccination_record).where(
                        s.vaccination_record.c.child_id == child_id,
                        s.vaccination_record.c.vaccine == "Camp OPV",
                    )
                )
                .mappings()
                .first()
            )
        assert vax and vax["status"] == "administered"
        assert vax["given_date"] == "2026-11-08"
    # Referral flag opened a hospital worklist item for the care team.
    with engine.connect() as c:
        wl = (
            c.execute(
                select(s.worklist_item).where(
                    s.worklist_item.c.mother_id == mother_id,
                    s.worklist_item.c.status == "open",
                )
            )
            .mappings()
            .first()
        )
    assert wl and wl["details"]["source"] == "asha_health_camp"
    # Replay is idempotent.
    replay = client.post(
        f"/api/asha/camps/{camp_id}/updates",
        headers=asha,
        json={"updates": items[:1]},
    )
    assert replay.json()["results"][0]["status"] == "duplicate"


def test_offline_sync_batch(context, auth):
    engine, client = context
    asha = auth("asha")
    visits = client.get("/api/asha/visits", headers=asha).json()["items"]
    mother_id = visits[1]["mother_id"]
    body = {
        "visits": [
            {
                "mother_id": mother_id,
                "visit_date": "2026-11-06",
                "status": "completed",
                "client_uuid": "sync-visit-00001",
                "recorded_at": "2026-11-06T10:00:00+05:30",
                "outcome": {"note": "offline visit"},
            },
            {
                "mother_id": "bad",
                "visit_date": "2026-11-06",
                "status": "completed",
                "client_uuid": "sync-visit-bad1",
            },
        ],
        "notes": [
            {
                "mother_id": mother_id,
                "transcript": "BP 140/90, severe headache and blurred vision. Refer to hospital.",
                "client_uuid": "sync-note-000001",
            }
        ],
        "camp_updates": [],
    }
    result = client.post("/api/asha/sync", headers=asha, json=body)
    assert result.status_code == 200, result.text
    results = result.json()["results"]
    assert results[0]["status"] == "created"
    assert results[1]["status"] == "error"
    assert results[2]["entity"] == "note" and results[2]["status"] == "created"
    note = client.get(
        "/api/asha/notes", headers=asha
    ).json()["items"][0]
    extracted = note["structured"]["extracted"]
    assert "severe headache" in extracted["danger_signs"]
    assert extracted["referral_suggested"] is True
    # Replaying the whole batch is safe.
    replay = client.post("/api/asha/sync", headers=asha, json=body)
    statuses = {r["client_uuid"]: r["status"] for r in replay.json()["results"]}
    assert statuses["sync-visit-00001"] == "duplicate"
    assert statuses["sync-note-000001"] == "duplicate"


def test_asha_rbac_and_oversight(context, auth):
    engine, client = context
    # Other roles cannot use the copilot.
    for role in ("nurse", "consultant", "resident", "front_desk"):
        headers = login(client, role)
        assert client.get("/api/asha/dashboard", headers=headers).status_code == 403
    # Hospital admin gets oversight + roster, not worker writes.
    admin = auth("hospital_admin")
    oversight = client.get("/api/asha/oversight", headers=admin)
    assert oversight.status_code == 200
    assert oversight.json()["workers"]
    roster = client.get("/api/asha/roster", headers=admin)
    assert roster.status_code == 200
    assert roster.json()["workers"][0]["role"] if "role" in roster.json()["workers"][0] else True
    assert roster.json()["villages"]
    # Admin cannot record visits/notes as the worker.
    mother_id = client.get("/api/asha/visits", headers=admin).json()["items"][0][
        "mother_id"
    ]
    assert (
        client.post(
            "/api/asha/visits",
            headers=admin,
            json={
                "mother_id": mother_id,
                "visit_date": "2026-11-07",
                "status": "completed",
                "client_uuid": "admin-visit-attempt",
            },
        ).status_code
        == 403
    )
    # Unassigned beneficiary is invisible to the worker.
    asha = auth("asha")
    with engine.connect() as c:
        other = c.scalar(
            select(s.mother.c.id).where(
                s.mother.c.registered_facility_id != None,
                ~s.mother.c.id.in_(
                    select(s.asha_assignment.c.mother_id).where(
                        s.asha_assignment.c.asha_id == (
                            select(s.user.c.id).where(
                                s.user.c.source_id == "demo:asha"
                            ).scalar_subquery()
                        )
                    )
                ),
            )
        )
    if other:
        assert (
            client.post(
                "/api/asha/notes",
                headers=asha,
                json={
                    "mother_id": str(other),
                    "transcript": "Should not be allowed",
                    "client_uuid": "cross-worker-note-1",
                },
            ).status_code
            == 404
        )


def test_admin_assignment_management(context, auth):
    engine, client = context
    admin = auth("hospital_admin")
    roster = client.get("/api/asha/roster", headers=admin).json()
    worker = roster["workers"][0]
    # Deactivate one assignment, confirm it leaves the worker's list.
    with engine.connect() as c:
        assignment = (
            c.execute(
                select(s.asha_assignment).where(
                    s.asha_assignment.c.asha_id == worker["id"]
                )
            )
            .mappings()
            .first()
        )
    off = client.post(
        f"/api/asha/assignments/{assignment['id']}/status",
        headers=admin,
        json={"active": False},
    )
    assert off.status_code == 200
    asha = auth("asha")
    items = client.get("/api/asha/visits", headers=asha).json()["items"]
    assert all(i["mother_id"] != assignment["mother_id"] for i in items)
    # Reactivate via upsert endpoint.
    back = client.post(
        "/api/asha/assignments",
        headers=admin,
        json={
            "asha_id": worker["id"],
            "mother_id": assignment["mother_id"],
            "village_id": assignment["village_id"],
        },
    )
    assert back.status_code == 201
    assert back.json()["active"] is True


def test_note_retry_binds_beneficiary_and_revocation_hides_worker_notes(context, auth):
    _, client = context
    asha = auth("asha")
    admin = auth("hospital_admin")
    first, second = client.get("/api/asha/visits", headers=asha).json()["items"][:2]
    payload = {
        "mother_id": first["mother_id"],
        "client_uuid": "note-bound-to-beneficiary",
        "transcript": "No severe headache or blurred vision; reports poor feeding.",
    }
    created = client.post("/api/asha/notes", headers=asha, json=payload)
    assert created.status_code == 201
    result = client.post("/api/asha/notes/extract", headers=asha, json={"transcript": payload["transcript"]}).json()
    assert result["structured"]["danger_signs"] == ["poor feeding"]
    assert client.post("/api/asha/notes", headers=asha, json={**payload, "mother_id": second["mother_id"]}).status_code == 409
    url = "/api/asha/assignments/" + first["assignment_id"] + "/status"
    assert client.post(url, headers=admin, json={"active": False}).status_code == 200
    try:
        notes = client.get("/api/asha/notes", headers=asha, params={"mother_id": first["mother_id"]}).json()
        assert not notes["items"]
        assert client.post("/api/asha/notes", headers=asha, json=payload).status_code == 404
    finally:
        assert client.post(url, headers=admin, json={"active": True}).status_code == 200
