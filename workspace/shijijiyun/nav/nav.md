# Navigation Layer 接口定义

> 版本：v0.1.0 | 作用域：市级集运·图谱增强型数据骨架

## 1. 设计目标

`nav` 层作为数据骨架的"神经中枢"，对外暴露统一寻址与编排接口，对内衔接 `data`/`rules`/`graph` 三层。所有可插拔应用均通过 nav 层完成注册、路由与生命周期管理。

## 2. 目录职责

| 目录 | 职责 | 产出物示例 |
|------|------|-----------|
| `data/` | 原始与清洗数据、外部数据源映射 | `stations.csv`, `etl_pipeline.yml` |
| `rules/` | 业务规则、校验策略、语义映射表 | `rank_rules.yml`, `dialect_dict.json` |
| `graph/` | 知识图谱本体、实例、推理规则 | `model.ttl`, `model.jsonld`, `inference.drl` |
| `nav/` | 接口定义、服务编排、插件注册表 | `nav.md`, `registry.yml` |

## 3. 核心接口

### 3.1 插件注册接口

```yaml
# registry.yml 片段
plugins:
  rank_traceability:
    id: sjy.plugin.rank_traceability
    version: 0.1.0
    entry: rules/rank_rules.yml
    graph_trigger:
      - on: node.rankScore.changed
        query: graph/sparql/rank_audit.rq
    enabled: true

  dialect_normalization:
    id: sjy.plugin.dialect_normalization
    version: 0.1.0
    entry: rules/dialect_dict.json
    graph_trigger:
      - on: term.unresolved
        query: graph/sparql/dialect_lookup.rq
    enabled: true

  patent_knowledge_link:
    id: sjy.plugin.patent_knowledge_link
    version: 0.1.0
    entry: rules/patent_index.yml
    graph_trigger:
      - on: node.equipment.updated
        query: graph/sparql/patent_recommend.rq
    enabled: false   # 默认关闭，按需启用
```

### 3.2 统一寻址接口（URI 约定）

所有实体统一使用以下 URI 模式寻址，保证跨层引用一致性：

```text
http://shijijiyun.local/{layer}/{type}/{id}

示例：
  http://shijijiyun.local/graph/node/Hub-A
  http://shijijiyun.local/rules/rank/v2024-tier-1
  http://shijijiyun.local/data/source/gov-logistics-2024
```

### 3.3 查询网关接口

nav 层对外暴露 SPARQL + REST 双网关：

- **SPARQL Endpoint**：`POST /graph/query`
  - Content-Type: `application/sparql-query`
  - 用于图谱深度遍历、推理查询

- **REST Endpoint**：`GET /nav/{plugin}/invoke`
  - 用于插件快速触发、轻量语义校验
  - 返回统一信封：
    ```json
    {
      "ok": true,
      "plugin": "rank_traceability",
      "data": { ... },
      "provenance": ["rules/rank_rules.yml", "graph/model.ttl"]
    }
    ```

### 3.4 生命周期钩子

每个插件可实现以下钩子（由 nav 层调度）：

| 钩子 | 触发时机 | 用途 |
|------|---------|------|
| `on_init` | 服务启动 / 插件启用 | 加载词典、预热索引 |
| `on_data_change` | data 层数据变更 | 增量更新图谱实例 |
| `on_rule_change` | rules 层规则变更 | 刷新校验策略缓存 |
| `on_graph_inference` | 图谱推理完成 | 消费推理结果、生成推荐 |
| `on_shutdown` | 服务关闭 / 插件禁用 | 落盘状态、释放连接 |

## 4. 依赖方向

```
nav ──depends-on──> graph
nav ──depends-on──> rules
nav ──depends-on──> data
data ──feeds-into──> graph
rules ──constrains──> graph
```

**铁律**：`nav` 层不直接写 `data`，所有写操作通过 `graph` 层事务完成，以保证溯源链完整。

## 5. 扩展约定

1. 新增插件需在 `registry.yml` 注册，并补充 `docs/{plugin}.md` 说明。
2. SPARQL 查询文件统一存放于 `graph/sparql/`，命名规则 `{plugin}_{action}.rq`。
3. 所有插件配置优先使用 YAML，支持多环境覆盖：`{plugin}.{env}.yml`。
