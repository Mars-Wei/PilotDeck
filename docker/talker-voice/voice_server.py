"""talker voice sidecar for OPCBrain.

Runs talker's full-duplex voice pipeline (cloud ASR/TTS + its own fast LLM as
the conversational brain) and adds a single ``delegate_to_opcbrain`` tool so
the assistant can hand real work to OPCBrain and narrate the result.

Auth/binding flow:
- The OPCBrain ui-server mints a talker JWT (HS256, shared ``TALKER_AUTH_SECRET``)
  whose claims carry ``project_path`` and ``voice_session_id``.
- This server owns the ``/ws`` route: it decodes those claims, stashes them in a
  per-connection ContextVar (read by the delegation tool), then hands the socket
  to talker's ``connect()``.
- All other talker routes (login/sessions/upload) are mounted on a side path.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os

import httpx
import jwt
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from talker import Talker
from talker.log_utils import mute_other_logging
from talker.serving.modules.tts_manager import TTSManager
from talker.serving.events import ASRResultFinal, LLMAgentResponseFinish, TurnTTSCueRequested
from talker.serving.service_manager import ServiceManager

import opcbrain_tool

mute_other_logging()

logger = logging.getLogger("voice_server")

# talker splits TTS text on commas, colons and "." as well, which makes the
# cloud TTS synthesize many tiny segments with an audible pause between each
# (choppy playback). Only break on strong sentence enders so the assistant's
# reply is spoken in fewer, longer, smoother segments. (Class attribute is read
# via self.SENTENCE_DELIMITERS in TTSManager._split_text_by_delimiters.)
TTSManager.SENTENCE_DELIMITERS = {"。", "！", "？", "!", "?", "\n"}

AUTH_SECRET = os.environ.get("TALKER_AUTH_SECRET", "")
GATEWAY_URL = os.environ.get("OPCBRAIN_VOICE_GATEWAY", "ws://opcbrain:3001/ws")

parser = argparse.ArgumentParser(description="OPCBrain Voice Sidecar")
parser.add_argument("--config", type=str, required=True, help="talker config JSON")
parser.add_argument("--port", type=int, default=11995)
args = parser.parse_args()

app = FastAPI(title="OPCBrain Voice Sidecar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

talker_instance = Talker.from_config(args.config)

# Register the OPCBrain tools before any session is created:
#  - delegate_to_opcbrain: hand real work to OPCBrain (optionally to a named project)
#  - list_projects: enumerate targetable projects (cross-project / name resolution)
#  - end_conversation: let the LLM end the call on exit intent (the Web UI hangs
#    up when it sees this tool call, after the goodbye is spoken)
talker_instance.add_agent_tools([
    opcbrain_tool.build_opcbrain_tool(GATEWAY_URL),
    opcbrain_tool.build_list_projects_tool(),
    opcbrain_tool.build_end_conversation_tool(),
])

# ── Conversation history sync (Phase C) ───────────────────────────────────
# Each talker connection owns a per-service event bus. We monkeypatch
# ServiceManager.create_service to subscribe, on every new connection, handlers
# that capture the final user transcript (ASRResultFinal) and the final spoken
# reply (LLMAgentResponseFinish), then POST the pair to the ui-server so the
# turn lands in the session history. (Same monkeypatch pattern as the TTS
# delimiter override above.)
VOICE_RECORD_URL = f"{opcbrain_tool.HTTP_BASE}/api/voice/record"
VOICE_RECORD_TIMEOUT_S = float(os.environ.get("OPCBRAIN_VOICE_RECORD_TIMEOUT", "8"))


async def _post_voice_record(user_text: str, assistant_text: str) -> None:
    binding = opcbrain_tool.get_active_binding()
    session_id = binding.get("voiceSessionId")
    if not session_id:
        return  # No bound voice session id → nowhere to record.
    payload = {
        "projectPath": binding.get("projectPath") or "",
        "sessionId": session_id,
        "userText": user_text,
        "assistantText": assistant_text,
    }
    try:
        async with httpx.AsyncClient(timeout=VOICE_RECORD_TIMEOUT_S) as client:
            await client.post(VOICE_RECORD_URL, json=payload)
    except Exception as exc:  # noqa: BLE001 - best-effort, never break the call
        logger.warning("voice record POST failed: %s", exc)


# ── Spoken welcome on connect ──────────────────────────────────────────────
# Greet in talker's own voice right after the client attaches. Uses a transient
# TTS cue (doesn't touch official response/conversation state, and TTS playback
# doesn't need the client VAD loaded, so it plays immediately — also masking any
# remaining load). The line comes from voice.welcomeLine in opcbrain.yaml.
VOICE_SETTINGS_URL = f"{opcbrain_tool.HTTP_BASE}/api/voice/settings"
DEFAULT_WELCOME = "你好，我是小智秘书，需要我帮你做什么？"
_welcome_cache: dict = {"line": None}


async def _get_welcome_line() -> str:
    if _welcome_cache["line"] is not None:
        return _welcome_cache["line"]
    line = DEFAULT_WELCOME
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(VOICE_SETTINGS_URL)
            resp.raise_for_status()
            wl = (resp.json() or {}).get("welcomeLine")
            if isinstance(wl, str) and wl.strip():
                line = wl.strip()
    except Exception as exc:  # noqa: BLE001 - fall back to default
        logger.warning("failed to fetch welcomeLine: %s", exc)
    _welcome_cache["line"] = line
    return line


async def _speak_welcome(service) -> None:
    """Speak the greeting once the client has attached + can play audio."""
    try:
        await asyncio.sleep(1.2)  # let the client attach before we synthesize
        line = await _get_welcome_line()
        if not line:
            return
        await service.event_bus.publish(
            TurnTTSCueRequested(session_id=service.session_id, text=line)
        )
    except Exception:  # noqa: BLE001 - greeting must never break the call
        logger.exception("welcome cue failed")


def _attach_recording(service) -> None:
    """Subscribe per-turn recording handlers to one connection's event bus."""
    state = {"user_text": ""}

    async def on_user(event) -> None:
        text = (getattr(event, "display_text", "") or getattr(event, "text", "") or "").strip()
        if text:
            state["user_text"] = text

    async def on_assistant(event) -> None:
        assistant_text = (getattr(event, "text", "") or "").strip()
        user_text = state.get("user_text", "")
        state["user_text"] = ""
        if not assistant_text and not user_text:
            return
        await _post_voice_record(user_text, assistant_text)

    service.event_bus.subscribe(ASRResultFinal, on_user)
    service.event_bus.subscribe(LLMAgentResponseFinish, on_assistant)


_orig_create_service = ServiceManager.create_service


async def _create_service_with_recording(self, *a, **kw):
    service = await _orig_create_service(self, *a, **kw)
    try:
        _attach_recording(service)
        asyncio.create_task(_speak_welcome(service))
    except Exception:  # noqa: BLE001 - recording/greeting must never block connections
        logger.exception("Failed to attach voice hooks")
    return service


ServiceManager.create_service = _create_service_with_recording

# Mount talker's standard HTTP/WS routes on a side WS path so we can own "/ws".
talker_instance.mount_routes(app, ws_path="/_talker_ws")


def _decode_claims(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        if AUTH_SECRET:
            return jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
        # No shared secret configured: best-effort decode (dev only).
        return jwt.decode(token, options={"verify_signature": False})
    except Exception:  # noqa: BLE001
        return None


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@app.websocket("/ws")
async def voice_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("access_token")
    claims = _decode_claims(token)
    if claims is None:
        await websocket.accept()
        await websocket.close(code=1008, reason="Unauthorized")
        return

    user_id = str(claims.get("sub") or "voice-user")
    binding = {
        "projectPath": claims.get("project_path"),
        "voiceSessionId": claims.get("voice_session_id"),
    }
    ctx_token = opcbrain_tool.current_binding.set(binding)
    opcbrain_tool.set_active_binding(binding)
    try:
        await talker_instance.connect(websocket, user_id=user_id)
    finally:
        opcbrain_tool.current_binding.reset(ctx_token)
        opcbrain_tool.clear_active_binding(binding)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=args.port)
