ML_PYTHON ?= hospital_portal/.venv/bin/python
.PHONY: ml-install ml-data ml-train ml-eval ml-serve ml-test
ml-install:
	$(ML_PYTHON) -m pip install -r ml-service/requirements.txt
ml-data:
	$(ML_PYTHON) ml-service/run.py -m data.synthetic_generator --seed 42
ml-train:
	$(ML_PYTHON) ml-service/run.py -m training.train_all
ml-eval:
	$(ML_PYTHON) ml-service/run.py -m training.evaluate
ml-serve:
	$(ML_PYTHON) ml-service/run.py -m uvicorn api.main:app --host 127.0.0.1 --port 8200
ml-test:
	$(ML_PYTHON) ml-service/run.py -m pytest tests -q

.PHONY: ml-diagnose
ml-diagnose:
	$(ML_PYTHON) ml-service/run.py -m training.diagnose_limits

.PHONY: ml-source-experiment
ml-source-experiment:
	$(ML_PYTHON) ml-service/run.py -m training.source_outcomes

.PHONY: ml-release-check
ml-release-check:
	$(ML_PYTHON) ml-service/run.py -m training.reliability
