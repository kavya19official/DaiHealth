"""All reports are calculated from held-out prediction files, never hand-entered."""
import json
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score,precision_score,recall_score,f1_score,roc_auc_score,average_precision_score,confusion_matrix,brier_score_loss,ndcg_score
from training.common import ROOT

def classification(y,p,threshold=.5):
    pred=np.asarray(p)>=threshold
    return {'accuracy':accuracy_score(y,pred),'precision':precision_score(y,pred,zero_division=0),'recall':recall_score(y,pred,zero_division=0),'f1':f1_score(y,pred,zero_division=0),'roc_auc':roc_auc_score(y,p),'pr_auc':average_precision_score(y,p),'brier_score':brier_score_loss(y,p),'confusion_matrix':confusion_matrix(y,pred,labels=[0,1]).tolist(),'threshold':threshold}

def ranking(frame,score,k):
    vals=[];empty=0;singletons=0
    if 'eligible' in frame: frame=frame[frame.eligible==1]
    for _,g in frame.groupby('query_id',sort=False):
        y=g.label.to_numpy();s=g[score].to_numpy()
        if not y.max():empty+=1;continue
        if len(y)<2:singletons+=1;continue
        order=np.argsort(-s,kind='stable');first=np.flatnonzero(y[order]>0)
        vals.append([ndcg_score([y],[s],k=k),1/(first[0]+1) if len(first) else 0,float(y[order[0]]==y.max())])
    a=np.array(vals)
    return {f'ndcg@{k}':float(a[:,0].mean()),'mrr':float(a[:,1].mean()),'top1_accuracy':float(a[:,2].mean()),'evaluated_queries':len(vals),'no_relevant_queries_excluded':empty,'single_candidate_queries_excluded':singletons}

def snips(frame,column):
    match=frame.logged_action==frame[column];w=match.astype(float)/frame.propensity
    return {'completion_rate':float((w*frame.label).sum()/w.sum()) if w.sum() else None,'matched_actions':int(match.sum()),'effective_sample_size':float(w.sum()**2/(w*w).sum()) if w.sum() else 0}

def evaluate_run(folder):
    folder=ROOT/'reports'/folder
    output={}
    for name in ['barrier','reminders','gaps','facilities']:
        d=pd.read_csv(folder/(name+'.csv'))
        if name in ['barrier','reminders']:
            output[name]={'model':classification(d.label,d.ml),'baseline':classification(d.label,d.baseline),'test_rows':len(d),'positive_count':int(d.label.sum()),'positive_fraction':float(d.label.mean()),'patients':d.patient_id.nunique()}
            if name=='barrier':output[name]['logistic_regression']=classification(d.label,d.logistic)
            else:
                policies={k:snips(d,k) for k in ['policy','fixed','random','app_only','random_time_app']};model=policies['policy']['completion_rate'];base=policies['fixed']['completion_rate']
                output[name]['offline_policy_estimate']={**policies,'absolute_lift':model-base if model is not None and base is not None else None,'relative_lift':model/base-1 if model is not None and base else None,'method':'Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial.'}
        else:output[name]={'model':ranking(d,'ml',3 if name=='gaps' else 5),'baseline':ranking(d,'baseline',3 if name=='gaps' else 5),'guarded_baseline':ranking(d,'guarded_baseline',3 if name=='gaps' else 5),'test_rows':len(d),'eligible_test_rows':int(d.eligible.sum()) if 'eligible' in d else len(d),'patients':d.patient_id.nunique(),'positive_count':int((d.label>0).sum())}
    return output

def aggregate(values):
    return {'mean':float(np.mean(values)),'std':float(np.std(values,ddof=1)),'runs':len(values)}

def write_reports():
    runs=[]
    for seed in [142,143,144,145,146]:
        folder=ROOT/'reports'/f'seed-{seed}'
        if not (folder/'metadata.json').exists():raise FileNotFoundError('Train all five seeds first')
        meta=json.loads((folder/'metadata.json').read_text());results=evaluate_run(f'seed-{seed}');runs.append({'seed':seed,**meta,'results':results})
    summary={}
    for name in ['barrier','reminders','gaps','facilities']:
        keys=['accuracy','precision','recall','f1','roc_auc','pr_auc','brier_score'] if name in ['barrier','reminders'] else [f'ndcg@{3 if name=="gaps" else 5}','mrr','top1_accuracy']
        summary[name]={}
        for key in keys:
            model=[r['results'][name]['model'][key] for r in runs];base=[r['results'][name]['baseline'][key] for r in runs]
            summary[name][key]={'baseline':aggregate(base),'model':aggregate(model),'improvement':aggregate([m-b if key!='brier_score' else b-m for m,b in zip(model,base)])}
            if name=='barrier':
                logistic=[r['results'][name]['logistic_regression'][key] for r in runs]
                summary[name][key]['logistic_regression']=aggregate(logistic)
                summary[name][key]['improvement_over_logistic']=aggregate([m-l if key!='brier_score' else l-m for m,l in zip(model,logistic)])
        if name=='reminders':
            estimates=[r['results'][name]['offline_policy_estimate'] for r in runs]
            summary[name]['offline_completion_rate']={'baseline':aggregate([x['fixed']['completion_rate'] for x in estimates]),'model':aggregate([x['policy']['completion_rate'] for x in estimates]),'random':aggregate([x['random']['completion_rate'] for x in estimates]),'improvement':aggregate([x['absolute_lift'] for x in estimates]),'relative_lift':aggregate([x['relative_lift'] for x in estimates])}
    estimates=[r['results']['reminders']['offline_policy_estimate'] for r in runs]
    summary['reminders']['offline_app_completion_rate']={'baseline':aggregate([x['fixed']['completion_rate'] for x in estimates]),'model':aggregate([x['app_only']['completion_rate'] for x in estimates]),'random_time_app':aggregate([x['random_time_app']['completion_rate'] for x in estimates]),'improvement':aggregate([x['app_only']['completion_rate']-x['fixed']['completion_rate'] for x in estimates])}
    suspects=[]
    for r in runs:
        for name,result in r['results'].items():
            for family in ['model','baseline','logistic_regression']:
                for key in ['accuracy','roc_auc','top1_accuracy']:
                    if result.get(family,{}).get(key,0)>.95:suspects.append({'seed':r['seed'],'model':name,'family':family,'metric':key,'value':result[family][key]})
    report={'experiment_revision':2,'comparison_note':'Fixed fresh synthetic seeds 142–146; same source cohort, unchanged target generator. Prior v1 metrics use different simulated test runs, so cross-revision changes are not paired treatment effects.','data_label':'synthetic','statement':'Metrics are measured on synthetic data and are not real-world performance.','seeds':[142,143,144,145,146],'standard_deviation':'sample (ddof=1); paired differences for improvement','summary':summary,'runs':runs,'leakage_audit':{'suspected_above_095':suspects,'patient_disjoint':all(r['split_audit']['patient_overlap']==0 for r in runs),'feature_allowlist':True,'excluded':['patient_id','cohort','timestamp','source_status','missed','opened','action_completed','closed_7d','chosen','completed','relevance','source_gap_id'],'notes':['Time/patient cohorts discard crossing cells instead of random row splitting.','Reminder opened/action-completed labels and choice outcomes never enter predictors.','Only pre-event missed counts are used. Eighteen percent independent target-flip noise plus latent access preferences.','Gap and facility policy constraints are applied equally in held-out scoring and serving.']}}
    if suspects:raise RuntimeError('Suspected leakage; inspect metrics before publication: '+str(suspects))
    (ROOT/'reports/metrics.json').write_text(json.dumps(report,indent=2,allow_nan=False))
    registry_path=ROOT/'models/model_registry.json'
    if registry_path.exists():
        registry=json.loads(registry_path.read_text())
        for name in registry:registry[name]['metrics']=summary[name]
        registry_path.write_text(json.dumps(registry,indent=2))
    lines=['# Measured patient assistance evaluation','',report['statement'],'','All results below are computed from saved held-out predictions. Standard deviations use ddof=1.','', '| Model | Metric | Baseline mean ± std | Model mean ± std | Paired improvement mean ± std |','|---|---|---|---|---|']
    def cell(x):return str(x["mean"])+" ± "+str(x["std"])
    for name,metrics in summary.items():
        for key,v in metrics.items():lines.append(f"| {name} | {key} | {cell(v['baseline'])} | {cell(v['model'])} | {cell(v['improvement'])} |")
    lines+=['','## Test counts, class balance, diagnostics','']
    for r in runs:
        lines+=['### Seed '+str(r['seed']),'```json',json.dumps({'split_audit':r['split_audit'],'counts_and_results':r['results'],'feature_importance':r['feature_importance'],'selected_parameters':r['selected_parameters']},indent=2),'```']
    lines+=['','## Limitations','Reminder policy lift is a noisy, self-normalized off-policy estimate from a synthetic randomized log. It is not measured intervention lift or real-world accuracy. No SMS/WhatsApp/voice transport is connected. Source episode data are preserved; interaction outcomes are simulated. Successful closure is an access target, not clinical urgency. ML never adds gaps or overrides clinician priority.']
    (ROOT/'reports/metrics.md').write_text('\n'.join(lines));print(json.dumps(summary,indent=2))
    from training.reliability import main as write_release_report
    write_release_report()
    return report
if __name__=='__main__':write_reports()
