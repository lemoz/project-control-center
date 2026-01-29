import logging
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

LOG = logging.getLogger("meeting_voice_agent")


class PccClient:
    def __init__(self, base_url: str, timeout_s: float = 8.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_s)

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(
        self, method: str, path: str, payload: Optional[Dict[str, Any]] = None
    ) -> Any:
        url = f"{self.base_url}{path}"
        try:
            response = await self._client.request(method, url, json=payload)
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise RuntimeError(f"PCC request timed out: {method} {path}") from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code if exc.response else "unknown"
            raise RuntimeError(
                f"PCC request failed ({status}): {method} {path}"
            ) from exc
        except httpx.RequestError as exc:
            raise RuntimeError(f"PCC request failed: {method} {path}") from exc
        if response.content:
            return response.json()
        return None

    async def get_global_context(self) -> Dict[str, Any]:
        return await self._request("GET", "/global/context")

    async def get_project_status(self, project: str) -> Dict[str, Any]:
        repos = await self._request("GET", "/repos")
        if not isinstance(repos, list):
            raise RuntimeError("Unexpected /repos response")
        normalized = project.strip().lower()
        for repo in repos:
            if not isinstance(repo, dict):
                continue
            repo_id = str(repo.get("id", "")).lower()
            name = str(repo.get("name", "")).lower()
            if normalized in (repo_id, name):
                return repo
        raise RuntimeError(f"Project not found: {project}")

    async def get_shift_context(self, project_id: str) -> Dict[str, Any]:
        return await self._request(
            "GET", f"/projects/{project_id.strip()}/shift-context"
        )

    async def send_communication(
        self,
        project_id: str,
        summary: str,
        intent: str = "request",
        body: Optional[str] = None,
        to_scope: str = "global",
        to_project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "intent": intent,
            "summary": summary,
            "to_scope": to_scope,
        }
        if body:
            payload["body"] = body
        if to_project_id:
            payload["to_project_id"] = to_project_id
        return await self._request(
            "POST", f"/projects/{project_id.strip()}/communications", payload
        )


def summarize_global_context(context: Dict[str, Any]) -> str:
    projects = context.get("projects") if isinstance(context, dict) else None
    if not isinstance(projects, list):
        return "Global context unavailable."
    attention = [
        project
        for project in projects
        if isinstance(project, dict) and project.get("health") != "healthy"
    ]
    lines = [
        f"Projects: {len(projects)} total.",
        f"Attention needed: {len(attention)}.",
    ]
    for project in projects[:5]:
        if not isinstance(project, dict):
            continue
        work_orders = (
            project.get("work_orders")
            if isinstance(project.get("work_orders"), dict)
            else {}
        )
        ready = work_orders.get("ready", 0)
        blocked = work_orders.get("blocked", 0)
        health = project.get("health", "unknown")
        status = project.get("status", "unknown")
        lines.append(
            f"- {project.get('name', 'unknown')} ({project.get('id', 'unknown')}): "
            f"status {status}, health {health}, ready {ready}, blocked {blocked}."
        )
    return "\n".join(lines)


BASE_SYSTEM_PROMPT = """You are the Project Control Center meeting voice agent.
You have read-only access to PCC status and context via tools. For actions, send a communication to the global session.
Keep replies short, confirm actions, and ask clarifying questions when needed.
"""


async def build_system_prompt(pcc: PccClient) -> str:
    try:
        context = await pcc.get_global_context()
        summary = summarize_global_context(context)
    except Exception as exc:
        LOG.warning("Failed to fetch global context: %s", exc)
        summary = "Global context unavailable."
    return f"{BASE_SYSTEM_PROMPT}\nPortfolio summary:\n{summary}\n"


def build_tool_definitions() -> list[Dict[str, Any]]:
    return [
        {
            "name": "get_global_context",
            "description": "Fetch the latest PCC portfolio context (projects, escalations, budget).",
            "input_schema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "get_project_status",
            "description": "Get summary status for a single project by id or name.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Project id or name.",
                    }
                },
                "required": ["project"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_shift_context",
            "description": "Get detailed shift context for a project.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Project id.",
                    }
                },
                "required": ["project_id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "send_communication",
            "description": "Send a request or message to the global PCC session for a project.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Project id to route the communication from.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "Short summary of the request or message.",
                    },
                    "intent": {
                        "type": "string",
                        "description": "Communication intent (request, message, suggestion, status).",
                        "default": "request",
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional longer body text.",
                    },
                },
                "required": ["project_id", "summary"],
                "additionalProperties": False,
            },
        },
    ]


def build_tool_callbacks(
    pcc: PccClient,
) -> Dict[str, Callable[..., Awaitable[Any]]]:
    async def get_global_context() -> Any:
        return await pcc.get_global_context()

    async def get_project_status(project: str) -> Any:
        return await pcc.get_project_status(project)

    async def get_shift_context(project_id: str) -> Any:
        return await pcc.get_shift_context(project_id)

    async def send_communication(
        project_id: str,
        summary: str,
        intent: str = "request",
        body: Optional[str] = None,
    ) -> Any:
        return await pcc.send_communication(
            project_id=project_id,
            summary=summary,
            intent=intent,
            body=body,
            to_scope="global",
        )

    return {
        "get_global_context": get_global_context,
        "get_project_status": get_project_status,
        "get_shift_context": get_shift_context,
        "send_communication": send_communication,
    }
