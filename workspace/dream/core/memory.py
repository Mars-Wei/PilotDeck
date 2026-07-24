"""
dream 记忆管理核心
整合存储、嵌入、摘要，提供高级记忆操作 API
"""

import logging
import time
from datetime import datetime
from typing import List, Dict, Optional, Tuple

from config import MAX_MEMORIES, SIMILARITY_THRESHOLD, FALLBACK_SIMILARITY_THRESHOLD
from core.storage import VectorStorage
from core.embedder import Embedder
from core.summarizer import Summarizer

logger = logging.getLogger(__name__)


class DreamMemory:
    """
    dream 长期记忆模块主类

    功能：
    - save(content): 向量化并保存记忆
    - search(query, top_k=5): 语义检索
    - recall_recent(limit=10): 回忆最近的记忆
    - refresh(): 自动刷新（清理过期/超限记忆）
    - on_voice_trigger(content): 语音指令触发保存
    """

    def __init__(self):
        self.storage = VectorStorage()
        self.embedder = Embedder()
        self.summarizer = Summarizer()
        logger.info(
            f"DreamMemory 初始化完成 | 嵌入模式: {'回退' if self.embedder.is_fallback else '模型'} | "
            f"摘要模式: {'回退' if self.summarizer.is_fallback else '模型'} | "
            f"当前记忆数: {self.storage.count()}"
        )

    def save(
        self,
        content: str,
        source: str = "manual",
        metadata: Optional[Dict] = None,
        timestamp: Optional[float] = None,
    ) -> Dict:
        """
        保存一段记忆
        1. 生成摘要
        2. 文本向量化
        3. 写入 SQLite

        :param content: 原始内容
        :param source: 来源标记（如 'voice', 'auto', 'manual'）
        :param metadata: 额外元数据
        :param timestamp: 自定义时间戳（秒级），默认当前时间
        :return: 保存的记忆信息
        """
        if not content or not content.strip():
            raise ValueError("记忆内容不能为空")

        logger.info(f"正在保存记忆 [source={source}] ...")

        # 1. 摘要
        summary = self.summarizer.summarize(content)

        # 2. 向量化
        vector = self.embedder.encode(content)

        # 3. 存储
        ts = timestamp if timestamp is not None else time.time()
        memory_id = self.storage.insert(
            content=content,
            vector=vector,
            summary=summary,
            source=source,
            metadata=metadata,
            timestamp=ts,
        )

        result = {
            "id": memory_id,
            "content": content,
            "summary": summary,
            "timestamp": ts,
            "source": source,
            "metadata": metadata,
        }
        logger.info(f"记忆保存成功 [id={memory_id}, summary='{summary[:40]}...']")
        return result

    def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = SIMILARITY_THRESHOLD,
        source: Optional[str] = None,
        time_range: Optional[Tuple[float, float]] = None,
    ) -> List[Dict]:
        """
        语义检索记忆
        """
        if not query or not query.strip():
            return []

        # 回退模式自动降低阈值以适配字符哈希签名
        if self.embedder.is_fallback and threshold == SIMILARITY_THRESHOLD:
            threshold = FALLBACK_SIMILARITY_THRESHOLD

        query_vector = self.embedder.encode(query)
        results = self.storage.search(
            query_vector=query_vector,
            top_k=top_k,
            threshold=threshold,
            source=source,
            time_range=time_range,
        )
        logger.info(f"检索 '{query[:30]}...' 返回 {len(results)} 条结果")
        return results

    def recall_recent(self, limit: int = 10) -> List[Dict]:
        """
        回忆最近的记忆
        """
        return self.storage.get_recent(limit=limit)

    def recall_by_date(self, date_str: str) -> List[Dict]:
        """
        按日期回忆 (格式: YYYY-MM-DD)
        """
        try:
            dt_start = datetime.strptime(date_str, "%Y-%m-%d")
            dt_end = datetime.fromtimestamp(dt_start.timestamp() + 86400)
            ts_start = dt_start.timestamp()
            ts_end = dt_end.timestamp()
        except ValueError:
            raise ValueError("日期格式应为 YYYY-MM-DD")

        # 用空向量 + 时间范围过滤来获取当天所有记忆
        # 为了效率，直接 SQL 查询
        import sqlite3
        from config import DB_PATH

        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, content, summary, timestamp, source, metadata
                FROM memories
                WHERE timestamp BETWEEN ? AND ?
                ORDER BY timestamp DESC
                """,
                (ts_start, ts_end),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "content": r["content"],
                    "summary": r["summary"],
                    "timestamp": r["timestamp"],
                    "source": r["source"],
                    "metadata": r["metadata"],
                }
                for r in rows
            ]

    def refresh(self) -> int:
        """
        自动刷新：清理超出上限的旧记忆
        :return: 删除的记录数
        """
        total = self.storage.count()
        if total <= MAX_MEMORIES:
            logger.info(f"自动刷新: 当前记忆数 {total}，未超过上限 {MAX_MEMORIES}，无需清理")
            return 0

        deleted = self.storage.delete_old(keep=MAX_MEMORIES)
        logger.info(f"自动刷新完成: 删除 {deleted} 条旧记忆，当前剩余 {self.storage.count()}")
        return deleted

    def on_voice_trigger(self, content: str, context: Optional[Dict] = None) -> Dict:
        """
        语音指令触发保存
        当监听到 '存入梦境' 等关键词时调用
        """
        metadata = context or {}
        metadata["trigger"] = "voice"
        metadata["trigger_time"] = time.time()
        return self.save(
            content=content,
            source="voice",
            metadata=metadata,
        )

    def get_stats(self) -> Dict:
        """获取记忆库统计信息"""
        total = self.storage.count()
        recent = self.recall_recent(limit=1)
        latest_ts = recent[0]["timestamp"] if recent else None
        return {
            "total_memories": total,
            "max_capacity": MAX_MEMORIES,
            "latest_memory_ts": latest_ts,
            "latest_memory_dt": datetime.fromtimestamp(latest_ts).isoformat() if latest_ts else None,
            "embedder_fallback": self.embedder.is_fallback,
            "summarizer_fallback": self.summarizer.is_fallback,
        }

    def forget(self, memory_id: int) -> bool:
        """删除单条记忆"""
        import sqlite3
        from config import DB_PATH
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.commit()
            return cursor.rowcount > 0

    def clear_all(self):
        """清空所有记忆（危险操作）"""
        self.storage.clear_all()
        logger.warning("所有记忆已被清空")
