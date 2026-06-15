"""OPCBrain delegation tool for the talker voice assistant.

talker's own LLM stays the conversational brain (fast, low-latency). When the
user actually wants *work* done (read/write files, run commands, search the
codebase, modify the project, use OPCBrain's tools), the LLM calls the
``delegate_to_opcbrain`` tool defined here. The tool drives one OPCBrain chat
turn over OPCBrain's UI-server WebSocket and returns a concise result summary,
which talker's LLM then narrates back to the user via TTS.

Session binding (which OPCBrain project + which voice session a delegation
belongs to) is resolved from a ContextVar that ``voice_server.py`` sets per
WebSocket connection from the talker JWT claims minted by the OPCBrain
ui-server. A single-active-session fallback keeps things working on a typical
single-user local deployment.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
from typing import Any, Callable, Optional

from langchain_core.tools import BaseTool
from langchain.tools import tool

logger = logging.getLogger("opcbrain_tool")

# Per-connection binding: {"projectPath": str, "voiceSessionId": str}.
# Set in voice_server.py's /ws route before Talker.connect() runs.
current_binding: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "opcbrain_voice_binding", default=None
)

# Single-active-session fallback for contexts where the ContextVar does not
# propagate (e.g. event-bus tasks). Safe for single-user local deployments.
_last_binding: Optional[dict] = None


def set_active_binding(binding: dict) -> None:
    global _last_binding
    _last_binding = binding


def clear_active_binding(binding: dict) -> None:
    global _last_binding
    if _last_binding is binding:
        _last_binding = None


def _resolve_binding() -> dict:
    binding = current_binding.get(None)
    if binding and binding.get("projectPath"):
        return binding
    if _last_binding and _last_binding.get("projectPath"):
        return _last_binding
    return {}


def get_active_binding() -> dict:
    """Return the current connection binding regardless of project.

    Unlike :func:`_resolve_binding` (which gates on a non-empty projectPath for
    the delegation tool), this returns the binding even in 🌐 global mode so the
    conversation-recording hook can still read ``voiceSessionId``.
    """
    return current_binding.get(None) or _last_binding or {}


# Default OPCBrain ui-server WebSocket (same docker-compose network).
DEFAULT_GATEWAY = os.environ.get(
    "OPCBRAIN_VOICE_GATEWAY", "ws://opcbrain:3001/ws"
)


def _derive_http_base(gateway_ws: str) -> str:
    """Derive the ui-server HTTP base from the gateway WS URL.

    ``ws://opcbrain:3001/ws`` → ``http://opcbrain:3001``. Overridable via
    ``OPCBRAIN_VOICE_HTTP``.
    """
    explicit = os.environ.get("OPCBRAIN_VOICE_HTTP")
    if explicit:
        return explicit.rstrip("/")
    base = gateway_ws
    if base.startswith("wss://"):
        base = "https://" + base[len("wss://"):]
    elif base.startswith("ws://"):
        base = "http://" + base[len("ws://"):]
    # Strip a trailing "/ws" path if present.
    if base.endswith("/ws"):
        base = base[: -len("/ws")]
    return base.rstrip("/")


HTTP_BASE = _derive_http_base(DEFAULT_GATEWAY)
# Max seconds to wait for one OPCBrain turn to complete.
DELEGATE_TIMEOUT_S = float(os.environ.get("OPCBRAIN_VOICE_TIMEOUT", "180"))
# Cap summary length so TTS narration stays reasonable.
MAX_SUMMARY_CHARS = int(os.environ.get("OPCBRAIN_VOICE_MAX_SUMMARY", "1200"))
# Seconds to wait for the ui-server project-list HTTP call.
PROJECT_LIST_TIMEOUT_S = float(os.environ.get("OPCBRAIN_VOICE_PROJECT_LIST_TIMEOUT", "8"))


async def fetch_project_list() -> list[dict]:
    """Fetch ``[{name, displayName, fullPath}]`` from the ui-server.

    Returns an empty list on any failure (caller degrades gracefully).
    """
    import httpx

    url = f"{HTTP_BASE}/api/voice/project-list"
    try:
        async with httpx.AsyncClient(timeout=PROJECT_LIST_TIMEOUT_S) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        projects = data.get("projects") if isinstance(data, dict) else None
        return [p for p in (projects or []) if p.get("name") and p.get("fullPath")]
    except Exception as exc:  # noqa: BLE001 - degrade gracefully
        logger.warning("Failed to fetch project list from %s: %s", url, exc)
        return []


def _norm(s: str) -> str:
    return (s or "").strip().lower()


async def resolve_project_name(name: str) -> dict:
    """Resolve a spoken project name to a concrete workspace.

    Match priority: exact name → exact displayName → unique substring (in name
    or displayName). Returns one of::

        {"status": "ok", "path": str, "name": str, "displayName": str}
        {"status": "ambiguous", "candidates": [displayName, ...]}
        {"status": "notfound", "candidates": [displayName, ...]}   # all names
    """
    target = _norm(name)
    if not target:
        return {"status": "notfound", "candidates": []}

    projects = await fetch_project_list()
    if not projects:
        return {"status": "notfound", "candidates": []}

    def pack(p: dict) -> dict:
        return {
            "status": "ok",
            "path": p.get("fullPath"),
            "name": p.get("name"),
            "displayName": p.get("displayName") or p.get("name"),
        }

    # Exact name / displayName (case-insensitive).
    for p in projects:
        if _norm(p.get("name")) == target or _norm(p.get("displayName")) == target:
            return pack(p)

    # Substring match on name or displayName.
    subs = [
        p for p in projects
        if target in _norm(p.get("name")) or target in _norm(p.get("displayName"))
    ]
    if len(subs) == 1:
        return pack(subs[0])

    all_names = [p.get("displayName") or p.get("name") for p in projects]
    if len(subs) > 1:
        return {
            "status": "ambiguous",
            "candidates": [p.get("displayName") or p.get("name") for p in subs],
        }
    return {"status": "notfound", "candidates": all_names}


async def _run_opcbrain_turn(
    gateway_url: str,
    task: str,
    project_path: str,
    voice_session_id: Optional[str] = None,
) -> str:
    """Drive one OPCBrain chat turn over the ui-server WS and summarize it."""
    import asyncio

    import websockets

    if not project_path:
        return (
            "无法执行：当前没有绑定的项目。请先在界面上选择一个项目，"
            "或者直接说出要操作哪个项目。"
        )

    command = {
        "type": "pilotdeck-command",
        "command": task,
        "options": {
            "projectPath": project_path,
            "providerHint": "pilotdeck",
            # Voice turns auto-approve tools so the conversation is not blocked
            # on permission prompts (per integration decision).
            "permissionMode": "bypassPermissions",
        },
    }
    if voice_session_id:
        command["options"]["sessionId"] = voice_session_id

    assistant_text: list[str] = []
    tools_used: list[str] = []
    error_text: Optional[str] = None

    try:
        async with websockets.connect(gateway_url, max_size=None) as ws:
            await ws.send(json.dumps(command))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=DELEGATE_TIMEOUT_S)
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                kind = msg.get("kind") or msg.get("type")
                if kind == "stream_delta":
                    chunk = msg.get("content") or msg.get("text") or ""
                    if isinstance(chunk, str):
                        assistant_text.append(chunk)
                elif kind == "tool_use":
                    name = msg.get("toolName") or msg.get("name")
                    if name:
                        tools_used.append(str(name))
                elif kind == "error":
                    error_text = str(msg.get("error") or msg.get("message") or "未知错误")
                    break
                elif kind == "complete":
                    break
    except asyncio.TimeoutError:
        logger.warning("OPCBrain delegation timed out after %ss", DELEGATE_TIMEOUT_S)
        if not assistant_text:
            return "OPCBrain 处理超时了，任务可能还在后台进行，请稍后查看。"
    except Exception as exc:  # noqa: BLE001 - surface a spoken-friendly message
        logger.exception("OPCBrain delegation failed")
        return f"连接 OPCBrain 失败：{exc}"

    if error_text:
        return f"OPCBrain 执行出错：{error_text}"

    text = "".join(assistant_text).strip()
    if not text:
        if tools_used:
            uniq = ", ".join(dict.fromkeys(tools_used))
            return f"OPCBrain 已经执行完成（用到的工具：{uniq}），但没有返回文字说明。"
        return "OPCBrain 已经处理完成。"

    if len(text) > MAX_SUMMARY_CHARS:
        text = text[:MAX_SUMMARY_CHARS] + "…（内容较长，已截断）"
    return text


def build_opcbrain_tool(
    gateway_url: str = DEFAULT_GATEWAY,
    get_binding: Callable[[], dict] = _resolve_binding,
) -> BaseTool:
    """Build the ``delegate_to_opcbrain`` LangChain tool.

    Parameters
    ----------
    gateway_url : str
        OPCBrain ui-server WebSocket URL (defaults to the compose service).
    get_binding : Callable[[], dict]
        Resolver returning ``{"projectPath", "voiceSessionId"}`` for the current
        voice session.
    """

    args_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "task": {
                "type": "string",
                "description": (
                    "要交给 OPCBrain 执行的具体任务描述（原样转述用户意图），"
                    "例如读写文件、运行命令、查代码库、修改项目、用工具完成某件事。"
                ),
            },
            "project": {
                "type": "string",
                "description": (
                    "可选。当用户明确指定了要操作哪个项目时，把项目名（中文或英文）"
                    "填这里，例如 “talker”、“语音项目”。留空则使用当前绑定的默认项目；"
                    "全局模式下若留空且无法判断项目，会要求用户说明。可先用 list_projects "
                    "查看可用项目名。"
                ),
            },
        },
        "required": ["task"],
        "additionalProperties": False,
    }

    @tool("delegate_to_opcbrain", args_schema=args_schema)
    async def delegate_to_opcbrain(task: str, project: Optional[str] = None) -> str:
        """把需要实际动手的任务委托给 OPCBrain 执行并返回结果摘要。

        当用户的请求需要真正去做事情时调用本工具：读/写/改文件、运行命令、
        在代码库里查找、操作或修改某个项目、调用工具完成具体任务等。
        若用户指明了项目（如“看看 talker 项目的进展”），把项目名传入 project。
        闲聊、问答、解释类请求不要调用本工具，直接自己回答。
        """
        binding = get_binding() or {}
        # The bare voiceSessionId is reserved for the *conversation* transcript
        # (recorded by the ui-server per turn). Delegation work runs under a
        # suffixed work session so the gateway's writer never collides with the
        # conversation record's writer on the same JSONL file (Phase C dedup).
        base_session_id = binding.get("voiceSessionId")
        voice_session_id = base_session_id
        project_path = ""

        # 1) Explicit project name → resolve via the ui-server project list.
        if project and project.strip():
            resolved = await resolve_project_name(project)
            if resolved.get("status") == "ok":
                project_path = resolved.get("path") or ""
                # Per-target work session so cross-project turns don't collide.
                if base_session_id:
                    voice_session_id = f"{base_session_id}:{resolved.get('name')}"
            elif resolved.get("status") == "ambiguous":
                names = "、".join(resolved.get("candidates") or [])
                return f"有多个项目名字相近：{names}。请说明具体是哪一个。"
            else:  # notfound
                names = "、".join((resolved.get("candidates") or [])[:8])
                hint = f"目前可用的项目有：{names}。" if names else ""
                return f"没有找到名为“{project}”的项目。{hint}请确认项目名。"
        else:
            # 2) Fall back to the bound default project (separate work session).
            project_path = binding.get("projectPath") or ""
            if base_session_id:
                voice_session_id = f"{base_session_id}:work"

        # 3) Global mode with no resolvable project → ask the user.
        if not project_path:
            projects = await fetch_project_list()
            names = "、".join([p.get("displayName") or p.get("name") for p in projects][:8])
            hint = f"目前可用的项目有：{names}。" if names else ""
            return f"你想让我操作哪个项目？{hint}请告诉我项目名。"

        return await _run_opcbrain_turn(gateway_url, task, project_path, voice_session_id)

    delegate_to_opcbrain.description = (
        "把需要实际动手的任务委托给 OPCBrain 执行（读写文件/运行命令/查代码库/"
        "修改项目/用工具完成任务），返回执行结果摘要。可选 project 参数指定目标项目；"
        "闲聊和纯问答不要用它。"
    )
    return delegate_to_opcbrain


def build_list_projects_tool() -> BaseTool:
    """Build the ``list_projects`` tool: list project names the assistant can target."""

    list_schema: dict[str, Any] = {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    }

    @tool("list_projects", args_schema=list_schema)
    async def list_projects() -> str:
        """列出当前可以操作的项目名称清单。

        当用户提到某个项目、要在多个/所有项目上操作、或你不确定项目的准确名字时，
        先调用本工具查看可用项目，再据此把项目名传给 delegate_to_opcbrain。
        """
        projects = await fetch_project_list()
        if not projects:
            return "暂时拿不到项目列表（OPCBrain 可能还没就绪）。"
        names = [p.get("displayName") or p.get("name") for p in projects]
        return "当前可用项目（共 {n} 个）：{names}".format(
            n=len(names), names="、".join(names)
        )

    list_projects.description = (
        "列出当前可操作的项目名称清单，用于解析用户口中的项目名或做跨项目编排前的盘点。"
    )
    return list_projects
