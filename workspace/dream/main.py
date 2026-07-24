#!/usr/bin/env python3
"""
dream 长期记忆模块 - 主入口

启动命令：
    python main.py

功能：
    - 启动定时刷新（每日凌晨2点）
    - 启动语音指令监听
    - 提供交互式命令行演示
"""

import sys
import logging
import argparse
from pathlib import Path

# 确保项目根目录在路径中
sys.path.insert(0, str(Path(__file__).parent))

from config import LOG_LEVEL, LOG_FORMAT
from api.server import DreamServer


def setup_logging():
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL),
        format=LOG_FORMAT,
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )


def interactive_mode(server: DreamServer):
    """交互式命令行"""
    print("\n🌙 dream 长期记忆模块已启动")
    print("命令: save <内容> | search <查询> | recent [条数] | date <YYYY-MM-DD> | stats | refresh | quit\n")

    try:
        while True:
            try:
                cmd = input("dream> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break

            if not cmd:
                continue

            parts = cmd.split(maxsplit=1)
            action = parts[0].lower()
            arg = parts[1] if len(parts) > 1 else ""

            if action == "quit" or action == "exit":
                break
            elif action == "save":
                if not arg:
                    print("用法: save <记忆内容>")
                    continue
                result = server.save_memory(arg)
                print(f"✅ 已保存 [id={result['id']}] 摘要: {result['summary'][:50]}...")
            elif action == "search":
                if not arg:
                    print("用法: search <查询内容>")
                    continue
                results = server.search(arg)
                if not results:
                    print("未找到相关记忆")
                for r in results:
                    ts = r['timestamp']
                    from datetime import datetime
                    dt = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
                    print(f"  [{dt}] (相似度 {r['similarity']}) {r['summary'][:60]}...")
            elif action == "recent":
                limit = int(arg) if arg.isdigit() else 10
                results = server.recall_recent(limit=limit)
                if not results:
                    print("暂无记忆")
                for r in results:
                    from datetime import datetime
                    dt = datetime.fromtimestamp(r['timestamp']).strftime("%Y-%m-%d %H:%M")
                    print(f"  [{dt}] {r['summary'][:60]}...")
            elif action == "date":
                if not arg:
                    print("用法: date <YYYY-MM-DD>")
                    continue
                results = server.recall_by_date(arg)
                if not results:
                    print("该日期没有记忆")
                for r in results:
                    from datetime import datetime
                    dt = datetime.fromtimestamp(r['timestamp']).strftime("%H:%M")
                    print(f"  [{dt}] {r['summary'][:60]}...")
            elif action == "stats":
                stats = server.get_stats()
                for k, v in stats.items():
                    print(f"  {k}: {v}")
            elif action == "refresh":
                deleted = server.trigger_refresh()
                print(f"清理完成，删除 {deleted} 条旧记忆")
            else:
                print(f"未知命令: {action}")
    finally:
        server.stop()
        print("👋 已退出")


def demo_mode(server: DreamServer):
    """快速演示模式"""
    print("\n🌙 dream 快速演示\n")

    # 1. 手动保存
    print("1. 手动保存记忆...")
    server.save_memory("我梦见自己变成了一只猫，在屋顶上追逐月光。", source="manual")
    server.save_memory("昨晚梦到参加高考，却发现所有题目都不会。", source="manual")
    server.save_memory("在梦里飞翔，穿过云层，看见了金色的城市。", source="manual")

    # 2. 模拟语音流触发
    print("\n2. 模拟语音流触发 '存入梦境' ...")
    server.feed_voice("今天天气不错")
    server.feed_voice("我跟朋友聊了很多")
    server.feed_voice("存入梦境，我梦见在一片森林里迷路了，但是有一只鹿为我带路")

    import time
    time.sleep(1)  # 等待监听器处理

    # 3. 检索
    print("\n3. 语义检索 '飞翔' ...")
    results = server.search("飞翔")
    for r in results:
        print(f"   -> {r['summary']} (相似度: {r['similarity']})")

    print("\n4. 统计信息:")
    stats = server.get_stats()
    for k, v in stats.items():
        print(f"   {k}: {v}")

    print("\n5. 手动触发刷新...")
    deleted = server.trigger_refresh()
    print(f"   删除 {deleted} 条记忆")

    server.stop()
    print("\n✅ 演示结束")


def main():
    parser = argparse.ArgumentParser(description="dream 长期记忆模块")
    parser.add_argument("--demo", action="store_true", help="运行快速演示")
    args = parser.parse_args()

    setup_logging()
    server = DreamServer()
    server.start()

    if args.demo:
        demo_mode(server)
    else:
        interactive_mode(server)


if __name__ == "__main__":
    main()
