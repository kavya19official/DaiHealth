"""Service boundary only; jobs remain disabled until the relevant phase passes."""

import signal
import threading
import logging

logging.basicConfig(level=logging.INFO)
stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())
logging.info(
    "DAI worker scaffold: reservation expiry and feature jobs are not enabled in Phase 1."
)
while not stop.wait(30):
    pass
