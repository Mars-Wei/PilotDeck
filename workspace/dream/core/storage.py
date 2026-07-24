"""
轻量本地向量存储层
基于 SQLite + 纯 Python 向量运算，零外部依赖
"""

import sqlite3
import json
import struct
import math
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from pathlib import Path

from config import DB_PATH, VECTOR_DIM, SIMILARITY_THRESHOLD


def _vector_to_blob(vec: List[float]) -> bytes:
    """将 float 列表序列化为二进制 blob（float32）"""
    return struct.pack(f"<{len(vec)}f", *vec)


def _blob_to_vector(blob: bytes) -> List[float]:
    """将二进制 blob 反序列化为 float 列表"""
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """计算两个向量的余弦相似度（纯 Python）"""
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


class VectorStorage:
    """
    轻量向量存储
    - SQLite 持久化
    - 纯 Python 做向量运算
    - 支持时间戳、摘要、元数据
    """

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """初始化数据库表结构"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    summary TEXT,
                    vector BLOB NOT NULL,
                    timestamp REAL NOT NULL,
                    source TEXT DEFAULT 'manual',
                    metadata TEXT,
                    created_at REAL DEFAULT (unixepoch())
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memories_timestamp
                ON memories(timestamp)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memories_source
                ON memories(source)
            """)
            conn.commit()

    def insert(
        self,
        content: str,
        vector: List[float],
        summary: Optional[str] = None,
        source: str = "manual",
        metadata: Optional[Dict] = None,
        timestamp: Optional[float] = None,
    ) -> int:
        """
        插入一条记忆
        :return: 插入的记忆 ID
        """
        if len(vector) != VECTOR_DIM:
            raise ValueError(f"向量维度必须为 {VECTOR_DIM}，收到 {len(vector)}")

        vector_blob = _vector_to_blob(vector)
        ts = timestamp if timestamp is not None else datetime.now().timestamp()
        meta_str = json.dumps(metadata, ensure_ascii=False) if metadata else None

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO memories (content, summary, vector, timestamp, source, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (content, summary, vector_blob, ts, source, meta_str),
            )
            conn.commit()
            return cursor.lastrowid

    def search(
        self,
        query_vector: List[float],
        top_k: int = 5,
        threshold: float = SIMILARITY_THRESHOLD,
        source: Optional[str] = None,
        time_range: Optional[Tuple[float, float]] = None,
    ) -> List[Dict]:
        """
        向量相似度检索
        """
        results = []

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            sql = "SELECT id, content, summary, vector, timestamp, source, metadata FROM memories WHERE 1=1"
            params = []

            if source:
                sql += " AND source = ?"
                params.append(source)
            if time_range:
                sql += " AND timestamp BETWEEN ? AND ?"
                params.extend(time_range)

            rows = conn.execute(sql, params).fetchall()

        for row in rows:
            vec = _blob_to_vector(row["vector"])
            sim = cosine_similarity(query_vector, vec)
            if sim >= threshold:
                results.append({
                    "id": row["id"],
                    "content": row["content"],
                    "summary": row["summary"],
                    "timestamp": row["timestamp"],
                    "source": row["source"],
                    "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
                    "similarity": round(sim, 4),
                })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    def get_by_id(self, memory_id: int) -> Optional[Dict]:
        """根据 ID 获取单条记忆"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "content": row["content"],
                "summary": row["summary"],
                "timestamp": row["timestamp"],
                "source": row["source"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
            }

    def get_recent(self, limit: int = 10) -> List[Dict]:
        """获取最近存入的记忆"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, content, summary, timestamp, source, metadata
                FROM memories
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "content": r["content"],
                    "summary": r["summary"],
                    "timestamp": r["timestamp"],
                    "source": r["source"],
                    "metadata": json.loads(r["metadata"]) if r["metadata"] else None,
                }
                for r in rows
            ]

    def delete_old(self, keep: int = 1000) -> int:
        """
        自动刷新：保留最近的 keep 条，删除其余
        :return: 删除的记录数
        """
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT id FROM memories
                ORDER BY timestamp DESC
                LIMIT -1 OFFSET ?
                """,
                (keep,),
            ).fetchall()
            ids_to_delete = [r[0] for r in rows]
            if not ids_to_delete:
                return 0
            placeholders = ",".join("?" * len(ids_to_delete))
            conn.execute(
                f"DELETE FROM memories WHERE id IN ({placeholders})",
                ids_to_delete,
            )
            conn.commit()
            return len(ids_to_delete)

    def count(self) -> int:
        """统计记忆总数"""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT COUNT(*) FROM memories").fetchone()
            return row[0] if row else 0

    def clear_all(self):
        """清空所有记忆（危险操作）"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM memories")
            conn.commit()
