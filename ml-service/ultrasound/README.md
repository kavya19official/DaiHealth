# Fetal ultrasound archive audit and research pipeline

## Audit decision

**Kaggle v2 is blocked for training.** The original partitions are contaminated and the surviving records cannot support a three-class evaluation. These are observations from the actual 632,918,233-byte download, with SHA-256 `edb036207c35bda609571900ddb73b7d5815bea9327b8984239c01507e20b029`.

| Original split | Normal | Benign | Malignant | Total |
| --- | ---: | ---: | ---: | ---: |
| Train | 242 | 241 | 1,443 | 1,926 |
| Validation | 43 | 43 | 255 | 341 |
| Test | 50 | 51 | 300 | 401 |
| Total | 335 | 335 | 1,998 | 2,668 |

- **Annotation leakage.** All 999 filename-marked annotations inside the splits are in the Malignant folder. Train has 714, validation 133, and test 152. The aggregate folder contains 2,964 image files and the overlay folder contains 401. Both folders are excluded.
- **Conflicting labels.** There are 335 groups of byte-identical images carrying both Normal and Benign labels. Of these, 143 groups cross original split boundaries. Decoded-pixel hashing detects 336 repeated groups in total, 144 across splits, and 335 with conflicting labels. One confirmed example is `test/benign/101_HC.png` and `train/normal/101_HC.png`. Filename patterns alone cannot identify patients.
- **Near duplicates.** The conservative candidate rule required both 64-bit perceptual and difference hash distances to be at most six. It flagged 15 additional pairs, four across splits. Perceptual checks cannot rule out leakage from different frames of the same study.
- **Image integrity and quality.** All 2,668 images in the named splits decoded, including the 999 excluded derivatives. Among the 1,669 non-annotation images, 1,629 are 800×540. No non-annotation image triggered the small-image, low-contrast, or low-detail thresholds. These are raster heuristics and do not establish acquisition quality, anatomy, or de-identification. The audit does not validate on-image marks, clinical adequacy, or scanner/site diversity.
- **No patient/study linkage or label verification.** One CSV is a folder count inventory and the other contains 2,126 numeric monitoring records without a usable label join to image files. Neither contains a patient/study ID mapping for the images. The archive also includes a bundled ResNet checkpoint. That file is ignored and never deserialized. No independent image-level reference standard or adjudication was available.
- **After exclusions.** Cross-label or cross-split duplicate components are quarantined in full. Six within-split repeats were then excluded. The remaining counts are 719 train, 122 validation, and 143 test images, **all labeled Malignant**. They are quality/duplicate survivors, not a trainable cohort. The reported class names are archive labels.

Source: [Orvile, Ultrasound Fetus Dataset (Kaggle v2)](https://www.kaggle.com/datasets/orvile/ultrasound-fetus-dataset), whose metadata cites [Anitha (2024), Mendeley Data v1](https://doi.org/10.17632/yrzzw9m6kk.1), CC BY 4.0. The publisher's [Mendeley v2 listing](https://data.mendeley.com/datasets/yrzzw9m6kk/2) documents another release by the same contributor. Its public listing provides no independent adjudication or image-to-patient mapping. The [FETAL_PLANES_DB](https://zenodo.org/records/3904280) offers expert anatomical-plane labels and a patient identifier, suitable for a separate plane-recognition study. Its labels do not substantiate the Kaggle archive's Normal, Benign or Malignant classes. No independently adjudicated cohort for those classes was identified.

## Reproduce the audit

From the repository root, create a dedicated Python 3.12 environment. The first install command below is for Linux/Windows CPU. On macOS use the default PyPI index for the pinned Torch packages. To download the source from Kaggle, use the public Kaggle API or KaggleHub with `kagglehub.dataset_download("orvile/ultrasound-fetus-dataset")`.

```sh
cd ml-service
python3.12 -m venv ultrasound/local/venv
. ultrasound/local/venv/bin/activate
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchvision==0.23.0
python -m pip install -r ultrasound/requirements.txt
curl -fL 'https://www.kaggle.com/api/v1/datasets/download/orvile/ultrasound-fetus-dataset' \
  -o ultrasound/local/ultrasound-fetus-dataset.zip
python -m ultrasound.audit ultrasound/local/ultrasound-fetus-dataset.zip --output ultrasound/local/audit.json
python -m pytest -q tests/test_ultrasound_research.py
```

The JSON includes split counts, per-file hashes and quality statistics, exclusion reasons, duplicate components, CSV inventory and training blockers. Input images and audit manifests with filenames should remain in the private research workspace. The auditor streams images from ZIP members without extracting their paths. It preserves the original split of every eligible image.

## Train on a corrected, reviewed cohort

Obtain corrected labels from the source, establish a reference standard, and obtain a de-identified subject-level mapping that ties all exams and frames for each patient to one group. Study IDs alone are insufficient if a patient can contribute multiple studies. Keep the original splits if they pass group and image checks. If the originals fail, prepare a corrected archive with independently disjoint patient splits before training. Never relabel conflicting images based on model predictions or rename an image to evade quarantine.

`groups.csv` must have `path,group_id` columns, using original ZIP member paths and stable de-identified group IDs. Use a separate review JSON with `archive_sha256`, `group_map_sha256`, `reviewer`, `grouping_provenance`, `label_reference_standard`, and `approved_for_research: true`. The runner audits the current archive again and verifies both hashes against that record. Text approvals must reflect actual reviewer work.

```sh
python -m ultrasound.training /path/to/corrected.zip \
  --groups /private/groups.csv --review /private/dataset-review.json \
  --output ultrasound/local/run-001
```

The training pipeline uses ImageNet-pretrained EfficientNet-B0, aspect-preserving 224×224 grayscale-to-RGB letterboxing, a three-output head, and class-weighted cross-entropy. It learns the head first and fine-tunes the final feature stage. Validation macro F1 selects the checkpoint. Temperature scaling uses validation logits only. The original held-out test is used after fitting; it reports per-class precision, recall and F1, macro and weighted F1, confusion matrix, one-vs-rest ROC-AUC, average precision, Brier score, NLL and ECE with reliability bins, before and after calibration. Review minority-class support, shortcut risk, reliability, and uncertainty on an independent cohort before broadening use.

Outputs include the state dict, hashed model manifest, class order, preprocessing and calibration settings, audit manifest, evaluation JSON, and epoch history. The original archive generated **no** model or performance metrics.

## Serve an evaluated research artifact

A qualified research reviewer verifies the reference standard, patient independence, evaluation and routing policy. Only after that review, place a release record named `release.json` in the trusted run directory. Its fields are the exact SHA-256 of `model.json` under `model_manifest_sha256`, the named `reviewer`, and `approved_for_research_inference` set to true. Keep the run directory read-only to the serving account. Mount it only on the private ML service and set `DAI_ULTRASOUND_MODEL_DIR` to its absolute path. The loader validates the release, architecture, preprocessing, audit, evaluation and weight hashes before loading the weights-only checkpoint. Restart the service when changing artifacts. The model version reported to the portal is the manifest hash, which binds weights, preprocessing and calibration.

For a local launcher with a reviewed artifact, install the pinned Torch packages in `hospital_portal/.venv` in addition to the launcher's default packages. Alternatively run the same existing ML service from a separate venv with the service's `requirements.txt` plus the pinned Torch packages. Point the portal at its authenticated private HTTPS origin. A local custom loopback port is also supported for development with manually started services.

See [the hospital integration guide](../../hospital_portal/ULTRASOUND_AI_REVIEW.md) for the authenticated service route, provider upload and clinician workflow. The portal handles persistent review. The previous isolated research queue is superseded by the portal.

The reproduced, aggregate-only results are in [kaggle-v2-audit-summary.json](kaggle-v2-audit-summary.json). Raw dataset files, per-file archive manifests and model artifacts belong in the private working directory.
