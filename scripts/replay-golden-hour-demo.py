"""Explicit, local-only replay of the four synthetic showcase alerts.
Prior acceptance events are retained; a replay event is appended. Not run at startup.
"""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]

def replay():
    if os.getenv('DAI_LOCAL') != 'true' or os.getenv('DAI_REPLAY_GOLDEN_HOUR') != 'true':
        raise RuntimeError('Explicit local Golden Hour replay opt-ins are required.')
    db = sqlite3.connect(ROOT / '.local/portal.db', timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN IMMEDIATE')
        rows = [dict(r) for r in db.execute("SELECT * FROM golden_hour_alert WHERE source_id IN ('showcase:golden-hour-meera','showcase:golden-hour-asha','showcase:golden-hour-sana','showcase:golden-hour-riya')")]
        if len(rows) != 4:
            raise RuntimeError('Expected exactly four known fictional showcase alerts.')
        backup = ROOT / '.local/profile-backups'
        backup.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat()
        target = backup / ('golden-hour-replay-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
        target.write_text(json.dumps(rows, indent=2))
        target.chmod(0o600)
        for row in rows:
            version = row['version'] + 1
            db.execute("UPDATE golden_hour_alert SET status='incoming',seen_at=NULL,decided_at=NULL,decided_by=NULL,arrived_at=NULL,created_at=?,updated_at=?,version=?,public_note=? WHERE id=?",(now,now,version,'Synthetic demo replay: awaiting a new receiving-team decision.',row['id']))
            db.execute('INSERT INTO golden_hour_event(id,created_at,updated_at,alert_id,actor_type,actor_key,status,note,version) VALUES(?,?,?,?,?,?,?,?,?)',(uuid4().hex,now,now,row['id'],'demo_replay','local-rehearsal','incoming','Explicit synthetic demo replay; prior decisions remain in this audit history.',version))
        db.commit()
        print('Reopened four synthetic showcase alerts; prior audit events preserved.')
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == '__main__':
    replay()
