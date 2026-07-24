"""
dream 模块 - HTML 可视化图谱生成器

基于神经可塑性原理的可视化：
- 记忆节点: 热度着色 (冷蓝 -> 热红)
- 关联边: 权重渐变 (灰蓝 -> 金橙 -> 玫红)
- 时间轴: 强化事件标注
- 默认展示今日存入片段
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dream.config import DATA_DIR
from dream.models import (
    AssociationEdge, EventType, MemoryFragment, MemoryNetwork, StrengthenEvent
)
from dream.store import MemoryStore


class NetworkVisualizer:
    """网络可视化器 - 生成独立 HTML 文件"""
    
    def __init__(self, store: MemoryStore):
        self.store = store
    
    def generate(self, output_path: Optional[Path] = None, 
                 show_today_only: bool = True,
                 include_neighbors: bool = True) -> Path:
        """
        生成 HTML 可视化文件
        
        Args:
            output_path: 输出路径，默认保存到 data/memory_graph.html
            show_today_only: 是否只显示今日存入的片段
            include_neighbors: 是否包含相邻节点（即使不是今日）
        """
        if output_path is None:
            output_path = DATA_DIR / "memory_graph.html"
        elif isinstance(output_path, str):
            output_path = Path(output_path)
        
        network = self.store.load_network()
        
        # 筛选节点
        if show_today_only:
            fragments = [f for f in network.fragments if f.is_today]
            if include_neighbors and fragments:
                neighbor_ids = set()
                for f in fragments:
                    for e in network.edges:
                        if e.source_id == f.id:
                            neighbor_ids.add(e.target_id)
                        elif e.target_id == f.id:
                            neighbor_ids.add(e.source_id)
                extra = [f for f in network.fragments if f.id in neighbor_ids and f not in fragments]
                fragments = fragments + extra
        else:
            fragments = network.fragments
        
        fragment_ids = {f.id for f in fragments}
        edges = [e for e in network.edges if e.source_id in fragment_ids and e.target_id in fragment_ids]
        
        # 获取相关事件（今日或全部）
        if show_today_only:
            today_str = datetime.now().strftime("%Y-%m-%d")
            events = self.store.get_events_by_date(today_str)
        else:
            events = self.store.get_all_events(limit=100)
        
        # 构建数据
        nodes_data = [self._fragment_to_dict(f, highlight_today=show_today_only) for f in fragments]
        links_data = [self._edge_to_dict(e) for e in edges]
        events_data = [self._event_to_dict(e) for e in events]
        
        html = self._render_html(nodes_data, links_data, events_data, show_today_only)
        output_path.write_text(html, encoding="utf-8")
        return output_path
    
    def _fragment_to_dict(self, f: MemoryFragment, highlight_today: bool = True) -> Dict[str, Any]:
        return {
            "id": f.id,
            "content": f.content,
            "heat": round(f.heat, 3),
            "color": f.heat_color,
            "radius": round(f.heat_radius, 1),
            "created_at": f.created_at.isoformat(),
            "last_accessed": f.last_accessed.isoformat() if f.last_accessed else None,
            "access_count": f.access_count,
            "strengthen_count": f.strengthen_count,
            "is_today": f.is_today and highlight_today
        }
    
    def _edge_to_dict(self, e: AssociationEdge) -> Dict[str, Any]:
        c1, c2 = e.gradient_color
        return {
            "id": e.id,
            "source": e.source_id,
            "target": e.target_id,
            "weight": round(e.weight, 3),
            "strokeWidth": round(e.stroke_width, 1),
            "opacity": round(e.opacity, 2),
            "colorStart": c1,
            "colorEnd": c2,
            "coActivationCount": e.co_activation_count
        }
    
    def _event_to_dict(self, e: StrengthenEvent) -> Dict[str, Any]:
        icon = {
            EventType.MEMORY_ACCESS: "🔥",
            EventType.MEMORY_STRENGTHEN: "💪",
            EventType.EDGE_COACTIVATION: "🔗",
            EventType.EDGE_STRENGTHEN: "⚡",
            EventType.CONSOLIDATION: "🧠"
        }.get(e.event_type, "•")
        
        return {
            "id": e.id,
            "memoryId": e.memory_id,
            "edgeId": e.edge_id,
            "type": e.event_type.value,
            "typeLabel": e.event_type.value.replace("_", " ").title(),
            "timestamp": e.timestamp.isoformat(),
            "detail": e.detail,
            "deltaValue": round(e.delta_value, 4),
            "icon": icon
        }
    
    def _render_html(self, nodes: List[Dict], links: List[Dict], 
                     events: List[Dict], show_today_only: bool) -> str:
        title = "今日记忆图谱" if show_today_only else "完整记忆网络"
        
        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dream Memory Graph - {title}</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  :root {{
    --bg: #0f172a;
    --panel: #1e293b;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --today-glow: rgba(56, 189, 248, 0.4);
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }}
  header {{
    padding: 12px 24px;
    background: var(--panel);
    border-bottom: 1px solid #334155;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }}
  header h1 {{ font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px; }}
  header .stats {{ display: flex; gap: 20px; font-size: 13px; color: var(--muted); }}
  header .stats span {{ color: var(--text); font-weight: 500; }}
  .mode-toggle {{
    display: flex; gap: 8px; background: var(--bg); padding: 4px; border-radius: 6px;
  }}
  .mode-toggle button {{
    border: none; background: transparent; color: var(--muted); padding: 6px 14px;
    border-radius: 4px; cursor: pointer; font-size: 13px; transition: all .2s;
  }}
  .mode-toggle button.active {{ background: var(--accent); color: #0f172a; font-weight: 600; }}
  .mode-toggle button:hover:not(.active) {{ color: var(--text); }}
  
  main {{ flex: 1; display: flex; overflow: hidden; }}
  
  #graph-container {{
    flex: 1; position: relative; overflow: hidden;
  }}
  #graph-container svg {{ width: 100%; height: 100%; cursor: grab; }}
  #graph-container svg:active {{ cursor: grabbing; }}
  
  .sidebar {{
    width: 340px; background: var(--panel); border-left: 1px solid #334155;
    display: flex; flex-direction: column; overflow: hidden;
  }}
  .sidebar-section {{
    padding: 16px 20px; border-bottom: 1px solid #334155;
  }}
  .sidebar-section h3 {{
    font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;
  }}
  
  /* 图例 */
  .legend {{ display: flex; flex-direction: column; gap: 8px; }}
  .legend-row {{ display: flex; align-items: center; gap: 10px; font-size: 12px; }}
  .legend-dot {{ width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }}
  .legend-line {{ width: 24px; height: 3px; border-radius: 2px; flex-shrink: 0; }}
  
  /* 时间轴 */
  .timeline {{ overflow-y: auto; max-height: 320px; padding-right: 4px; }}
  .timeline::-webkit-scrollbar {{ width: 4px; }}
  .timeline::-webkit-scrollbar-thumb {{ background: #475569; border-radius: 2px; }}
  .timeline-item {{
    display: flex; gap: 10px; padding: 8px 0; border-left: 2px solid #334155;
    padding-left: 14px; position: relative; margin-left: 6px; cursor: pointer;
    transition: background .15s; border-radius: 0 6px 6px 0;
  }}
  .timeline-item:hover {{ background: rgba(56,189,248,0.06); }}
  .timeline-item::before {{
    content: ''; position: absolute; left: -5px; top: 12px; width: 8px; height: 8px;
    border-radius: 50%; background: var(--accent); border: 2px solid var(--panel);
  }}
  .timeline-item.memory_access::before {{ background: #ef4444; }}
  .timeline-item.memory_strengthen::before {{ background: #f59e0b; }}
  .timeline-item.edge_coactivation::before {{ background: #10b981; }}
  .timeline-item.edge_strengthen::before {{ background: #8b5cf6; }}
  .timeline-item.consolidation::before {{ background: #3b82f6; }}
  .timeline-icon {{ font-size: 14px; line-height: 1; margin-top: 2px; }}
  .timeline-body {{ flex: 1; min-width: 0; }}
  .timeline-time {{ font-size: 11px; color: var(--muted); margin-bottom: 2px; }}
  .timeline-detail {{ font-size: 12px; line-height: 1.4; word-break: break-all; }}
  .timeline-delta {{ font-size: 11px; color: var(--accent); margin-top: 2px; }}
  
  /* 详情面板 */
  .detail-panel {{ min-height: 120px; }}
  .detail-content {{ font-size: 13px; line-height: 1.6; }}
  .detail-content .label {{ color: var(--muted); font-size: 11px; margin-top: 8px; }}
  .detail-content .value {{ color: var(--text); }}
  .detail-heat-bar {{ height: 6px; background: #334155; border-radius: 3px; margin-top: 4px; overflow: hidden; }}
  .detail-heat-bar-inner {{ height: 100%; border-radius: 3px; transition: width .3s; }}
  
  /* 节点脉冲动画 */
  @keyframes pulse {{
    0% {{ transform: scale(1); opacity: 0.6; }}
    70% {{ transform: scale(2.2); opacity: 0; }}
    100% {{ transform: scale(1); opacity: 0; }}
  }}
  .node-pulse {{
    animation: pulse 2.5s ease-out infinite;
    transform-origin: center;
    pointer-events: none;
  }}
  
  .tooltip {{
    position: absolute; padding: 8px 12px; background: rgba(15,23,42,0.95);
    border: 1px solid #334155; border-radius: 6px; font-size: 12px;
    pointer-events: none; opacity: 0; transition: opacity .15s; z-index: 100;
    max-width: 240px; line-height: 1.5; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }}
  
  .controls {{
    position: absolute; bottom: 16px; left: 16px; display: flex; gap: 6px;
  }}
  .controls button {{
    width: 32px; height: 32px; border-radius: 6px; border: 1px solid #334155;
    background: var(--panel); color: var(--text); cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }}
  .controls button:hover {{ background: #334155; }}
</style>
</head>
<body>
<header>
  <h1>🧠 Dream Memory Graph <span style="color:var(--muted);font-weight:400;font-size:14px;">{title}</span></h1>
  <div class="stats">
    <div>节点 <span>{len(nodes)}</span></div>
    <div>连接 <span>{len(links)}</span></div>
    <div>事件 <span>{len(events)}</span></div>
  </div>
  <div class="mode-toggle">
    <button id="btn-today" class="{'active' if show_today_only else ''}" onclick="switchMode('today')">今日片段</button>
    <button id="btn-all" class="{'active' if not show_today_only else ''}" onclick="switchMode('all')">完整网络</button>
  </div>
</header>

<main>
  <div id="graph-container">
    <div class="tooltip" id="tooltip"></div>
    <div class="controls">
      <button onclick="zoomIn()" title="放大">+</button>
      <button onclick="zoomOut()" title="缩小">−</button>
      <button onclick="resetZoom()" title="重置">⟲</button>
    </div>
  </div>
  
  <aside class="sidebar">
    <div class="sidebar-section">
      <h3>🔥 热度图例</h3>
      <div class="legend">
        <div class="legend-row"><div class="legend-dot" style="background:#ef4444"></div> 高热记忆 (>0.8)</div>
        <div class="legend-row"><div class="legend-dot" style="background:#f59e0b"></div> 温热记忆 (0.6-0.8)</div>
        <div class="legend-row"><div class="legend-dot" style="background:#10b981"></div> 常温记忆 (0.4-0.6)</div>
        <div class="legend-row"><div class="legend-dot" style="background:#06b6d4"></div> 低温记忆 (0.2-0.4)</div>
        <div class="legend-row"><div class="legend-dot" style="background:#3b82f6"></div> 冷记忆 (&lt;0.2)</div>
      </div>
    </div>
    
    <div class="sidebar-section">
      <h3>🔗 权重图例</h3>
      <div class="legend">
        <div class="legend-row"><div class="legend-line" style="background:linear-gradient(90deg,#f472b6,#db2777)"></div> 强连接 (>0.8)</div>
        <div class="legend-row"><div class="legend-line" style="background:linear-gradient(90deg,#fbbf24,#f59e0b)"></div> 中连接 (0.5-0.8)</div>
        <div class="legend-row"><div class="legend-line" style="background:linear-gradient(90deg,#60a5fa,#3b82f6)"></div> 弱连接 (0.2-0.5)</div>
      </div>
    </div>
    
    <div class="sidebar-section" style="flex:1; display:flex; flex-direction:column; min-height:0;">
      <h3>📅 强化事件时间轴</h3>
      <div class="timeline" id="timeline"></div>
    </div>
    
    <div class="sidebar-section detail-panel">
      <h3>🔍 节点详情</h3>
      <div class="detail-content" id="detail-panel">
        <p style="color:var(--muted); font-size:12px;">点击节点查看详情</p>
      </div>
    </div>
  </aside>
</main>

<script>
const nodes = {json.dumps(nodes, ensure_ascii=False)};
const links = {json.dumps(links, ensure_ascii=False)};
const events = {json.dumps(events, ensure_ascii=False)};

const container = document.getElementById('graph-container');
const width = container.clientWidth;
const height = container.clientHeight;

// 创建 SVG
const svg = d3.select('#graph-container')
  .append('svg')
  .attr('viewBox', [0, 0, width, height]);

// 定义渐变
defs = svg.append('defs');

links.forEach((d, i) => {{
  const gradId = `grad-${{d.id}}`;
  const grad = defs.append('linearGradient')
    .attr('id', gradId)
    .attr('gradientUnits', 'userSpaceOnUse');
  grad.append('stop').attr('offset', '0%').attr('stop-color', d.colorStart);
  grad.append('stop').attr('offset', '100%').attr('stop-color', d.colorEnd);
  d.gradientId = gradId;
}});

// 缩放行为
const zoom = d3.zoom()
  .scaleExtent([0.2, 4])
  .on('zoom', (e) => g.attr('transform', e.transform));
svg.call(zoom);

const g = svg.append('g');

// 力导向模拟
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(d => 120 - d.weight * 40).strength(d => d.weight * 0.8))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collision', d3.forceCollide().radius(d => d.radius + 8));

// 绘制边
const link = g.append('g')
  .selectAll('line')
  .data(links)
  .join('line')
  .attr('stroke', d => `url(#${{d.gradientId}})`)
  .attr('stroke-width', d => d.strokeWidth)
  .attr('opacity', d => d.opacity)
  .attr('stroke-linecap', 'round');

// 脉冲圈（今日节点）
const pulse = g.append('g')
  .selectAll('circle')
  .data(nodes.filter(d => d.is_today))
  .join('circle')
  .attr('class', 'node-pulse')
  .attr('r', d => d.radius)
  .attr('fill', 'none')
  .attr('stroke', '#38bdf8')
  .attr('stroke-width', 2);

// 绘制节点
const node = g.append('g')
  .selectAll('circle')
  .data(nodes)
  .join('circle')
  .attr('r', d => d.radius)
  .attr('fill', d => d.color)
  .attr('stroke', d => d.is_today ? '#38bdf8' : '#0f172a')
  .attr('stroke-width', d => d.is_today ? 3 : 2)
  .style('cursor', 'pointer')
  .style('filter', d => d.is_today ? 'drop-shadow(0 0 8px rgba(56,189,248,0.5))' : 'none')
  .call(d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended));

// 节点文字标签
const label = g.append('g')
  .selectAll('text')
  .data(nodes)
  .join('text')
  .text(d => d.content.length > 12 ? d.content.slice(0, 12) + '...' : d.content)
  .attr('font-size', d => 10 + d.heat * 3)
  .attr('fill', '#e2e8f0')
  .attr('text-anchor', 'middle')
  .attr('dy', d => d.radius + 14)
  .style('pointer-events', 'none')
  .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)');

// Tooltip
const tooltip = document.getElementById('tooltip');

node.on('mouseover', (e, d) => {{
  tooltip.style.opacity = 1;
  tooltip.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;">${{d.content.slice(0,40)}}${{d.content.length>40?'...':''}}</div>
    <div>🔥 热度: ${{(d.heat*100).toFixed(1)}}%</div>
    <div>👁 访问: ${{d.access_count}} 次</div>
    <div>💪 强化: ${{d.strengthen_count}} 次</div>
    <div style="color:var(--muted);margin-top:4px;">${{d.is_today?'✨ 今日存入':''}}</div>
  `;
}})
.on('mousemove', (e) => {{
  tooltip.style.left = (e.pageX + 12) + 'px';
  tooltip.style.top = (e.pageY + 12) + 'px';
}})
.on('mouseout', () => {{ tooltip.style.opacity = 0; }})
.on('click', (e, d) => {{ showDetail(d); highlightNode(d); }});

// 动态更新渐变坐标
simulation.on('tick', () => {{
  link
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);
  
  defs.selectAll('linearGradient').each(function(d) {{
    const l = links.find(x => x.id === d.id);
    if (!l) return;
    d3.select(this)
      .attr('x1', l.source.x)
      .attr('y1', l.source.y)
      .attr('x2', l.target.x)
      .attr('y2', l.target.y);
  }});
  
  node.attr('cx', d => d.x).attr('cy', d => d.y);
  pulse.attr('cx', d => d.x).attr('cy', d => d.y);
  label.attr('x', d => d.x).attr('y', d => d.y);
}});

function dragstarted(e, d) {{
  if (!e.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}}
function dragged(e, d) {{ d.fx = e.x; d.fy = e.y; }}
function dragended(e, d) {{
  if (!e.active) simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}}

// 缩放控制
function zoomIn() {{ svg.transition().call(zoom.scaleBy, 1.3); }}
function zoomOut() {{ svg.transition().call(zoom.scaleBy, 1 / 1.3); }}
function resetZoom() {{ svg.transition().call(zoom.transform, d3.zoomIdentity); }}

// 详情面板
function showDetail(d) {{
  const panel = document.getElementById('detail-panel');
  const heatColor = d.color;
  panel.innerHTML = `
    <div class="value" style="font-size:14px;font-weight:500;margin-bottom:6px;">${{d.content}}</div>
    <div class="label">热度</div>
    <div class="detail-heat-bar"><div class="detail-heat-bar-inner" style="width:${{d.heat*100}}%;background:${{heatColor}}"></div></div>
    <div class="label">访问次数</div>
    <div class="value">${{d.access_count}}</div>
    <div class="label">强化次数</div>
    <div class="value">${{d.strengthen_count}}</div>
    <div class="label">存入时间</div>
    <div class="value">${{new Date(d.created_at).toLocaleString('zh-CN')}}</div>
    <div class="label">最后访问</div>
    <div class="value">${{d.last_accessed ? new Date(d.last_accessed).toLocaleString('zh-CN') : '无'}}</div>
  `;
}}

function highlightNode(target) {{
  node.transition().duration(300).style('opacity', d => d.id === target.id || links.some(l => 
    (l.source.id === target.id && l.target.id === d.id) || 
    (l.target.id === target.id && l.source.id === d.id)
  ) ? 1 : 0.15);
  link.transition().duration(300).style('opacity', d => 
    d.source.id === target.id || d.target.id === target.id ? d.opacity : 0.05
  );
  label.transition().duration(300).style('opacity', d => d.id === target.id ? 1 : 0.3);
  
  setTimeout(() => {{
    node.transition().duration(500).style('opacity', 1);
    link.transition().duration(500).style('opacity', d => d.opacity);
    label.transition().duration(500).style('opacity', 1);
  }}, 2000);
}}

// 渲染时间轴
function renderTimeline() {{
  const timeline = document.getElementById('timeline');
  if (!events.length) {{
    timeline.innerHTML = '<p style="color:var(--muted);font-size:12px;">暂无事件</p>';
    return;
  }}
  timeline.innerHTML = events.map(ev => {{
    const time = new Date(ev.timestamp);
    const timeStr = time.toLocaleTimeString('zh-CN', {{hour:'2-digit', minute:'2-digit', second:'2-digit'}});
    return `
      <div class="timeline-item ${{ev.type}}" onclick="focusEvent('${{ev.memoryId || ev.edgeId}}')">
        <div class="timeline-icon">${{ev.icon}}</div>
        <div class="timeline-body">
          <div class="timeline-time">${{timeStr}} · ${{ev.typeLabel}}</div>
          <div class="timeline-detail">${{ev.detail}}</div>
          ${{ev.deltaValue ? `<div class="timeline-delta">Δ ${{ev.deltaValue > 0 ? '+' : ''}}${{ev.deltaValue.toFixed(3)}}</div>` : ''}}
        </div>
      </div>
    `;
  }}).join('');
}}

function focusEvent(id) {{
  if (!id) return;
  const target = nodes.find(n => n.id === id);
  if (target) {{
    showDetail(target);
    highlightNode(target);
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(width/2, height/2).scale(1.5).translate(-target.x, -target.y));
  }}
}}

function switchMode(mode) {{
  document.getElementById('btn-today').classList.toggle('active', mode === 'today');
  document.getElementById('btn-all').classList.toggle('active', mode === 'all');
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.location.href = url.toString();
}}

renderTimeline();
</script>
</body>
</html>
"""
