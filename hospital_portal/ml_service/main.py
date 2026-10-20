"""Phase-five boundary. Never manufacture a prediction or clinical label."""

from fastapi import FastAPI, HTTPException

app = FastAPI(title="DAI operational ML service — roadmap")


@app.get("/health")
def health():
    return {
        "status": "scaffold",
        "data_label": "Simulated on synthetic data",
        "models_trained": False,
        "phase": 5,
    }


@app.get("/predictions")
def predictions():
    raise HTTPException(
        501,
        "Operational models are not trained. Phase 5 requires 24-month history, time-based evaluation and explainable outputs.",
    )
