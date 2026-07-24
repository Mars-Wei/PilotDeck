"""
定时任务调度器
支持每日凌晨2点自动刷新记忆库
也可扩展为其他周期性任务
"""

import logging
import threading
import time
from typing import Callable, Optional

from config import SCHEDULE_HOUR, SCHEDULE_MINUTE

logger = logging.getLogger(__name__)


class DreamScheduler:
    """
    轻量定时调度器
    基于独立线程 + 睡眠计算，零额外依赖
    """

    def __init__(self):
        self._jobs: List[dict] = []
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def add_daily_job(self, hour: int, minute: int, job: Callable, job_name: str = "unnamed"):
        """
        添加每日定时任务
        """
        self._jobs.append({
            "type": "daily",
            "hour": hour,
            "minute": minute,
            "job": job,
            "name": job_name,
            "last_run_date": None,
        })
        logger.info(f"添加每日任务 '{job_name}' 执行时间: {hour:02d}:{minute:02d}")

    def start(self):
        """启动调度器线程"""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("调度器已启动")

    def stop(self):
        """停止调度器线程"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        logger.info("调度器已停止")

    def _loop(self):
        """主循环：每分钟检查一次任务"""
        while self._running:
            now = time.localtime()
            current_date = (now.tm_year, now.tm_mon, now.tm_mday)
            current_time = (now.tm_hour, now.tm_min)

            for job_info in self._jobs:
                if job_info["type"] == "daily":
                    scheduled_time = (job_info["hour"], job_info["minute"])
                    if (
                        current_time == scheduled_time
                        and job_info["last_run_date"] != current_date
                    ):
                        job_info["last_run_date"] = current_date
                        self._run_job(job_info)

            # 每分钟检查一次
            time.sleep(60)

    def _run_job(self, job_info: dict):
        """执行任务并捕获异常"""
        logger.info(f"执行任务 '{job_info['name']}'")
        try:
            job_info["job"]()
        except Exception as e:
            logger.error(f"任务 '{job_info['name']}' 执行失败: {e}")


def create_default_scheduler(refresh_callback: Callable) -> DreamScheduler:
    """
    创建默认调度器，已配置每日凌晨2点自动刷新
    """
    scheduler = DreamScheduler()
    scheduler.add_daily_job(
        hour=SCHEDULE_HOUR,
        minute=SCHEDULE_MINUTE,
        job=refresh_callback,
        job_name="dream_auto_refresh",
    )
    return scheduler
