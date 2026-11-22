"""Privacy-preserving care-gap geography from the recorded synthetic ledger.

PIN codes are used as outreach zones because the source records contain no
verified block or ward-of-residence field. No clinical risk score is produced.
"""

from collections import defaultdict
from datetime import date
from statistics import median

MIN_CELL = 10
LONG_REFERRAL_MINUTES = 120


def _band(value):
    if value < 20:
        return "10–19"
    if value < 50:
        return "20–49"
    return "50+"


def _rate(affected, population):
    return round(len(affected) / population * 100, 1) if population else None


def care_gap_geography(db, hospital_id, as_of, area="", outreach_mothers=None):
    outreach_mothers = outreach_mothers or {}
    mothers = {
        row["mother_id"]: dict(row)
        for row in db.execute(
            """SELECT mother_id,district,pincode,home_latitude,home_longitude
               FROM mothers WHERE registered_hospital_id=?""",
            (hospital_id,),
        )
    }
    groups = defaultdict(
        lambda: {
            "people": set(),
            "latitudes": [],
            "longitudes": [],
            "missed_anc": set(),
            "overdue_vaccine": set(),
            "long_referral": set(),
            "any_gap": set(),
            "gap_count": 0,
            "referral_minutes": [],
        }
    )
    for mother_id, mother in mothers.items():
        key = mother.get("pincode") or "Not recorded"
        group = groups[key]
        group["people"].add(mother_id)
        if mother.get("home_latitude") is not None:
            group["latitudes"].append(float(mother["home_latitude"]))
        if mother.get("home_longitude") is not None:
            group["longitudes"].append(float(mother["home_longitude"]))

    gap_by_mother = defaultdict(list)
    for row in db.execute(
        """SELECT g.gap_type,g.expected_item,g.due_date,g.subject_type,
                  CASE WHEN g.subject_type='mother' THEN g.subject_id ELSE n.mother_id END mother_id
             FROM care_gaps g
             LEFT JOIN newborns n ON g.subject_type='child' AND n.child_id=g.subject_id
            WHERE g.status='open' AND g.due_date<=?""",
        (as_of,),
    ):
        mother_id = row["mother_id"]
        if mother_id not in mothers:
            continue
        key = mothers[mother_id].get("pincode") or "Not recorded"
        group = groups[key]
        group["gap_count"] += 1
        group["any_gap"].add(mother_id)
        gap_by_mother[mother_id].append(dict(row))
        if row["gap_type"] == "missed ANC visit":
            group["missed_anc"].add(mother_id)
        elif row["gap_type"] == "missed vaccine":
            group["overdue_vaccine"].add(mother_id)

    for row in db.execute(
        """SELECT p.mother_id,r.transport_time_min
             FROM referrals r JOIN pregnancies p USING(pregnancy_id)
            WHERE (r.referred_from_hospital_id=? OR r.referred_to_hospital_id=?)
              AND r.transport_time_min IS NOT NULL""",
        (hospital_id, hospital_id),
    ):
        mother_id = row["mother_id"]
        if mother_id not in mothers:
            continue
        key = mothers[mother_id].get("pincode") or "Not recorded"
        groups[key]["referral_minutes"].append(row["transport_time_min"])
        if row["transport_time_min"] > LONG_REFERRAL_MINUTES:
            groups[key]["long_referral"].add(mother_id)

    district = next(
        (m.get("district") for m in mothers.values() if m.get("district")),
        "Not recorded",
    )
    visible, suppressed = [], 0
    for pincode, group in groups.items():
        population = len(group["people"])
        if population < MIN_CELL:
            suppressed += 1
            continue
        visible.append(
            {
                "area": pincode,
                "people_band": _band(population),
                "population": population,
                "latitude": round(sum(group["latitudes"]) / len(group["latitudes"]), 5)
                if group["latitudes"]
                else None,
                "longitude": round(sum(group["longitudes"]) / len(group["longitudes"]), 5)
                if group["longitudes"]
                else None,
                "care_gap_rate": _rate(group["any_gap"], population),
                "missed_anc_rate": _rate(group["missed_anc"], population),
                "overdue_vaccine_rate": _rate(group["overdue_vaccine"], population),
                "long_referral_rate": _rate(group["long_referral"], population),
                "open_gap_records": group["gap_count"],
                "median_referral_minutes": round(median(group["referral_minutes"]), 1)
                if group["referral_minutes"]
                else None,
            }
        )
    visible.sort(key=lambda row: (-row["care_gap_rate"], row["area"]))

    selected = next((row for row in visible if row["area"] == area), None)
    outreach = []
    if selected and outreach_mothers:
        candidates = []
        for mother_id, gaps in gap_by_mother.items():
            if (mothers[mother_id].get("pincode") or "Not recorded") != area:
                continue
            portal = outreach_mothers.get(mother_id)
            if not portal:
                continue
            categories = sorted({g["gap_type"] for g in gaps})
            due_dates = sorted(g["due_date"] for g in gaps if g.get("due_date"))
            candidates.append(
                {
                    "portal_mother_id": portal["id"],
                    "name": portal["name"],
                    "area": area,
                    "open_gap_count": len(gaps),
                    "gap_types": categories,
                    "oldest_due_date": due_dates[0] if due_dates else None,
                }
            )
        outreach = sorted(
            candidates,
            key=lambda row: (-row["open_gap_count"], row["oldest_due_date"] or date.max.isoformat(), row["name"]),
        )[:50]

    focus = selected or (visible[0] if visible else None)
    suggestions = []
    if focus:
        if focus["missed_anc_rate"]:
            suggestions.append("Review missed antenatal visit outreach in this recorded zone.")
        if focus["overdue_vaccine_rate"]:
            suggestions.append("Coordinate a vaccination follow-up list with the responsible child-health team.")
        if focus["long_referral_rate"]:
            suggestions.append("Review recorded referral transport times and handover barriers with the receiving team.")
    return {
        "district": district,
        "areas": visible,
        "suppressed_area_count": suppressed,
        "minimum_cell_size": MIN_CELL,
        "long_referral_threshold_minutes": LONG_REFERRAL_MINUTES,
        "selected_area": selected,
        "outreach": outreach,
        "outreach_authorized": bool(outreach_mothers),
        "suggested_actions": suggestions,
        "methodology": (
            "PIN-code outreach zones use recorded home coordinates. Rates are distinct affected mothers or families "
            "divided by registered mothers in the zone. Groups below 10 are omitted. This is operational follow-up "
            "context, not a clinical risk score or a comparison of facilities."
        ),
    }
