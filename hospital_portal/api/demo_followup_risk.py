"""Shared coordination follow-ups and a separate, explicitly simulated risk-review workflow."""
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL
import hashlib,json,os
from fastapi import Depends,HTTPException
from pydantic import Field
from sqlalchemy import Column,DateTime,select,update,UniqueConstraint
from sqlalchemy.exc import IntegrityError
from . import schema as s
from .staff_scope import facility_staff
from .demo_requests import Input,requests,enabled

followups=s.table('demo_patient_followup',s.ref('request_id','demo_care_request',False),s.ref('facility_id','facility',False),s.text('patient_key',False),s.text('patient_name',False),s.text('title',False),s.text('due_date',False),s.ref('assigned_to','portal_user',False),s.text('status',False),s.text('public_note',False),s.text('evidence_ref'),s.text('open_key'),s.text('request_key',False),s.text('request_hash',False),s.number('version',False),constraints=(UniqueConstraint('request_id','request_key'),UniqueConstraint('open_key')))
cases=s.table('demo_risk_review_case',s.text('title',False),s.text('vignette',False),s.text('review_state',False),s.text('review_reason'),s.text('evidence_ref'),s.ref('reviewed_by','portal_user'),Column('reviewed_at',DateTime(timezone=True)),s.number('version',False))
flags=s.table('demo_patient_risk_flag',s.ref('request_id','demo_care_request',False),s.ref('facility_id','facility',False),s.text('patient_key',False),s.text('patient_name',False),s.ref('case_id','demo_risk_review_case',False),s.number('case_version',False),s.data('review_snapshot'),s.text('reason',False),s.ref('escalation_owner','portal_user',False),s.text('status',False),s.text('public_note',False),s.text('evidence_ref'),s.text('open_key'),s.number('version',False),constraints=(UniqueConstraint('open_key'),))
trail=s.table('demo_followup_risk_event',s.text('entity_kind',False),s.text('entity_id',False),s.text('actor_kind',False),s.text('actor_id',False),s.text('actor_name',False),s.text('action',False),s.text('note',False),s.text('evidence_ref'),s.number('version',False))

def seed_followup_risk(engine):
    if os.getenv('DAI_LOCAL')!='true' or os.getenv('DAI_DEMO')!='true':return
    with engine.begin() as c:
        for code,title,vignette in [
            ('REVIEW-001','Synthetic reported concern awaiting review','A fictional patient reports a new concern and asks for care-team assessment. A qualified reviewer must supply the clinically relevant case details and review evidence before this case can be treated as clinically approved.'),
            ('REVIEW-002','Synthetic care-team reassessment request','A fictional follow-up note requests care-team reassessment. This software test case asserts no diagnosis, severity threshold or future medical outcome. Clinical review evidence has not been supplied.')]:
            identifier=str(uuid5(NAMESPACE_URL,'dai:synthetic-risk-case:'+code))
            if not c.scalar(select(cases.c.id).where(cases.c.id==identifier)):
                c.execute(cases.insert().values(id=identifier,source_id=code,title=title,vignette=vignette,review_state='pending_review',version=1))

class NewFollowup(Input):
    request_id:UUID
    title:str=Field(min_length=3,max_length=180)
    due_date:date
    assigned_to:UUID
    public_note:str=Field(min_length=5,max_length=1000)
    request_key:str=Field(min_length=16,max_length=80)
class FollowupAction(Input):
    version:int=Field(ge=1)
    action:str
    public_note:str=Field(min_length=5,max_length=1000)
    evidence_ref:str=Field(default='',max_length=500)
    assigned_to:UUID|None=None
class CaseReview(Input):
    version:int=Field(ge=1)
    review_reason:str=Field(min_length=10,max_length=1500)
    evidence_ref:str=Field(min_length=5,max_length=500)
    simulation_acknowledged:bool
class NewFlag(Input):
    request_id:UUID
    case_id:UUID
    case_version:int=Field(ge=1)
    escalation_owner:UUID
    reason:str=Field(min_length=10,max_length=1500)
    public_note:str=Field(min_length=5,max_length=1000)
class FlagAction(Input):
    version:int=Field(ge=1)
    action:str
    public_note:str=Field(min_length=5,max_length=1000)
    evidence_ref:str=Field(default='',max_length=500)
    escalation_owner:UUID|None=None

def register_followup_risk(app,engine,require,audit,patient):
    def now():return datetime.now(timezone.utc)
    def iso(value):return value.replace(tzinfo=timezone.utc).isoformat() if value and value.tzinfo is None else value.isoformat() if value else None
    def event(c,kind,row,actor,action,note,evidence=''):
        c.execute(trail.insert().values(entity_kind=kind,entity_id=row['id'],actor_kind=actor.get('type','staff'),actor_id=actor['id'],actor_name=actor.get('name','Patient'),action=action,note=note,evidence_ref=evidence,version=row['version']))
    def history(c,kind,identifier):
        return [{**dict(e),'created_at':iso(e['created_at'])} for e in c.execute(select(trail).where(trail.c.entity_kind==kind,trail.c.entity_id==identifier).order_by(trail.c.version)).mappings()]
    def scoped(c,table,identifier,u):
        row=c.execute(select(table).where(table.c.id==str(identifier),table.c.facility_id==u['facility_id'])).mappings().first()
        if not row:raise HTTPException(404,'Record not found in your active facility')
        return row
    def owner(c,u,identifier):
        people=[p for p in facility_staff(c,u['facility_id']) if p['id']==str(identifier) and p['role']=='consultant' and p['verified'] and p['registration_no'] and p['department_id'] and p['unit_id']]
        if not people:raise HTTPException(422,'Choose an active, eligible synthetic clinician in this facility')
        return people[0]
    def output(c,table,row,kind):
        value=dict(row)
        for k in ('open_key','request_key','request_hash','patient_key','source_id'):value.pop(k,None)
        for k in ('created_at','updated_at','reviewed_at'):
            if k in value:value[k]=iso(value[k])
        if kind!='case':
            value['facility_name']=c.scalar(select(s.facility.c.name).where(s.facility.c.id==row['facility_id']))
            key='assigned_to' if kind=='followup' else 'escalation_owner'
            value['owner_name']=c.scalar(select(s.user.c.name).where(s.user.c.id==row[key]))
        else:value['reviewer_name']=c.scalar(select(s.user.c.name).where(s.user.c.id==row['reviewed_by'])) if row['reviewed_by'] else None
        value['history']=history(c,kind,row['id']);value['synthetic']=True
        if kind in ('flag','case'):
            value['simulation_only']=True;value['clinical_approval_verified']=False
        return value
    def save(c,table,row,values,version):
        values['version']=version+1
        try:r=c.execute(update(table).where(table.c.id==row['id'],table.c.version==version).values(**values))
        except IntegrityError:raise HTTPException(409,'An active matching record already exists. Refresh and retry.')
        if r.rowcount!=1:raise HTTPException(409,'This record changed. Refresh and retry.')
        return c.execute(select(table).where(table.c.id==row['id'])).mappings().one()

    @app.post('/api/demo-coordination/staff/followups')
    def create_followup(body:NewFollowup,u=Depends(require('coordination.write'))):
        enabled()
        if body.due_date<now().astimezone(ZoneInfo('Asia/Kolkata')).date():raise HTTPException(422,'Choose today or a future follow-up date')
        with engine.begin() as c:
            request=scoped(c,requests,body.request_id,u)
            if request['status'] not in ('accepted','scheduled','referral_coordinated','closed'):raise HTTPException(409,'Accept and assign the patient request before creating follow-up tasks')
            owner(c,u,body.assigned_to);key=str(body.request_id)+'|'+body.title.lower();hashed=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
            prior=c.execute(select(followups).where(followups.c.request_id==str(body.request_id),followups.c.request_key==body.request_key)).mappings().first()
            if prior:
                if prior['request_hash']!=hashed:raise HTTPException(409,'Request key was used for different task details')
                return {'task':output(c,followups,prior,'followup'),'duplicate':True}
            prior=c.execute(select(followups).where(followups.c.open_key==key)).mappings().first()
            if prior:return {'task':output(c,followups,prior,'followup'),'duplicate':True}
            identifier=str(uuid4())
            try:c.execute(followups.insert().values(id=identifier,request_id=str(body.request_id),facility_id=u['facility_id'],patient_key=request['patient_key'],patient_name=request['patient_name'],title=body.title,due_date=body.due_date.isoformat(),assigned_to=str(body.assigned_to),status='open',public_note=body.public_note,open_key=key,request_key=body.request_key,request_hash=hashed,version=1))
            except IntegrityError:raise HTTPException(409,'A matching task was created concurrently. Refresh.')
            row=c.execute(select(followups).where(followups.c.id==identifier)).mappings().one();event(c,'followup',row,u,'created',body.public_note)
            audit(c,u,'patient_followup_created','demo_patient_followup',identifier,{'request_id':str(body.request_id),'assigned_to':str(body.assigned_to),'due_date':body.due_date.isoformat()})
            return {'task':output(c,followups,row,'followup'),'duplicate':False}

    @app.get('/api/demo-coordination/patient/followups')
    def own_followups(p=Depends(patient)):
        with engine.connect() as c:return {'tasks':[output(c,followups,r,'followup') for r in c.execute(select(followups).where(followups.c.patient_key==p['sub']).order_by(followups.c.created_at.desc()).limit(100)).mappings()]}

    @app.post('/api/demo-coordination/patient/followups/{identifier}/actions')
    def patient_action(identifier:UUID,body:FollowupAction,p=Depends(patient)):
        if body.action not in ('acknowledge','report_done'):raise HTTPException(403,'Patients can acknowledge or self-report only')
        with engine.begin() as c:
            row=c.execute(select(followups).where(followups.c.id==str(identifier),followups.c.patient_key==p['sub'])).mappings().first()
            if not row:raise HTTPException(404,'Task not found')
            if row['status'] not in ('open','acknowledged') or body.action=='acknowledge' and row['status']!='open':raise HTTPException(409,'This task is not awaiting that action')
            after=save(c,followups,row,{'status':'acknowledged' if body.action=='acknowledge' else 'patient_reported_done','public_note':body.public_note},body.version)
            event(c,'followup',after,{'id':p['sub'],'name':p['patient_name'],'type':'patient'},body.action,body.public_note)
            return {'task':output(c,followups,after,'followup')}

    @app.get('/api/demo-coordination/staff/followups')
    def staff_followups(u=Depends(require('coordination.read'))):
        enabled()
        with engine.begin() as c:
            rows=c.execute(select(followups).where(followups.c.facility_id==u['facility_id']).order_by(followups.c.created_at.desc()).limit(100)).mappings().all();audit(c,u,'patient_followups_read','facility',u['facility_id'],{'ids':[r['id'] for r in rows]})
            return {'tasks':[output(c,followups,r,'followup') for r in rows]}

    @app.post('/api/demo-coordination/staff/followups/{identifier}/actions')
    def staff_action(identifier:UUID,body:FollowupAction,u=Depends(require('coordination.write'))):
        enabled()
        if body.action not in ('complete','cancel','reopen','reassign'):raise HTTPException(422,'Choose a supported staff task action')
        with engine.begin() as c:
            row=scoped(c,followups,identifier,u)
            if row['assigned_to']!=u['id'] and u['role']!='hospital_admin':raise HTTPException(403,'Only the owner or facility administrator can update this task')
            terminal=row['status'] in ('closed','cancelled')
            if body.action=='reopen' and not terminal or body.action!='reopen' and terminal:raise HTTPException(409,'Task state does not allow that action')
            values={'public_note':body.public_note}
            if body.action=='complete':
                if len(body.evidence_ref.strip())<5:raise HTTPException(422,'Record the source/evidence for closing coordination follow-up')
                values.update(status='closed',evidence_ref=body.evidence_ref,open_key=None)
            if body.action=='cancel':values.update(status='cancelled',open_key=None)
            if body.action=='reopen':values.update(status='open',open_key=row['request_id']+'|'+row['title'].lower())
            if body.action=='reassign':
                if not body.assigned_to:raise HTTPException(422,'Select an owner')
                owner(c,u,body.assigned_to);values['assigned_to']=str(body.assigned_to)
            after=save(c,followups,row,values,body.version);event(c,'followup',after,u,body.action,body.public_note,body.evidence_ref)
            audit(c,u,'patient_followup_'+body.action,'demo_patient_followup',row['id'],{'before_status':row['status'],'status':after['status'],'owner':after['assigned_to'],'version':after['version']})
            return {'task':output(c,followups,after,'followup')}

    @app.get('/api/demo-coordination/staff/risk-cases')
    def case_list(u=Depends(require('coordination.read'))):
        enabled()
        with engine.connect() as c:return {'cases':[output(c,cases,r,'case') for r in c.execute(select(cases).order_by(cases.c.source_id)).mappings()]}

    @app.post('/api/demo-coordination/staff/risk-cases/{identifier}/review')
    def review(identifier:UUID,body:CaseReview,u=Depends(require('risk.validate'))):
        enabled()
        if not body.simulation_acknowledged:raise HTTPException(422,'Acknowledge that this is a simulated review, not verified clinical approval')
        with engine.begin() as c:
            owner(c,u,u['id']);row=c.execute(select(cases).where(cases.c.id==str(identifier))).mappings().first()
            if not row:raise HTTPException(404,'Case not found')
            after=save(c,cases,row,{'review_state':'simulation_review_recorded','review_reason':body.review_reason,'evidence_ref':body.evidence_ref,'reviewed_by':u['id'],'reviewed_at':now()},body.version)
            event(c,'case',after,u,'simulation_review_recorded',body.review_reason,body.evidence_ref);audit(c,u,'risk_case_simulation_review','demo_risk_review_case',row['id'],{'version':after['version'],'evidence_ref':body.evidence_ref,'clinical_approval_verified':False})
            return {'case':output(c,cases,after,'case')}

    @app.post('/api/demo-coordination/staff/risk-flags')
    def create_flag(body:NewFlag,u=Depends(require('risk.validate'))):
        enabled()
        with engine.begin() as c:
            request=scoped(c,requests,body.request_id,u);owner(c,u,body.escalation_owner)
            if request['status'] in ('declined','cancelled'):raise HTTPException(409,'This patient request is no longer active')
            case=c.execute(select(cases).where(cases.c.id==str(body.case_id))).mappings().first()
            if not case or case['review_state']!='simulation_review_recorded' or case['version']!=body.case_version:raise HTTPException(409,'A current recorded reviewer decision and evidence are required before a flag can be raised')
            key=str(body.request_id)+'|'+str(body.case_id)
            prior=c.execute(select(flags).where(flags.c.open_key==key)).mappings().first()
            if prior:return {'flag':output(c,flags,prior,'flag'),'duplicate':True}
            snapshot={k:v for k,v in output(c,cases,case,'case').items() if k in ('title','vignette','review_reason','evidence_ref','reviewer_name','reviewed_by','reviewed_at','version','clinical_approval_verified','simulation_only')}
            identifier=str(uuid4())
            try:c.execute(flags.insert().values(id=identifier,request_id=str(body.request_id),facility_id=u['facility_id'],patient_key=request['patient_key'],patient_name=request['patient_name'],case_id=str(body.case_id),case_version=case['version'],review_snapshot=snapshot,reason=body.reason,escalation_owner=str(body.escalation_owner),status='escalated',public_note=body.public_note,open_key=key,version=1))
            except IntegrityError:raise HTTPException(409,'A matching flag was created concurrently. Refresh.')
            row=c.execute(select(flags).where(flags.c.id==identifier)).mappings().one();event(c,'flag',row,u,'escalated',body.reason,case['evidence_ref']);audit(c,u,'risk_demo_escalated','demo_patient_risk_flag',identifier,{'case_version':case['version'],'owner':str(body.escalation_owner),'simulation_only':True})
            return {'flag':output(c,flags,row,'flag'),'duplicate':False}

    @app.get('/api/demo-coordination/patient/risk-flags')
    def own_flags(p=Depends(patient)):
        with engine.connect() as c:return {'flags':[output(c,flags,r,'flag') for r in c.execute(select(flags).where(flags.c.patient_key==p['sub']).order_by(flags.c.created_at.desc()).limit(100)).mappings()]}

    @app.get('/api/demo-coordination/staff/risk-flags')
    def staff_flags(u=Depends(require('coordination.read'))):
        enabled()
        with engine.begin() as c:
            rows=c.execute(select(flags).where(flags.c.facility_id==u['facility_id']).order_by(flags.c.created_at.desc()).limit(100)).mappings().all();audit(c,u,'risk_demo_flags_read','facility',u['facility_id'],{'ids':[r['id'] for r in rows]})
            return {'flags':[output(c,flags,r,'flag') for r in rows]}

    @app.post('/api/demo-coordination/staff/risk-flags/{identifier}/actions')
    def flag_action(identifier:UUID,body:FlagAction,u=Depends(require('risk.validate'))):
        enabled()
        with engine.begin() as c:
            row=scoped(c,flags,identifier,u)
            if row['escalation_owner']!=u['id']:raise HTTPException(403,'Only the escalation owner may acknowledge, close or transfer this flag')
            if row['status']=='closed':raise HTTPException(409,'This flag is closed')
            values={'public_note':body.public_note}
            if body.action=='acknowledge':
                if row['status']!='escalated':raise HTTPException(409,'Flag has already been acknowledged')
                values['status']='acknowledged'
            elif body.action=='close':
                if len(body.evidence_ref.strip())<5:raise HTTPException(422,'Record review/disposition evidence')
                values.update(status='closed',evidence_ref=body.evidence_ref,open_key=None)
            elif body.action=='reassign':
                if not body.escalation_owner:raise HTTPException(422,'Choose the next escalation owner')
                owner(c,u,body.escalation_owner);values.update(escalation_owner=str(body.escalation_owner),status='escalated')
            else:raise HTTPException(422,'Unsupported flag action')
            after=save(c,flags,row,values,body.version);event(c,'flag',after,u,body.action,body.public_note,body.evidence_ref);audit(c,u,'risk_demo_'+body.action,'demo_patient_risk_flag',row['id'],{'owner':after['escalation_owner'],'status':after['status'],'version':after['version']})
            return {'flag':output(c,flags,after,'flag')}
