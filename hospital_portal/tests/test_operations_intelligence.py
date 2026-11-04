"""Non-clinical plans must remain scoped, reproducible, explainable and approved."""
import copy
import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func, update
from hospital_portal.api.operations import planner
from hospital_portal.api.operations.agent import run_agent
from hospital_portal.api.operations_intelligence import POLICY, green_insights
from hospital_portal.api.main import create_app
from hospital_portal.api.seed import seed
from hospital_portal.api.db import database
from hospital_portal.api import schema as s
from hospital_portal.api.security import password_hash


def inputs():
    jobs = [{"id":"a-long","domain":"water","duration":90,"points":100},{"id":"b-short","domain":"water","duration":60,"points":100},{"id":"c-short","domain":"water","duration":60,"points":100}]
    windows = [{"id":"w","staff_id":"person","domains":["water"],"start":0,"end":120}]
    return jobs, windows


def test_real_cp_sat_beats_same_constraint_greedy_and_is_reproducible():
    jobs, windows = inputs()
    a, b = planner.solve(jobs, windows), planner.solve(jobs, windows)
    assert a["source"] == "cp_sat" and a["status"] == "OPTIMAL"
    assert a["assignments"] == b["assignments"]
    assert a["objective"]["points"] == 200 and a["objective"]["baseline_points"] == 100
    assert a["objective"]["scheduled_jobs"] == 2
    assert planner.verify(a["assignments"], jobs, windows)
    assert a["energy_kwh"] is None and a["elapsed_ms"] >= 0


def test_rule_fallback_and_missing_capacity_do_not_invent_a_solution(monkeypatch):
    jobs, windows = inputs()
    monkeypatch.setattr(planner,"cp_model",None)
    r = planner.solve(jobs,windows)
    assert r["source"] == "rules" and r["verified"]
    assert r["objective"]["points"] == r["objective"]["baseline_points"]
    assert planner.solve(jobs,[])["assignments"] == []
    assert all(j["reason"] for j in planner.solve(jobs,[])["unscheduled"])


def test_independent_verifier_rejects_wrong_skill_overlap_duration_and_existing_job():
    jobs, windows = inputs()
    good = {"job_id":"b-short","window_id":"w","staff_id":"person","start":0,"end":60}
    assert planner.verify([good], jobs, windows)
    for change in [{"end":61},{"start":-1,"end":59},{"staff_id":"outside"},{"window_id":"outside"}]:
        assert not planner.verify([{**good,**change}],jobs,windows)
    assert not planner.verify([good,good],jobs,windows)
    assert not planner.verify([good],jobs,windows,[{"staff_id":"person","start":30,"end":40}])
    assert not planner.verify([good],jobs,[{**windows[0],"domains":["energy"]}])


def test_agent_has_real_tool_trace_and_rejects_out_of_scope_model_tools(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY",raising=False)
    jobs,windows=inputs();snap={"insights":[],"jobs":jobs,"windows":windows,"blocked":[]}
    r=run_agent(snap,POLICY,lambda:planner.solve(jobs,windows))
    assert r["agent"] == "bounded_policy_agent"
    assert len(r["trace"]) == 5 and r["usage"]["provider_attempts"] == 0
    assert all(t["reason"] for t in r["trace"])
    requests=[]
    def hostile(body):
        requests.append(body)
        return {"candidates":[{"content":{"parts":[{"functionCall":{"name":"approve_plan","args":{"patient_id":"secret"}}}]}}]}
    r=run_agent(snap,POLICY,lambda:planner.solve(jobs,windows),allow_external=True,provider=hostile)
    assert r["usage"]["provider_attempts"] == POLICY["max_provider_calls"]
    assert r["agent"] == "bounded_policy_agent" and r["plan"]["verified"]
    assert r["provider_notes"] and r["usage"]["reported_total_tokens"] is None
    assert "secret" not in json.dumps(r)


def test_optional_provider_uses_allowlisted_tools_and_aggregate_results_only():
    jobs,windows=inputs();snap={"insights":[],"jobs":jobs,"windows":windows,"blocked":[]}
    calls=[]
    def provider(body):
        calls.append(copy.deepcopy(body))
        name="inspect_resource_use" if len(calls)==1 else "inspect_tickets"
        return {"usageMetadata":{"totalTokenCount":12},"candidates":[{"content":{"parts":[{"thoughtSignature":"opaque-provider-signature","functionCall":{"id":"call-"+str(len(calls)),"name":name,"args":{}}}]}}]}
    r=run_agent(snap,POLICY,lambda:planner.solve(jobs,windows),allow_external=True,provider=provider)
    assert r["agent"] == "gemini_tool_assisted" and r["usage"]["reported_total_tokens"] == 24
    assert "b-short" not in json.dumps(calls) and "person" not in json.dumps(calls)
    assert calls[1]["contents"][1]["parts"][0]["thoughtSignature"] == "opaque-provider-signature"
    assert calls[1]["contents"][2]["parts"][0]["functionResponse"]["id"] == "call-1"
    assert len([t for t in r["trace"] if t["planner"]=="gemini_tool_call"]) == 2


def test_green_explanations_require_comparable_adjacent_observations():
    old={"metric":"energy_kwh","period":"2026-09","value":100,"quality":"facility_reported","source":"same meter","occupied_bed_days":10}
    new={**old,"period":"2026-10","value":130}
    r=green_insights([old,new])[0]
    assert r["review_suggested"] and r["change_percent"] == 30 and r["basis"] == "per occupied bed-day"
    assert r["reason"] and "ranking" in r["reason"]
    assert green_insights([old,{**new,"source":"different"}]) == []
    assert green_insights([old,{**new,"quality":"estimated"}]) == []
    assert green_insights([old,{**new,"period":"2026-11"}]) == []
    assert green_insights([old,{**new,"occupied_bed_days":13}])[0]["change_percent"] == 0


@pytest.fixture(scope="module")
def portal(tmp_path_factory):
    engine=database("sqlite:///"+str(tmp_path_factory.mktemp("operations")/"portal.db"))
    seed(engine)
    with engine.begin() as c:
        admin=dict(c.execute(select(s.user).where(s.user.c.email=="hospital_admin@dai-synthetic.invalid")).mappings().one())
        outside=c.scalar(select(s.facility.c.id).where(s.facility.c.id!=admin["facility_id"]).limit(1))
        outside_user=str(uuid4())
        c.execute(s.user.insert().values(id=outside_user,facility_id=outside,email="outside-operations@dai-synthetic.invalid",name="Fictional Outside Administrator",role="hospital_admin",verified=True,password_hash=password_hash("Dai-Synthetic-2026!")))
    with TestClient(create_app(engine)) as client:
        headers={}
        def login(email):
            if email not in headers:
                a=client.post("/api/auth/login",json={"email":email,"password":"Dai-Synthetic-2026!"}).json()
                b=client.post("/api/auth/otp",json={"challenge_id":a["challenge_id"],"code":a["demo_otp"]})
                assert b.status_code==200,b.text
                headers[email]={"Authorization":"Bearer "+b.json()["access_token"]}
            return headers[email]
        yield engine,client,login,admin
    engine.dispose()


def test_api_scope_demo_fixture_and_no_autonomous_writes(portal):
    engine,client,login,admin=portal;h=login("hospital_admin@dai-synthetic.invalid")
    assert client.get("/api/operations-intelligence").status_code==401
    assert client.get("/api/operations-intelligence",headers=login("nurse@dai-synthetic.invalid")).status_code==403
    seed1=client.post("/api/operations-intelligence/demo-scenario",headers=h)
    assert seed1.status_code==200,seed1.text
    assert client.post("/api/operations-intelligence/demo-scenario",headers=h).json()["added"]==0
    data=client.get("/api/operations-intelligence",headers=h).json()
    assert data["jobs"] and data["insights"] and data["solver_available"]
    assert data["usage"]["energy_kwh"] is None and data["usage"]["carbon_kg"] is None
    with engine.connect() as c:
        before=c.scalar(select(func.count()).select_from(s.operations_assignment))
    r=client.post("/api/operations-intelligence/runs",headers=h,json={})
    assert r.status_code==200,r.text
    draft=r.json()
    assert draft["state"]=="draft" and draft["plan"]["verified"] and draft["approval_required"]
    assert draft["usage"]["provider_attempts"]==0
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.operations_assignment))==before
    cached=client.post("/api/operations-intelligence/runs",headers=h,json={}).json()
    assert cached["cache_hit"] and cached["id"]==draft["id"]
    other=login("outside-operations@dai-synthetic.invalid")
    assert not client.get("/api/operations-intelligence",headers=other).json()["jobs"]
    assert client.post("/api/operations-intelligence/runs/"+draft["id"]+"/decision",headers=other,json={"version":1,"decision":"approve","note":"outside test"}).status_code==404
    # Revoke declared capacity and prove the stale draft cannot be applied.
    w=data["windows"][0]
    assert client.patch("/api/operations-intelligence/availability/"+w["id"],headers=h,json={"version":w["version"],"active":False}).status_code==200
    stale=client.post("/api/operations-intelligence/runs/"+draft["id"]+"/decision",headers=h,json={"version":1,"decision":"approve","note":"stale test"})
    assert stale.status_code==409,stale.text
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.operations_assignment))==before
    assert client.patch("/api/operations-intelligence/availability/"+w["id"],headers=h,json={"version":2,"active":True}).status_code==200


def test_human_approval_is_atomic_and_preserves_clinical_roster(portal):
    engine,client,login,admin=portal;h=login("hospital_admin@dai-synthetic.invalid")
    with engine.connect() as c:
        roster_before=c.scalar(select(func.count()).select_from(s.roster_entry))
        approved_before=c.scalar(select(func.count()).select_from(s.operations_assignment))
    run=client.post("/api/operations-intelligence/runs",headers=h,json={}).json()
    assert run["plan"]["assignments"]
    path="/api/operations-intelligence/runs/"+run["id"]+"/decision"
    def approve(_):
        return client.post(path,headers=h,json={"version":run["version"],"decision":"approve","note":"Reviewed declared inspection capacity"}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=sorted(pool.map(approve,range(2)))
    assert statuses==[200,409]
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.roster_entry))==roster_before
        assert c.scalar(select(func.count()).select_from(s.operations_assignment))==approved_before+len(run["plan"]["assignments"])
        for a in run["plan"]["assignments"]:
            assert c.scalar(select(s.sustainability_ticket.c.status).where(s.sustainability_ticket.c.id==a["job_id"]))=="in_progress"
    data=client.get("/api/operations-intelligence",headers=h).json()
    assert data["usage"]["cache_hits"]>=1 and data["usage"]["provider_attempts"]==0
    assert not data["jobs"]  # all workshop inspection tasks were assigned once


def test_validation_scope_and_demo_write_gate(portal,monkeypatch):
    engine,client,login,admin=portal;h=login("hospital_admin@dai-synthetic.invalid")
    assert client.post("/api/operations-intelligence/runs",headers=h,json={"horizon_days":100}).status_code==422
    assert client.post("/api/operations-intelligence/runs",headers=h,json={"patient_id":42}).status_code==422
    assert client.post("/api/operations-intelligence/runs",headers=h,json={"exclude_staff_ids":[str(uuid4())]}).status_code==422
    start=(datetime.now(timezone.utc)+timedelta(days=2)).replace(second=0,microsecond=0)
    bad={"staff_id":str(uuid4()),"starts_at":start.isoformat(),"ends_at":(start+timedelta(hours=1)).isoformat(),"domains":["water"],"source":"test declaration"}
    assert client.post("/api/operations-intelligence/availability",headers=h,json=bad).status_code==422
    assert client.post("/api/operations-intelligence/availability",headers=h,json={**bad,"starts_at":start.replace(tzinfo=None).isoformat()}).status_code==422
    monkeypatch.setenv("DAI_DEMO","false")
    assert client.post("/api/operations-intelligence/demo-scenario",headers=h).status_code==409
    assert client.post("/api/operations-intelligence/runs",headers=h,json={}).status_code==409


def test_declared_timezone_is_preserved_as_utc_for_sqlite(portal):
    engine,client,login,admin=portal
    h=login("hospital_admin@dai-synthetic.invalid")
    local=timezone(timedelta(hours=5,minutes=30))
    starts=(datetime.now(local)+timedelta(days=3)).replace(second=0,microsecond=0)
    ends=starts+timedelta(hours=1)
    out=client.post("/api/operations-intelligence/availability",headers=h,json={"staff_id":admin["id"],"starts_at":starts.isoformat(),"ends_at":ends.isoformat(),"domains":["water"],"source":"Synthetic timezone regression test"})
    assert out.status_code==201,out.text
    row=next(w for w in client.get("/api/operations-intelligence",headers=h).json()["windows"] if w["id"]==out.json()["id"])
    assert datetime.fromisoformat(row["starts_at"])==starts
    assert datetime.fromisoformat(row["ends_at"])==ends
    assert row["starts_at"].endswith("+00:00")
