"""
安全增强四件套 (Security Enhancement Kit)
=========================================
提供开箱即用的安全加固模板，可与任意 Skill 快速集成。

四件套组成：
  1. InputFilter      — 输入过滤器
  2. RuleSigner       — 规则签名器
  3. OutputDesensitizer — 输出脱敏器
  4. AuditLogger      — 行为审计日志
"""

import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Optional

# ---------------------------------------------------------------------------
# 1. 输入过滤器 (InputFilter)
# ---------------------------------------------------------------------------


class InputValidationError(ValueError):
    """输入校验异常，附带错误码和字段名"""
    def __init__(self, field: str, msg: str, code: str = "INVALID_INPUT"):
        super().__init__(f"[{code}] {field}: {msg}")
        self.field = field
        self.code = code
        self.msg = msg


class InputFilter:
    """输入过滤器——标准化输入校验门禁。

    使用示例::

        filter = InputFilter()
        filter.add_rule("phone", pattern=r"^1[3-9]\d{9}$", max_length=11)
        filter.add_rule("address", max_length=200, required=False, banned_chars="<>\"'")
        clean = filter.validate({"phone": "13800138000", "address": "XX路XX号"})
    """

    def __init__(self):
        self._rules: dict[str, dict] = {}

    def add_rule(
        self,
        name: str,
        *,
        type_: type = str,
        required: bool = True,
        pattern: Optional[str] = None,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        allowed_values: Optional[list] = None,
        banned_values: Optional[list] = None,
        banned_chars: Optional[str] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
    ) -> "InputFilter":
        self._rules[name] = {
            "type": type_,
            "required": required,
            "pattern": re.compile(pattern) if pattern else None,
            "min_length": min_length,
            "max_length": max_length,
            "allowed_values": allowed_values,
            "banned_values": banned_values,
            "banned_chars": set(banned_chars) if banned_chars else None,
            "min_value": min_value,
            "max_value": max_value,
        }
        return self

    def validate(self, data: dict) -> dict:
        """逐字段校验，通过则返回清洗后的数据；否则抛出 InputValidationError"""
        result = {}
        errors: list[str] = []

        for name, rule in self._rules.items():
            value = data.get(name)
            if value is None:
                if rule["required"]:
                    errors.append(f"缺少必填字段: {name}")
                continue

            # 类型检查
            try:
                value = rule["type"](value)
            except (ValueError, TypeError):
                errors.append(f"字段 [{name}] 类型应为 {rule['type'].__name__}")
                continue

            sv = str(value) if isinstance(value, str) else value

            # 长度检查
            if rule["min_length"] and isinstance(sv, str) and len(sv) < rule["min_length"]:
                errors.append(f"字段 [{name}] 长度不足（最小={rule['min_length']}, 实际={len(sv)}）")
            if rule["max_length"] and isinstance(sv, str) and len(sv) > rule["max_length"]:
                errors.append(f"字段 [{name}] 长度超限（最大={rule['max_length']}, 实际={len(sv)}）")

            # 正则检查
            if rule["pattern"] and isinstance(sv, str) and not rule["pattern"].match(sv):
                errors.append(f"字段 [{name}] 格式不合法: {sv[:50]}")

            # 黑白名单检查
            if rule["allowed_values"] and value not in rule["allowed_values"]:
                errors.append(f"字段 [{name}] 不在允许值列表中: {value}")
            if rule["banned_values"] and value in rule["banned_values"]:
                errors.append(f"字段 [{name}] 为禁用值: {value}")
            if rule["banned_chars"] and isinstance(sv, str):
                bad = set(sv) & rule["banned_chars"]
                if bad:
                    errors.append(f"字段 [{name}] 包含禁止字符: {bad}")

            # 数值范围
            if rule["min_value"] is not None and isinstance(value, (int, float)) and value < rule["min_value"]:
                errors.append(f"字段 [{name}] 值太小（最小={rule['min_value']}, 实际={value}）")
            if rule["max_value"] is not None and isinstance(value, (int, float)) and value > rule["max_value"]:
                errors.append(f"字段 [{name}] 值太大（最大={rule['max_value']}, 实际={value}）")

            result[name] = value

        if errors:
            raise InputValidationError("input", "; ".join(errors), "VALIDATION_FAILED")
        return result

    @classmethod
    def preset_city_logistics(cls) -> "InputFilter":
        """预置规则：市级集运场景常用输入"""
        return (
            cls()
            .add_rule("phone", pattern=r"^1[3-9]\d{9}$", max_length=11)
            .add_rule("address", max_length=200, banned_chars="<>\"'%&", required=False)
            .add_rule("order_id", pattern=r"^[A-Za-z0-9\-]{8,64}$", min_length=8, max_length=64)
            .add_rule("city_id", pattern=r"^\d{6}$")
            .add_rule("warehouse_id", pattern=r"^WH-[A-Z0-9]{4,8}$")
            .add_rule("delivery_staff_id", pattern=r"^DS\d{6,10}$")
            .add_rule("page", type_=int, min_value=1, max_value=10000, required=False)
            .add_rule("page_size", type_=int, min_value=1, max_value=200, required=False)
            .add_rule("weight", type_=float, min_value=0.01, max_value=9999.99, required=False)
            .add_rule("timestamp", pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", required=False)
        )


# ---------------------------------------------------------------------------
# 2. 规则签名器 (RuleSigner)
# ---------------------------------------------------------------------------


class RuleSignatureError(Exception):
    """规则签名不匹配——规则内容可能被篡改"""


class RuleSigner:
    """规则签名器——对关键规则配置做 HMAC 签名，防止篡改。

    使用示例::

        signer = RuleSigner("my-secret-key")
        signed = signer.sign({"warehouse": "WH-001", "city": "330100"})
        signer.verify(signed)  # 通过或抛出
    """

    _SIG_FIELD = "__sig"
    _TS_FIELD = "__ts"

    def __init__(self, secret: str):
        if len(secret) < 16:
            raise ValueError("secret 长度至少 16 字符")
        self._secret = secret.encode()

    def sign(self, payload: dict) -> dict:
        """返回带签名和时间戳的副本"""
        data = {k: v for k, v in payload.items() if not k.startswith("__")}
        data[self._TS_FIELD] = datetime.now(timezone.utc).isoformat()
        raw = json.dumps(data, sort_keys=True, ensure_ascii=False)
        signature = hmac.new(self._secret, raw.encode(), hashlib.sha256).hexdigest()
        data[self._SIG_FIELD] = signature
        return data

    def verify(self, signed: dict, max_age_seconds: int = 300) -> dict:
        """校验签名并返回原始 payload；签名错误或过期时抛出异常"""
        if self._SIG_FIELD not in signed:
            raise RuleSignatureError("缺少签名字段")

        sig = signed.pop(self._SIG_FIELD)
        ts = signed.pop(self._TS_FIELD, None)

        # 时效检查
        if ts:
            try:
                dt = datetime.fromisoformat(ts)
                age = (datetime.now(timezone.utc) - dt).total_seconds()
                if age > max_age_seconds:
                    raise RuleSignatureError(f"签名已过期 ({age:.0f}s > {max_age_seconds}s)")
            except ValueError:
                raise RuleSignatureError(f"时间戳格式无效: {ts}")

        raw = json.dumps(signed, sort_keys=True, ensure_ascii=False)
        expected = hmac.new(self._secret, raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise RuleSignatureError("HMAC 签名不匹配——规则内容可能被篡改")
        return signed

    @staticmethod
    def checksum_rules(rules_file: Path) -> str:
        """对规则文件做 SHA256 摘要，便于审计核对"""
        return hashlib.sha256(rules_file.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# 3. 输出脱敏器 (OutputDesensitizer)
# ---------------------------------------------------------------------------

_SENSITIVE_RULES: list[dict] = [
    {"label": "phone_cn",     "regex": re.compile(r"1[3-9]\d{9}"),
     "mask_fn": lambda m: m[:3] + "****" + m[-4:]},
    {"label": "id_card_cn",   "regex": re.compile(r"\d{17}[\dXx]"),
     "mask_fn": lambda m: m[:3] + "***********" + m[-4:]},
    {"label": "email",        "regex": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
     "mask_fn": lambda m: m[0] + "***@" + m.split("@")[1] if "@" in m else "***"},
    {"label": "bank_card",    "regex": re.compile(r"\b\d{16,19}\b"),
     "mask_fn": lambda m: m[:4] + "********" + m[-4:]},
    {"label": "gps_detail",   "regex": re.compile(r"\d{2,3}\.\d{4,}[,，\s]\d{2,3}\.\d{4,}"),
     "mask_fn": lambda m: "**,****,**,****"},
]


class OutputDesensitizer:
    """输出脱敏器——自动识别并脱敏输出中的敏感信息。

    使用示例::

        d = OutputDesensitizer()
        safe = d.desensitize("用户 13812345678 的地址是浙江省杭州市西湖区XX路XX号")
        # => "用户 138****5678 的地址是浙江***号"
    """

    def __init__(self, extra_rules: Optional[list[dict]] = None):
        self._rules = list(_SENSITIVE_RULES)
        if extra_rules:
            self._rules.extend(extra_rules)

    def desensitize(self, value: Any) -> Any:
        if isinstance(value, str):
            for rule in self._rules:
                try:
                    value = rule["regex"].sub(rule["mask_fn"], value)
                except Exception:
                    continue
            return value
        if isinstance(value, dict):
            return {k: self.desensitize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.desensitize(item) for item in value]
        return value

    @classmethod
    def mask(cls, label: str, value: str) -> str:
        """按标签手动脱敏单个值"""
        for rule in _SENSITIVE_RULES:
            if rule["label"] == label and rule["regex"].search(value):
                return rule["regex"].sub(rule["mask_fn"], value)
        return value

    @classmethod
    def mask_fields(cls, data: dict, fields: list[str]) -> dict:
        """仅对指定字段脱敏"""
        result = dict(data)
        for field in fields:
            if field in result and isinstance(result[field], str):
                result[field] = cls._mask_str(result[field])
        return result

    @staticmethod
    def _mask_str(s: str) -> str:
        """通用脱敏：保留首尾，中间替换为 ***"""
        if len(s) <= 3:
            return s[0] + "***" if len(s) > 1 else "*"
        return s[:2] + "***" + s[-2:]


# ---------------------------------------------------------------------------
# 4. 行为审计日志 (AuditLogger)
# ---------------------------------------------------------------------------


class AuditLogger:
    """行为审计日志——记录所有关键操作的全量审计轨迹。

    使用示例::

        audit = AuditLogger(log_dir="./audit_logs")
        audit.log("ORDER_DISPATCH", user="staff_01", order_id="SF123456", city="杭州")
    """

    def __init__(self, log_dir: str = "./audit_logs", service_name: str = "city-logistics-skill"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.service_name = service_name
        self._logger = logging.getLogger(f"audit.{service_name}")
        self._logger.setLevel(logging.INFO)
        self._logger.propagate = False

        # JSONL 文件 handler
        fh = logging.FileHandler(self.log_dir / f"audit-{datetime.utcnow().strftime('%Y%m%d')}.jsonl")
        fh.setLevel(logging.INFO)
        self._logger.addHandler(fh)

    def log(self, action: str, **context: Any) -> None:
        """记录一条审计日志"""
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "service": self.service_name,
            "action": action,
            "context": OutputDesensitizer().desensitize(dict(context)),
        }
        self._logger.info(json.dumps(record, ensure_ascii=False, default=str))

    def wrap(self, action: str, log_args: bool = True) -> Callable:
        """装饰器——自动记录函数调用的审计日志。

        示例::

            @audit.wrap("DISPATCH_ORDER")
            def dispatch(staff_id: str, order_id: str):
                ...
        """
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            def wrapper(*args, **kwargs):
                ctx = {}
                if log_args:
                    ctx.update({"args": str(args[:5])[:200], "kwargs": str(kwargs)[:200]})
                self.log(f"{action}.START", **ctx)
                try:
                    result = func(*args, **kwargs)
                    self.log(f"{action}.SUCCESS", **ctx)
                    return result
                except Exception as e:
                    self.log(f"{action}.FAILURE", error=str(e)[:200], **ctx)
                    raise
            return wrapper
        return decorator

    def tail_entries(self, n: int = 50) -> list[dict]:
        """返回最近的 n 条审计记录（用于仪表板）"""
        today_file = self.log_dir / f"audit-{datetime.utcnow().strftime('%Y%m%d')}.jsonl"
        if not today_file.exists():
            return []
        lines = today_file.read_text(encoding="utf-8").strip().splitlines()
        entries = []
        for line in lines[-n:]:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return entries


# ---------------------------------------------------------------------------
# 集成封装：一键启用安全增强四件套
# ---------------------------------------------------------------------------


class SecurityEnhancementKit:
    """一键集成四件套的快捷入口。

    使用示例::

        kit = SecurityEnhancementKit(secret="my-key-at-least-16-chars")
        kit.apply_to_skill(...)   # 自动为 Skill 注入四件套
    """

    def __init__(self, secret: str, audit_dir: str = "./audit_logs"):
        self.input_filter = InputFilter.preset_city_logistics()
        self.rule_signer = RuleSigner(secret)
        self.desensitizer = OutputDesensitizer()
        self.audit = AuditLogger(log_dir=audit_dir)

    def apply_to_skill(self, skill_input: dict) -> dict:
        """完整的请求加固流水线：校验 → 鉴签 → 执行 → 脱敏 → 审计"""
        self.audit.log("SKILL_INVOKE", input_size=len(json.dumps(skill_input)))
        try:
            clean = self.input_filter.validate(skill_input)
            self.audit.log("INPUT_VALIDATED", fields=list(clean.keys()))
        except InputValidationError as e:
            self.audit.log("INPUT_REJECTED", error=str(e.msg))
            raise

        # 如有签名，校验之
        if "__sig" in clean:
            clean = self.rule_signer.verify(clean)

        # 实际业务逻辑由调用方执行，此处返回清洗后的输入
        return clean

    def finalize(self, output: Any) -> Any:
        """输出脱敏 + 审计"""
        safe = self.desensitizer.desensitize(output)
        self.audit.log("SKILL_COMPLETE", output_keys=list(safe.keys()) if isinstance(safe, dict) else "scalar")
        return safe
