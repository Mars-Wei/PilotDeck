# 语音助理全局化 — 实现计划

> **进度（截至 2026-06-15）**
> - ✅ **阶段 A 已完成并部署**（全局 Provider + 边栏语音区 + 全局闲聊模式 + 移除旧 voice tab）。
> - ✅ **追加 UI 微调已完成并部署**（详见下方「阶段 A+：UI 微调」）。
> - ⏳ 阶段 B / C / D 待开发。
> - 实现中相对原计划的偏差已在各节用 `【实现差异】` 标注。

## Context

语音助理已能用（talker sidecar：云 ASR/TTS + talker LLM 当对话脑，要干活时 `delegate_to_opcbrain`
委托 OPCBrain）。现要把它从"项目内的一个 tab"升级为**全局语音助理**：右下角常驻唤起、层叠进右侧边栏、
可免手唤醒、能跨项目查询/操作、对话进相应项目历史。设计已定稿（见对话）。本计划按 4 个可独立交付的阶段落地。

已确认决策：FAB 入口 / 语音区层叠进右侧边栏(状态内容底对齐) / 唤醒词「小智秘书」(仅页面打开时本地监听) /
退出词「退下吧」或静默超时→播「我先退下了」/ 目标默认跟随当前项目、全局模式可跨项目 / 跨项目操作直接执行不确认 /
"所有项目"扇出超阈值先确认+串行汇总 / 项目对话全部同步进该项目历史、全局对话进可见保留项目「全局助理」。

关键事实（探索得到）：
- transcript 只由 gateway 经 `JsonlTranscriptWriter`（`src/session/transcript/`）写入；**无现成的"仅追加不跑模型"接口**，需新增。
- 委托轮已经过 gateway（`pilotdeck-command`→`runChatViaGateway`），所以**委托轮已自动落库**；缺的是**纯对话轮**的落库。
- 右侧边栏 = `SystemStatusPanel`（`<aside class="...w-72 shrink-0 overflow-y-auto...">`）。
- `general` 是 rooted 在 `~/.opcbrain` 的虚拟项目（`ui/server/projects.js:232`），「全局助理」可仿照合成。
- 配置走 `src/pilot/config/`（types + loadPilotConfig allowedKeys + 分段 parser）；UI 侧 `ui/server/services/pilotdeckConfig.js` 读写。

---

## 阶段 A：全局语音外壳（FAB + 边栏语音区 + 全局 Provider）✅ 已完成

把现有 `VoicePanel` 的会话逻辑抽成全局单例，常驻可见，跨 tab 存活。**先只做项目模式+全局闲聊**（不含跨项目/唤醒/历史同步）。

> **【实现差异】**
> - **FAB 取消**：没有右下角浮动 FAB。改为在右侧边栏语音区内放一个**大麦克风按钮**（折叠态占据语音区，点击后按钮消失、展开对话区）——见「阶段 A+ 第 2 点」。`ui/src/components/voice/VoiceFab.tsx` 已创建后**删除**。
> - **旧 `VoicePanel` 删除**：`ui/src/components/main-content/view/voice/VoicePanel.tsx` 已删除（逻辑已 lift 进 Provider）。
> - **全局登录已打通**：`/api/voice/login` 允许空 `projectPath`（= 🌐 全局模式），见 `ui/server/routes/voice.js`。
> - talker SDK vendored 在 `ui/public/talker/index.js`，经 `/voice-ws` 代理连 sidecar。

1. **`ui/src/contexts/VoiceAssistantContext.tsx`（新增）** — `VoiceAssistantProvider` + `useVoiceAssistant()`：
   - 持有唯一语音会话（lift `VoicePanel.tsx:40-143` 的 `loadCreateSession`/`buildVoiceWsUrl`/open/close/mute/onStateChange）。
   - 状态：enabled、active、connecting、muted、conversation、targetProject、status。
   - 暴露 `start/stop/toggleMute/setTarget`。
   - 接收 `projects` + `selectedProject`（作 props 或通过一个轻量 props 注入），打开时默认 target=当前项目，无则 🌐 全局。
2. **挂载点**：在 `AppShellV2.tsx`（`return` 的 `<div class="ui-v2 fixed inset-0...">` 内、`<main>` 外层）包一层
   `VoiceAssistantProvider`，把 `sidebarSharedProps.projects` + `selectedProject` 传进去。AppShellV2 是持久外壳，切 tab 不卸载。
3. **FAB**：`ui/src/components/voice/VoiceFab.tsx`（新增），挂在 AppShellV2 根 div，右下角 `fixed`，z 高于内容；
   显示待机/聆听/对话/将退状态 + 目标项目小徽标；点击 `start()`/展开边栏语音区。
4. **边栏语音区 + 状态底对齐**：
   - 改 `SystemStatusPanel.tsx` 外层 `<aside>` 为 `flex flex-col`；现有内容包进底部块（`mt-auto shrink-0`，实现"底对齐"）。
   - 顶部插 `ui/src/components/voice/VoiceConversationZone.tsx`（新增）：`min-h-0 flex-1 overflow-y-auto`，
     未激活时高度 0/隐藏；激活后展示标题/目标下拉/对话时间线/状态条/静音·结束；增长到状态区即内部滚动。
   - `HomeChrome.tsx` 渲染 `SystemStatusPanel` 处保持不变（语音区在 SystemStatusPanel 内部组合）。
5. **移除旧入口**：`useAppTabs.ts`、`HomeSidebar.tsx`、`CommandPalette.tsx`、`MainContent.tsx`(renderTool/fullScreenToolTabs)、
   `types/app.ts` 里我之前加的 `'voice'` tab 全部回退；`MainContent` 的 `VoicePanel` 分支移除（VoicePanel 文件可删或留作参考）。
6. i18n：voice 文案迁到全局组件继续用。

**验证**：点开右侧边栏语音区出现大麦克风按钮、状态沉底；项目页里默认目标=该项目、首页=全局；
说话能对话；切 tab 时会话不中断。

## 阶段 A+：UI 微调（用户后续追加，✅ 已完成并部署）

阶段 A 落地后用户提出的两点界面调整，已实现并随 opcbrain 镜像重建部署：

1. **快捷操作迁到左栏、隐藏「最近项目」**：
   - `HomeSidebar.tsx`：移除底部「最近项目」列表块；改为「快捷操作」块（设置 → `onOpenSettings`、API 密钥 → `onOpenApiKeys`、`runningCount>0` 时显示「N 个任务运行中」）。props 去掉 `projects`/`onProjectClick`，加 `onOpenSettings`/`onOpenApiKeys`。
   - `SystemStatusPanel.tsx`：删除原右侧「快捷操作」块及死代码（`QuickAction` 组件、`Settings`/`KeyRound` 图标、`onOpenSettings`/`onOpenApiKeys`/`taskStats` 未用 props）。
   - `HomeChrome.tsx`：`HomeSidebar` / `SystemStatusPanel` 调用同步更新 props。
2. **大麦克风按钮取代 FAB**：
   - `VoiceConversationZone.tsx`：折叠态（`!panelOpen`）渲染一个填满语音区的大麦克风按钮（h-20 w-20 圆形 + 状态文案 + 目标徽标），点击 `openPanel()` 并自动 `start()`；展开态（`panelOpen`）渲染完整对话区（X 收起 / 目标下拉 / 时间线 / 静音·结束）。
   - `enabled===false`（未配置 sidecar）时整块不渲染。

**验证**：左栏底部显示「设置 / API 密钥」快捷操作、「最近项目」不再出现；右侧语音区折叠时是大按钮，点击展开为对话区。

## 阶段 B：跨项目全局模式（delegate 带 project + 项目清单 + 名称解析 + 扇出）✅ 已完成（item 4 改方案）

> **【实现差异】**
> - **项目清单注入改为 `list_projects` 工具**（item 3）：talker 的 system_prompt 在 agent 构造时固定，运行后/按连接动态注入不稳妥；改为新增 `list_projects` 工具让 LLM 按需查询，自更新且不依赖 talker 内部 API。`opcbrain_tool.build_list_projects_tool()`，在 `voice_server.py` 一并注册。
> - **item 4「会话内无缝切目标控制帧」暂缓**：`talker_instance.connect()` 接管 WS 收包循环后，ui-server 代理与 voice_server 都无法再拦截自定义入站帧（需 talker 层 hook）。阶段 A 的**重连式切目标已能正确工作**（下拉切换→带新 project 的 token 重连），故 item 4 仅为优化、推迟。跨项目能力靠 `project` 参数 + `list_projects` 达成，无需切默认绑定。
> - **跨项目 work session 隔离**：带显式 `project` 的委托，其 `voiceSessionId` 追加 `:<name>` 后缀，避免不同项目的委托轮落进同一会话。
> - sidecar 经 `OPCBRAIN_VOICE_HTTP`（默认 `http://opcbrain:3001`，从 gateway URL 派生）访问 ui-server；项目清单端点在默认 docker 部署下走 `OPCBRAIN_DISABLE_LOCAL_AUTH=true` 的无 token 旁路。
> - 验证（容器内实测）：project-list 可达并返回 6 个项目；`resolve_project_name` 精确/大小写/子串/歧义/未找到五类均正确；`list_projects` 工具正常；sidecar 无启动错误。

1. **`docker/talker-voice/opcbrain_tool.py`**：`delegate_to_opcbrain` 增加可选 `project` 参数；
   - 解析顺序：显式 `project`（名称）→ 经 `/api/voice/project-list` 解析为 path；否则用 binding 的默认 project；🌐 全局且未指定 → 报"请说明哪个项目"。
   - 新增 `resolve_project_name()`（调 ui-server 项目清单，模糊匹配 name/displayName，歧义返回候选）。
2. **`ui/server/routes/voice.js`**：新增 `GET /api/voice/project-list`（复用 `getProjects()`，返回 `{name,displayName,fullPath}[]`，含「全局助理」）。
3. **项目清单注入**：`voice_server.py` 在 WS 连接建立时拉一次项目清单，拼进 DefaultAgent 的 system prompt（让 LLM 能把口语项目名映射到真实项目）；或做成 `list_projects` 工具。优先注入 system prompt。
4. **会话内切目标（无缝，不重连）**：给 talker WS 加一条控制帧 `{action:'set_target_project', project}`，`voice_server.py` 收到后更新该连接 binding 的默认 project；前端下拉切换时发送它。
5. **扇出**：system prompt 指示"所有项目"类请求先报数确认（>阈值，默认 5），再**串行**逐项目 `delegate` 后汇总；阈值读 voice 配置。
6. **操作直接执行**：维持 `permissionMode: 'bypassPermissions'`（查询/修改都不二次确认）。

**验证**：全局模式说"看看 talker 项目的进展"→ 命中 talker 执行并播报；"哪些项目有失败任务"→ 串行查后汇总；
项目名歧义时口头确认；下拉切目标后续指令落到新项目。

## 阶段 C：对话历史同步（含纯对话）+「全局助理」保留项目 ✅ 已完成（落库改在 ui-server）

> **【实现差异】**
> - **落库不走 gateway 协议**：原计划在 gateway 协议加 `recordExchange` 方法（需改 protocol/types + RemoteGateway + GatewayWsConnection + InProcessGateway + createLocalGateway，并重建 dist）。改为**在 ui-server 直接复用真实 TS 类**落库——ui-server 以 `node --import tsx` 运行，可直接 import `createAgentProjectSessionStorage`（拿到与 gateway 完全一致的 transcript 路径 + `JsonlTranscriptWriter`）和 `readTranscript`（续接 sequence/entryId）。无 gateway 手术、路径编码与网关一致、风险更低。实现于新文件 `ui/server/services/voiceTranscript.js` 的 `recordVoiceExchange()`。
> - **每轮上报靠 monkeypatch**：talker 的 EventBus 是**每连接一个**（`service.event_bus`），无全局订阅入口。`voice_server.py` monkeypatch `ServiceManager.create_service`，在每个连接建立后给其 event_bus 订阅 `ASRResultFinal`（用户终稿）+ `LLMAgentResponseFinish`（助理终稿），配对后 POST `/api/voice/record`。（与既有 TTSManager 分隔符 monkeypatch 同一手法。）
> - **去重落实**：委托工作会话一律加后缀（默认 `:work`、指定项目 `:<name>`），**裸 voiceSessionId 专用于对话记录**，对话 writer 与网关 writer 永不写同一文件。
> - **「全局助理」**：`ui/server/services/voiceTranscript.js` 导出 `GLOBAL_ASSISTANT`（root=`<pilotHome>/global-assistant`），`projects.js` 仿 `general` 合成可见项目并 splice 到 general 之后；project-list 自动带出。
> - 验证（已部署实测）：`recordVoiceExchange` 写出 `session_metadata+accepted_input+assistant_message+turn_result`，两轮 sequence 连续 1–7；经真实 `readWebSessionMessages` 正确渲染出 user/assistant 两条；容器内 POST `/api/voice/record` 成功落到 `…/global-assistant/chats/<sid>.jsonl`；project-list 出现「全局助理」；sidecar 加载新 hook 无启动错误。
> - **待真机验证**：ASRResultFinal / LLMAgentResponseFinish 在真实通话中触发并 POST（需浏览器真实语音通话；wiring 已验证，事件实际触发待用户实测）。

1. **追加式落库通道（核心新增）**：
   - `src/session/transcript/TranscriptWriter.ts` + `JsonlTranscriptWriter.ts`：加 `recordVoiceExchange(sessionId, {userText, assistantText})`，
     合成 `accepted_input`(user) + `assistant_message`(assistant) + `turn_result`(completed) 三条 entry，复用 `recordEntry` 的 sequence/entryId 机制。
   - gateway 暴露一个轻量方法（`src/gateway/protocol/types.ts` + `InProcessGateway`）`recordExchange({sessionKey, projectKey, channelKey:'voice', userText, assistantText})`，
     按现有 `SessionRouter.getOrCreate` 拿到该 session 的 transcript writer 后调用上面的方法（**不跑模型**）。
2. **ui-server 端**：`POST /api/voice/record`（`ui/server/routes/voice.js`）→ 经 gateway 客户端调 `recordExchange`。
3. **sidecar 每轮上报**：`voice_server.py` 订阅 talker EventBus 的回合完成（`ASRResultFinal` 拿 userText、`llm_agent.response_finish` 拿 assistantText），
   每轮 POST `/api/voice/record`，projectKey=当前目标项目路径（全局→「全局助理」路径）。
   - 去重：委托轮的执行已经过 gateway 落在 `voiceSessionId` 下；为避免重复/串味，**对话流统一用一条会话**（voiceSessionId）记录"说了什么"，委托工具执行改用单独 work session（`voiceSessionId + ':work'`）跑，避免与对话记录冲突。（实现时确认这条边界。）
4. **「全局助理」保留项目**：仿 `ui/server/projects.js:232` 的 `general`，合成一个 `displayName:'全局助理'`、rooted 在专用路径（如 `<pilotHome>/global-assistant`，建 `.cwd`）的可见项目；全局对话 projectKey 指向它。

**验证**：项目里语音聊一句（不触发工具）→ 该项目会话历史出现这轮 user/assistant；委托轮也在；
全局闲聊 → 进「全局助理」项目历史；项目/会话列表能看到「全局助理」。

## 阶段 D：语音唤醒（唤醒词 / 退出 / 空闲超时 / 配置）✅ 已完成（配置走 UI-server）

> **【实现差异】**
> - **配置不走完整 pilot schema 管线**：原计划在 `src/pilot/config/{types,loadPilotConfig,parseVoiceConfig}` 加结构化 `PilotVoiceConfig`。实测网关并不消费 voice 配置（消费方是前端 + sidecar），且完整管线要动 merge/redact/store/classifyChanges 风险大。改为：`loadPilotConfig.ts` 仅把 `"voice"` 加进 allowedKeys（与 `webui` 同样“容忍但不解析”，避免 CONFIG_UNKNOWN_FIELD 噪声）；真正下发由 UI-server `GET /api/voice/settings` 读 `~/.opcbrain/opcbrain.yaml` 的 `voice:` 段并套默认值完成。
> - **退出播报用浏览器 TTS**：talker 接管 WS 后无法让它按需播任意句子；改为退出时先 `stop()` 释放麦克风，再用浏览器 `speechSynthesis` 本地播「我先退下了」，简单可靠、与 talker 解耦。
> - **唤醒词默认关闭**（`wakeEnabled:false`）：纯前端中文 KWS 走浏览器 `webkitSpeechRecognition`（Chrome/Edge、云端识别），是最实验性的一环，用户在 `opcbrain.yaml` 显式开启。
> - **麦克风互斥**：唤醒识别仅在「空闲且 wakeEnabled」时运行；通话激活时停掉（talker 独占麦克风），通话结束自动恢复；Chrome 静默自停后 onend 自动重启。
> - 验证（已部署）：`/api/voice/settings` 返回正确默认值；YAML override 合并逻辑正确；构建产物含 `webkitSpeechRecognition`/`speechSynthesis`/wake 逻辑；`voice` 已编译进 dist 的 allowedKeys；网关启动无 config 报错；ui typecheck 仅余项目既有的 React18/19 TS2786 噪声。
> - **待真机验证**：说「小智秘书」唤醒、说「退下吧」/静默 60s 退出并听到「我先退下了」——需 Chrome + 麦克风授权 + 在 yaml 里 `voice.wakeEnabled: true`。

1. **配置段**：`src/pilot/config/types.ts` 加 `PilotVoiceConfig {enabled, wakeWord, dismissWord, idleTimeoutMs, goodbyeLine, fanOutThreshold, wakeEnabled}`；
   `loadPilotConfig.ts` allowedKeys 加 `voice` + 新 `parseVoiceConfig.ts`；UI 经 `GET /api/voice/settings`（读 `readPilotDeckConfigFile().config.voice`）下发给前端。
2. **前端唤醒引擎**：`VoiceAssistantProvider` 内加常驻关键词监听——**默认用浏览器 `webkitSpeechRecognition` 持续识别**做中文唤醒词匹配（命中→`start()`）。仅页面打开+麦克风授权时运行；不可用时降级为仅 FAB。
   - 风险/取舍标注：任意中文唤醒词的纯前端 KWS 较难；Web Speech API 在 Chrome 可用但走云端识别。若要离线，再评估 Porcupine/openWakeWord(需定制词)。
3. **保持/退出生命周期**：
   - 唤醒后保持连接；会话内监听 ASR 文本命中退出词「退下吧」→ 触发优雅断开。
   - 空闲超时（无 ASR/VAD 超过 `idleTimeoutMs`，默认 60s）→ 优雅断开。
   - 断开前让 talker 播「我先退下了」（向 sidecar 发一条"说这句然后结束"的控制帧，或注入一条 system/assistant 提示），再 `stop()`，回到听唤醒词。
4. FAB/语音区同步"将退下/已退下"状态。

**验证**：说「小智秘书」→ 自动连线进入对话；说「退下吧」→ 听到「我先退下了」后断开；静默 60s → 同样优雅断开；
唤醒词/超时/告别语改 opcbrain.yaml 生效；关闭唤醒开关后仅 FAB 可用。

---

## 主要改动文件一览

| 区域 | 文件 | 动作 |
|---|---|---|
| 前端·Provider | `ui/src/contexts/VoiceAssistantContext.tsx` | ✅ 新增（全局会话/状态/目标） |
| 前端·FAB | `ui/src/components/voice/VoiceFab.tsx` | ✅ 新增后**删除**（改用边栏大麦克风按钮） |
| 前端·语音区 | `ui/src/components/voice/VoiceConversationZone.tsx` | ✅ 新增（折叠=大按钮 / 展开=对话区） |
| 前端·边栏 | `main-content-v2/home/SystemStatusPanel.tsx` | ✅ 改（flex-col + 状态底对齐 + 顶部嵌语音区 + 删旧快捷操作） |
| 前端·左栏 | `main-content-v2/home/HomeSidebar.tsx` | ✅ 改（隐藏「最近项目」+ 底部「快捷操作」） |
| 前端·挂载 | `app-shell/AppShellV2.tsx` | ✅ 改（包 Provider；FAB 已移除） |
| 前端·壳组合 | `main-content-v2/home/HomeChrome.tsx` | ✅ 改（HomeSidebar/SystemStatusPanel props 同步） |
| 前端·旧入口 | `ui/server/routes/voice.js`（login 允许空 project）/ 旧 `VoicePanel.tsx` | ✅ 删除旧 voice tab 与 VoicePanel |
| sidecar | `docker/talker-voice/opcbrain_tool.py` | 改（project 参数 + 名称解析） |
| sidecar | `docker/talker-voice/voice_server.py` | 改（项目清单注入 + set_target 控制帧 + 每轮 record 上报 + 退出播报） |
| ui-server | `ui/server/routes/voice.js` | 改（project-list / settings / record 端点） |
| ui-server | `ui/server/index.js` | 改（/voice-ws 控制帧透传已支持；record 走 gateway 客户端） |
| ui-server | `ui/server/projects.js` | 改（合成「全局助理」保留项目） |
| 网关·落库 | `src/session/transcript/{TranscriptWriter,JsonlTranscriptWriter}.ts` | 改（recordVoiceExchange） |
| 网关·接口 | `src/gateway/protocol/types.ts` + `InProcessGateway` | 改（recordExchange 方法） |
| 配置 | `src/pilot/config/{types.ts,loadPilotConfig.ts,parseVoiceConfig.ts}` | 改/新增（voice 段） |

## 端到端验证（全部完成后）

1. 阶段 A/B/C/D 各自的验证点（见上）。
2. 回归：文字聊天、`/health`、之前的语音委托链路（合成语音注入或浏览器实测）仍正常。
3. 历史一致性：项目里语音对话与文字对话在同一会话历史体系可见、可回溯；全局对话在「全局助理」。
4. docker：`docker compose up -d --build`（sidecar 已 bind-mount，改 py/config 仅需 `restart talker-voice`；前端/网关改动需重建 opcbrain 镜像）。

## 建议落地顺序
A（看得见的全局壳，价值最高、风险低）→ C（历史同步，体验关键）→ B（跨项目编排）→ D（唤醒词，风险最高放最后）。每阶段独立可测、可单独提交。
