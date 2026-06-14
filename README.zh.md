

## 💡 关于 OPC Brain
当我们把视角从"单次编程"或"即时问答"切换到**长周期、多项目并行的生产力创作**时，仍有一些尚未被很好回答的问题：

- 多项目并行时，记忆能否做到 **白盒可追溯**？AI 记错了，能否定位到哪条记忆出错、直接修改，而不必重开会话？
- Token 成本能否 **按任务分项追踪**？让后台常驻推进变得经济可行？
- 不同难度的任务，能否 **自动匹配不同模型**？而不是简单任务也跑最贵的旗舰模型？
- 人离开电脑后，活能否继续推进？Agent 能否 **主动发现值得做的事、汇报进展、把成果落地为文件**？

OPC Brain 正是围绕这些问题做的增量探索。它以 WorkSpace 为基本单位，将文件、记忆、技能在项目级别完整隔离与沉淀，并配套提供 **白盒记忆**、**智能路由**、**Always-on** 三大能力，整套系统原生支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，跨前端（Web / CLI / IM）行为一致。

### ✨ 核心亮点

<table width="100%">
<tr>
<td width="50%" valign="top">

**WorkSpace 级隔离与沉淀**

每个项目拥有独立的专属文件系统、记忆库与技能集。多任务并行互不干扰，检索空间有边界，技能随任务自动沉淀，告别全局上下文污染。

<p align="center">
  <img src="assets/workspace_en.gif" width="100%" alt="WorkSpace 级隔离与沉淀演示"/>
</p>

</td>
<td width="50%" valign="top">

**可追溯的白盒记忆**

记忆的生成、抽取、存储与使用全链路可见。AI 记错时可直接定位并手动修改。内置 **Dream 模式**，利用空闲时间自动归纳整理，并支持一键回滚。

<p align="center">
  <img src="assets/memory.gif" width="100%" alt="白盒记忆演示"/>
</p>

</td>
</tr>
<tr>
<td width="50%" valign="top">

**智能路由与成本优化**

内置任务难度识别，复杂任务调用强力模型（如 Claude 3.5 Sonnet / GPT-4o），简单任务降级至轻量模型。通过端云协同与精准匹配，大幅降低 Token 消耗。

<p align="center">
  <img src="assets/router.gif" width="100%" alt="智能路由演示"/>
</p>

</td>
<td width="50%" valign="top">

**Always-on 常驻执行**

突破"你问我答"的限制。用户离开后，Agent 仍能在后台主动发现潜在任务、执行长周期监控、并最终将成果落地为本地文件与摘要汇报。

<p align="center">
  <img src="assets/awo.gif" width="100%" alt="Always-on 常驻执行演示"/>
</p>

</td>
</tr>
</table>

### 📊 核心能力实测数据

OPC Brain 的三大核心能力在实际生产环境中展现出了显著的优势：

#### 1. 智能路由：社媒场景节省 ～70% 成本

在小红书等社媒运营场景中，开启智能路由后，系统会自动将简单的文本润色、排版任务降级给子 Agent（如 Sonnet 4.5），仅在核心规划节点使用 Opus 4.5，实测成本大幅下降：

<table width="100%">
<tr>
<th width="22%" align="left">方案</th>
<th width="48%" align="left">模型编排</th>
<th width="15%" align="left">费用</th>
<th width="15%" align="left">倍率</th>
</tr>
<tr>
<td><b>开启省钱路由</b></td>
<td>主 Opus 4.5 + 子 Sonnet 4.5</td>
<td><b>$2.83</b></td>
<td><b>1.1×</b></td>
</tr>
<tr>
<td>不开省钱路由</td>
<td>全 Opus 4.5（主 + 子）</td>
<td>$12.58</td>
<td>5.0×</td>
</tr>
<tr>
<td>单体大模型</td>
<td>单体 Opus 4.5 长 react（预估）</td>
<td>$12.20</td>
<td>4.8×</td>
</tr>
<tr>
<td colspan="4"><img width="840" height="1" alt=""/></td>
</tr>
</table>

#### 2. 智能路由：复杂任务 1/6 成本超越顶级模型

研究团队在播客多语言推送、多源数据报告、领域论文综述、代码库架构文档等 7 个复杂任务上进行了对比测试。结果表明，采用"主强子弱"的路由编排，能以极低的成本达到最优效果：

<table width="100%">
<tr>
<th width="70%" align="left">配置</th>
<th width="15%" align="left">得分</th>
<th width="15%" align="left">成本</th>
</tr>
<tr>
<td>MiniMax-M2.7 单 Agent</td>
<td>37.1</td>
<td>$1.90</td>
</tr>
<tr>
<td>Claude Sonnet 4.6 单 Agent</td>
<td>69.1</td>
<td>$18.36</td>
</tr>
<tr>
<td><b>主 Sonnet 4.6 + 子 MiniMax-M2.7</b></td>
<td><b>70.6</b></td>
<td><b>$3.15</b></td>
</tr>
<tr>
<td colspan="3"><img width="840" height="1" alt=""/></td>
</tr>
</table>

#### 3. 白盒记忆：排版与文风不再"串台"

在传统的黑盒 Agent 中，多任务混居会导致记忆全局污染。OPC Brain 通过 WorkSpace 实现了记忆的白盒化管理：

<table width="100%">
<thead>
<tr>
  <th width="14%" align="left">维度</th>
  <th width="41%" align="left">现有 AI Agent（黑盒）</th>
  <th width="45%" align="left">OPC Brain（白盒）</th>
</tr>
</thead>
<tbody>
<tr>
  <td><b>可见性</b></td>
  <td>看不到 AI 记住了什么，只能看到最终输出</td>
  <td>随时查看记住了哪些内容、何时记录、属于哪个 WorkSpace</td>
</tr>
<tr>
  <td><b>可控性</b></td>
  <td>写入后无法修改、删除，只能等 AI 自己"想明白"</td>
  <td>手动改 / 删 / 标记关键节点，重要决策不丢失</td>
</tr>
<tr>
  <td><b>可追溯</b></td>
  <td>出错时无法定位根本原因</td>
  <td>生成 → 抽取 → 存储 → 使用，每个环节可查可改</td>
</tr>
<tr>
  <td><b>隔离性</b></td>
  <td>共享一个记忆池，跨项目互相污染</td>
  <td>按 WorkSpace 隔离，A 项目的记忆不会跑到 B 项目</td>
</tr>
<tr>
  <td><b>可回滚</b></td>
  <td>上下文压缩后无法查看原始内容</td>
  <td>Dream 整理后支持一键回滚到整理前状态，不怕"越整理越乱"</td>
</tr>
</tbody>
</table>

---

## 🖥️ 交互界面与演示

OPC Brain 提供了开箱即用的 Web UI，支持完整的 WorkSpace 管理、白盒记忆编辑、以及多智能体协作过程的可视化。

### 使用场景

> 以下所有演示均由端侧模型通过 OPC Brain 智能路由完成生成——无需调用云端大模型。

#### 工作文档生成

> *"调研一下中国大模型应用市场，整理成一份正式的 HTML 白皮书"*

<table width="100%">
<tr>
<td width="50%" align="center"><b>执行过程</b></td>
<td width="50%" align="center"><b>最终成果</b></td>
</tr>
<tr>
<td><img src="assets/zh/ppt_zh.gif" width="100%"/></td>
<td><img src="assets/result/ppt_result_zh.gif" width="100%"/></td>
</tr>
</table>

#### 小游戏开发

> *"用 Vibe Coding 模式陪我做一款 iOS AR 小游戏《找球球》"*

<table width="100%">
<tr>
<td width="50%" align="center"><b>执行过程</b></td>
<td width="50%" align="center"><b>最终成果</b></td>
</tr>
<tr>
<td><img src="assets/zh/iosgame_zh.gif" width="100%"/></td>
<td align="center"><img src="assets/result/ios_game_result.gif" width="60%"/></td>
</tr>
</table>

#### AI 工程平台开发

> *"从零造一个 Embedding 低代码调优平台"*

<table width="100%">
<tr>
<td width="50%" align="center"><b>执行过程</b></td>
<td width="50%" align="center"><b>最终成果</b></td>
</tr>
<tr>
<td><img src="assets/zh/modeltraining_zh.gif" width="100%"/></td>
<td><img src="assets/result/modeltraining_result_zh.gif" width="100%"/></td>
</tr>
</table>

#### 音视频剪辑&自媒体运营

> *"把这期英文播客推送给中日法韩西阿六语全球受众"*

<table width="100%">
<tr>
<td width="50%" align="center"><b>执行过程</b></td>
<td width="50%" align="center"><b>最终成果（含音频）</b></td>
</tr>
<tr>
<td><img src="assets/zh/podcast_zh.gif" width="100%"/></td>
<td>

https://github.com/user-attachments/assets/a7245467-ee3c-4939-a055-c56576ac56d1

</td>
</tr>
</table>

---

## 🛠️ 扩展与插件 (Extension Protocol)

OPC Brain 采用开放的插件架构，插件代码与开源核心严格隔离。开发者可以通过 `plugin.json` 轻松扩展系统能力：

- **MCP Servers**: 原生支持集成 Model Context Protocol 服务器。
- **Tools & Skills**: 注册自定义工具，或通过 [ClawHub](https://www.npmjs.com/package/clawhub) 引入社区 Skill。
- **Lifecycle Hooks**: 拦截 `PreToolUse`、`UserPromptSubmit` 等关键生命周期。
- **Custom Memory**: 允许接入自定义的记忆存储 Provider。

---