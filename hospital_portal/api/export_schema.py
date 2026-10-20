"""Export the actual SQLAlchemy model as PostgreSQL-compatible DDL."""

from pathlib import Path
from sqlalchemy import create_mock_engine
from .schema import metadata

lines = [
    "-- DAI synthetic hospital portal. Generated from api/schema.py.\nCREATE EXTENSION IF NOT EXISTS postgis;"
]
engine = None


def emit(sql, *args, **kwargs):
    lines.append(str(sql.compile(dialect=engine.dialect)) + ";")


engine = create_mock_engine("postgresql+psycopg://", emit)
metadata.create_all(engine, checkfirst=False)
lines.extend(
    [
        "ALTER TABLE facility ADD COLUMN location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED;",
        "CREATE INDEX facility_location_idx ON facility USING GIST(location);",
    ]
)
if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "schema.sql"
    target.write_text("\n".join(line.rstrip() for line in "\n\n".join(lines).splitlines()) + "\n")
    print(target)
