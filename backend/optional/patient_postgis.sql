-- Optional: apply only to the patient API's actual PostgreSQL database.
-- PGlite/local mode deliberately uses the tested haversine fallback.
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS location geography(Point,4326)
 GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude::double precision,latitude::double precision),4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS patient_facilities_location_gist ON facilities USING GIST(location);
