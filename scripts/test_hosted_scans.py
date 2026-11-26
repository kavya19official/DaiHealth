import importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'hospital_portal'))
from sqlalchemy import create_engine,select,update
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from api import schema
spec=importlib.util.spec_from_file_location('hosted_scans',ROOT/'scripts/seed-hosted-nivara-scans.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class HostedScans(unittest.TestCase):
 def test_encrypted_demo_frames_are_idempotent_and_preserve_reviews(self):
  with tempfile.TemporaryDirectory(prefix='dai-hosted-scans-') as folder:
   root=Path(folder);(root/'.local').mkdir();(root/'scripts').mkdir()
   (root/'scripts/seed-nivara-ultrasound.py').symlink_to(ROOT/'scripts/seed-nivara-ultrasound.py')
   (root/'frontend').symlink_to(ROOT/'frontend')
   (root/'.local/hosted-nivara.json').write_text(json.dumps({'synthetic':True,'patient':{'id':145,'full_name':'Nivara Sethi','email':'nivara@dai-synthetic.invalid','lmp_date':'2026-05-11','edd_date':'2027-02-15'},'doctor':{'id':2,'full_name':'SYNTHETIC Hemangini Batra'},'facility':'fictional-facility'}))
   engine=create_engine('sqlite:///'+str(root/'.local/portal.db'));table=schema.ultrasound_workspace_scan;table.create(engine)
   env={k:'true' for k in ('DAI_HOSTED_DEMO','DAI_LOCAL','DAI_SEED_NIVARA_DEMO','DAI_ULTRASOUND_ENABLED')};env['DAI_ULTRASOUND_IMAGE_KEY']='ab'*32
   with patch.object(module,'ROOT',root),patch.dict(os.environ,env):
    module.main()
    with engine.begin() as db:
     rows=db.execute(select(table)).mappings().all();self.assertEqual(len(rows),3)
     image=rows[0]['image_ciphertext'];plain=AESGCM(bytes.fromhex(env['DAI_ULTRASOUND_IMAGE_KEY'])).decrypt(image[:12],image[12:],rows[0]['id'].encode());self.assertTrue(plain.startswith(b'\x89PNG'))
     db.execute(update(table).where(table.c.id==rows[0]['id']).values(revision=99))
    module.main()
    with engine.connect() as db:
     self.assertEqual(len(db.execute(select(table)).all()),3)
     self.assertEqual(db.execute(select(table.c.revision).where(table.c.id==rows[0]['id'])).scalar_one(),99)
   engine.dispose()
if __name__=='__main__':unittest.main()
