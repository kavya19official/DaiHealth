import json
import numpy as np
from data.synthetic_generator import START,END,VAL_START,TEST_START
from training.common import ROOT
from training.source_outcomes import FEATURES,load_source,partition


def test_original_outcome_experiment_excludes_unobserved_and_leaking_fields():
    data=load_source()
    assert set(data.status)=={'attended','missed'}
    assert data.timestamp.min()>=str(START.date()) and data.timestamp.max()<=str(END.date())
    assert not {'dropout_probability','label','status','patient_id','outcome','current_stage'}.intersection(FEATURES)
    assert (data.label==(data.status=='missed').astype(int)).all()
    assert data.appointment_id.is_unique


def test_source_experiment_split_is_temporal_grouped_reproducible():
    data=load_source()
    a=partition(data,242);b=partition(data,242)
    for left,right in zip(a,b):assert left.appointment_id.tolist()==right.appointment_id.tolist()
    assert a[0].timestamp.max()<str(VAL_START.date())
    assert a[1].timestamp.min()>=str(VAL_START.date()) and a[1].timestamp.max()<str(TEST_START.date())
    assert a[2].timestamp.min()>=str(TEST_START.date())
    for i,j in [(0,1),(0,2),(1,2)]:assert not set(a[i].patient_id)&set(a[j].patient_id)


def test_source_experiment_does_not_replace_serving_models():
    report=json.loads((ROOT/'reports/source-outcomes.json').read_text())
    assert len(report['runs'])==5 and report['deployed'] is False
    for run in report['runs']:
        assert run['patient_overlap']==0
        assert run['counts']['validation']['missed']>0 and run['counts']['test']['missed']>0
        assert sum(run['feature_importance'].values())>0.99
    import joblib
    artifact=joblib.load(ROOT/'models/experiments/source_barrier_seed242.joblib')
    assert artifact['deployment_status']=='experimental-not-served'
    x=load_source().iloc[:3][artifact['features']]
    assert np.isfinite(artifact['model'].predict_proba(x)).all()
