# Read-only UI fixtures from the existing synthetic database. No new clinical data.
import sqlite3,json,datetime,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
c=sqlite3.connect(ROOT/'synthetic_data/output/dai.db');c.row_factory=sqlite3.Row
one=lambda q,args=():dict(c.execute(q,args).fetchone())
all=lambda q,args=():[dict(x) for x in c.execute(q,args)]
fixtures={}
for kind in ['pregnancy','postpartum','child']:
 p=one("select * from pregnancies where current_stage='T2' and current_gestational_week between 22 and 25 limit 1") if kind=='pregnancy' else one("select p.* from pregnancies p join newborns n using(pregnancy_id) where p.plurality_count=2 and p.outcome='live birth' group by p.pregnancy_id having count(*)=2 limit 1")
 m=one('select * from mothers where mother_id=?',(p['mother_id'],));h=one('select * from hospitals where hospital_id=?',(m['registered_hospital_id'],));children=[]
 for i,b in enumerate(all('select * from newborns where pregnancy_id=? order by birth_order',(p['pregnancy_id'],))):
  children.append({'id':i+1,'name':'Baby '+b['birth_label'].split()[-1],'date_of_birth':b['date_of_birth'],'birth_weight_kg':b['birth_weight_g']/1000,'vaccinations':[{'vaccine_code':v['vaccine_code'].lower(),'given_on':v['given_date']} for v in all('select * from vaccinations where child_id=? and given_date is not null',(b['child_id'],))],'growth':[]})
 visits=all('select * from anc_visits where pregnancy_id=? order by visit_date desc',(p['pregnancy_id'],))
 metrics=[]
 for typ,col,unit in [('weight','weight_kg','kg'),('blood_pressure','bp_systolic','mmHg'),('haemoglobin','hb','g/dL')]:
  metrics.append({'type':typ,'unit':unit,'readings':[{'value':v[col],'diastolic':v['bp_diastolic'] if typ=='blood_pressure' else None,'date':v['visit_date'],'doctor':'Synthetic source clinician','source':'clinician_record'} for v in visits if v[col] is not None]})
 milestones=[]
 for row in all('select * from anc_expected where pregnancy_id=?',(p['pregnancy_id'],)):
  v=next((v for v in visits if v['expected_id']==row['expected_id']),None)
  milestones.append({'id':row['expected_id'],'title':'Antenatal visit · week '+str(row['gestational_week']),'category':'visits','due_date':row['due_date'],'status':'completed' if v else 'pending','guidance':'Recorded antenatal schedule. Discuss follow-through with your care team.'})
 post={'active':False}
 if kind=='postpartum':
  delivery=one('select * from delivery_records where pregnancy_id=?',(p['pregnancy_id'],));done=all('select * from postpartum_visits where pregnancy_id=?',(p['pregnancy_id'],))
  post={'active':True,'delivery':{'date':delivery['delivered_at'][:10]},'schedule':[{'code':str(r['postpartum_day']),'title':'Postnatal review · day '+str(r['postpartum_day']),'window_end':r['due_date'],'status':'done' if any(v['expected_id']==r['expected_id'] for v in done) else 'pending','why':'Your recorded postnatal follow-up.'} for r in all('select * from postpartum_expected where pregnancy_id=?',(p['pregnancy_id'],))]}
 if kind=='child':milestones=[]
 f={'id':h['hospital_id'],'name':h['name'],'lat':h['latitude'],'lng':h['longitude'],'tier':h['tier']}
 fixtures[kind]={'user':{'id':101,'full_name':m['name'],'pregnancy_status':'pregnant' if kind=='pregnancy' else 'delivered','lmp_date':p['lmp'] if kind=='pregnancy' else None,'edd_date':p['edd'] if kind=='pregnancy' else None},'homeLoaded':True,'offline':False,'milestones':milestones,'children':children,'post':post,'appointments':[],'overview':{'metrics':metrics,'registered_facility':f,'facilities':[f],'care_team':{},'clinician_status':None}}
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/dai-patient-home-redesign/fixtures.json');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(fixtures))
