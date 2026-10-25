"""Shared patient/staff coordination and gated, owner-based risk simulation."""
from datetime import datetime,timezone,timedelta
from uuid import uuid4
from sqlalchemy import select,update,func
from hospital_portal.tests.test_demo_requests import portal,login,scope,patient,body,PATH
from hospital_portal.api.demo_followup_risk import followups,cases,flags,trail,seed_followup_risk
from hospital_portal.api import schema as s

BASE='/api/demo-coordination'
def ready(portal):
    engine,client=portal;r=patient(client,'POST',PATH,body()).json()['request'];admin=login(client);scope(client,admin,'SOUTH');doctor=client.get(BASE+'/staff/requests',headers=admin).json()['clinicians'][0]['id']
    assert client.post(BASE+'/staff/requests/'+r['id'],headers=admin,json={'status':'accepted','version':1,'clinician_id':doctor,'public_note':'Synthetic request accepted for follow-up coordination'}).status_code==200
    return engine,client,r,admin,doctor

def taskbody(r,doctor):
    return {'request_id':r['id'],'title':'Confirm the next follow-up arrangement','due_date':(datetime.now(timezone.utc)+timedelta(days=2)).date().isoformat(),'assigned_to':doctor,'public_note':'Please acknowledge this coordination task after reviewing your request.','request_key':str(uuid4())}

def test_shared_followup_create_acknowledge_self_report_and_evidence_closure(portal):
    engine,client,r,admin,doctor=ready(portal);b=taskbody(r,doctor);created=client.post(BASE+'/staff/followups',headers=admin,json=b);assert created.status_code==200,created.text;t=created.json()['task'];assert t['status']=='open'
    assert client.post(BASE+'/staff/followups',headers=admin,json=b).json()['duplicate'] is True
    assert client.post(BASE+'/staff/followups',headers=admin,json={**b,'request_key':str(uuid4())}).json()['duplicate'] is True
    assert client.post(BASE+'/staff/followups',headers=admin,json={**b,'public_note':'Changed idempotency content'}).status_code==409
    own=patient(client,'GET',BASE+'/patient/followups').json()['tasks'];assert own[0]['id']==t['id'];assert own[0]['owner_name'];assert len(own[0]['history'])==1
    url=BASE+'/patient/followups/'+t['id']+'/actions'
    assert patient(client,'POST',url,{'version':1,'action':'complete','public_note':'Cannot certify clinical completion'}).status_code==403
    ack=patient(client,'POST',url,{'version':1,'action':'acknowledge','public_note':'I have read the coordination task'});assert ack.json()['task']['status']=='acknowledged'
    report=patient(client,'POST',url,{'version':2,'action':'report_done','public_note':'I have contacted the coordination office'});assert report.json()['task']['status']=='patient_reported_done'
    staff=client.get(BASE+'/staff/followups',headers=admin).json()['tasks'][0];assert staff['status']=='patient_reported_done'
    assert client.post(BASE+'/staff/followups/'+t['id']+'/actions',headers=admin,json={'version':3,'action':'complete','public_note':'Closing without evidence'}).status_code==422
    closed=client.post(BASE+'/staff/followups/'+t['id']+'/actions',headers=admin,json={'version':3,'action':'complete','public_note':'Coordination office confirmed follow-through','evidence_ref':'SYNTHETIC coordination log FUP-001'});assert closed.json()['task']['status']=='closed'
    visible=patient(client,'GET',BASE+'/patient/followups').json()['tasks'][0];assert visible['status']=='closed';assert len(visible['history'])==4
    with engine.connect() as c:assert c.scalar(select(func.count()).select_from(s.audit_log).where(s.audit_log.c.action=='patient_followup_complete'))==1

def test_followup_request_gate_isolation_ownership_versions_and_reopen(portal):
    engine,client,r,admin,doctor=ready(portal);t=client.post(BASE+'/staff/followups',headers=admin,json=taskbody(r,doctor)).json()['task'];url=BASE+'/staff/followups/'+t['id']+'/actions'
    assert patient(client,'GET',BASE+'/patient/followups',key='node-mother:2').json()['tasks']==[]
    assert patient(client,'POST',BASE+'/patient/followups/'+t['id']+'/actions',{'version':1,'action':'acknowledge','public_note':'Wrong patient attempt'},key='node-mother:2').status_code==404
    scope(client,admin,'EAST');assert client.get(BASE+'/staff/followups',headers=admin).json()['tasks']==[];assert client.post(url,headers=admin,json={'version':1,'action':'cancel','public_note':'Cross-facility attempt'}).status_code==404
    scope(client,admin,'SOUTH');assert client.post(url,headers=admin,json={'version':5,'action':'cancel','public_note':'Stale version attempt'}).status_code==409
    assert client.post(url,headers=admin,json={'version':1,'action':'cancel','public_note':'Cancel the synthetic coordination task'}).status_code==200
    assert client.post(url,headers=admin,json={'version':2,'action':'reopen','public_note':'Reopen after care-team coordination review'}).json()['task']['status']=='open'
    pending=patient(client,'POST',PATH,body('referral')).json()['request'];assert client.post(BASE+'/staff/followups',headers=admin,json=taskbody(pending,doctor)).status_code==409
    assert client.get(BASE+'/staff/followups',headers=login(client,'nurse')).status_code==403

def test_risk_case_review_gate_is_simulated_and_requires_consultant_evidence(portal):
    engine,client,r,admin,doctor=ready(portal);cs=client.get(BASE+'/staff/risk-cases',headers=admin).json()['cases'];assert len(cs)==2;assert all(c['review_state']=='pending_review' and c['clinical_approval_verified'] is False for c in cs)
    clinician=login(client,'consultant');scope(client,clinician,'SOUTH');case=cs[0]
    flag={'request_id':r['id'],'case_id':case['id'],'case_version':1,'escalation_owner':doctor,'reason':'Synthetic case requires a named clinician to review the coordination concern','public_note':'A synthetic review flag needs clinician attention'}
    assert client.post(BASE+'/staff/risk-flags',headers=clinician,json=flag).status_code==409
    review={'version':1,'review_reason':'Synthetic reviewer reason recorded for the software test case','evidence_ref':'SYNTHETIC test review document REVIEW-001','simulation_acknowledged':True}
    assert client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=admin,json=review).status_code==403
    assert client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=clinician,json={**review,'simulation_acknowledged':False}).status_code==422
    assert client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=clinician,json={**review,'evidence_ref':''}).status_code==422
    reviewed=client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=clinician,json=review);assert reviewed.status_code==200,reviewed.text
    value=reviewed.json()['case'];assert value['review_state']=='simulation_review_recorded';assert value['clinical_approval_verified'] is False;assert value['simulation_only'] is True;assert value['reviewer_name'];assert len(value['history'])==1
    assert client.post(BASE+'/staff/risk-flags',headers=clinician,json=flag).status_code==409
    assert client.post(BASE+'/staff/risk-flags',headers=clinician,json={**flag,'case_version':2,'predicted_risk':0.9}).status_code==422
    raised=client.post(BASE+'/staff/risk-flags',headers=clinician,json={**flag,'case_version':2});assert raised.status_code==200,raised.text;f=raised.json()['flag'];assert f['status']=='escalated';assert f['owner_name'];assert 'score' not in f;assert f['review_snapshot']['clinical_approval_verified'] is False
    assert client.post(BASE+'/staff/risk-flags',headers=clinician,json={**flag,'case_version':2}).json()['duplicate'] is True
    assert patient(client,'GET',BASE+'/patient/risk-flags',key='node-mother:2').json()['flags']==[]
    visible=patient(client,'GET',BASE+'/patient/risk-flags').json()['flags'][0];assert visible['reason']==flag['reason'];assert visible['owner_name'];assert visible['history'][0]['action']=='escalated'
    # A later case review must not rewrite evidence retained by an existing flag.
    client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=clinician,json={**review,'version':2,'evidence_ref':'SYNTHETIC revised test evidence REVIEW-002'})
    assert patient(client,'GET',BASE+'/patient/risk-flags').json()['flags'][0]['review_snapshot']['evidence_ref']==review['evidence_ref']
    url=BASE+'/staff/risk-flags/'+f['id']+'/actions'
    assert client.post(url,headers=admin,json={'version':1,'action':'acknowledge','public_note':'Admin cannot perform clinical review'}).status_code==403
    assert client.post(url,headers=clinician,json={'version':1,'action':'acknowledge','public_note':'Escalation owner acknowledged the synthetic case'}).json()['flag']['status']=='acknowledged'
    assert client.post(url,headers=clinician,json={'version':2,'action':'close','public_note':'Missing disposition evidence'}).status_code==422
    closed=client.post(url,headers=clinician,json={'version':2,'action':'close','public_note':'Synthetic review simulation closed with documented disposition','evidence_ref':'SYNTHETIC disposition note DISP-001'});assert closed.json()['flag']['status']=='closed';assert len(closed.json()['flag']['history'])==3

def test_seed_preserves_case_review_and_mode_restrictions(portal,monkeypatch):
    engine,client,r,admin,doctor=ready(portal)
    with engine.begin() as c:
        one=c.execute(select(cases)).mappings().first();c.execute(update(cases).where(cases.c.id==one['id']).values(title='SYNTHETIC locally edited case'))
    seed_followup_risk(engine)
    with engine.connect() as c:assert c.scalar(select(cases.c.title).where(cases.c.id==one['id']))=='SYNTHETIC locally edited case'
    monkeypatch.setenv('DAI_LOCAL','false');assert client.get(BASE+'/staff/risk-cases',headers=admin).status_code==404;assert patient(client,'GET',BASE+'/patient/followups').status_code==404

def test_only_named_escalation_owner_can_act_and_transfer_is_audited(portal):
    engine,client,r,admin,doctor=ready(portal);clinician=login(client,'consultant');scope(client,clinician,'SOUTH');case=client.get(BASE+'/staff/risk-cases',headers=admin).json()['cases'][0]
    client.post(BASE+'/staff/risk-cases/'+case['id']+'/review',headers=clinician,json={'version':1,'review_reason':'Synthetic reviewer decision for owner authorization test','evidence_ref':'SYNTHETIC test review OWNER-001','simulation_acknowledged':True})
    f=client.post(BASE+'/staff/risk-flags',headers=clinician,json={'request_id':r['id'],'case_id':case['id'],'case_version':2,'escalation_owner':doctor,'reason':'Synthetic escalation requires an explicitly accountable owner','public_note':'Synthetic case owner assigned'}).json()['flag']
    with engine.begin() as c:
        primary=c.execute(select(s.user).where(s.user.c.id==doctor)).mappings().one();aff=c.execute(select(s.staff_affiliation).where(s.staff_affiliation.c.user_id==doctor,s.staff_affiliation.c.facility_id==r['facility_id'])).mappings().one();other=str(uuid4())
        c.execute(s.user.insert().values(id=other,source_id='test:second-consultant',facility_id=r['facility_id'],department_id=aff['department_id'],unit_id=aff['unit_id'],name='SYNTHETIC Second Consultant',email='consultant2@dai-synthetic.invalid',role='consultant',registration_no='FAKE-TEST-OWNER',verified=True,password_hash=primary['password_hash'],details={'demo':True}))
    second=login(client,'consultant2');url=BASE+'/staff/risk-flags/'+f['id']+'/actions'
    assert client.post(url,headers=second,json={'version':1,'action':'acknowledge','public_note':'Non-owner consultant attempt'}).status_code==403
    moved=client.post(url,headers=clinician,json={'version':1,'action':'reassign','public_note':'Transfer simulation ownership to the next consultant','escalation_owner':other});assert moved.status_code==200,moved.text
    assert moved.json()['flag']['owner_name']=='SYNTHETIC Second Consultant'
    assert client.post(url,headers=clinician,json={'version':2,'action':'acknowledge','public_note':'Former owner attempt blocked'}).status_code==403
    acknowledged=client.post(url,headers=second,json={'version':2,'action':'acknowledge','public_note':'New escalation owner acknowledges the test case'});assert acknowledged.status_code==200;assert len(acknowledged.json()['flag']['history'])==3
    scope(client,clinician,'EAST');assert client.get(BASE+'/staff/risk-flags',headers=clinician).json()['flags']==[]

def test_followup_can_be_created_after_accepted_coordination_is_closed(portal):
    engine,client,r,admin,doctor=ready(portal);url=BASE+'/staff/requests/'+r['id']
    future=(datetime.now(timezone.utc)+timedelta(days=2)).replace(second=0,microsecond=0).isoformat()
    assert client.post(url,headers=admin,json={'status':'scheduled','version':2,'scheduled_at':future,'public_note':'Synthetic appointment time recorded'}).status_code==200
    assert client.post(url,headers=admin,json={'status':'closed','version':3,'public_note':'Coordination closed; further follow-up remains appropriate to record'}).status_code==200
    response=client.post(BASE+'/staff/followups',headers=admin,json=taskbody(r,doctor));assert response.status_code==200,response.text
    assert response.json()['task']['status']=='open'
