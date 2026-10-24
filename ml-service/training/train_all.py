import argparse,json,hashlib,sys
from datetime import datetime,timezone
from pathlib import Path
import numpy as np,pandas as pd,joblib
from lightgbm import LGBMClassifier,LGBMRanker
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import log_loss,ndcg_score
from training.common import ROOT,FEATURES,TARGETS,TABLES
from training.evaluate import write_reports
from training.estimators import AssistanceEstimator,logistic_candidate
from data.synthetic_generator import generate,split_rows,CHANNELS,HOURS

def features(df,name):return df[FEATURES[name]].astype(float)
def scores(model,df,name):return model.predict_proba(features(df,name))[:,1] if name in ['barrier','reminders'] else model.predict(features(df,name))
def policy_constraint(df,pred,name):
    # Access utility never moves a non-urgent gap above an overdue/clinician-prioritized one.
    if name=='gaps':return ((df.days_overdue.to_numpy()>0)*4+df.clinician_priority.to_numpy()*2)+np.asarray(pred).clip(-20,20)/100
    if name=='facilities':return df.offers_service.to_numpy()*4+np.asarray(pred).clip(-20,20)/100
    return pred

def policy_scores(model,df,app_only=False):
    out=[]
    for hour in HOURS:
        for channel in range(4):
            d=df.copy();d['hour']=hour;d['channel']=channel;out.append(scores(model,d,'reminders'))
    values=np.stack(out,axis=1)
    if app_only: values[:,[i for i in range(16) if i%4]]= -np.inf
    return np.argmax(values,axis=1)

def run(seed,source=None):
    tables,manifest=generate(seed,**({'source':source} if source else {}));folder=ROOT/'reports'/f'seed-{seed}';folder.mkdir(parents=True,exist_ok=True)
    splitsets={k:split_rows(v) for k,v in tables.items() if k!='patients'}
    sample=splitsets['appointments'];sets={k:set(v.patient_id) for k,v in sample.items()};overlap=sum(len(sets[a]&sets[b]) for a,b in [('train','validation'),('train','test'),('validation','test')]);assert overlap==0
    meta={'source':manifest,'split_audit':{'patient_overlap':overlap,'patient_counts':{k:len(v) for k,v in sets.items()},'time_ranges':{k:{'min':str(v.timestamp.min()),'max':str(v.timestamp.max())} for k,v in sample.items()}},'feature_importance':{},'selected_parameters':{}}
    registry={}
    for name,table in TABLES.items():
        parts=splitsets[table];train,val,test=[parts[k].sort_values(['query_id'] if name in ['gaps','facilities'] else ['timestamp','patient_id'],kind='stable') for k in ['train','validation','test']]
        target=TARGETS[name];best=None;best_quality=-float('inf')
        candidates=[]
        for leaves,trees,rate,regularization,engineered in [(7,65,.06,5,False),(7,160,.025,20,True),(15,120,.035,30,True),(4,180,.025,15,True)]:
            kw=dict(n_estimators=trees,num_leaves=leaves,learning_rate=rate,min_child_samples=100,reg_lambda=regularization,random_state=seed,n_jobs=2,verbosity=-1,importance_type='gain',deterministic=True,force_col_wise=True)
            estimator=LGBMRanker(objective='lambdarank',**kw) if name in ['gaps','facilities'] else LGBMClassifier(**kw)
            candidates.append((f'lightgbm-leaves{leaves}-trees{trees}-engineered{engineered}',AssistanceEstimator(estimator,engineered)))
        if name in ['barrier','reminders']:
            candidates.extend((f'logistic-C{c}',logistic_candidate(c)) for c in [.01,.1,1])
        trials=[];selected_name=None
        for candidate_name,model in candidates:
            fit={'group':train.groupby('query_id',sort=False).size().to_numpy()} if name in ['gaps','facilities'] else {}
            model.fit(features(train,name),train[target],**fit)
            pred=scores(model,val,name)
            if name in ['barrier','reminders']:quality=-log_loss(val[target],pred)
            else:
                evaluated=[];p=policy_constraint(val,pred,name)
                for ix in val.groupby('query_id',sort=False).indices.values():
                    y=val.iloc[ix][target].to_numpy();v=p[ix]
                    if name=='facilities':
                        eligible=val.iloc[ix].offers_service.to_numpy()==1;y=y[eligible];v=v[eligible]
                    if len(y)>1 and y.max():evaluated.append(ndcg_score([y],[v],k=3 if name=='gaps' else 5))
                quality=float(np.mean(evaluated))
            trials.append({'candidate':candidate_name,'validation_objective':quality})
            if quality>best_quality:best_quality=quality;best=model;selected_name=candidate_name
        pred=scores(best,test,name)
        output=test[['patient_id','timestamp']+(['query_id'] if name in ['gaps','facilities'] else [])].copy();output['label']=test[target].to_numpy()
        if name in ['barrier','reminders']:
            prior=float(train[target].mean());output['ml']=pred;output['baseline']=prior
            if name=='barrier':
                logistic=make_pipeline(StandardScaler(),LogisticRegression(max_iter=500,random_state=seed));logistic.fit(features(train,name),train[target]);output['logistic']=logistic.predict_proba(features(test,name))[:,1]
            else:
                output['logged_action']=[HOURS.index(int(h))*4+int(c) for h,c in zip(test.hour,test.channel)];output['propensity']=test.propensity.to_numpy();output['policy']=policy_scores(best,test);output['app_only']=policy_scores(best,test,app_only=True);output['fixed']=0;output['random']=np.random.default_rng(seed+1000).integers(0,16,len(test));output['random_time_app']=(output['random']//4)*4
        else:
            output['ml']=policy_constraint(test,pred,name)
            if name=='facilities':output['eligible']=test.offers_service.to_numpy()
            # Documented rule baseline + the same hard eligibility/priority gate.
            baseline=test.days_overdue.to_numpy()/100 if name=='gaps' else -test.distance_km.to_numpy()/1000
            gates=(test.days_overdue.to_numpy()>0)*4+test.clinician_priority.to_numpy()*2 if name=='gaps' else test.offers_service.to_numpy()*4
            output['baseline']=test.days_overdue.to_numpy() if name=='gaps' else -test.distance_km.to_numpy()
            output['guarded_baseline']=gates+baseline
        output.to_csv(folder/(name+'.csv'),index=False)
        weights=best.feature_importances_;total=weights.sum() or 1
        meta['feature_importance'][name]=sorted([{'feature':f,'gain_share':float(w/total)} for f,w in zip(best.feature_names_,weights)],key=lambda x:-x['gain_share'])
        meta['selected_parameters'][name]={'selected_model':selected_name,'validation_candidates':trials,'validation_objective':best_quality,'threshold':.5 if name in ['barrier','reminders'] else None}
        if seed==142:
            file=ROOT/'models'/(name+'.joblib');joblib.dump({'model':best,'features':FEATURES[name],'seed':seed},file)
            registry[name]={'name':name,'selected_model':selected_name,'version':'patient-assistance-v2-seed142','trained_at':datetime.now(timezone.utc).isoformat(),'data_label':'synthetic','sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'features':FEATURES[name]}
        print(f'seed={seed} model={name} train={len(train)} validation={len(val)} test={len(test)}',flush=True)
    (folder/'metadata.json').write_text(json.dumps(meta,indent=2))
    return registry

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path);a=p.parse_args();(ROOT/'models').mkdir(exist_ok=True);(ROOT/'reports').mkdir(exist_ok=True)
    registry={}
    for seed in [142,143,144,145,146]:registry.update(run(seed,a.source))
    report=write_reports()
    for name in registry:registry[name]['metrics']=report['summary'][name]
    (ROOT/'models/model_registry.json').write_text(json.dumps(registry,indent=2));from training.reliability import main as write_release_report;write_release_report();print('Saved measured reports and seed-142 serving artifacts.')
if __name__=='__main__':main()
