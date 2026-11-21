"""Recorded readiness only; availability is never inferred or ranked."""
from datetime import datetime, timezone

def capacity_rows(db, hospital_id, snapshot_day):
    def items(sql, args):
        return [dict(r) for r in db.execute(sql, args)]
    result = []
    for row in items("""SELECT l.label ward, SUM(s.status='available') available,
      CASE WHEN count(s.updated_at)=count(*) THEN MIN(s.updated_at) END confirmed_at FROM beds b JOIN wards w USING(ward_id)
      JOIN ward_labels l USING(ward_id) JOIN hospital_bed_states s USING(bed_id)
      WHERE w.hospital_id=? GROUP BY w.ward_id,l.label""", (hospital_id,)):
        result.append(dict(resource="Beds", location=row['ward'], recorded_available=row['available'],
                           last_confirmed=row['confirmed_at'], basis="Recorded bed states; oldest included confirmation, confirm before transfer"))
    for row in items("""SELECT cc.name,SUM(s.status='available') available,CASE WHEN count(s.updated_at)=count(*) THEN MIN(s.updated_at) END confirmed_at
      FROM critical_care_units cc JOIN wards w USING(ward_id) JOIN beds b USING(ward_id)
      JOIN hospital_bed_states s USING(bed_id) WHERE cc.hospital_id=? AND (cc.category='neonatal' OR cc.name LIKE '%NICU%')
      GROUP BY cc.critical_id,cc.name""", (hospital_id,)):
        result.append(dict(resource="Neonatal beds", location=row['name'], recorded_available=row['available'],
                           last_confirmed=row['confirmed_at'], basis="Oldest included bed confirmation; not a staffed or reserved neonatal slot"))
    for row in items("""SELECT blood_group,component,units_available,snapshot_date
      FROM blood_stock_snapshots WHERE hospital_id=? AND snapshot_date=(SELECT MAX(snapshot_date)
      FROM blood_stock_snapshots WHERE hospital_id=?) ORDER BY component,blood_group""",(hospital_id,hospital_id)):
        result.append(dict(resource="Blood", location=row['blood_group']+' · '+row['component'],
                           recorded_available=row['units_available'], last_confirmed=row['snapshot_date'],
                           basis="Stock snapshot only; compatibility, testing and release need confirmation"))
    for row in items("""SELECT coalesce(d.name,n.name) name,r.role,r.roster_date,r.start_time,r.end_time
      FROM shift_rosters r LEFT JOIN doctors d USING(doctor_id) LEFT JOIN nurses_midwives n USING(staff_id)
      WHERE r.hospital_id=? AND r.roster_date=? ORDER BY r.start_time,r.role""",(hospital_id,snapshot_day)):
        result.append(dict(resource="Scheduled staff", location=(row['name'] or 'Name not recorded')+' · '+row['role'],
                           recorded_available=None,last_confirmed=None,
                           basis=f"Roster {row['roster_date']} {row['start_time']}–{row['end_time']}; presence and confirmation not recorded"))
    for row in result:
        value=row['last_confirmed']
        row['freshness']='Not confirmed' if not value else 'Recorded snapshot — confirm now'
    return result
