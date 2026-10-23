-- DAI synthetic hospital portal. Generated from api/schema.py.
CREATE EXTENSION IF NOT EXISTS postgis;


CREATE TABLE facility (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	name VARCHAR NOT NULL,
	tier VARCHAR NOT NULL,
	ownership VARCHAR NOT NULL,
	address VARCHAR NOT NULL,
	lat FLOAT NOT NULL,
	lng FLOAT NOT NULL,
	abdm_facility_id VARCHAR,
	nabh_status VARCHAR,
	nabl_status VARCHAR,
	emergency_24x7 BOOLEAN NOT NULL,
	sos_participating BOOLEAN NOT NULL,
	authorized_beds INTEGER NOT NULL,
	functional_beds INTEGER NOT NULL,
	capabilities JSON NOT NULL,
	PRIMARY KEY (id),
	CHECK (authorized_beds >= functional_beds AND functional_beds >= 0),
	UNIQUE (source_id)
)

;


CREATE TABLE role_permission (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	role VARCHAR NOT NULL,
	permission VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (role, permission),
	UNIQUE (source_id)
)

;


CREATE TABLE inventory_item (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	name VARCHAR NOT NULL,
	unit VARCHAR NOT NULL,
	reorder_level INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id)
)

;


CREATE TABLE ml_model_registry (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	name VARCHAR NOT NULL,
	version VARCHAR NOT NULL,
	metrics JSON NOT NULL,
	trained_on VARCHAR NOT NULL,
	data_label VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id)
)

;


CREATE TABLE seed_manifest (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	source_sha256 VARCHAR NOT NULL,
	as_of_date VARCHAR NOT NULL,
	counts JSON NOT NULL,
	assumptions JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id)
)

;


CREATE TABLE department (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	name VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE patient (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	name VARCHAR NOT NULL,
	subject_type VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE blood_stock_snapshot (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	blood_group VARCHAR NOT NULL,
	component VARCHAR NOT NULL,
	units INTEGER NOT NULL,
	snapshot_at VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE inventory_stock (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	item_id UUID NOT NULL,
	quantity INTEGER NOT NULL,
	expiry VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(item_id) REFERENCES inventory_item (id)
)

;


CREATE TABLE inventory_consumption (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	item_id UUID NOT NULL,
	quantity INTEGER NOT NULL,
	consumed_at VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(item_id) REFERENCES inventory_item (id)
)

;


CREATE TABLE staff_post (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	cadre VARCHAR NOT NULL,
	sanctioned INTEGER NOT NULL,
	in_position INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE shift (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	name VARCHAR NOT NULL,
	start_time VARCHAR NOT NULL,
	end_time VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE alert (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	type VARCHAR NOT NULL,
	severity VARCHAR NOT NULL,
	reason_text VARCHAR NOT NULL,
	inputs_json JSON NOT NULL,
	status VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE organisation_role (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	role_name VARCHAR NOT NULL,
	fictional_holder_name VARCHAR NOT NULL,
	email VARCHAR NOT NULL,
	appointed_on VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE admin_record (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	kind VARCHAR NOT NULL,
	payload JSON NOT NULL,
	version INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE ward (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	department_id UUID,
	name VARCHAR NOT NULL,
	care_area VARCHAR NOT NULL,
	capacity INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(department_id) REFERENCES department (id)
)

;


CREATE TABLE unit (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	department_id UUID NOT NULL,
	code VARCHAR NOT NULL,
	anc_day INTEGER,
	gynae_day INTEGER,
	opd_day INTEGER,
	ot_day INTEGER,
	ward_id UUID,
	gynae_ward_id UUID,
	labour_room_id UUID,
	room VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(department_id) REFERENCES department (id),
	FOREIGN KEY(ward_id) REFERENCES ward (id),
	FOREIGN KEY(gynae_ward_id) REFERENCES ward (id),
	FOREIGN KEY(labour_room_id) REFERENCES ward (id)
)

;


CREATE TABLE bed (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ward_id UUID NOT NULL,
	label VARCHAR NOT NULL,
	type VARCHAR NOT NULL,
	has_oxygen BOOLEAN NOT NULL,
	has_monitor BOOLEAN NOT NULL,
	has_ventilator BOOLEAN NOT NULL,
	status VARCHAR NOT NULL,
	status_since TIMESTAMP WITH TIME ZONE NOT NULL,
	current_patient_id UUID,
	version INTEGER NOT NULL,
	PRIMARY KEY (id),
	CHECK (status IN ('AVAILABLE','OCCUPIED','CLEANING','MAINTENANCE','RESERVED')),
	UNIQUE (source_id),
	FOREIGN KEY(ward_id) REFERENCES ward (id),
	FOREIGN KEY(current_patient_id) REFERENCES patient (id)
)

;


CREATE TABLE critical_unit (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	ward_id UUID NOT NULL,
	category VARCHAR NOT NULL,
	bed_count INTEGER NOT NULL,
	ventilator_count INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(ward_id) REFERENCES ward (id)
)

;


CREATE TABLE equipment (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ward_id UUID NOT NULL,
	type VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	last_service VARCHAR,
	next_service_due VARCHAR,
	usage_hours INTEGER,
	fault_count INTEGER,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(ward_id) REFERENCES ward (id)
)

;


CREATE TABLE clinic (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	unit_id UUID NOT NULL,
	name VARCHAR NOT NULL,
	day INTEGER NOT NULL,
	start_time VARCHAR NOT NULL,
	end_time VARCHAR NOT NULL,
	room VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(unit_id) REFERENCES unit (id)
)

;


CREATE TABLE portal_user (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	department_id UUID,
	unit_id UUID,
	name VARCHAR NOT NULL,
	email VARCHAR NOT NULL,
	role VARCHAR NOT NULL,
	registration_no VARCHAR,
	verified BOOLEAN NOT NULL,
	password_hash VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (email),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(department_id) REFERENCES department (id),
	FOREIGN KEY(unit_id) REFERENCES unit (id)
)

;


CREATE TABLE equipment_fault_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	equipment_id UUID NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(equipment_id) REFERENCES equipment (id)
)

;


CREATE TABLE mother (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	patient_id UUID NOT NULL,
	registered_facility_id UUID NOT NULL,
	assigned_unit_id UUID NOT NULL,
	assigned_doctor_id UUID NOT NULL,
	uhid VARCHAR NOT NULL,
	abha_id VARCHAR,
	age INTEGER NOT NULL,
	edd VARCHAR,
	gestation_weeks INTEGER,
	blood_group VARCHAR,
	clinician_high_risk BOOLEAN NOT NULL,
	high_risk_reason_by_clinician VARCHAR,
	validated_by UUID,
	consent_flags JSON NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (uhid),
	UNIQUE (source_id),
	FOREIGN KEY(patient_id) REFERENCES patient (id),
	FOREIGN KEY(registered_facility_id) REFERENCES facility (id),
	FOREIGN KEY(assigned_unit_id) REFERENCES unit (id),
	FOREIGN KEY(assigned_doctor_id) REFERENCES portal_user (id),
	FOREIGN KEY(validated_by) REFERENCES portal_user (id)
)

;


CREATE TABLE bed_state_history (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	bed_id UUID NOT NULL,
	previous_status VARCHAR,
	status VARCHAR NOT NULL,
	patient_id UUID,
	actor_id UUID,
	reason VARCHAR NOT NULL,
	effective_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(bed_id) REFERENCES bed (id),
	FOREIGN KEY(patient_id) REFERENCES patient (id),
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;


CREATE TABLE admission (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	bed_id UUID NOT NULL,
	admitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
	discharged_at TIMESTAMP WITH TIME ZONE,
	actor_id UUID,
	discharge_summary VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(patient_id) REFERENCES patient (id),
	FOREIGN KEY(bed_id) REFERENCES bed (id),
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;


CREATE TABLE roster_entry (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	user_id UUID,
	ward_id UUID,
	roster_date VARCHAR NOT NULL,
	start_time VARCHAR NOT NULL,
	end_time VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id),
	FOREIGN KEY(ward_id) REFERENCES ward (id)
)

;


CREATE TABLE on_call_entry (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	user_id UUID NOT NULL,
	day VARCHAR NOT NULL,
	start_time VARCHAR NOT NULL,
	end_time VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id)
)

;


CREATE TABLE staff_leave (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	user_id UUID NOT NULL,
	start_date VARCHAR NOT NULL,
	end_date VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id)
)

;


CREATE TABLE ambulance (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	label VARCHAR NOT NULL,
	type VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	gps_lat FLOAT,
	gps_lng FLOAT,
	driver_id UUID,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(driver_id) REFERENCES portal_user (id)
)

;


CREATE TABLE audit_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	actor_id UUID,
	action VARCHAR NOT NULL,
	entity_type VARCHAR NOT NULL,
	entity_id VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;


CREATE TABLE ml_prediction (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	model_name VARCHAR NOT NULL,
	target_date VARCHAR NOT NULL,
	value FLOAT,
	lower FLOAT,
	upper FLOAT,
	explanation_json JSON NOT NULL,
	accepted_by UUID,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(accepted_by) REFERENCES portal_user (id)
)

;


CREATE TABLE auth_challenge (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	user_id UUID NOT NULL,
	otp_hash VARCHAR NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	attempts INTEGER NOT NULL,
	consumed BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id)
)

;


CREATE TABLE auth_session (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	user_id UUID NOT NULL,
	refresh_hash VARCHAR NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	revoked BOOLEAN NOT NULL,
	impersonated_by UUID,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id),
	FOREIGN KEY(impersonated_by) REFERENCES portal_user (id)
)

;


CREATE TABLE sustainability_measurement (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	recorded_by UUID NOT NULL,
	period VARCHAR NOT NULL,
	metric VARCHAR NOT NULL,
	value FLOAT NOT NULL,
	quality VARCHAR NOT NULL,
	source VARCHAR NOT NULL,
	evidence VARCHAR NOT NULL,
	occupied_bed_days INTEGER,
	PRIMARY KEY (id),
	UNIQUE (facility_id, period, metric),
	CHECK (value >= 0),
	CHECK (occupied_bed_days IS NULL OR occupied_bed_days > 0),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(recorded_by) REFERENCES portal_user (id)
)

;


CREATE TABLE sustainability_action (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	owner_id UUID NOT NULL,
	title VARCHAR NOT NULL,
	metric VARCHAR NOT NULL,
	baseline FLOAT NOT NULL,
	target FLOAT NOT NULL,
	unit VARCHAR NOT NULL,
	due_date VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	CHECK (baseline >= 0 AND target >= 0),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(owner_id) REFERENCES portal_user (id)
)

;


CREATE TABLE staff_affiliation (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	user_id UUID,
	email VARCHAR NOT NULL,
	name VARCHAR NOT NULL,
	role VARCHAR NOT NULL,
	department_id UUID,
	unit_id UUID,
	registration_no VARCHAR,
	verified BOOLEAN NOT NULL,
	active BOOLEAN NOT NULL,
	version INTEGER NOT NULL,
	invite_hash VARCHAR,
	expires_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	UNIQUE (facility_id, email),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(user_id) REFERENCES portal_user (id),
	FOREIGN KEY(department_id) REFERENCES department (id),
	FOREIGN KEY(unit_id) REFERENCES unit (id)
)

;


CREATE TABLE child (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	birth_order INTEGER NOT NULL,
	date_of_birth VARCHAR NOT NULL,
	birth_weight_g INTEGER NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(patient_id) REFERENCES patient (id)
)

;


CREATE TABLE anc_visit (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	doctor_id UUID,
	facility_id UUID NOT NULL,
	visit_date VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(doctor_id) REFERENCES portal_user (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE investigation_order (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	facility_id UUID NOT NULL,
	test VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	due_date VARCHAR,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE delivery_record (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	facility_id UUID NOT NULL,
	doctor_id UUID NOT NULL,
	labour_room_id UUID NOT NULL,
	bed_id UUID NOT NULL,
	mode VARCHAR NOT NULL,
	delivered_at VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(doctor_id) REFERENCES portal_user (id),
	FOREIGN KEY(labour_room_id) REFERENCES ward (id),
	FOREIGN KEY(bed_id) REFERENCES bed (id)
)

;


CREATE TABLE postnatal_followup (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	due_date VARCHAR NOT NULL,
	completed_at VARCHAR,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id)
)

;


CREATE TABLE blood_request (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	blood_group VARCHAR NOT NULL,
	component VARCHAR NOT NULL,
	units INTEGER NOT NULL,
	status VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id)
)

;


CREATE TABLE dispatch_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ambulance_id UUID NOT NULL,
	mother_id UUID,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(ambulance_id) REFERENCES ambulance (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id)
)

;


CREATE TABLE sos_request (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	lat FLOAT,
	lng FLOAT,
	trigger_time VARCHAR NOT NULL,
	auth_layer_1_ok BOOLEAN NOT NULL,
	auth_layer_2_ok BOOLEAN NOT NULL,
	status VARCHAR NOT NULL,
	accepted_facility_id UUID,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(accepted_facility_id) REFERENCES facility (id)
)

;


CREATE TABLE referral (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	from_facility_id UUID NOT NULL,
	to_facility_id UUID NOT NULL,
	mother_id UUID NOT NULL,
	reason VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(from_facility_id) REFERENCES facility (id),
	FOREIGN KEY(to_facility_id) REFERENCES facility (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id)
)

;


CREATE TABLE readiness_check (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	facility_id UUID NOT NULL,
	score INTEGER NOT NULL,
	status VARCHAR NOT NULL,
	missing_items JSON NOT NULL,
	inputs JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE reservation (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	resource_type VARCHAR NOT NULL,
	bed_id UUID,
	mother_id UUID NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	state VARCHAR NOT NULL,
	accepted_by UUID NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(bed_id) REFERENCES bed (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(accepted_by) REFERENCES portal_user (id)
)

;


CREATE TABLE worklist_item (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	mother_id UUID,
	assigned_to UUID,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(assigned_to) REFERENCES portal_user (id)
)

;


CREATE TABLE review_case (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	facility_id UUID NOT NULL,
	mother_id UUID,
	type VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(facility_id) REFERENCES facility (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id)
)

;


CREATE TABLE consent_ledger (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	actor_id UUID,
	purpose VARCHAR NOT NULL,
	granted BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;


CREATE TABLE break_glass_event (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID NOT NULL,
	actor_id UUID NOT NULL,
	reason VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(actor_id) REFERENCES portal_user (id)
)

;


CREATE TABLE icu_admission_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	critical_unit_id UUID NOT NULL,
	admission_id UUID NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(critical_unit_id) REFERENCES critical_unit (id),
	FOREIGN KEY(admission_id) REFERENCES admission (id)
)

;


CREATE TABLE session_scope (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	session_id UUID NOT NULL,
	affiliation_id UUID NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (session_id),
	UNIQUE (source_id),
	FOREIGN KEY(session_id) REFERENCES auth_session (id),
	FOREIGN KEY(affiliation_id) REFERENCES staff_affiliation (id)
)

;


CREATE TABLE investigation_result (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	order_id UUID NOT NULL,
	uploaded_by UUID,
	values JSON NOT NULL,
	report_key VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(order_id) REFERENCES investigation_order (id),
	FOREIGN KEY(uploaded_by) REFERENCES portal_user (id)
)

;


CREATE TABLE birth_record (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	delivery_id UUID NOT NULL,
	child_id UUID NOT NULL,
	birth_order INTEGER NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(delivery_id) REFERENCES delivery_record (id),
	FOREIGN KEY(child_id) REFERENCES child (id)
)

;


CREATE TABLE vaccination_record (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	child_id UUID,
	mother_id UUID,
	facility_id UUID NOT NULL,
	vaccine VARCHAR NOT NULL,
	due_date VARCHAR NOT NULL,
	given_date VARCHAR,
	status VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(child_id) REFERENCES child (id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE care_gap (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mother_id UUID,
	child_id UUID,
	order_id UUID,
	expected_item VARCHAR NOT NULL,
	due_date VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(mother_id) REFERENCES mother (id),
	FOREIGN KEY(child_id) REFERENCES child (id),
	FOREIGN KEY(order_id) REFERENCES investigation_order (id)
)

;


CREATE TABLE blood_issue_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	request_id UUID,
	facility_id UUID NOT NULL,
	units INTEGER NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(request_id) REFERENCES blood_request (id),
	FOREIGN KEY(facility_id) REFERENCES facility (id)
)

;


CREATE TABLE sos_event_timeline (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	sos_id UUID NOT NULL,
	event VARCHAR NOT NULL,
	event_time VARCHAR NOT NULL,
	details JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(sos_id) REFERENCES sos_request (id)
)

;


CREATE TABLE sos_abuse_log (
	id UUID NOT NULL,
	source_id VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	sos_id UUID NOT NULL,
	reason VARCHAR NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (source_id),
	FOREIGN KEY(sos_id) REFERENCES sos_request (id)
)

;

ALTER TABLE facility ADD COLUMN location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED;

CREATE INDEX facility_location_idx ON facility USING GIST(location);
