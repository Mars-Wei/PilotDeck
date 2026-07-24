#!/usr/bin/env python3
"""
独立刷新脚本，供系统 cron 直接调用
清理两个记忆系统：
  1. memories 表（DreamMemory / VectorStorage）—— 保留最近 MAX_MEMORIES 条
  2. memory_fragments 表（MemoryStore 旧系统）—— 删除热度低于 FRAGMENT_HEAT_THRESHOLD 的冷记忆
用法：
    python scripts/auto_refresh.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

from core.memory import DreamMemory
from config import DB_PATH, FRAGMENT_HEAT_THRESHOLD


def _clean_memory_fragments() -> int:
    """清理 memory_fragments 中热度低于阈值的冷记忆及其关联数据"""
    import sqlite3

    with sqlite3.connect(DB_PATH) as conn:
        # 找到需要删除的冷记忆 ID
        cold_ids = [
            r[0] for r in conn.execute(
                "SELECT id FROM memory_fragments WHERE heat < ?",
                (FRAGMENT_HEAT_THRESHOLD,),
            ).fetchall()
        ]
        if not cold_ids:
            return 0

        # 删除关联数据
        for fid in cold_ids:
            conn.execute("DELETE FROM association_edges WHERE source_id = ? OR target_id = ?", (fid, fid))
            conn.execute("DELETE FROM strengthen_events WHERE memory_id = ?", (fid,))
        # 删除冷记忆
        placeholders = ",".join("?" * len(cold_ids))
        conn.execute(f"DELETE FROM memory_fragments WHERE id IN ({placeholders})", cold_ids)
        conn.commit()

    logging.info(f"[auto_refresh] 清理 {len(cold_ids)} 条冷记忆片段 (heat < {FRAGMENT_HEAT_THRESHOLD})")
    return len(cold_ids)


def main():
    # 系统 1：VectorStorage 的 memories 表
    memory = DreamMemory()
    deleted = memory.refresh()
    total = memory.storage.count()
    logging.info(f"[auto_refresh] memories 表: 删除 {deleted} 条旧记忆，当前共 {total} 条")

    # 系统 2：MemoryStore 的 memory_fragments 表
    frag_deleted = _clean_memory_fragments()

    # 最终状态汇总
    import sqlite3
    with sqlite3.connect(DB_PATH) as conn:
        remaining_frags = conn.execute("SELECT COUNT(*) FROM memory_fragments").fetchone()[0]
        remaining_edges = conn.execute("SELECT COUNT(*) FROM association_edges").fetchone()[0]
        remaining_events = conn.execute("SELECT COUNT(*) FROM strengthen_events").fetchone()[0]
    logging.info(
        f"[auto_refresh] 汇总: fragments={remaining_frags}, edges={remaining_edges}, "
        f"events={remaining_events}, 本次共删除 {deleted + frag_deleted} 条"
    )


if __name__ == "__main__":
    main()
