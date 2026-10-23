"""Exercise the real OS lock and stop handshake without starting app services."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

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


if __name__ == '__main__':
    unittest.main()
