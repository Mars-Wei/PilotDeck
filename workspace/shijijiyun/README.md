# shijijiyun — 市级集运·图谱增强型数据骨架

本目录实现"市级集运"数据体系的图谱增强架构，采用标准父子树四层模型。

## 目录结构

```
shijijiyun/
├── data/                  ← 原始数据 & ETL 管道
│   └── .layer
├── rules/                 ← 业务规则 & 语义映射
│   ├── rank_rules.yml     ← Rank 校验策略
│   ├── dialect_dict.json  ← 方言语义归一词典
│   └── patent_index.yml   ← 专利知识索引
├── graph/                 ← 知识图谱本体 & 实例
│   ├── model.ttl          ← OWL 本体 (Turtle)
│   └── model.jsonld       ← OWL 本体 (JSON-LD)
├── nav/                   ← 导航层接口定义
│   └── nav.md             ← 接口规范 & 插件注册
└── 图谱如何嵌入市级集运·速览.md ← 一页速览文档
```

## 三个可插拔场景

| 场景 | 开关 | 说明 |
|------|------|------|
| Rank 校验溯源 | `rank_traceability` | 评分证据链追踪 |
| 方言语义归一 | `dialect_normalization` | 方言 → 标准概念映射 |
| 专利知识关联 | `patent_knowledge_link` | 专利 ↔ 物流节点关联 |

## 启动顺序

1. 阅读 `图谱如何嵌入市级集运·速览.md`
2. 查阅 `nav/nav.md` 了解接口规范
3. 以 `graph/model.ttl` 为骨架导入现有数据
4. 按需在 `registry.yml` 启用插件

## 版本

v0.1.0 — 概念验证阶段
