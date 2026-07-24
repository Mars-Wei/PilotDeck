"""
dream 长期记忆模块
==================
基于神经可塑性原理的轻量本地记忆系统

核心能力：
- 记忆片段存储（SQLite + 可选向量）
- 神经可塑性模拟（Hebbian学习、LTP、衰减、巩固）
- 可视化图谱生成（HTML 力导向图 + 时间轴）

使用示例：
    from dream import Dream
    
    dream = Dream()
    
    # 存入记忆
    mem = dream.store("今天学习了神经可塑性原理")
    
    # 访问记忆（触发LTP）
    dream.access(mem.id)
    
    # 生成可视化图谱
    dream.visualize()
"""

from dream.config import (
    BASE_DIR, DATA_DIR, DB_PATH, EMBEDDING_DEVICE, EMBEDDING_MODEL_NAME,
    LOG_FORMAT, LOG_LEVEL, MAX_MEMORIES, SCHEDULE_HOUR, SCHEDULE_MINUTE,
    SIMILARITY_THRESHOLD, SUMMARY_MAX_LENGTH, VECTOR_DIM, VOICE_TRIGGER_KEYWORDS,
)
from dream.models import (
    AssociationEdge, EventType, MemoryFragment, MemoryNetwork, StrengthenEvent,
)
from dream.plasticity import PlasticityEngine
from dream.store import MemoryStore
from dream.visualizer import NetworkVisualizer


class Dream:
    """Dream 模块主入口"""
    
    def __init__(self, db_path=None):
        self.store = MemoryStore(db_path or DB_PATH)
        self.plasticity = PlasticityEngine(self.store)
        self.visualizer = NetworkVisualizer(self.store)
    
    def store_memory(self, content: str, vector=None, related_ids=None) -> MemoryFragment:
        """存入新记忆片段"""
        return self.plasticity.add_fragment(content, vector, related_ids)
    
    def access(self, memory_id: str, context_ids=None):
        """访问记忆，触发 LTP 和 Hebbian 学习"""
        fragment = self.store.get_fragment(memory_id)
        if not fragment:
            raise ValueError(f"Memory not found: {memory_id}")
        context = None
        if context_ids:
            context = [self.store.get_fragment(cid) for cid in context_ids if self.store.get_fragment(cid)]
        return self.plasticity.access_memory(fragment, context)
    
    def strengthen(self, memory_id: str, intensity=0.3):
        """主动强化记忆"""
        fragment = self.store.get_fragment(memory_id)
        if not fragment:
            raise ValueError(f"Memory not found: {memory_id}")
        return self.plasticity.strengthen_memory(fragment, intensity)
    
    def consolidate(self):
        """执行记忆巩固（衰减 + 系统恢复）"""
        return self.plasticity.consolidate()
    
    def compute_similarity_edges(self, top_k=3):
        """基于向量相似度计算连接"""
        return self.plasticity.compute_similarity_edges(top_k=top_k)
    
    def visualize(self, output_path=None, show_today_only=True, include_neighbors=True):
        """
        生成 HTML 可视化图谱
        
        Args:
            output_path: 输出文件路径，默认 data/memory_graph.html
            show_today_only: 默认只展示今日存入的片段
            include_neighbors: 是否包含相邻节点
        """
        return self.visualizer.generate(
            output_path=output_path,
            show_today_only=show_today_only,
            include_neighbors=include_neighbors
        )
    
    def get_network(self) -> MemoryNetwork:
        """获取完整记忆网络"""
        return self.store.load_network()
    
    def get_today_memories(self):
        """获取今日存入的记忆"""
        today_str = __import__('datetime').datetime.now().strftime("%Y-%m-%d")
        return self.store.get_fragments_by_date(today_str)


__all__ = [
    "Dream",
    "MemoryStore",
    "PlasticityEngine",
    "NetworkVisualizer",
    "MemoryFragment",
    "AssociationEdge",
    "StrengthenEvent",
    "EventType",
    "MemoryNetwork",
]
