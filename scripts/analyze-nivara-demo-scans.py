"""Run the configured SonoNet service on existing, encrypted Nivara demo frames.
Clinical review/release fields and scripted demo measurements are preserved.
Only local fictional demo scans are eligible. Requires --apply.
"""
import asyncio,json,sys,urllib.request,http.cookiejar
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'hospital_portal'))
from sqlalchemy import create_engine,select,update
from api import schema as s
from api.ultrasound import Ultrasound
from api.ultrasound_processing import review_flag

def account(email,password):
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request=urllib.request.Request('http://127.0.0.1:3001/api/auth/login',data=json.dumps({'email':email,'password':password}).encode(),headers={'Content-Type':'application/json'})
    with client.open(request,timeout=15) as response:return json.load(response)['user']

async def main():
    if sys.argv[1:]!=['--apply']:raise ValueError('Pass --apply for local fictional demo analysis only.')
    cfg=json.loads((ROOT/'.local/config.json').read_text())
    if cfg.get('ultrasound_enabled') is not True:raise ValueError('Local ultrasound must be enabled.')
    patient=account('nivara@dai-synthetic.invalid',cfg['demo_password']);doctor=account('doctor@dai-synthetic.invalid',cfg['demo_password'])
    if patient['full_name']!='Nivara Sethi' or 'Hemangini Batra' not in doctor['full_name']:raise ValueError('Fictional demo accounts do not match.')
    service=Ultrasound({'DAI_ULTRASOUND_ENABLED':'true','DAI_ULTRASOUND_IMAGE_KEY':cfg['ultrasound_image_key'],
        'DAI_ULTRASOUND_SERVICE_TOKEN':cfg['ultrasound_service_token']})
    status=await service.model_status()
    if status.get('state')!='ready' or status.get('model')!='sononet16':raise ValueError('A ready SonoNet16 service is required; no substitute scores will be generated.')
    engine=create_engine('sqlite:///'+str(ROOT/'.local/portal.db'));scans=s.ultrasound_workspace_scan
    try:
        with engine.connect() as conn:
            rows=conn.execute(select(scans).where(scans.c.patient_account_id==patient['id'],scans.c.doctor_account_id==doctor['id'],scans.c.episode=='2026-05-11').order_by(scans.c.created_at)).mappings().all()
        rows=[r for r in rows if (r['analysis'].get('measurements') or {}).get('demo') is True]
        if len(rows)!=3:raise ValueError('Expected exactly the three existing Nivara demonstration scans.')
        updates=[]
        for i,row in enumerate(rows,1):
            started=datetime.now(timezone.utc);stages={}
            async def progress(stage):stages.setdefault(stage,datetime.now(timezone.utc).isoformat())
            print(f'Analyzing demo frame {i}/{len(rows)}: {row["id"]}',flush=True)
            png=service.decrypt(row['id'],row['image_ciphertext']);result=await service.analyze(png,progress)
            if result.state!='plane_analysis':raise ValueError(f'Model returned {result.state}; no fabricated analysis was saved.')
            payload=result.model_dump(exclude_none=True)
            analysis={**row['analysis'],**payload,'steps':list(stages),'stage_times':stages,
                'started_at':started.isoformat(),'finished_at':datetime.now(timezone.utc).isoformat(),
                'demo_live_inference':True,'inference_model':'sononet16','inference_runtime':status.get('runtime')}
            analysis['flag']=review_flag(analysis);updates.append((row,analysis))
        with engine.begin() as conn:
            for row,analysis in updates:
                changed=conn.execute(update(scans).where(scans.c.id==row['id'],scans.c.revision==row['revision']).values(
                    analysis=analysis,revision=row['revision']+1,updated_at=datetime.now(timezone.utc))).rowcount
                if changed!=1:raise ValueError('A scan changed during analysis. Nothing from this batch was saved; retry after review.')
                conn.execute(s.audit_log.insert().values(action='workspace_demo_live_inference',entity_type='ultrasound_workspace_scan',
                    entity_id=row['id'],details={'model':'sononet16','model_version':analysis['model_version'],'public_demo_only':True}))
        print(json.dumps({'analyzed':len(updates),'model':'sononet16','runtime':status.get('runtime'),'clinical_reports_unchanged':True}))
    finally:engine.dispose()
if __name__=='__main__':asyncio.run(main())
