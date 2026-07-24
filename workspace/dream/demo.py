"""
dream 模块 - 演示脚本
生成示例数据并打开可视化图谱
"""

import random
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path

from dream import Dream


def generate_demo_data(dream: Dream):
    """生成演示数据，模拟神经可塑性过程"""
    
    # 今日记忆（默认展示）
    today_memories = [
        "学习了神经可塑性原理：Hebbian学习规则",
        "练习了 Python asyncio 编程",
        "阅读了《认知神经科学》第三章",
        "晚餐吃了火锅，辣度刚好",
        "和朋友讨论了AI记忆系统的设计",
        "写了一个基于力导向图的可视化组件",
        "听了一篇关于海马体记忆巩固的播客",
    ]
    
    # 过去的记忆（用于构建网络连接）
    past_memories = [
        "去年学会了骑自行车",
        "第一次用 PyTorch 训练神经网络",
        "理解了反向传播算法",
        "去日本旅行，京都的秋天很美",
        "读完《黑客与画家》",
        "学会了使用 D3.js 做数据可视化",
        "在 Kaggle 上完成了第一个竞赛",
        "搬家到了新的城市",
        "养了一只叫汤圆的猫",
        "看了诺兰的《奥本海默》",
    ]
    
    print("📦 存入历史记忆...")
    past_ids = []
    for i, content in enumerate(past_memories):
        # 模拟不同时间存入
        days_ago = random.randint(1, 60)
        created = datetime.now() - timedelta(days=days_ago)
        mem = dream.store_memory(content)
        # 修改创建时间（直接操作 store）
        mem.created_at = created
        mem.last_accessed = created - timedelta(hours=random.randint(0, 24))
        dream.store.save_fragment(mem)
        past_ids.append(mem.id)
    
    print("📦 存入今日记忆...")
    today_ids = []
    for content in today_memories:
        mem = dream.store_memory(content)
        today_ids.append(mem.id)
    
    # 建立基于语义的连接（模拟相关记忆之间的关联）
    print("🔗 建立语义关联...")
    # 学习类记忆相互关联
    learning = [past_ids[1], past_ids[2], today_ids[0], today_ids[1], today_ids[2]]
    # 技术类记忆
    tech = [past_ids[1], past_ids[5], today_ids[1], today_ids[5]]
    # 生活类
    life = [past_ids[3], past_ids[7], past_ids[8], today_ids[3]]
    
    for group in [learning, tech, life]:
        for i, mid in enumerate(group):
            for other in group[i+1:]:
                # 模拟共激活来建立连接
                m1 = dream.store.get_fragment(mid)
                m2 = dream.store.get_fragment(other)
                if m1 and m2:
                    dream.plasticity._coactivate(m1, m2, datetime.now())
    
    # 模拟访问历史（热度不同）
    print("🔥 模拟记忆访问...")
    # 某些记忆被频繁访问（高热度）
    hot_memories = [today_ids[0], today_ids[5], past_ids[1], past_ids[2]]
    for mid in hot_memories:
        for _ in range(random.randint(3, 8)):
            frag = dream.store.get_fragment(mid)
            if frag:
                dream.plasticity.access_memory(frag)
    
    # 某些记忆被主动强化
    print("💪 模拟主动强化...")
    for mid in [today_ids[0], today_ids[2]]:
        frag = dream.store.get_fragment(mid)
        if frag:
            dream.plasticity.strengthen_memory(frag, intensity=0.25)
    
    # 执行一次巩固（衰减 + 系统恢复）
    print("🧠 执行记忆巩固...")
    dream.consolidate()
    
    print(f"✅ 演示数据准备完成！")
    print(f"   记忆节点: {len(today_memories) + len(past_memories)}")
    print(f"   今日片段: {len(today_memories)}")
    print(f"   关联边: {len(dream.store.get_all_edges())}")
    print(f"   强化事件: {len(dream.store.get_all_events())}")


def main():
    dream = Dream()
    
    # 如果数据库为空，生成演示数据
    existing = dream.store.get_all_fragments()
    if not existing:
        generate_demo_data(dream)
    else:
        print(f"📂 已有 {len(existing)} 条记忆，使用现有数据")
    
    # 生成可视化
    output = dream.visualize(show_today_only=True, include_neighbors=True)
    print(f"\n📊 可视化图谱已生成: {output.absolute()}")
    
    # 尝试打开浏览器
    try:
        webbrowser.open(f"file://{output.absolute()}")
        print("🌐 已尝试在浏览器中打开")
    except Exception as e:
        print(f"⚠️ 自动打开浏览器失败: {e}")
        print(f"   请手动打开: {output.absolute()}")


if __name__ == "__main__":
    main()
