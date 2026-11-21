-- Additive ASHA Copilot tables: village beats, beneficiary assignments,
-- offline-first field visits, structured notes, health camps and bulk updates.
-- No existing patient, roster or consent tables are changed.
BEGIN;

CREATE TABLE IF NOT EXISTS asha_village (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	name VARCHAR NOT NULL,
	lat DOUBLE PRECISION NOT NULL,
	lng DOUBLE PRECISION NOT NULL,
	anganwadi_name VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
);

CREATE TABLE IF NOT EXISTS asha_assignment (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	asha_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	village_id UUID,
	household_label VARCHAR,
	lat DOUBLE PRECISION,
	lng DOUBLE PRECISION,
	active BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	UNIQUE (asha_id, mother_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(asha_id) REFERENCES portal_user (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(village_id) REFERENCES asha_village (id)
);

CREATE TABLE IF NOT EXISTS asha_visit (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	asha_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	village_id UUID,
	visit_date VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	priority_score DOUBLE PRECISION,
	priority_reasons JSON NOT NULL,
	outcome JSON NOT NULL,
	client_uuid VARCHAR NOT NULL,
	recorded_at TIMESTAMP WITH TIME ZONE,
	open_key VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	UNIQUE (asha_id, client_uuid),
	UNIQUE (open_key),
	CHECK (status IN ('planned','completed','missed','rescheduled')),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(asha_id) REFERENCES portal_user (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(village_id) REFERENCES asha_village (id)
);

CREATE TABLE IF NOT EXISTS asha_camp (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	asha_id UUID NOT NULL,
	village_id UUID,
	name VARCHAR NOT NULL,
	camp_date VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	CHECK (status IN ('planned','open','closed')),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(asha_id) REFERENCES portal_user (id),
	FOREIGN KEY(village_id) REFERENCES asha_village (id)
);

CREATE TABLE IF NOT EXISTS asha_camp_update (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	camp_id UUID NOT NULL,
	asha_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	child_id UUID,
	kind VARCHAR NOT NULL,
	payload JSON NOT NULL,
	client_uuid VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	UNIQUE (asha_id, client_uuid),
	CHECK (kind IN ('attendance','vitals','immunization','referral_flag')),
	FOREIGN KEY(camp_id) REFERENCES asha_camp (id),
	FOREIGN KEY(asha_id) REFERENCES portal_user (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(child_id) REFERENCES child (id)
);

CREATE TABLE IF NOT EXISTS asha_note (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	asha_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	visit_id UUID,
	camp_update_id UUID,
	transcript VARCHAR NOT NULL,
	structured JSON NOT NULL,
	recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
	client_uuid VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	UNIQUE (asha_id, client_uuid),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(asha_id) REFERENCES portal_user (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(visit_id) REFERENCES asha_visit (id),
	FOREIGN KEY(camp_update_id) REFERENCES asha_camp_update (id)
);

CREATE INDEX IF NOT EXISTS asha_assignment_worker_idx ON asha_assignment (asha_id, active);
CREATE INDEX IF NOT EXISTS asha_visit_day_idx ON asha_visit (asha_id, visit_date);
CREATE INDEX IF NOT EXISTS asha_note_mother_idx ON asha_note (mother_id, recorded_at);

COMMIT;
