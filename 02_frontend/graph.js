// graph.js — 节点图(灵魂层的脸:打开自己的大脑)。
// 手写 Canvas 2D 渲染器(不引图库/框架,守铁律A)。气质 = 星座 × 神经元 × 星际穿越:
//   · 背景:浩瀚星云(暖金/冷青去饱和)+ 漫天星点
//   · 节点:发光光晕,失重般缓慢漂浮(颜色按类型,大小按优先级,亮度日后承载新陈代谢)
//   · 连线:神经元脉冲——沿边流动的光点
//   · 点节点 = 切回编辑器打开那一条
// 依赖:window.Storage、window.StarnetApp。接口:window.StarnetGraph.render()

(function () {
  const host = document.getElementById('graph');
  const emptyHint = document.getElementById('graph-empty');

  // —— 配色:黑底上的发光色(去饱和,电影感,不霓虹)——
  const TYPE_COLOR = {
    preference: [255, 210, 122],     // 暖金
    habit: [111, 227, 210],          // 冷青
    'decision-style': [196, 168, 255], // 柔紫
  };
  const FALLBACK_COLOR = [159, 180, 200];
  const PRIORITY_R = { high: 9, medium: 6.5, low: 5 };

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  // —— 画布状态 ——
  let canvas, ctx, dpr = 1, W = 0, H = 0;
  let nodes = [], edges = [], pulses = [];
  let stars = [], nebula = null;
  let raf = null, t0 = 0, time = 0;
  const view = { x: 0, y: 0, scale: 1 };
  const ptr = { x: 0, y: 0, down: false, downX: 0, downY: 0, moved: false, dragId: null, panning: false, hoverId: null };

  // ====================================================================
  // 构建图数据:每条偏好 = 一个节点;共享标签 = 一条边
  // ====================================================================
  function buildGraph(items) {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 黄金角,向日葵螺旋
    const SPACING = 64;
    nodes = items.map((it, i) => {
      // 向日葵螺旋:天然均匀、居中、有机
      const rr = SPACING * Math.sqrt(i + 0.6);
      const th = i * GOLDEN;
      const bx = Math.cos(th) * rr, by = Math.sin(th) * rr;
      const color = TYPE_COLOR[it.type] || FALLBACK_COLOR;
      return {
        id: it.id,
        label: it.title || '(无标题)',
        color,
        r: PRIORITY_R[it.priority] || PRIORITY_R.medium,
        tags: (it.tags || []).map((s) => String(s).toLowerCase()),
        bx, by,            // 基准位(固定)
        x: bx, y: by,      // 当前位 = 基准 + 漂浮
        phase: (i * 1.7) % (Math.PI * 2),
        ampx: 7 + (i % 3) * 3, ampy: 6 + (i % 4) * 3, // 失重漂浮幅度
        glow: 1, // 亮度系数(日后新陈代谢:活跃→1、休眠→<1)
      };
    });

    const byId = Object.fromEntries(nodes.map((nd) => [nd.id, nd]));
    edges = [];
    for (let i = 0; i < nodes.length; i++) {
      const tagsA = new Set(nodes[i].tags);
      if (tagsA.size === 0) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        let shared = 0;
        for (const tg of nodes[j].tags) if (tagsA.has(tg)) shared++;
        if (shared > 0) edges.push({ a: nodes[i].id, b: nodes[j].id, w: shared, nextPulse: Math.random() * 2 });
      }
    }
    pulses = [];
    return byId;
  }

  let nodeById = {};

  // ====================================================================
  // 失重漂浮:每个节点绕固定基准位做缓慢正弦漂移(确定性,永远稳定居中)
  // ====================================================================
  function drift() {
    for (const a of nodes) {
      if (a.id === ptr.dragId) continue; // 正在拖的不漂
      a.x = a.bx + Math.sin(time * 0.0007 + a.phase) * a.ampx;
      a.y = a.by + Math.cos(time * 0.00055 + a.phase * 1.3) * a.ampy;
    }
  }

  // ====================================================================
  // 星云 + 星点:星云预渲染到离屏画布(便宜),星点实时闪烁
  // ====================================================================
  function makeNebula() {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    c.fillStyle = '#05070a';
    c.fillRect(0, 0, W, H);
    // 几团去饱和的星云:暖金 + 冷青 + 一抹紫
    const blobs = [
      { x: W * 0.78, y: H * 0.62, r: Math.max(W, H) * 0.55, col: [120, 86, 50] },   // 暖金(右下,呼应黑洞吸积盘)
      { x: W * 0.18, y: H * 0.28, r: Math.max(W, H) * 0.45, col: [30, 64, 72] },    // 冷青(左上)
      { x: W * 0.55, y: H * 0.15, r: Math.max(W, H) * 0.35, col: [50, 40, 70] },    // 紫(顶部淡淡)
      { x: W * 0.40, y: H * 0.85, r: Math.max(W, H) * 0.30, col: [70, 52, 36] },    // 暖(底部)
    ];
    c.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, rgba(b.col, 0.28));
      g.addColorStop(0.4, rgba(b.col, 0.12));
      g.addColorStop(1, rgba(b.col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';
    nebula = off;
  }

  function makeStars() {
    stars = [];
    const count = Math.round((W * H) / 5200);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: Math.random() * 1.3 + 0.2,
        base: Math.random() * 0.5 + 0.15,
        tw: Math.random() * Math.PI * 2, // 闪烁相位
      });
    }
  }

  // ====================================================================
  // 绘制
  // ====================================================================
  function draw() {
    // 背景星云(轻微呼吸位移,制造深空漂移)
    const drift = 6;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    if (nebula) {
      ctx.globalAlpha = 1;
      ctx.drawImage(nebula, Math.sin(time * 0.00004) * drift, Math.cos(time * 0.00003) * drift);
    }
    // 星点闪烁
    for (const st of stars) {
      const a = st.base + Math.sin(time * 0.002 + st.tw) * 0.12;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, a)})`;
      ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
      ctx.fill();
    }

    // 进入世界坐标(平移到中心 + 平移视图 + 缩放)
    ctx.save();
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.scale, view.scale);

    // —— 边:极淡的连线 ——
    ctx.lineWidth = 1 / view.scale;
    for (const e of edges) {
      const a = nodeById[e.a], b = nodeById[e.b];
      if (!a || !b) continue;
      ctx.strokeStyle = `rgba(170,190,210,${0.05 + e.w * 0.02})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // —— 脉冲:沿边流动的光点(神经元突触感)——
    ctx.globalCompositeOperation = 'lighter';
    for (const p of pulses) {
      const a = nodeById[p.a], b = nodeById[p.b];
      if (!a || !b) continue;
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      const fade = Math.sin(p.t * Math.PI); // 两端淡、中间亮
      const col = a.color;
      const pr = 2.4 / view.scale;
      const g = ctx.createRadialGradient(x, y, 0, x, y, pr * 4);
      g.addColorStop(0, rgba(col, 0.9 * fade));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, pr * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // —— 节点:光晕 + 实心核 ——
    for (const nd of nodes) {
      const hovered = nd.id === ptr.hoverId;
      const x = nd.x, y = nd.y;
      const r = nd.r * (hovered ? 1.25 : 1);
      const glow = nd.glow * (hovered ? 1.4 : 1);

      // 外层光晕(两层:大柔光 + 内聚亮核)
      const halo = r * 6.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
      g.addColorStop(0, rgba(nd.color, 0.9 * glow));
      g.addColorStop(0.18, rgba(nd.color, 0.45 * glow));
      g.addColorStop(0.5, rgba(nd.color, 0.12 * glow));
      g.addColorStop(1, rgba(nd.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, halo, 0, Math.PI * 2);
      ctx.fill();

      // 实心核 + 白心
      ctx.fillStyle = rgba(nd.color, 1);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.9 * glow})`;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // —— 标签:默认淡,hover 变亮(留白)——
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const nd of nodes) {
      const hovered = nd.id === ptr.hoverId;
      const a = hovered ? 0.95 : 0.4;
      ctx.font = `${(hovered ? 13 : 12) / view.scale}px -apple-system, "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = `rgba(230,235,240,${a})`;
      ctx.fillText(nd.label, nd.x, nd.y + nd.r * 2.8 + 4);
    }

    ctx.restore(); // 退出世界坐标,回到屏幕坐标
  }

  // 自动适配:算节点包围盒,设 view 让整团居中铺满(留边距)。加载时调一次。
  function fitView() {
    if (!nodes.length || !W || !H) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const nd of nodes) {
      minX = Math.min(minX, nd.bx); maxX = Math.max(maxX, nd.bx);
      minY = Math.min(minY, nd.by); maxY = Math.max(maxY, nd.by);
    }
    const pad = 140; // 给光晕和标签留空间
    const gw = (maxX - minX) + pad * 2, gh = (maxY - minY) + pad * 2;
    const scale = Math.min(W / gw, H / gh, 1.6);
    view.scale = Math.max(0.3, scale);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    view.x = -cx * view.scale;
    view.y = -cy * view.scale;
  }

  // 脉冲生成 + 推进
  function stepPulses(dt) {
    for (const e of edges) {
      e.nextPulse -= dt;
      if (e.nextPulse <= 0) {
        pulses.push({ a: e.a, b: e.b, t: 0, speed: 0.4 + Math.random() * 0.3 });
        e.nextPulse = 1.6 + Math.random() * 2.4;
      }
    }
    for (const p of pulses) p.t += p.speed * dt;
    pulses = pulses.filter((p) => p.t < 1);
  }

  // ====================================================================
  // 主循环
  // ====================================================================
  function loop(ts) {
    if (!t0) t0 = ts;
    const dt = Math.min(0.05, (ts - (time + t0)) / 1000); // 秒
    time = ts - t0;
    drift();
    stepPulses(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ====================================================================
  // 坐标 / 命中测试 / 交互
  // ====================================================================
  function screenToWorld(sx, sy) {
    return {
      x: (sx - W / 2 - view.x) / view.scale,
      y: (sy - H / 2 - view.y) / view.scale,
    };
  }
  function nodeAt(sx, sy) {
    const w = screenToWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const nd of nodes) {
      const dx = w.x - nd.x, dy = w.y - nd.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const hitR = nd.r * 2 + 12 / view.scale; // 容错大些:节点小又在漂,点附近就算中
      if (d < hitR && d < bestD) { best = nd; bestD = d; }
    }
    return best;
  }

  function bindEvents() {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (ptr.down) {
        const ddx = sx - ptr.downX, ddy = sy - ptr.downY;
        if (Math.abs(ddx) + Math.abs(ddy) > 3) ptr.moved = true;
        if (ptr.dragId) {
          const nd = nodeById[ptr.dragId];
          const w = screenToWorld(sx, sy);
          nd.bx = w.x; nd.by = w.y; nd.x = w.x; nd.y = w.y; // 拖动改基准位
        } else if (ptr.panning) {
          view.x += ddx; view.y += ddy;
          ptr.downX = sx; ptr.downY = sy;
        }
      } else {
        const hit = nodeAt(sx, sy);
        ptr.hoverId = hit ? hit.id : null;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      ptr.down = true; ptr.downX = sx; ptr.downY = sy; ptr.moved = false;
      const hit = nodeAt(sx, sy);
      if (hit) { ptr.dragId = hit.id; } else { ptr.panning = true; canvas.style.cursor = 'grabbing'; }
    });
    window.addEventListener('mouseup', () => {
      if (ptr.down && !ptr.moved && ptr.dragId) {
        // 没拖动 = 点击 → 打开那一条
        if (window.StarnetApp) window.StarnetApp.openItemFromGraph(ptr.dragId);
      }
      ptr.down = false; ptr.dragId = null; ptr.panning = false;
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const before = screenToWorld(sx, sy);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      view.scale = Math.max(0.3, Math.min(3, view.scale * factor));
      const after = screenToWorld(sx, sy);
      view.x += (after.x - before.x) * view.scale;
      view.y += (after.y - before.y) * view.scale;
    }, { passive: false });
  }

  // ====================================================================
  // 尺寸
  // ====================================================================
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeNebula();
    makeStars();
    fitView();
  }

  // ====================================================================
  // 对外:render()
  // ====================================================================
  async function render() {
    const items = await window.Storage.list();
    const hasData = items.length > 0;
    emptyHint.classList.toggle('hidden', hasData);
    host.classList.toggle('hidden', !hasData);
    if (!hasData) {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      return;
    }

    if (!canvas) {
      canvas = document.createElement('canvas');
      host.appendChild(canvas);
      ctx = canvas.getContext('2d');
      bindEvents();
      const ro = new ResizeObserver(() => resize());
      ro.observe(host);
    }
    resize();
    nodeById = buildGraph(items);
    fitView(); // 自动缩放平移,保证整团居中铺满、全部可见
    t0 = 0; time = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  window.StarnetGraph = { render };
  render().catch((err) => console.error('节点图启动渲染失败', err));
})();
