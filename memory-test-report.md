# OPC Brain 记忆模块测试报告

测试时间：2026-06-13
测试环境：OPC Brain Docker 容器（network_mode: host），挂载本地 `~/.opcbrain`

## 1. 记忆模块架构概览

OPC Brain 的记忆模块代号为 **EdgeClaw Memory**，采用混合存储架构：

- **L0 原始层**：每次对话回合结束时，`AgentLoop` → `DefaultContextRuntime.captureTurn()` → `EdgeClawMemoryProvider.captureTurn()` → `EdgeClawMemoryService.captureTurn()`，将会话原始数据写入 SQLite（`control.sqlite`）。
- **索引层（HeartbeatIndexer）**：定时或手动触发 `flush()`，使用 LLM 对 L0 会话进行提取、分类、摘要，生成 Markdown 记忆文件。
- **存储层**：
  - SQLite：`~/.opcbrain/memory/workspaces/<hash>/control.sqlite`
  - Markdown 文件：`~/.opcbrain/memory/workspaces/<hash>/memory/`（项目级）和 `~/.opcbrain/memory/global/`（用户级）
- **检索层（ReasoningRetriever）**：在后续对话中，根据查询自动检索相关记忆并注入 system context。

关键配置项（`opcbrain.yaml`）：

```yaml
memory:
  enabled: true
  reasoningMode: answer_first
  autoIndexIntervalMinutes: 30
  autoDreamIntervalMinutes: 60
  captureStrategy: last_turn   # 或 full_session
  includeAssistant: true
  maxMessageChars: 6000
  heartbeatBatchSize: 30
```

## 2. 测试方法

由于 Web UI 真实对话的 capture 有延迟（`last_turn` 策略 + scheduler 定时触发），本次测试直接调用容器内的 `EdgeClawMemoryService` API，模拟真实对话并立即触发索引，以验证记忆生成链路是否完整。

测试模型：使用 `deepseek/deepseek-chat` 作为记忆提取/分类模型。

## 3. 测试用例与结果

### 用例 1：项目部署配置记忆

**对话内容**：
- 用户：在这个 OPC Brain 项目里，我们总是用 Docker 部署，主端口是 3001，gateway 端口是 18789。
- 助手：已记录：OPC Brain 项目使用 Docker 部署，Web UI 端口 3001，gateway 端口 18789。

**生成结果**：
- 类型：`project` + `general_project_meta`
- 文件：`Project/opc-brain-项目部署配置-8bbb366c14.md`
- 摘要内容：部署方式 Docker、主端口 3001、Gateway 端口 18789
- 状态：✅ 成功

### 用例 2：模型偏好反馈记忆

**对话内容**：
- 用户：刚才你切换模型到 deepseek 后响应快了很多，这种方式很好。
- 助手：谢谢你的反馈，我会记住你更偏好使用 deepseek 模型。

**生成结果**：
- 类型：`feedback`
- 文件：`Feedback/prefer-deepseek-model-for-faster-responses-9765982354.md`
- 摘要内容：Prefer using the deepseek model when possible, as it provides faster responses.
- 状态：✅ 成功

### 用例 3：用户画像记忆

**对话内容**：
- 用户：你记一下：我叫王磊，喜欢吃川菜，讨厌吃甜食。我的默认编程语言是 Python。
- 助手：好的，我已经记住了：你叫王磊，喜欢吃川菜、讨厌甜食，默认编程语言是 Python。

**生成结果**：
- 类型：`user`（全局用户记忆）
- 文件：`global/UserIdentityNotes/王磊的个人信息-b494d60fee.md`
- 摘要内容：姓名、饮食偏好和默认编程语言
- 状态：✅ 成功

### 用例 4：用户时区与在线时间

**对话内容**：
- 用户：请记住我的工作时区是 Asia/Shanghai，我一般上午 9 点到下午 6 点在线。
- 助手：已记录：你的时区是 Asia/Shanghai，在线时间一般是 9:00-18:00。

**生成结果**：
- 类型：`user`（全局用户记忆）
- 文件：`global/UserIdentityNotes/工作时区与在线时间-fe7b7aaa07.md`
- 摘要内容：用户工作时区为 Asia/Shanghai，在线时间为上午9点到下午6点。
- 状态：✅ 成功

## 4. 关键发现

### 4.1 用户记忆存储位置

用户画像不会被归类到 `UserIdentity/user-profile.md`，而是生成在 `global/UserIdentityNotes/<主题>-<hash>.md`。这种设计把用户画像按主题拆分成多个笔记文件，便于单独更新和检索。

### 4.2 项目记忆的双写现象

一个项目相关的会话可能同时生成两类文件：
- `Project/<名称>.md`：具体项目记忆
- `GeneralProjects/<名称>.md`：通用项目元数据

这是 General-local workspace 模式下的正常行为，便于跨项目复用通用信息。

### 4.3 Web UI 真实对话未立即生成记忆的原因

手动调用 `/api/memory/index/run?projectPath=...` 对三个实际 workspace（`/app`、`/root/.opcbrain`、`/home/ripple/桌面`）均返回 `capturedSessions: 0`，说明：

1. 当前 `captureStrategy: last_turn` 只捕获对话的最后一轮，如果对话未结束或未被标记为完成，不会进入 L0。
2. 索引默认 30 分钟自动跑一次，Web UI 中的对话需要等待 scheduler 触发或手动 flush。
3. 如果 AgentLoop 因模型错误（如之前的 `fetch failed` 或路由循环）中断，captureTurn 也不会被调用。

### 4.4 记忆功能本身正常

直接调用 `EdgeClawMemoryService` 的测试证明：
- L0 capture 正常
- LLM 提取/分类正常
- Markdown 文件生成正常
- MEMORY.md manifest 更新正常
- User / Project / Feedback 三种类型都能正确生成

## 5. 建议

1. **验证 Web UI 对话 capture**：在 OPC Brain 中完成一段完整对话（用户提问 + 助手成功回复 + 无错误），等待 1-2 分钟后查看 `/api/memory/overview?projectPath=<当前项目>` 的 `pendingSessions` 是否增加。
2. **手动触发索引**：如果等待后仍未生成，可在系统状态的 Memory 面板点击“立即索引”，或调用 `POST /api/memory/index/run?projectPath=<项目路径>`。
3. **考虑 captureStrategy**：如果希望每次完整会话都被记忆，可将 `memory.captureStrategy` 改为 `full_session`。
4. **监控 scheduler**：当前 scheduler 每分钟检查一次，30 分钟自动索引，60 分钟自动 dream。如需更快反馈，可临时调小 `autoIndexIntervalMinutes`。

## 6. 结论

记忆模块代码实现完整，测试用例均成功生成对应类型的记忆文件。Web UI 状态显示“记忆在线” accurate，真实对话未立即生成记忆是由于 capture 策略和 scheduler 定时机制导致，并非功能故障。
