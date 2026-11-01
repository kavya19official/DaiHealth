"""Opt-in non-clinical fixtures must stay explicit, scoped and preserve edits."""
from sqlalchemy import select,func,update
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api import schema as s
from hospital_portal.api.demo_video_seed import seed_video_demo


def test_video_resource_fixtures_are_opt_in_and_preserve_existing_values(tmp_path,monkeypatch):
    engine=database('sqlite:///'+str(tmp_path/'video.db'))
    try:
        seed(engine)
        monkeypatch.setenv('DAI_LOCAL','true');monkeypatch.setenv('DAI_DEMO','true');monkeypatch.setenv('DAI_VIDEO_DEMO','false')
        seed_video_demo(engine)
        with engine.connect() as c:assert c.scalar(select(func.count()).select_from(s.sustainability_measurement))==0
        monkeypatch.setenv('DAI_VIDEO_DEMO','true');seed_video_demo(engine)
        with engine.begin() as c:
            rows=c.execute(select(s.sustainability_measurement)).mappings().all();assert len(rows)==12
            assert len({r['facility_id'] for r in rows})==1
            assert all(r['quality']=='estimated' and 'SYNTHETIC' in r['source'] for r in rows)
            target=rows[0]['id'];c.execute(update(s.sustainability_measurement).where(s.sustainability_measurement.c.id==target).values(value=12345))
        seed_video_demo(engine)
        with engine.connect() as c:
            assert c.scalar(select(func.count()).select_from(s.sustainability_measurement))==12
            assert c.scalar(select(s.sustainability_measurement.c.value).where(s.sustainability_measurement.c.id==target))==12345
    finally:engine.dispose()
