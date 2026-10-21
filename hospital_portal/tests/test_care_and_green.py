"""Preview coordination is stateful, evidence-backed and scoped; forecasts are untouched."""

import os

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update, func
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api.main import create_app
from hospital_portal.api import schema as s


@pytest.fixture(scope="module")
def portal(tmp_path_factory):
    engine = database(
        "sqlite:///" + str(tmp_path_factory.mktemp("care-green") / "preview.db")
    )
    seed(engine)
    # Give the demo resident one explicit synthetic assignment in this isolated test DB.
    with engine.begin() as c:
        resident = (
            c.execute(select(s.user).where(s.user.c.source_id == "demo:resident"))
            .mappings()
            .one()
        )
        mid = c.scalar(
            select(s.mother.c.id)
            .where(s.mother.c.assigned_unit_id == resident["unit_id"])
            .limit(1)
        )
        c.execute(
            update(s.mother)
            .where(s.mother.c.id == mid)
            .values(assigned_doctor_id=resident["id"])
        )
    with TestClient(create_app(engine)) as client:
        yield engine, client
    engine.dispose()


def login(client, role):
    cache = getattr(client, "care_headers", {})
    if role in cache:
        return cache[role]
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": role + "@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    ).json()
    response = client.post(
        "/api/auth/otp",
        json={"challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"]},
    )
    assert response.status_code == 200, response.text
    cache[role] = {"Authorization": "Bearer " + response.json()["access_token"]}
    client.care_headers = cache
    return cache[role]


def scope_data(engine):
    with engine.connect() as c:
        admin = (
            c.execute(
                select(s.user).where(
                    s.user.c.email == "hospital_admin@dai-synthetic.invalid"
                )
            )
            .mappings()
            .one()
        )
        resident = (
            c.execute(
                select(s.user).where(s.user.c.email == "resident@dai-synthetic.invalid")
            )
            .mappings()
            .one()
        )
        mother = (
            c.execute(
                select(s.mother).where(s.mother.c.assigned_doctor_id == resident["id"])
            )
            .mappings()
            .first()
        )
        outside = (
            c.execute(
                select(s.mother).where(
                    s.mother.c.registered_facility_id != admin["facility_id"]
                )
            )
            .mappings()
            .first()
        )
        return dict(admin), dict(resident), dict(mother), dict(outside)


def test_task_ownership_evidence_conflicts_and_source_preservation(portal):
    engine, client = portal
    h = login(client, "hospital_admin")
    admin, resident, mother, outside = scope_data(engine)
    with engine.connect() as c:
        before = dict(
            c.execute(select(s.mother).where(s.mother.c.id == mother["id"]))
            .mappings()
            .one()
        )
    payload = {
        "mother_id": mother["id"],
        "title": "Arrange postpartum appointment",
        "kind": "postpartum",
        "assigned_to": admin["id"],
        "due_date": "2026-11-05",
        "notes": "Verify appointment with family",
    }
    response = client.post("/api/care/tasks", headers=h, json=payload)
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    change = "/api/care/tasks/" + identifier + "/actions"
    assert (
        client.post(
            change,
            headers=h,
            json={"version": 1, "action": "complete", "notes": "Done"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 1,
                "action": "acknowledge",
                "notes": "I own the next call",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 1,
                "action": "contact",
                "outcome": "reached",
                "notes": "Stale client",
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 2,
                "action": "contact",
                "outcome": "no_answer",
                "barrier": "unreachable",
                "notes": "No response to first call",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 3,
                "action": "escalate",
                "barrier": "transport",
                "notes": "Transport support needed",
            },
        ).status_code
        == 200
    )
    inbox = client.get("/api/care/reviews", headers=h).json()["items"]
    assert any(r["details"].get("task_id") == identifier for r in inbox)
    assert (
        client.post(
            change,
            headers=h,
            json={"version": 4, "action": "escalate", "notes": "Duplicate escalation"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 4,
                "action": "complete",
                "outcome": "care_completed",
                "evidence": "Visit 1",
                "notes": "Claim clinical completion",
            },
        ).status_code
        == 403
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 4,
                "action": "complete",
                "outcome": "follow_up_booked",
                "evidence": "Appointment DEMO-1",
                "notes": "Family confirmed appointment",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 5,
                "action": "contact",
                "outcome": "reached",
                "notes": "Closed task edit",
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            change,
            headers=h,
            json={
                "version": 5,
                "action": "reopen",
                "notes": "Appointment subsequently cancelled",
            },
        ).status_code
        == 200
    )
    timeline = client.get("/api/patients/" + mother["id"] + "/coordination", headers=h)
    assert timeline.status_code == 200
    task = next(t for t in timeline.json()["tasks"] if t["id"] == identifier)
    assert len(task["details"]["history"]) == 5
    assert "completion" not in task["details"]
    assert task["details"]["version"] == 6
    with engine.connect() as c:
        after = dict(
            c.execute(select(s.mother).where(s.mother.c.id == mother["id"]))
            .mappings()
            .one()
        )
        assert after == before
        assert (
            c.scalar(
                select(func.count())
                .select_from(s.audit_log)
                .where(s.audit_log.c.entity_id == identifier)
            )
            >= 6
        )
    assert (
        client.post(
            "/api/care/tasks", headers=h, json={**payload, "mother_id": outside["id"]}
        ).status_code
        == 403
    )
    assert client.get("/api/care/tasks").status_code == 401


def test_gap_link_duplicate_and_separate_child_identity(portal):
    engine, client = portal
    h = login(client, "hospital_admin")
    admin, _, _, _ = scope_data(engine)
    gap = client.get("/api/care/gaps", headers=h).json()["items"][0]
    payload = {
        "mother_id": gap["subject_mother_id"],
        "child_id": gap["child_id"],
        "gap_id": gap["id"],
        "title": "Follow up source gap",
        "assigned_to": admin["id"],
        "due_date": "2026-11-01",
    }
    before = gap["status"]
    created = client.post("/api/care/tasks", headers=h, json=payload)
    assert created.status_code == 201, created.text
    assert client.post("/api/care/tasks", headers=h, json=payload).status_code == 409
    assert (
        client.get("/api/care/gaps", headers=h).json()["items"][0]["task"]["id"]
        == created.json()["id"]
    )
    with engine.connect() as c:
        assert (
            c.scalar(select(s.care_gap.c.status).where(s.care_gap.c.id == gap["id"]))
            == before
        )
        child = (
            c.execute(
                select(s.child).where(s.child.c.mother_id != gap["subject_mother_id"])
            )
            .mappings()
            .first()
        )
    assert (
        client.post(
            "/api/care/tasks",
            headers=h,
            json={
                **payload,
                "gap_id": None,
                "child_id": child["id"],
                "kind": "newborn",
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/care/tasks",
            headers=h,
            json={**payload, "gap_id": None, "child_id": None, "kind": "newborn"},
        ).status_code
        == 422
    )


def test_clinician_scope_and_approved_summary_revision(portal):
    engine, client = portal
    admin, resident, mother, outside = scope_data(engine)
    ah = login(client, "hospital_admin")
    rh = login(client, "resident")
    ch = login(client, "consultant")
    nh = login(client, "nurse")
    assert client.get("/api/care/options", headers=nh).status_code == 403
    allowed = client.get("/api/care/options", headers=rh).json()["mothers"]
    assert all(m["assigned_doctor_id"] == resident["id"] for m in allowed)
    with engine.connect() as c:
        wrong = (
            c.execute(
                select(s.mother).where(
                    s.mother.c.registered_facility_id == admin["facility_id"],
                    s.mother.c.assigned_doctor_id != resident["id"],
                )
            )
            .mappings()
            .first()
        )
    payload = {
        "mother_id": mother["id"],
        "kind": "visit_summary",
        "title": "Next visit instructions",
        "content": "Attend the booked review and bring prior reports.",
        "source": "Synthetic visit DEMO-V1",
    }
    assert client.post("/api/care/reviews", headers=ah, json=payload).status_code == 403
    assert (
        client.post(
            "/api/care/reviews", headers=rh, json={**payload, "mother_id": wrong["id"]}
        ).status_code
        == 403
    )
    created = client.post("/api/care/reviews", headers=rh, json=payload)
    assert created.status_code == 201, created.text
    identifier = created.json()["id"]
    path = "/api/care/reviews/" + identifier + "/actions"
    assert not client.get(
        "/api/patients/" + mother["id"] + "/coordination", headers=rh
    ).json()["approved_summaries"]
    assert (
        client.post(
            path,
            headers=rh,
            json={
                "action": "approve",
                "version": 1,
                "notes": "Resident cannot approve",
            },
        ).status_code
        == 403
    )
    response = client.post(
        path,
        headers=ch,
        json={
            "action": "approve",
            "version": 1,
            "notes": "Verified against visit record",
        },
    )
    assert response.status_code == 200, response.text
    assert (
        len(
            client.get(
                "/api/patients/" + mother["id"] + "/coordination", headers=rh
            ).json()["approved_summaries"]
        )
        == 1
    )
    assert (
        client.post(
            path,
            headers=ch,
            json={
                "action": "request_correction",
                "version": 2,
                "notes": "Appointment details need correction",
            },
        ).status_code
        == 200
    )
    assert not client.get(
        "/api/patients/" + mother["id"] + "/coordination", headers=rh
    ).json()["approved_summaries"]
    response = client.patch(
        "/api/care/reviews/" + identifier,
        headers=rh,
        json={
            "version": 3,
            "content": "Bring reports to the rescheduled appointment.",
            "source": "Synthetic visit DEMO-V2",
            "reason": "Corrected appointment reference",
        },
    )
    assert response.status_code == 200, response.text
    assert (
        client.post(
            path,
            headers=ch,
            json={
                "action": "approve",
                "version": 4,
                "notes": "Corrected version verified",
            },
        ).status_code
        == 200
    )
    with engine.connect() as c:
        row = (
            c.execute(select(s.review_case).where(s.review_case.c.id == identifier))
            .mappings()
            .one()
        )
        assert row["details"]["history"][2]["previous_content"] == payload["content"]
        assert (
            not c.scalar(
                select(s.mother.c.clinician_high_risk).where(
                    s.mother.c.id == mother["id"]
                )
            )
            or mother["clinician_high_risk"]
        )


def test_consent_revocation_and_owner_acknowledgement(portal):
    engine, client = portal
    admin, resident, mother, _ = scope_data(engine)
    ah = login(client, "hospital_admin")
    rh = login(client, "resident")
    created = client.post(
        "/api/care/tasks",
        headers=ah,
        json={
            "mother_id": mother["id"],
            "title": "Review a recorded follow-up",
            "assigned_to": resident["id"],
            "due_date": "2026-11-01",
        },
    ).json()
    route = "/api/care/tasks/" + created["id"] + "/actions"
    assert (
        client.post(
            route,
            headers=ah,
            json={
                "version": 1,
                "action": "acknowledge",
                "notes": "Admin is not the owner",
            },
        ).status_code
        == 403
    )
    assert (
        client.post(
            route,
            headers=rh,
            json={
                "version": 1,
                "action": "acknowledge",
                "notes": "Assigned clinician acknowledges",
            },
        ).status_code
        == 200
    )
    with engine.begin() as c:
        c.execute(
            update(s.mother)
            .where(s.mother.c.id == mother["id"])
            .values(consent_flags={"care_coordination": False})
        )
    assert (
        client.get(
            "/api/patients/" + mother["id"] + "/coordination", headers=ah
        ).status_code
        == 403
    )
    assert (
        client.post(
            route,
            headers=rh,
            json={
                "version": 2,
                "action": "complete",
                "outcome": "care_completed",
                "notes": "Completion",
                "evidence": "Visit ref",
            },
        ).status_code
        == 403
    )
    with engine.begin() as c:
        c.execute(
            update(s.mother)
            .where(s.mother.c.id == mother["id"])
            .values(consent_flags=mother["consent_flags"])
        )


def test_green_measurements_missing_quality_and_action_evidence(portal):
    engine, client = portal
    h = login(client, "hospital_admin")
    qh = login(client, "quality_officer")
    rh = login(client, "resident")
    admin, _, _, _ = scope_data(engine)
    response = client.get("/api/sustainability", headers=qh)
    assert response.status_code == 200
    assert all(
        i["observation"] is None and i["change_percent"] is None
        for i in response.json()["indicators"]
    )
    assert client.get("/api/sustainability", headers=rh).status_code == 403
    observation = {
        "period": "2026-08",
        "metric": "water_m3",
        "value": 1000,
        "quality": "measured",
        "source": "Ward meter ledger",
        "evidence": "Ledger page 1",
        "occupied_bed_days": 500,
    }
    assert (
        client.post(
            "/api/sustainability/measurements", headers=h, json=observation
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/sustainability/measurements", headers=h, json=observation
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/sustainability/measurements",
            headers=h,
            json={**observation, "period": "2026-09", "value": 800},
        ).status_code
        == 201
    )
    result = client.get("/api/sustainability?period=2026-09", headers=qh).json()
    water = result["indicators"][0]
    assert water["change_percent"] == -20
    assert water["per_occupied_bed_day"] == 1.6
    assert (
        client.post(
            "/api/sustainability/measurements",
            headers=h,
            json={
                **observation,
                "period": "2026-10",
                "value": 600,
                "quality": "estimated",
            },
        ).status_code
        == 201
    )
    assert (
        client.get("/api/sustainability?period=2026-10", headers=qh).json()[
            "indicators"
        ][0]["change_percent"]
        is None
    )
    for invalid in [
        {"value": -1},
        {"value": "NaN"},
        {"period": "2026-13"},
        {"occupied_bed_days": 0},
        {"period": "2099-01"},
    ]:
        assert (
            client.post(
                "/api/sustainability/measurements",
                headers=h,
                json={**observation, **invalid},
            ).status_code
            == 422
        )
    action = {
        "title": "Repair documented ward leak",
        "metric": "water_m3",
        "baseline": 1000,
        "target": 800,
        "baseline_source": "August ward meter",
        "owner_id": admin["id"],
        "due_date": "2026-11-01",
    }
    assert (
        client.post(
            "/api/sustainability/actions", headers=h, json={**action, "target": 1200}
        ).status_code
        == 422
    )
    created = client.post("/api/sustainability/actions", headers=h, json=action)
    assert created.status_code == 201, created.text
    route = "/api/sustainability/actions/" + created.json()["id"]
    assert (
        client.post(
            route,
            headers=h,
            json={"version": 1, "status": "completed", "notes": "Done"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            route,
            headers=qh,
            json={
                "version": 1,
                "status": "in_progress",
                "notes": "Repair team assigned",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            route,
            headers=h,
            json={"version": 1, "status": "cancelled", "notes": "Stale update"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            route,
            headers=h,
            json={
                "version": 2,
                "status": "completed",
                "notes": "Meter checked after repair",
                "evidence": "Maintenance ticket GREEN-1",
                "actual": 850,
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            route,
            headers=h,
            json={
                "version": 3,
                "status": "in_progress",
                "notes": "Cannot change closed history",
            },
        ).status_code
        == 409
    )
    # An authenticated user at another facility cannot read or mutate these records.
    with engine.begin() as c:
        quality = (
            c.execute(
                select(s.user).where(
                    s.user.c.email == "quality_officer@dai-synthetic.invalid"
                )
            )
            .mappings()
            .one()
        )
        other = c.scalar(
            select(s.facility.c.id)
            .where(s.facility.c.id != admin["facility_id"])
            .limit(1)
        )
        c.execute(
            update(s.user).where(s.user.c.id == quality["id"]).values(facility_id=other)
        )
    assert client.get("/api/sustainability", headers=qh).json()["history"] == []
    assert (
        client.post(
            route,
            headers=qh,
            json={
                "version": 3,
                "status": "in_progress",
                "notes": "Cross-facility attempt",
            },
        ).status_code
        == 403
    )
    with engine.begin() as c:
        c.execute(
            update(s.user)
            .where(s.user.c.id == quality["id"])
            .values(facility_id=admin["facility_id"])
        )


def test_preview_gate_fails_closed(portal, monkeypatch):
    engine, client = portal
    h = login(client, "hospital_admin")
    monkeypatch.setenv("DAI_DEMO", "false")
    assert (
        client.post(
            "/api/sustainability/measurements",
            headers=h,
            json={
                "period": "2026-07",
                "metric": "water_m3",
                "value": 1,
                "quality": "measured",
                "source": "Meter",
                "evidence": "Ledger",
            },
        ).status_code
        == 409
    )


def test_parallel_audited_reads_do_not_lock_sqlite_preview(portal):
    from concurrent.futures import ThreadPoolExecutor

    _, client = portal
    headers = login(client, "hospital_admin")
    paths = [
        "/api/care/options",
        "/api/care/tasks",
        "/api/care/gaps",
        "/api/workspace/summary",
    ]
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(
            workers.map(lambda path: client.get(path, headers=headers), paths)
        )
    assert all(result.status_code == 200 for result in results), [
        r.text for r in results
    ]
