"""
文本嵌入器
优先使用 sentence-transformers 轻量模型，
失败时回退到纯 Python 哈希签名嵌入（零外部依赖）
"""

import logging
import hashlib
import math
from typing import List

from config import EMBEDDING_MODEL_NAME, EMBEDDING_DEVICE, VECTOR_DIM

logger = logging.getLogger(__name__)


class Embedder:
    """
    轻量文本嵌入器
    """

    def __init__(self):
        self.model = None
        self._fallback = False
        self._try_load_model()

    def _try_load_model(self):
        """尝试加载 sentence-transformers 模型"""
        try:
            from sentence_transformers import SentenceTransformer
            logger.info(f"正在加载嵌入模型: {EMBEDDING_MODEL_NAME}")
            self.model = SentenceTransformer(EMBEDDING_MODEL_NAME, device=EMBEDDING_DEVICE)
            logger.info("嵌入模型加载成功")
        except Exception as e:
            logger.warning(f"sentence-transformers 加载失败 ({e})，启用回退模式")
            self._fallback = True

    def _fallback_embed(self, text: str) -> List[float]:
        """
        回退嵌入：基于字符 n-gram + 词袋的哈希签名（纯 Python）
        对中文做字级别和短序列级别的混合哈希，提高短文本匹配率
        """
        text = text.lower().strip()
        vec = [0.0] * VECTOR_DIM

        # 多种 n-gram 混合（unigram, bigram, trigram）
        for n in (1, 2, 3):
            for i in range(len(text) - n + 1):
                gram = text[i : i + n]
                h = int(hashlib.md5(gram.encode("utf-8")).hexdigest(), 16)
                idx = h % VECTOR_DIM
                # n 越小权重越大，保证精确匹配有更高响应
                weight = (4 - n) / 3.0
                vec[idx] += weight
                # 二次散列减少碰撞
                idx2 = (idx + VECTOR_DIM // 2) % VECTOR_DIM
                vec[idx2] += weight * 0.5

        # 归一化
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec

    def encode(self, text: str) -> List[float]:
        """
        将文本编码为向量
        """
        if not text:
            return [0.0] * VECTOR_DIM

        if self._fallback or self.model is None:
            return self._fallback_embed(text)

        try:
            vec = self.model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
            # 尝试转为 list（如果 numpy 不可用，模型本身可能返回 list）
            if hasattr(vec, "tolist"):
                return vec.tolist()
            return list(vec)
        except Exception as e:
            logger.error(f"模型编码失败: {e}，本次使用回退模式")
            return self._fallback_embed(text)

    def encode_batch(self, texts: List[str]) -> List[List[float]]:
        """批量编码"""
        if not texts:
            return []
        if self._fallback or self.model is None:
            return [self.encode(t) for t in texts]
        try:
            vecs = self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
            if hasattr(vecs, "tolist"):
                return vecs.tolist()
            return [list(v) for v in vecs]
        except Exception as e:
            logger.error(f"批量编码失败: {e}，回退到单条模式")
            return [self.encode(t) for t in texts]

    @property
    def is_fallback(self) -> bool:
        return self._fallback
