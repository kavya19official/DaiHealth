"""Effective staff permissions are local to each active facility affiliation."""

from sqlalchemy import select, or_
from fastapi import HTTPException
from . import schema as s


def effective_staff(c, person, facility_id):
    membership = (
        c.execute(
            select(s.staff_affiliation).where(
                s.staff_affiliation.c.user_id == person["id"],
                s.staff_affiliation.c.facility_id == facility_id,
            )
        )
        .mappings()
        .first()
    )
    if membership:
        if not membership["active"]:
            raise HTTPException(422, "Staff access is inactive in this facility")
        return {
            **person,
            **{
                k: membership[k]
                for k in (
                    "facility_id",
                    "role",
                    "department_id",
                    "unit_id",
                    "registration_no",
                    "verified",
                )
            },
        }
    if person["facility_id"] != facility_id:
        raise HTTPException(422, "Staff member is not affiliated with this facility")
    return person


def facility_staff(c, facility_id):
    affiliated = select(s.staff_affiliation.c.user_id).where(
        s.staff_affiliation.c.facility_id == facility_id,
        s.staff_affiliation.c.active.is_(True),
    )
    people = c.execute(
        select(s.user).where(
            or_(s.user.c.facility_id == facility_id, s.user.c.id.in_(affiliated))
        )
    ).mappings()
    result = []
    for person in people:
        try:
            result.append(effective_staff(c, dict(person), facility_id))
        except HTTPException:
            continue
    return result
