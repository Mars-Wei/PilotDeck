"""
市级集运 Skill 安全巡检引擎
===========================
自动扫描 Skill 定义文件中的四类安全问题，并生成结构化报告。
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

SEVERITY_CRITICAL = "critical"
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"


@dataclass
class Finding:
    id: str
    category: str          # input_validation / rule_logic / graph_auth / output_leak
    severity: str          # critical / high / medium / low
    title: str
    location: str          # 文件路径:行号 或 JSON path
    detail: str
    fix_hint: str
    auto_fixable: bool = False


@dataclass
class InspectionReport:
    inspected_at: str
    target: str
    total_findings: int
    findings: list[Finding] = field(default_factory=list)
    summary: dict[str, int] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps({
            "inspected_at": self.inspected_at,
            "target": self.target,
            "total_findings": self.total_findings,
            "summary": self.summary,
            "findings": [
                {
                    "id": f.id,
                    "category": f.category,
                    "severity": f.severity,
                    "title": f.title,
                    "location": f.location,
                    "detail": f.detail,
                    "fix_hint": f.fix_hint,
                    "auto_fixable": f.auto_fixable,
                }
                for f in self.findings
            ],
        }, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 敏感信息模式库
# ---------------------------------------------------------------------------

SENSITIVE_PATTERNS = {
    "phone_cn": {
        "name": "中国大陆手机号",
        "regex": r"1[3-9]\d{9}",
        "severity": SEVERITY_HIGH,
        "mask": lambda m: m[:3] + "****" + m[-4:],
    },
    "id_card_cn": {
        "name": "中国身份证号",
        "regex": r"\d{17}[\dXx]",
        "severity": SEVERITY_CRITICAL,
        "mask": lambda m: m[:3] + "***********" + m[-4:],
    },
    "home_address": {
        "name": "详细住址",
        "regex": r"(?:省|市|区|县|镇|乡|村|路|街|巷|号|栋|单元|室|楼)\S{0,30}(?:号|栋|单元|室|楼)",
        "severity": SEVERITY_HIGH,
        "mask": lambda m: m[:2] + "***" + m[-1] if len(m) > 3 else "***",
    },
    "email": {
        "name": "电子邮箱",
        "regex": r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        "severity": SEVERITY_MEDIUM,
        "mask": lambda m: m[0] + "***@" + m.split("@")[1] if "@" in m else "***",
    },
    "bank_card": {
        "name": "银行卡号",
        "regex": r"\b\d{16,19}\b",
        "severity": SEVERITY_CRITICAL,
        "mask": lambda m: m[:4] + "********" + m[-4:],
    },
    "gps_coord": {
        "name": "GPS 精确坐标",
        "regex": r"\d{2,3}\.\d{4,}[,，\s]\d{2,3}\.\d{4,}",
        "severity": SEVERITY_MEDIUM,
        "mask": lambda m: "**,****,**,****",
    },
    "order_tracking": {
        "name": "物流运单号（可推测集运路线）",
        "regex": r"(?:SF|YT|YTO|STO|ZTO|DB|JD|DEPPON|ANE|UC)\d{8,20}",
        "severity": SEVERITY_LOW,
        "mask": lambda m: m[:3] + "***" + m[-4:],
    },
}

# ---------------------------------------------------------------------------
# 输入校验缺失检测规则
# ---------------------------------------------------------------------------

INPUT_VALIDATION_CHECKS = [
    {
        "id_prefix": "IV",
        "name": "缺少类型校验",
        "pattern": r"def\s+\w+\(\s*(\w+)\s*[,\)]",
        "desc": "函数参数未做类型/长度/范围校验，可能导致注入或溢出",
        "fix": "在函数入口添加 isinstance() / len() / range 校验，并 raise ValidationError",
    },
    {
        "id_prefix": "IV",
        "name": "缺少空值/None 处理",
        "pattern": r"(?:input|req|params|data)\s*[\[\.]",
        "desc": "直接访问输入字段前未判 None 或缺失 key，可能抛出 KeyError / AttributeError",
        "fix": "使用 dict.get(key, default) 或 if key not in x 做防御",
    },
    {
        "id_prefix": "IV",
        "name": "缺少 SQL/LDAP/命令注入防护",
        "pattern": r"(?:cursor\.execute|os\.system|subprocess\.call|eval|exec)\s*\(\s*.*\b(?:input|request|params|user|data)\b",
        "desc": "外部输入未经清洗直接拼接进 SQL/Shell/Python exec，存在注入风险",
        "fix": "SQL: 参数化查询；Shell: shlex.quote() + allowlist；绝不使用 eval/exec 处理外部输入",
    },
    {
        "id_prefix": "IV",
        "name": "缺少路径穿越防御",
        "pattern": r"open\s*\(\s*.*[\+].*",
        "desc": "文件路径由用户输入拼接且未调用 os.path.realpath() 校验，可能被目录穿越攻击",
        "fix": "real = os.path.realpath(user_path); assert real.startswith(BASE_DIR)",
    },
]

# ---------------------------------------------------------------------------
# 规则逻辑漏洞检测规则
# ---------------------------------------------------------------------------

RULE_LOGIC_CHECKS = [
    {
        "id_prefix": "RL",
        "name": "配送规则存在短路路径",
        "desc": "if-elif 链中某个条件覆盖了后续所有条件，导致部分规则永不触发",
        "fix": "将最具体的条件放在最前面；添加 else 分支打印告警日志",
    },
    {
        "id_prefix": "RL",
        "name": "仓库分拣规则存在区间重叠",
        "desc": "多个地址-仓库映射规则的地理范围重叠，可能导致订单路由到错误仓库",
        "fix": "为每条规则定义明确的 GeoFence (经纬度多边形) 并验证互斥性",
    },
    {
        "id_prefix": "RL",
        "name": "价格/重量阶梯存在间隙",
        "desc": "计费规则的分段边界不连续，存在无覆盖区间，可能产生零计费或计费异常",
        "fix": "确保阶梯区间首尾相接，添加落界策略（取上/取下/报错）注释",
    },
    {
        "id_prefix": "RL",
        "name": "权限判定依赖客户端可控字段",
        "desc": "使用了 role、is_admin、user_type 等可由客户端篡改的字段做鉴权",
        "fix": "权限判定必须依赖服务端 session/token 内的可信字段",
    },
    {
        "id_prefix": "RL",
        "name": "时间/时效规则未处理边界",
        "desc": "配送截止时间、优惠券有效期等规则只在正常区间内成立，跨天/闰秒/时区切换时行为不确定",
        "fix": "统一使用 UTC timestamp + pytz；对边界值编写显式单元测试",
    },
]

# ---------------------------------------------------------------------------
# 图谱关系越权检测规则
# ---------------------------------------------------------------------------

GRAPH_AUTH_CHECKS = [
    {
        "id_prefix": "GA",
        "name": "跨区域仓库直查",
        "desc": "市级仓管角色可直接查询其他城市的仓库库存或订单，缺乏租户隔离",
        "fix": "在图谱查询前注入 filter: WHERE warehouse.city_id = current_user.city_id",
    },
    {
        "id_prefix": "GA",
        "name": "配送员可遍历全平台运单",
        "desc": "配送员 ID 可枚举且查询未绑定本人，允许遍历他人运单详情",
        "fix": "运单查询强制绑定 delivery_staff_id = session.user_id",
    },
    {
        "id_prefix": "GA",
        "name": "供应商可读取其他商家的进销存",
        "desc": "图谱边缺少方向/标签 ACL，商家 A 可通过关联关系读取商家 B 的进销存节点",
        "fix": "为每个节点添加 owner_id；查询前校验 caller 与 owner_id 的关系",
    },
    {
        "id_prefix": "GA",
        "name": "民生数据批量导出无限制",
        "desc": "包含市民地址、电话的图谱数据可一次导出全部行，未做分页或条数上限",
        "fix": "强制分页（每页≤200 条）；导出动作触发二次审批",
    },
]

# ---------------------------------------------------------------------------
# 主巡检引擎
# ---------------------------------------------------------------------------


class SecurityInspector:
    """市级集运 Skill 自动安全巡检引擎"""

    def __init__(self, skill_dir: str):
        self.skill_dir = Path(skill_dir).resolve()
        self.findings: list[Finding] = []
        self._counter = 0

    # ---- 公共入口 ----

    def run_full_inspection(self) -> InspectionReport:
        """执行全部四项检查，返回结构化报告"""
        self.findings = []
        self._counter = 0

        self._inspect_input_validation()
        self._inspect_rule_logic()
        self._inspect_graph_authorization()
        self._inspect_output_leakage()

        summary = {}
        for f in self.findings:
            summary.setdefault(f.severity, 0)
            summary[f.severity] += 1

        report = InspectionReport(
            inspected_at=datetime.utcnow().isoformat() + "Z",
            target=str(self.skill_dir),
            total_findings=len(self.findings),
            findings=self.findings,
            summary=summary,
        )
        return report

    # ---- 维度一：输入校验缺失 ----

    def _inspect_input_validation(self) -> None:
        """检查 Skill 定义中是否存在输入校验缺失"""
        manifest = self._load_manifest()
        skill_files = self._list_source_files()

        # 检查 manifest 中的 input_schema
        inputs = manifest.get("inputs", []) if isinstance(manifest, dict) else []
        for inp in inputs:
            if isinstance(inp, dict):
                if "validation" not in inp and "pattern" not in inp:
                    self._add(
                        "input_validation",
                        SEVERITY_HIGH,
                        f"输入字段 [{inp.get('name','?')}] 缺少校验规则",
                        f"manifest.json → inputs.{inp.get('name','?')}",
                        "未配置 validation/pattern/regex 字段，恶意输入可直入下游",
                        f"为该字段添加 validation 子节点：{{\"type\":\"string\",\"pattern\":\"^{inp.get('name','?')}_safe$\"}}",
                    )
                if "max_length" not in inp and "maxLength" not in inp:
                    self._add(
                        "input_validation",
                        SEVERITY_MEDIUM,
                        f"输入字段 [{inp.get('name','?')}] 未限制长度",
                        f"manifest.json → inputs.{inp.get('name','?')}",
                        "无 max_length 限制，可被 DoS 超大输入攻击",
                        "添加 max_length: 256（根据业务需要调整）",
                    )

        # 扫描 Python 源文件
        for sf in skill_files:
            self._scan_file_for_input_issues(sf)

    def _scan_file_for_input_issues(self, file_path: Path) -> None:
        """在单个文件中扫描输入校验问题"""
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception:
            return

        lines = content.splitlines()
        rel = str(file_path.relative_to(self.skill_dir))

        # 检测 eval/exec/os.system 外部输入拼接
        dangerous = re.findall(
            r'(eval|exec|os\.system|subprocess\.call|subprocess\.Popen)\s*\(',
            content,
        )
        for i, line in enumerate(lines, 1):
            for func in ("eval", "exec", "os.system", "subprocess.call", "subprocess.Popen"):
                if func in line and any(kw in line.lower() for kw in ("input", "param", "data", "body", "query", "user")):
                    self._add(
                        "input_validation",
                        SEVERITY_CRITICAL,
                        f"{func}() 调用疑似使用外部输入",
                        f"{rel}:{i}",
                        f"line: {line.strip()[:120]}",
                        "替换为安全的参数化调用；如必须保留，添加 allowlist 校验",
                    )
                    break

        # 检测 f-string / .format 拼接 SQL
        sql_pattern = re.findall(
            r'(cursor\.execute|\.execute)\s*\(\s*f["\']',
            content,
        )
        if sql_pattern:
            self._add(
                "input_validation",
                SEVERITY_CRITICAL,
                "SQL 语句使用 f-string 拼接（SQL 注入风险）",
                rel,
                f"发现 {len(sql_pattern)} 处 f-string SQL 拼接",
                "改用参数化查询: cursor.execute(sql, (param1, param2))",
            )

    # ---- 维度二：规则逻辑漏洞 ----

    def _inspect_rule_logic(self) -> None:
        """检查规则定义中的逻辑漏洞"""
        manifest = self._load_manifest()
        rules = manifest.get("rules", []) if isinstance(manifest, dict) else []

        if not rules:
            # 尝试从 rule.json 或 rules/ 目录加载
            rule_file = self.skill_dir / "rule.json"
            if rule_file.exists():
                try:
                    rules = json.loads(rule_file.read_text())
                except Exception:
                    pass
            else:
                rule_dir = self.skill_dir / "rules"
                if rule_dir.is_dir():
                    for rf in rule_dir.glob("*.json"):
                        try:
                            rules.extend(json.loads(rf.read_text()))
                        except Exception:
                            pass

        # 检测条件重叠
        conditions = []
        for rule in rules if isinstance(rules, list) else [rules]:
            cond = rule.get("condition") or rule.get("when") or rule.get("if")
            if cond:
                conditions.append((rule.get("id", "?"), str(cond)))

        # 简易重叠检测：完全相同条件的规则
        seen = {}
        for rid, cond in conditions:
            if cond in seen:
                self._add(
                    "rule_logic",
                    SEVERITY_HIGH,
                    f"规则 {rid} 与 {seen[cond]} 条件完全重复",
                    f"rules → {rid}",
                    f"两条规则都触发于: {cond[:80]}",
                    "合并规则或将优先规则加上 break/return，并添加注释说明优先级",
                )
            seen[cond] = rid

        # 检测计费阶梯不连续
        tiers = manifest.get("pricing_tiers", []) if isinstance(manifest, dict) else []
        if len(tiers) >= 2:
            for idx in range(len(tiers) - 1):
                t1 = tiers[idx]
                t2 = tiers[idx + 1]
                end1 = t1.get("max_weight") or t1.get("end") or t1.get("to")
                start2 = t2.get("min_weight") or t2.get("start") or t2.get("from")
                if end1 is not None and start2 is not None and end1 < start2:
                    self._add(
                        "rule_logic",
                        SEVERITY_HIGH,
                        f"计费阶梯 [{idx}]→[{idx+1}] 存在间隙 ({end1}～{start2})",
                        f"pricing_tiers[{idx}].end={end1} → pricing_tiers[{idx+1}].start={start2}",
                        f"区间 [{end1}, {start2}) 内的订单将无法匹配任何阶梯",
                        f"将 pricing_tiers[{idx}].max_weight 调整为 {start2} 或添加默认阶梯",
                    )

    # ---- 维度三：图谱关系越权 ----

    def _inspect_graph_authorization(self) -> None:
        """检查图谱查询是否存在越权风险"""
        source_files = self._list_source_files()

        for sf in source_files:
            try:
                content = sf.read_text(encoding="utf-8")
            except Exception:
                continue

            rel = str(sf.relative_to(self.skill_dir))

            # 检测图谱查询中是否缺少 owner / tenant 过滤
            graph_queries = re.findall(
                r'(?:match|query|g\.V|graph\.traversal|gremlin|cypher)\s*[\(=].{0,200}',
                content,
            )
            for gq in graph_queries:
                snippet = gq[:200].lower()
                if "match" in snippet or "g.v" in snippet or "traversal" in snippet:
                    missing_tenant = ("owner" not in snippet and
                                      "tenant" not in snippet and
                                      "city_id" not in snippet and
                                      "belongs_to" not in snippet and
                                      "user_id" not in snippet)
                    if missing_tenant:
                        self._add(
                            "graph_auth",
                            SEVERITY_HIGH,
                            "图谱查询缺少租户/所有者隔离条件",
                            f"{rel} → 图谱查询附近",
                            f"查询片段: {gq[:150].strip()}",
                            "在所有图谱查询中添加 .has('city_id', current_user.city_id) 过滤",
                        )

            # 检测是否有全量导出场景
            if "for" in content and "export" in content.lower():
                # 检测是否有限制
                if "limit" not in content.lower() and "page" not in content.lower():
                    self._add(
                        "graph_auth",
                        SEVERITY_MEDIUM,
                        "数据导出疑似无分页/条数限制",
                        rel,
                        "发现 export 相关逻辑但缺少 limit/page_size 控制",
                        "添加 LIMIT 200 OFFSET 和总条数预查，超过 1000 条触发审批流程",
                    )

    # ---- 维度四：输出敏感信息泄露 ----

    def _inspect_output_leakage(self) -> None:
        """扫描 Skill 定义中的输出敏感信息泄露风险"""
        # 1. 扫描 manifest 中 output_schema 是否包含敏感字段
        manifest = self._load_manifest()
        outputs = manifest.get("outputs", []) if isinstance(manifest, dict) else []
        sensitive_output_keys = {"phone", "mobile", "id_card", "address", "email",
                                 "bank_card", "password", "token", "secret", "key"}

        for out in outputs:
            if isinstance(out, dict):
                name = (out.get("name") or "").lower()
                for sk in sensitive_output_keys:
                    if sk in name:
                        self._add(
                            "output_leak",
                            SEVERITY_CRITICAL if sk in ("password", "token", "secret") else SEVERITY_HIGH,
                            f"输出字段 [{out.get('name')}] 包含敏感信息且未标记脱敏",
                            f"manifest.json → outputs.{out.get('name')}",
                            f"敏感字段 [{out.get('name')}] 出现在输出定义中",
                            "添加 \"mask\": true 标记；或使用 OutputDesensitizer 自动脱敏",
                        )

        # 2. 扫描 Python 源文件中的 print/return 是否直接输出敏感数据
        for sf in self._list_source_files():
            try:
                content = sf.read_text(encoding="utf-8")
            except Exception:
                continue

            rel = str(sf.relative_to(self.skill_dir))
            lines = content.splitlines()

            for i, line in enumerate(lines, 1):
                for label, spec in SENSITIVE_PATTERNS.items():
                    matches = re.findall(spec["regex"], line)
                    if matches:
                        # 排除注释行中作为示例的数据
                        stripped = line.strip()
                        if stripped.startswith("#"):
                            continue
                        self._add(
                            "output_leak",
                            spec["severity"],
                            f"代码中可能泄露{spec['name']}",
                            f"{rel}:{i}",
                            f"匹配到 {len(matches)} 处疑似{spec['name']}（行: {stripped[:100]}）",
                            f"使用 OutputDesensitizer.mask('{label}', value) 脱敏后再输出",
                        )

    # ---- 辅助方法 ----

    def _load_manifest(self) -> dict:
        """加载 manifest.json 或 skill.json"""
        for name in ("manifest.json", "skill.json", "definition.json"):
            path = self.skill_dir / name
            if path.exists():
                try:
                    return json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    pass
        return {}

    def _list_source_files(self) -> list[Path]:
        """列出所有可扫描的源文件"""
        files = []
        for ext in ("*.py", "*.json", "*.yaml", "*.yml", "*.toml"):
            files.extend(self.skill_dir.rglob(ext))
        return sorted(files)

    def _add(self, category: str, severity: str, title: str, location: str,
             detail: str, fix_hint: str, auto_fixable: bool = False) -> None:
        self._counter += 1
        self.findings.append(Finding(
            id=f"{category[:2].upper()}-{self._counter:04d}",
            category=category,
            severity=severity,
            title=title,
            location=location,
            detail=detail,
            fix_hint=fix_hint,
            auto_fixable=auto_fixable,
        ))


# ---------------------------------------------------------------------------
# CLI 入口（用于独立运行）
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    inspector = SecurityInspector(target)
    report = inspector.run_full_inspection()
    print(report.to_json())
