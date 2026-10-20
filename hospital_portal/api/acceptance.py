"""Read-only import and deployment acceptance. Exit 2 means a platform gate is pending."""

import json
from pathlib import Path
from sqlalchemy import select, func, text
from . import schema as s
from .db import database


def check(engine):
    results = []

    def record(name, passed, count):
        results.append(
            {"check": name, "status": "PASS" if passed else "FAIL", "count": count}
        )

    with engine.connect() as c:
        counts = {
            name: c.scalar(select(func.count()).select_from(t))
            for name, t in s.metadata.tables.items()
        }
        record("2000 imported mothers", counts["mother"] == 2000, counts["mother"])
        high = c.scalar(
            select(func.count())
            .select_from(s.mother)
            .where(s.mother.c.clinician_high_risk)
        )
        record("12 percent existing clinician-confirmed high-risk", high == 240, high)
        mismatch = c.scalar(
            select(func.count())
            .select_from(
                s.mother.join(
                    s.user, s.mother.c.assigned_doctor_id == s.user.c.id
                ).join(s.unit, s.mother.c.assigned_unit_id == s.unit.c.id)
            )
            .where(
                (s.mother.c.registered_facility_id != s.user.c.facility_id)
                | (s.mother.c.registered_facility_id != s.unit.c.facility_id)
                | (s.user.c.unit_id != s.unit.c.id)
            )
        )
        record(
            "Mother / unit / assigned doctor facility chain", mismatch == 0, mismatch
        )
        unknown = c.scalar(
            select(func.count())
            .select_from(s.mother)
            .where(s.mother.c.clinician_high_risk, s.mother.c.validated_by.is_(None))
        )
        record("Clinician validation preserved", unknown == 0, unknown)
        ward_fail = 0
        for w in c.execute(select(s.ward)).mappings():
            actual = c.scalar(
                select(func.count())
                .select_from(s.bed)
                .where(s.bed.c.ward_id == w["id"])
            )
            ward_fail += actual != w["capacity"]
        record("Ward capacity equals actual bed rows", ward_fail == 0, ward_fail)
        # Portable foreign-key audit supplements enforced constraints and verifies all imported entities.
        orphans = 0
        for table in s.metadata.tables.values():
            for fk in table.foreign_keys:
                target = fk.column.table
                orphans += c.scalar(
                    select(func.count())
                    .select_from(table.outerjoin(target, fk.parent == fk.column))
                    .where(fk.parent.is_not(None), fk.column.is_(None))
                )
        record("Every foreign key resolves", orphans == 0, orphans)
        if engine.dialect.name == "postgresql":
            version = c.scalar(text("SELECT PostGIS_Version()"))
            spatial = c.scalar(
                text(
                    "SELECT count(*) FROM facility WHERE ST_SRID(location::geometry)=4326 AND ST_X(location::geometry)=lng AND ST_Y(location::geometry)=lat"
                )
            )
            record(
                "PostGIS geography and coordinates",
                spatial == counts["facility"],
                spatial,
            )
            record("PostGIS extension available", bool(version), version)
        else:
            results.append(
                {
                    "check": "PostgreSQL/PostGIS runtime acceptance",
                    "status": "PENDING",
                    "reason": "This run uses SQLite. Run against the dedicated Compose database.",
                }
            )
    return {
        "phase": 1,
        "database": engine.dialect.name,
        "data_label": "Simulated on synthetic data",
        "counts": counts,
        "checks": results,
        "phase_2_unlocked": all(r["status"] == "PASS" for r in results),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--report")
    args = parser.parse_args()
    result = check(database())
    output = json.dumps(result, indent=2)
    if args.report:
        Path(args.report).write_text(output + "\n")
    print(output)
    raise SystemExit(
        0
        if result["phase_2_unlocked"]
        else 1
        if any(r["status"] == "FAIL" for r in result["checks"])
        else 2
    )
