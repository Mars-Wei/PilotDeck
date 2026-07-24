#!/bin/bash
# ============================================================
# 市级集运 Skill 安全巡检 —— 一键执行脚本
# ============================================================
# 用法:
#   chmod +x run_inspection.sh
#   ./run_inspection.sh                     # 检查当前目录
#   ./run_inspection.sh ./my-skill          # 检查指定 Skill
#   ./run_inspection.sh ./my-skill --fix    # 检查并自动修复
#   ./run_inspection.sh ./my-skill -o report.json --format json
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="${1:-.}"

echo "=============================================="
echo "  市级集运 Skill 自动安全巡检工具 v1.0"
echo "=============================================="
echo "  巡检目标: ${SKILL_DIR}"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "----------------------------------------------"

# 检查 Python 环境
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" &>/dev/null; then
    echo "错误: 未找到 python3"
    exit 1
fi

# 运行巡检
exec "$PYTHON" "${SCRIPT_DIR}/run_inspection.py" "$@"
