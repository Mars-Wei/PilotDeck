"""
dream 模块 - 神经可塑性引擎

核心原理：
1. Hebbian 学习: "Neurons that fire together, wire together"
   - 同时被激活的记忆片段之间的连接权重增加
2. 长时程增强(LTP): 反复访问导致热度持久提升
3. 突触衰减: 不活跃的连接随时间弱化（遗忘曲线，近似指数衰减）
4. 记忆巩固: 高热度的记忆衰减更慢（蛋白合成假设的简化模拟）
"""

import math
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from dream.config import SIMILARITY_THRESHOLD
from dream.models import (
    AssociationEdge, EventType, MemoryFragment, MemoryNetwork, StrengthenEvent
)
from dream.store import MemoryStore


class PlasticityEngine:
    """神经可塑性引擎"""
    
    # 衰减参数（半衰期，单位：小时）
    HEAT_HALF_LIFE_HOURS = 48.0      # 热度半衰期
    WEIGHT_HALF_LIFE_HOURS = 72.0    # 权重半衰期
    
    # 学习率
    HEAT_LEARNING_RATE = 0.15        # 访问时热度增量
    WEIGHT_LEARNING_RATE = 0.12      # 共激活时权重增量
    MAX_HEAT = 1.0
    MAX_WEIGHT = 1.0
    MIN_HEAT = 0.05
    MIN_WEIGHT = 0.05
    
    def __init__(self, store: MemoryStore):
        self.store = store
    
    @property
    def heat_decay_rate(self) -> float:
        """热度衰减率 (lambda)"""
        return math.log(2) / self.HEAT_HALF_LIFE_HOURS
    
    @property
    def weight_decay_rate(self) -> float:
        """权重衰减率 (lambda)"""
        return math.log(2) / self.WEIGHT_HALF_LIFE_HOURS
    
    def _hours_since(self, dt: Optional[datetime]) -> float:
        """计算自 dt 到现在的小时数"""
        if dt is None:
            return 1e6  # 很久之前
        delta = datetime.now() - dt
        return delta.total_seconds() / 3600.0
    
    def decay_heat(self, fragment: MemoryFragment) -> float:
        """计算衰减后的热度"""
        hours = self._hours_since(fragment.last_accessed or fragment.created_at)
        # 高热度记忆衰减更慢（巩固效应）
        consolidation_factor = 0.5 + 0.5 * (1 - fragment.heat)  # heat=1 -> factor=0.5 (慢), heat=0 -> factor=1.0 (快)
        effective_rate = self.heat_decay_rate * consolidation_factor
        decayed = fragment.heat * math.exp(-effective_rate * hours)
        return max(self.MIN_HEAT, decayed)
    
    def decay_weight(self, edge: AssociationEdge) -> float:
        """计算衰减后的权重"""
        hours = self._hours_since(edge.last_coactivated or edge.created_at)
        decayed = edge.weight * math.exp(-self.weight_decay_rate * hours)
        return max(self.MIN_WEIGHT, decayed)
    
    def access_memory(self, fragment: MemoryFragment, context_fragments: Optional[List[MemoryFragment]] = None) -> Tuple[MemoryFragment, List[StrengthenEvent]]:
        """
        访问记忆 - 触发 LTP 和 Hebbian 学习
        
        Args:
            fragment: 被访问的记忆
            context_fragments: 同时被激活的上下文记忆（用于 Hebbian 学习）
        
        Returns:
            (更新后的记忆, 产生的事件列表)
        """
        events = []
        now = datetime.now()
        
        # 1. 应用热度衰减
        old_heat = fragment.heat
        fragment.heat = self.decay_heat(fragment)
        
        # 2. LTP: 访问导致热度增加（但边际递减）
        # 访问次数越多，单次增量越小（饱和效应）
        saturation = 1.0 / (1.0 + 0.1 * fragment.access_count)
        delta_heat = self.HEAT_LEARNING_RATE * saturation
        fragment.heat = min(self.MAX_HEAT, fragment.heat + delta_heat)
        fragment.last_accessed = now
        fragment.access_count += 1
        
        self.store.save_fragment(fragment)
        
        events.append(StrengthenEvent(
            id=str(uuid.uuid4()),
            memory_id=fragment.id,
            event_type=EventType.MEMORY_ACCESS,
            timestamp=now,
            detail=f"访问记忆: {fragment.content[:30]}...",
            delta_value=fragment.heat - old_heat
        ))
        
        # 3. Hebbian 学习: 上下文记忆间的连接增强
        if context_fragments:
            for ctx in context_fragments:
                if ctx.id == fragment.id:
                    continue
                edge, ev = self._coactivate(fragment, ctx, now)
                if ev:
                    events.append(ev)
        
        # 保存事件
        for ev in events:
            self.store.save_event(ev)
        
        return fragment, events
    
    def strengthen_memory(self, fragment: MemoryFragment, intensity: float = 0.3) -> Tuple[MemoryFragment, StrengthenEvent]:
        """主动强化记忆 - 模拟主动复习/巩固"""
        old_heat = fragment.heat
        fragment.heat = self.decay_heat(fragment)
        fragment.heat = min(self.MAX_HEAT, fragment.heat + intensity)
        fragment.strengthen_count += 1
        fragment.last_accessed = datetime.now()
        self.store.save_fragment(fragment)
        
        event = StrengthenEvent(
            id=str(uuid.uuid4()),
            memory_id=fragment.id,
            event_type=EventType.MEMORY_STRENGTHEN,
            timestamp=datetime.now(),
            detail=f"强化记忆: {fragment.content[:30]}...",
            delta_value=fragment.heat - old_heat
        )
        self.store.save_event(event)
        return fragment, event
    
    def _coactivate(self, f1: MemoryFragment, f2: MemoryFragment, now: datetime) -> Tuple[Optional[AssociationEdge], Optional[StrengthenEvent]]:
        """两个记忆共激活 - Hebbian 学习核心"""
        # 查找或创建边
        edge = self.store.get_edge_by_nodes(f1.id, f2.id)
        if edge is None:
            edge = AssociationEdge(
                id=str(uuid.uuid4()),
                source_id=f1.id,
                target_id=f2.id,
                weight=0.1,
                created_at=now
            )
        
        # 应用权重衰减
        old_weight = edge.weight
        edge.weight = self.decay_weight(edge)
        
        # Hebbian 增强: 两个节点的热度越高，增强越多
        coactivation_strength = (f1.heat + f2.heat) / 2.0
        delta_w = self.WEIGHT_LEARNING_RATE * coactivation_strength
        edge.weight = min(self.MAX_WEIGHT, edge.weight + delta_w)
        edge.co_activation_count += 1
        edge.last_coactivated = now
        
        self.store.save_edge(edge)
        
        event = StrengthenEvent(
            id=str(uuid.uuid4()),
            edge_id=edge.id,
            event_type=EventType.EDGE_COACTIVATION,
            timestamp=now,
            detail=f"共激活: {f1.content[:20]}... <-> {f2.content[:20]}...",
            delta_value=edge.weight - old_weight
        )
        self.store.save_event(event)
        return edge, event
    
    def add_fragment(self, content: str, vector: Optional[List[float]] = None, 
                     related_ids: Optional[List[str]] = None) -> MemoryFragment:
        """添加新记忆片段，并可选建立初始连接"""
        now = datetime.now()
        fragment = MemoryFragment(
            id=str(uuid.uuid4()),
            content=content,
            vector=vector or [],
            heat=0.5,  # 新记忆初始热度
            created_at=now,
            last_accessed=now,
            access_count=1
        )
        self.store.save_fragment(fragment)
        
        # 记录事件
        event = StrengthenEvent(
            id=str(uuid.uuid4()),
            memory_id=fragment.id,
            event_type=EventType.MEMORY_ACCESS,
            timestamp=now,
            detail=f"新记忆存入: {content[:30]}...",
            delta_value=0.5
        )
        self.store.save_event(event)
        self.store.save_event(event)
        
        # 与相关记忆建立弱连接
        if related_ids:
            for rid in related_ids:
                rel = self.store.get_fragment(rid)
                if rel:
                    self._coactivate(fragment, rel, now)
        
        return fragment
    
    def consolidate(self) -> List[StrengthenEvent]:
        """
        记忆巩固 - 遍历所有记忆，应用衰减，对高热度记忆进行"巩固"
        对应睡眠中的记忆巩固过程
        """
        events = []
        fragments = self.store.get_all_fragments()
        
        for f in fragments:
            old_heat = f.heat
            new_heat = self.decay_heat(f)
            
            # 巩固: 热度 > 0.7 的记忆，衰减后略有恢复（系统巩固）
            if old_heat > 0.7 and new_heat > 0.5:
                new_heat = min(self.MAX_HEAT, new_heat + 0.03)
                event = StrengthenEvent(
                    id=str(uuid.uuid4()),
                    memory_id=f.id,
                    event_type=EventType.CONSOLIDATION,
                    timestamp=datetime.now(),
                    detail=f"系统巩固: {f.content[:30]}...",
                    delta_value=new_heat - old_heat
                )
                events.append(event)
                self.store.save_event(event)
            
            f.heat = new_heat
            self.store.save_fragment(f)
        
        # 也衰减所有边
        edges = self.store.get_all_edges()
        for e in edges:
            e.weight = self.decay_weight(e)
            self.store.save_edge(e)
        
        return events
    
    def compute_similarity_edges(self, fragments: Optional[List[MemoryFragment]] = None, 
                                  top_k: int = 3) -> List[AssociationEdge]:
        """
        基于向量相似度建立/更新连接
        模拟神经科学中的"模式完成"（pattern completion）
        """
        if fragments is None:
            fragments = self.store.get_all_fragments()
        
        # 只有带向量的才能计算相似度
        vecs = [(f, f.vector) for f in fragments if f.vector]
        if len(vecs) < 2:
            return []
        
        new_edges = []
        for i, (f1, v1) in enumerate(vecs):
            similarities = []
            for j, (f2, v2) in enumerate(vecs):
                if i == j:
                    continue
                sim = self._cosine_similarity(v1, v2)
                similarities.append((sim, f2))
            
            similarities.sort(reverse=True)
            for sim, f2 in similarities[:top_k]:
                if sim >= SIMILARITY_THRESHOLD:
                    edge = self.store.get_edge_by_nodes(f1.id, f2.id)
                    if edge is None:
                        edge = AssociationEdge(
                            id=str(uuid.uuid4()),
                            source_id=f1.id,
                            target_id=f2.id,
                            weight=sim * 0.5,  # 初始权重基于相似度
                            created_at=datetime.now()
                        )
                        self.store.save_edge(edge)
                        new_edges.append(edge)
                    else:
                        # 如果已有边，略微增强（类似反复共现）
                        edge.weight = min(self.MAX_WEIGHT, edge.weight + sim * 0.02)
                        self.store.save_edge(edge)
        
        return new_edges
    
    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        """计算余弦相似度"""
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
