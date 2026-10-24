"""Deployment screening is separate from model tuning; missing evidence fails closed."""
import json,hashlib,math
from pathlib import Path
from training.common import ROOT


def support_gate(models=None,report=None,policy=None):
    models=Path(models) if models is not None else ROOT/'models'
    try:
        policy=policy if policy is not None else json.loads((ROOT/'support_release_policy.json').read_text())
        registry=json.loads((models/'model_registry.json').read_text())
        entry=registry['barrier'];file=models/'barrier.joblib'
        if hashlib.sha256(file.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('artifact checksum mismatch')
        report=report if report is not None else json.loads((ROOT/'reports/metrics.json').read_text())
        if entry['metrics']!=report['summary']['barrier']:raise ValueError('evaluation does not match registry metrics')
        if report['data_label']!='synthetic':raise ValueError('unexpected data provenance')
        audit=report['leakage_audit']
        if not audit['patient_disjoint'] or audit['suspected_above_095']:raise ValueError('split or leakage audit failed')
        runs=report['runs'];reasons=[]
        if len(runs)!=policy['required_runs'] or len({r['seed'] for r in runs})!=len(runs):reasons.append('Five distinct evaluation runs are required.')
        for run in runs:
            r=run['results']['barrier'];m=r['model'];b=r['baseline']
            if m.get('threshold')!=.5:reasons.append('Evaluation and serving decision thresholds do not match.')
            if run['split_audit']['patient_overlap']!=0:reasons.append('Patient overlap was detected.')
            if r['positive_count']<policy['minimum_test_positives_per_run']:reasons.append('Too few missed-visit outcomes in an evaluation run.')
            for metric in ['precision','recall','roc_auc']:
                value=m[metric]
                if not math.isfinite(value) or value<policy[f'minimum_{metric}_per_run']:reasons.append(f'At least one run does not meet the {metric} requirement.')
            if policy['require_brier_better_than_baseline_every_run'] and not m['brier_score']<b['brier_score']:reasons.append('Calibration does not consistently beat the simple baseline.')
        delta=report['summary']['barrier']['accuracy']['improvement']
        lower=delta['mean']-policy['confidence_standard_error_multiplier']*delta['std']/math.sqrt(delta['runs'])
        if policy['require_paired_accuracy_lower_bound_above_zero'] and not lower>0:reasons.append('Accuracy gain is not stable across runs.')
        return {'policy_version':policy['version'],'prediction_enabled':not reasons,'reasons':list(dict.fromkeys(reasons)) or ['All prototype engineering gates passed; real-world validation is still required.'],'data_label':'synthetic','mode':'ml' if not reasons else 'rules','artifact_sha256':entry['sha256']}
    except (OSError,ValueError,KeyError,TypeError,ZeroDivisionError):
        return {'policy_version':'support-release-v1','prediction_enabled':False,'reasons':['Matching model evaluation and release evidence are unavailable.'],'data_label':'synthetic','mode':'rules'}


def main():
    decision=support_gate();(ROOT/'reports/reliability.json').write_text(json.dumps(decision,indent=2));print(json.dumps(decision,indent=2))

if __name__=='__main__':main()
