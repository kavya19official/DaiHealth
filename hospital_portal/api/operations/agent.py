"""Tool-using operations agent. An optional Gemini caller sees aggregates only.

External calls are opt-in, capped and never allowed to approve or mutate records.
The bounded policy agent continues if the provider is missing or unreliable.
"""
from __future__ import annotations
import json
import os
import re
import time
import httpx

TOOLS = {"inspect_resource_use": "Read resource-change findings.", "inspect_tickets": "Read open non-clinical maintenance job counts.", "inspect_availability": "Read declared maintenance capacity counts.", "optimize_maintenance": "Build a feasible draft plan under recorded constraints.", "explain_plan": "Explain the draft, comparisons and unresolved items."}


def run_agent(snapshot, policy, optimizer, *, allow_external=False, provider=None):
    started, trace, seen = time.perf_counter(), [], set()
    output, attempts, tokens, provider_notes = None, 0, [], []
    model = os.getenv("DAI_OPERATIONS_AI_MODEL", "")
    configured = bool(os.getenv("GEMINI_API_KEY") and re.fullmatch(r"[A-Za-z0-9._-]{1,100}", model))
    if allow_external and not (configured or provider):
        provider_notes.append("External AI is not configured; the bounded local policy agent was used.")
    history = [{"role": "user", "parts": [{"text": "Inspect non-clinical resource use, open maintenance jobs and declared capacity; propose a plan and explain it. Never approve, diagnose, access patient records, or change data. Use only the available tools. All data is synthetic."}]}]
    plan = ["inspect_resource_use", "inspect_tickets", "inspect_availability", "optimize_maintenance", "explain_plan"]
    def choose_tool():
        nonlocal attempts
        if not allow_external or not (configured or provider) or attempts >= policy["max_provider_calls"]:
            return None
        attempts += 1
        try:
            request = {"contents": history, "tools": [{"functionDeclarations": [{"name": k, "description": v, "parameters": {"type": "OBJECT", "properties": {}}} for k, v in TOOLS.items()]}], "toolConfig": {"functionCallingConfig": {"mode": "ANY", "allowedFunctionNames": [t for t in plan if t not in seen]}}, "generationConfig": {"maxOutputTokens": 256, "temperature": 0}}
            if provider:
                response = provider(request)
            else:
                r = httpx.post("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, json=request, timeout=policy["provider_timeout_seconds"])
                r.raise_for_status()
                response = r.json()
            usage = response.get("usageMetadata", {}).get("totalTokenCount")
            tokens.append(usage if isinstance(usage, int) and usage >= 0 else None)
            content = response["candidates"][0]["content"]
            calls = [p["functionCall"] for p in content.get("parts", []) if "functionCall" in p]
            if len(calls) != 1 or calls[0].get("name") not in TOOLS or calls[0].get("args") not in ({}, None):
                raise ValueError("Invalid tool request")
            name = calls[0]["name"]
            # Dependencies are a hard gate; even a valid tool name cannot skip them.
            needed = [p for p in plan if p not in seen][0]
            if name != needed:
                raise ValueError("Tool prerequisites unmet")
            # Preserve the validated call part, including provider thoughtSignature/id,
            # for models that require them on the next function-response turn.
            part = next(p for p in content["parts"] if "functionCall" in p)
            history.append({"role": "model", "parts": [part]})
            return name
        except Exception:
            provider_notes.append("Provider tool proposal unavailable or rejected; bounded local policy continued.")
            return None
    for _ in range(policy["max_tool_steps"]):
        remaining = [p for p in plan if p not in seen]
        if not remaining:
            break
        proposed = choose_tool()
        tool = proposed or remaining[0]
        seen.add(tool)
        begin = time.perf_counter()
        if tool == "inspect_resource_use":
            result = {"findings": len(snapshot["insights"]), "patients_included": False}
            why = "Check comparable observations before suggesting resource reviews."
        elif tool == "inspect_tickets":
            result = {"open_jobs": len(snapshot["jobs"])}
            why = "Only recorded, open non-clinical tickets may become assignments."
        elif tool == "inspect_availability":
            result = {"declared_windows": len(snapshot["windows"]), "approved_assignments": len(snapshot["blocked"])}
            why = "Declared skills, time windows and existing assignments are hard constraints."
        elif tool == "optimize_maintenance":
            output = optimizer()
            result = {"scheduled_jobs": len(output["assignments"]), "unresolved_jobs": len(output["unscheduled"]), "solver": output["source"], "verified": output["verified"]}
            why = "Compare a constraint-checked draft with the same-input greedy baseline."
        else:
            result = {"approval_required": True, "external_patient_data": False, "clinical_changes": False}
            why = "Show evidence and unresolved constraints; stop before applying changes."
        trace.append({"step": len(trace) + 1, "tool": tool, "planner": "gemini_tool_call" if proposed else "bounded_policy", "reason": why, "result": result, "elapsed_ms": round((time.perf_counter() - begin) * 1000, 3)})
        if proposed:
            response_part = {"name": tool, "response": result}
            call_id = history[-1]["parts"][0]["functionCall"].get("id")
            if call_id:
                response_part["id"] = call_id
            history.append({"role": "user", "parts": [{"functionResponse": response_part}]})
    if output is None or "explain_plan" not in seen:
        raise RuntimeError("Agent budget ended before a validated plan was explained")
    return {"plan": output, "trace": trace, "agent": "gemini_tool_assisted" if any(t["planner"] == "gemini_tool_call" for t in trace) else "bounded_policy_agent", "usage": {"provider_attempts": attempts, "reported_total_tokens": sum(tokens) if attempts and len(tokens) == attempts and all(t is not None for t in tokens) else (0 if not attempts else None), "tool_calls": len(trace), "latency_ms": round((time.perf_counter() - started) * 1000, 3), "model": model if attempts else None, "energy_kwh": None, "carbon_kg": None, "note": "Server elapsed time is measured. Provider energy and carbon are unavailable; no environmental saving is inferred."}, "provider_notes": list(dict.fromkeys(provider_notes))}
