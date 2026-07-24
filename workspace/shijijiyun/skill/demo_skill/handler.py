"""
演示用 Skill 处理模块 — 故意包含安全问题的代码
用于验证安全巡检工具的检测能力。
"""
import sqlite3

DB_PATH = "city_logistics.db"


def get_order_detail(order_id: str) -> dict:
    """⚠️ 故意使用 f-string 拼接 SQL（注入风险）"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    sql = f"SELECT * FROM orders WHERE id = '{order_id}'"
    cursor.execute(sql)
    row = cursor.fetchone()
    conn.close()
    return row


def search_warehouse_inventory(city: str, keyword: str) -> list:
    """⚠️ 图谱查询缺少城市隔离"""
    # 模拟 Gremlin 查询 — 故意不加 city_id 过滤
    query = "g.V().hasLabel('warehouse').has('name', containing(keyword)).valueMap()"
    print(f"执行图谱查询: {query}")
    return []


def dispatch_to_driver(order_id: str, address: str) -> dict:
    """⚠️ 输出包含未脱敏的手机号"""
    return {
        "order_id": order_id,
        "driver": "李司机",
        "driver_phone": "13912345678",       # ⚠️ 明文手机号
        "address": "浙江省杭州市西湖区文三路138号",  # ⚠️ 明文详细地址
        "gps": "30.287412, 120.134567",       # ⚠️ 精确坐标
    }


def delete_old_orders(user_input: str):
    """⚠️ eval 拼接外部输入（严重注入）"""
    code = f"orders.filter(lambda o: o.status == '{user_input}')"
    result = eval(code)  # 极度危险
    return result
