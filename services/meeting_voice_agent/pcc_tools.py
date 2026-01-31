from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

LOG = logging.getLogger("meeting_voice_agent")

ToolCallback = Callable[[Mapping[str, object] | None], Awaitable[object]]

COMMUNICATION_INTENTS = {"request", "message", "suggestion", "status"}
COMMUNICATION_SCOPES = {"project", "global", "user"}
ACTION_ITEM_TYPES = {"work_order", "communication"}


class PccClientError(RuntimeError):
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class PccClient:
    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "PccClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        json: Mapping[str, object] | None = None,
    ) -> object:
        try:
            response = await self._client.request(
                method,
                path,
                params=params,
                json=json,
            )
        except httpx.TimeoutException as exc:
            raise PccClientError("PCC request timed out.") from exc
        except httpx.RequestError as exc:
            raise PccClientError(f"PCC request failed: {exc}") from exc

        if response.status_code < 200 or response.status_code >= 300:
            message = f"PCC request failed with status {response.status_code}."
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, Mapping):
                error = payload.get("error")
                if isinstance(error, str) and error.strip():
                    message = error.strip()
            raise PccClientError(message, status_code=response.status_code)

        try:
            return response.json()
        except ValueError as exc:
            raise PccClientError("PCC response was not valid JSON.") from exc

    async def get_global_context(self) -> object:
        return await self._request_json("GET", "/global/context")

    async def get_project_status(self, project_id: str) -> Mapping[str, object]:
        if not project_id or not project_id.strip():
            raise PccClientError("Project id is required.")
        payload = await self._request_json("GET", "/repos")
        if not isinstance(payload, list):
            raise PccClientError("PCC response for /repos was not a list.")
        match = _select_project_summary(payload, project_id)
        if not match:
            raise PccClientError(f"Project '{project_id}' not found.", status_code=404)
        return match

    async def get_shift_context(self, project_id: str) -> object:
        if not project_id or not project_id.strip():
            raise PccClientError("Project id is required.")
        return await self._request_json(
            "GET",
            f"/projects/{project_id}/shift-context",
        )

    async def resolve_people_by_emails(
        self,
        emails: Sequence[str],
        *,
        project_id: str | None = None,
    ) -> Mapping[str, object]:
        cleaned = [email.strip() for email in emails if isinstance(email, str)]
        cleaned = [email for email in cleaned if email]
        if not cleaned:
            return {"participants": []}
        payload: dict[str, object] = {"emails": cleaned}
        if project_id:
            payload["project_id"] = project_id
        response = await self._request_json("POST", "/people/resolve", json=payload)
        if isinstance(response, Mapping):
            return response
        return {"participants": []}

    async def send_communication(
        self,
        *,
        project_id: str,
        intent: str,
        summary: str,
        body: str | None = None,
        to_scope: str | None = None,
        to_project_id: str | None = None,
        communication_type: str | None = None,
        run_id: str | None = None,
        shift_id: str | None = None,
        payload: object | None = None,
    ) -> object:
        if not project_id or not project_id.strip():
            raise PccClientError("Project id is required.")
        if not intent or not intent.strip():
            raise PccClientError("Communication intent is required.")
        if not summary or not summary.strip():
            raise PccClientError("Communication summary is required.")
        data: dict[str, object] = {
            "intent": intent.strip(),
            "summary": summary.strip(),
        }
        if body is not None:
            data["body"] = body
        if to_scope is not None:
            data["to_scope"] = to_scope
        if to_project_id is not None:
            data["to_project_id"] = to_project_id
        if communication_type is not None:
            data["type"] = communication_type
        if run_id is not None:
            data["run_id"] = run_id
        if shift_id is not None:
            data["shift_id"] = shift_id
        if payload is not None:
            data["payload"] = payload
        return await self._request_json(
            "POST",
            f"/projects/{project_id}/communications",
            json=data,
        )

    async def create_work_order(
        self,
        *,
        project_id: str,
        data: Mapping[str, object],
    ) -> object:
        if not project_id or not project_id.strip():
            raise PccClientError("Project id is required.")
        return await self._request_json(
            "POST",
            f"/repos/{project_id}/work-orders",
            json=data,
        )

    async def patch_work_order(
        self,
        *,
        project_id: str,
        work_order_id: str,
        data: Mapping[str, object],
    ) -> object:
        if not project_id or not project_id.strip():
            raise PccClientError("Project id is required.")
        if not work_order_id or not work_order_id.strip():
            raise PccClientError("Work order id is required.")
        return await self._request_json(
            "PATCH",
            f"/repos/{project_id}/work-orders/{work_order_id}",
            json=data,
        )


BASE_SYSTEM_PROMPT = """You are the Project Control Center meeting voice agent.
You have read-only access to PCC status and context via tools. For actions, send a communication to the global session.
Use save_meeting_notes for timestamped notes, create_action_item for follow-ups, and send_meeting_summary with intent "status" when the meeting ends.
Always include the meeting id so notes and action items stay linked.
Keep replies short, confirm actions, and ask clarifying questions when needed.
"""


def summarize_global_context(context: Mapping[str, object]) -> str:
    projects_value = context.get("projects") if isinstance(context, Mapping) else None
    if not isinstance(projects_value, list):
        return "Global context is unavailable."

    total_projects = len(projects_value)
    if total_projects == 0:
        return "No projects found in the portfolio."

    health_counts = {
        "healthy": 0,
        "attention_needed": 0,
        "stalled": 0,
        "failing": 0,
        "blocked": 0,
    }
    status_counts = {"active": 0, "blocked": 0, "parked": 0}
    work_orders = {"ready": 0, "building": 0, "blocked": 0}
    escalations = 0
    active_shifts = 0

    for project in projects_value:
        if not isinstance(project, Mapping):
            continue
        health = project.get("health")
        if isinstance(health, str) and health in health_counts:
            health_counts[health] += 1
        status = project.get("status")
        if isinstance(status, str) and status in status_counts:
            status_counts[status] += 1
        work_orders_value = project.get("work_orders")
        if isinstance(work_orders_value, Mapping):
            for key in work_orders:
                value = work_orders_value.get(key)
                if isinstance(value, int):
                    work_orders[key] += value
        escalations_value = project.get("escalations")
        if isinstance(escalations_value, list):
            escalations += len(escalations_value)
        if project.get("active_shift") is not None:
            active_shifts += 1

    parts: list[str] = [
        "Portfolio:",
        f"{total_projects} projects",
        f"({health_counts['healthy']} healthy, "
        f"{health_counts['attention_needed']} attention needed, "
        f"{health_counts['stalled']} stalled, "
        f"{health_counts['failing']} failing, "
        f"{health_counts['blocked']} blocked).",
    ]

    status_line = _format_status_counts(status_counts)
    if status_line:
        parts.append(status_line)

    work_order_line = _format_work_order_counts(work_orders)
    if work_order_line:
        parts.append(work_order_line)

    if escalations or active_shifts:
        parts.append(f"Escalations {escalations}; active shifts {active_shifts}.")

    budget_line = _format_budget_line(context.get("economy"))
    if budget_line:
        parts.append(budget_line)

    session_line = _format_global_session(context.get("global_session"))
    if session_line:
        parts.append(session_line)

    summary = " ".join(parts)
    samples = _format_project_samples(projects_value)
    if samples:
        return f"{summary}\n{samples}"
    return summary


def summarize_participants(payload: Mapping[str, object]) -> str:
    participants_value = payload.get("participants")
    if not isinstance(participants_value, list):
        return ""
    lines: list[str] = []
    for entry in participants_value:
        if not isinstance(entry, Mapping):
            continue
        email = _coerce_str(entry.get("email")) or ""
        person = entry.get("person")
        if not isinstance(person, Mapping):
            if email:
                lines.append(f"- {email}: unknown")
            continue
        name = _coerce_str(person.get("name")) or "Unknown"
        role = _coerce_str(person.get("role"))
        company = _coerce_str(person.get("company"))
        relationship = _coerce_str(person.get("relationship"))
        detail_parts: list[str] = []
        if role and company:
            detail_parts.append(f"{role} at {company}")
        elif role:
            detail_parts.append(role)
        elif company:
            detail_parts.append(company)
        if relationship:
            detail_parts.append(f"relationship: {relationship}")
        detail = f" ({', '.join(detail_parts)})" if detail_parts else ""
        if email:
            lines.append(f"- {email}: {name}{detail}")
        else:
            lines.append(f"- {name}{detail}")
    if not lines:
        return ""
    return "Participants:\n" + "\n".join(lines)


async def build_system_prompt(
    pcc: PccClient,
    *,
    attendee_emails: Sequence[str] | None = None,
    project_id: str | None = None,
) -> str:
    try:
        context = await pcc.get_global_context()
        summary = summarize_global_context(context)
    except Exception as exc:
        LOG.warning("Failed to fetch global context: %s", exc)
        summary = "Global context is unavailable."
    participant_summary = ""
    if attendee_emails:
        try:
            resolved = await pcc.resolve_people_by_emails(
                attendee_emails, project_id=project_id
            )
            participant_summary = summarize_participants(resolved)
        except Exception as exc:
            LOG.warning("Failed to resolve meeting participants: %s", exc)
            participant_summary = ""
    sections = [BASE_SYSTEM_PROMPT, "Portfolio summary:", summary]
    if participant_summary:
        sections.append(participant_summary)
    return "\n".join(sections) + "\n"


PCC_TOOL_DEFINITIONS = [
    {
        "name": "get_global_context",
        "description": "Fetch the global portfolio context from PCC.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_project_status",
        "description": "Fetch a single project's status summary by project id or name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "Project id or name to look up.",
                },
                "project": {
                    "type": "string",
                    "description": "Project id or name to look up.",
                },
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "get_shift_context",
        "description": "Fetch the shift context for a project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id."}
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "send_communication",
        "description": "Send a communication to the PCC communication queue.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id."},
                "intent": {
                    "type": "string",
                    "enum": ["escalation", "request", "message", "suggestion", "status"],
                    "default": "request",
                },
                "summary": {"type": "string", "description": "Short summary line."},
                "body": {"type": "string", "description": "Optional detail body."},
                "to_scope": {
                    "type": "string",
                    "enum": ["project", "global", "user"],
                },
                "to_project_id": {
                    "type": "string",
                    "description": "Required when to_scope=project.",
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "need_input",
                        "blocked",
                        "decision_required",
                        "error",
                        "budget_warning",
                        "budget_critical",
                        "budget_exhausted",
                        "run_blocked",
                    ],
                },
                "run_id": {"type": "string"},
                "shift_id": {"type": "string"},
                "payload": {"type": "object", "additionalProperties": True},
            },
            "required": ["project_id", "summary"],
        },
    },
    {
        "name": "save_meeting_notes",
        "description": "Save a timestamped meeting note to PCC communications.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id."},
                "meeting_id": {"type": "string", "description": "Meeting id."},
                "attendee_emails": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional attendee emails.",
                },
                "note": {"type": "string", "description": "Note to store."},
                "summary": {
                    "type": "string",
                    "description": "Optional short summary for the note.",
                },
                "meeting_title": {"type": "string", "description": "Meeting title."},
                "meeting_started_at": {
                    "type": "string",
                    "description": "ISO timestamp when the meeting started.",
                },
                "timestamp": {
                    "type": "string",
                    "description": "ISO timestamp for the note; defaults to now.",
                },
                "to_scope": {
                    "type": "string",
                    "enum": ["project", "global", "user"],
                },
                "to_project_id": {
                    "type": "string",
                    "description": "Required when to_scope=project.",
                },
            },
            "required": ["project_id", "meeting_id", "note"],
        },
    },
    {
        "name": "create_action_item",
        "description": "Create a meeting action item as a Work Order or communication.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id."},
                "meeting_id": {"type": "string", "description": "Meeting id."},
                "attendee_emails": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional attendee emails.",
                },
                "title": {"type": "string", "description": "Action item title."},
                "description": {
                    "type": "string",
                    "description": "Optional details for the action item.",
                },
                "action_type": {
                    "type": "string",
                    "enum": ["work_order", "communication"],
                    "default": "work_order",
                },
                "priority": {
                    "type": "number",
                    "description": "Optional work order priority (1-5).",
                },
                "tags": {"type": "array", "items": {"type": "string"}},
                "meeting_title": {"type": "string", "description": "Meeting title."},
                "meeting_started_at": {
                    "type": "string",
                    "description": "ISO timestamp when the meeting started.",
                },
                "intent": {
                    "type": "string",
                    "enum": ["request", "message", "suggestion", "status"],
                    "description": "Intent for communication action items.",
                },
                "to_scope": {
                    "type": "string",
                    "enum": ["project", "global", "user"],
                },
                "to_project_id": {
                    "type": "string",
                    "description": "Required when to_scope=project.",
                },
            },
            "required": ["project_id", "meeting_id", "title"],
        },
    },
    {
        "name": "send_meeting_summary",
        "description": "Send the post-meeting summary as a status communication.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id."},
                "meeting_id": {"type": "string", "description": "Meeting id."},
                "attendee_emails": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional attendee emails.",
                },
                "summary": {"type": "string", "description": "Meeting summary text."},
                "meeting_title": {"type": "string", "description": "Meeting title."},
                "meeting_started_at": {
                    "type": "string",
                    "description": "ISO timestamp when the meeting started.",
                },
                "meeting_ended_at": {
                    "type": "string",
                    "description": "ISO timestamp when the meeting ended.",
                },
                "decisions": {"type": "array", "items": {"type": "string"}},
                "action_items": {"type": "array", "items": {"type": "string"}},
                "next_steps": {"type": "array", "items": {"type": "string"}},
                "to_scope": {
                    "type": "string",
                    "enum": ["project", "global", "user"],
                },
                "to_project_id": {
                    "type": "string",
                    "description": "Required when to_scope=project.",
                },
            },
            "required": ["project_id", "meeting_id", "summary"],
        },
    },
]


def create_tool_callbacks(
    client: PccClient,
    *,
    default_attendees: Sequence[str] | None = None,
) -> dict[str, ToolCallback]:
    default_attendee_list = [
        email.strip()
        for email in (default_attendees or [])
        if isinstance(email, str) and email.strip()
    ]

    def resolve_attendees(params: Mapping[str, object] | None) -> list[str]:
        if params:
            for key in (
                "attendee_emails",
                "attendees",
                "participant_emails",
                "participants",
                "emails",
            ):
                value = _get_param(params, key)
                attendees = _coerce_str_list(value)
                if attendees:
                    return attendees
        return default_attendee_list
    async def get_global_context_tool(_: Mapping[str, object] | None = None) -> object:
        try:
            return await client.get_global_context()
        except PccClientError as exc:
            return {"error": str(exc)}

    async def get_project_status_tool(params: Mapping[str, object] | None) -> object:
        project_id = _coerce_str(_get_param(params, "project_id", "project"))
        if not project_id:
            return {"error": "project_id or project is required."}
        try:
            return await client.get_project_status(project_id)
        except PccClientError as exc:
            return {"error": str(exc)}

    async def get_shift_context_tool(params: Mapping[str, object] | None) -> object:
        project_id = _coerce_str(_get_param(params, "project_id", "project"))
        if not project_id:
            return {"error": "project_id is required."}
        try:
            return await client.get_shift_context(project_id)
        except PccClientError as exc:
            return {"error": str(exc)}

    async def send_communication_tool(params: Mapping[str, object] | None) -> object:
        if not params:
            return {"error": "Communication details are required."}
        project_id = _coerce_str(params.get("project_id"))
        intent = _coerce_str(params.get("intent")) or "request"
        summary = _coerce_str(params.get("summary"))
        if not project_id or not summary:
            return {"error": "project_id and summary are required."}
        try:
            return await client.send_communication(
                project_id=project_id,
                intent=intent,
                summary=summary,
                body=_coerce_str(params.get("body")),
                to_scope=_coerce_str(params.get("to_scope")),
                to_project_id=_coerce_str(params.get("to_project_id")),
                communication_type=_coerce_str(params.get("type")),
                run_id=_coerce_str(params.get("run_id")),
                shift_id=_coerce_str(params.get("shift_id")),
                payload=params.get("payload"),
            )
        except PccClientError as exc:
            return {"error": str(exc)}

    async def save_meeting_notes_tool(params: Mapping[str, object] | None) -> object:
        if not params:
            return {"error": "Meeting note details are required."}
        project_id = _coerce_str(_get_param(params, "project_id", "project"))
        meeting_id = _coerce_str(_get_param(params, "meeting_id", "meeting"))
        note = _coerce_str(_get_param(params, "note", "text"))
        if not project_id or not meeting_id or not note:
            return {"error": "project_id, meeting_id, and note are required."}

        meeting_title = _coerce_str(
            _get_param(params, "meeting_title", "meeting_name", "title")
        )
        meeting_started_at = _coerce_str(
            _get_param(params, "meeting_started_at", "meeting_start")
        )
        timestamp = _coerce_str(_get_param(params, "timestamp", "note_timestamp"))
        recorded_at = timestamp or _iso_now()

        summary = _coerce_str(_get_param(params, "summary"))
        if not summary:
            snippet = _truncate_text(note.replace("\n", " ").strip(), 96)
            if meeting_title:
                summary = f"Meeting note: {meeting_title} - {snippet}"
            else:
                summary = f"Meeting note ({meeting_id}): {snippet}"

        body_lines = [f"Meeting ID: {meeting_id}"]
        if meeting_title:
            body_lines.append(f"Meeting title: {meeting_title}")
        if meeting_started_at:
            body_lines.append(f"Meeting started: {meeting_started_at}")
        body_lines.append(f"Note timestamp: {recorded_at}")
        body_lines.append("")
        body_lines.append(note)
        body = "\n".join(body_lines)

        payload = _build_meeting_payload(
            meeting_id=meeting_id,
            meeting_title=meeting_title,
            meeting_started_at=meeting_started_at,
            meeting_ended_at=None,
            attendee_emails=resolve_attendees(params),
            recorded_at=recorded_at,
            kind="note",
        )
        payload["note"] = note
        payload["note_timestamp"] = recorded_at

        try:
            to_scope, to_project_id = _resolve_to_scope(
                params, default_scope="project", project_id=project_id
            )
        except ValueError as exc:
            return {"error": str(exc)}

        try:
            return await client.send_communication(
                project_id=project_id,
                intent="message",
                summary=summary,
                body=body,
                to_scope=to_scope,
                to_project_id=to_project_id,
                payload=payload,
            )
        except PccClientError as exc:
            return {"error": str(exc)}

    async def create_action_item_tool(params: Mapping[str, object] | None) -> object:
        if not params:
            return {"error": "Action item details are required."}
        project_id = _coerce_str(_get_param(params, "project_id", "project"))
        meeting_id = _coerce_str(_get_param(params, "meeting_id", "meeting"))
        title = _coerce_str(_get_param(params, "title", "summary"))
        if not project_id or not meeting_id or not title:
            return {"error": "project_id, meeting_id, and title are required."}

        action_type = _coerce_str(_get_param(params, "action_type", "type", "mode"))
        action_type = action_type or "work_order"
        if action_type not in ACTION_ITEM_TYPES:
            return {"error": "action_type must be work_order or communication."}

        meeting_title = _coerce_str(_get_param(params, "meeting_title", "meeting_name"))
        meeting_started_at = _coerce_str(
            _get_param(params, "meeting_started_at", "meeting_start")
        )
        description = _coerce_str(_get_param(params, "description", "details", "body"))
        recorded_at = _iso_now()

        payload = _build_meeting_payload(
            meeting_id=meeting_id,
            meeting_title=meeting_title,
            meeting_started_at=meeting_started_at,
            meeting_ended_at=None,
            attendee_emails=resolve_attendees(params),
            recorded_at=recorded_at,
            kind="action_item",
        )
        payload["action_title"] = title
        if description:
            payload["action_description"] = description

        if action_type == "communication":
            intent = _coerce_str(_get_param(params, "intent")) or "request"
            if intent not in COMMUNICATION_INTENTS:
                return {
                    "error": "intent must be request, message, suggestion, or status."
                }
            summary = _coerce_str(_get_param(params, "summary"))
            if not summary:
                summary = f"Action item ({meeting_id}): {title}"
            body_lines = [f"Meeting ID: {meeting_id}"]
            if meeting_title:
                body_lines.append(f"Meeting title: {meeting_title}")
            if meeting_started_at:
                body_lines.append(f"Meeting started: {meeting_started_at}")
            body_lines.append(f"Action item: {title}")
            if description:
                body_lines.append(f"Details: {description}")
            body = "\n".join(body_lines)

            try:
                to_scope, to_project_id = _resolve_to_scope(
                    params, default_scope="global", project_id=project_id
                )
            except ValueError as exc:
                return {"error": str(exc)}

            try:
                communication = await client.send_communication(
                    project_id=project_id,
                    intent=intent,
                    summary=summary,
                    body=body,
                    to_scope=to_scope,
                    to_project_id=to_project_id,
                    payload=payload,
                )
                return {"action_type": "communication", "communication": communication}
            except PccClientError as exc:
                return {"error": str(exc)}

        priority = _coerce_int(_get_param(params, "priority"))
        tags = _coerce_str_list(_get_param(params, "tags"))
        if "meeting-action-item" not in tags:
            tags.append("meeting-action-item")

        create_payload: dict[str, object] = {"title": title, "tags": tags}
        if priority is not None:
            create_payload["priority"] = priority

        try:
            created = await client.create_work_order(
                project_id=project_id,
                data=create_payload,
            )
        except PccClientError as exc:
            return {"error": str(exc)}
        if not isinstance(created, Mapping):
            return {"error": "PCC response missing work order details."}
        work_order_id = _coerce_str(created.get("id"))
        if not work_order_id:
            return {"error": "PCC response missing work order id."}

        context_lines = [f"Origin: Meeting {meeting_id}"]
        if meeting_title:
            context_lines.append(f"Meeting title: {meeting_title}")
        if meeting_started_at:
            context_lines.append(f"Meeting started: {meeting_started_at}")
        if description:
            context_lines.append(f"Action detail: {description}")

        patch_payload: dict[str, object] = {"context": context_lines}
        if description:
            patch_payload["goal"] = description

        try:
            updated = await client.patch_work_order(
                project_id=project_id,
                work_order_id=work_order_id,
                data=patch_payload,
            )
            return {"action_type": "work_order", "work_order": updated}
        except PccClientError as exc:
            return {"error": str(exc)}

    async def send_meeting_summary_tool(params: Mapping[str, object] | None) -> object:
        if not params:
            return {"error": "Meeting summary details are required."}
        project_id = _coerce_str(_get_param(params, "project_id", "project"))
        meeting_id = _coerce_str(_get_param(params, "meeting_id", "meeting"))
        summary_text = _coerce_str(_get_param(params, "summary", "meeting_summary"))
        if not project_id or not meeting_id or not summary_text:
            return {"error": "project_id, meeting_id, and summary are required."}

        meeting_title = _coerce_str(
            _get_param(params, "meeting_title", "meeting_name", "title")
        )
        meeting_started_at = _coerce_str(
            _get_param(params, "meeting_started_at", "meeting_start")
        )
        meeting_ended_at = _coerce_str(
            _get_param(params, "meeting_ended_at", "meeting_end")
        )
        recorded_at = _iso_now()

        decisions = _coerce_str_list(_get_param(params, "decisions"))
        action_items = _coerce_str_list(_get_param(params, "action_items"))
        next_steps = _coerce_str_list(_get_param(params, "next_steps"))

        communication_summary = _coerce_str(_get_param(params, "summary_title"))
        if not communication_summary:
            if meeting_title:
                communication_summary = f"Meeting summary: {meeting_title}"
            else:
                communication_summary = f"Meeting summary ({meeting_id})"

        body_lines = [f"Meeting ID: {meeting_id}"]
        if meeting_title:
            body_lines.append(f"Meeting title: {meeting_title}")
        if meeting_started_at:
            body_lines.append(f"Meeting started: {meeting_started_at}")
        if meeting_ended_at:
            body_lines.append(f"Meeting ended: {meeting_ended_at}")
        body_lines.append("")
        body_lines.append("Summary:")
        body_lines.append(summary_text)

        if decisions:
            body_lines.append("")
            body_lines.append("Decisions:")
            body_lines.extend([f"- {item}" for item in decisions])
        if action_items:
            body_lines.append("")
            body_lines.append("Action items:")
            body_lines.extend([f"- {item}" for item in action_items])
        if next_steps:
            body_lines.append("")
            body_lines.append("Next steps:")
            body_lines.extend([f"- {item}" for item in next_steps])
        body = "\n".join(body_lines)

        payload = _build_meeting_payload(
            meeting_id=meeting_id,
            meeting_title=meeting_title,
            meeting_started_at=meeting_started_at,
            meeting_ended_at=meeting_ended_at,
            attendee_emails=resolve_attendees(params),
            recorded_at=recorded_at,
            kind="summary",
        )
        payload["summary"] = summary_text
        if decisions:
            payload["decisions"] = decisions
        if action_items:
            payload["action_items"] = action_items
        if next_steps:
            payload["next_steps"] = next_steps

        try:
            to_scope, to_project_id = _resolve_to_scope(
                params, default_scope="global", project_id=project_id
            )
        except ValueError as exc:
            return {"error": str(exc)}

        try:
            return await client.send_communication(
                project_id=project_id,
                intent="status",
                summary=communication_summary,
                body=body,
                to_scope=to_scope,
                to_project_id=to_project_id,
                payload=payload,
            )
        except PccClientError as exc:
            return {"error": str(exc)}

    return {
        "get_global_context": get_global_context_tool,
        "get_project_status": get_project_status_tool,
        "get_shift_context": get_shift_context_tool,
        "send_communication": send_communication_tool,
        "save_meeting_notes": save_meeting_notes_tool,
        "create_action_item": create_action_item_tool,
        "send_meeting_summary": send_meeting_summary_tool,
    }


def build_tool_definitions() -> list[dict[str, Any]]:
    return PCC_TOOL_DEFINITIONS


def build_tool_callbacks(
    client: PccClient,
    *,
    default_attendees: Sequence[str] | None = None,
) -> dict[str, Callable[..., Awaitable[object]]]:
    callbacks = create_tool_callbacks(client, default_attendees=default_attendees)

    def wrap(callback: ToolCallback) -> Callable[..., Awaitable[object]]:
        async def _wrapped(
            params: Mapping[str, object] | None = None, **kwargs: object
        ) -> object:
            merged = _merge_tool_params(params, kwargs)
            return await callback(merged)

        return _wrapped

    return {name: wrap(callback) for name, callback in callbacks.items()}


def _select_project_summary(
    projects: Sequence[object], query: str
) -> Mapping[str, object] | None:
    normalized = _normalize(query)
    if not normalized:
        return None

    def iter_matches() -> Sequence[Mapping[str, object]]:
        matches: list[Mapping[str, object]] = []
        for project in projects:
            if not isinstance(project, Mapping):
                continue
            project_id = _normalize(_coerce_str(project.get("id")) or "")
            name = _normalize(_coerce_str(project.get("name")) or "")
            if project_id == normalized or name == normalized:
                matches.append(project)
        return matches

    exact_matches = iter_matches()
    if exact_matches:
        return exact_matches[0]

    for project in projects:
        if not isinstance(project, Mapping):
            continue
        project_id = _normalize(_coerce_str(project.get("id")) or "")
        name = _normalize(_coerce_str(project.get("name")) or "")
        if normalized in project_id or normalized in name:
            return project
    return None


def _format_status_counts(status_counts: Mapping[str, int]) -> str:
    total = sum(status_counts.values())
    if total == 0:
        return ""
    return (
        "Status:"
        f" {status_counts.get('active', 0)} active,"
        f" {status_counts.get('blocked', 0)} blocked,"
        f" {status_counts.get('parked', 0)} parked."
    )


def _format_work_order_counts(work_orders: Mapping[str, int]) -> str:
    total = sum(work_orders.values())
    if total == 0:
        return ""
    return (
        "Work orders:"
        f" {work_orders.get('ready', 0)} ready,"
        f" {work_orders.get('building', 0)} building,"
        f" {work_orders.get('blocked', 0)} blocked."
    )


def _format_budget_line(economy_value: object) -> str:
    if not isinstance(economy_value, Mapping):
        return ""
    remaining = economy_value.get("total_remaining_usd")
    runway = economy_value.get("portfolio_runway_days")
    remaining_text = _format_usd(remaining)
    runway_text = _format_number(runway)
    if remaining_text and runway_text:
        return f"Budget remaining {remaining_text}; runway {runway_text} days."
    if remaining_text:
        return f"Budget remaining {remaining_text}."
    if runway_text:
        return f"Runway {runway_text} days."
    return ""


def _format_global_session(session_value: object) -> str:
    if not isinstance(session_value, Mapping):
        return ""
    state = _coerce_str(session_value.get("state"))
    if not state:
        return ""
    paused_at = _coerce_str(session_value.get("paused_at"))
    suffix = " (paused)" if paused_at else ""
    return f"Global session {state}{suffix}."


def _format_project_samples(projects: Sequence[object], limit: int = 5) -> str:
    lines: list[str] = []
    for project in projects[:limit]:
        if not isinstance(project, Mapping):
            continue
        work_orders_value = project.get("work_orders")
        work_orders = (
            work_orders_value
            if isinstance(work_orders_value, Mapping)
            else {}
        )
        ready = work_orders.get("ready", 0)
        blocked = work_orders.get("blocked", 0)
        health = project.get("health", "unknown")
        status = project.get("status", "unknown")
        name = project.get("name", "unknown")
        project_id = project.get("id", "unknown")
        lines.append(
            f"- {name} ({project_id}): status {status}, "
            f"health {health}, ready {ready}, blocked {blocked}."
        )
    if not lines:
        return ""
    return "Sample projects:\n" + "\n".join(lines)


def _format_usd(value: object) -> str:
    if isinstance(value, (int, float)):
        if abs(value) >= 100:
            return f"${value:,.0f}"
        return f"${value:,.2f}"
    return ""


def _format_number(value: object) -> str:
    if isinstance(value, (int, float)):
        if abs(value) >= 100:
            return f"{value:,.0f}"
        return f"{value:,.1f}"
    return ""


def _normalize(value: str) -> str:
    return value.strip().lower()


def _iso_now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    clipped = text[: max(0, limit - 3)].rstrip()
    return f"{clipped}..."


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _coerce_str(value: object) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed if trimmed else None
    return None


def _coerce_str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [
            item.strip()
            for item in value
            if isinstance(item, str) and item.strip()
        ]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _build_meeting_payload(
    *,
    meeting_id: str,
    meeting_title: str | None,
    meeting_started_at: str | None,
    meeting_ended_at: str | None,
    attendee_emails: list[str] | None,
    recorded_at: str,
    kind: str,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "meeting_id": meeting_id,
        "recorded_at": recorded_at,
        "kind": kind,
    }
    if meeting_title:
        payload["meeting_title"] = meeting_title
    if meeting_started_at:
        payload["meeting_started_at"] = meeting_started_at
    if meeting_ended_at:
        payload["meeting_ended_at"] = meeting_ended_at
    if attendee_emails:
        payload["attendee_emails"] = attendee_emails
    return payload


def _resolve_to_scope(
    params: Mapping[str, object] | None,
    *,
    default_scope: str,
    project_id: str,
) -> tuple[str, str | None]:
    to_scope = _coerce_str(_get_param(params, "to_scope")) or default_scope
    if to_scope not in COMMUNICATION_SCOPES:
        raise ValueError("to_scope must be project, global, or user.")
    to_project_id = _coerce_str(_get_param(params, "to_project_id"))
    if to_scope == "project" and not to_project_id:
        to_project_id = project_id
    return to_scope, to_project_id


def _get_param(params: Mapping[str, object] | None, *keys: str) -> object | None:
    if not params:
        return None
    for key in keys:
        if key in params:
            return params.get(key)
    return None


def _merge_tool_params(
    params: Mapping[str, object] | None, kwargs: Mapping[str, object]
) -> Mapping[str, object] | None:
    if params is None:
        return dict(kwargs) if kwargs else None
    if not kwargs:
        return params
    merged = dict(params)
    merged.update(kwargs)
    return merged
