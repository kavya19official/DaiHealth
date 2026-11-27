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
    def test_missing_ultrasound_settings_report_all_names_before_launch(self):
        with patch.dict(os.environ,self.settings()|{'DAI_ULTRASOUND_ENABLED':'true'},clear=True):
            with self.assertRaises(RuntimeError) as error:
                render_demo.hosted_environment()
        message=str(error.exception)
        for name in ['DAI_ULTRASOUND_IMAGE_KEY','DAI_ULTRASOUND_GATEWAY_TOKEN','DAI_ULTRASOUND_SERVICE_TOKEN']:
            self.assertIn(name,message)
        self.assertIn('Render > Environment',message)
    def test_valid_ultrasound_keys_are_preserved_and_disabled_feature_needs_no_keys(self):
        config=self.settings()|{'DAI_ULTRASOUND_ENABLED':'true','DAI_ULTRASOUND_IMAGE_KEY':'ab'*32,
            'DAI_ULTRASOUND_GATEWAY_TOKEN':'gateway-private-'+'g'*32,
            'DAI_ULTRASOUND_SERVICE_TOKEN':'service-private-'+'s'*32}
        with patch.dict(os.environ,config,clear=True):
            env=render_demo.hosted_environment()
        for name in ['DAI_ULTRASOUND_IMAGE_KEY','DAI_ULTRASOUND_GATEWAY_TOKEN','DAI_ULTRASOUND_SERVICE_TOKEN']:
            self.assertEqual(env[name],config[name])
        with patch.dict(os.environ,self.settings()|{'DAI_ULTRASOUND_ENABLED':'false'},clear=True):
            self.assertEqual(render_demo.hosted_environment()['DAI_ULTRASOUND_ENABLED'],'false')
    def test_invalid_ultrasound_settings_never_echo_secret_values(self):
        for key in ['', 'x'*64, 'ab'*31, '"'+'ab'*32+'"']:
            config=self.settings()|{'DAI_ULTRASOUND_ENABLED':'true','DAI_ULTRASOUND_IMAGE_KEY':key,
                'DAI_ULTRASOUND_GATEWAY_TOKEN':'gateway-private-'+'g'*32,
                'DAI_ULTRASOUND_SERVICE_TOKEN':'service-private-'+'s'*32}
            with patch.dict(os.environ,config,clear=True):
                with self.assertRaises(RuntimeError) as error:
                    render_demo.hosted_environment()
            self.assertIn('DAI_ULTRASOUND_IMAGE_KEY',str(error.exception))
            self.assertNotIn('gateway-private-',str(error.exception))
            self.assertNotIn('service-private-',str(error.exception))
if __name__=='__main__':unittest.main()
