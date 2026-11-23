from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from hospital_portal.api import schema as s
from hospital_portal.api.clinical_monitor import scan_batch
from hospital_portal.api.clinical_monitor_rules import evaluate
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed

TODAY = date(2026, 10, 20)


def reading(identifier, when, **values):
    return dict(id=identifier, source="fixture ANC", date=when, **values)


def test_rules_are_evidence_bound_and_context_aware():
    lmp = TODAY-timedelta(days=140)
    rows = dict(
        visits=[reading("a", TODAY-timedelta(days=21), weight_kg=60, sbp=141, dbp=89),
                reading("b", TODAY-timedelta(days=5), weight_kg=64, sbp=160, dbp=106),
                reading("future", TODAY+timedelta(days=1), sbp=190, dbp=120)],
        glucose=[reading("missing-timing", TODAY, glucose=160, unit="mg/dL"),
                 reading("missing-unit", TODAY, glucose=30, context="fasting"),
                 reading("timed", TODAY, glucose=5.5, unit="mmol/L", context="fasting")],
        reports=[reading("old-lab", TODAY-timedelta(days=4), test="Hb", order_id="1", flag="abnormal"),
                 reading("new-lab", TODAY, test="Hb", order_id="2", flag="normal")],
        gaps=[reading("milestone", TODAY-timedelta(days=8), item="ANC visit", status="open")],
    )
    baseline = (22, {"source":"fixture profile","record_id":"profile","date":None,"values":{"bmi":22}})
    flags, trends, coverage = evaluate({"lmp":lmp,"baseline":baseline}, rows, TODAY)
    result = {r["rule_key"]:r for r in flags}
    assert set(result)=={"blood_pressure","weight_t2","glucose_monitoring","missed_care"}
    assert result["blood_pressure"]["priority"]==3
    assert result["blood_pressure"]["evidence"][0]["record_id"]=="b"
    assert result["glucose_monitoring"]["evidence"][0]["record_id"]=="timed"
    assert trends[0]["change_kg"]==4
    assert coverage["paired_bp"]==2
    without_baseline=evaluate({"lmp":lmp},rows,TODAY)[0]
    assert not any(r["rule_key"].startswith("weight") for r in without_baseline)
    rows["reports"].extend([
        reading("protocol-documented", TODAY, test="Timed OGTT", order_id="3", flag="normal",
                value=153, unit="mg/dL", protocol="ogtt_75g_2h"),
        reading("protocol-missing", TODAY, test="OGTT", order_id="4", flag="normal",
                value=165, unit="mg/dL"),
    ])
    rows["gaps"].append(reading("3", TODAY-timedelta(days=2), item="Timed OGTT", status="open"))
    tests = {r["rule_key"]:r for r in evaluate({"lmp":lmp},rows,TODAY)[0]}
    assert tests["ogtt_75g_2h:Timed OGTT"]["evidence"][0]["record_id"]=="protocol-documented"
    assert "ogtt_75g_2h:OGTT" not in tests
    assert [r["record_id"] for r in tests["missed_care"]["evidence"]]==["milestone"]


@pytest.fixture(scope="module")
def cohort(tmp_path_factory):
    engine=database("sqlite:///"+str(tmp_path_factory.mktemp("clinical-monitor")/"portal.db"))
    seed(engine)
    yield engine
    engine.dispose()


def sweep(engine, demo):
    cursor=scan_batch(engine,demo,today=TODAY)
    while cursor:
        cursor=scan_batch(engine,demo,cursor,today=TODAY)


def test_real_synthetic_cohort_and_authenticated_review(cohort, monkeypatch):
    monkeypatch.setenv("DAI_APP_FACTORY_ONLY","true")
    monkeypatch.setenv("DAI_DEMO","true")
    monkeypatch.setenv("DAI_CLINICAL_MONITOR_ENABLED","false")
    from hospital_portal.api.main import create_app

    sweep(cohort,True)
    m, f, r = s.mother,s.clinical_monitor_flag,s.clinical_monitor_run
    with cohort.begin() as conn:
        runs = conn.scalar(select(func.count()).select_from(r))
        count = conn.scalar(select(func.count()).select_from(f))
        assert runs >= 2000 and count > 0
        assert conn.scalar(select(func.count()).select_from(r).where(r.c.coverage["weight_trimesters"].as_integer()>0)) > 0
        assert conn.scalar(select(func.count()).select_from(f).where(f.c.rule_key.like("result:%"))) > 0
        assert conn.scalar(select(func.count()).select_from(f).where(f.c.rule_key=="missed_care")) > 0
        picked = conn.execute(select(f,m.c.assigned_doctor_id,m.c.registered_facility_id,m.c.clinician_high_risk)
            .join(m,m.c.id==f.c.mother_id).where(f.c.rule_key=="blood_pressure")
            .order_by(f.c.priority.desc()).limit(1)).mappings().first()
        assert picked and picked["evidence"][0]["record_id"].startswith("ANC_VISITS-SYN-")
        doctor_email=conn.scalar(select(s.user.c.email).where(s.user.c.id==picked["assigned_doctor_id"]))
        outside=conn.scalar(select(s.user.c.email).where(s.user.c.role=="consultant",
            s.user.c.facility_id!=picked["registered_facility_id"]).limit(1))
        picked=dict(picked)

    def login(client,email):
        response=client.post("/api/auth/login",json={"email":email,"password":"Dai-Synthetic-2026!"})
        assert response.status_code==200,response.text
        body=response.json()
        response=client.post("/api/auth/otp",json={"challenge_id":body["challenge_id"],"code":body["demo_otp"]})
        assert response.status_code==200,response.text
        return {"Authorization":"Bearer "+response.json()["access_token"]}

    with TestClient(create_app(cohort)) as client:
        doctor=login(client,doctor_email)
        other=login(client,outside)
        admin=login(client,"hospital_admin@dai-synthetic.invalid")
        assert client.get("/api/clinical-monitor",headers=admin).status_code==403
        response=client.get("/api/clinical-monitor",headers=doctor)
        assert response.status_code==200
        priorities=[row["priority"] for row in response.json()["items"]]
        assert priorities and priorities==sorted(priorities,reverse=True)
        snap="/api/clinical-monitor/patients/"+picked["mother_id"]
        assert client.get(snap,headers=other).status_code==404
        assert client.get(snap,headers=doctor).json()["snapshot"]["coverage"]["synthetic"] is True
        url="/api/clinical-monitor/flags/"+picked["id"]+"/review"
        body={"disposition":"reviewed","fingerprint":picked["fingerprint"],"note":"Reviewed the recorded measurement."}
        assert client.post(url,headers=other,json=body).status_code==404
        assert client.post(url,headers=doctor,json={**body,"fingerprint":"0"*64}).status_code==409
        assert client.post(url,headers=doctor,json=body).status_code==200
        sweep(cohort,True)
        with cohort.begin() as conn:
            reviewed=conn.execute(select(f).where(f.c.id==picked["id"])).mappings().one()
            assert reviewed["reviewed_by"]==picked["assigned_doctor_id"]
            assert reviewed["fingerprint"]==picked["fingerprint"]
            assert conn.scalar(select(m.c.clinician_high_risk).where(m.c.id==picked["mother_id"]))==picked["clinician_high_risk"]
            # A newer verified ANC observation must produce a new unreviewed version.
            for number, systolic in enumerate([169,178]):
                conn.execute(s.anc_visit.insert().values(id=str(uuid4()),mother_id=picked["mother_id"],
                    facility_id=picked["registered_facility_id"],visit_date=(TODAY-timedelta(days=number)).isoformat(),
                    details={"bp_systolic":systolic,"bp_diastolic":112}))
        sweep(cohort,True)
        with cohort.begin() as conn:
            reopened=conn.execute(select(f).where(f.c.id==picked["id"])).mappings().one()
            assert reopened["reviewed_by"] is None
            assert reopened["fingerprint"]!=picked["fingerprint"]
            conn.execute(update(m).where(m.c.id==picked["mother_id"]).values(
                consent_flags={"synthetic_demo":True,"care_coordination":True,"clinical_monitoring":False}))
        assert client.get(snap,headers=doctor).status_code==404
        assert client.post(url,headers=doctor,json=body).status_code==404
