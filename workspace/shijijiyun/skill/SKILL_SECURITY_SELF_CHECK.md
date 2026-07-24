# Skill 安全自检指南

> **适用对象**: 市级集运 Skill 开发者 & 运维人员  
> **版本**: v1.0  
> **最后更新**: 2026-07-16

---

## 目录

1. [三步操作流程](#三步操作流程)
2. [安全增强四件套集成](#安全增强四件套集成)
3. [四大巡检维度说明](#四大巡检维度说明)
4. [典型问题示例](#典型问题示例)
5. [一键修复提示](#一键修复提示)
6. [附录：评分标准](#附录评分标准)

---

## 三步操作流程

### 第 1 步：运行自动巡检

```bash
cd shijijiyun/skill

# 基础巡检（文本报告）
./run_inspection.sh ./<your-skill-dir>

# 输出 JSON 报告（可接入 CI/CD）
./run_inspection.sh ./<your-skill-dir> --format json -o report.json

# 输出 Markdown 报告（便于归档）
./run_inspection.sh ./<your-skill-dir> --format markdown -o report.md
```

**预期输出**: 一个包含四维度检查的结构化报告，每项问题附带严重等级、位置、描述和修复建议。

### 第 2 步：解读报告 & 定位问题

报告将问题划分为四个等级：

| 等级 | 图标 | 含义 | 处理策略 |
|------|------|------|----------|
| **CRITICAL** | ⛔ | 可被直接利用的高危漏洞 | **立即阻断上线**，24h 内修复 |
| **HIGH** | 🔴 | 存在明确攻击路径 | 本次迭代必须修复 |
| **MEDIUM** | 🟡 | 防御性缺失或最佳实践违反 | 纳入下个 Sprint |
| **LOW** | 🟢 | 优化建议 | 记录技术债务，排期清理 |

每条 finding 都包含：
- **位置** — 精确到文件:行号或 JSON path
- **描述** — 具体的问题说明
- **修复建议** — 可直接采纳的代码修改方案
- **自动修复标记** — 是否支持 `--fix` 一键修复

### 第 3 步：修复 & 验证

```bash
# 1. 自动修复可修复项
./run_inspection.sh ./<your-skill-dir> --fix

# 2. 手动修复其余项（参考报告中的 fix_hint）

# 3. 重新巡检确认清零
./run_inspection.sh ./<your-skill-dir>

# 4. 合格标准:
#    CRITICAL = 0, HIGH = 0, MEDIUM ≤ 2, LOW ≤ 5
#    否则 CI/CD 流水线应阻断合并
```

---

## 安全增强四件套集成

在 Skill 入口文件中（如 `main.py` 或 `handler.py`）引入四件套：

```python
from security_inspector.enhancements import SecurityEnhancementKit

# 1) 初始化（secret 长度 ≥ 16 字符，建议从环境变量或密钥管理服务获取）
kit = SecurityEnhancementKit(
    secret="your-secret-at-least-16-chars",
    audit_dir="./audit_logs",
)

# 2) 请求入口：校验 + 签名
def handle_skill_request(raw_input: dict) -> dict:
    # 输入过滤（类型/长度/正则/黑白名单）
    clean = kit.apply_to_skill(raw_input)

    # >>> 你的业务逻辑放在这里 <<<
    result = do_business_logic(clean)

    # 输出脱敏 + 审计
    safe = kit.finalize(result)
    return safe
```

### 四件套一览

| 组件 | 作用 | 关键 API |
|------|------|----------|
| **InputFilter** | 拦截非法输入（类型/长度/正则/黑白名单） | `.validate(data)` |
| **RuleSigner** | 防规则篡改（HMAC-SHA256 签名+时效） | `.sign(rules)` / `.verify(signed)` |
| **OutputDesensitizer** | 自动脱敏手机号/身份证/地址/银行卡等 | `.desensitize(output)` |
| **AuditLogger** | JSONL 格式全量审计轨迹 | `.log(action, **ctx)` |

---

## 四大巡检维度说明

### 维度一：输入校验缺失 (input_validation)

> 检测 Skill 入口是否对用户输入做了充分的校验。

**检查项**:
- `manifest.json` 中 `inputs` 字段是否配置了 `validation`/`pattern`/`max_length`
- 代码中是否存在未做参数化处理的 SQL/Shell 命令拼接
- 是否存在 `eval()`/`exec()` 处理外部输入
- 文件路径是否做了目录穿越防护

### 维度二：规则逻辑漏洞 (rule_logic)

> 检测配送/分拣/计费规则是否存在逻辑死角或重叠。

**检查项**:
- 配送规则的条件是否完全覆盖目标场景（短路/重叠）
- 仓库分拣规则的地理范围是否互斥
- 计费阶梯是否首尾相接无间隙
- 权限判定是否依赖了客户端可控字段

### 维度三：图谱关系越权 (graph_auth)

> 检测知识图谱/关系查询是否做了足够的租户隔离。

**检查项**:
- 图谱查询是否缺少 `owner_id`/`city_id`/`tenant_id` 过滤
- 配送员是否可以遍历全平台运单
- 跨租户数据是否做了严格隔离
- 批量导出是否有分页和条数上限

### 维度四：输出敏感信息泄露 (output_leak)

> 检测 Skill 输出中是否包含未脱敏的敏感数据。

**检查项**:
- 手机号 / 身份证号 / 住址 / 银行卡号 → 自动正则匹配
- GPS 精确坐标是否暴露在输出中
- 物流运单号是否可能被反推路线
- `outputs` 定义中是否标记了 `mask: true`

---

## 典型问题示例

### 示例 1：输入校验缺失 — SQL 注入

**问题代码**:
```python
def query_order(order_id: str):
    sql = f"SELECT * FROM orders WHERE id = '{order_id}'"   # ⚠️ f-string 拼接
    cursor.execute(sql)
```

**巡检报告**:
```
⛔ [CRITICAL] [IV-0003] SQL 语句使用 f-string 拼接（SQL 注入风险）
   位置: handler.py:12
   修复: 改用参数化查询: cursor.execute(sql, (order_id,))
```

**一键修复**:
```python
def query_order(order_id: str):
    sql = "SELECT * FROM orders WHERE id = %s"
    cursor.execute(sql, (order_id,))  # ✅ 参数化
```

---

### 示例 2：规则逻辑漏洞 — 计费阶梯间隙

**问题定义** (`pricing.json`):
```json
[
  {"max_weight": 1.0, "price": 10},
  {"min_weight": 1.5, "price": 15}    // ⚠️ (1.0, 1.5) 无覆盖
]
```

**巡检报告**:
```
🔴 [HIGH] [RL-0001] 计费阶梯 [0]→[1] 存在间隙 (1.0～1.5)
   修复: 将 pricing_tiers[0].max_weight 调整为 1.5 或添加默认阶梯
```

**一键修复**:
```json
[
  {"max_weight": 1.5, "price": 10},   // ✅ 首尾相接
  {"min_weight": 1.5, "price": 15}
]
```

---

### 示例 3：图谱关系越权 — 缺失租户隔离

**问题代码**:
```python
# Gremlin 查询：所有仓库库存
g.V().hasLabel("warehouse").valueMap()  # ⚠️ 无城市隔离
```

**巡检报告**:
```
🔴 [HIGH] [GA-0001] 图谱查询缺少租户/所有者隔离条件
   修复: 添加 .has('city_id', current_user.city_id) 过滤
```

**一键修复**:
```python
g.V().hasLabel("warehouse") \
     .has("city_id", current_user.city_id) \   # ✅ 城市隔离
     .valueMap()
```

---

### 示例 4：输出敏感信息泄露 — 手机号明文

**问题代码**:
```python
return {"driver": "张三", "phone": "13812345678"}  # ⚠️ 明文输出
```

**巡检报告**:
```
🔴 [HIGH] [OL-0001] 代码中可能泄露中国大陆手机号
   位置: dispatch.py:45
   修复: 使用 OutputDesensitizer.desensitize() 脱敏后再输出
```

**一键修复**:
```python
from security_inspector.enhancements import OutputDesensitizer
d = OutputDesensitizer()
return d.desensitize({"driver": "张三", "phone": "13812345678"})
# {"driver": "张三", "phone": "138****5678"}  ✅
```

---

## 一键修复提示

### `--fix` 参数支持的自动修复项

| 问题类型 | 自动修复动作 |
|----------|-------------|
| 输入字段缺少 `max_length` | 追加 `max_length: 256` |
| 输出敏感字段未标记 mask | 添加 `"mask": true` |
| 缺少 manifest 校验配置 | 生成 `validation.json` 模板 |
| 图谱查询无分页限制 | 插入 `LIMIT 200` 子句 |

### 不可自动修复项（需人工决策）

- 业务逻辑层面的权限模型设计
- 规则条件的语义调整
- 第三方库版本升级
- 架构级安全改造（如引入 API 网关）

### CI/CD 集成示例（GitHub Actions）

```yaml
- name: 安全巡检
  run: |
    cd shijijiyun/skill
    ./run_inspection.sh ./skills/city_logistics --format json -o report.json
    # 解析 report.json，CRITICAL>0 或 HIGH>0 则失败
    python -c "
    import json
    r = json.load(open('report.json'))
    assert r['summary'].get('critical',0)==0, '存在 CRITICAL 漏洞'
    assert r['summary'].get('high',0)==0, '存在 HIGH 漏洞'
    "
```

---

## 附录：评分标准

### 单次巡检评分

```
安全评分 = 100 - (C×20 + H×10 + M×5 + L×2)
其中 C=CRITICAL数, H=HIGH数, M=MEDIUM数, L=LOW数
最低分 0
```

| 分数区间 | 评级 | 处置 |
|----------|------|------|
| 90-100 | 🟢 优秀 | 允许发布 |
| 70-89 | 🟡 良好 | 有条件发布（限灰度） |
| 50-69 | 🟠 需改进 | 阻断发布，限期修复 |
| 0-49 | 🔴 危险 | 紧急回滚 + 安全评审 |

---

*本指南由市级集运 Skill 安全巡检工具自动生成框架，建议每季度更新一次检测规则库。*
