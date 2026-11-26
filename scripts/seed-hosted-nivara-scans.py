"""Install encrypted public demonstration frames for the opt-in hosted persona."""
import importlib.util,json,os,sys
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'hospital_portal'))
from sqlalchemy import create_engine,select
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from api import schema

def main():
    if not all(os.environ.get(k)=='true' for k in ('DAI_HOSTED_DEMO','DAI_LOCAL','DAI_SEED_NIVARA_DEMO','DAI_ULTRASOUND_ENABLED')):
        raise RuntimeError('Explicit hosted synthetic-scan opt-ins required.')
    manifest=json.loads((ROOT/'.local/hosted-nivara.json').read_text())
    if manifest.get('synthetic') is not True:raise RuntimeError('Expected fictional persona manifest.')
    spec=importlib.util.spec_from_file_location('nivara_demo_frames',ROOT/'scripts/seed-nivara-ultrasound.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    cipher=AESGCM(bytes.fromhex(os.environ['DAI_ULTRASOUND_IMAGE_KEY']))
    engine=create_engine('sqlite:///'+str(ROOT/'.local/portal.db'));table=schema.ultrasound_workspace_scan
    count=0
    try:
        with engine.begin() as db:
            for row in module.build_rows(manifest['patient'],manifest['doctor'],manifest['facility'],datetime.now(timezone.utc)):
                image=row.pop('_png')
                if db.execute(select(table.c.id).where(table.c.id==row['id'])).first():continue
                nonce=os.urandom(12);row['image_ciphertext']=nonce+cipher.encrypt(nonce,image,row['id'].encode())
                db.execute(table.insert().values(**row));count+=1
    finally:engine.dispose()
    print(f'Hosted Nivara: {count} public demonstration scan records installed; existing reviews preserved.')
if __name__=='__main__':main()
