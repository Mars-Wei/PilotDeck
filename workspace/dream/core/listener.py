"""
语音/文本指令监听器
模拟语音识别后的文本流检测，当命中关键词时触发保存
"""

import logging
import re
import threading
import time
from typing import Callable, List, Optional
from queue import Queue, Empty

from config import VOICE_TRIGGER_KEYWORDS

logger = logging.getLogger(__name__)


class VoiceListener:
    """
    语音指令监听器

    使用场景：
    - 持续接收语音转文本后的文本流
    - 检测到关键词（如"存入梦境"）时，触发回调
    - 支持上下文缓存，保存触发前后的一段时间的对话片段
    """

    def __init__(
        self,
        on_trigger: Callable[[str, dict], None],
        context_buffer_size: int = 10,
        pre_trigger_context: int = 3,
    ):
        """
        :param on_trigger: 触发回调，接收 (content, context_dict)
        :param context_buffer_size: 上下文环形缓冲区大小（句数）
        :param pre_trigger_context: 触发时包含触发前多少句上下文
        """
        self.on_trigger = on_trigger
        self.context_buffer_size = context_buffer_size
        self.pre_trigger_context = pre_trigger_context

        self._buffer: List[str] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._text_queue: Queue = Queue()

        # 编译关键词正则（支持中英文关键词）
        self._keywords = VOICE_TRIGGER_KEYWORDS
        self._pattern = re.compile(
            "|".join(re.escape(k) for k in self._keywords),
            re.IGNORECASE,
        )
        logger.info(f"语音监听器初始化完成，监听关键词: {self._keywords}")

    def _consume_loop(self):
        """后台消费线程：从队列取文本并检测关键词"""
        while self._running:
            try:
                text = self._text_queue.get(timeout=0.5)
            except Empty:
                continue

            if text is None:  # 结束信号
                break

            self._process_text(text)

    def _process_text(self, text: str):
        """处理单条文本输入"""
        with self._lock:
            self._buffer.append(text)
            if len(self._buffer) > self.context_buffer_size:
                self._buffer.pop(0)

        # 检测关键词
        if self._pattern.search(text):
            logger.info(f"检测到语音触发关键词: '{text[:50]}...'")
            self._handle_trigger()

    def _handle_trigger(self):
        """处理触发事件：组装上下文并回调"""
        with self._lock:
            # 取触发前 pre_trigger_context 句 + 当前句
            start_idx = max(0, len(self._buffer) - self.pre_trigger_context)
            context_lines = self._buffer[start_idx:]

        content = "\n".join(context_lines)
        context_info = {
            "trigger_keywords": self._keywords,
            "buffer_size": len(context_lines),
            "trigger_time": time.time(),
        }
        logger.info(f"语音触发回调执行，上下文长度 {len(context_lines)} 句")
        try:
            self.on_trigger(content, context_info)
        except Exception as e:
            logger.error(f"语音触发回调执行失败: {e}")

    def start(self):
        """启动监听线程"""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._consume_loop, daemon=True)
        self._thread.start()
        logger.info("语音监听器已启动")

    def stop(self):
        """停止监听线程"""
        self._running = False
        self._text_queue.put(None)
        if self._thread:
            self._thread.join(timeout=2)
        logger.info("语音监听器已停止")

    def feed(self, text: str):
        """
        喂入一条文本（模拟语音识别结果）
        """
        if not self._running:
            logger.warning("监听器未启动，请先调用 start()")
            return
        self._text_queue.put(text)

    def feed_simulated_stream(self, texts: List[str], delay: float = 0.5):
        """
        模拟连续语音流输入（用于测试演示）
        """
        for t in texts:
            time.sleep(delay)
            self.feed(t)
