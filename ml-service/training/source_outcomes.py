"""Separate original-outcome experiment; never replaces serving models automatically."""
import hashlib,json,sqlite3,joblib
from pathlib import Path
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import balanced_accuracy_score,average_precision_score
from data.synthetic_generator import DEFAULT_SOURCE,END,START,VAL_START,TEST_START
from training.common import ROOT
from training.evaluate import classification,aggregate

FEATURES=['age','distance_km','digital_literacy','literacy_level','income_band','caregiver_support','week','weekday','scheduled_hour']


def load_source(source=DEFAULT_SOURCE):
    with sqlite3.connect(f'file:{source}?mode=ro',uri=True) as c:
        frame=pd.read_sql_query('''SELECT a.appointment_id,a.mother_id AS patient_id,a.appointment_date AS timestamp,a.start_time,a.status,m.age,m.distance_km,m.digital_literacy,m.literacy_level,m.income_band,CASE WHEN m.caregiver_contact IS NOT NULL AND m.caregiver_contact<>'' THEN 1 ELSE 0 END AS caregiver_support,p.lmp
          FROM appointments a JOIN mothers m ON m.mother_id=a.mother_id JOIN pregnancies p ON p.pregnancy_id=a.pregnancy_id
          WHERE a.child_id IS NULL AND a.status IN ('attended','missed') ORDER BY a.appointment_date,a.appointment_id''',c)
    dates=pd.to_datetime(frame.timestamp);frame=frame[(dates>=START)&(dates<=END)].copy();dates=pd.to_datetime(frame.timestamp)
    frame['week']=((dates-pd.to_datetime(frame.lmp)).dt.days//7).clip(0,42)
    frame['weekday']=dates.dt.dayofweek;frame['scheduled_hour']=frame.start_time.str[:2].astype(int)
    for column in ['digital_literacy','literacy_level','income_band']:
        frame[column]=frame[column].map({'low':0,'medium':1,'middle':1,'high':2})
    frame['label']=(frame.status=='missed').astype(int)
    assert frame[FEATURES].notna().all().all()
    return frame


def partition(frame,seed):
    patients=np.random.default_rng(seed).permutation(frame.patient_id.unique());n=len(patients)
    cohorts=[set(patients[:int(.7*n)]),set(patients[int(.7*n):int(.85*n)]),set(patients[int(.85*n):])]
    masks=[frame.timestamp<str(VAL_START.date()),(frame.timestamp>=str(VAL_START.date()))&(frame.timestamp<str(TEST_START.date())),frame.timestamp>=str(TEST_START.date())]
    parts=[frame[frame.patient_id.isin(ids)&mask].copy() for ids,mask in zip(cohorts,masks)]
    assert all(not set(parts[a].patient_id)&set(parts[b].patient_id) for a,b in [(0,1),(0,2),(1,2)])
    return parts


def main():
    frame=load_source();runs=[];folder=ROOT/'reports/source-outcomes';folder.mkdir(exist_ok=True)
    for seed in [242,243,244,245,246]:
        train,val,test=partition(frame,seed);candidates=[]
        for c in [.01,.1,1]:candidates.append((f'logistic-C{c}',make_pipeline(StandardScaler(),LogisticRegression(C=c,max_iter=1000))))
        for leaves in [3,7,15]:candidates.append((f'lightgbm-{leaves}',LGBMClassifier(n_estimators=120,num_leaves=leaves,min_child_samples=40,reg_lambda=15,learning_rate=.03,random_state=seed,n_jobs=2,verbosity=-1)))
        best=None;trials=[]
        # Validation AP selects the ranking model. Threshold selects balanced accuracy,
        # to avoid optimizing the trivial "everyone attends" majority decision.
        for name,model in candidates:
            model.fit(train[FEATURES],train.label);p=model.predict_proba(val[FEATURES])[:,1]
            quality=average_precision_score(val.label,p);trials.append({'model':name,'validation_pr_auc':float(quality)})
            if best is None or quality>best[0]:best=(quality,name,model,p)
        _,name,model,p=best
        thresholds=np.unique(np.r_[.5,np.quantile(p,np.linspace(.05,.95,19))])
        threshold=max(thresholds,key=lambda t:(balanced_accuracy_score(val.label,p>=t),-abs(t-.5)))
        predictions=model.predict_proba(test[FEATURES])[:,1];base=np.full(len(test),train.label.mean())
        metrics=classification(test.label,predictions,float(threshold));metrics['balanced_accuracy']=balanced_accuracy_score(test.label,predictions>=threshold)
        baseline=classification(test.label,base);baseline['balanced_accuracy']=balanced_accuracy_score(test.label,base>=.5)
        if seed==242:
            artifacts=ROOT/'models/experiments';artifacts.mkdir(exist_ok=True)
            joblib.dump({'model':model,'features':FEATURES,'threshold':float(threshold),'seed':seed,'data_label':'synthetic','target':'original attended versus missed','deployment_status':'experimental-not-served'},artifacts/'source_barrier_seed242.joblib')
        output=test[['appointment_id','patient_id','timestamp','label']].copy();output['prediction']=predictions;output['threshold']=threshold;output.to_csv(folder/f'seed-{seed}.csv',index=False)
        importance=np.abs(model[-1].coef_[0]) if hasattr(model,'steps') else model.feature_importances_
        importance=importance/(importance.sum() or 1)
        run={'importance_method':'absolute standardized coefficient' if hasattr(model,'steps') else 'split count','feature_importance':dict(zip(FEATURES,map(float,importance))),'seed':seed,'counts':{k:{'rows':len(v),'missed':int(v.label.sum()),'patients':int(v.patient_id.nunique())} for k,v in zip(['train','validation','test'],[train,val,test])},'patient_overlap':0,'selected_model':name,'threshold':float(threshold),'validation_trials':trials,'model':metrics,'fixed_05_model':classification(test.label,predictions),'baseline':baseline}
        runs.append(run);print(seed,name,metrics['roc_auc'],metrics['recall'],metrics['accuracy'],flush=True)
    summary={}
    for metric in ['accuracy','precision','recall','f1','roc_auc','pr_auc','brier_score','balanced_accuracy']:
        m=[r['model'][metric] for r in runs];b=[r['baseline'][metric] for r in runs]
        summary[metric]={'model':aggregate(m),'baseline':aggregate(b),'improvement':aggregate([y-x if metric=='brier_score' else x-y for x,y in zip(m,b)])}
    suspects=[{'seed':r['seed'],'family':family,'accuracy':r[family]['accuracy']} for r in runs for family in ['model','fixed_05_model','baseline'] if r[family]['accuracy']>.95]
    report={'leakage_audit':{'patient_overlap':0,'features_allowlisted':True,'accuracy_above_095':suspects,'investigation':'Missed outcomes are rare. Majority and 0.5-threshold models can exceed 95% by predicting attendance. This is class imbalance, not evidence of useful missed-visit detection. No status, dropout_probability, outcome labels or identifiers enter predictors.'},'data_label':'synthetic','statement':'Metrics are measured on original synthetic appointment outcomes and are not real-world performance.','source_sha256':hashlib.sha256(DEFAULT_SOURCE.read_bytes()).hexdigest(),'target':'Original attended versus missed maternal appointments; no replacement labels. Booked/cancelled/rescheduled excluded.','features':FEATURES,'excluded_features':['dropout_probability','current_stage','outcome','outcome_date','conditions','confirmed_high_risk','identifiers','status','future attendance'],'split':'70/15/15 disjoint patients, train first16 months, validation next4, test last4; wrong time/cohort cells discarded.','selection':'Validation average precision; threshold by validation balanced accuracy, never test tuned.','summary':summary,'runs':runs,'deployed':False,'limitations':['One observed appointment per mother in this source; longitudinal response history unavailable.','Rare missed outcomes produce small validation/test positive counts and unstable estimates.','Different outcome target and sample from the simulated interaction experiments; do not compare accuracies directly.','High majority accuracy reflects class imbalance, not evidence of a useful model. Any accuracy above .95 must be inspected against class balance.','Richer features in this experiment are not yet a serving contract; no automatic promotion.']}
    (ROOT/'reports/source-outcomes.json').write_text(json.dumps(report,indent=2))
    lines=['# Original appointment outcome experiment','',report['statement'],'',report['target'],'','No deployment change. Different target from interaction simulator; accuracy is not directly comparable.','', '| Metric | Majority baseline mean ± std | Model mean ± std |','|---|---|---|']
    for k,v in summary.items():lines.append(f"| {k} | {v['baseline']['mean']} ± {v['baseline']['std']} | {v['model']['mean']} ± {v['model']['std']} |")
    lines+=['','## Limitations','']+report['limitations']+['','## Counts and model selection','```json',json.dumps(runs,indent=2),'```']
    (ROOT/'reports/source-outcomes.md').write_text('\n'.join(lines));print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
