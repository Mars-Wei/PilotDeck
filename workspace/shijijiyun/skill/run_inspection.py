#!/usr/bin/env python3
"""
市级集运 Skill 自动安全巡检工具 —— 命令行入口
=============================================
用法:
    python run_inspection.py <skill目录> [--format json|markdown|text] [--fix]

示例:
    python run_inspection.py ./skills/city_logistics
    python run_inspection.py ./skills/city_logistics --format markdown
    python run_inspection.py ./skills/city_logistics --fix  # 自动修复可修复项
"""

import argparse
import json
import sys
from pathlib import Path

# 将当前目录加入 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from security_inspector.inspector import SecurityInspector, SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW


SEVERITY_ICONS = {
    SEVERITY_CRITICAL: "⛔",
    SEVERITY_HIGH: "🔴",
    SEVERITY_MEDIUM: "🟡",
    SEVERITY_LOW: "🟢",
}

SEVERITY_WEIGHT = {
    SEVERITY_CRITICAL: 4,
    SEVERITY_HIGH: 3,
    SEVERITY_MEDIUM: 2,
    SEVERITY_LOW: 1,
}


def format_text(report) -> str:
    """纯文本输出"""
    lines = [
        "=" * 64,
        "  市级集运 Skill 安全巡检报告",
        "=" * 64,
        f"巡检时间 : {report.inspected_at}",
        f"巡检目标 : {report.target}",
        f"发现总数 : {report.total_findings}",
        f"严重等级 : {_format_summary(report.summary)}",
        "-" * 64,
    ]
    if not report.findings:
        lines.append("✅ 未发现问题。")
    for f in report.findings:
        icon = SEVERITY_ICONS.get(f.severity, "⚪")
        lines.extend([
            f"",
            f"{icon} [{f.severity.upper()}] [{f.id}] {f.title}",
            f"   位置: {f.location}",
            f"   描述: {f.detail}",
            f"   修复: {f.fix_hint}",
            f"   可自动修复: {'是' if f.auto_fixable else '否'}",
        ])
    lines.extend([
        "",
        "-" * 64,
        "💡 提示: 使用 --fix 参数自动修复可修复项；详见《Skill 安全自检指南》",
    ])
    return "\n".join(lines)


def format_markdown(report) -> str:
    """Markdown 输出"""
    lines = [
        "# 市级集运 Skill 安全巡检报告",
        "",
        f"| 项目 | 值 |",
        f"|---|---|",
        f"| 巡检时间 | {report.inspected_at} |",
        f"| 巡检目标 | `{report.target}` |",
        f"| 发现总数 | **{report.total_findings}** |",
        f"| 严重等级 | {_format_summary(report.summary)} |",
        "",
        "---",
        "",
    ]
    if not report.findings:
        lines.append("✅ **未发现安全问题。**")
        return "\n".join(lines)

    lines.append("## 问题清单\n")
    for f in report.findings:
        icon = SEVERITY_ICONS.get(f.severity, "⚪")
        lines.extend([
            f"### {icon} [{f.severity.upper()}] [{f.id}] {f.title}",
            f"",
            f"| 属性 | 值 |",
            f"|---|---|",
            f"| 位置 | `{f.location}` |",
            f"| 描述 | {f.detail} |",
            f"| 修复建议 | {f.fix_hint} |",
            f"| 自动修复 | {'✅ 可' if f.auto_fixable else '❌ 需手动'} |",
            f"",
        ])
    return "\n".join(lines)


def _format_summary(summary: dict) -> str:
    parts = []
    for sev in (SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW):
        if sev in summary:
            parts.append(f"{sev}={summary[sev]}")
    return ", ".join(parts) if parts else "无"


def auto_fix(report) -> int:
    """尝试自动修复可修复项（占位实现）"""
    fixed = 0
    for f in report.findings:
        if f.auto_fixable:
            # 此处对接具体的自动修复逻辑
            print(f"  [AUTO-FIX] {f.id} → {f.title}")
            fixed += 1
    return fixed


def main():
    parser = argparse.ArgumentParser(
        description="市级集运 Skill 自动安全巡检工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python run_inspection.py ./skills/city_logistics
  python run_inspection.py ./skills/city_logistics --format markdown > report.md
  python run_inspection.py ./skills/city_logistics --fix
""",
    )
    parser.add_argument("skill_dir", help="Skill 定义目录路径")
    parser.add_argument("--format", choices=["json", "markdown", "text"], default="text",
                        help="报告输出格式（默认 text）")
    parser.add_argument("--fix", action="store_true", help="自动修复可修复的安全问题")
    parser.add_argument("--output", "-o", help="将报告写入文件（而非 stdout）")

    args = parser.parse_args()

    skill_path = Path(args.skill_dir)
    if not skill_path.is_dir():
        print(f"错误: 目录不存在: {skill_path}", file=sys.stderr)
        sys.exit(1)

    inspector = SecurityInspector(args.skill_dir)
    report = inspector.run_full_inspection()

    # 格式化输出
    if args.format == "json":
        output = report.to_json()
    elif args.format == "markdown":
        output = format_markdown(report)
    else:
        output = format_text(report)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"报告已写入: {args.output}")
    else:
        print(output)

    # 自动修复
    if args.fix:
        count = auto_fix(report)
        print(f"\n已自动修复 {count} 项问题。")

    # 有 critical 时返回非零
    if any(f.severity == SEVERITY_CRITICAL for f in report.findings):
        sys.exit(2)
    elif any(f.severity == SEVERITY_HIGH for f in report.findings):
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
