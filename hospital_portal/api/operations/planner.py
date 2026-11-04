"""CP-SAT maintenance planning with an independent feasibility verifier.

No clinical assignments, patient routing, safety judgements or roster edits.
Times are integer minutes; durations and priority weights are declared policy.
"""
from __future__ import annotations

import time
from collections import defaultdict

try:
    from ortools.sat.python import cp_model
except (ImportError, OSError):
    cp_model = None


def overlap(a, b):
    return a[0] < b[1] and b[0] < a[1]


def candidates(job, windows):
    return [w for w in windows if job["domain"] in w["domains"] and w["end"] - w["start"] >= job["duration"]]


def verify(assignments, jobs, windows, blocked=()):
    """Recheck every hard constraint independently of the optimisation solver."""
    by_job = {j["id"]: j for j in jobs}
    by_window = {w["id"]: w for w in windows}
    used, staff = set(), defaultdict(list)
    for b in blocked:
        staff[b["staff_id"]].append((b["start"], b["end"]))
    for a in assignments:
        if a["job_id"] in used or a["job_id"] not in by_job or a["window_id"] not in by_window:
            return False
        j, w = by_job[a["job_id"]], by_window[a["window_id"]]
        if a["staff_id"] != w["staff_id"] or j["domain"] not in w["domains"]:
            return False
        if a["end"] - a["start"] != j["duration"] or not w["start"] <= a["start"] < a["end"] <= w["end"]:
            return False
        if any(overlap((a["start"], a["end"]), p) for p in staff[a["staff_id"]]):
            return False
        staff[a["staff_id"]].append((a["start"], a["end"]))
        used.add(a["job_id"])
    return True


def greedy(jobs, windows, blocked=()):
    result, busy = [], defaultdict(list)
    for b in blocked:
        busy[b["staff_id"]].append((b["start"], b["end"]))
    for j in sorted(jobs, key=lambda j: (-j["points"], j["id"])):
        choices = []
        for w in candidates(j, windows):
            start = w["start"]
            for a, b in sorted(busy[w["staff_id"]]):
                if overlap((start, start + j["duration"]), (a, b)):
                    start = b
            if start + j["duration"] <= w["end"]:
                choices.append((start, w["id"], w))
        if choices:
            start, _, w = min(choices, key=lambda x: (x[0], x[1]))
            a = {"job_id": j["id"], "window_id": w["id"], "staff_id": w["staff_id"], "start": start, "end": start + j["duration"]}
            result.append(a)
            busy[w["staff_id"]].append((a["start"], a["end"]))
    return result


def solve(jobs, windows, blocked=(), *, seconds=2, seed=42, force_rules=False):
    started = time.perf_counter()
    baseline = greedy(jobs, windows, blocked)
    assignments, status, source, bound = baseline, "RULE_FALLBACK", "rules", None
    if not force_rules and cp_model is not None and jobs and windows:
        model = cp_model.CpModel()
        intervals, options = defaultdict(list), []
        origin = min(w["start"] for w in windows)
        horizon = max(w["end"] for w in windows) - origin
        # One priority point dominates the largest possible aggregate start-time penalty.
        scale = (horizon + 1) * (len(jobs) + 1)
        terms = []
        for j in jobs:
            choices = []
            for w in candidates(j, windows):
                key = str(len(options))
                active = model.new_bool_var("assign_" + key)
                start = model.new_int_var(w["start"] - origin, w["end"] - origin - j["duration"], "start_" + key)
                interval = model.new_optional_fixed_size_interval_var(start, j["duration"], active, "job_" + key)
                intervals[w["staff_id"]].append(interval)
                chosen_start = model.new_int_var(0, horizon, "chosen_start_" + key)
                model.add(chosen_start == start).only_enforce_if(active)
                model.add(chosen_start == 0).only_enforce_if(active.Not())
                terms.append(active * j["points"] * scale - chosen_start)
                choices.append(active)
                options.append((j, w, active, start))
            if choices:
                model.add(sum(choices) <= 1)
        for i, b in enumerate(blocked):
            intervals[b["staff_id"]].append(model.new_fixed_size_interval_var(b["start"] - origin, b["end"] - b["start"], "approved_" + str(i)))
        for items in intervals.values():
            model.add_no_overlap(items)
        model.maximize(sum(terms))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = seconds
        solver.parameters.random_seed = seed
        solver.parameters.num_search_workers = 1
        result = solver.solve(model)
        status = solver.status_name(result)
        if result in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            source = "cp_sat"
            assignments = [{"job_id": j["id"], "window_id": w["id"], "staff_id": w["staff_id"], "start": solver.value(start) + origin, "end": solver.value(start) + origin + j["duration"]} for j, w, active, start in options if solver.value(active)]
            bound = solver.best_objective_bound
        else:
            status += "_RULE_FALLBACK"
    elif not jobs:
        status = "NO_OPEN_JOBS"
    elif not windows:
        status = "NO_DECLARED_CAPACITY"
    points = {j["id"]: j["points"] for j in jobs}
    if sum(points[a["job_id"]] for a in assignments) < sum(points[a["job_id"]] for a in baseline):
        assignments, source, status, bound = baseline, "rules", status + "_BASELINE_GUARD", None
    if not verify(assignments, jobs, windows, blocked):
        raise RuntimeError("Planner output failed independent constraint validation")
    points = {j["id"]: j["points"] for j in jobs}
    score = lambda rows: sum(points[a["job_id"]] for a in rows)
    scheduled = {a["job_id"] for a in assignments}
    return {"source": source, "status": status, "assignments": sorted(assignments, key=lambda a: (a["start"], a["staff_id"], a["job_id"])), "unscheduled": [{"job_id": j["id"], "reason": "No declared window has the required domain and duration." if not candidates(j, windows) else "Declared capacity is occupied or used by the priority-weighted plan; review alternatives."} for j in jobs if j["id"] not in scheduled], "objective": {"name": "priority-weighted jobs covered, then earlier starts", "points": score(assignments), "baseline_points": score(baseline), "baseline_jobs": len(baseline), "scheduled_jobs": len(assignments), "point_difference": score(assignments) - score(baseline), "best_bound": bound, "baseline": "priority-first greedy with identical hard constraints"}, "constraints": ["One assignment per job", "Declared staff-domain match", "Entire job within declared availability", "No overlap per staff member, including approved jobs", "Exact configured duration"], "verified": True, "elapsed_ms": round((time.perf_counter() - started) * 1000, 3), "energy_kwh": None}
