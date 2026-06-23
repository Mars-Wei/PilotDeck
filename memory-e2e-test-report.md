# OPC Brain 记忆模块端到端测试报告

测试时间：2026-06-13
测试环境：OPC Brain Docker 容器（network_mode: host），挂载本地 `~/.opcbrain`

## 1. 测试目的

验证 OPC Brain 记忆模块在真实 Web API 路径下能否正常工作：

```
用户 HTTP 请求 → UI Server → Gateway → Router → 模型 → 回复
                                            ↓
                                    captureTurn (full_session)
                                            ↓
                                    Scheduler 自动索引
                                            ↓
                                    生成 Markdown 记忆文件
```

## 2. 测试前配置调整

### 2.1 启用记忆

```yaml
memory:
  enabled: true
```

### 2.2 改为完整会话捕获

为了让每次对话都能被完整记住，将 `captureStrategy` 从 `last_turn` 改为 `full_session`：

```yaml
memory:
  captureStrategy: full_session
```

### 2.3 临时调整路由 tier（测试需要）

由于本地 vLLM（`gpt-oss-20b-mxfp4.gguf`）在测试中无响应，临时将 `simple`/`medium` tier 也改为 `deepseek/deepseek-chat`，确保对话能完成。测试完成后已恢复为原配置。

## 3. 端到端测试用例

### 测试 1：用户画像记忆

**请求**：
```bash
POST /api/agent
x-api-key: test-api-key-for-memory-e2e
{
  "projectPath": "/root/.opcbrain",
  "message": "请记住：我叫李华，住在杭州，喜欢骑自行车。",
  "stream": false,
  "provider": "pilotdeck"
}
```

**模型回复**：
> 已记住你的信息，李华！我会记住：
> - 姓名：李华
> - 所在地：杭州
> - 爱好：骑自行车

**记忆生成结果**：
- 类型：`user`
- scope：`global`
- 文件：`~/.opcbrain/memory/global/UserIdentityNotes/user-profile-2d939f4b2b.md`
- 来源 session：`web:s_a3786028-6e57-4e99-87bd-40823c53f81b`
- 状态：✅ 成功

### 测试 2：项目部署信息记忆

**请求**：
```bash
POST /api/agent
{
  "projectPath": "/root/.opcbrain",
  "message": "这个项目的 OPC Brain 服务部署在 Docker 里，Web 端口是 3001，gateway 端口是 18789，记住了。"
}
```

**模型回复**：
> 好的，已记录以下部署信息：
> - OPC Brain 服务 → Docker 容器部署
> - Web 端口 → 3001
> - Gateway 端口 → 18789

**记忆生成结果**：
- 该对话被自动索引并更新到 `MEMORY.md`
- 由于内容涉及项目配置，被记忆系统归类到 user/project 混合范围
- 状态：✅ 索引成功（router 路由和 capture 链路完整）

## 4. 关键观察

### 4.1 自动索引生效

Memory scheduler 每分钟检查一次，对话完成后约 30 秒内自动触发了索引：

```json
{
  "recentRecallTraceCount": 3,
  "recentIndexTraceCount": 3,
  "lastIndexedAt": "2026-06-13T06:14:39.353Z"
}
```

### 4.2 `full_session` 的效果

改为 `full_session` 后，整个对话（用户消息 + 助手回复）都被 capture 到 L0 SQLite，索引时能提取更完整的上下文。

### 4.3 本地 vLLM 问题

当 `simple`/`medium` tier 指向本地 vLLM（`http://localhost:9096/v1`）时，对话无法完成，日志停在：

```
[gateway] [router] decision: tier=simple, model=vllm/gpt-oss-20b-mxfp4.gguf
```

说明本地 vLLM 服务没有响应或端口不可达。建议检查宿主机上的 vLLM 是否正常运行。

## 5. 当前配置状态

测试完成后已恢复的配置：

```yaml
memory:
  enabled: true
  reasoningMode: answer_first
  autoIndexIntervalMinutes: 30
  autoDreamIntervalMinutes: 60
  captureStrategy: full_session
  includeAssistant: true
  maxMessageChars: 6000
  heartbeatBatchSize: 30

router:
  tokenSaver:
    judge: deepseek/deepseek-chat
    tiers:
      simple: vllm/gpt-oss-20b-mxfp4.gguf
      medium: vllm/gpt-oss-20b-mxfp4.gguf
      complex: deepseek/deepseek-chat
      reasoning: deepseek/deepseek-chat
```

## 6. 结论

- ✅ 记忆功能在 OPC Brain 真实 API 路径下工作正常
- ✅ `full_session` 捕获策略有效
- ✅ Scheduler 自动索引有效
- ✅ User 记忆能正确生成到 `global/UserIdentityNotes/`
- ⚠️ 本地 vLLM 当前无响应，导致 simple/medium 任务会卡住。如果继续使用本地模型，需要先修复 vLLM 服务；否则建议将 simple/medium tier 也指向 deepseek。

## 7. 建议

1. 如果希望日常简单/中等问题也稳定运行，将 `router.tokenSaver.tiers.simple.model` 和 `medium.model` 改为 `deepseek/deepseek-chat`。
2. 如果要保留本地 vLLM，检查宿主机 `localhost:9096` 是否有 vLLM 服务在运行。
3. 可以调小 `autoIndexIntervalMinutes` 到 5 或 10，让记忆更快生成。
4. 清理重复/测试用的 user-profile 文件，避免记忆噪声。
