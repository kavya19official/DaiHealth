"""Local synthetic coordination only; no clinical orders, records or slot reservations."""
import hashlib
import os
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL
from zoneinfo import ZoneInfo
import json
import jwt
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, String, Integer, DateTime, select, update, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from . import schema as s
from .security import ROLES
from .staff_scope import facility_staff

for role in ('hospital_admin', 'consultant', 'front_desk', 'phc_user'):
    ROLES[role].update({'coordination.read', 'coordination.write'})

requests = s.table('demo_care_request', s.ref('facility_id', 'facility', False),
    s.text('directory_code', False), s.text('patient_key', False), s.text('patient_name', False),
    s.text('kind', False), s.text('need', False), s.text('service', False), s.text('status', False),
    s.text('requested_date'), s.text('patient_note', False), s.text('request_key', False),
    s.text('request_hash', False), s.text('open_key'), s.text('schedule_key'), s.ref('clinician_id', 'portal_user'),
    Column('scheduled_at', DateTime(timezone=True)), s.text('public_note', False),
    Column('consented_at', DateTime(timezone=True), nullable=False), s.number('version', False),
    constraints=(UniqueConstraint('patient_key', 'request_key'), UniqueConstraint('open_key'), UniqueConstraint('schedule_key')))
events = s.table('demo_care_request_event', s.ref('request_id', 'demo_care_request', False),
    s.text('actor_type', False), s.text('actor_key', False), s.text('status', False),
    s.text('note', False), s.number('version', False))
TRANSITIONS = {'requested': {'accepted', 'declined', 'cancelled'}, 'accepted': {'scheduled', 'referral_coordinated', 'cancelled'}, 'scheduled': {'closed', 'cancelled'}, 'referral_coordinated': {'closed', 'cancelled'}}
TERMINAL = {'declined', 'cancelled', 'closed'}
COORDS = {'CENTRAL': (28.6315,77.2167), 'SOUTH': (28.533,77.21), 'WEST': (28.589,77.047), 'NORTH': (28.715,77.12), 'EAST': (28.641,77.295)}

def uid(value):
    return str(uuid5(NAMESPACE_URL, 'dai:demo-coordination:'+value))

def fixture():
    return json.loads((Path(__file__).resolve().parents[2] / 'synthetic_data/demo/delhi-network.json').read_text())

def enabled():
    if os.getenv('DAI_LOCAL') != 'true' or os.getenv('DAI_DEMO') != 'true':
        raise HTTPException(404, 'Synthetic coordination is available in local demo mode only')

def seed_demo_requests(engine):
    if os.getenv('DAI_LOCAL') != 'true' or os.getenv('DAI_DEMO') != 'true':
        return
    with engine.begin() as c:
        # Reuse existing demo operators. Do not create credentials or change their original scopes.
        people = c.execute(select(s.user).where(s.user.c.source_id.in_(['demo:hospital_admin', 'demo:consultant']))).mappings().all()
        if not people:
            return
        for f in fixture()['facilities']:
            fid, did, unit = uid('facility:'+f['code']), uid('department:'+f['code']), uid('unit:'+f['code'])
            if not c.scalar(select(s.facility.c.id).where(s.facility.c.id == fid)):
                lat, lng = COORDS[f['code']]
                c.execute(s.facility.insert().values(id=fid,source_id='demo-coordination:'+f['code'],name=f['name'],tier='PRIVATE',ownership='SYNTHETIC DEMO',address='Fictional demonstration premises; PIN '+f['pincode'],lat=lat,lng=lng,authorized_beds=0,functional_beds=0,capabilities={'synthetic_coordination_only':True,'directory_code':f['code']}))
                c.execute(s.department.insert().values(id=did,source_id='demo-coordination:'+f['code'],facility_id=fid,name='Synthetic coordination office'))
                c.execute(s.unit.insert().values(id=unit,source_id='demo-coordination:'+f['code'],facility_id=fid,department_id=did,code='DEMO-COORDINATION'))
            for person in people:
                if c.scalar(select(s.staff_affiliation.c.id).where(s.staff_affiliation.c.facility_id==fid,s.staff_affiliation.c.email==person['email'])):
                    continue
                c.execute(s.staff_affiliation.insert().values(id=uid('affiliation:'+f['code']+person['id']),source_id='demo-coordination:'+f['code']+':'+person['id'],facility_id=fid,user_id=person['id'],email=person['email'],name=person['name'],role=person['role'],department_id=did if person['role']=='consultant' else None,unit_id=unit if person['role']=='consultant' else None,registration_no=person['registration_no'],verified=person['verified'],active=True,version=1))
                c.execute(s.audit_log.insert().values(actor_id=person['id'],action='demo_coordination_affiliation_seeded',entity_type='facility',entity_id=fid,details={'facility_id':fid,'synthetic_only':True,'directory_code':f['code']}))

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
class New(Input):
    directory_code: str = Field(max_length=30)
    kind: str
    need: str
    service: str
    requested_date: str = ''
    patient_note: str = Field(default='', max_length=500)
    request_key: str = Field(min_length=16, max_length=80)
    consent: bool
class Change(Input):
    status: str
    version: int = Field(ge=1)
    clinician_id: str | None = None
    scheduled_at: datetime | None = None
    public_note: str = Field(min_length=5, max_length=500)
class Cancel(Input):
    version: int = Field(ge=1)
    public_note: str = Field(min_length=5, max_length=500)

def register_demo_requests(app, engine, require, audit, secret):
    async def patient(request: Request):
        enabled()
        raw = await request.body()
        try:
            token = jwt.decode(request.headers.get('x-dai-coordination',''), secret, algorithms=['HS256'],issuer='dai-patient-coordination',audience='dai-hospital-coordination',options={'require':['exp','iat','sub','patient_name','method','path','body_sha256']})
            if not str(token['sub']).startswith('node-mother:') or token['method'] != request.method or token['path'] != request.url.path or token['body_sha256'] != hashlib.sha256(raw).hexdigest():
                raise ValueError()
            if not isinstance(token['patient_name'],str) or not 1 <= len(token['patient_name']) <= 150:
                raise ValueError()
            return token
        except (jwt.PyJWTError, ValueError, KeyError):
            raise HTTPException(401, 'Invalid patient coordination bridge token')

    def output(c, row):
        value = dict(row)
        value.pop('open_key',None);value.pop('schedule_key',None); value.pop('request_hash',None);value.pop('request_key',None);value.pop('source_id',None);value.pop('patient_key',None)
        for key in ('created_at','updated_at','consented_at','scheduled_at'):
            if value.get(key) is not None and value[key].tzinfo is None:value[key]=value[key].replace(tzinfo=timezone.utc)
        value['facility_name'] = c.scalar(select(s.facility.c.name).where(s.facility.c.id==row['facility_id']))
        value['clinician_name'] = c.scalar(select(s.user.c.name).where(s.user.c.id==row['clinician_id'])) if row['clinician_id'] else None
        value['events'] = [dict(e) for e in c.execute(select(events.c.status,events.c.note,events.c.version,events.c.created_at).where(events.c.request_id==row['id']).order_by(events.c.version)).mappings()]
        for event in value['events']:
            if event['created_at'].tzinfo is None:event['created_at']=event['created_at'].replace(tzinfo=timezone.utc)
        value['synthetic'] = True
        return value

    def history(c, row, who, note):
        c.execute(events.insert().values(request_id=row['id'],actor_type=who['type'],actor_key=who['id'],status=row['status'],note=note,version=row['version']))

    @app.post('/api/demo-coordination/patient/requests')
    def create(body: New, p=Depends(patient)):
        f = next((f for f in fixture()['facilities'] if f['code']==body.directory_code),None)
        needs={'antenatal':'obstetrics','gynaecology':'gynecology','ultrasound':'ultrasound','laboratory':'lab_tests','vaccination':'vaccination'}
        if not f or body.kind not in ('appointment','referral') or not body.consent or needs.get(body.need)!=body.service or body.service not in [s[1] for s in f['services']]:
            raise HTTPException(422, 'Select an eligible service and confirm sharing consent')
        if body.requested_date:
            try:
                if date.fromisoformat(body.requested_date) < datetime.now(ZoneInfo('Asia/Kolkata')).date(): raise ValueError()
            except ValueError: raise HTTPException(422, 'Requested date must be today or later')
        key='|'.join([p['sub'],body.directory_code,body.kind,body.service])
        hashed=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest()
        try:
            with engine.begin() as c:
                fid=uid('facility:'+body.directory_code)
                if not c.scalar(select(s.facility.c.id).where(s.facility.c.id==fid)):
                    raise HTTPException(503,'Synthetic receiving facility has not been initialized. Restart npm start.')
                existing=c.execute(select(requests).where(requests.c.patient_key==p['sub'],requests.c.request_key==body.request_key)).mappings().first()
                if existing:
                    if existing['request_hash']!=hashed:raise HTTPException(409,'Request key was already used with different details')
                    return {'request':output(c,existing),'duplicate':True}
                existing=c.execute(select(requests).where(requests.c.open_key==key)).mappings().first()
                if existing:return {'request':output(c,existing),'duplicate':True}
                identifier=str(uuid4())
                c.execute(requests.insert().values(id=identifier,facility_id=fid,directory_code=body.directory_code,patient_key=p['sub'],patient_name=p['patient_name'],kind=body.kind,need=body.need,service=body.service,status='requested',requested_date=body.requested_date,patient_note=body.patient_note,request_key=body.request_key,request_hash=hashed,open_key=key,public_note='Patient submitted a synthetic coordination request.',consented_at=datetime.now(timezone.utc),version=1))
                row=c.execute(select(requests).where(requests.c.id==identifier)).mappings().one()
                history(c,row,{'type':'patient','id':p['sub']},row['public_note'])
                return {'request':output(c,row),'duplicate':False}
        except IntegrityError:
            raise HTTPException(409,'A matching request was created concurrently. Refresh your requests.')

    @app.get('/api/demo-coordination/patient/requests')
    def own(p=Depends(patient)):
        with engine.connect() as c:
            rows=c.execute(select(requests).where(requests.c.patient_key==p['sub']).order_by(requests.c.created_at.desc()).limit(100)).mappings().all()
            return {'requests':[output(c,r) for r in rows]}

    @app.post('/api/demo-coordination/patient/requests/{identifier}/cancel')
    def cancel(identifier:UUID,body:Cancel,p=Depends(patient)):
        identifier=str(identifier)
        with engine.begin() as c:
            row=c.execute(select(requests).where(requests.c.id==identifier,requests.c.patient_key==p['sub'])).mappings().first()
            if not row:raise HTTPException(404,'Request not found')
            if row['status'] in TERMINAL:raise HTTPException(409,'This request is already closed')
            result=c.execute(update(requests).where(requests.c.id==identifier,requests.c.version==body.version).values(status='cancelled',open_key=None,schedule_key=None,public_note=body.public_note,version=body.version+1))
            if result.rowcount!=1:raise HTTPException(409,'Request changed. Refresh and retry.')
            row=c.execute(select(requests).where(requests.c.id==identifier)).mappings().one();history(c,row,{'type':'patient','id':p['sub']},body.public_note)
            return {'request':output(c,row)}

    @app.get('/api/demo-coordination/staff/requests')
    def inbox(u=Depends(require('coordination.read'))):
        enabled()
        with engine.begin() as c:
            people=[p for p in facility_staff(c,u['facility_id']) if p['role']=='consultant' and p['verified'] and p['registration_no'] and p['department_id'] and p['unit_id']]
            rows=c.execute(select(requests).where(requests.c.facility_id==u['facility_id']).order_by(requests.c.created_at.desc()).limit(100)).mappings().all()
            audit(c,u,'demo_request_inbox_read','facility',u['facility_id'],{'request_ids':[r['id'] for r in rows]})
            return {'requests':[output(c,r) for r in rows],'clinicians':[{'id':p['id'],'name':p['name']} for p in people],'facility_name':c.scalar(select(s.facility.c.name).where(s.facility.c.id==u['facility_id'])),'synthetic':True,'transitions':{k:sorted(v) for k,v in TRANSITIONS.items()}}

    @app.post('/api/demo-coordination/staff/requests/{identifier}')
    def decision(identifier:UUID,body:Change,u=Depends(require('coordination.write'))):
        identifier=str(identifier)
        enabled()
        with engine.begin() as c:
            row=c.execute(select(requests).where(requests.c.id==identifier,requests.c.facility_id==u['facility_id'])).mappings().first()
            if not row:raise HTTPException(404,'Request not found in your active facility')
            if body.status not in TRANSITIONS.get(row['status'],set()):raise HTTPException(409,'This status transition is not allowed')
            if (body.status=='scheduled' and row['kind']!='appointment') or (body.status=='referral_coordinated' and row['kind']!='referral'):
                raise HTTPException(422,'Status does not match the request type')
            clinician=body.clinician_id or row['clinician_id']
            if body.status in ('accepted','scheduled','referral_coordinated','closed'):
                eligible=[p for p in facility_staff(c,u['facility_id']) if p['id']==clinician and p['role']=='consultant' and p['verified'] and p['registration_no'] and p['department_id'] and p['unit_id']]
                if not eligible:raise HTTPException(422,'Assign an active, verified synthetic clinician in this facility')
            scheduled=body.scheduled_at or row['scheduled_at']
            if body.status=='scheduled':
                if not scheduled or scheduled.tzinfo is None or scheduled <= datetime.now(timezone.utc):raise HTTPException(422,'A future appointment time with a time zone is required')
            values={'status':body.status,'clinician_id':clinician,'public_note':body.public_note,'version':body.version+1}
            if body.status=='scheduled':
                scheduled=scheduled.astimezone(timezone.utc).replace(second=0,microsecond=0)
                values['scheduled_at']=scheduled
                values['schedule_key']=clinician+'|'+scheduled.isoformat()
            if body.status in TERMINAL:values.update(open_key=None,schedule_key=None)
            try:
                result=c.execute(update(requests).where(requests.c.id==identifier,requests.c.version==body.version).values(**values))
            except IntegrityError:
                raise HTTPException(409,'This synthetic clinician already has a scheduled request at that start minute. Choose another time.')
            if result.rowcount!=1:raise HTTPException(409,'Request changed. Refresh and retry.')
            after=c.execute(select(requests).where(requests.c.id==identifier)).mappings().one()
            history(c,after,{'type':'staff','id':u['id']},body.public_note)
            audit(c,u,'demo_request_'+body.status,'demo_care_request',identifier,{'before_status':row['status'],'before_clinician_id':row['clinician_id'],'after_status':body.status,'clinician_id':clinician,'version':after['version']})
            return {'request':output(c,after)}

    return patient
