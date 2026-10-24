import hashlib,json
import numpy as np,pandas as pd,pytest
from fastapi.testclient import TestClient
from data.synthetic_generator import generate,split_rows
from training.common import FEATURES,ROOT
from api import main
client=TestClient(main.app)

@pytest.fixture(scope='module')
def data():return generate(42,limit=80)[0]

def test_generator_reproducible(data):
    again,_=generate(42,limit=80)
    for k,v in data.items():pd.testing.assert_frame_equal(v,again[k])

def test_grouped_time_split_and_predictor_leakage(data):
    for name,frame in data.items():
        if name=='patients':continue
        splits=split_rows(frame);groups={k:set(v.patient_id) for k,v in splits.items()}
        assert not groups['train']&groups['test'];assert not groups['train']&groups['validation'];assert not groups['test']&groups['validation']
        assert splits['train'].timestamp.max()<splits['validation'].timestamp.min()<splits['test'].timestamp.min()
    forbidden={'patient_id','missed','action_completed','closed_7d','chosen','relevance','opened','source_status'}
    for cols in FEATURES.values():assert not forbidden.intersection(cols)
    assert data['appointments'].missed.nunique()==2

@pytest.mark.parametrize('route,body',[
 ('rank-gaps',{'gaps':[{'id':'a','days_overdue':9,'clinician_priority':True},{'id':'b','days_overdue':2}]}),
 ('rank-facilities',{'candidates':[{'id':'a','distance_km':3,'offers_service':True},{'id':'b','distance_km':1,'offers_service':False}]}),
 ('best-send-time',{}),('support-suggestions',{})])
def test_schema_and_missing_model_fallback(route,body,monkeypatch,tmp_path):
    monkeypatch.setattr(main,'MODELS',tmp_path);monkeypatch.setenv('ML_ENABLED','true')
    r=client.post('/'+route,json={'patient_id':'own','consent':{'personalization':True,'location':True,'reminders':True},'features':{'age':26},**body});assert r.status_code==200,r.text
    d=r.json();assert d['source']=='rules'
    for x in d.get('items',d.get('actions',[d])):assert x['reason']
    assert 'probability' not in r.text and 'risk_score' not in r.text
    if route=='rank-facilities':assert [x['id'] for x in d['items']]==['a']

def test_no_consent_never_calls_predict(monkeypatch):
    def forbidden(*args):raise AssertionError('Prediction before consent')
    monkeypatch.setattr(main,'predict',forbidden)
    for route,body in [('rank-gaps',{'gaps':[{'id':'a','days_overdue':3}]}),('rank-facilities',{'candidates':[]}),('best-send-time',{}),('support-suggestions',{})]:
        r=client.post('/'+route,json={'patient_id':'own',**body});assert r.status_code==200 and r.json()['source']=='rules'

def test_invalid_and_duplicate_inputs():
    assert client.post('/rank-gaps',json={'patient_id':'p','gaps':[{'id':'a','days_overdue':-1}]}).status_code==422
    assert client.post('/rank-gaps',json={'patient_id':'p','gaps':[{'id':'a','days_overdue':1}]*2}).status_code==422
    assert client.post('/support-suggestions',json={'patient_id':'p','features':{'diagnosis':'x'}}).status_code==422

def test_models_and_reports_are_real_when_available():
    registry=ROOT/'models/model_registry.json'
    if not registry.exists():pytest.skip('Training has not completed')
    r=client.get('/model-info');assert len(r.json()['models'])==4
    for name,entry in r.json()['models'].items():assert hashlib.sha256((ROOT/'models'/f'{name}.joblib').read_bytes()).hexdigest()==entry['sha256']
    report=json.loads((ROOT/'reports/metrics.json').read_text());assert len(report['runs'])==5;assert report['leakage_audit']['patient_disjoint'];assert not report['leakage_audit']['suspected_above_095']
    r=client.post('/rank-gaps',json={'patient_id':'own','consent':{'personalization':True},'gaps':[{'id':'a','days_overdue':9},{'id':'b','days_overdue':1,'clinician_priority':True}]});assert r.json()['source']=='ml';assert r.json()['items'][0]['id']=='b'

def test_missing_location_never_fabricates_a_distance(monkeypatch,tmp_path):
    monkeypatch.setattr(main,'MODELS',tmp_path)
    r=client.post('/rank-facilities',json={'patient_id':'p','consent':{'personalization':True,'location':True},'candidates':[{'id':'unknown','offers_service':True}]})
    assert r.status_code==200
    assert 'distance not recorded' in r.json()['items'][0]['reason']

def test_ranker_metrics_exclude_single_candidate_queries():
    from training.evaluate import ranking
    d=pd.DataFrame({'query_id':['one','two','two'],'label':[1,1,0],'score':[.2,.9,.1],'eligible':[1,1,1]})
    out=ranking(d,'score',5)
    assert out['single_candidate_queries_excluded']==1
    assert out['evaluated_queries']==1
    assert out['ndcg@5']==1

def test_corrupt_artifact_falls_back(monkeypatch,tmp_path):
    monkeypatch.setattr(main,'MODELS',tmp_path)
    (tmp_path/'model_registry.json').write_text(json.dumps({'gaps':{'sha256':'bad'}}))
    (tmp_path/'gaps.joblib').write_bytes(b'not a trusted model')
    r=client.post('/rank-gaps',json={'patient_id':'p','consent':{'personalization':True},'gaps':[{'id':'one','days_overdue':2}]})
    assert r.json()['source']=='rules'

def test_simulation_respects_outcome_window_and_postpregnancy_context(data):
    from data.synthetic_generator import END
    g=data['gaps'];assert (pd.to_datetime(g.timestamp)<=END-pd.Timedelta(days=7)).all()
    post=g[g.stage==4];assert len(post)>0;assert (post.week==0).all()


def test_engineered_inputs_are_serving_safe_and_channel_categorical():
    from training.estimators import enrich, logistic_candidate
    x=pd.DataFrame({k:[0.,1.,2.,3.] for k in FEATURES['reminders']})
    x['preferred_channel']=[0,1,2,3];x['channel']=[0,0,2,1]
    x['hour']=[9,13,18,20];x['distance_km']=[2,100,12,20]
    out=enrich(x)
    assert out.channel_match.tolist()==[1,0,1,0]
    assert out.evening.tolist()==[0,0,1,1]
    assert out.distance_km.max()==60
    assert 'channel' not in out and 'preferred_channel' not in out
    assert 'channel_match' not in x
    model=logistic_candidate(.1).fit(x,[0,1,0,1])
    import joblib,io
    stream=io.BytesIO();joblib.dump(model,stream);stream.seek(0)
    np.testing.assert_allclose(model.predict_proba(x),joblib.load(stream).predict_proba(x))
    assert len(model.feature_importances_)==len(out.columns)


def test_predictability_diagnostics_never_change_labels_or_enter_features(data):
    observed,_=generate(42,limit=80,diagnostics=True)
    for name,frame in observed.items():
        ordinary=frame.drop(columns=['diagnostic_oracle_probability'],errors='ignore')
        pd.testing.assert_frame_equal(data[name],ordinary)
    for cols in FEATURES.values():assert not any('oracle' in c or 'diagnostic' in c for c in cols)
    for name in ['appointments','reminders']:
        assert observed[name].diagnostic_oracle_probability.between(.18,.82).all()


def test_streamlined_diagnostics_preserve_factual_classification_rows():
    full,_=generate(42,limit=20,diagnostics=True)
    lean,_=generate(42,limit=20,diagnostics=True,diagnostics_only=True)
    for name in ['patients','appointments','reminders']:
        pd.testing.assert_frame_equal(full[name],lean[name])
