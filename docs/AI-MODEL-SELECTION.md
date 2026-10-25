# Rules first; models only for useful ranking

This runtime policy covers patient access assistance and the synthetic Delhi coordination demo. It does not certify other legacy clinical experiments or the speech/chat providers as validated or optimised.

| Task | Runtime mechanism | Why |
| --- | --- | --- |
| Reminder timing | Fixed 9 AM app reminder, adjusted for quiet hours | A schedule needs no prediction. |
| Support suggestions | Recorded facts and explicit consent | No missed-visit prediction is needed to offer help. |
| Service eligibility | Required-service and distance gates | Preferences cannot override suitability gates. |
| Delhi shortlist | Explained availability, distance and preference weights | Five fictional facilities need no trained model. |
| Appointment/referral status | Authorised, versioned state transitions | Workflow automation needs no inference. |
| Timeline follow-up | Due date, named owner, self-report and staff closure | A patient action is not a predicted clinical outcome. |
| Synthetic risk-review demo | Manual review gate, reason, owner and audit events | No model-generated medical risk prediction. Review remains a simulation. |
| Optional access ordering | Existing small tabular rankers, explicitly enabled | Experimental ranking only; hard priorities and eligibility remain rules. |

Default startup makes no patient-assistance model calls and starts no patient ML process. `ML_ENABLED=true` alone is insufficient: optional ranking also requires `PATIENT_ML_RANKING_ENABLED=true` in the launch environment. Patient personalization consent is still required, plus location consent for facility ranking. Missing, corrupt, timed-out or invalid model responses use rule results. The Python service also refuses to load reminder and barrier models, including through direct loopback requests. Existing training artifacts remain for offline evaluation; they are not live reminder/support engines.

The separate ranking switch is for an experiment, not evidence of value. Before enabling a ranker for deployment, compare it with the actual served rule baseline on representative held-out queries. Record NDCG/MRR, eligibility and priority preservation, latency and model size; compare simpler candidates first and retain the smallest candidate that meets the agreed quality target. The current synthetic metrics do not establish real-world benefit or prove that a model is necessary. No new model was trained for this update.

Do not describe reduced inference as measured carbon savings. This update proves zero model requests for simple assistance tasks; it does not measure energy or emissions. Speech generation and chat have separate settings and are outside this policy's enforcement boundary.

## Local checks

From the repository root:

```sh
node --test backend/patientML.test.js backend/demoCareRanking.test.js
python3 -m pytest ml-service/tests/test_patient_ml.py -q
```

For the normal deterministic demo, run `npm start` without either ML switch. In Nearby care, the synthetic shortlist still explains its rule scores. In Care timeline and Hospital/Admin > Follow-up & risk demo, updates still use the existing authenticated workflow. Reminder plans remain app inbox/on-refresh only; no SMS delivery is implied.
