-- Additive operations intelligence tables. No patient or roster tables are changed.
BEGIN;

CREATE TABLE IF NOT EXISTS operations_availability (
	id UUID NOT NULL, 
	source_id VARCHAR, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	facility_id UUID NOT NULL, 
	staff_id UUID NOT NULL, 
	declared_by UUID NOT NULL, 
	starts_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	ends_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	domains JSON NOT NULL, 
	source VARCHAR NOT NULL, 
	active BOOLEAN NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (ends_at > starts_at), 
	UNIQUE (source_id), 
	FOREIGN KEY(facility_id) REFERENCES facility (id), 
	FOREIGN KEY(staff_id) REFERENCES portal_user (id), 
	FOREIGN KEY(declared_by) REFERENCES portal_user (id)
)

;

CREATE TABLE IF NOT EXISTS operations_run (
	id UUID NOT NULL, 
	source_id VARCHAR, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	facility_id UUID NOT NULL, 
	actor_id UUID NOT NULL, 
	input_hash VARCHAR NOT NULL, 
	state VARCHAR NOT NULL, 
	version INTEGER NOT NULL, 
	payload JSON NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (state IN ('draft','approved','rejected')), 
	UNIQUE (source_id), 
	FOREIGN KEY(facility_id) REFERENCES facility (id), 
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;

CREATE TABLE IF NOT EXISTS operations_assignment (
	id UUID NOT NULL, 
	source_id VARCHAR, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	facility_id UUID NOT NULL, 
	run_id UUID NOT NULL, 
	ticket_id UUID NOT NULL, 
	staff_id UUID NOT NULL, 
	availability_id UUID NOT NULL, 
	starts_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	ends_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (ticket_id), 
	CHECK (ends_at > starts_at), 
	UNIQUE (source_id), 
	FOREIGN KEY(facility_id) REFERENCES facility (id), 
	FOREIGN KEY(run_id) REFERENCES operations_run (id), 
	FOREIGN KEY(ticket_id) REFERENCES sustainability_ticket (id), 
	FOREIGN KEY(staff_id) REFERENCES portal_user (id), 
	FOREIGN KEY(availability_id) REFERENCES operations_availability (id)
)

;

CREATE TABLE IF NOT EXISTS operations_ai_usage (
	id UUID NOT NULL, 
	source_id VARCHAR, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	facility_id UUID NOT NULL, 
	actor_id UUID NOT NULL, 
	run_id UUID NOT NULL, 
	cache_hit BOOLEAN NOT NULL, 
	provider_attempts INTEGER NOT NULL, 
	reported_total_tokens INTEGER, 
	tool_calls INTEGER NOT NULL, 
	latency_ms FLOAT NOT NULL, 
	source VARCHAR NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (source_id), 
	FOREIGN KEY(facility_id) REFERENCES facility (id), 
	FOREIGN KEY(actor_id) REFERENCES portal_user (id), 
	FOREIGN KEY(run_id) REFERENCES operations_run (id)
)

;
COMMIT;
