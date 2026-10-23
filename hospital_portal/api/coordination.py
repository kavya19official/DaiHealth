"""Owned care tasks and human-reviewed summaries in the authenticated local preview.

These writes never alter imported clinical observations or assign a risk score.
The PostgreSQL deployment gate remains separate; writes require explicit demo mode.
"""

import os
from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update, func
from sqlalchemy.exc import IntegrityError
from . import schema as s
from .staff_scope import effective_staff, facility_staff
from .security import ROLES


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NewTask(Input):
    mother_id: UUID
    child_id: UUID | None = None
    gap_id: UUID | None = None
    title: str = Field(min_length=3, max_length=180)
    assigned_to: UUID
    due_date: date
    notes: str = Field(default="", max_length=2000)
    kind: Literal[
        "follow_up", "referral_follow_up", "postpartum", "newborn", "investigation"
    ] = "follow_up"


class TaskChange(Input):
    version: int = Field(ge=1)
    action: Literal[
        "acknowledge", "contact", "reassign", "escalate", "complete", "reopen"
    ]
    notes: str = Field(min_length=3, max_length=2000)
    assigned_to: UUID | None = None
    evidence: str = Field(default="", max_length=1000)
    barrier: Literal[
        "none",
        "transport",
        "cost",
        "language",
        "unreachable",
        "appointment_unavailable",
        "records_missing",
        "other",
    ] = "none"
    outcome: Literal[
        "reached",
        "no_answer",
        "care_completed",
        "follow_up_booked",
        "unable_to_access",
        "needs_clinician_review",
        "not_applicable",
    ] = "not_applicable"


class NewReview(Input):
    mother_id: UUID
    kind: Literal["clinician_review", "visit_summary"]
    title: str = Field(min_length=3, max_length=180)
    content: str = Field(min_length=5, max_length=4000)
    source: str = Field(min_length=3, max_length=1000)


class ReviewChange(Input):
    version: int = Field(ge=1)
    action: Literal["acknowledge", "approve", "request_correction", "close"]
    notes: str = Field(min_length=3, max_length=2000)


class ReviewRevision(Input):
    version: int = Field(ge=1)
    content: str = Field(min_length=5, max_length=4000)
    source: str = Field(min_length=3, max_length=1000)
    reason: str = Field(min_length=3, max_length=1000)


def register_coordination(app, engine, require, audit, one, clinical_scope):
    def preview():
        if os.getenv("DAI_DEMO", "false").lower() != "true":
            raise HTTPException(
                409,
                "Coordination writes are enabled only in the explicit synthetic preview; production deployment acceptance is pending.",
            )

    def cohort(u):
        conditions = [
            s.mother.c.registered_facility_id == u["facility_id"],
            s.mother.c.consent_flags["care_coordination"].as_boolean().is_(True),
        ]
        if u["role"] in {"consultant", "resident"}:
            conditions.append(s.mother.c.assigned_unit_id == u["unit_id"])
        if u["role"] == "resident":
            conditions.append(s.mother.c.assigned_doctor_id == u["id"])
        return conditions

    def subject(c, u, mid):
        m = one(s.mother, str(mid), c)
        clinical_scope(u, m)
        if not m["consent_flags"].get("care_coordination"):
            raise HTTPException(
                403, "Care-coordination authorisation is not recorded for this patient."
            )
        return m

    def owner(c, u, m, identifier):
        user = effective_staff(c, one(s.user, str(identifier), c), u["facility_id"])
        if user["facility_id"] != u["facility_id"] or "care.write" not in ROLES.get(
            user["role"], set()
        ):
            raise HTTPException(
                422, "Select an authorised care owner in this facility."
            )
        if user["role"] in {"consultant", "resident"} and (
            not user["verified"] or user["unit_id"] != m["assigned_unit_id"]
        ):
            raise HTTPException(
                422, "The clinician must be verified and linked to this patient's unit."
            )
        if user["role"] == "resident" and user["id"] != m["assigned_doctor_id"]:
            raise HTTPException(422, "The resident must be assigned to this patient.")
        return user

    def decorated(c, row, u):
        m = subject(c, u, row["mother_id"])
        audit(c, u, "read", "mother", m["id"], {"view": "care_coordination"})
        return {
            **row,
            "mother_name": m["details"].get("name", m["uhid"]),
            "mother_source_id": m["source_id"],
            "mother_unit_id": m["assigned_unit_id"],
            "mother_doctor_id": m["assigned_doctor_id"],
        }

    def save(c, u, table, row, version, status, details, action):
        if row["details"].get("version") != version:
            raise HTTPException(409, "This record changed. Refresh before saving.")
        details = {**details, "version": version + 1}
        changed = c.execute(
            update(table)
            .where(
                table.c.id == row["id"],
                table.c.details["version"].as_integer() == version,
            )
            .values(status=status, details=details)
        )
        if changed.rowcount != 1:
            raise HTTPException(
                409, "Another staff member updated this record. Refresh and retry."
            )
        audit(
            c,
            u,
            action,
            table.name,
            row["id"],
            {
                "previous_status": row["status"],
                "status": status,
                "version": version + 1,
            },
        )
        return {"id": row["id"], "status": status, "version": version + 1}

    @app.get("/api/care/options")
    def options(q: str = Query("", max_length=100), u=Depends(require("care.read"))):
        with engine.begin() as c:
            conditions = cohort(u)
            if q.strip():
                conditions.append(
                    s.mother.c.details["name"]
                    .as_string()
                    .icontains(q.strip(), autoescape=True)
                )
            mothers = [
                dict(m)
                for m in c.execute(
                    select(s.mother)
                    .where(*conditions)
                    .order_by(s.mother.c.source_id)
                    .limit(50)
                ).mappings()
            ]
            for m in mothers:
                audit(c, u, "read", "mother", m["id"], {"view": "coordination_picker"})
            mids = [m["id"] for m in mothers]
            children = [
                dict(ch)
                for ch in c.execute(
                    select(s.child).where(s.child.c.mother_id.in_(mids))
                ).mappings()
            ]
            for ch in children:
                audit(c, u, "read", "child", ch["id"], {"view": "coordination_picker"})
            staff = [
                {k: r[k] for k in ("id", "name", "role", "unit_id")}
                for r in facility_staff(c, u["facility_id"])
                if "care.write" in ROLES.get(r["role"], set())
            ]
            return {
                "mothers": mothers,
                "children": children,
                "staff": staff,
                "limit": 50,
                "data_label": "Simulated on synthetic data",
            }

    @app.get("/api/care/tasks")
    def tasks(
        status: str = Query("", max_length=30),
        q: str = Query("", max_length=100),
        page: int = Query(1, ge=1),
        u=Depends(require("care.read")),
    ):
        with engine.begin() as c:
            conditions = [s.worklist_item.c.facility_id == u["facility_id"], *cohort(u)]
            if status:
                conditions.append(s.worklist_item.c.status == status)
            if q.strip():
                conditions.append(
                    s.worklist_item.c.details["title"]
                    .as_string()
                    .icontains(q.strip(), autoescape=True)
                )
            query = (
                select(s.worklist_item)
                .join(s.mother, s.mother.c.id == s.worklist_item.c.mother_id)
                .where(*conditions)
            )
            total = c.scalar(select(func.count()).select_from(query.subquery()))
            items = [
                decorated(c, dict(r), u)
                for r in c.execute(
                    query.order_by(
                        s.worklist_item.c.updated_at.desc(), s.worklist_item.c.id
                    )
                    .offset((page - 1) * 25)
                    .limit(25)
                ).mappings()
            ]
            return {"items": items, "total": total, "page": page}

    @app.get("/api/care/gaps")
    def gaps(page: int = Query(1, ge=1), u=Depends(require("care.read"))):
        # Resolve child-only gaps through the existing child→mother relationship.
        with engine.begin() as c:
            query = (
                select(
                    s.care_gap,
                    s.mother.c.id.label("subject_mother_id"),
                    s.mother.c.details.label("mother_details"),
                )
                .outerjoin(s.child, s.child.c.id == s.care_gap.c.child_id)
                .join(
                    s.mother,
                    s.mother.c.id
                    == func.coalesce(s.care_gap.c.mother_id, s.child.c.mother_id),
                )
                .where(*cohort(u))
                .order_by(s.care_gap.c.due_date, s.care_gap.c.id)
            )
            total = c.scalar(select(func.count()).select_from(query.subquery()))
            items = []
            for record in c.execute(query.offset((page - 1) * 25).limit(25)).mappings():
                r = dict(record)
                subject(c, u, r["subject_mother_id"])
                audit(
                    c,
                    u,
                    "read",
                    "mother",
                    r["subject_mother_id"],
                    {"view": "gap_task_intake"},
                )
                linked = (
                    c.execute(
                        select(s.worklist_item.c.id, s.worklist_item.c.status).where(
                            s.worklist_item.c.source_id == "care-gap:" + r["id"]
                        )
                    )
                    .mappings()
                    .first()
                )
                name = r.pop("mother_details").get("name", "Mother")
                items.append(
                    {**r, "mother_name": name, "task": dict(linked) if linked else None}
                )
            return {
                "items": items,
                "total": total,
                "page": page,
                "mode": "Imported gaps are preserved; task closure records operational follow-through, not clinical completion.",
            }

    @app.post("/api/care/tasks", status_code=201)
    def create_task(body: NewTask, u=Depends(require("care.write"))):
        preview()
        with engine.begin() as c:
            m = subject(c, u, body.mother_id)
            owner(c, u, m, body.assigned_to)
            if body.child_id:
                child = one(s.child, str(body.child_id), c)
                if child["mother_id"] != m["id"]:
                    raise HTTPException(422, "The child is not linked to this mother.")
            if body.kind == "newborn" and not body.child_id:
                raise HTTPException(
                    422,
                    "Choose the existing child's separate record for newborn follow-up.",
                )
            source_id = None
            if body.gap_id:
                gap = one(s.care_gap, str(body.gap_id), c)
                if gap["mother_id"] != m["id"] and not (
                    body.child_id and gap["child_id"] == str(body.child_id)
                ):
                    raise HTTPException(
                        422, "The source gap does not belong to this mother/child."
                    )
                if gap["child_id"] and gap["child_id"] != str(body.child_id):
                    raise HTTPException(422, "Select the child linked to this gap.")
                source_id = "care-gap:" + gap["id"]
                if c.scalar(
                    select(s.worklist_item.c.id).where(
                        s.worklist_item.c.source_id == source_id
                    )
                ):
                    raise HTTPException(409, "A task already tracks this care gap.")
            identifier = str(uuid4())
            details = {
                "version": 1,
                "title": body.title,
                "kind": body.kind,
                "due_date": body.due_date.isoformat(),
                "notes": body.notes,
                "gap_id": str(body.gap_id) if body.gap_id else None,
                "child_id": str(body.child_id) if body.child_id else None,
                "barrier": "none",
                "history": [],
            }
            try:
                c.execute(
                    s.worklist_item.insert().values(
                        id=identifier,
                        source_id=source_id,
                        facility_id=u["facility_id"],
                        mother_id=m["id"],
                        assigned_to=str(body.assigned_to),
                        status="open",
                        details=details,
                    )
                )
            except IntegrityError:
                raise HTTPException(409, "A task already tracks this care gap.")
            audit(
                c,
                u,
                "task_created",
                "worklist_item",
                identifier,
                {"mother_id": m["id"], "gap_id": details["gap_id"]},
            )
            return {"id": identifier}

    @app.post("/api/care/tasks/{identifier}/actions")
    def task_action(
        identifier: str, body: TaskChange, u=Depends(require("care.write"))
    ):
        preview()
        with engine.begin() as c:
            row = one(s.worklist_item, identifier, c)
            m = subject(c, u, row["mother_id"])
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            d = dict(row["details"])
            status = row["status"]
            if status == "completed" and body.action != "reopen":
                raise HTTPException(
                    409, "Reopen the task before making further changes."
                )
            if body.action == "reopen":
                if status != "completed":
                    raise HTTPException(409, "Only completed tasks can be reopened.")
                status = "open"
            elif body.action == "acknowledge":
                if status not in {"open", "escalated"}:
                    raise HTTPException(409, "This task has already been acknowledged.")
                if row["assigned_to"] != u["id"]:
                    raise HTTPException(
                        403, "Only the assigned owner can acknowledge this task."
                    )
                status = "in_progress"
            elif body.action == "escalate":
                if status == "escalated":
                    raise HTTPException(
                        409,
                        "A clinician review is already pending for this escalation.",
                    )
                status = "escalated"
            elif body.action == "complete":
                if not body.evidence or body.outcome == "not_applicable":
                    raise HTTPException(
                        422, "Completion outcome and evidence are required."
                    )
                if body.outcome == "care_completed" and u["role"] not in {
                    "consultant",
                    "resident",
                }:
                    raise HTTPException(
                        403,
                        "Clinical completion must be confirmed by a clinician; staff may record booking or access outcomes.",
                    )
                status = (
                    "escalated"
                    if body.outcome == "needs_clinician_review"
                    else "completed"
                )
            elif body.action == "contact" and body.outcome not in {
                "reached",
                "no_answer",
            }:
                raise HTTPException(
                    422, "Choose reached or no answer for a contact attempt."
                )
            if body.action == "reassign":
                if not body.assigned_to:
                    raise HTTPException(422, "Choose a new owner.")
                owner(c, u, m, body.assigned_to)
                d["next_owner"] = str(body.assigned_to)
                status = "open"
            d["barrier"] = body.barrier
            event = {
                "action": body.action,
                "actor": u["name"],
                "actor_id": u["id"],
                "at": datetime.now(timezone.utc).isoformat(),
                "notes": body.notes,
                "outcome": body.outcome,
                "evidence": body.evidence,
                "barrier": body.barrier,
            }
            if body.action == "reassign":
                event.update(
                    {
                        "from_owner": row["assigned_to"],
                        "to_owner": str(body.assigned_to),
                    }
                )
            d["history"] = [*d.get("history", []), event]
            if status == "escalated" and (
                body.action == "escalate" or body.action == "complete"
            ):
                review_id = str(uuid4())
                c.execute(
                    s.review_case.insert().values(
                        id=review_id,
                        source_id=f"task-review:{identifier}:{body.version}",
                        facility_id=u["facility_id"],
                        mother_id=m["id"],
                        type="clinician_review",
                        status="pending_review",
                        details={
                            "version": 1,
                            "title": "Review follow-up: " + d["title"],
                            "content": body.notes,
                            "source": body.evidence or ("Care task " + identifier),
                            "author_id": u["id"],
                            "author": u["name"],
                            "task_id": identifier,
                            "history": [],
                        },
                    )
                )
                d["review_id"] = review_id
                audit(
                    c,
                    u,
                    "review_created",
                    "review_case",
                    review_id,
                    {"task_id": identifier},
                )
            if body.action == "complete" and status == "completed":
                d["completion"] = event
            if body.action == "reopen":
                d.pop("completion", None)
            result = save(
                c,
                u,
                s.worklist_item,
                row,
                body.version,
                status,
                d,
                "task_" + body.action,
            )
            if body.action == "reassign":
                c.execute(
                    update(s.worklist_item)
                    .where(s.worklist_item.c.id == identifier)
                    .values(assigned_to=str(body.assigned_to))
                )
            return result

    @app.get("/api/care/reviews")
    def reviews(page: int = Query(1, ge=1), u=Depends(require("care.read"))):
        with engine.begin() as c:
            query = (
                select(s.review_case)
                .join(s.mother, s.mother.c.id == s.review_case.c.mother_id)
                .where(s.review_case.c.facility_id == u["facility_id"], *cohort(u))
            )
            total = c.scalar(select(func.count()).select_from(query.subquery()))
            items = [
                decorated(c, dict(r), u)
                for r in c.execute(
                    query.order_by(
                        s.review_case.c.updated_at.desc(), s.review_case.c.id
                    )
                    .offset((page - 1) * 25)
                    .limit(25)
                ).mappings()
            ]
            return {"items": items, "total": total, "page": page}

    @app.post("/api/care/reviews", status_code=201)
    def create_review(body: NewReview, u=Depends(require("care.write"))):
        preview()
        with engine.begin() as c:
            subject(c, u, body.mother_id)
            if body.kind == "visit_summary" and u["role"] not in {
                "consultant",
                "resident",
            }:
                raise HTTPException(
                    403, "Visit summaries must be authored by a clinician."
                )
            identifier = str(uuid4())
            c.execute(
                s.review_case.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    mother_id=str(body.mother_id),
                    type=body.kind,
                    status="pending_review",
                    details={
                        "version": 1,
                        "title": body.title,
                        "content": body.content,
                        "source": body.source,
                        "author_id": u["id"],
                        "author": u["name"],
                        "history": [],
                    },
                )
            )
            audit(
                c, u, "review_created", "review_case", identifier, {"type": body.kind}
            )
            return {"id": identifier}

    @app.post("/api/care/reviews/{identifier}/actions")
    def review_action(
        identifier: str, body: ReviewChange, u=Depends(require("care.review"))
    ):
        preview()
        with engine.begin() as c:
            row = one(s.review_case, identifier, c)
            subject(c, u, row["mother_id"])
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            transitions = {
                "acknowledge": ({"pending_review"}, "acknowledged"),
                "approve": ({"pending_review", "acknowledged"}, "approved"),
                "request_correction": (
                    {"pending_review", "acknowledged", "approved"},
                    "needs_correction",
                ),
                "close": ({"acknowledged"}, "closed"),
            }
            allowed, status = transitions[body.action]
            if (
                row["status"] not in allowed
                or (
                    body.action in {"approve", "request_correction"}
                    and row["type"] != "visit_summary"
                )
                or (body.action == "close" and row["type"] != "clinician_review")
            ):
                raise HTTPException(
                    409, "This transition is not available for the current review."
                )
            d = dict(row["details"])
            d["history"] = [
                *d.get("history", []),
                {
                    "action": body.action,
                    "actor": u["name"],
                    "at": datetime.now(timezone.utc).isoformat(),
                    "notes": body.notes,
                },
            ]
            return save(
                c,
                u,
                s.review_case,
                row,
                body.version,
                status,
                d,
                "review_" + body.action,
            )

    @app.patch("/api/care/reviews/{identifier}")
    def revise_review(
        identifier: str, body: ReviewRevision, u=Depends(require("care.write"))
    ):
        preview()
        with engine.begin() as c:
            row = one(s.review_case, identifier, c)
            subject(c, u, row["mother_id"])
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            if row["type"] != "visit_summary" or u["role"] not in {
                "consultant",
                "resident",
            }:
                raise HTTPException(403, "Only clinicians can revise visit summaries")
            if row["status"] != "needs_correction":
                raise HTTPException(
                    409, "Corrections must be requested before a summary is revised"
                )
            d = dict(row["details"])
            d["history"] = [
                *d.get("history", []),
                {
                    "action": "revised",
                    "actor": u["name"],
                    "at": datetime.now(timezone.utc).isoformat(),
                    "notes": body.reason,
                    "previous_content": d["content"],
                    "previous_source": d["source"],
                },
            ]
            d.update(content=body.content, source=body.source)
            return save(
                c,
                u,
                s.review_case,
                row,
                body.version,
                "pending_review",
                d,
                "review_revised",
            )

    @app.get("/api/patients/{mid}/coordination")
    def timeline(mid: str, u=Depends(require("care.read"))):
        with engine.begin() as c:
            subject(c, u, mid)
            audit(c, u, "read", "mother", mid, {"view": "coordination_timeline"})
            tasks = [
                dict(r)
                for r in c.execute(
                    select(s.worklist_item)
                    .where(
                        s.worklist_item.c.mother_id == mid,
                        s.worklist_item.c.facility_id == u["facility_id"],
                    )
                    .order_by(s.worklist_item.c.created_at)
                ).mappings()
            ]
            approved = [
                dict(r)
                for r in c.execute(
                    select(s.review_case)
                    .where(
                        s.review_case.c.mother_id == mid,
                        s.review_case.c.facility_id == u["facility_id"],
                        s.review_case.c.type == "visit_summary",
                        s.review_case.c.status == "approved",
                    )
                    .order_by(s.review_case.c.created_at)
                ).mappings()
            ]
            return {
                "tasks": tasks,
                "approved_summaries": approved,
                "data_label": "Simulated on synthetic data",
            }
