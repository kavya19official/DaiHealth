"""Store precomputed forecasts without loading the model training stack."""

LABEL = "Trained on synthetic data — not validated on real hospital activity"


def persist_predictions(reports, engine=None):
    from sqlalchemy import select, delete

    if __package__.startswith("hospital_portal."):
        from ..api import schema as s
        from ..api.db import database, initialize
        from ..api.seed import uid
    else:
        from api import schema as s
        from api.db import database, initialize
        from api.seed import uid

    engine = engine or database()
    initialize(engine)
    with engine.begin() as c:
        for report in reports:
            fid = uid("facility", report["hospital_id"])
            if not c.scalar(select(s.facility.c.id).where(s.facility.c.id == fid)):
                raise ValueError("Seed the portal database before persisting forecasts")
            source_id = (
                "ops-ml:" + report["model_version"] + ":" + report["hospital_id"]
            )
            c.execute(
                delete(s.ml_model_registry).where(
                    s.ml_model_registry.c.source_id == source_id
                )
            )
            c.execute(
                s.ml_model_registry.insert().values(
                    source_id=source_id,
                    name="operational_forecast:" + report["hospital_id"],
                    version=report["model_version"],
                    metrics={
                        "evaluation": report["evaluation"],
                        "splits": report["splits"],
                    },
                    trained_on=report["history_start"] + ".." + report["history_end"],
                    data_label=LABEL,
                )
            )
            for target, rows in report["forecast"].items():
                for row in rows:
                    key = source_id + ":" + target + ":" + row["date"]
                    c.execute(
                        delete(s.ml_prediction).where(
                            s.ml_prediction.c.source_id == key
                        )
                    )
                    c.execute(
                        s.ml_prediction.insert().values(
                            source_id=key,
                            facility_id=fid,
                            model_name=target + ":" + row["selected_method"],
                            target_date=row["date"],
                            value=row["value"],
                            lower=row["lower"],
                            upper=row["upper"],
                            explanation_json={
                                "version": report["model_version"],
                                "data_label": LABEL,
                                "range_method": report["range_method"],
                                "accepted": False,
                            },
                        )
                    )
