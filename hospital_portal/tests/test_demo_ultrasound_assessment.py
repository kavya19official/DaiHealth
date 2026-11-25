from hospital_portal.api.ultrasound_processing import assessment

def live_sample():
    return {'state':'plane_analysis','quality':{'width':800,'height':600,'std':30,'dynamic_range':80,'focus':8},
        'measurements':{'demo':True,'scan_date':'2026-10-01'},'demo_live_inference':True,
        'model_version':'a'*64,'finished_at':'2026-11-25T09:00:00+00:00',
        'planes':[{'view':'whole','state':'classified','label':'abdomen','score':.9}]}

def test_scripted_demo_does_not_expose_invented_plane_scores():
    source=live_sample();source.pop('demo_live_inference')
    result=assessment(source)
    assert result['planes'] is None and result['grade'] is None
    assert result['live_demo_analysis'] is False

def test_actual_demo_inference_retains_demo_provenance_and_exposes_live_plane_quality():
    source=live_sample();result=assessment(source)
    assert result['live_demo_analysis'] is True
    assert result['planes']==source['planes'] and result['grade']=='good'
    assert result['requires_doctor_review'] is True
    assert result['flag']['category']=='review_recommended'
    assert source['measurements']['demo'] is True
    assert not ({'label','probabilities','confidence'} & result.keys())

def test_an_unavailable_model_cannot_masquerade_as_live_demo_analysis():
    source=live_sample();source.update(state='model_unavailable',reasons=['inference_unavailable'])
    result=assessment(source)
    assert not result['live_demo_analysis'] and result['planes'] is None
