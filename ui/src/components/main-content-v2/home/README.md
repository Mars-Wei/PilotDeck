# OPC Brain 首页控制台开发方案

> 本方案描述如何将 `ui-demo.html` 的首页设计对接到 PilotDeck 现有代码中。
> 版本：v2（修正版）
> 日期：2026-06-05

---

## 一、总体策略

**在现有 AppShellV2 内部恢复 `home` tab，前端组合现有 hooks 做 MVP，后端聚合 API 后置。**

核心原则：
1. **不新增独立路由** — `/` 仍由 AppShellV2 承载，内部渲染 home 内容
2. **不复用数据不准确** — "今日成本"第一版改为"近期成本"，等后端聚合 API 后再精确
3. **不破坏现有导航** — `handleProjectSelect` 仍跳 `/p/:projectName`，home 是独立状态
4. **不直连高危工具** — 快捷工具点击后预填 prompt 进入会话，由 Agent 走权限系统

---

## 二、架构决策

### 2.1 路由语义

```tsx
// App.tsx 不变
<Route path="*" element={<AppShellV2 />} />

// AppShellV2 内部路由映射：
//   /                         → activeTab = 'home'（新首页）
//   /p/:projectName           → activeTab = 'chat'（项目页）
//   /p/:projectName/c/:id     → activeTab = 'chat'（会话页）
//   /session/:id              → activeTab = 'chat'（遗留会话）
```

**关键修正**：不是新增独立 `/` 路由，而是在 `AppShellV2` 内部判断 `!projectNameParam && !sessionId` 时渲染首页。

### 2.2 Home Tab 恢复（不是新增）

`types/app.ts` 中已有 `'home'`，现有代码主动把它压回 `chat`，需要恢复：

| 文件 | 行号 | 修改 |
|------|------|------|
| `MainAreaV2.tsx` | ~65 | 删除 `activeTab === 'home'` 强制转 `chat` |
| `AppShellV2.tsx` | ~503 | `handleSelectTab` 中 home 分支设置 `setActiveTab('home')` |
| `useProjectsState.ts` | ~226 | 检查并移除 home→chat 的持久化映射 |
| `MainContent.tsx` | ~323 | `!selectedProject` 判断增加 `&& activeTab !== 'home'` |

### 2.3 项目选择导航

```tsx
// useProjectsState.ts ~line 488
// 保持现有行为：handleProjectSelect 后 navigate(`/p/${project.name}`)
// 这是对的，/p/:name 是项目页

// AppShellV2 默认项目选择也保持：
// 无 URL hint 时自动选 general → navigate(`/p/general`) → chat tab
```

### 2.4 /p/:projectName 首页行为（第一版保留为 chat）

| 方案 | 说明 | 第一版 |
|------|------|--------|
| A. 保留为 chat | 点击项目直接进空会话（现有行为） | ✅ 选这个 |
| B. 项目首页 | /p/:name 默认显示项目概览 | 后续版本 |

---

## 三、文件组织

```
ui/src/components/main-content-v2/
  home/
    HomeConsoleV2.tsx          # 首页主容器
    WelcomeSection.tsx         # 欢迎条 + 快捷按钮 + 输入框
    TodaySummary.tsx           # 今日摘要 4 张卡片
    ContinueWork.tsx           # 继续工作 3 张卡片
    ProjectsOverview.tsx       # 项目概览网格
    ActivityTimeline.tsx       # 今日动态时间线
    QuickTools.tsx             # 快捷工具栏
  SystemStatusPanel.tsx        # 右侧系统状态面板（可与首页共用）

ui/src/hooks/
  useHomeDashboardData.ts      # 聚合首页数据（前端组合现有 hooks）
```

---

## 四、Phase 1：前端真实首页 MVP（3-4 天）

**原则：不新增后端 API，纯前端组合现有数据。**

### 4.1 HomeConsoleV2.tsx 结构

```tsx
function HomeConsoleV2() {
  const { projects, isLoading } = useProjectsStateContext();
  const { data: routingData } = useRoutingDashboard();
  const { events: alwaysOnEvents } = useAlwaysOnEvents();
  const unreadCount = unreadSessionIds.size;
  const { isConnected } = useWebSocket();

  if (isLoading) return <HomeSkeleton />;

  return (
    <div className="flex h-full bg-surface-50 dark:bg-surface-950">
      {/* 中间主内容 */}
      <main className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <WelcomeSection />
          <TodaySummary />
          <ContinueWork />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ProjectsOverview className="lg:col-span-2" />
            <ActivityTimeline />
          </div>
          <QuickTools />
        </div>
      </main>

      {/* 右侧系统状态（桌面端） */}
      <aside className="hidden xl:block w-64 flex-shrink-0">
        <SystemStatusPanel />
      </aside>
    </div>
  );
}
```

### 4.2 各组件数据对接

#### WelcomeSection

| 元素 | 数据来源 | 实现 |
|------|----------|------|
| "下午好，Mars" | `api.auth.user()` → username | 根据时间显示上午/下午/晚上 |
| 新建会话按钮 | `handleNewSession(selectedProject)` | 点击跳转 `/p/:name` 并新建会话 |
| 打开项目按钮 | 打开项目选择弹窗 | 复用现有逻辑 |
| 新建任务按钮 | 跳转 Always-On tab | `setActiveTab('always-on')` |
| 导入文档按钮 | 打开文件上传 | 调用 `api.uploadFiles()` |
| 快捷输入框 | Enter → 创建会话并发送 | `handleNewSession` + 发送首条消息 |

#### TodaySummary（4 张卡片）

**卡片 1：近期成本**

```tsx
// 数据：useRoutingDashboard().data.overall.total
// 文案："近期成本"（不是"今日"，避免口径错误）
const cost = routingData?.overall?.total?.estimatedCost ?? 0;
const baseline = routingData?.overall?.total?.baselineCost ?? 0;
const saved = routingData?.overall?.total?.savedCost ?? 0;

// 显示：$7.80 / 近期
//       ↓ 节省 $3.20 对比不分路由
//       本周累计 $41.20  ← 前端估算（total * 7）或隐藏
```

**卡片 2：任务状态**

```tsx
// 数据：前端聚合
//   - TaskMaster: projects[].taskmaster
//   - Always-On: alwaysOnEvents 中 running 的
//   - Cron: api.allCronJobs() 中 running 的

const taskStats = useMemo(() => {
  // 第一版可简化：只显示静态文案或从 projects 推断
  // 精确数据等 /api/home/summary 后再接入
  return { completed: 0, running: 0, failed: 0, total: 0 };
}, [projects, alwaysOnEvents]);
```

**卡片 3：新消息**

```tsx
// 数据：unreadSessionIds（Set<string>）
const unreadCount = unreadSessionIds.size;
const unreadSessions = [...unreadSessionIds]; // 取 sessionId 数组

// 从 projects[].sessions 反查 session 信息
// 显示：5 条新消息 / 来自 3 个会话 / 含 1 条 @提及
```

**卡片 4：需关注**

```tsx
// 数据：前端规则检测
const alerts = useMemo(() => {
  const result = [];
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      // 规则：lastActivity 超过 2 小时且状态异常
      // 第一版可简化，显示固定文案或隐藏此卡
    }
  }
  return result;
}, [projects]);
```

#### ContinueWork（3 张卡片）

**卡片 1：活跃会话**

```tsx
// 数据：projects[].sessions 按 lastActivity 排序取最近
// 状态判断：processingSessions.has(session.id) → "直播中"
const activeSessions = useMemo(() => {
  return projects
    .flatMap(p => p.sessions ?? [])
    .filter(s => processingSessions.has(s.id))
    .sort((a, b) => /* by lastActivity */)
    .slice(0, 3);
}, [projects, processingSessions]);
```

**卡片 2：后台任务**

```tsx
// 数据：api.alwaysOnDashboardEvents() 中 running 的事件
// 进度：第一版可显示静态进度条或省略
```

**卡片 3：未读消息**

```tsx
// 数据：unreadSessionIds 对应的会话
// 从 projects 反查 session 标题
```

#### ProjectsOverview

```tsx
// 数据：projects 数组（来自 useProjectsState）
// 显示：项目名称、会话数、最近活动时间、图标
// 点击：navigate(`/p/${project.name}`)
// 新建项目：调用现有 ProjectCreationWizard
```

#### ActivityTimeline

```tsx
// 数据：前端聚合（第一版）
//   - projects[].sessions 的最近活动
//   - alwaysOnEvents 的任务完成事件
//   - routingData 的成本节省（按天聚合）

// 后续有 /api/home/activity 后替换
```

#### QuickTools

| 工具 | 点击行为 | 实现 |
|------|----------|------|
| 写代码 | 新建会话 + 预填 prompt "帮我写一段代码..." | `handleNewSession` + 发送消息 |
| 搜索代码 | 新建会话 + 预填 "搜索代码库中..." | 同上 |
| 抓取网页 | 新建会话 + 预填 "帮我抓取网页..." | 同上 |
| 生成 PPT | 新建会话 + 预填 "帮我生成一份PPT..." | 同上 |
| 清理文件 | 新建会话 + 预填 "帮我清理项目中的临时文件" | 同上（走 Agent 权限） |
| 运行测试 | 新建会话 + 预填 "运行测试套件" | 同上 |
| 写文档 | 新建会话 + 预填 "帮我写技术文档" | 同上 |
| 生成图片 | 暂不支持 | 显示 "即将支持" tooltip |

### 4.3 右侧系统状态面板（SystemStatusPanel）

```tsx
// 数据：
//   - 网关在线：useWebSocket().isConnected
//   - MCP：第一版显示 "检查中"，后续调 /api/home/status
//   - 记忆：第一版显示 "正常"，后续调 /api/home/status

//   - 今日成本：useRoutingDashboard().overall.total.estimatedCost
//   - 路由分布：useRoutingDashboard().overall.byTier
```

---

## 五、Phase 2：路由与 Shell 清理（0.5-1 天）

### 5.1 修改清单

```tsx
// 1. MainAreaV2.tsx — 恢复 home tab
const TABS: Tab[] = [
  { id: 'home',      labelKey: 'tabs.home',      icon: Home },      // ← 新增
  { id: 'chat',      labelKey: 'tabs.chat',      icon: Bot },
  { id: 'files',     labelKey: 'tabs.files',     icon: Folder },
  { id: 'skills',    labelKey: 'tabs.skills',    icon: Sparkles },
  { id: 'dashboard', labelKey: 'tabs.dashboard', icon: BarChart3 },
  { id: 'memory',    labelKey: 'tabs.memory',    icon: Database },
  { id: 'always-on', labelKey: 'tabs.alwaysOn',  icon: Radio },
];

// 删除（或注释）home→chat 强制转换
// useEffect(() => {
//   if (activeTab === 'home') { setActiveTab('chat'); }
// }, [activeTab, setActiveTab]);
```

```tsx
// 2. AppShellV2.tsx — handleSelectTab 恢复 home
const handleSelectTab = useCallback((tab: AppTab) => {
  if (tab === 'home') {
    setSelectedSession(null);
    setSelectedProject(null);      // ← 清除项目选择
    navigate('/');
    setActiveTab('home');          // ← 不是 'chat'
    return;
  }
  // ... 其余不变
}, [...]);
```

```tsx
// 3. AppShellV2.tsx — 默认路由处理
// 当 !projectNameParam && !sessionId 时：
//   现有：选 general 项目 → /p/general → chat
//   新：保持 selectedProject = null → MainContent 渲染 HomeConsoleV2

// 修改默认项目选择逻辑：
const didDefaultProjectRef = useRef(false);
useEffect(() => {
  if (didDefaultProjectRef.current) return;
  if (isLoadingProjects) return;
  if (projectNameParam || sessionId) {
    didDefaultProjectRef.current = true;
    return;
  }
  // 不再自动选 general，让首页自然展示
  didDefaultProjectRef.current = true;
}, [isLoadingProjects, projectNameParam, sessionId]);
```

```tsx
// 4. MainContent.tsx — 允许 home tab 无项目
// 原：if (!selectedProject && activeTab !== 'dashboard') return <EmptyState />
// 改：if (!selectedProject && activeTab !== 'dashboard' && activeTab !== 'home') return <EmptyState />
```

```tsx
// 5. MainContent.tsx — SplitBody 中增加 home case
function SplitBody(props: SplitBodyProps) {
  const { activeTab, ... } = props;
  // ...
  if (activeTab === 'home') return <HomeConsoleV2 />;
  // ... 其余 tab 不变
}
```

### 5.2 Tab 栏最终效果

```
[🏠 首页] [💬 会话] [📁 文件] [✨ Skills] [📊 Dashboard] [🧠 记忆] [📡 Always-On]
   ↑ 新增（恢复）

点击"首页"：
  → setSelectedProject(null)
  → setSelectedSession(null)
  → navigate('/')
  → activeTab = 'home'
  → MainContent 渲染 HomeConsoleV2
```

---

## 六、Phase 3：后端聚合 API（后置，1.5-3 天）

**触发条件**：Phase 1 发现前端请求太散、性能差，或需要精确时间口径时再做。

### 6.1 GET /api/home/summary

```typescript
interface HomeSummaryResponse {
  cost: {
    todayAmount: number;      // 按日期过滤 requestLog
    todaySaved: number;
    weekTotal: number;
  };
  tasks: {
    completed: number;
    running: number;
    failed: number;
  };
  messages: {
    unread: number;
    unreadSessions: number;
    mentions: number;
  };
  alerts: Array<{
    type: 'unresponsive' | 'error' | 'warning';
    title: string;
    description: string;
    sessionId?: string;
    duration?: string;
  }>;
}

// 聚合数据源：
//   - CCR routing stats（按日期过滤）
//   - TaskMaster 任务状态
//   - Always-On 运行状态
//   - Cron Jobs 状态
//   - 会话活跃状态（检测无响应）
```

### 6.2 GET /api/home/activity

```typescript
interface HomeActivityResponse {
  events: Array<{
    id: string;
    type: 'chat' | 'task_complete' | 'cost_saved' | 'memory_update';
    projectName: string;
    projectDisplayName?: string;
    title: string;           // "官网重构 中完成 3 轮对话"
    detail?: string;         // "09:23"
    timestamp: string;
  }>;
}

// 聚合数据源：
//   - 会话 transcript 元数据
//   - Always-On dashboard events
//   - 记忆更新记录
//   - 成本节省事件
```

### 6.3 GET /api/home/status

```typescript
interface HomeStatusResponse {
  gateway: { status: 'online' | 'offline'; latency?: number };
  mcp: { status: 'online' | 'degraded' | 'offline'; connected: number; total: number };
  memory: { status: 'online' | 'offline'; recordCount?: number };
}

// 聚合现有端点：
//   - GET /health → gateway
//   - GET /api/mcp-utils/all-servers → MCP
//   - GET /api/memory/overview → 记忆
```

---

## 七、Phase 4：增强体验（后置）

| 功能 | 说明 | 依赖 |
|------|------|------|
| 全局 Command Palette | Cmd+K 聚合项目、会话、skills、命令搜索 | 前端独立实现 |
| 通知中心下拉 | Bell 图标下拉面板，显示未读消息列表 | `unreadSessionIds` |
| 用户菜单下拉 | 头像下拉（设置/退出） | `api.auth.user()` |
| 快捷工具编辑 | 拖拽增删工具按钮 | 前端独立实现 |
| 生成图片 | 新增 image generation provider | 后端新增 provider |
| 精确时间口径 | "今日/本周"数据 | `/api/home/summary` |
| 异常检测 | 智能检测需关注项 | `/api/home/summary` + 规则引擎 |

---

## 八、样式规范（从 demo 提取）

### Tailwind 配置扩展

```js
// tailwind.config.js 或 inline config
theme: {
  extend: {
    colors: {
      brand: {
        50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd',
        300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9',
        600: '#0284c7', 700: '#0369a1', 800: '#075985',
        900: '#0c4a6e', 950: '#082f49',
      },
      surface: {
        0: '#ffffff', 50: '#fafafa', 100: '#f5f5f5',
        200: '#e5e5e5', 300: '#d4d4d4',
        800: '#262626', 900: '#171717', 950: '#0a0a0a',
      },
    },
  },
}
```

### 常用样式模式

```css
/* 卡片悬停 */
.card-hover {
  transition: all 0.2s ease;
}
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px -8px rgba(0,0,0,0.12);
}

/* 欢迎条渐变 */
.gradient-welcome {
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #faf5ff 100%);
}
.dark .gradient-welcome {
  background: linear-gradient(135deg, #082f49 0%, #0c4a6e 50%, #1e1b4b 100%);
}

/* 渐入动画 */
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 隐藏滚动条 */
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
```

### 颜色语义

| 场景 | Light | Dark |
|------|-------|------|
| 页面背景 | `bg-surface-50` | `dark:bg-surface-950` |
| 卡片背景 | `bg-white` | `dark:bg-surface-900` |
| 边框 | `border-surface-200` | `dark:border-surface-800` |
| 主文本 | `text-surface-900` | `dark:text-surface-100` |
| 次要文本 | `text-surface-500` | `dark:text-surface-400` |
| Brand 主色 | `text-brand-600` | `dark:text-brand-400` |
| 成功 | `text-emerald-600` | `dark:text-emerald-400` |
| 警告 | `text-amber-600` | `dark:text-amber-400` |
| 危险 | `text-red-600` | `dark:text-red-400` |

---

## 九、工作量估算

| 阶段 | 内容 | 前端 | 后端 | 合计 |
|------|------|------|------|------|
| Phase 1 | HomeConsoleV2 + 6 子组件 + hook | 3-4d | 0 | **3-4d** |
| Phase 2 | 恢复 home tab + 路由修正 | 0.5-1d | 0 | **0.5-1d** |
| 测试打磨 | 响应式、暗色、空态、错误 | 1d | 0 | **1d** |
| **MVP 小计** | | **~5d** | **0** | **~5d** |
| Phase 3 | /api/home/* 聚合 API | 0.5d | 1.5-3d | **2-3.5d** |
| Phase 4 | Command Palette、通知中心等 | 2-3d | 0 | **2-3d** |
| **总计** | | **~8d** | **~3d** | **~11d** |

---

## 十、第一版 MVP 目标

**让首页看起来像 demo，并接上真实数据：**

- [x] 三栏布局（sidebar + home content + right panel）
- [x] WelcomeSection（真实用户名、4 个快捷按钮、快捷输入框）
- [x] TodaySummary 4 张卡片（近期成本、任务状态、新消息、需关注）
- [x] ContinueWork 3 张卡片（活跃会话、后台任务、未读消息）
- [x] ProjectsOverview（真实项目网格，4 列）
- [x] ActivityTimeline（前端聚合时间线）
- [x] QuickTools（8 个按钮，点击预填 prompt 进入会话）
- [x] SystemStatusPanel（网关状态、近期成本、路由分布）
- [x] 暗色模式支持
- [x] 响应式布局（sm/md/lg/xl 断点）
- [x] 卡片 hover 动画

**后置到后续版本：**

- [x] "今日/本周"精确时间口径（`/api/home/summary` 按 router requestLog 聚合）
- [x] 后端聚合 API（`/api/home/summary`、`/api/home/activity`、`/api/home/status`）
- [x] 全局 Command Palette 搜索
- [x] 通知中心下拉面板
- [x] 用户菜单下拉
- [x] 快捷工具编辑/拖拽
- [ ] 生成图片支持（需新增 image generation provider / tool）
- [ ] 智能异常检测规则引擎（当前仅覆盖 Always-On / Cron / TaskMaster 的失败态）

---

## 十一、常见问题

### Q1: 为什么第一版不直接叫"今日成本"？

`useRoutingDashboard` 的数据是 CCR 系统累积的所有路由统计，不是按天过滤的。如果卡片写"今日"但实际是全部历史，数据口径就错了。第一版写"近期"是准确的，等 `/api/home/summary` 提供按日过滤后再改回"今日"。

### Q2: 为什么快捷工具不直接调用 bash？

"清理文件"属于高危操作，直接调用可能误删。正确做法是：点击后新建会话并预填 prompt（如"帮我清理项目中的临时文件"），由 Agent 理解意图、走权限系统、用户确认后再执行。

### Q3: 右侧系统状态面板 MCP/记忆显示"检查中"会不会太简陋？

第一版确实简陋，但功能正确。等 `/api/home/status` 做好后自动替换为真实状态，过渡平滑。

### Q4: ActivityTimeline 前端聚合会不会数据不全？

会。第一版时间线只能从 `projects[].sessions` 和 Always-On events 中聚合，可能不够丰富。但结构是对的，等 `/api/home/activity` 接入后数据自然丰富起来。

### Q5: 这个方案和直接重写前端有什么区别？

这个方案复用了现有 80%+ 的代码（AppShell、Sidebar、Chat、API、WebSocket、认证、路由等），只新增一个首页组件。直接重写意味着放弃现有 `AppShellV2`、`useProjectsState`、`ChatInterfaceV2` 等大量已验证代码，风险极高。

---

## 十二、参考文件

| 文件 | 说明 |
|------|------|
| `ui-demo.html` | 设计原型 |
| `ui/src/components/app-shell/AppShellV2.tsx` | 主壳 |
| `ui/src/components/app-shell/MainAreaV2.tsx` | 主区域 + tab 栏 |
| `ui/src/components/main-content/view/MainContent.tsx` | 内容渲染 |
| `ui/src/hooks/useProjectsState.ts` | 项目状态管理 |
| `ui/src/hooks/useRoutingDashboard.ts` | 路由成本数据 |
| `ui/src/contexts/WebSocketContext.tsx` | WebSocket |
| `ui/src/utils/api.js` | API 层 |
| `ui/src/types/app.ts` | 类型定义 |

---

## 十三、当前进度核查（2026-06-06）

### 总体结论

当前开发进度处于 **Phase 3B 已完成，Phase 4 前端增强基本完成** 的状态。

Phase 1 和 Phase 2 的主体已经落地；同时因为首页首屏慢，已经做了一部分性能优化（按需加载重组件、首页不隐藏挂载 Chat、延后统计请求），这正好对应 Phase 3 的触发条件：前端请求与首屏负载开始影响体验，需要进入后端聚合 API 阶段。

### Phase 1：前端真实首页 MVP

状态：**基本完成**

已完成：

- 三栏布局：`HomeChrome` + `HomeSidebar` + `HomeConsoleV2` + `SystemStatusPanel`
- 首页主内容组件：`WelcomeSection`、`TodaySummary`、`ContinueWork`、`ProjectsOverview`、`ActivityTimeline`、`QuickTools`
- 首页数据聚合 hook：`useHomeDashboardData`
- 路由成本接入：复用 `useRoutingDashboard`
- 未读消息、活跃会话、Always-On 事件前端聚合
- 快捷输入框：创建会话并通过 `pilotdeck-home-pending-prompt` / `pilotdeck-home-prompt` 送入会话
- 暗色模式、响应式、hover 动画已覆盖
- 首屏性能优化：非首页重组件 lazy load，首页不再挂载隐藏 Chat

与初版方案不完全一致但符合后续需求的点：

- 欢迎语用户名已按产品要求固定为“老板”，不再读取 `api.auth.user()` 的 username
- QuickTools 当前是 8 个工具，其中“生成图片”为禁用的“即将支持”状态，因为后端 image generation provider 尚不存在
- “导入文档”当前进入 Files tab，还不是直接打开文件上传弹窗
- `ContinueWork` 当前展示最近/运行中/未读会话卡片，不是严格拆成“活跃会话、后台任务、未读消息”三类固定卡

### Phase 2：路由与 Shell 清理

状态：**完成**

已完成：

- `/` 显示首页，不再自动跳入 general 项目
- `home` tab 状态恢复，`handleSelectTab('home')` 会清空项目和会话并回到 `/`
- `MainContent` 允许 `activeTab === 'home'` 时没有 `selectedProject`
- 首页路径不等待项目加载完成即可先渲染
- 其它页面仍通过现有 AppShellV2 / MainContent 渲染，并保持新首页布局外壳
- 顶部旧 tab 已移除，当前使用左侧功能导航 + 顶部全局栏

已额外完成：

- 设置页、新建项目向导、Chat、Files、Editor、Dashboard、Shell、Always-On、Tasks、Skills、Memory、Plugin 页面均已改为按需加载
- 首页首屏主入口包从约 2.2MB 降到约 458KB

### Phase 3：后端聚合 API

状态：**Phase 3B 已完成**

已完成：

- `GET /api/home/status`
  - 新增 `ui/server/routes/home.js`
  - 在 `ui/server/index.js` 挂载 `/api/home`
  - 前端新增 `useHomeStatus`
  - `SystemStatusPanel` 已接入真实 MCP / memory 状态，失败时保留旧兜底
- `GET /api/home/activity`
  - 后端聚合最近会话活动、Always-On 事件和路由成本事件
  - 前端 `useHomeDashboardData` 已优先使用该接口，失败时回退旧前端聚合
- `GET /api/home/summary`
  - 后端聚合近期成本、今日成本、本周成本、Always-On / Cron / TaskMaster 任务状态、异常告警
  - 前端摘要卡和右侧成本面板已优先使用该接口，路由成本仍保留 `useRoutingDashboard` 兜底

尚未实现：

- 更复杂的异常检测规则引擎（如会话长时间无响应、成本异常波动、MCP 单服务降级原因细分）

当前首页仍保留这些前端实时数据源：

- `GET /api/projects`
- `GET /api/ccr/dashboard`
- WebSocket 未读与运行态

因此当前仍存在这些限制：

- ActivityTimeline 已包含 memory update 事件，但依赖已有 memory entry；没有记忆数据时不会显示该类事件
- 异常检测目前覆盖 Always-On / Cron / TaskMaster 失败态，未形成规则引擎
- 今日/本周成本依赖 router `requestLog`，无请求时前端会自动回退为“近期”文案

### Phase 4：增强体验

状态：**前端增强基本完成**

已完成：

- 通知中心下拉：顶部 Bell 可展示未读会话并点击进入
- 用户菜单下拉：右上角头像可打开设置或退出/重置本地会话
- 全局 Command Palette：`Cmd/Ctrl+K` 聚合项目、会话、未读会话、常用页面和设置入口
- 快捷工具编辑：支持拖拽排序、左右移动、隐藏/恢复、恢复默认
- 精确时间口径 UI：今日有请求时显示“今日成本 / 本周累计”，无今日数据时自动回退“近期成本”

未完成项：

- 生成图片支持
- 智能异常检测规则引擎

---

## 十四、下一步开发安排

### 推荐下一阶段：Phase 3C（活动与异常增强）

目标：在已经落地的聚合 API 基础上，补齐更可靠的异常检测规则。

#### Step 1：新增 `GET /api/home/status`

优先级：最高
工作量：小
目的：替换右侧 `SystemStatusPanel` 中 MCP / 记忆的静态或半静态状态。

状态：**已完成**

实现建议：

- 新建 `ui/server/routes/home.js`
- 在 `ui/server/index.js` 中挂载：`app.use('/api/home', authenticateToken, homeRoutes)`
- 聚合：
  - gateway：本服务在线即 `online`
  - MCP：复用或封装 `mcp-utils` 当前读取逻辑
  - memory：复用 `routes/memory.js` 或 `memoryService` 能力，先返回可用/不可用即可

#### Step 2：新增 `GET /api/home/activity`

优先级：高
工作量：中
目的：让首页动态时间线从后端统一产出，减少前端猜测。

状态：**已完成**

第一版聚合：

- 最近项目会话活动：来自 `getProjects()` / sessions 元数据
- Always-On 事件：来自 `getAlwaysOnDashboardEvents({ limit })`
- 后续再补 memory update / cost saved 事件

#### Step 3：新增 `GET /api/home/summary`

优先级：高
工作量：中
目的：统一首页 4 张摘要卡的数据口径。

第一版字段：

- `cost.recentAmount` / `cost.recentSaved`
- `tasks.completed` / `tasks.running` / `tasks.failed`
- `messages.unread` / `messages.unreadSessions`（前端仍可传入或前端合并）
- `alerts[]`

状态：**已完成**

第二版状态：

- 按当天过滤 router request log，产出 `todayAmount` / `todaySaved`：**已完成**
- 汇总 Cron Jobs / TaskMaster 状态：**已完成**

#### Step 4：前端接入新的 home API

优先级：高
工作量：中
目的：让 `useHomeDashboardData` 从“纯前端聚合”升级为“后端聚合优先，前端兜底”。

建议策略：

- 新增 `useHomeSummary`、`useHomeActivity`、`useHomeStatus`
- 保留当前 `useHomeDashboardData` 的前端聚合作为 fallback
- 首页首屏仍延迟请求聚合 API，避免再次拖慢首次渲染

状态：**已完成**

### Phase 3 完成验收标准

- 首页只有一个或少量 `/api/home/*` 请求承担聚合数据
- 右侧系统状态不再显示硬编码 MCP `2/3`
- “今日/本周”成本口径可以准确展示，或明确保留“近期”文案
- ActivityTimeline 至少包含会话活动 + Always-On 活动
- 首页首屏构建体积不回退，`npm run build` 通过

### Phase 4 启动条件

Phase 4 已启动并完成主要前端增强。当前状态：

1. 通知中心下拉（已完成）
2. 用户菜单下拉（已完成）
3. 全局 Command Palette（已完成）
4. 快捷工具编辑（已完成）
5. 生成图片支持（未完成，需新增后端 provider / tool）
