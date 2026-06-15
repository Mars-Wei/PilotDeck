"""Smoke test: talker DefaultAgent + delegate_to_opcbrain tool -> OPCBrain.

Bypasses ASR/TTS. Builds the same agent the sidecar uses (cloud-LLM brain +
the OPCBrain delegation tool), feeds it a "do real work" utterance, and checks
the LLM decides to delegate and OPCBrain actually executes.

Run inside the talker-voice image on the compose network, e.g.:
  docker compose run --rm -T \
    -e LLM_API_KEY=... -e LLM_MODEL=kimi-k2.6 \
    -e LLM_BASE_URL=https://api.moonshot.cn/v1 \
    -v "$PWD/docker/talker-voice:/app/sidecar" \
    talker-voice python /app/sidecar/test_agent.py
"""

import asyncio
import os

import opcbrain_tool
from talker.llm_agent.default import DefaultAgent
from talker.llm_agent.runtime import FastToolGateConfig

GATEWAY = os.environ.get("OPCBRAIN_VOICE_GATEWAY", "ws://opcbrain:3001/ws")
SYSTEM_PROMPT = (
    "你是一个语音助理。闲聊和简单问答直接回答。当用户需要实际操作（读写文件、运行命令、"
    "查代码库、修改项目、用工具完成任务）时，必须调用 delegate_to_opcbrain 工具，把用户意图"
    "原样作为 task 传给它执行。"
)


async def main() -> None:
    # Bind the delegation tool to a project + voice session.
    opcbrain_tool.set_active_binding(
        {"projectPath": "/workspace", "voiceSessionId": "web:s_smoke-agent"}
    )

    agent = DefaultAgent(
        model={
            "api_key": os.environ["LLM_API_KEY"],
            "model": os.environ.get("LLM_MODEL", "kimi-k2.6"),
            "base_url": os.environ.get("LLM_BASE_URL", "https://api.moonshot.cn/v1"),
        },
        system_prompt=SYSTEM_PROMPT,
        tools=[opcbrain_tool.build_opcbrain_tool(GATEWAY)],
        # Disable the speculative no-tool race so delegation always goes through.
        fast_tool_gate_config=FastToolGateConfig(enabled=False),
    )

    task = "在当前项目里创建文件 voice-agent-test.txt，内容写 hello from talker agent。完成后简短确认。"
    print(f"[test_agent] user: {task}")

    chunks = []
    tool_fired = []
    async for item in agent.async_generate_stream({"content": task, "context": {}}):
        if isinstance(item, dict) and "name" in item:
            tool_fired.append(item["name"])
            print(f"[test_agent] tool_call -> {item['name']} args={item.get('args')}")
        elif isinstance(item, str):
            chunks.append(item)

    reply = "".join(chunks)
    print(f"[test_agent] assistant: {reply}")
    print(f"[test_agent] tools fired: {tool_fired}")
    delegated = any(n == "delegate_to_opcbrain" for n in tool_fired)
    print(f"[test_agent] delegated_to_opcbrain={delegated}")


if __name__ == "__main__":
    asyncio.run(main())
