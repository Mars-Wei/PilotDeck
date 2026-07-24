"""
dream 模块 - 存储层
SQLite + JSON 向量存储（轻量本地方案）
"""

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

from dream.config import DB_PATH, VECTOR_DIM
from dream.models import (
    AssociationEdge, EventType, MemoryFragment, MemoryNetwork, StrengthenEvent
)


class MemoryStore:
    """记忆存储 - SQLite 持久化"""
    
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._ensure_tables()
    
    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _ensure_tables(self):
        """创建必要的表"""
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memory_fragments (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    vector TEXT,  -- JSON array
                    heat REAL DEFAULT 0.5,
                    created_at TEXT,
                    last_accessed TEXT,
                    access_count INTEGER DEFAULT 0,
                    strengthen_count INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS association_edges (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    weight REAL DEFAULT 0.3,
                    co_activation_count INTEGER DEFAULT 0,
                    last_coactivated TEXT,
                    created_at TEXT,
                    UNIQUE(source_id, target_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS strengthen_events (
                    id TEXT PRIMARY KEY,
                    memory_id TEXT,
                    edge_id TEXT,
                    event_type TEXT,
                    timestamp TEXT,
                    detail TEXT,
                    delta_value REAL DEFAULT 0.0
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_fragments_created 
                ON memory_fragments(created_at)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_events_timestamp 
                ON strengthen_events(timestamp)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_events_memory 
                ON strengthen_events(memory_id)
            """)
            conn.commit()
    
    # ---- MemoryFragment CRUD ----
    
    def save_fragment(self, fragment: MemoryFragment) -> MemoryFragment:
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO memory_fragments
                (id, content, vector, heat, created_at, last_accessed, access_count, strengthen_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                fragment.id, fragment.content,
                json.dumps(fragment.vector) if fragment.vector else None,
                fragment.heat,
                fragment.created_at.isoformat() if fragment.created_at else None,
                fragment.last_accessed.isoformat() if fragment.last_accessed else None,
                fragment.access_count, fragment.strengthen_count
            ))
            conn.commit()
        return fragment
    
    def get_fragment(self, fid: str) -> Optional[MemoryFragment]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM memory_fragments WHERE id = ?", (fid,)
            ).fetchone()
        return self._row_to_fragment(row) if row else None
    
    def get_all_fragments(self) -> List[MemoryFragment]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM memory_fragments ORDER BY created_at DESC").fetchall()
        return [self._row_to_fragment(r) for r in rows]
    
    def get_fragments_by_date(self, date_str: str) -> List[MemoryFragment]:
        """获取某一天的记忆片段，date_str: YYYY-MM-DD"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM memory_fragments WHERE created_at LIKE ? ORDER BY created_at DESC",
                (f"{date_str}%",)
            ).fetchall()
        return [self._row_to_fragment(r) for r in rows]
    
    def delete_fragment(self, fid: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM memory_fragments WHERE id = ?", (fid,))
            conn.execute("DELETE FROM association_edges WHERE source_id = ? OR target_id = ?", (fid, fid))
            conn.execute("DELETE FROM strengthen_events WHERE memory_id = ?", (fid,))
            conn.commit()
    
    # ---- AssociationEdge CRUD ----
    
    def save_edge(self, edge: AssociationEdge) -> AssociationEdge:
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO association_edges
                (id, source_id, target_id, weight, co_activation_count, last_coactivated, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                edge.id, edge.source_id, edge.target_id,
                edge.weight, edge.co_activation_count,
                edge.last_coactivated.isoformat() if edge.last_coactivated else None,
                edge.created_at.isoformat() if edge.created_at else None
            ))
            conn.commit()
        return edge
    
    def get_edge(self, eid: str) -> Optional[AssociationEdge]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM association_edges WHERE id = ?", (eid,)).fetchone()
        return self._row_to_edge(row) if row else None
    
    def get_edge_by_nodes(self, source_id: str, target_id: str) -> Optional[AssociationEdge]:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT * FROM association_edges 
                   WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)""",
                (source_id, target_id, target_id, source_id)
            ).fetchone()
        return self._row_to_edge(row) if row else None
    
    def get_all_edges(self) -> List[AssociationEdge]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM association_edges").fetchall()
        return [self._row_to_edge(r) for r in rows]
    
    def get_edges_for_fragment(self, fid: str) -> List[AssociationEdge]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM association_edges WHERE source_id = ? OR target_id = ?",
                (fid, fid)
            ).fetchall()
        return [self._row_to_edge(r) for r in rows]
    
    # ---- StrengthenEvent CRUD ----
    
    def save_event(self, event: StrengthenEvent) -> StrengthenEvent:
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO strengthen_events
                (id, memory_id, edge_id, event_type, timestamp, detail, delta_value)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                event.id, event.memory_id, event.edge_id,
                event.event_type.value if event.event_type else None,
                event.timestamp.isoformat() if event.timestamp else None,
                event.detail, event.delta_value
            ))
            conn.commit()
        return event
    
    def get_events_for_memory(self, fid: str, limit: int = 50) -> List[StrengthenEvent]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM strengthen_events 
                   WHERE memory_id = ? OR edge_id IN (
                       SELECT id FROM association_edges WHERE source_id = ? OR target_id = ?
                   )
                   ORDER BY timestamp DESC LIMIT ?""",
                (fid, fid, fid, limit)
            ).fetchall()
        return [self._row_to_event(r) for r in rows]
    
    def get_all_events(self, limit: int = 200) -> List[StrengthenEvent]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM strengthen_events ORDER BY timestamp DESC LIMIT ?",
                (limit,)
            ).fetchall()
        return [self._row_to_event(r) for r in rows]
    
    def get_events_by_date(self, date_str: str) -> List[StrengthenEvent]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM strengthen_events WHERE timestamp LIKE ? ORDER BY timestamp DESC",
                (f"{date_str}%",)
            ).fetchall()
        return [self._row_to_event(r) for r in rows]
    
    # ---- Network Load ----
    
    def load_network(self) -> MemoryNetwork:
        """加载完整网络"""
        return MemoryNetwork(
            fragments=self.get_all_fragments(),
            edges=self.get_all_edges(),
            events=self.get_all_events()
        )
    
    # ---- Row Converters ----
    
    def _row_to_fragment(self, row: sqlite3.Row) -> MemoryFragment:
        return MemoryFragment(
            id=row["id"],
            content=row["content"],
            vector=json.loads(row["vector"]) if row["vector"] else [],
            heat=row["heat"],
            created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else datetime.now(),
            last_accessed=datetime.fromisoformat(row["last_accessed"]) if row["last_accessed"] else None,
            access_count=row["access_count"],
            strengthen_count=row["strengthen_count"]
        )
    
    def _row_to_edge(self, row: sqlite3.Row) -> AssociationEdge:
        return AssociationEdge(
            id=row["id"],
            source_id=row["source_id"],
            target_id=row["target_id"],
            weight=row["weight"],
            co_activation_count=row["co_activation_count"],
            last_coactivated=datetime.fromisoformat(row["last_coactivated"]) if row["last_coactivated"] else None,
            created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else datetime.now()
        )
    
    def _row_to_event(self, row: sqlite3.Row) -> StrengthenEvent:
        return StrengthenEvent(
            id=row["id"],
            memory_id=row["memory_id"],
            edge_id=row["edge_id"],
            event_type=EventType(row["event_type"]) if row["event_type"] else EventType.MEMORY_ACCESS,
            timestamp=datetime.fromisoformat(row["timestamp"]) if row["timestamp"] else datetime.now(),
            detail=row["detail"] or "",
            delta_value=row["delta_value"] if row["delta_value"] is not None else 0.0
        )
