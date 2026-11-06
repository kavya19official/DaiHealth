"""Prototype finite-window planner. Receives de-identified candidate indices, not records."""
import json
import sys
import time
from ortools.sat.python import cp_model


def plan(data):
    started = time.monotonic()
    candidates = data.get("candidates", [])
    tasks = data.get("task_count", 0)
    if not 2 <= tasks <= 8 or not candidates or len(candidates) > 160:
        return {"status": "NO_PLAN", "plans": [], "elapsed_ms": round((time.monotonic() - started) * 1000, 3)}
    if any(not any(c["task"] == t for c in candidates) for t in range(tasks)):
        return {"status": "NO_PLAN", "plans": [], "elapsed_ms": round((time.monotonic() - started) * 1000, 3)}
    model = cp_model.CpModel()
    chosen = [model.new_bool_var(f"candidate_{i}") for i in range(len(candidates))]
    for t in range(tasks):
        model.add(sum(chosen[i] for i, c in enumerate(candidates) if c["task"] == t) == 1)
    # A single subject cannot attend overlapping appointments or different centres in one day.
    for i, a in enumerate(candidates):
        for j in range(i + 1, len(candidates)):
            b = candidates[j]
            if a["task"] == b["task"] or a["date"] != b["date"]:
                continue
            if a["centre"] != b["centre"] or (a["start"] < b["end"] and b["start"] < a["end"]):
                model.add(chosen[i] + chosen[j] <= 1)
    for doctor, date in {(c.get("doctor"), c["date"]) for c in candidates}:
        ix = [i for i, c in enumerate(candidates) if c.get("doctor") == doctor and c["date"] == date]
        remaining = min(candidates[i].get("remaining", 160) for i in ix)
        model.add(sum(chosen[i] for i in ix) <= remaining)
    day_flags = []
    for day in sorted({c["date"] for c in candidates}):
        flag = model.new_bool_var(f"day_{day}")
        ix = [i for i, c in enumerate(candidates) if c["date"] == day]
        for i in ix:
            model.add(chosen[i] <= flag)
        model.add(flag <= sum(chosen[i] for i in ix))
        day_flags.append(flag)
    # Prefer fewer distinct days, then earlier recorded windows. No health/savings score.
    model.minimize(sum(day_flags) * 100000 + sum(chosen[i] * c["day_offset"] for i, c in enumerate(candidates)))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = min(float(data.get("timeout_seconds", .35)), .5)
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 42
    plans = []
    name = "NO_PLAN"
    for _ in range(3):
        result = solver.solve(model)
        name = solver.status_name(result)
        if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        indices = [i for i, v in enumerate(chosen) if solver.value(v)]
        plans.append(indices)
        model.add(sum(chosen[i] for i in indices) <= tasks - 1)
    return {"status": "FEASIBLE" if plans else name, "plans": plans, "elapsed_ms": round((time.monotonic() - started) * 1000, 3)}


if __name__ == "__main__":
    print(json.dumps(plan(json.load(sys.stdin))))
