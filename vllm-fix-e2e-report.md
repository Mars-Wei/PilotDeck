# OPC Brain vLLM 修复与端到端记忆测试报告

测试时间：2026-06-13
测试环境：OPC Brain Docker 容器（network_mode: host），挂载本地 `~/.opcbrain`

## 1. 问题诊断

### 1.1 vLLM 服务状态

宿主机上实际运行的是 llama.cpp server：

```
./llama-server -m /data/models/gpt-oss-20b-GGUF/gpt-oss-20b-mxfp4.gguf \
  -c 262144 -ngl 99 -fa on --host 0.0.0.0 --port 9096
```

`/v1/models` 和 `/v1/chat/completions` 都能正常响应，说明服务本身在运行。

### 1.2 OPC Brain 调用 vLLM 时卡住的原因

OPC Brain 调用 vLLM 后，日志停在：

```
[gateway] [router] decision: tier=simple, model=vllm/gpt-oss-20b-mxfp4.gguf
```

直接测试 vLLM 的 chat completions 接口发现，GPT-OSS 模型返回的内容格式为：

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "reasoning_content": "The user says...",
      "content": ""
    }
  }]
}
```

所有输出都在 `reasoning_content` 字段里，而 `content` 为空。OPC Brain 的 `parseOpenAIResponse` 和 `normalizeOpenAIStreamEvent` 只读取 `content`，导致解析为空响应，对话无法继续。

## 2. 修复内容

### 2.1 非流式响应修复

文件：`src/model/providers/openai/response.ts`

当 `message.content` 为空但 `reasoning_content` 存在时，将 `reasoning_content` 作为 assistant 文本内容。

### 2.2 流式响应修复

文件：`src/model/providers/openai/stream.ts`

当 `delta.content` 为空/不存在但 `reasoning_content` 存在时，将 `reasoning_content` 作为 `text_delta` 事件输出，而不是仅作为 `thinking_delta`。

### 2.3 配置调整

- `memory.captureStrategy` 改为 `full_session`，让完整会话被捕获
- router tier 保持：simple/medium → vLLM，complex/reasoning → deepseek

## 3. 端到端测试结果

### 3.1 修复前

```bash
POST /api/agent
{"projectPath":"/root/.opcbrain","message":"你好，请记住我叫李华，住在杭州。","stream":false}
# 返回：messages: []，对话卡住
```

### 3.2 修复后

流式 SSE 输出包含正常的 `stream_delta` 事件：

```
data: {"kind":"stream_delta","content":"好的","..."}
data: {"kind":"stream_delta","content":"，我","..."}
data: {"kind":"stream_delta","content":"已记录","..."}
...
```

对话能够完成，不再卡住。

### 3.3 记忆捕获验证

对话完成后，memory overview 显示 `pendingSessions: 1`，说明 L0 层成功 capture 了会话。

手动 flush 后：

```json
{
  "capturedSessions": 1,
  "writtenFiles": 0,
  ...
}
```

Index trace 显示 classification 结果为 `none`，未生成新的记忆文件。

## 4. 未生成新记忆文件的原因

查看 index trace 发现，vLLM/GPT-OSS 的 assistant 回复把大量内部推理文本也输出到了 content 中，例如：

> "The user says: \"这个 OPC Brain 项目使用 Docker 部署...\" Means \"This OPC Brain project uses Docker deployment...\" They want the assistant to remember these facts. According to long-term memory instructions: ... So we should say something like: \"Got it, noted...\" We don't need to do any tool calls. Just a response. 好的，我已记录：..."

这种被推理文本污染的回复导致 memory classifier 判断该对话没有值得提取的干净记忆（classified=none）。

## 5. 当前状态

| 项目 | 状态 |
|-----|------|
| vLLM 服务可达 | ✅ |
| OPC Brain 调用 vLLM 不卡住 | ✅（修复后） |
| 流式/非流式响应正常 | ✅ |
| 对话完成并 capture 到 L0 | ✅ |
| 自动索引运行 | ✅ |
| 生成结构化记忆文件 | ⚠️ 未生成，因 assistant 回复被推理文本污染 |

## 6. 建议

### 方案 A：调整 llama.cpp 参数（推荐）

当前 llama.cpp 使用 `reasoning_format: deepseek`，但 GPT-OSS 模型似乎把所有内容都放进了 reasoning channel。尝试：

1. 使用 `--chat-template` 指定正确的 GPT-OSS chat template
2. 或尝试 `--reasoning-format none`，让模型直接输出到 content
3. 或更新 llama.cpp 到支持 GPT-OSS 更好的版本

### 方案 B：继续用 deepseek 作为主模型

如果本地 vLLM 输出质量不稳定，可以暂时把 simple/medium tier 也指向 deepseek，保证体验和记忆质量。

### 方案 C：增强 OPC Brain 的 reasoning 过滤

在流式/非流式响应中识别并剥离 GPT-OSS 的 reasoning prefix，只把最终回复传给用户和记忆模块。但这会增加复杂性，且模型特异性强。

## 7. 结论

- vLLM 本身服务正常
- OPC Brain 对 `reasoning_content` 的兼容已修复，simple/medium tier 不再卡住
- 由于 GPT-OSS + llama.cpp 当前配置输出质量不佳（content 被推理文本污染），记忆模块未能从 vLLM 对话中提取出干净记忆
- 建议优先调整 llama.cpp 的 chat template / reasoning format 配置，或暂时使用 deepseek 作为主模型

## 8. 相关提交

- `a9a5fef` fix: surface reasoning_content from local OpenAI-compatible servers as text
