"""Measure simulation predictability. Oracle values are diagnostic-only, never training inputs."""
import json,gc
import numpy as np
from data.synthetic_generator import generate,split_rows
from training.common import ROOT,FEATURES


def main():
    checkpoint=ROOT/"reports/predictability-checkpoint.json"
    results=json.loads(checkpoint.read_text()) if checkpoint.exists() else []
    # Fixed diagnostic seeds; do not choose a deployment/model based on these outcomes.
    for seed in [242,243,244,245,246]:
        if any(r["seed"]==seed for r in results):continue
        tables,manifest=generate(seed,diagnostics=True,diagnostics_only=True)
        run={'seed':seed,'models':{}}
        for name,table in [('barrier','appointments'),('reminders','reminders')]:
            assert not any('oracle' in c or 'diagnostic' in c for c in FEATURES[name])
            d=split_rows(tables[table])['test'];p=d.diagnostic_oracle_probability.to_numpy()
            run['models'][name]={'rows':len(d),'expected_accuracy_with_hidden_simulator_information':float(np.maximum(p,1-p).mean()),'minimum_expected_error_with_hidden_information':float(np.minimum(p,1-p).mean())}
        results.append(run)
        checkpoint.write_text(json.dumps(results,indent=2))
        del tables,d,p
        gc.collect()
        print('diagnostic seed',seed,run['models'],flush=True)
    summary={}
    for name in ['barrier','reminders']:
        a=[r['models'][name]['expected_accuracy_with_hidden_simulator_information'] for r in results]
        summary[name]={'optimistic_expected_accuracy_mean':float(np.mean(a)),'std':float(np.std(a,ddof=1))}
    report={'data_label':'synthetic','summary':summary,'runs':results,'interpretation':'Optimistic expected Bayes accuracy using hidden latent noise and generating probabilities. A deployable model has less information and cannot be expected to achieve this bound. This is an expectation under the unchanged simulator, not a hard finite-test accuracy cap or a deployable prediction.','generator_changes':'Only optional diagnostics were added; generating probabilities, outcomes, RNG calls and 18% independent label flips unchanged.','oracle_used_in_training':False,'recommendations':['Retain weak support predictions as experimental; do not show patient scores.','Build additional predictors only from consented pre-appointment attendance and reminder-response history.','Audit original attended/missed outcomes separately; booked, cancelled and rescheduled appointments are not observed missed-visit labels.','Use precision, recall, calibration and rule-baseline comparisons alongside accuracy.','Do not reduce label noise or choose test seeds merely to publish larger metrics.']}
    (ROOT/'reports/predictability.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
