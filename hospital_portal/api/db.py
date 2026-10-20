import os
from sqlalchemy import create_engine, event
from .schema import metadata


def database(url=None):
    url = url or os.getenv("DATABASE_URL", "sqlite:///./portal-preview.db")
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 30}
        if url.startswith("sqlite")
        else {},
        pool_pre_ping=True,
    )
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def sqlite_constraints(dbapi, record):
            dbapi.execute("PRAGMA foreign_keys=ON")

    return engine


def initialize(engine):
    metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        with engine.begin() as c:
            # Available in the PostGIS Compose image. Keep coordinates queryable by spatial index.
            c.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
            c.exec_driver_sql(
                "ALTER TABLE facility ADD COLUMN IF NOT EXISTS location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED"
            )
            c.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS facility_location_idx ON facility USING GIST(location)"
            )
