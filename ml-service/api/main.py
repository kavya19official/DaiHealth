"""Access assistance only. Private loopback service; browser uses authenticated Express gateway."""
from pathlib import Path
import os,json,hashlib
from typing import Literal
import joblib,numpy as np,pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel,Field,ConfigDict,model_validator
from training.common import ROOT,FEATURES,LABEL
from training.reliability import support_gate
from data.synthetic_generator import CHANNELS,HOURS

app=FastAPI(title='DAI patient access assistance',version='1.0.0')
MODELS=ROOT/'models'
class Strict(BaseModel):model_config=ConfigDict(extra='forbid')
class Consent(Strict):
    personalization:bool=False
    location:bool=False
    reminders:bool=False
    events:bool=False
    allowed_channels:list[Literal['app','SMS','WhatsApp','voice']]=Field(default_factory=lambda:['app'],max_length=4)
class Profile(Strict):
    age:int=Field(default=26,ge=15,le=60)
    week:int=Field(default=0,ge=0,le=42)
    distance_km:float=Field(default=0,ge=0,le=500)
    caregiver_support:int=Field(default=0,ge=0,le=1)
    prior_missed_visits:int=Field(default=0,ge=0,le=1000)
    digital_literacy:int=Field(default=1,ge=0,le=2)
    preferred_channel:int=Field(default=0,ge=0,le=3)
class Patient(Strict):
    patient_id:str=Field(min_length=1,max_length=120)
    consent:Consent=Field(default_factory=Consent)
    features:Profile|None=None
    known_features:list[str]|None=Field(default=None,max_length=7)
    @model_validator(mode="after")
    def allowed_known_features(self):
        if self.known_features is not None and (len(set(self.known_features))!=len(self.known_features) or not set(self.known_features)<=set(FEATURES["barrier"])):raise ValueError("Unknown or duplicate feature provenance")
        return self
class Gap(Strict):
    id:str=Field(min_length=1,max_length=120)
    days_overdue:int=Field(ge=0,le=10000)
    gap_type:int=Field(default=0,ge=0,le=3)
    stage:int=Field(default=0,ge=0,le=4)
    clinician_priority:bool=False
    bucket:Literal['overdue','week','upcoming']='overdue'
class Gaps(Patient):
    gaps:list[Gap]=Field(max_length=200)
    @model_validator(mode='after')
    def unique(self):
        if len({x.id for x in self.gaps})!=len(self.gaps):raise ValueError('Gap IDs must be unique')
        return self
class Location(Strict):
    lat:float=Field(ge=-90,le=90)
    lng:float=Field(ge=-180,le=180)
class Facility(Strict):
    id:str=Field(min_length=1,max_length=120)
    distance_km:float|None=Field(default=None,ge=0,le=20000)
    open_now:bool=False
    offers_service:bool=False
    days_since_confirmed:int=Field(default=10000,ge=0,le=100000)
    appointment_availability:int=Field(default=0,ge=0,le=100000)
class Facilities(Patient):
    location:Location|None=None
    needed_service:str=Field(default='',max_length=100)
    candidates:list[Facility]=Field(max_length=100)
    @model_validator(mode='after')
    def unique(self):
        if len({x.id for x in self.candidates})!=len(self.candidates):raise ValueError('Facility IDs must be unique')
        return self
class Item(Strict):
    id:str
    reason:str=Field(min_length=1)
    source:Literal['ml','rules']
class Ranked(Strict):
    items:list[Item]
    source:Literal['ml','rules']
    data_label:str
class SendTime(Strict):
    hour:int=Field(ge=0,le=23)
    channel:Literal['app','SMS','WhatsApp','voice']
    reason:str=Field(min_length=1)
    source:Literal['ml','rules']
    data_label:str
class SupportAction(Strict):
    action:Literal['nearby','asha','schemes']
    reason:str=Field(min_length=1)
class Support(Strict):
    policy_version:Literal["support-release-v1"]="support-release-v1"
    actions:list[SupportAction]
    source:Literal['ml','rules']
    data_label:str
_cache={}
def load(name):
    if os.getenv('ML_ENABLED','true').lower()!='true':return None
    try:
        registry=json.loads((MODELS/'model_registry.json').read_text());entry=registry[name];file=MODELS/(name+'.joblib');sha=hashlib.sha256(file.read_bytes()).hexdigest()
        if sha!=entry['sha256']:return None
        key=(str(file),sha)
        if key not in _cache:_cache[key]=joblib.load(file)
        return _cache[key]['model']
    except Exception:return None

def profile(b):
    values=(b.features or Profile()).model_dump()
    if not b.consent.location:values['distance_km']=0
    values['prior_missed_visits']=min(values['prior_missed_visits'],5)
    return values

def predict(name,rows):
    model=load(name)
    if model is None or not rows:return None
    try:
        frame=pd.DataFrame(rows)[FEATURES[name]].astype(float)
        out=model.predict_proba(frame)[:,1] if name in ['barrier','reminders'] else model.predict(frame)
        return out if np.isfinite(out).all() else None
    except Exception:return None

def label(source):return LABEL if source=='ml' else 'Rule-based assistance'
@app.post('/rank-gaps',response_model=Ranked)
def rank_gaps(b:Gaps):
    rows=[{**g.model_dump(),**{k:v for k,v in profile(b).items() if k not in g.model_dump()}} for g in b.gaps]
    p=predict('gaps',rows) if b.consent.personalization else None;source='ml' if p is not None else 'rules'
    # Preserve clinician priority and rule-derived urgency groups before learned access order.
    order=sorted(range(len(b.gaps)),key=lambda i:({'overdue':0,'week':1,'upcoming':2}[b.gaps[i].bucket],-int(b.gaps[i].clinician_priority),-float(p[i]) if p is not None else -b.gaps[i].days_overdue,i))
    items=[]
    for i in order:
        g=b.gaps[i];reason=('Overdue by '+str(g.days_overdue)+' days' if g.days_overdue else 'Part of your upcoming care plan')+(' and marked important by your clinician' if g.clinician_priority else '')
        if source=='ml':reason+='; access patterns help order items within this priority group'
        items.append(Item(id=g.id,reason=reason,source=source))
    return Ranked(items=items,source=source,data_label=label(source))
@app.post('/rank-facilities',response_model=Ranked)
def rank_facilities(b:Facilities):
    eligible=[f for f in b.candidates if f.offers_service]
    rows=[f.model_dump() for f in eligible];p=predict('facilities',rows) if b.consent.personalization and b.consent.location else None;source='ml' if p is not None else 'rules'
    order=sorted(range(len(eligible)),key=lambda i:(-float(p[i]) if p is not None else eligible[i].distance_km if eligible[i].distance_km is not None else float('inf'),i))
    items=[]
    for i in order:
        f=eligible[i];bits=[f'{f.distance_km:g} km away' if f.distance_km is not None else 'distance not recorded','listed for this service']
        if f.open_now:bits.append('reported open now')
        if f.days_since_confirmed<10000:bits.append(f'confirmed {f.days_since_confirmed} days ago')
        if f.appointment_availability:bits.append('appointment slots reported')
        bits.append('confirm details with the centre')
        items.append(Item(id=f.id,reason=', '.join(bits),source=source))
    return Ranked(items=items,source=source,data_label=label(source))
@app.post('/best-send-time',response_model=SendTime)
def best_send_time(b:Patient):
    channels=b.consent.allowed_channels or ['app'];choices=[(h,c) for h in HOURS for c in range(4) if CHANNELS[c] in channels]
    rows=[{**profile(b),'hour':h,'channel':c} for h,c in choices]
    p=predict('reminders',rows) if b.features and b.consent.personalization and b.consent.reminders else None;source='ml' if p is not None else 'rules'
    hour,channel=choices[int(np.argmax(p))] if p is not None else (9,CHANNELS.index('app' if 'app' in channels else channels[0]))
    return SendTime(hour=hour,channel=CHANNELS[channel],reason='A suggested time from your allowed channels and synthetic response patterns; you can change it.' if source=='ml' else 'A 9 AM reminder using an allowed channel. Your quiet hours still apply.',source=source,data_label=label(source))
@app.post('/support-suggestions',response_model=Support)
def support(b:Patient):
    values=profile(b);known=set(b.known_features if b.known_features is not None else b.features.model_fields_set if b.features else [])
    if not b.consent.location:known.discard('distance_km')
    release=support_gate(MODELS);p=None;actions=[]
    if b.features and b.consent.personalization and release['prediction_enabled'] and set(FEATURES['barrier'])<=known and 15<=values['age']<=45 and 0<=values['distance_km']<=80:
        p=predict('barrier',[values])
    source='ml' if p is not None else 'rules'
    if b.consent.personalization and 'distance_km' in known and values['distance_km']>=5:
        actions.append(SupportAction(action='nearby',reason=f"Your recorded journey is {values['distance_km']:g} km. You can look for a closer centre offering the planned service."))
    missed='prior_missed_visits' in known and values['prior_missed_visits']>0
    no_support='caregiver_support' in known and not values['caregiver_support']
    if b.consent.personalization and (missed or no_support or p is not None and p[0]>=.5):
        reason='A previous visit is recorded as missed. You can ask your ASHA or care team for help planning the next visit.' if missed else 'You reported needing caregiver support. You can ask your ASHA or care team for help planning the visit.' if no_support else 'Optional help planning your next visit is available from your ASHA or care team.'
        actions.append(SupportAction(action='asha',reason=reason))
    actions.append(SupportAction(action='schemes',reason='Check official maternity and transport support information; eligibility needs confirmation.'))
    return Support(actions=actions,source=source,data_label=label(source))
@app.get('/health')
def health():return {'status':'ok','models_available':{name:load(name) is not None for name in FEATURES},'support_prediction_enabled':os.getenv('ML_ENABLED','true').lower()=='true' and support_gate(MODELS)['prediction_enabled'],'data_label':'synthetic'}
@app.get('/model-info')
def model_info():
    try:return {'models':json.loads((MODELS/'model_registry.json').read_text()),'support_release':support_gate(MODELS),'statement':'Metrics are measured on synthetic data and are not real-world performance.'}
    except (OSError,ValueError):return {'models':{},'statement':'Models unavailable; deterministic fallbacks are active.'}
