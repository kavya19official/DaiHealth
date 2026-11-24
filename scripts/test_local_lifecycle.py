"""Exercise the real OS lock and stop handshake without starting app services."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import json
import os
from unittest.mock import patch

SOURCE = Path(__file__).with_name('local.py')
spec = importlib.util.spec_from_file_location('dai_local', SOURCE)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_state = launcher.STATE
        launcher.STATE = Path(self.temp.name)
        self.process = None

    def tearDown(self):
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.communicate(timeout=5)
        launcher.STATE = self.previous_state
        self.temp.cleanup()

    def owner(self, honour_stop=True):
        code = '''
import importlib.util, pathlib, sys, time
spec=importlib.util.spec_from_file_location('dai_local',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.STATE=pathlib.Path(sys.argv[2])
with m.workspace_lock():
 print('locked',flush=True)
 if sys.argv[3]=='yes':
  while not (m.STATE/'stop-request').exists():time.sleep(.01)
  time.sleep(.2) # Simulate service shutdown after receiving the stop signal.
  (m.STATE/'cleanup-done').touch()
 else:time.sleep(10)
'''
        self.process = subprocess.Popen([sys.executable, '-c', code, str(SOURCE), str(launcher.STATE), 'yes' if honour_stop else 'no'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(self.process.stdout.readline().strip(), 'locked')

    def test_stop_waits_for_cleanup_then_immediate_start_can_lock(self):
        self.owner()
        launcher.stop_launcher(wait_timeout=3)
        self.assertTrue((launcher.STATE/'cleanup-done').exists())
        with launcher.workspace_lock():
            pass

    def test_live_owner_is_never_bypassed_or_lock_file_deleted(self):
        self.owner(False)
        with self.assertRaises(launcher.LauncherBusy):
            with launcher.workspace_lock():
                self.fail('acquired another launcher lock')
        self.assertTrue((launcher.STATE/'run.lock').exists())

    def test_unresponsive_owner_reports_timeout_and_keeps_stop_signal(self):
        self.owner(False)
        with self.assertRaisesRegex(launcher.LauncherBusy, 'not finished stopping'):
            launcher.stop_launcher(wait_timeout=.1)
        self.assertTrue((launcher.STATE/'stop-request').exists())
        self.assertIsNone(self.process.poll())

    def test_old_lock_file_does_not_block_an_inactive_checkout(self):
        (launcher.STATE/'run.lock').touch()
        launcher.stop_launcher(wait_timeout=.1)
        with launcher.workspace_lock():
            pass

    def test_ultrasound_config_enables_local_workflow_and_keeps_keys_stable(self):
        with patch.dict(os.environ, {}, clear=True):
            first = launcher.config()
            second = launcher.config()
            self.assertEqual(first, second)
            self.assertEqual(len(bytes.fromhex(first['ultrasound_image_key'])), 32)
            self.assertNotEqual(first['ultrasound_gateway_token'], first['ultrasound_service_token'])
            env = launcher.environment(first)
            self.assertEqual(env['DAI_ULTRASOUND_ENABLED'], 'true')
            self.assertEqual(env['DAI_ULTRASOUND_IMAGE_KEY'], first['ultrasound_image_key'])
            self.assertTrue(launcher.ml_required(env))
            if os.name != 'nt':
                self.assertEqual((launcher.STATE/'config.json').stat().st_mode & 0o777, 0o600)

    def test_existing_private_image_key_and_other_config_survive_migration(self):
        old = {'jwt_secret':'j'*48, 'demo_password':'synthetic-password', 'pg_password':'keep-this',
               'ultrasound_image_key':'21'*32}
        (launcher.STATE/'config.json').write_text(json.dumps(old))
        with patch.dict(os.environ, {}, clear=True):
            upgraded = launcher.config()
        for name, value in old.items():
            self.assertEqual(upgraded[name], value)

    def test_previous_opt_in_keys_are_imported_without_rotation(self):
        (launcher.STATE/'ultrasound.env').write_text('export DAI_ULTRASOUND_IMAGE_KEY='+'42'*32+'\nexport DAI_ULTRASOUND_GATEWAY_TOKEN='+'g'*48+'\nexport DAI_ULTRASOUND_SERVICE_TOKEN='+'s'*48+'\n')
        with patch.dict(os.environ, {}, clear=True):
            cfg = launcher.config()
        self.assertEqual(cfg['ultrasound_image_key'], '42'*32)
        self.assertEqual(cfg['ultrasound_gateway_token'], 'g'*48)
        self.assertEqual(cfg['ultrasound_service_token'], 's'*48)

    def test_explicit_disable_is_honoured_and_hosted_minimal_config_stays_opt_in(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertNotIn('DAI_ULTRASOUND_ENABLED', launcher.environment({'jwt_secret':'j'*48,'demo_password':'synthetic'}))
            cfg = launcher.config()
        with patch.dict(os.environ, {'DAI_ULTRASOUND_ENABLED':'false'}, clear=True):
            self.assertEqual(launcher.environment(cfg)['DAI_ULTRASOUND_ENABLED'], 'false')
        cfg['ultrasound_enabled'] = False
        with patch.dict(os.environ, {'DAI_ULTRASOUND_ENABLED':'true'}, clear=True):
            self.assertEqual(launcher.environment(cfg)['DAI_ULTRASOUND_IMAGE_KEY'], cfg['ultrasound_image_key'])

    def test_dependencies_use_resolved_feature_configuration(self):
        calls = []
        with patch.object(launcher, 'run', side_effect=lambda args, **kwargs: calls.append(args)):
            launcher.dependencies({'DAI_ULTRASOUND_ENABLED':'true'})
        pip_calls = [call for call in calls if 'pip' in call]
        self.assertEqual(len(pip_calls), 1)
        self.assertIn(str(launcher.ROOT/'ml-service/requirements.txt'), [str(arg) for arg in pip_calls[0]])


if __name__ == '__main__':
    unittest.main()
