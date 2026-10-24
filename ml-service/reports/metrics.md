# Measured patient assistance evaluation

Metrics are measured on synthetic data and are not real-world performance.

All results below are computed from saved held-out predictions. Standard deviations use ddof=1.

| Model | Metric | Baseline mean ± std | Model mean ± std | Paired improvement mean ± std |
|---|---|---|---|---|
| barrier | accuracy | 0.5441333333333334 ± 0.010278348332511601 | 0.5550666666666666 ± 0.014334108506170382 | 0.01093333333333335 ± 0.010610267563910765 |
| barrier | precision | 0.0 ± 0.0 | 0.555001718698781 ± 0.04528544668213751 | 0.555001718698781 ± 0.04528544668213751 |
| barrier | recall | 0.0 ± 0.0 | 0.1502410710196958 ± 0.09882688552098583 | 0.1502410710196958 ± 0.09882688552098583 |
| barrier | f1 | 0.0 ± 0.0 | 0.22238232366081717 ± 0.11204802892754927 | 0.22238232366081717 ± 0.11204802892754927 |
| barrier | roc_auc | 0.5 ± 0.0 | 0.5542470002244068 ± 0.01989081825721581 | 0.05424700022440676 ± 0.01989081825721581 |
| barrier | pr_auc | 0.45586666666666664 ± 0.010278348332511624 | 0.5034158929136513 ± 0.018220299219343983 | 0.047549226246984586 ± 0.020239669397283933 |
| barrier | brier_score | 0.25181344880952383 ± 0.0021831707217537977 | 0.24615335478314454 ± 0.0021979821227317235 | 0.0056600940263792756 ± 0.001915716588391704 |
| reminders | accuracy | 0.5752 ± 0.002844097201026888 | 0.5803999999999999 ± 0.009962150593342996 | 0.005200000000000005 ± 0.009084785816591001 |
| reminders | precision | 0.0 ± 0.0 | 0.51618223501093 ± 0.02772203134380113 | 0.51618223501093 ± 0.02772203134380113 |
| reminders | recall | 0.0 ± 0.0 | 0.16715826187106067 ± 0.07984486427317349 | 0.16715826187106067 ± 0.07984486427317349 |
| reminders | f1 | 0.0 ± 0.0 | 0.24286713129280915 ± 0.10963084028249057 | 0.24286713129280915 ± 0.10963084028249057 |
| reminders | roc_auc | 0.5 ± 0.0 | 0.5619861363836579 ± 0.013003007997756848 | 0.06198613638365793 ± 0.01300300799775685 |
| reminders | pr_auc | 0.4248 ± 0.0028440972010268678 | 0.4830588104289209 ± 0.01341041386735635 | 0.05825881042892089 ± 0.013387944713234136 |
| reminders | brier_score | 0.24435534532312922 ± 0.00044124277893658066 | 0.2417368193426821 ± 0.0016294860690374156 | 0.002618525980447145 ± 0.001501087662467369 |
| reminders | offline_completion_rate | 0.3841181039991947 ± 0.026530250725043263 | 0.5392208974390235 ± 0.03319699703506971 | 0.15510279343982866 ± 0.05275910264241921 |
| reminders | offline_app_completion_rate | 0.3841181039991947 ± 0.026530250725043263 | 0.4969483246145173 ± 0.00572274795405587 | 0.11283022061532252 ± 0.03182786331264528 |
| gaps | ndcg@3 | 0.5135055648841036 ± 0.008785179557655976 | 0.6214361080471283 ± 0.005791955291162308 | 0.10793054316302483 ± 0.013958539883881075 |
| gaps | mrr | 0.6378112515616061 ± 0.006756948519645071 | 0.7257655753648791 ± 0.006507799493989603 | 0.08795432380327292 ± 0.008821750896096669 |
| gaps | top1_accuracy | 0.4111921588286429 ± 0.010636924818289935 | 0.5374210229445109 ± 0.012052188444776046 | 0.12622886411586798 ± 0.01141984854728904 |
| facilities | ndcg@5 | 0.5908533810133488 ± 0.005495893161711519 | 0.6261882456033284 ± 0.0033796131732840586 | 0.03533486458997963 ± 0.007047427874709152 |
| facilities | mrr | 0.4812355555555555 ± 0.005761389150046361 | 0.5251866666666667 ± 0.002819414613963679 | 0.04395111111111112 ± 0.006981813235068876 |
| facilities | top1_accuracy | 0.22440000000000002 ± 0.008361286450727012 | 0.282 ± 0.0031622776601683764 | 0.057600000000000005 ± 0.01064163730092528 |

## Test counts, class balance, diagnostics

### Seed 142
```json
{
  "split_audit": {
    "patient_overlap": 0,
    "patient_counts": {
      "train": 3500,
      "validation": 750,
      "test": 750
    },
    "time_ranges": {
      "train": {
        "min": "2024-12-01",
        "max": "2026-02-20"
      },
      "validation": {
        "min": "2026-04-01",
        "max": "2026-06-20"
      },
      "test": {
        "min": "2026-08-01",
        "max": "2026-10-13"
      }
    }
  },
  "counts_and_results": {
    "barrier": {
      "model": {
        "accuracy": 0.5786666666666667,
        "precision": 0.5789473684210527,
        "recall": 0.15022761760242792,
        "f1": 0.2385542168674699,
        "roc_auc": 0.5720545488335838,
        "pr_auc": 0.5131247288421801,
        "brier_score": 0.24267768821012253,
        "confusion_matrix": [
          [
            769,
            72
          ],
          [
            560,
            99
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5606666666666666,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.43933333333333335,
        "brier_score": 0.24852967474489795,
        "confusion_matrix": [
          [
            841,
            0
          ],
          [
            659,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 659,
      "positive_fraction": 0.43933333333333335,
      "patients": 750,
      "logistic_regression": {
        "accuracy": 0.578,
        "precision": 0.5722222222222222,
        "recall": 0.15629742033383914,
        "f1": 0.24553039332538737,
        "roc_auc": 0.5727275679830536,
        "pr_auc": 0.5133068543078714,
        "brier_score": 0.24260269923659597,
        "confusion_matrix": [
          [
            764,
            77
          ],
          [
            556,
            103
          ]
        ],
        "threshold": 0.5
      }
    },
    "reminders": {
      "model": {
        "accuracy": 0.5766666666666667,
        "precision": 0.5,
        "recall": 0.025196850393700787,
        "f1": 0.047976011994003,
        "roc_auc": 0.5589431523371717,
        "pr_auc": 0.4754431252686414,
        "brier_score": 0.2418221263622949,
        "confusion_matrix": [
          [
            849,
            16
          ],
          [
            619,
            16
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5766666666666667,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.42333333333333334,
        "brier_score": 0.24414388903061218,
        "confusion_matrix": [
          [
            865,
            0
          ],
          [
            635,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 635,
      "positive_fraction": 0.42333333333333334,
      "patients": 750,
      "offline_policy_estimate": {
        "policy": {
          "completion_rate": 0.5476190476190477,
          "matched_actions": 84,
          "effective_sample_size": 84.0
        },
        "fixed": {
          "completion_rate": 0.35294117647058826,
          "matched_actions": 102,
          "effective_sample_size": 102.0
        },
        "random": {
          "completion_rate": 0.4625,
          "matched_actions": 80,
          "effective_sample_size": 80.0
        },
        "app_only": {
          "completion_rate": 0.5051546391752577,
          "matched_actions": 97,
          "effective_sample_size": 97.0
        },
        "random_time_app": {
          "completion_rate": 0.3333333333333333,
          "matched_actions": 96,
          "effective_sample_size": 96.0
        },
        "absolute_lift": 0.1946778711484594,
        "relative_lift": 0.5515873015873016,
        "method": "Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial."
      }
    },
    "gaps": {
      "model": {
        "ndcg@3": 0.6301965560065688,
        "mrr": 0.730534173081409,
        "top1_accuracy": 0.5409377186843947,
        "evaluated_queries": 1429,
        "no_relevant_queries_excluded": 71,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@3": 0.5071409955811862,
        "mrr": 0.6315838581758806,
        "top1_accuracy": 0.40517844646606016,
        "evaluated_queries": 1429,
        "no_relevant_queries_excluded": 71,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@3": 0.5077175148495354,
        "mrr": 0.6320853743876836,
        "top1_accuracy": 0.4072778166550035,
        "evaluated_queries": 1429,
        "no_relevant_queries_excluded": 71,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 7500,
      "eligible_test_rows": 7500,
      "patients": 750,
      "positive_count": 3444
    },
    "facilities": {
      "model": {
        "ndcg@5": 0.6285722719293307,
        "mrr": 0.5280111111111111,
        "top1_accuracy": 0.2826666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@5": 0.5980551905750976,
        "mrr": 0.48661111111111116,
        "top1_accuracy": 0.22933333333333333,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@5": 0.5980551905750976,
        "mrr": 0.48661111111111116,
        "top1_accuracy": 0.22933333333333333,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 9000,
      "eligible_test_rows": 7976,
      "patients": 750,
      "positive_count": 1500
    }
  },
  "feature_importance": {
    "barrier": [
      {
        "feature": "digital_literacy",
        "gain_share": 0.31254795598598684
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.30285886748068225
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.14874770116206532
      },
      {
        "feature": "distance_km",
        "gain_share": 0.12290584544848815
      },
      {
        "feature": "week",
        "gain_share": 0.054724235620263885
      },
      {
        "feature": "pref_0",
        "gain_share": 0.02546494996941098
      },
      {
        "feature": "pref_2",
        "gain_share": 0.020199116677064245
      },
      {
        "feature": "pref_1",
        "gain_share": 0.004440491539879012
      },
      {
        "feature": "age",
        "gain_share": 0.004135923035348351
      },
      {
        "feature": "pref_3",
        "gain_share": 0.003974913080810841
      }
    ],
    "reminders": [
      {
        "feature": "preferred_channel",
        "gain_share": 0.41186420540216545
      },
      {
        "feature": "hour",
        "gain_share": 0.25749369084979906
      },
      {
        "feature": "channel",
        "gain_share": 0.13404436255756116
      },
      {
        "feature": "distance_km",
        "gain_share": 0.07642857682067483
      },
      {
        "feature": "age",
        "gain_share": 0.04081980151200752
      },
      {
        "feature": "week",
        "gain_share": 0.037669379834731724
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.016988735782469677
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.014345198164156947
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.01034604907643363
      }
    ],
    "gaps": [
      {
        "feature": "days_overdue",
        "gain_share": 0.903116863178938
      },
      {
        "feature": "gap_type",
        "gain_share": 0.03779708055220507
      },
      {
        "feature": "clinician_priority",
        "gain_share": 0.023294696125222246
      },
      {
        "feature": "distance_km",
        "gain_share": 0.016928196900842126
      },
      {
        "feature": "stage",
        "gain_share": 0.013762549002645709
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.0051006142401468415
      }
    ],
    "facilities": [
      {
        "feature": "offers_service",
        "gain_share": 0.37489213838693347
      },
      {
        "feature": "distance_km",
        "gain_share": 0.3253549962748455
      },
      {
        "feature": "days_since_confirmed",
        "gain_share": 0.156827433693078
      },
      {
        "feature": "appointment_availability",
        "gain_share": 0.14292543164514301
      },
      {
        "feature": "open_now",
        "gain_share": 0.0
      }
    ]
  },
  "selected_parameters": {
    "barrier": {
      "selected_model": "logistic-C1",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6760004085333275
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6758138180626658
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6768544900143932
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6748488170247737
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.673404619876922
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6733780443849722
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6733754906380897
        }
      ],
      "validation_objective": -0.6733754906380897,
      "threshold": 0.5
    },
    "reminders": {
      "selected_model": "lightgbm-leaves7-trees65-engineeredFalse",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.672770281551411
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6742698421414647
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.676360458886546
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6740910087137039
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6747442803079887
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6748253597873124
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6748335748120432
        }
      ],
      "validation_objective": -0.672770281551411,
      "threshold": 0.5
    },
    "gaps": {
      "selected_model": "lightgbm-leaves7-trees65-engineeredFalse",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6228568706537613
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6226174462345232
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6217831207762572
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.620873009080743
        }
      ],
      "validation_objective": 0.6228568706537613,
      "threshold": null
    },
    "facilities": {
      "selected_model": "lightgbm-leaves7-trees160-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6303305598354265
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6328583207090612
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6310042743689084
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6297365107609945
        }
      ],
      "validation_objective": 0.6328583207090612,
      "threshold": null
    }
  }
}
```
### Seed 143
```json
{
  "split_audit": {
    "patient_overlap": 0,
    "patient_counts": {
      "train": 3500,
      "validation": 750,
      "test": 750
    },
    "time_ranges": {
      "train": {
        "min": "2024-12-01",
        "max": "2026-02-20"
      },
      "validation": {
        "min": "2026-04-01",
        "max": "2026-06-20"
      },
      "test": {
        "min": "2026-08-01",
        "max": "2026-10-13"
      }
    }
  },
  "counts_and_results": {
    "barrier": {
      "model": {
        "accuracy": 0.542,
        "precision": 0.48372093023255813,
        "recall": 0.15294117647058825,
        "f1": 0.2324022346368715,
        "roc_auc": 0.5340647417503587,
        "pr_auc": 0.47505447064443834,
        "brier_score": 0.24734110486034547,
        "confusion_matrix": [
          [
            709,
            111
          ],
          [
            576,
            104
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5466666666666666,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.4533333333333333,
        "brier_score": 0.2507048894557823,
        "confusion_matrix": [
          [
            820,
            0
          ],
          [
            680,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 680,
      "positive_fraction": 0.4533333333333333,
      "patients": 750,
      "logistic_regression": {
        "accuracy": 0.5366666666666666,
        "precision": 0.4663677130044843,
        "recall": 0.15294117647058825,
        "f1": 0.23034330011074197,
        "roc_auc": 0.5351685796269727,
        "pr_auc": 0.4756670077429973,
        "brier_score": 0.2472465236470924,
        "confusion_matrix": [
          [
            701,
            119
          ],
          [
            576,
            104
          ]
        ],
        "threshold": 0.5
      }
    },
    "reminders": {
      "model": {
        "accuracy": 0.5673333333333334,
        "precision": 0.4785992217898833,
        "recall": 0.19278996865203762,
        "f1": 0.2748603351955307,
        "roc_auc": 0.5407132570605648,
        "pr_auc": 0.4630243876688698,
        "brier_score": 0.2442738204528567,
        "confusion_matrix": [
          [
            728,
            134
          ],
          [
            515,
            123
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5746666666666667,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.42533333333333334,
        "brier_score": 0.24442676318027212,
        "confusion_matrix": [
          [
            862,
            0
          ],
          [
            638,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 638,
      "positive_fraction": 0.42533333333333334,
      "patients": 750,
      "offline_policy_estimate": {
        "policy": {
          "completion_rate": 0.5204081632653061,
          "matched_actions": 98,
          "effective_sample_size": 98.0
        },
        "fixed": {
          "completion_rate": 0.3723404255319149,
          "matched_actions": 94,
          "effective_sample_size": 94.0
        },
        "random": {
          "completion_rate": 0.4835164835164835,
          "matched_actions": 91,
          "effective_sample_size": 91.0
        },
        "app_only": {
          "completion_rate": 0.5,
          "matched_actions": 64,
          "effective_sample_size": 64.0
        },
        "random_time_app": {
          "completion_rate": 0.41304347826086957,
          "matched_actions": 92,
          "effective_sample_size": 92.0
        },
        "absolute_lift": 0.14806773773339127,
        "relative_lift": 0.39766763848396525,
        "method": "Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial."
      }
    },
    "gaps": {
      "model": {
        "ndcg@3": 0.6149912373138408,
        "mrr": 0.7158414690841469,
        "top1_accuracy": 0.5202231520223152,
        "evaluated_queries": 1434,
        "no_relevant_queries_excluded": 66,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@3": 0.5250098765825645,
        "mrr": 0.6390864714086472,
        "top1_accuracy": 0.4100418410041841,
        "evaluated_queries": 1434,
        "no_relevant_queries_excluded": 66,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@3": 0.5308594147294855,
        "mrr": 0.6475825197582519,
        "top1_accuracy": 0.4225941422594142,
        "evaluated_queries": 1434,
        "no_relevant_queries_excluded": 66,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 7500,
      "eligible_test_rows": 7500,
      "patients": 750,
      "positive_count": 3488
    },
    "facilities": {
      "model": {
        "ndcg@5": 0.6242076316067169,
        "mrr": 0.5236000000000001,
        "top1_accuracy": 0.282,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@5": 0.5869711218433542,
        "mrr": 0.4759222222222222,
        "top1_accuracy": 0.21666666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@5": 0.5869711218433542,
        "mrr": 0.4759222222222222,
        "top1_accuracy": 0.21666666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 9000,
      "eligible_test_rows": 7886,
      "patients": 750,
      "positive_count": 1500
    }
  },
  "feature_importance": {
    "barrier": [
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.29005878723252754
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.26297076268471364
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.16670564187364115
      },
      {
        "feature": "distance_km",
        "gain_share": 0.1306488027629218
      },
      {
        "feature": "age",
        "gain_share": 0.037498274518772405
      },
      {
        "feature": "pref_2",
        "gain_share": 0.032649459225609946
      },
      {
        "feature": "pref_3",
        "gain_share": 0.030700950731214077
      },
      {
        "feature": "week",
        "gain_share": 0.02170754892113719
      },
      {
        "feature": "pref_1",
        "gain_share": 0.01755319548430592
      },
      {
        "feature": "pref_0",
        "gain_share": 0.009506576565156374
      }
    ],
    "reminders": [
      {
        "feature": "channel_match",
        "gain_share": 0.5295290443299093
      },
      {
        "feature": "hour",
        "gain_share": 0.2215420747614622
      },
      {
        "feature": "distance_km",
        "gain_share": 0.09952368065219118
      },
      {
        "feature": "age",
        "gain_share": 0.03885909993971914
      },
      {
        "feature": "channel_1",
        "gain_share": 0.028531031143740993
      },
      {
        "feature": "week",
        "gain_share": 0.01903898770752995
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.01655465832936598
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.014649710663203698
      },
      {
        "feature": "digital_app_or_whatsapp",
        "gain_share": 0.009512666318511978
      },
      {
        "feature": "pref_0",
        "gain_share": 0.006976570435100397
      },
      {
        "feature": "pref_1",
        "gain_share": 0.006330429982881679
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.005456527726154633
      },
      {
        "feature": "pref_2",
        "gain_share": 0.002788101634840479
      },
      {
        "feature": "channel_2",
        "gain_share": 0.0007074163753884018
      },
      {
        "feature": "pref_3",
        "gain_share": 0.0
      },
      {
        "feature": "channel_0",
        "gain_share": 0.0
      },
      {
        "feature": "channel_3",
        "gain_share": 0.0
      },
      {
        "feature": "evening",
        "gain_share": 0.0
      }
    ],
    "gaps": [
      {
        "feature": "days_overdue",
        "gain_share": 0.8035989451820885
      },
      {
        "feature": "distance_km",
        "gain_share": 0.10345573872710244
      },
      {
        "feature": "gap_type",
        "gain_share": 0.05296050526330144
      },
      {
        "feature": "stage",
        "gain_share": 0.01903278018512265
      },
      {
        "feature": "clinician_priority",
        "gain_share": 0.014345143424530176
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.006606887217854749
      }
    ],
    "facilities": [
      {
        "feature": "offers_service",
        "gain_share": 0.3988492177302005
      },
      {
        "feature": "distance_km",
        "gain_share": 0.25529451862469144
      },
      {
        "feature": "days_since_confirmed",
        "gain_share": 0.18567378694338804
      },
      {
        "feature": "appointment_availability",
        "gain_share": 0.16018247670172003
      },
      {
        "feature": "open_now",
        "gain_share": 0.0
      }
    ]
  },
  "selected_parameters": {
    "barrier": {
      "selected_model": "logistic-C1",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6813579367552507
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6811202686177397
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6813076601959264
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6811270154712966
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.680979163961308
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6809320982331984
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6809274748893773
        }
      ],
      "validation_objective": -0.6809274748893773,
      "threshold": 0.5
    },
    "reminders": {
      "selected_model": "lightgbm-leaves7-trees160-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6766810156375207
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6755742620842623
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6770292910271548
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6756277740620698
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6766605653590152
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6766951814850506
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6766993959524081
        }
      ],
      "validation_objective": -0.6755742620842623,
      "threshold": 0.5
    },
    "gaps": {
      "selected_model": "lightgbm-leaves15-trees120-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6203706935025078
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.620305629190161
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6214665793412489
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6196609795408878
        }
      ],
      "validation_objective": 0.6214665793412489,
      "threshold": null
    },
    "facilities": {
      "selected_model": "lightgbm-leaves4-trees180-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6154261916073157
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6150727915065796
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6081846084031629
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6190426912659135
        }
      ],
      "validation_objective": 0.6190426912659135,
      "threshold": null
    }
  }
}
```
### Seed 144
```json
{
  "split_audit": {
    "patient_overlap": 0,
    "patient_counts": {
      "train": 3500,
      "validation": 750,
      "test": 750
    },
    "time_ranges": {
      "train": {
        "min": "2024-12-01",
        "max": "2026-02-20"
      },
      "validation": {
        "min": "2026-04-01",
        "max": "2026-06-20"
      },
      "test": {
        "min": "2026-08-01",
        "max": "2026-10-13"
      }
    }
  },
  "counts_and_results": {
    "barrier": {
      "model": {
        "accuracy": 0.5566666666666666,
        "precision": 0.5425,
        "recall": 0.3104434907010014,
        "f1": 0.39490445859872614,
        "roc_auc": 0.5624416189348436,
        "pr_auc": 0.5127993934817024,
        "brier_score": 0.24594068343247963,
        "confusion_matrix": [
          [
            618,
            183
          ],
          [
            482,
            217
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.534,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.466,
        "brier_score": 0.2536247346938776,
        "confusion_matrix": [
          [
            801,
            0
          ],
          [
            699,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 699,
      "positive_fraction": 0.466,
      "patients": 750,
      "logistic_regression": {
        "accuracy": 0.564,
        "precision": 0.5558312655086849,
        "recall": 0.32045779685264664,
        "f1": 0.40653357531760437,
        "roc_auc": 0.5617977528089888,
        "pr_auc": 0.5159859210041375,
        "brier_score": 0.24597077494233183,
        "confusion_matrix": [
          [
            622,
            179
          ],
          [
            475,
            224
          ]
        ],
        "threshold": 0.5
      }
    },
    "reminders": {
      "model": {
        "accuracy": 0.5853333333333334,
        "precision": 0.5366795366795367,
        "recall": 0.21684867394695787,
        "f1": 0.3088888888888889,
        "roc_auc": 0.5680043732599129,
        "pr_auc": 0.49408400952667864,
        "brier_score": 0.24129953831252104,
        "confusion_matrix": [
          [
            739,
            120
          ],
          [
            502,
            139
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5726666666666667,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.42733333333333334,
        "brier_score": 0.24476922448979596,
        "confusion_matrix": [
          [
            859,
            0
          ],
          [
            641,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 641,
      "positive_fraction": 0.42733333333333334,
      "patients": 750,
      "offline_policy_estimate": {
        "policy": {
          "completion_rate": 0.5053763440860215,
          "matched_actions": 93,
          "effective_sample_size": 93.0
        },
        "fixed": {
          "completion_rate": 0.41975308641975306,
          "matched_actions": 81,
          "effective_sample_size": 81.0
        },
        "random": {
          "completion_rate": 0.5,
          "matched_actions": 108,
          "effective_sample_size": 108.0
        },
        "app_only": {
          "completion_rate": 0.49038461538461536,
          "matched_actions": 104,
          "effective_sample_size": 104.0
        },
        "random_time_app": {
          "completion_rate": 0.4631578947368421,
          "matched_actions": 95,
          "effective_sample_size": 95.0
        },
        "absolute_lift": 0.08562325766626844,
        "relative_lift": 0.20398481973434546,
        "method": "Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial."
      }
    },
    "gaps": {
      "model": {
        "ndcg@3": 0.6236825164877293,
        "mrr": 0.7256463527239152,
        "top1_accuracy": 0.538781163434903,
        "evaluated_queries": 1444,
        "no_relevant_queries_excluded": 56,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@3": 0.5028347795784204,
        "mrr": 0.6310595567867036,
        "top1_accuracy": 0.4002770083102493,
        "evaluated_queries": 1444,
        "no_relevant_queries_excluded": 56,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@3": 0.5105695204792263,
        "mrr": 0.6403970452446907,
        "top1_accuracy": 0.4155124653739612,
        "evaluated_queries": 1444,
        "no_relevant_queries_excluded": 56,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 7500,
      "eligible_test_rows": 7500,
      "patients": 750,
      "positive_count": 3475
    },
    "facilities": {
      "model": {
        "ndcg@5": 0.6292141435276624,
        "mrr": 0.5269222222222222,
        "top1_accuracy": 0.2866666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@5": 0.5850968833878628,
        "mrr": 0.4760333333333333,
        "top1_accuracy": 0.21466666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@5": 0.5850968833878628,
        "mrr": 0.4760333333333333,
        "top1_accuracy": 0.21466666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 9000,
      "eligible_test_rows": 7892,
      "patients": 750,
      "positive_count": 1500
    }
  },
  "feature_importance": {
    "barrier": [
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.336425020152993
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.27124464817207217
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.1288307309237019
      },
      {
        "feature": "distance_km",
        "gain_share": 0.12320765823713163
      },
      {
        "feature": "pref_2",
        "gain_share": 0.040977948074424
      },
      {
        "feature": "age",
        "gain_share": 0.034383640527691946
      },
      {
        "feature": "pref_1",
        "gain_share": 0.021050732178912984
      },
      {
        "feature": "pref_0",
        "gain_share": 0.018926810584035027
      },
      {
        "feature": "week",
        "gain_share": 0.01425215762151343
      },
      {
        "feature": "pref_3",
        "gain_share": 0.010700653527523805
      }
    ],
    "reminders": [
      {
        "feature": "channel_match",
        "gain_share": 0.42296838770302075
      },
      {
        "feature": "evening",
        "gain_share": 0.2720550879343342
      },
      {
        "feature": "digital_app_or_whatsapp",
        "gain_share": 0.12372829088430941
      },
      {
        "feature": "channel_3",
        "gain_share": 0.03444690384207228
      },
      {
        "feature": "age",
        "gain_share": 0.030243780150234285
      },
      {
        "feature": "channel_2",
        "gain_share": 0.020191340982593408
      },
      {
        "feature": "week",
        "gain_share": 0.015407164017085778
      },
      {
        "feature": "channel_1",
        "gain_share": 0.014725137190322294
      },
      {
        "feature": "hour",
        "gain_share": 0.012755418909136155
      },
      {
        "feature": "distance_km",
        "gain_share": 0.012614061301475856
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.011356509643935845
      },
      {
        "feature": "pref_3",
        "gain_share": 0.009574549098078719
      },
      {
        "feature": "pref_2",
        "gain_share": 0.00820551120782737
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.005446462390105656
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.004054547488419001
      },
      {
        "feature": "pref_0",
        "gain_share": 0.0010081387589423304
      },
      {
        "feature": "pref_1",
        "gain_share": 0.0007778681524231358
      },
      {
        "feature": "channel_0",
        "gain_share": 0.00044084034568352853
      }
    ],
    "gaps": [
      {
        "feature": "days_overdue",
        "gain_share": 0.963011875334688
      },
      {
        "feature": "gap_type",
        "gain_share": 0.02706142016965674
      },
      {
        "feature": "clinician_priority",
        "gain_share": 0.006962888005566302
      },
      {
        "feature": "distance_km",
        "gain_share": 0.0021002086288930155
      },
      {
        "feature": "stage",
        "gain_share": 0.0008636078611959831
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.0
      }
    ],
    "facilities": [
      {
        "feature": "offers_service",
        "gain_share": 0.39807523824235774
      },
      {
        "feature": "distance_km",
        "gain_share": 0.2483444765323873
      },
      {
        "feature": "appointment_availability",
        "gain_share": 0.18980287528140413
      },
      {
        "feature": "days_since_confirmed",
        "gain_share": 0.16377740994385084
      },
      {
        "feature": "open_now",
        "gain_share": 0.0
      }
    ]
  },
  "selected_parameters": {
    "barrier": {
      "selected_model": "logistic-C0.01",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6793864523787084
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6790643780449508
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6801115087559274
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6785829015225443
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.67815310619607
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6781776904065049
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6781803674437991
        }
      ],
      "validation_objective": -0.67815310619607,
      "threshold": 0.5
    },
    "reminders": {
      "selected_model": "logistic-C0.01",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6754066534523854
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6739890447661517
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6744696886363735
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6739440875288243
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6734989741382925
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6735286094874502
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6735331697833491
        }
      ],
      "validation_objective": -0.6734989741382925,
      "threshold": 0.5
    },
    "gaps": {
      "selected_model": "lightgbm-leaves4-trees180-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6281875567731562
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6284176298151712
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6292797479227462
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6306741651054371
        }
      ],
      "validation_objective": 0.6306741651054371,
      "threshold": null
    },
    "facilities": {
      "selected_model": "lightgbm-leaves4-trees180-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6105790534638021
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6150759610236347
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6135712942797482
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6161202591876812
        }
      ],
      "validation_objective": 0.6161202591876812,
      "threshold": null
    }
  }
}
```
### Seed 145
```json
{
  "split_audit": {
    "patient_overlap": 0,
    "patient_counts": {
      "train": 3500,
      "validation": 750,
      "test": 750
    },
    "time_ranges": {
      "train": {
        "min": "2024-12-01",
        "max": "2026-02-20"
      },
      "validation": {
        "min": "2026-04-01",
        "max": "2026-06-20"
      },
      "test": {
        "min": "2026-08-01",
        "max": "2026-10-13"
      }
    }
  },
  "counts_and_results": {
    "barrier": {
      "model": {
        "accuracy": 0.552,
        "precision": 0.6022727272727273,
        "recall": 0.07681159420289856,
        "f1": 0.13624678663239073,
        "roc_auc": 0.5316639828234031,
        "pr_auc": 0.4958382003799232,
        "brier_score": 0.24855729388196998,
        "confusion_matrix": [
          [
            775,
            35
          ],
          [
            637,
            53
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.54,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.46,
        "brier_score": 0.2526342908163266,
        "confusion_matrix": [
          [
            810,
            0
          ],
          [
            690,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 690,
      "positive_fraction": 0.46,
      "patients": 750,
      "logistic_regression": {
        "accuracy": 0.544,
        "precision": 0.5125,
        "recall": 0.1782608695652174,
        "f1": 0.2645161290322581,
        "roc_auc": 0.5467981749865808,
        "pr_auc": 0.499832478832247,
        "brier_score": 0.24702972838015227,
        "confusion_matrix": [
          [
            693,
            117
          ],
          [
            567,
            123
          ]
        ],
        "threshold": 0.5
      }
    },
    "reminders": {
      "model": {
        "accuracy": 0.5786666666666667,
        "precision": 0.5182186234817814,
        "recall": 0.1996879875195008,
        "f1": 0.2882882882882883,
        "roc_auc": 0.5688007497016994,
        "pr_auc": 0.4917112889287283,
        "brier_score": 0.24153841458483333,
        "confusion_matrix": [
          [
            740,
            119
          ],
          [
            513,
            128
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5726666666666667,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.42733333333333334,
        "brier_score": 0.2447284132653061,
        "confusion_matrix": [
          [
            859,
            0
          ],
          [
            641,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 641,
      "positive_fraction": 0.42733333333333334,
      "patients": 750,
      "offline_policy_estimate": {
        "policy": {
          "completion_rate": 0.5918367346938775,
          "matched_actions": 98,
          "effective_sample_size": 98.0
        },
        "fixed": {
          "completion_rate": 0.37349397590361444,
          "matched_actions": 83,
          "effective_sample_size": 83.0
        },
        "random": {
          "completion_rate": 0.4421052631578947,
          "matched_actions": 95,
          "effective_sample_size": 95.0
        },
        "app_only": {
          "completion_rate": 0.494949494949495,
          "matched_actions": 99,
          "effective_sample_size": 99.0
        },
        "random_time_app": {
          "completion_rate": 0.43956043956043955,
          "matched_actions": 91,
          "effective_sample_size": 91.0
        },
        "absolute_lift": 0.2183427587902631,
        "relative_lift": 0.5845951283739304,
        "method": "Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial."
      }
    },
    "gaps": {
      "model": {
        "ndcg@3": 0.6186792109867243,
        "mrr": 0.7325413463778242,
        "top1_accuracy": 0.5534591194968553,
        "evaluated_queries": 1431,
        "no_relevant_queries_excluded": 69,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@3": 0.5181012109930093,
        "mrr": 0.6474143955276032,
        "top1_accuracy": 0.4283717679944095,
        "evaluated_queries": 1431,
        "no_relevant_queries_excluded": 69,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@3": 0.5230585435839434,
        "mrr": 0.6503028185418122,
        "top1_accuracy": 0.43116701607267643,
        "evaluated_queries": 1431,
        "no_relevant_queries_excluded": 69,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 7500,
      "eligible_test_rows": 7500,
      "patients": 750,
      "positive_count": 3451
    },
    "facilities": {
      "model": {
        "ndcg@5": 0.6212297821574639,
        "mrr": 0.5210666666666667,
        "top1_accuracy": 0.2806666666666667,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@5": 0.5950530245793173,
        "mrr": 0.4880111111111111,
        "top1_accuracy": 0.234,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@5": 0.5950530245793173,
        "mrr": 0.4880111111111111,
        "top1_accuracy": 0.234,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 9000,
      "eligible_test_rows": 7922,
      "patients": 750,
      "positive_count": 1500
    }
  },
  "feature_importance": {
    "barrier": [
      {
        "feature": "distance_km",
        "gain_share": 0.2536060770037903
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.22466431618877766
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.1882150252453983
      },
      {
        "feature": "age",
        "gain_share": 0.13820703790814928
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.09046992834725487
      },
      {
        "feature": "week",
        "gain_share": 0.07756305118512914
      },
      {
        "feature": "pref_2",
        "gain_share": 0.011301533793219012
      },
      {
        "feature": "pref_3",
        "gain_share": 0.00736636561096849
      },
      {
        "feature": "pref_1",
        "gain_share": 0.006898326436782314
      },
      {
        "feature": "pref_0",
        "gain_share": 0.0017083382805306118
      }
    ],
    "reminders": [
      {
        "feature": "channel_match",
        "gain_share": 0.3829445837197202
      },
      {
        "feature": "evening",
        "gain_share": 0.2848460433541486
      },
      {
        "feature": "digital_app_or_whatsapp",
        "gain_share": 0.11267417593524348
      },
      {
        "feature": "hour",
        "gain_share": 0.0552674955981298
      },
      {
        "feature": "pref_0",
        "gain_share": 0.033175553820835764
      },
      {
        "feature": "pref_2",
        "gain_share": 0.025339816881361766
      },
      {
        "feature": "channel_1",
        "gain_share": 0.016958884919458062
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.01474868996367214
      },
      {
        "feature": "distance_km",
        "gain_share": 0.014238684970206498
      },
      {
        "feature": "pref_1",
        "gain_share": 0.012259588075975656
      },
      {
        "feature": "channel_3",
        "gain_share": 0.011720206897002894
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.011184578910289886
      },
      {
        "feature": "pref_3",
        "gain_share": 0.007788516255552221
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.006643099533670727
      },
      {
        "feature": "age",
        "gain_share": 0.003782356822843818
      },
      {
        "feature": "channel_2",
        "gain_share": 0.002987030585154495
      },
      {
        "feature": "channel_0",
        "gain_share": 0.0022960420763835023
      },
      {
        "feature": "week",
        "gain_share": 0.0011446516803504667
      }
    ],
    "gaps": [
      {
        "feature": "days_overdue",
        "gain_share": 0.9182988077832029
      },
      {
        "feature": "gap_type",
        "gain_share": 0.031826830586741635
      },
      {
        "feature": "distance_km",
        "gain_share": 0.030537830247585718
      },
      {
        "feature": "clinician_priority",
        "gain_share": 0.013679791546289902
      },
      {
        "feature": "stage",
        "gain_share": 0.004303174873705012
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.0013535649624747716
      }
    ],
    "facilities": [
      {
        "feature": "offers_service",
        "gain_share": 0.41087708424085473
      },
      {
        "feature": "distance_km",
        "gain_share": 0.3538129312674205
      },
      {
        "feature": "days_since_confirmed",
        "gain_share": 0.1360836770332803
      },
      {
        "feature": "appointment_availability",
        "gain_share": 0.09922630745844445
      },
      {
        "feature": "open_now",
        "gain_share": 0.0
      }
    ]
  },
  "selected_parameters": {
    "barrier": {
      "selected_model": "lightgbm-leaves15-trees120-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6874981574406014
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6877438356682102
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6871026115850729
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6877448403857395
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6875144574723044
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6875303195998751
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6875320702889988
        }
      ],
      "validation_objective": -0.6871026115850729,
      "threshold": 0.5
    },
    "reminders": {
      "selected_model": "logistic-C1",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6756656243591662
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6720218572602668
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6726675916278223
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.671666609140644
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6710347038575515
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6708730374589551
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6708539347210244
        }
      ],
      "validation_objective": -0.6708539347210244,
      "threshold": 0.5
    },
    "gaps": {
      "selected_model": "lightgbm-leaves7-trees65-engineeredFalse",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6423888247441045
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6418085480653966
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6419016557629151
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6410005397738702
        }
      ],
      "validation_objective": 0.6423888247441045,
      "threshold": null
    },
    "facilities": {
      "selected_model": "lightgbm-leaves7-trees160-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6341904267277926
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6357572209197364
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6326881771834546
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6335297485745948
        }
      ],
      "validation_objective": 0.6357572209197364,
      "threshold": null
    }
  }
}
```
### Seed 146
```json
{
  "split_audit": {
    "patient_overlap": 0,
    "patient_counts": {
      "train": 3500,
      "validation": 750,
      "test": 750
    },
    "time_ranges": {
      "train": {
        "min": "2024-12-01",
        "max": "2026-02-20"
      },
      "validation": {
        "min": "2026-04-01",
        "max": "2026-06-20"
      },
      "test": {
        "min": "2026-08-01",
        "max": "2026-10-13"
      }
    }
  },
  "counts_and_results": {
    "barrier": {
      "model": {
        "accuracy": 0.546,
        "precision": 0.5675675675675675,
        "recall": 0.060781476121562955,
        "f1": 0.10980392156862745,
        "roc_auc": 0.5710101087798447,
        "pr_auc": 0.5202626712200122,
        "brier_score": 0.24625000353080506,
        "confusion_matrix": [
          [
            777,
            32
          ],
          [
            649,
            42
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5393333333333333,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.46066666666666667,
        "brier_score": 0.2535736543367346,
        "confusion_matrix": [
          [
            809,
            0
          ],
          [
            691,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 691,
      "positive_fraction": 0.46066666666666667,
      "patients": 750,
      "logistic_regression": {
        "accuracy": 0.5613333333333334,
        "precision": 0.5627376425855514,
        "recall": 0.2141823444283647,
        "f1": 0.31027253668763105,
        "roc_auc": 0.5761378414687157,
        "pr_auc": 0.5187909185579394,
        "brier_score": 0.24482900708146763,
        "confusion_matrix": [
          [
            694,
            115
          ],
          [
            543,
            148
          ]
        ],
        "threshold": 0.5
      }
    },
    "reminders": {
      "model": {
        "accuracy": 0.594,
        "precision": 0.5474137931034483,
        "recall": 0.20126782884310618,
        "f1": 0.2943221320973349,
        "roc_auc": 0.5734691495589408,
        "pr_auc": 0.4910312407516864,
        "brier_score": 0.2397501970009045,
        "confusion_matrix": [
          [
            764,
            105
          ],
          [
            504,
            127
          ]
        ],
        "threshold": 0.5
      },
      "baseline": {
        "accuracy": 0.5793333333333334,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "roc_auc": 0.5,
        "pr_auc": 0.4206666666666667,
        "brier_score": 0.24370843664965983,
        "confusion_matrix": [
          [
            869,
            0
          ],
          [
            631,
            0
          ]
        ],
        "threshold": 0.5
      },
      "test_rows": 1500,
      "positive_count": 631,
      "positive_fraction": 0.4206666666666667,
      "patients": 750,
      "offline_policy_estimate": {
        "policy": {
          "completion_rate": 0.5308641975308642,
          "matched_actions": 81,
          "effective_sample_size": 81.0
        },
        "fixed": {
          "completion_rate": 0.4020618556701031,
          "matched_actions": 97,
          "effective_sample_size": 97.0
        },
        "random": {
          "completion_rate": 0.425531914893617,
          "matched_actions": 94,
          "effective_sample_size": 94.0
        },
        "app_only": {
          "completion_rate": 0.4942528735632184,
          "matched_actions": 87,
          "effective_sample_size": 87.0
        },
        "random_time_app": {
          "completion_rate": 0.4105263157894737,
          "matched_actions": 95,
          "effective_sample_size": 95.0
        },
        "absolute_lift": 0.12880234186076112,
        "relative_lift": 0.3203545425767649,
        "method": "Self-normalized inverse propensity scoring on held-out uniformly randomized logged actions. Only factual matches used; not a causal real-world trial."
      }
    },
    "gaps": {
      "model": {
        "ndcg@3": 0.6196310194407786,
        "mrr": 0.7242645355570999,
        "top1_accuracy": 0.5337039610840861,
        "evaluated_queries": 1439,
        "no_relevant_queries_excluded": 61,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@3": 0.5144409616853372,
        "mrr": 0.6399119759091961,
        "top1_accuracy": 0.4120917303683113,
        "evaluated_queries": 1439,
        "no_relevant_queries_excluded": 61,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@3": 0.5217994462166543,
        "mrr": 0.646907574704656,
        "top1_accuracy": 0.42112578179291177,
        "evaluated_queries": 1439,
        "no_relevant_queries_excluded": 61,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 7500,
      "eligible_test_rows": 7500,
      "patients": 750,
      "positive_count": 3545
    },
    "facilities": {
      "model": {
        "ndcg@5": 0.6277173987954685,
        "mrr": 0.5263333333333333,
        "top1_accuracy": 0.278,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "baseline": {
        "ndcg@5": 0.5890906846811124,
        "mrr": 0.47959999999999997,
        "top1_accuracy": 0.22733333333333333,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "guarded_baseline": {
        "ndcg@5": 0.5890906846811124,
        "mrr": 0.47959999999999997,
        "top1_accuracy": 0.22733333333333333,
        "evaluated_queries": 1500,
        "no_relevant_queries_excluded": 0,
        "single_candidate_queries_excluded": 0
      },
      "test_rows": 9000,
      "eligible_test_rows": 7908,
      "patients": 750,
      "positive_count": 1500
    }
  },
  "feature_importance": {
    "barrier": [
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.3455040837410178
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.30694914221466263
      },
      {
        "feature": "distance_km",
        "gain_share": 0.1524871029394793
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.12239666348187601
      },
      {
        "feature": "age",
        "gain_share": 0.03509140437495383
      },
      {
        "feature": "pref_2",
        "gain_share": 0.020164049892708834
      },
      {
        "feature": "week",
        "gain_share": 0.01549689150492232
      },
      {
        "feature": "pref_3",
        "gain_share": 0.001910661850379278
      },
      {
        "feature": "pref_0",
        "gain_share": 0.0
      },
      {
        "feature": "pref_1",
        "gain_share": 0.0
      }
    ],
    "reminders": [
      {
        "feature": "channel_match",
        "gain_share": 0.39324869643500937
      },
      {
        "feature": "evening",
        "gain_share": 0.23220416757847226
      },
      {
        "feature": "digital_app_or_whatsapp",
        "gain_share": 0.09259870062909556
      },
      {
        "feature": "age",
        "gain_share": 0.04671271140802771
      },
      {
        "feature": "channel_0",
        "gain_share": 0.037958609551791284
      },
      {
        "feature": "distance_km",
        "gain_share": 0.03622658158752186
      },
      {
        "feature": "channel_1",
        "gain_share": 0.03330297215659187
      },
      {
        "feature": "pref_3",
        "gain_share": 0.03078935178819675
      },
      {
        "feature": "digital_literacy",
        "gain_share": 0.020213724461243174
      },
      {
        "feature": "pref_1",
        "gain_share": 0.019182956192322263
      },
      {
        "feature": "channel_2",
        "gain_share": 0.011180887042903858
      },
      {
        "feature": "hour",
        "gain_share": 0.009958068243388624
      },
      {
        "feature": "pref_2",
        "gain_share": 0.008367341119398334
      },
      {
        "feature": "channel_3",
        "gain_share": 0.006457816919530067
      },
      {
        "feature": "pref_0",
        "gain_share": 0.005730147279435362
      },
      {
        "feature": "week",
        "gain_share": 0.005714564567782107
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.005689865712470127
      },
      {
        "feature": "prior_missed_visits",
        "gain_share": 0.004462837326819423
      }
    ],
    "gaps": [
      {
        "feature": "days_overdue",
        "gain_share": 0.8380751698648476
      },
      {
        "feature": "distance_km",
        "gain_share": 0.08034979225821229
      },
      {
        "feature": "gap_type",
        "gain_share": 0.05291493498277424
      },
      {
        "feature": "stage",
        "gain_share": 0.012705272449543052
      },
      {
        "feature": "clinician_priority",
        "gain_share": 0.012578004745815097
      },
      {
        "feature": "caregiver_support",
        "gain_share": 0.0033768256988076467
      }
    ],
    "facilities": [
      {
        "feature": "offers_service",
        "gain_share": 0.46489198678041727
      },
      {
        "feature": "distance_km",
        "gain_share": 0.21472068460649157
      },
      {
        "feature": "appointment_availability",
        "gain_share": 0.18503099585818356
      },
      {
        "feature": "days_since_confirmed",
        "gain_share": 0.13535633275490758
      },
      {
        "feature": "open_now",
        "gain_share": 0.0
      }
    ]
  },
  "selected_parameters": {
    "barrier": {
      "selected_model": "lightgbm-leaves4-trees180-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.680177069683768
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6808383860781274
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6814154033880672
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6798014409201204
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6806782765847478
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6807867467624358
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6807978943897357
        }
      ],
      "validation_objective": -0.6798014409201204,
      "threshold": 0.5
    },
    "reminders": {
      "selected_model": "logistic-C0.01",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": -0.6663183543753488
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": -0.6625132252768784
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": -0.6629195737368752
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": -0.6626188720657226
        },
        {
          "candidate": "logistic-C0.01",
          "validation_objective": -0.6623730676858536
        },
        {
          "candidate": "logistic-C0.1",
          "validation_objective": -0.6624328136647658
        },
        {
          "candidate": "logistic-C1",
          "validation_objective": -0.6624379530803808
        }
      ],
      "validation_objective": -0.6623730676858536,
      "threshold": 0.5
    },
    "gaps": {
      "selected_model": "lightgbm-leaves15-trees120-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6133202054241764
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6140312994368123
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6161446375626976
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6134276990824296
        }
      ],
      "validation_objective": 0.6161446375626976,
      "threshold": null
    },
    "facilities": {
      "selected_model": "lightgbm-leaves4-trees180-engineeredTrue",
      "validation_candidates": [
        {
          "candidate": "lightgbm-leaves7-trees65-engineeredFalse",
          "validation_objective": 0.6222071662623964
        },
        {
          "candidate": "lightgbm-leaves7-trees160-engineeredTrue",
          "validation_objective": 0.6233859269824971
        },
        {
          "candidate": "lightgbm-leaves15-trees120-engineeredTrue",
          "validation_objective": 0.6243072134586463
        },
        {
          "candidate": "lightgbm-leaves4-trees180-engineeredTrue",
          "validation_objective": 0.6259919090929487
        }
      ],
      "validation_objective": 0.6259919090929487,
      "threshold": null
    }
  }
}
```

## Limitations
Reminder policy lift is a noisy, self-normalized off-policy estimate from a synthetic randomized log. It is not measured intervention lift or real-world accuracy. No SMS/WhatsApp/voice transport is connected. Source episode data are preserved; interaction outcomes are simulated. Successful closure is an access target, not clinical urgency. ML never adds gaps or overrides clinician priority.