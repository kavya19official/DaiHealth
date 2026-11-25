"""Explicit local-only, encrypted public demonstration scans for Nivara.
Run: hospital_portal/.venv/bin/python scripts/seed-nivara-ultrasound.py --apply
Never creates real clinical findings, measurements, or a model result.
"""
import hashlib,json,os,sqlite3,sys,urllib.request,http.cookiejar
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from uuid import uuid5,NAMESPACE_URL
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'hospital_portal'))
from sqlalchemy import create_engine,select
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from api import schema as schema
NOTE="PUBLIC DEMONSTRATION IMAGE - NOT NIVARA'S ACTUAL SCAN - NOT FOR CLINICAL USE."
SPECS=[('2026-10-01','brain_1012.png','Anatomy scan - demonstration','reviewed'),('2026-11-16','abdomen_1427.png','Later scan - demonstration','reviewed'),('2026-11-25','femur_1135.png','Follow-up image - demonstration','pending')]
def account(email,password):
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request=urllib.request.Request('http://127.0.0.1:3001/api/auth/login',data=json.dumps({'email':email,'password':password}).encode(),headers={'Content-Type':'application/json'})
    with client.open(request,timeout=15) as r: return json.load(r)['user']
def build_rows(patient,doctor,facility,now):
    lmp=str(patient['lmp_date'])[:10];edd=str(patient['edd_date'])[:10]
    if patient['full_name']!='Nivara Sethi' or patient['email']!='nivara@dai-synthetic.invalid' or lmp!='2026-05-11' or edd!='2027-02-15':
        raise ValueError('The curated fictional Nivara pregnancy must already exist.')
    if 'Hemangini Batra' not in doctor['full_name']:raise ValueError('Expected the fictional Hemangini account.')
    for scan_date,asset,title,status in SPECS:
        created=datetime.fromisoformat(scan_date+'T08:00:00+00:00')
        if created>now:continue
        png=(ROOT/'frontend/assets/ultrasound-demo'/asset).read_bytes();digest=hashlib.sha256(png).hexdigest()
        days=(date.fromisoformat(scan_date)-date.fromisoformat(lmp)).days
        reviewed=status=='reviewed'
        yield dict(id=str(uuid5(NAMESPACE_URL,f'dai-demo-nivara-ultrasound-v1:{patient["id"]}:{scan_date}:{asset}')),
          patient_account_id=patient['id'],doctor_account_id=doctor['id'],facility_ref=facility,episode=lmp,image_digest=digest,
          image_ciphertext=None,image_expires_at=now+timedelta(days=60),
          pregnancy_context={'stage':'pregnant','lmp':lmp,'edd':edd,'plurality':'single','scan_date':scan_date,'scan_ga_weeks':days//7,'scan_ga_days':days%7,'demo':True},
          analysis={'state':'model_unavailable','quality':{},'reasons':['no_approved_model'],
            'measurements':{'demo':True,'scan_date':scan_date,'scan_type':title,'gestational_age_weeks':round(days/7,2),'note':NOTE}},
          revision=2 if reviewed else 1,started_at=created+timedelta(minutes=10) if reviewed else None,
          reviewed_at=created+timedelta(minutes=20) if reviewed else None,released_at=created+timedelta(minutes=30) if reviewed else None,
          decision='review_complete' if reviewed else None,review_note=NOTE if reviewed else None,
          findings=f'{NOTE}\nScripted demo review: {title}. Gestational age from the recorded LMP: {days//7} weeks {days%7} days. This dataset frame does not establish findings for Nivara.' if reviewed else None,
          instructions='Demonstration workflow only. Use the original scan report for any clinical review. No treatment or medicine is prescribed by this demo entry.' if reviewed else None,
          created_at=created,_png=png)
def main():
    if sys.argv[1:]!=['--apply']:raise ValueError('Pass --apply to seed only the local fictional Nivara account.')
    config=json.loads((ROOT/'.local/config.json').read_text())
    if config.get('ultrasound_enabled') is not True:raise ValueError('Local ultrasound must be enabled in the launcher.')
    cipher=AESGCM(bytes.fromhex(config['ultrasound_image_key']))
    mother=account('nivara@dai-synthetic.invalid',config['demo_password']);doctor=account('doctor@dai-synthetic.invalid',config['demo_password'])
    with sqlite3.connect(ROOT/'.local/portal.db') as db:
        db.row_factory=sqlite3.Row
        row=db.execute('SELECT m.registered_facility_id,u.name FROM mother m JOIN portal_user u ON u.id=m.assigned_doctor_id WHERE m.source_id=?',('MOTHER-SYN-0000001',)).fetchone()
        if not row or 'Hemangini Batra' not in row['name']:raise ValueError('Expected Nivara to be assigned to Hemangini in both portals.')
        facility=row['registered_facility_id']
    engine=create_engine('sqlite:///'+str(ROOT/'.local/portal.db'));scans=schema.ultrasound_workspace_scan;inserted=skipped=0
    with engine.begin() as db:
        for row in build_rows(mother,doctor,facility,datetime.now(timezone.utc)):
            png=row.pop('_png')
            if db.execute(select(scans.c.id).where(scans.c.id==row['id'])).first():skipped+=1;continue
            nonce=os.urandom(12);row['image_ciphertext']=nonce+cipher.encrypt(nonce,png,row['id'].encode())
            db.execute(scans.insert().values(**row));inserted+=1
    engine.dispose();print(json.dumps({'inserted':inserted,'already_present':skipped,'patient_id':mother['id'],'doctor_id':doctor['id'],'episode':'2026-05-11','public_demo_only':True}))
if __name__=='__main__':main()
