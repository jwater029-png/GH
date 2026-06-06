// graph.js — 节点图(灵魂层的脸:打开自己的大脑)。
// 用 Cytoscape.js 把 ~/.starnet/personal 里的偏好渲染成一张网:
//   · 每条偏好 = 一个节点(颜色按类型,大小按优先级)
//   · 共享标签的偏好之间连一条线(让"网"长出来,不是散点)
//   · 点节点 = 切回编辑器打开那一条(打开你大脑的一块)
// 依赖:全局 cytoscape(vendor/cytoscape.min.js)、window.Storage、window.StarnetApp。

(function () {
  const container = document.getElementById('graph');
  const emptyHint = document.getElementById('graph-empty');

  // 类型 → 颜色(极简三色 + 兜底灰)
  const TYPE_COLOR = {
    preference: '#5b8def',
    habit: '#3fb27f',
    'decision-style': '#a172e6',
  };
  const FALLBACK_COLOR = '#8a8f98';

  // 优先级 → 节点直径
  const PRIORITY_SIZE = { high: 58, medium: 44, low: 34 };

  let cy = null;

  // 把偏好列表转成 cytoscape 元素(节点 + 共享标签的边)
  function toElements(items) {
    const nodes = items.map((it) => ({
      data: {
        id: it.id,
        label: it.title || '(无标题)',
        color: TYPE_COLOR[it.type] || FALLBACK_COLOR,
        size: PRIORITY_SIZE[it.priority] || PRIORITY_SIZE.medium,
      },
    }));

    // 共享标签连边:任意两条偏好只要有公共 tag,就连一条(粗细按公共数)
    const edges = [];
    for (let i = 0; i < items.length; i++) {
      const tagsA = new Set((items[i].tags || []).map((t) => String(t).toLowerCase()));
      if (tagsA.size === 0) continue;
      for (let j = i + 1; j < items.length; j++) {
        const tagsB = items[j].tags || [];
        let shared = 0;
        for (const t of tagsB) if (tagsA.has(String(t).toLowerCase())) shared++;
        if (shared > 0) {
          edges.push({
            data: {
              id: 'e-' + items[i].id + '--' + items[j].id,
              source: items[i].id,
              target: items[j].id,
              weight: shared,
            },
          });
        }
      }
    }
    return { nodes, edges };
  }

  const STYLE = [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        color: '#e6e8eb',
        'font-size': 13,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        'text-max-width': 120,
        'text-wrap': 'wrap',
        'border-width': 0,
        'transition-property': 'background-color, width, height',
        'transition-duration': '150ms',
      },
    },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': '#ffffff' },
    },
    {
      selector: 'edge',
      style: {
        width: 'mapData(weight, 1, 4, 1, 4)',
        'line-color': '#3a3f47',
        'curve-style': 'haystack',
        opacity: 0.7,
      },
    },
  ];

  const LAYOUT = {
    name: 'cose',
    animate: true,
    animationDuration: 600,
    padding: 40,
    nodeRepulsion: 9000,
    idealEdgeLength: 120,
    fit: true,
  };

  async function render() {
    const items = await window.Storage.list();

    const hasData = items.length > 0;
    emptyHint.classList.toggle('hidden', hasData);
    container.classList.toggle('hidden', !hasData);
    if (!hasData) {
      if (cy) { cy.destroy(); cy = null; }
      return;
    }

    const { nodes, edges } = toElements(items);

    if (!cy) {
      cy = cytoscape({
        container,
        elements: [...nodes, ...edges],
        style: STYLE,
        layout: LAYOUT,
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.2,
      });
      // 点节点 = 打开那一条(切回编辑器)
      cy.on('tap', 'node', (evt) => {
        const id = evt.target.id();
        if (window.StarnetApp) window.StarnetApp.openItemFromGraph(id);
      });
    } else {
      // 重画:换元素再跑布局(保留实例,避免重建闪烁)
      cy.elements().remove();
      cy.add([...nodes, ...edges]);
      cy.layout(LAYOUT).run();
    }
  }

  window.StarnetGraph = { render };

  // 启动即渲染(默认视图就是节点图)。失败不卡死,留错误在控制台。
  render().catch((err) => console.error('节点图启动渲染失败', err));
})();
