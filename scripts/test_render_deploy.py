import os,sys,unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import render_demo
class HostedEnvironment(unittest.TestCase):
    def settings(self):
        return dict(JWT_SECRET='a'*48,DAI_DEMO_PASSWORD='b'*48,DAI_DEMO_ACCESS_KEY='c'*48,RENDER_EXTERNAL_URL='https://backend.onrender.com')
    def test_public_vercel_origin_and_persistent_uploads(self):
        with patch.dict(os.environ,self.settings()|{'DAI_PUBLIC_ORIGIN':'https://frontend.vercel.app'},clear=True):
            env=render_demo.hosted_environment()
            self.assertEqual(env['DAI_PUBLIC_ORIGIN'],'https://frontend.vercel.app')
            self.assertEqual(env['NODE_ENV'],'production')
            self.assertEqual(env['DAI_PORTAL_API_ORIGIN'],'http://127.0.0.1:8100')
            self.assertIn('/.local/',env['HOSPITAL_UPLOAD_DIR'])
            self.assertIn('/.local/',env['HOSPITAL_STATE_FILE'])
    def test_fallback_and_invalid_public_origin(self):
        with patch.dict(os.environ,self.settings(),clear=True):self.assertEqual(render_demo.hosted_environment()['DAI_PUBLIC_ORIGIN'],'https://backend.onrender.com')
        for value in ['http://frontend.vercel.app','https://example.com/path','https://user:pass@example.com']:
            with self.subTest(value=value),patch.dict(os.environ,self.settings()|{'DAI_PUBLIC_ORIGIN':value},clear=True):
                with self.assertRaises(RuntimeError):render_demo.hosted_environment()
if __name__=='__main__':unittest.main()
