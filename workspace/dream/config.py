"""
dream 长期记忆模块 - 配置文件
轻量本地向量存储 + 定时刷新 + 语音指令触发
"""

import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).parent.resolve()

# 数据存储目录
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# SQLite 数据库路径
DB_PATH = DATA_DIR / "dream_memory.db"

# 向量维度（使用轻量模型 all-MiniLM-L6-v2 为 384 维）
VECTOR_DIM = 384

# 相似度阈值（检索时用）
SIMILARITY_THRESHOLD = 0.75
# 回退模式下的相似度阈值（字符哈希签名适当降低）
FALLBACK_SIMILARITY_THRESHOLD = 0.20

# 每次自动刷新保留的最大记忆数
MAX_MEMORIES = 1000

# memory_fragments 热度阈值（低于此值的冷记忆将被自动清理）
FRAGMENT_HEAT_THRESHOLD = 0.2

# 摘要最大长度
SUMMARY_MAX_LENGTH = 200

# 语音触发关键词
VOICE_TRIGGER_KEYWORDS = ["存入梦境", "保存梦境", "记录梦境", "dream save"]

# 定时刷新配置
SCHEDULE_HOUR = 2
SCHEDULE_MINUTE = 0

# 嵌入模型配置（本地轻量模型）
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DEVICE = "cpu"

# 日志配置
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
