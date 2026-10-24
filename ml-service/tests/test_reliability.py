import hashlib,json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from api import main
from training.common import ROOT,FEATURES
from training.reliability import support_gate

client=TestClient(main.app)


def test_current_model_is_gated_out_and_never_drives_support(monkeypatch):
    assert support_gate()['prediction_enabled'] is False
    def forbidden(*a):raise AssertionError('Weak prediction must not be called')
    monkeypatch.setattr(main,'predict',forbidden)
    out=client.post('/support-suggestions',json={'patient_id':'self','consent':{'personalization':True,'location':True},'features':{'distance_km':12,'prior_missed_visits':2}}).json()
    assert out['source']=='rules' and out['policy_version']=='support-release-v1'
    assert [a['action'] for a in out['actions']]==['nearby','asha','schemes']
    assert '12 km' in out['actions'][0]['reason'] and 'recorded as missed' in out['actions'][1]['reason']
    assert 'probability' not in json.dumps(out)


def test_unknown_and_unconsented_information_never_creates_personal_claims():
    for body in [
        {'features':{}},
        {'features':{'caregiver_support':0,'distance_km':12},'known_features':[]},
        {'features':{'distance_km':12},'known_features':['distance_km']},
    ]:
        out=client.post('/support-suggestions',json={'patient_id':'self','consent':{'personalization':True},**body}).json()
        assert [a['action'] for a in out['actions']]==['schemes']
    assert client.post('/support-suggestions',json={'patient_id':'p','known_features':['diagnosis']}).status_code==422
    assert client.post('/support-suggestions',json={'patient_id':'p','known_features':['age','age']}).status_code==422


def test_quality_gate_requires_matching_artifacts_and_all_runs(tmp_path):
    report=json.loads((ROOT/'reports/metrics.json').read_text())
    # Deliberately artificial unit-test evidence; never written to measured reports.
    for run in report['runs']:
        m=run['results']['barrier']['model'];m.update(precision=.75,recall=.60,roc_auc=.80,brier_score=.18)
        run['results']['barrier']['baseline']['brier_score']=.25
    report['summary']['barrier']['accuracy']['improvement'].update(mean=.04,std=.005,runs=5)
    file=tmp_path/'barrier.joblib';file.write_bytes(b'unit-test-evidence-only')
    entry={'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'metrics':report['summary']['barrier']}
    (tmp_path/'model_registry.json').write_text(json.dumps({'barrier':entry}))
    assert support_gate(tmp_path,report)['prediction_enabled']
    report['runs'][0]['results']['barrier']['model']['recall']=.1
    assert not support_gate(tmp_path,report)['prediction_enabled']
    report['runs'][0]['results']['barrier']['model']['recall']=.6
    report['runs'][0]['results']['barrier']['model']['threshold']=.2
    assert not support_gate(tmp_path,report)['prediction_enabled']
    file.write_bytes(b'corrupted')
    assert not support_gate(tmp_path,report)['prediction_enabled']


def test_prediction_also_requires_complete_provenance_and_supported_inputs(monkeypatch):
    monkeypatch.setattr(main,'support_gate',lambda *a:{'prediction_enabled':True})
    calls=[]
    monkeypatch.setattr(main,'predict',lambda *a:calls.append(a) or np.array([.9]))
    features={k:0 for k in FEATURES['barrier']};features['age']=26
    body={'patient_id':'p','consent':{'personalization':True,'location':True},'features':features,'known_features':list(features)}
    out=client.post('/support-suggestions',json=body).json();assert out['source']=='ml';assert len(calls)==1
    calls.clear();body['known_features']=[]
    assert client.post('/support-suggestions',json=body).json()['source']=='rules';assert not calls
    body['known_features']=list(features);body['features']['age']=55
    assert client.post('/support-suggestions',json=body).json()['source']=='rules';assert not calls
