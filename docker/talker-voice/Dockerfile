# talker voice sidecar for OPCBrain.
#
# Build context = this directory (docker/talker-voice), which holds the sidecar
# files. The talker repo is supplied as a named additional build context via
# docker-compose:
#
#   build:
#     context: ./docker/talker-voice
#     additional_contexts:
#       - talker=../talker
#
# (Requires BuildKit / Compose v2.17+.)

FROM python:3.11-slim

# Build deps for any native wheels pulled by talker's cloud extras.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install talker from the named build context "talker" (the talker repo root).
# The "ali" extra pulls dashscope for cloud Qwen3 ASR + CosyVoice TTS.
COPY --from=talker . /app/talker
RUN pip install --no-cache-dir -e "/app/talker[ali]" \
    && pip install --no-cache-dir websockets "pyjwt>=2.8" uvicorn

# Sidecar code + config (from this build context).
WORKDIR /app/sidecar
COPY voice_server.py opcbrain_tool.py config.voice.json /app/sidecar/

EXPOSE 11995

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=40s \
    CMD curl -fsS http://127.0.0.1:11995/healthz >/dev/null || exit 1

CMD ["python", "voice_server.py", "--config", "config.voice.json", "--port", "11995"]
