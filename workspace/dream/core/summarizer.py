"""
轻量摘要生成器
优先使用 transformers 流水线，
不可用时回退到简单的提取式摘要（首句 + 关键词）
"""

import logging
import re
from typing import Optional

from config import SUMMARY_MAX_LENGTH

logger = logging.getLogger(__name__)


class Summarizer:
    """
    轻量摘要生成器
    """

    def __init__(self):
        self.pipeline = None
        self._fallback = False
        self._try_load_pipeline()

    def _try_load_pipeline(self):
        """尝试加载 transformers 摘要流水线"""
        try:
            from transformers import pipeline
            logger.info("正在加载摘要模型...")
            # 使用轻量中文/多语言摘要模型
            self.pipeline = pipeline(
                "summarization",
                model="facebook/bart-large-cnn",  # 如需中文可换 csebuetnlp/mT5_multilingual_XLSum
                device=-1,  # cpu
            )
            logger.info("摘要模型加载成功")
        except Exception as e:
            logger.warning(f"transformers 摘要模型加载失败 ({e})，启用回退模式")
            self._fallback = True

    def _fallback_summarize(self, text: str) -> str:
        """
        回退摘要：提取首句 + 控制长度
        对中文和英文都有效
        """
        text = text.strip()
        if len(text) <= SUMMARY_MAX_LENGTH:
            return text

        # 尝试按句子分割
        # 中文句子分隔符：。！？
        # 英文句子分隔符：. ! ?
        sentences = re.split(r'([。！？.!?])', text)
        # 合并分隔符回句子
        merged = []
        for i in range(0, len(sentences) - 1, 2):
            merged.append(sentences[i] + (sentences[i + 1] if i + 1 < len(sentences) else ""))
        if len(sentences) % 2 == 1:
            merged.append(sentences[-1])

        if not merged:
            merged = [text]

        summary = merged[0]
        for s in merged[1:]:
            if len(summary) + len(s) <= SUMMARY_MAX_LENGTH:
                summary += s
            else:
                break

        if len(summary) > SUMMARY_MAX_LENGTH:
            summary = summary[:SUMMARY_MAX_LENGTH] + "..."

        return summary.strip()

    def summarize(self, text: str) -> str:
        """
        生成文本摘要
        """
        if not text:
            return ""

        if len(text) <= SUMMARY_MAX_LENGTH:
            return text

        if self._fallback or self.pipeline is None:
            return self._fallback_summarize(text)

        try:
            # transformers 摘要模型通常有最大输入长度限制
            input_text = text[:1024] if len(text) > 1024 else text
            result = self.pipeline(
                input_text,
                max_length=SUMMARY_MAX_LENGTH // 2,
                min_length=10,
                do_sample=False,
            )
            summary = result[0]["summary_text"] if result else ""
            return summary.strip()
        except Exception as e:
            logger.error(f"摘要生成失败: {e}，使用回退模式")
            return self._fallback_summarize(text)

    @property
    def is_fallback(self) -> bool:
        return self._fallback
