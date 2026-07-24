"""
dream API 服务层
封装记忆核心，对外提供简洁接口
"""

import logging
from typing import List, Dict, Optional, Tuple

from core.memory import DreamMemory
from core.listener import VoiceListener
from core.scheduler import create_default_scheduler

logger = logging.getLogger(__name__)


class DreamServer:
    """
    dream 长期记忆服务总线

    用法：
        server = DreamServer()
        server.start()

        # 手动保存
        server.save_memory("今天我做了一个奇怪的梦...")

        # 模拟语音流
        server.feed_voice("刚才说到哪里了")
        server.feed_voice("存入梦境，我梦见自己在飞")

        # 检索
        results = server.search("梦见飞翔")

        # 停止
        server.stop()
    """

    def __init__(self):
        self.memory = DreamMemory()
        self.scheduler = create_default_scheduler(self._on_refresh)
        self.listener = VoiceListener(on_trigger=self._on_voice_trigger)
        self._started = False

    def _on_refresh(self):
        """定时刷新回调"""
        logger.info("[定时任务] 开始自动刷新记忆库")
        deleted = self.memory.refresh()
        logger.info(f"[定时任务] 自动刷新完成，清理 {deleted} 条记忆")

    def _on_voice_trigger(self, content: str, context: dict):
        """语音触发回调"""
        logger.info(f"[语音触发] 保存记忆，长度 {len(content)}")
        self.memory.on_voice_trigger(content, context)

    def start(self):
        """启动所有服务（调度器 + 监听器）"""
        if self._started:
            return
        self.scheduler.start()
        self.listener.start()
        self._started = True
        logger.info("DreamServer 已启动")

    def stop(self):
        """停止所有服务"""
        if not self._started:
            return
        self.scheduler.stop()
        self.listener.stop()
        self._started = False
        logger.info("DreamServer 已停止")

    def save_memory(self, content: str, source: str = "manual", metadata: Optional[Dict] = None) -> Dict:
        """手动保存记忆"""
        return self.memory.save(content, source=source, metadata=metadata)

    def search(self, query: str, top_k: int = 5, **kwargs) -> List[Dict]:
        """语义检索"""
        return self.memory.search(query, top_k=top_k, **kwargs)

    def recall_recent(self, limit: int = 10) -> List[Dict]:
        """回忆最近记忆"""
        return self.memory.recall_recent(limit=limit)

    def recall_by_date(self, date_str: str) -> List[Dict]:
        """按日期回忆"""
        return self.memory.recall_by_date(date_str)

    def feed_voice(self, text: str):
        """喂入语音转文本结果"""
        self.listener.feed(text)

    def get_stats(self) -> Dict:
        """获取统计信息"""
        return self.memory.get_stats()

    def trigger_refresh(self) -> int:
        """手动触发刷新"""
        return self.memory.refresh()
