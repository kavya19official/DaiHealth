"""Freshness, geography suppression and API permission boundaries."""
import sqlite3
from hospital_portal.api.capacity_board import capacity_rows
from hospital_portal.api.quality_board import quality_rows
from hospital_portal.tests.test_workspace import workspace, sign_in


def test_capacity_preserves_unknown_staff_confirmation_and_real_zero_stock():
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE wards(ward_id TEXT,hospital_id TEXT);CREATE TABLE ward_labels(ward_id TEXT,label TEXT);
    CREATE TABLE beds(bed_id TEXT,ward_id TEXT);CREATE TABLE hospital_bed_states(bed_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE critical_care_units(critical_id TEXT,hospital_id TEXT,ward_id TEXT,name TEXT,category TEXT);
    CREATE TABLE blood_stock_snapshots(hospital_id TEXT,snapshot_date TEXT,blood_group TEXT,component TEXT,units_available INTEGER);
    CREATE TABLE doctors(doctor_id TEXT,name TEXT);CREATE TABLE nurses_midwives(staff_id TEXT,name TEXT);
    CREATE TABLE shift_rosters(hospital_id TEXT,doctor_id TEXT,staff_id TEXT,roster_date TEXT,role TEXT,start_time TEXT,end_time TEXT);
    INSERT INTO wards VALUES('w','h'),('other','other-hospital');INSERT INTO ward_labels VALUES('w','NICU'),('other','Other');
    INSERT INTO beds VALUES('b','w'),('x','other');INSERT INTO hospital_bed_states VALUES('b','available','2026-11-21T09:00:00'),('x','available','2026-11-21T09:00:00');
    INSERT INTO critical_care_units VALUES('n','h','w','NICU','neonatal');
    INSERT INTO blood_stock_snapshots VALUES('h','2026-11-21','O+','Packed red cells',0);
    INSERT INTO doctors VALUES('d','Scheduled doctor');INSERT INTO shift_rosters VALUES('h','d',NULL,'2026-11-21','consultant','09:00','17:00');''')
    rows=capacity_rows(db,'h','2026-11-21');assert all(r['location']!='Other' for r in rows)
    assert any(r['resource']=='Neonatal beds' for r in rows)
    blood=next(r for r in rows if r['resource']=='Blood');assert blood['recorded_available']==0
    staff=next(r for r in rows if r['resource']=='Scheduled staff');assert staff['last_confirmed'] is None;assert staff['recorded_available'] is None
    db.execute("INSERT INTO beds VALUES('unknown','w')");db.execute("INSERT INTO hospital_bed_states VALUES('unknown','available',NULL)")
    assert next(r for r in capacity_rows(db,'h','2026-11-21') if r['resource']=='Beds')['last_confirmed'] is None
    db.close()


def test_quality_rates_have_sources_and_sparse_wards_remain_suppressed():
    db=sqlite3.connect(':memory:')
    db.executescript('''CREATE TABLE mother_unit_assignments(mother_id INTEGER,hospital_id TEXT,ward_id TEXT);
    CREATE TABLE ward_labels(ward_id TEXT,label TEXT);INSERT INTO ward_labels VALUES('w','Ward 1'),('s','Sparse ward');
    CREATE TABLE appointments(mother_id INTEGER,hospital_id TEXT,appointment_date TEXT,status TEXT);
    CREATE TABLE vaccinations(mother_id INTEGER,child_id INTEGER,due_date TEXT,given_date TEXT,not_applicable_after_death INTEGER);CREATE TABLE newborns(child_id INTEGER,mother_id INTEGER);''')
    for i in range(1,12):
        db.execute('INSERT INTO mother_unit_assignments VALUES(?,?,?)',(i,'h','w' if i<=10 else 's'))
        db.execute('INSERT INTO appointments VALUES(?,?,?,?)',(i,'h','2026-11-01','no_show' if i<=4 else 'completed'))
        db.execute('INSERT INTO newborns VALUES(?,?)',(i,i))
        db.execute('INSERT INTO vaccinations VALUES(?,?,?,?,0)',(None,i,'2026-10-01','2026-10-02' if i<=4 else None))
    rows=quality_rows(db,'h','2026-11-21',[{'source_mother_id':i,'duration_days':i} for i in range(1,11)])
    normal=next(r for r in rows if r['ward']=='Ward 1');assert normal['missed_visit_pct']==40;assert normal['recorded_vaccination_coverage_pct']==40;assert normal['median_referral_days']==5.5
    sparse=next(r for r in rows if r['ward']=='Sparse ward');assert sparse['suppressed'];assert 'missed_visit_pct' not in sparse
    db.close()


def test_capacity_and_quality_use_separate_permissions(workspace):
    _,client=workspace
    admin=sign_in(client,'hospital_admin');assert client.get('/api/workspace/capacity',headers=admin).status_code==200
    q=client.get('/api/workspace/quality-board',headers=admin);assert q.status_code==200;assert 'source_notes' in q.json()
    quality=sign_in(client,'quality_officer');assert client.get('/api/workspace/capacity',headers=quality).status_code==403
    assert client.get('/api/workspace/quality-board',headers=quality).status_code==200
