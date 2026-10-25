"""Real portal authentication, synthetic affiliations, request lifecycle and isolation."""
import os, json, hashlib
from datetime import datetime, timezone, timedelta
from uuid import uuid4
os.environ['DAI_APP_FACTORY_ONLY']='true'
import jwt, pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,update,func
from hospital_portal.api import schema as s
from hospital_portal.api.db import database, initialize
from hospital_portal.api.security import password_hash
from hospital_portal.api.demo_requests import requests, events, uid, seed_demo_requests
from hospital_portal.api.main import create_app
SECRET='synthetic-workflow-test-secret-at-least-48-characters'

def minimal(engine):
    initialize(engine)
    fid,did,unit=str(uuid4()),str(uuid4()),str(uuid4())
    with engine.begin() as c:
        c.execute(s.facility.insert().values(id=fid,source_id='workflow-test-home',name='SYNTHETIC Original Home',tier='PRIVATE',ownership='Synthetic',address='Test only',lat=28.5,lng=77.2,authorized_beds=0,functional_beds=0,capabilities={}))
        c.execute(s.department.insert().values(id=did,facility_id=fid,name='Synthetic department'))
        c.execute(s.unit.insert().values(id=unit,facility_id=fid,department_id=did,code='SYNTHETIC-UNIT'))
        for role in ['hospital_admin','consultant','nurse']:
            c.execute(s.user.insert().values(id=str(uuid4()),source_id='demo:'+role,facility_id=fid,department_id=did if role=='consultant' else None,unit_id=unit if role=='consultant' else None,name='SYNTHETIC '+role,email=role+'@dai-synthetic.invalid',role=role,registration_no='SYNTHETIC-TEST-ONLY' if role=='consultant' else None,verified=True,password_hash=password_hash('Dai-Synthetic-2026!'),details={'demo':True}))

@pytest.fixture
def portal(tmp_path,monkeypatch):
    for key,value in {'DAI_LOCAL':'true','DAI_DEMO':'true','JWT_SECRET':SECRET}.items():monkeypatch.setenv(key,value)
    engine=database('sqlite:///'+str(tmp_path/'portal.db'));minimal(engine)
    with TestClient(create_app(engine)) as client:yield engine,client
    engine.dispose()

def login(client,role='hospital_admin'):
    c=client.post('/api/auth/login',json={'email':role+'@dai-synthetic.invalid','password':'Dai-Synthetic-2026!'}).json()
    r=client.post('/api/auth/otp',json={'challenge_id':c['challenge_id'],'code':c['demo_otp']});assert r.status_code==200,r.text
    return {'Authorization':'Bearer '+r.json()['access_token']}
def scope(client,h,code):
    a=client.get('/api/affiliations',headers=h).json()['items'];target=next(x for x in a if x['facility_id']==uid('facility:'+code))
    r=client.post('/api/affiliations/'+target['id']+'/switch',headers=h);assert r.status_code==200,r.text

def patient(client,method,path,body=None,key='node-mother:1',override=None):
    raw='' if body is None else json.dumps(body,separators=(',',':'))
    now=datetime.now(timezone.utc)
    claim={'sub':key,'patient_name':'SYNTHETIC Test Mother','method':method,'path':path,'body_sha256':hashlib.sha256(raw.encode()).hexdigest(),'iat':now,'exp':now+timedelta(seconds=45),'iss':'dai-patient-coordination','aud':'dai-hospital-coordination'}
    if override:claim.update(override)
    token=jwt.encode(claim,SECRET,algorithm='HS256')
    return client.request(method,path,content=raw or None,headers={'Content-Type':'application/json','x-dai-coordination':token})
PATH='/api/demo-coordination/patient/requests'
def body(kind='appointment'):
    return {'directory_code':'SOUTH','kind':kind,'need':'antenatal','service':'obstetrics','requested_date':'','patient_note':'Synthetic coordination only','request_key':str(uuid4()),'consent':True}

def test_seed_is_idempotent_scoped_and_preserves_affiliation_edits(portal):
    engine,client=portal
    with engine.begin() as c:
        assert c.scalar(select(func.count()).select_from(s.staff_affiliation))==10
        a=c.execute(select(s.staff_affiliation).where(s.staff_affiliation.c.facility_id==uid('facility:SOUTH'))).mappings().first()
        c.execute(update(s.staff_affiliation).where(s.staff_affiliation.c.id==a['id']).values(active=False))
    seed_demo_requests(engine)
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.staff_affiliation))==10
        assert c.scalar(select(s.staff_affiliation.c.active).where(s.staff_affiliation.c.id==a['id'])) is False
        assert c.scalar(select(func.count()).select_from(s.audit_log).where(s.audit_log.c.action=='demo_coordination_affiliation_seeded'))==10

def test_patient_consent_idempotency_ownership_and_token_binding(portal):
    engine,client=portal;b=body()
    assert patient(client,'POST',PATH,{**b,'consent':False}).status_code==422
    assert patient(client,'POST',PATH,{**b,'service':'nicu'}).status_code==422
    assert patient(client,'POST',PATH,b,override={'aud':'wrong'}).status_code==401
    assert patient(client,'POST',PATH,b,override={'body_sha256':'wrong'}).status_code==401
    assert patient(client,'POST',PATH,b,override={'exp':datetime.now(timezone.utc)-timedelta(seconds=1)}).status_code==401
    r=patient(client,'POST',PATH,b);assert r.status_code==200,r.text;request=r.json()['request']
    assert patient(client,'POST',PATH,b).json()['duplicate'] is True
    assert patient(client,'POST',PATH,{**b,'request_key':str(uuid4())}).json()['duplicate'] is True
    assert patient(client,'POST',PATH,{**b,'patient_note':'changed content'}).status_code==409
    assert patient(client,'GET',PATH,key='node-mother:2').json()['requests']==[]
    assert patient(client,'POST',PATH+'/'+request['id']+'/cancel',{'version':1,'public_note':'Cancel wrong owner'},key='node-mother:2').status_code==404
    cancelled=patient(client,'POST',PATH+'/'+request['id']+'/cancel',{'version':1,'public_note':'No longer needed'});assert cancelled.json()['request']['status']=='cancelled'
    assert len(cancelled.json()['request']['events'])==2

def test_authorised_accept_assign_schedule_patient_visibility_and_history(portal):
    engine,client=portal;r=patient(client,'POST',PATH,body()).json()['request'];h=login(client)
    assert client.get('/api/demo-coordination/staff/requests').status_code==401
    assert client.get('/api/demo-coordination/staff/requests',headers=login(client,'nurse')).status_code==403
    assert client.post('/api/demo-coordination/staff/requests/'+r['id'],headers=h,json={'status':'accepted','version':1,'public_note':'Wrong facility attempt'}).status_code==404
    scope(client,h,'SOUTH');inbox=client.get('/api/demo-coordination/staff/requests',headers=h).json();doctor=inbox['clinicians'][0]['id']
    url='/api/demo-coordination/staff/requests/'+r['id']
    assert client.post(url,headers=h,json={'status':'accepted','version':1,'public_note':'Missing clinician'}).status_code==422
    accepted=client.post(url,headers=h,json={'status':'accepted','version':1,'clinician_id':doctor,'public_note':'Assigned synthetic clinician for review'});assert accepted.status_code==200,accepted.text
    assert client.post(url,headers=h,json={'status':'scheduled','version':1,'public_note':'Stale update attempt','scheduled_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}).status_code==409
    assert client.post(url,headers=h,json={'status':'referral_coordinated','version':2,'public_note':'Wrong request type'}).status_code==422
    assert client.post(url,headers=h,json={'status':'scheduled','version':2,'public_note':'Missing appointment time'}).status_code==422
    future=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat();scheduled=client.post(url,headers=h,json={'status':'scheduled','version':2,'scheduled_at':future,'public_note':'Demo appointment time recorded by staff'});assert scheduled.status_code==200,scheduled.text
    own=patient(client,'GET',PATH).json()['requests'][0];assert own['status']=='scheduled';assert own['clinician_name'];assert len(own['events'])==3
    with engine.connect() as c:assert c.scalar(select(func.count()).select_from(s.audit_log).where(s.audit_log.c.action=='demo_request_scheduled'))==1
    scope(client,h,'EAST');assert client.get('/api/demo-coordination/staff/requests',headers=h).json()['requests']==[]
    assert client.post(url,headers=h,json={'status':'closed','version':3,'public_note':'Cross facility attempt'}).status_code==404

def test_referral_requires_active_verified_affiliated_clinician_and_safe_transition(portal):
    engine,client=portal;r=patient(client,'POST',PATH,body('referral')).json()['request'];h=login(client);scope(client,h,'SOUTH');data=client.get('/api/demo-coordination/staff/requests',headers=h).json();doctor=data['clinicians'][0]['id'];url='/api/demo-coordination/staff/requests/'+r['id']
    with engine.begin() as c:c.execute(update(s.staff_affiliation).where(s.staff_affiliation.c.facility_id==uid('facility:SOUTH'),s.staff_affiliation.c.user_id==doctor).values(active=False))
    assert client.post(url,headers=h,json={'status':'accepted','version':1,'clinician_id':doctor,'public_note':'Inactive affiliation attempt'}).status_code==422
    with engine.begin() as c:c.execute(update(s.staff_affiliation).where(s.staff_affiliation.c.facility_id==uid('facility:SOUTH'),s.staff_affiliation.c.user_id==doctor).values(active=True))
    assert client.post(url,headers=h,json={'status':'accepted','version':1,'clinician_id':doctor,'public_note':'Demo referral assigned for coordination'}).status_code==200
    response=client.post(url,headers=h,json={'status':'referral_coordinated','version':2,'public_note':'Synthetic care team coordination recorded'});assert response.status_code==200,response.text
    assert client.post(url,headers=h,json={'status':'requested','version':3,'public_note':'Invalid backwards transition'}).status_code==409
    assert client.post(url,headers=h,json={'status':'closed','version':3,'public_note':'Coordination closed; no clinical completion implied'}).status_code==200

def test_workflow_unavailable_outside_local_demo(portal,monkeypatch):
    engine,client=portal;h=login(client);monkeypatch.setenv('DAI_LOCAL','false')
    assert patient(client,'GET',PATH).status_code==404
    assert client.get('/api/demo-coordination/staff/requests',headers=h).status_code==404


def test_same_clinician_start_minute_conflict_and_cancellation_release(portal):
    engine,client=portal;h=login(client);scope(client,h,'SOUTH');doctor=client.get('/api/demo-coordination/staff/requests',headers=h).json()['clinicians'][0]['id']
    first=patient(client,'POST',PATH,body()).json()['request'];second=patient(client,'POST',PATH,body(),key='node-mother:2').json()['request'];future=(datetime.now(timezone.utc)+timedelta(days=2)).replace(second=0,microsecond=0).isoformat()
    for r in (first,second):
        url='/api/demo-coordination/staff/requests/'+r['id'];assert client.post(url,headers=h,json={'status':'accepted','version':1,'clinician_id':doctor,'public_note':'Synthetic clinician accepted for coordination'}).status_code==200
    url='/api/demo-coordination/staff/requests/'
    assert client.post(url+first['id'],headers=h,json={'status':'scheduled','version':2,'scheduled_at':future,'public_note':'Synthetic appointment scheduled'}).status_code==200
    assert client.post(url+second['id'],headers=h,json={'status':'scheduled','version':2,'scheduled_at':future,'public_note':'Conflicting synthetic appointment'}).status_code==409
    assert patient(client,'POST',PATH+'/'+first['id']+'/cancel',{'version':3,'public_note':'Cancel synthetic appointment'}).status_code==200
    assert client.post(url+second['id'],headers=h,json={'status':'scheduled','version':2,'scheduled_at':future,'public_note':'Synthetic time released after cancellation'}).status_code==200
