"""Opt-in, additive, visibly estimated resource fixtures; never clinical findings."""
import os
from datetime import date, timedelta
from uuid import uuid5, NAMESPACE_URL
from sqlalchemy import select
from . import schema as s


def seed_video_demo(engine):
    if not all(os.getenv(k) == 'true' for k in ('DAI_LOCAL', 'DAI_DEMO', 'DAI_VIDEO_DEMO')):
        return
    with engine.begin() as c:
        admin = c.execute(select(s.user).where(s.user.c.source_id == 'demo:hospital_admin')).mappings().first()
        if not admin or not c.scalar(select(s.seed_manifest.c.id).limit(1)):
            return
        # The seeded mother's existing clinician can demonstrate the receiving-facility handoff.
        from .demo_requests import uid
        mother = c.execute(select(s.mother).order_by(s.mother.c.source_id).limit(1)).mappings().first()
        clinician = c.execute(select(s.user).where(s.user.c.id == mother['assigned_doctor_id'])).mappings().first() if mother else None
        facility_id = uid('facility:SOUTH')
        if clinician and clinician['verified'] and clinician['registration_no'] and c.scalar(select(s.facility.c.id).where(s.facility.c.id == facility_id)):
            exists = c.scalar(select(s.staff_affiliation.c.id).where(s.staff_affiliation.c.facility_id == facility_id, s.staff_affiliation.c.user_id == clinician['id']))
            if not exists:
                identifier = str(uuid5(NAMESPACE_URL, 'dai:video-clinician:' + clinician['id']))
                c.execute(s.staff_affiliation.insert().values(id=identifier, source_id='video-mvp-clinician', facility_id=facility_id, user_id=clinician['id'], email=clinician['email'], name=clinician['name'], role=clinician['role'], department_id=uid('department:SOUTH'), unit_id=uid('unit:SOUTH'), registration_no=clinician['registration_no'], verified=True, active=True, version=1))
                c.execute(s.audit_log.insert().values(actor_id=admin['id'], action='synthetic_video_affiliation_seeded', entity_type='staff_affiliation', entity_id=identifier, details={'synthetic_only': True, 'facility_id': facility_id, 'source': 'demo-video-v1'}))
        first = date.today().replace(day=1)
        months = []
        for _ in range(4):
            first = (first - timedelta(days=1)).replace(day=1)
            months.insert(0, first.strftime('%Y-%m'))
        for i, month in enumerate(months):
            for metric, value in [('water_m3', [820, 835, 790, 810][i]), ('energy_kwh', [40500, 39800, 38700, 38200][i]), ('paper_sheets', [13000, 12000, 10500, 9400][i])]:
                if c.scalar(select(s.sustainability_measurement.c.id).where(s.sustainability_measurement.c.facility_id == admin['facility_id'], s.sustainability_measurement.c.period == month, s.sustainability_measurement.c.metric == metric)):
                    continue
                identifier = str(uuid5(NAMESPACE_URL, f"dai:video-resource:{admin['facility_id']}:{month}:{metric}"))
                c.execute(s.sustainability_measurement.insert().values(id=identifier, facility_id=admin['facility_id'], recorded_by=admin['id'], period=month, metric=metric, value=value, quality='estimated', source='SYNTHETIC VIDEO FIXTURE — not meter data', evidence='DEMO-VIDEO-v1; fictional resource observation', occupied_bed_days=2200))
                c.execute(s.audit_log.insert().values(actor_id=admin['id'], action='synthetic_video_fixture_seeded', entity_type='sustainability_measurement', entity_id=identifier, details={'synthetic_only': True, 'quality': 'estimated', 'source': 'demo-video-v1'}))
