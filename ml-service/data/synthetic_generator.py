"""Reuses DAI identities and source care records; adds a labelled interaction scenario."""
from pathlib import Path
import argparse, hashlib, json, sqlite3
import numpy as np
import pandas as pd
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / 'synthetic_data/output/dai.db'
OUT = Path(__file__).resolve().parent / 'generated'
CHANNELS = ['app', 'SMS', 'WhatsApp', 'voice']
HOURS = [9, 13, 18, 20]
END = pd.Timestamp('2026-10-20')
START = END - pd.DateOffset(months=24) + pd.Timedelta(days=1)
VAL_START = END - pd.DateOffset(months=8) + pd.Timedelta(days=1)
TEST_START = END - pd.DateOffset(months=4) + pd.Timedelta(days=1)

def split_rows(frame):
    """Temporal embargo + disjoint patient cohorts; unused patient/time cells discarded."""
    dates = pd.to_datetime(frame['timestamp'])
    return {
        'train': frame[(frame.cohort == 'train') & (dates < VAL_START)].copy(),
        'validation': frame[(frame.cohort == 'validation') & (dates >= VAL_START) & (dates < TEST_START)].copy(),
        'test': frame[(frame.cohort == 'test') & (dates >= TEST_START)].copy(),
    }

def sigmoid(x): return 1 / (1 + np.exp(-np.clip(x, -15, 15)))
def noisy_binary(rng, p): return int((rng.random() < p) != (rng.random() < .18))
def generate(seed=42, source=DEFAULT_SOURCE, limit=None, diagnostics=False, diagnostics_only=False):
    rng = np.random.default_rng(seed)
    source = Path(source)
    if not source.exists(): raise FileNotFoundError('Generate the existing DAI cohort first: python synthetic_data/generate.py')
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db:
        mothers = pd.read_sql_query('SELECT * FROM mothers ORDER BY mother_id', db)
        pregnancies = pd.read_sql_query('SELECT * FROM pregnancies', db).set_index('mother_id')
        appointments = pd.read_sql_query('SELECT * FROM appointments ORDER BY appointment_date, appointment_id', db)
        gaps = pd.read_sql_query("SELECT cg.*,p.mother_id FROM care_gaps cg JOIN pregnancies p ON p.pregnancy_id=cg.pregnancy_id", db)
        hospitals = pd.read_sql_query('SELECT * FROM hospitals ORDER BY hospital_id', db)
    if limit: mothers = mothers.iloc[:limit]
    ids = rng.permutation(mothers.mother_id.to_numpy())
    n = len(ids); cohorts = {x: ('train' if i < int(.7*n) else 'validation' if i < int(.85*n) else 'test') for i,x in enumerate(ids)}
    appointment_groups = {}
    for record in appointments.to_dict('records'):
        appointment_groups.setdefault(record['mother_id'], []).append(record)
    gap_groups = {}
    for record in gaps.to_dict('records'):
        gap_groups.setdefault(record['mother_id'], []).append(record)
    app_rows, reminder_rows, gap_rows, facility_rows, profiles = [], [], [], [], []
    hospital_records=hospitals.to_dict('records')
    month_starts = pd.date_range(START, END, freq='MS')[1::2]
    for m in mothers.to_dict('records'):
        pid=m['mother_id']; preg=pregnancies.loc[pid]; cohort=cohorts[pid]
        ap_records=appointment_groups.get(pid, []);gap_records=gap_groups.get(pid, [])
        ap_dates=[r['appointment_date'] for r in ap_records]
        language=str(m['preferred_language']); digital={'low':0,'medium':1,'med':1,'high':2}.get(m['digital_literacy'],1)
        support=int(bool(m['caregiver_contact']) and rng.random()>.22)
        preferred=int(rng.choice(4,p=[.2,.15,.4,.25]))
        base={'patient_id':pid,'age':int(m['age']),'distance_km':float(m['distance_km']),'language':language,'digital_literacy':digital,'caregiver_support':support,'preferred_channel':preferred,'cohort':cohort}
        profiles.append(base)
        missed_so_far=0
        for month_index,month in enumerate(month_starts):
            day=month+pd.Timedelta(days=int(rng.integers(0, min(20,(END-pd.Timedelta(days=7)-month).days+1))))
            if day>END: continue
            stamp=day.strftime('%Y-%m-%d')
            episode_end=pd.Timestamp(preg['outcome_date']) if pd.notna(preg['outcome_date']) else pd.Timestamp(preg['edd'])
            in_pregnancy=pd.Timestamp(preg['lmp'])<=day<=episode_end
            week=int(np.clip((day-pd.Timestamp(preg['lmp'])).days//7,0,42)) if in_pregnancy else 0
            stage=0 if day<pd.Timestamp(preg['lmp']) else 4 if day>episode_end else 1 if week<13 else 2 if week<28 else 3
            row={**base,'timestamp':stamp,'week':week,'prior_missed_visits':min(missed_so_far,5)}
            previous_index=int(np.searchsorted(ap_dates,stamp,side='left'))-1
            previous=ap_records[previous_index] if previous_index>=0 else None
            source_status=str(previous['status']) if previous else 'unobserved'
            source_id=str(previous['appointment_id']) if previous else None
            z=-1.6+.025*min(base['distance_km'],60)+.17*row['prior_missed_visits']+.3*(2-digital)+.35*(1-support)+.2*(source_status=='missed')+rng.normal(0,.85)
            missed=noisy_binary(rng,sigmoid(z));missed_so_far+=missed
            q=f'{pid}:{month_index}'
            app_rows.append({**row,'source_appointment_id':source_id,'source_status':source_status,'missed':missed,**({'diagnostic_oracle_probability':float(.18+.64*sigmoid(z))} if diagnostics else {})})
            # Uniform randomized logged reminder action; only its factual completion is saved.
            hour=int(rng.choice(HOURS));channel=int(rng.integers(4));match=channel==preferred
            p=sigmoid(-1.1+.95*match+.55*(hour>=18)+.25*(digital>0 and channel in [0,2])-.009*min(base['distance_km'],60)+rng.normal(0,.8))
            completed=noisy_binary(rng,p);opened=int(completed or rng.random()<.5)
            reminder_rows.append({**row,'query_id':q,'hour':hour,'channel':channel,'propensity':1/16,'reminder_sent':1,'opened':opened,'action_completed':completed,**({'diagnostic_oracle_probability':float(.18+.64*p)} if diagnostics else {})})
            # Each gap list retains source gap identity/type where present; outcomes below are simulated.
            for j in range(5):
                source_gap=gap_records[(month_index+j)%len(gap_records)] if gap_records else None
                typ=j%4; overdue=int(rng.integers(0,43));priority=int(bool(preg['confirmed_high_risk']) and rng.random()<.35)
                close=noisy_binary(rng,sigmoid(.3-.035*overdue+.28*support-.012*min(base['distance_km'],60)+.3*priority+.14*(typ==0)+rng.normal(0,.9)))
                if not diagnostics_only: gap_rows.append({**row,'query_id':q,'item_id':q+':g'+str(j),'source_gap_id':str(source_gap['gap_id']) if source_gap is not None else None,'source_gap_type':str(source_gap['gap_type']) if source_gap is not None else 'expected follow-up','gap_type':typ,'days_overdue':overdue,'stage':stage,'clinician_priority':priority,'closed_7d':close})
            # Source facilities retained. Distances are explicit synthetic access scenarios, not live routes.
            chosen_ids=rng.choice(len(hospitals),size=min(6,len(hospitals)),replace=False)
            choices=[];utilities=[]
            for j,hidx in enumerate(chosen_ids):
                h=hospital_records[hidx];distance=float(np.clip(rng.lognormal(np.log(max(1,base['distance_km'])),.7),.3,80))
                offers=int(rng.random()<.88);open_now=int(bool(h['emergency_24x7']) or rng.random()<.55);fresh=int(rng.integers(0,400));slots=int(rng.integers(0,6))
                choices.append({**row,'query_id':q,'item_id':str(h['hospital_id']),'distance_km':distance,'open_now':open_now,'offers_service':offers,'days_since_confirmed':fresh,'appointment_availability':slots})
                utilities.append(-.035*distance+.5*open_now+.3*offers-.002*fresh+.13*slots+rng.normal(0,.9))
            if not any(c['offers_service'] for c in choices): choices[0]['offers_service']=1
            probabilities=np.exp(np.array(utilities)-max(utilities))*np.array([c['offers_service'] for c in choices]);probabilities/=probabilities.sum();pick=int(rng.choice(len(choices),p=probabilities))
            for j,c in enumerate(choices):
                done=noisy_binary(rng,.68) if j==pick else 0
                if not diagnostics_only: facility_rows.append({**c,'chosen':int(j==pick),'completed':done,'relevance':2 if done else int(j==pick)})
    tables={'patients':pd.DataFrame(profiles),'appointments':pd.DataFrame(app_rows),'reminders':pd.DataFrame(reminder_rows),'gaps':pd.DataFrame(gap_rows),'facilities':pd.DataFrame(facility_rows)}
    manifest={'seed':seed,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_path':str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else str(source),'mother_count':len(mothers),'source_counts':{'appointments':len(appointments),'care_gaps':len(gaps),'hospitals':len(hospitals)},'start':str(START.date()),'end':str(END.date()),'validation_start':str(VAL_START.date()),'test_start':str(TEST_START.date()),'label_flip_probability':.18,'outcome_maturity_days':7,'label_provenance':'Source identities and attributes; separately simulated interaction outcomes, not untouched original appointment outcomes.'}
    return tables,manifest

def save(seed=42,source=DEFAULT_SOURCE,out=OUT):
    tables,manifest=generate(seed,source);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    for name,frame in tables.items():frame.to_csv(out/(name+'.csv'),index=False)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({**manifest,'rows':{k:len(v) for k,v in tables.items()}},indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--seed',type=int,default=42);p.add_argument('--source',type=Path,default=DEFAULT_SOURCE);a=p.parse_args();save(a.seed,a.source)
