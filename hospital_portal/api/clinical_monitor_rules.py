"""Pure, versioned clinical-review rules. Inputs are dated, structured records."""

import math
from datetime import date
from statistics import median

VERSION = "pregnancy-monitor-v1"
ACOG = "https://www.acog.org/womens-health/faqs/preeclampsia-and-high-blood-pressure-during-pregnancy"
ADA = "https://doi.org/10.2337/dc26-s015"
ADA_TEST = "https://doi.org/10.2337/dc26-s002"
WEIGHT = "https://doi.org/10.17226/12584"

# Urgent, high, routine. All priorities route to the same clinician review queue.
URGENT, HIGH, ROUTINE = 3, 2, 1
REPORT_FLAGS = {"abnormal", "positive", "out of range", "high", "low", "high-risk screen", "critical"}
GLUCOSE_TARGETS = {"fasting": 95, "postprandial_1h": 140, "postprandial_2h": 120}


def day(value):
    if not isinstance(value, str):
        return None
    try:
        if len(value) == 10:
            result = date.fromisoformat(value)
            return result if result.isoformat() == value else None
        return None
    except ValueError:
        return None


def numeric(value, low, high):
    return (
        float(value) if type(value) in (int, float) and low <= value <= high
        and math.isfinite(value) else None
    )


def evidence(row, values):
    return {
        "source": row["source"],
        "record_id": str(row["id"]),
        "date": row["date"].isoformat(),
        "values": values,
    }


def flag(key, priority, summary, action, reference, records):
    return dict(rule_key=key, rule_version=VERSION, priority=priority, summary=summary,
                action=action, reference_url=reference, evidence=records)


def bp_flag(visits, as_of):
    observed = []
    for row in visits:
        a, b = numeric(row.get("sbp"), 55, 280), numeric(row.get("dbp"), 25, 180)
        if a is None or b is None or a <= b:
            continue
        observed.append((row, a, b))
    recent = [(r, a, b) for r, a, b in observed if (as_of - r["date"]).days <= 30]
    severe = [(r, a, b) for r, a, b in recent if (as_of-r["date"]).days <= 7 and (a >= 160 or b >= 110)]
    raised = [(r, a, b) for r, a, b in recent if a >= 140 or b >= 90]
    samples = severe or raised
    if not samples:
        return None, len(observed)
    dates = len({r["date"] for r, _, _ in samples})
    r, a, b = samples[-1]
    title = "Severe-range blood pressure recorded" if severe else (
        "Raised blood pressure on multiple dates" if dates >= 2 else "Raised blood pressure recorded"
    )
    return flag("blood_pressure", URGENT if severe else HIGH if dates >= 2 else ROUTINE,
        f"{title}. Latest qualifying reading {a:g}/{b:g} mmHg on {r['date']}.",
        "Review dates, source and measurement conditions. Check for repeat measurements and assess promptly according to your clinical protocol.",
        ACOG, [evidence(x, {"systolic": y, "diastolic": z, "unit": "mmHg"}) for x, y, z in samples[-4:]]), len(observed)


def weight_trends(visits, lmp, baseline):
    weight = [(row, numeric(row.get("weight_kg"), 25, 300)) for row in visits]
    result, flags = [], []
    for number, (first, last) in enumerate(((0, 97), (98, 195), (196, 294)), 1):
        by_day = {}
        for row, value in weight:
            if value is not None and first <= (row["date"]-lmp).days <= last:
                by_day.setdefault(row["date"], []).append((row, value))
        if not by_day:
            continue
        # Use the median of that day's recorded weights. Retain IDs of contributing endpoint rows.
        points = [(d, median(v for _, v in rows), rows) for d, rows in sorted(by_day.items())]
        a, b = points[0], points[-1]
        duration = (b[0]-a[0]).days
        rate = (b[1]-a[1])*7/duration if duration else None
        trend = dict(trimester=number, dates=len(points), first_date=a[0].isoformat(), last_date=b[0].isoformat(),
                     change_kg=round(b[1]-a[1], 2) if duration else None,
                     kg_per_week=round(rate, 2) if rate is not None else None,
                     evidence=[evidence(r, {"weight_kg": v}) for r, v in (a[2] + b[2] if duration else a[2])])
        result.append(trend)
        if number == 1 or baseline is None or duration < 14:
            continue
        bmi, baseline_evidence = baseline
        low, high = (0.44, 0.58) if bmi < 18.5 else (0.35, 0.50) if bmi < 25 else (0.23, 0.33) if bmi < 30 else (0.17, 0.27)
        if low <= rate <= high:
            continue
        trend["reference_kg_per_week"] = [low, high]
        flags.append(flag(f"weight_t{number}", ROUTINE,
            f"Trimester {number} weight change averaged {rate:+.2f} kg/week over {duration} days. Reference range for the recorded baseline BMI is {low:.2f}–{high:.2f} kg/week.",
            "Verify the baseline and measurement conditions and review the curve in the context of the pregnancy.",
            WEIGHT, [baseline_evidence, *trend["evidence"]]))
    return result, flags


def glucose_flag(rows, as_of):
    samples = []
    for r in rows:
        context = r.get("context")
        if context not in GLUCOSE_TARGETS:
            continue
        unit = r.get("unit")
        if unit not in {"mg/dL", "mmol/L"}:
            continue
        value = numeric(r.get("glucose"), 1 if unit == "mmol/L" else 18, 40 if unit == "mmol/L" else 720)
        if value is None:
            continue
        limit = GLUCOSE_TARGETS[context] if unit == "mg/dL" else {"fasting": 5.3, "postprandial_1h": 7.8, "postprandial_2h": 6.7}[context]
        if (as_of-r["date"]).days <= 30 and value >= limit:
            samples.append((r, value, limit))
    if not samples:
        return None
    num_days = len({r["date"] for r, _, _ in samples})
    return flag("glucose_monitoring", HIGH if num_days >= 2 else ROUTINE,
        f"Glucose reached or exceeded a review reference on {num_days} recorded day(s) in the last 30 days.",
        "Verify fasting or meal timing and units. Compare with the patient’s clinician-set targets and review the glucose record.",
        ADA, [evidence(r, {"glucose": v, "unit": r["unit"], "context": r["context"], "review_reference": limit})
              for r, v, limit in samples[-5:]])


def evaluate(profile, rows, as_of):
    lmp = profile["lmp"]
    start = lmp.toordinal()
    def eligible(row):
        return 0 <= row["date"].toordinal()-start <= 294 and row["date"] <= as_of
    visits = sorted((r for r in rows["visits"] if eligible(r)), key=lambda r: (r["date"], str(r["id"])))
    flags = []
    bp, bp_count = bp_flag(visits, as_of)
    if bp:
        flags.append(bp)
    trends, weights = weight_trends(visits, lmp, profile.get("baseline"))
    flags.extend(weights)
    glucose = sorted((r for r in rows["glucose"] if eligible(r)), key=lambda r: (r["date"], str(r["id"])))
    found = glucose_flag(glucose, as_of)
    if found:
        flags.append(found)
    reports = sorted((r for r in rows["reports"] if eligible(r)), key=lambda r: (r["date"], str(r["id"])))
    # Latest finalized result per test wins, so an amended/superseded result does not create an alert.
    latest = {r["test"]:r for r in reports}
    for r in latest.values():
        if r.get("protocol") == "ogtt_75g_2h":
            unit = r.get("unit")
            limit = {"mg/dL":153,"mmol/L":8.5}.get(unit)
            glucose_value = numeric(r.get("value"),0,720) if unit == "mg/dL" else numeric(r.get("value"),0,40)
            if limit and glucose_value is not None and glucose_value >= limit:
                flags.append(flag("ogtt_75g_2h:"+r["test"],HIGH,
                    f"Recorded 75-g OGTT two-hour value was {glucose_value:g} {unit} on {r['date']}.",
                    "Verify the recorded protocol, timing and original result and review using the local clinical protocol.",
                    ADA_TEST,[evidence(r,{"test":r["test"],"value":glucose_value,"unit":unit,
                      "protocol":"75-g OGTT at two hours","review_reference":limit,"order_id":r["order_id"]})]))
        if r.get("flag") not in REPORT_FLAGS:
            continue
        title = f"Recorded {r['flag']} result for {r['test']} on {r['date']}."
        flags.append(flag("result:"+r["test"], URGENT if r["flag"]=="critical" and (as_of-r["date"]).days<=7 else HIGH, title,
            "Open the finalized result, verify its reference range and context, and record the appropriate clinical disposition.",
            ADA_TEST if "ogtt" in r["test"].lower() else "", [evidence(r, {"test":r["test"], "reported_flag":r["flag"],
                "reported_value":r.get("value"),"unit":r.get("unit"),"order_id":r.get("order_id")})]))
    finalized_orders = {r["order_id"] for r in reports}
    overdue = sorted((r for r in rows["gaps"] if eligible(r) and r["date"] < as_of
                      and r["id"] not in finalized_orders),
                     key=lambda r: (r["date"], str(r["id"])))
    if overdue:
        flags.append(flag("missed_care", ROUTINE, f"{len(overdue)} prenatal care item(s) overdue in the record.",
            "Confirm whether care was completed elsewhere. Review the due dates with the care team and arrange follow-up if still needed.",
            "", [evidence(r, {"item":r["item"],"status":r["status"]}) for r in overdue[:5]]))
    return flags, trends, dict(anc_visits=len(visits), paired_bp=bp_count, weight_trimesters=len(trends),
        weight_reference_available=profile.get("baseline") is not None, glucose_context_records=len(glucose),
        finalized_reports=len(reports), overdue_care_items=len(overdue))
