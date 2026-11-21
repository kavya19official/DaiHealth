"""Suppressed ward aggregates; no records or fabricated turnaround durations."""
from datetime import date, timedelta
from statistics import median

def quality_rows(db, hospital_id, as_of, live_referrals=()):
    groups, mapping = {}, {}
    assignments = db.execute("""SELECT a.mother_id,count(DISTINCT a.ward_id) n,min(l.label) ward
      FROM mother_unit_assignments a LEFT JOIN ward_labels l USING(ward_id)
      WHERE a.hospital_id=? GROUP BY a.mother_id""", (hospital_id,))
    def new():
        return dict(people=set(),visitors=set(),visits=0,missed=0,vaccine_people=set(),due=0,given=0,referral_people=set(),durations=[])
    for mid,n,ward in assignments:
        key=ward if n==1 and ward else 'Multiple or unrecorded ward assignments'
        mapping[mid]=key
        groups.setdefault(key,new())['people'].add(mid)
    start=(date.fromisoformat(as_of)-timedelta(days=90)).isoformat()
    for mid,status in db.execute("SELECT mother_id,status FROM appointments WHERE hospital_id=? AND appointment_date>=? AND appointment_date<? AND status<>'cancelled'",(hospital_id,start,as_of)):
        if mid not in mapping: continue
        g=groups[mapping[mid]];g['visitors'].add(mid);g['visits']+=1;g['missed']+=status=='no_show'
    for mid,child,given in db.execute("SELECT coalesce(v.mother_id,n.mother_id),v.child_id,v.given_date FROM vaccinations v LEFT JOIN newborns n ON n.child_id=v.child_id WHERE v.child_id IS NOT NULL AND v.due_date<=? AND coalesce(v.not_applicable_after_death,0)=0",(as_of,)):
        if mid not in mapping: continue
        g=groups[mapping[mid]];g['vaccine_people'].add(child);g['due']+=1;g['given']+=bool(given and given<=as_of)
    for item in live_referrals:
        mid=item.get('source_mother_id')
        if mid not in mapping: continue
        duration=item.get('duration_days')
        if duration is None or duration<0: continue
        g=groups[mapping[mid]];g['referral_people'].add(mid);g['durations'].append(duration)
    def rate(n,d,people):
        return round(n/d*100,1) if d and len(people)>=10 and n>=3 and d-n>=3 else None
    result=[]
    for label,g in groups.items():
        if len(g['people'])<10:
            result.append(dict(ward=label,suppressed=True,reason='Fewer than 10 distinct mothers; counts and rates withheld'))
        else:
            result.append(dict(ward=label,suppressed=False,people_band='10–19' if len(g['people'])<20 else '20–49' if len(g['people'])<50 else '50+',
              missed_visit_pct=rate(g['missed'],g['visits'],g['visitors']),
              recorded_vaccination_coverage_pct=rate(g['given'],g['due'],g['vaccine_people']),
              median_referral_days=median(g['durations']) if len(g['referral_people'])>=10 else None))
    return result
