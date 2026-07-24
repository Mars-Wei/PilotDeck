"""
dream 模块 - 数据模型
基于神经可塑性原理的记忆网络模型
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Optional, Tuple


class EventType(str, Enum):
    """强化事件类型"""
    MEMORY_ACCESS = "memory_access"           # 记忆被访问
    MEMORY_STRENGTHEN = "memory_strengthen"   # 记忆被主动强化
    EDGE_COACTIVATION = "edge_coactivation"   # 边共激活
    EDGE_STRENGTHEN = "edge_strengthen"       # 边被强化
    CONSOLIDATION = "consolidation"           # 记忆巩固


@dataclass
class MemoryFragment:
    """记忆片段 - 对应神经元/节点
    
    热度(heat)模拟神经元的兴奋性水平：
    - 高热度 = 高频激活的神经元群，更容易被唤起
    - 热度随访问增加（LTP长时程增强）
    - 热度随时间衰减（不激活的突触弱化）
    """
    id: str
    content: str
    vector: List[float] = field(default_factory=list)
    heat: float = 0.5                        # 初始热度 0.5
    created_at: datetime = field(default_factory=datetime.now)
    last_accessed: Optional[datetime] = None
    access_count: int = 0
    strengthen_count: int = 0
    
    @property
    def heat_color(self) -> str:
        """根据热度返回颜色 (蓝色->青色->绿色->黄色->红色)"""
        # heat 0.0-1.0 映射到色温
        if self.heat < 0.2:
            return "#3b82f6"  # 蓝 - 冷记忆
        elif self.heat < 0.4:
            return "#06b6d4"  # 青
        elif self.heat < 0.6:
            return "#10b981"  # 绿
        elif self.heat < 0.8:
            return "#f59e0b"  # 橙黄
        else:
            return "#ef4444"  # 红 - 热记忆
    
    @property
    def heat_radius(self) -> float:
        """节点半径基于热度"""
        return 15 + self.heat * 25  # 15-40
    
    @property
    def is_today(self) -> bool:
        """是否为今日存入"""
        now = datetime.now()
        return (self.created_at.year == now.year and 
                self.created_at.month == now.month and 
                self.created_at.day == now.day)


@dataclass
class AssociationEdge:
    """关联边 - 对应突触连接
    
    权重(weight)模拟突触强度：
    - 高权重 = 强突触连接，信号传导效率高
    - 遵循 Hebbian 学习规则：一起激活的神经元，连接增强
    - 权重也随时间衰减（遗忘曲线）
    """
    id: str
    source_id: str
    target_id: str
    weight: float = 0.3                       # 初始权重
    co_activation_count: int = 0
    last_coactivated: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.now)
    
    @property
    def stroke_width(self) -> float:
        """线条宽度基于权重"""
        return 1 + self.weight * 4  # 1-5
    
    @property
    def opacity(self) -> float:
        """透明度基于权重"""
        return 0.2 + self.weight * 0.8  # 0.2-1.0
    
    @property
    def gradient_color(self) -> Tuple[str, str]:
        """渐变颜色基于权重 (低=灰蓝, 高=金橙)"""
        if self.weight < 0.3:
            return ("#94a3b8", "#64748b")
        elif self.weight < 0.6:
            return ("#60a5fa", "#3b82f6")
        elif self.weight < 0.8:
            return ("#fbbf24", "#f59e0b")
        else:
            return ("#f472b6", "#db2777")


@dataclass
class StrengthenEvent:
    """强化事件 - 记录可塑性变化的历史
    
    对应神经科学中的"强化事件"：
    - 每次 LTP/LTD 的发生都有时间戳
    - 可以用于追溯记忆巩固的过程
    """
    id: str
    memory_id: Optional[str] = None
    edge_id: Optional[str] = None
    event_type: EventType = EventType.MEMORY_ACCESS
    timestamp: datetime = field(default_factory=datetime.now)
    detail: str = ""
    delta_value: float = 0.0                  # 变化量（热度或权重的增量）


@dataclass
class MemoryNetwork:
    """记忆网络 - 完整的图结构"""
    fragments: List[MemoryFragment] = field(default_factory=list)
    edges: List[AssociationEdge] = field(default_factory=list)
    events: List[StrengthenEvent] = field(default_factory=list)
    
    def get_fragment(self, fid: str) -> Optional[MemoryFragment]:
        for f in self.fragments:
            if f.id == fid:
                return f
        return None
    
    def get_edges_for_fragment(self, fid: str) -> List[AssociationEdge]:
        return [e for e in self.edges if e.source_id == fid or e.target_id == fid]
    
    def get_today_fragments(self) -> List[MemoryFragment]:
        return [f for f in self.fragments if f.is_today]
