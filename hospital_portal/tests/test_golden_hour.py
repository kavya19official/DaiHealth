"""Golden Hour portal tests: capability re-check, bridge-token auth, facility isolation, accept/decline, simulated ambulance.

Written in the same style as test_demo_requests.py. Run with the portal's normal pytest command.
"""
import os, json, hashlib
from datetime import datetime, timezone, timedelta
from uuid import uuid4
os.environ['DAI_APP_FACTORY_ONLY']='true'
import jwt, pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from hospital_portal.api import schema as s
from hospital_portal.api.db import database, initialize
from hospital_portal.api.security import password_hash
from hospital_portal.api.demo_requests import uid
from hospital_portal.api.golden_hour import alerts, satisfies, ambulance
from hospital_portal.api.main import create_app
SECRET='synthetic-workflow-test-secret-at-least-48-characters'
PATH='/api/demo-coordination/patient/golden-hour'

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
    for key,value in {'DAI_LOCAL':'true','DAI_DEMO':'true','JWT_SECRET':SECRET,'DAI_GH_SIM_SPEEDUP':'8'}.items():monkeypatch.setenv(key,value)
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

def payload(code='WEST',**over):
    b={'alert_ref':str(uuid4()),'directory_code':code,'priority':'emergency','triage_level':'emergency','triggered_by':'mother','request_key':str(uuid4()),'eta_minutes':30,'distance_km':12.5,
       'origin':{'source':'manual_pin','precision':'pincode','label':'Malviya Nagar','latitude':28.533,'longitude':77.21},
       'symptoms':[{'code':'heavy_bleeding','label':'Heavy bleeding','level':'emergency'}],
       'requirements':{'caps':['emergency_maternity','blood_transfusion'],'capsAny':[],'svcs':[]},
       'sbar':{'text':'SBAR text','sections':[{'key':'S','title':'Situation','rows':[{'label':'Situation','value':'Pregnant, about 34 weeks'}]}],'readiness_checklist':[]},
       'skipped_nearer':[{'name':'SYNTHETIC South Mother Care Centre','distance_km':0.3,'missing':['blood transfusion']}]}
    b.update(over);return b

def test_capability_rules_and_simulated_ambulance_are_pure():
    fixture=json.load(open(os.path.join(os.path.dirname(__file__),'..','..','synthetic_data','demo','delhi-network.json')))
    west=next(f for f in fixture['facilities'] if f['code']=='WEST');south=next(f for f in fixture['facilities'] if f['code']=='SOUTH')
    need={'caps':['emergency_maternity','blood_transfusion'],'capsAny':[],'svcs':[]}
    assert satisfies(west,need)==[] and satisfies(south,need)==['emergency_maternity','blood_transfusion']
    row={'directory_code':'WEST','eta_minutes':40,'created_at':datetime.now(timezone.utc)-timedelta(minutes=3),'status':'accepted','origin_lat':28.5355,'origin_lng':77.21}
    a=ambulance(row,datetime.now(timezone.utc));assert a['simulated'] is True and 0<a['progress']<1 and a['position']
    assert ambulance({**row,'status':'declined'},datetime.now(timezone.utc))['state']=='stood_down'
    assert ambulance({**row,'status':'arrived'},datetime.now(timezone.utc))['progress']==1.0

def test_portal_refuses_an_alert_the_facility_cannot_handle_and_binds_the_bridge_token(portal):
    engine,client=portal
    wrong=patient(client,'POST',PATH,payload('SOUTH'));assert wrong.status_code==422 and 'does not list' in wrong.text
    with engine.connect() as c:assert c.scalar(select(func.count()).select_from(alerts))==0
    assert patient(client,'POST',PATH,payload('WEST'),override={'aud':'wrong'}).status_code==401
    assert patient(client,'POST',PATH,payload('WEST'),override={'body_sha256':'wrong'}).status_code==401
    assert patient(client,'POST',PATH,{**payload('WEST'),'priority':'unsure'}).status_code==422
    assert patient(client,'POST',PATH,{**payload('WEST'),'surprise':1}).status_code==422
    assert client.post(PATH,json=payload('WEST')).status_code==401

def test_idempotent_and_one_open_alert_per_patient_per_facility(portal):
    engine,client=portal;b=payload('WEST')
    r=patient(client,'POST',PATH,b);assert r.status_code==200,r.text;first=r.json()['alert']
    assert first['status']=='incoming' and first['ambulance']['simulated'] is True
    assert patient(client,'POST',PATH,b).json()['duplicate'] is True
    assert patient(client,'POST',PATH,{**b,'eta_minutes':31}).status_code==409
    again=patient(client,'POST',PATH,payload('WEST'));assert again.json()['duplicate'] is True and again.json()['alert']['id']==first['id']
    assert patient(client,'GET',PATH+'/'+first['id'],key='node-mother:2').status_code==404

def test_staff_see_only_their_active_facility_with_audit_and_roles(portal):
    engine,client=portal;a=patient(client,'POST',PATH,payload('WEST')).json()['alert'];h=login(client)
    assert client.get('/api/golden-hour/staff/incoming').status_code==401
    assert client.get('/api/golden-hour/staff/incoming',headers=login(client,'nurse')).status_code==403
    scope(client,h,'EAST');assert client.get('/api/golden-hour/staff/incoming',headers=h).json()['alerts']==[]
    scope(client,h,'WEST');inbox=client.get('/api/golden-hour/staff/incoming',headers=h).json()
    assert [x['id'] for x in inbox['alerts']]==[a['id']] and inbox['can_decide'] is True
    card=inbox['alerts'][0];assert card['patient_name']=='SYNTHETIC Test Mother' and card['sbar']['text']=='SBAR text' and card['skipped_nearer'][0]['missing']==['blood transfusion']
    with engine.connect() as c:assert c.scalar(select(func.count()).select_from(s.audit_log).where(s.audit_log.c.action=='golden_hour_incoming_read'))>=1
    # Staff at another facility cannot act on it.
    scope(client,h,'SOUTH');assert client.post('/api/golden-hour/staff/alerts/'+a['id']+'/decision',headers=h,json={'status':'accepted','version':1}).status_code==404

def test_seen_accept_arrive_and_the_patient_sees_each_step(portal):
    engine,client=portal;a=patient(client,'POST',PATH,payload('WEST')).json()['alert'];h=login(client);scope(client,h,'WEST')
    base='/api/golden-hour/staff/alerts/'+a['id']
    seen=client.post(base+'/seen',headers=h,json={'version':1});assert seen.status_code==200 and seen.json()['alert']['status']=='seen'
    assert patient(client,'GET',PATH+'/'+a['id']).json()['alert']['status']=='seen'
    assert client.post(base+'/decision',headers=h,json={'status':'arrived','version':2}).status_code==409,'cannot arrive before accepting'
    assert client.post(base+'/decision',headers=h,json={'status':'accepted','version':1}).status_code==409,'stale version'
    ok=client.post(base+'/decision',headers=h,json={'status':'accepted','version':2});assert ok.status_code==200,ok.text
    mine=patient(client,'GET',PATH+'/'+a['id']).json()['alert'];assert mine['status']=='accepted' and mine['accepted_by_name'] and 'not a confirmed bed' in mine['public_note'].lower()
    assert 'sbar' not in mine, 'the patient-side view never echoes staff-only fields'
    done=client.post(base+'/decision',headers=h,json={'status':'arrived','version':3});assert done.status_code==200 and done.json()['alert']['ambulance']['state']=='arrived'
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.audit_log).where(s.audit_log.c.action=='golden_hour_accepted'))==1

def test_decline_needs_a_reason_and_only_deciders_can_decide(portal):
    engine,client=portal;a=patient(client,'POST',PATH,payload('WEST')).json()['alert'];h=login(client);scope(client,h,'WEST')
    url='/api/golden-hour/staff/alerts/'+a['id']+'/decision'
    assert client.post(url,headers=h,json={'status':'declined','version':1}).status_code==422
    r=client.post(url,headers=h,json={'status':'declined','version':1,'note':'No obstetric theatre free right now'});assert r.status_code==200 and r.json()['alert']['status']=='declined'
    mine=patient(client,'GET',PATH+'/'+a['id']).json()['alert'];assert mine['status']=='declined' and mine['ambulance']['state']=='stood_down'
    assert client.post(url,headers=h,json={'status':'accepted','version':2}).status_code==409,'a closed alert cannot be reopened'

def test_patient_cancel_closes_it_and_is_visible_to_staff(portal):
    engine,client=portal;a=patient(client,'POST',PATH,payload('WEST')).json()['alert'];h=login(client);scope(client,h,'WEST')
    c=patient(client,'POST',PATH+'/'+a['id']+'/cancel',{'note':'False alarm'});assert c.json()['alert']['status']=='cancelled'
    assert patient(client,'POST',PATH+'/'+a['id']+'/cancel',{'note':'again'}).json()['alert']['status']=='cancelled'
    assert patient(client,'POST',PATH+'/'+a['id']+'/cancel',{'note':'x'},key='node-mother:2').status_code==404
    inbox=client.get('/api/golden-hour/staff/incoming',headers=h).json();assert inbox['alerts'][0]['status']=='cancelled'
