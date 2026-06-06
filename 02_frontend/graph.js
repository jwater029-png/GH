// graph.js — 节点图(灵魂层的脸:打开自己的大脑)。
// 手写 Canvas 2D 渲染器(不引图库/框架,守铁律A)。共用引擎 + 两套可切换主题:
//   · 主题一 白冰原(ice)= 星际穿越 Endurance:白色冰原巨物缓转 + 整团星座刚体慢转(碰到缓停、标签恒正)
//     + 深色反差节点(落影漂浮)+ 当前节点青色神经元高亮。
//   · 主题二 深空星云(nebula)= 星座×神经元:深空星云 + 漫天星点 + 银灰发光节点(失重漂浮)+ 神经纤维脉冲连线。
//   右上角按钮一键来回切;选择记进 localStorage。两套都留足调整空间。
// 依赖:window.Storage、window.StarnetApp。接口:window.StarnetGraph.render()

(function () {
  const host = document.getElementById('graph');
  const emptyHint = document.getElementById('graph-empty');
  const themeBtn = document.getElementById('graph-theme');

  // ====================================================================
  // 主题配置 + 配色(节点颜色绘制时按当前主题取 → 切主题瞬间生效,不重建图)
  // ====================================================================
  const THEMES = {
    ice:    { label: '白冰原',  rotate: true,  hostBg: '#e9edf2' },
    nebula: { label: '深空星云', rotate: false, hostBg: '#03040a' },
  };
  const PALETTE = {
    ice: {
      type: { preference: [40, 50, 70], habit: [28, 62, 66], 'decision-style': [58, 46, 82] },
      fallback: [46, 52, 64], edge: [70, 86, 110], accent: [34, 190, 205],
    },
    nebula: {
      type: { preference: [208, 216, 228], habit: [168, 206, 212], 'decision-style': [198, 192, 224] },
      fallback: [186, 194, 206], edge: [228, 236, 248], accent: null,
    },
  };
  const PRIORITY_R = { high: 9, medium: 6.5, low: 5 };

  function loadTheme() {
    try { const v = localStorage.getItem('starnet:graphTheme'); return (v === 'nebula' || v === 'ice') ? v : 'ice'; }
    catch (e) { return 'ice'; }
  }
  function saveTheme(v) { try { localStorage.setItem('starnet:graphTheme', v); } catch (e) {} }
  let THEME = loadTheme();
  function pal() { return PALETTE[THEME]; }
  function colorOf(nd) { const p = pal(); return p.type[nd.type] || p.fallback; }

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // —— 画布状态 ——
  let canvas, ctx, dpr = 1, W = 0, H = 0;
  let nodes = [], edges = [], adj = {};
  let nebula = null, stars = [], surface = null, surfSize = 0;
  let raf = null, t0 = 0, time = 0, lastTs = 0;
  // 自转(仅 ice):rot=当前角,rotSpeed=角速度(缓动);背景独立更慢转
  let rot = 0, rotSpeed = 0, bgRot = 0;
  const ROT_FULL = (Math.PI * 2) / 240000; // 整团 ~4 分钟一圈
  const BG_FULL = (Math.PI * 2) / 660000;  // 冰原背景 ~11 分钟一圈(更慢 → 视差纵深)
  const view = { x: 0, y: 0, scale: 1 };
  const ptr = { x: 0, y: 0, down: false, downX: 0, downY: 0, moved: false, dragId: null, panning: false, hoverId: null };

  // ====================================================================
  // 构建图数据:每条偏好 = 一个节点;共享标签 = 一条边
  // ====================================================================
  function buildGraph(items) {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 黄金角,向日葵螺旋
    const SPACING = 64;
    nodes = items.map((it, i) => {
      const rr = SPACING * Math.sqrt(i + 0.6);
      const th = i * GOLDEN;
      const bx = Math.cos(th) * rr, by = Math.sin(th) * rr;
      return {
        id: it.id,
        label: it.title || '(无标题)',
        type: it.type,                 // 颜色绘制时按主题取
        r: PRIORITY_R[it.priority] || PRIORITY_R.medium,
        tags: (it.tags || []).map((s) => String(s).toLowerCase()),
        bx, by,            // 基准位(未旋转坐标系,固定)
        x: bx, y: by,      // 当前渲染位 = 旋转(基准) + 漂浮
        phase: (i * 1.7) % (Math.PI * 2),
        ampx: 7 + (i % 3) * 3, ampy: 6 + (i % 4) * 3, // 失重漂浮幅度
        glow: 1, // 亮度系数(日后新陈代谢:活跃→1、休眠→<1)
      };
    });

    const byId = Object.fromEntries(nodes.map((nd) => [nd.id, nd]));
    edges = [];
    adj = Object.fromEntries(nodes.map((nd) => [nd.id, new Set()]));
    for (let i = 0; i < nodes.length; i++) {
      const tagsA = new Set(nodes[i].tags);
      if (tagsA.size === 0) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        let shared = 0;
        for (const tg of nodes[j].tags) if (tagsA.has(tg)) shared++;
        if (shared > 0) {
          edges.push({
            a: nodes[i].id, b: nodes[j].id, w: shared,
            amp: 9 + Math.random() * 13,
            freq: 0.00035 + Math.random() * 0.0005,
            phase: Math.random() * Math.PI * 2,
            amp2: 0.25 + Math.random() * 0.35,
            freq2: 0.0007 + Math.random() * 0.0009,
            dir: Math.random() < 0.5 ? 1 : -1,
            bspeed: (0.16 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1),
            boff: Math.random(),
            brFreq: 0.0006 + Math.random() * 0.0009,
            brPhase: Math.random() * Math.PI * 2,
          });
          adj[nodes[i].id].add(nodes[j].id);
          adj[nodes[j].id].add(nodes[i].id);
        }
      }
    }
    return byId;
  }

  let nodeById = {};

  // ====================================================================
  // 更新:整团刚体自转(仅 ice,缓停/缓启)+ 每个节点失重漂浮
  // ====================================================================
  function update(dt) {
    if (THEMES[THEME].rotate) {
      const interacting = ptr.hoverId !== null || ptr.down;
      const target = interacting ? 0 : ROT_FULL;
      const k = 1 - Math.exp(-dt / 600);
      rotSpeed += (target - rotSpeed) * k;
      rot += rotSpeed * dt;
      bgRot += BG_FULL * dt;
    } else {
      rot = 0; rotSpeed = 0;
    }

    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (const a of nodes) {
      if (a.id === ptr.dragId) continue;
      const rx = a.bx * cos - a.by * sin;
      const ry = a.bx * sin + a.by * cos;
      a.x = rx + Math.sin(time * 0.0007 + a.phase) * a.ampx;
      a.y = ry + Math.cos(time * 0.00055 + a.phase * 1.3) * a.ampy;
    }
  }

  function edgeControl(e, a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const s = Math.sin(time * e.freq + e.phase) + e.amp2 * Math.sin(time * e.freq2 + e.phase * 1.7);
    const off = e.dir * e.amp * s;
    return { cx: mx + px * off, cy: my + py * off };
  }
  function curve(a, c, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.cx, c.cy, b.x, b.y);
    ctx.stroke();
  }

  // ====================================================================
  // 背景构建:两套
  // ====================================================================
  function makeIceSurface() {
    const size = Math.ceil(Math.hypot(W, H) * 1.2);
    surfSize = size;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');

    const base = c.createRadialGradient(size * 0.5, size * 0.46, 0, size * 0.5, size * 0.5, size * 0.72);
    base.addColorStop(0, '#eef2f6');
    base.addColorStop(0.6, '#e4e9ef');
    base.addColorStop(1, '#d4dbe4');
    c.fillStyle = base;
    c.fillRect(0, 0, size, size);

    function blob(x, y, r, col, a0) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, a0));
      g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    const COOL = [120, 140, 166], COOL2 = [96, 118, 150], WARM = [208, 200, 186];
    for (let i = 0; i < 26; i++) {
      blob(Math.random() * size, Math.random() * size, size * (0.06 + Math.random() * 0.16),
        Math.random() < 0.5 ? COOL : COOL2, 0.05 + Math.random() * 0.10);
    }
    for (let i = 0; i < 42; i++) {
      blob(Math.random() * size, Math.random() * size, size * (0.05 + Math.random() * 0.18),
        [255, 255, 255], 0.10 + Math.random() * 0.16);
    }
    for (let i = 0; i < 4; i++) {
      blob(Math.random() * size, Math.random() * size, size * (0.12 + Math.random() * 0.12), WARM, 0.05);
    }
    const nw = Math.max(2, Math.ceil(size / 2)), nh = nw;
    const nc = document.createElement('canvas'); nc.width = nw; nc.height = nh;
    const nctx = nc.getContext('2d');
    const img = nctx.createImageData(nw, nh);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 12;
    }
    nctx.putImageData(img, 0, 0);
    c.globalAlpha = 0.5;
    c.drawImage(nc, 0, 0, size, size);
    c.globalAlpha = 1;

    const vig = c.createRadialGradient(size * 0.5, size * 0.5, size * 0.30, size * 0.5, size * 0.5, size * 0.62);
    vig.addColorStop(0, 'rgba(74,94,116,0)');
    vig.addColorStop(1, 'rgba(74,94,116,0.30)');
    c.fillStyle = vig;
    c.fillRect(0, 0, size, size);

    surface = off;
  }

  function makeNebula() {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    const big = Math.max(W, H);

    const base = c.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, big * 0.78);
    base.addColorStop(0, '#0a0e15');
    base.addColorStop(0.55, '#070a11');
    base.addColorStop(1, '#03040a');
    c.fillStyle = base;
    c.fillRect(0, 0, W, H);

    const blobs = [
      { x: W * 0.74, y: H * 0.70, r: big * 0.52, col: [36, 54, 86] },
      { x: W * 0.20, y: H * 0.30, r: big * 0.44, col: [22, 56, 62] },
      { x: W * 0.52, y: H * 0.12, r: big * 0.36, col: [44, 38, 70] },
      { x: W * 0.36, y: H * 0.86, r: big * 0.34, col: [26, 42, 70] },
      { x: W * 0.88, y: H * 0.22, r: big * 0.26, col: [48, 40, 30] },
    ];
    c.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, rgba(b.col, 0.20));
      g.addColorStop(0.45, rgba(b.col, 0.07));
      g.addColorStop(1, rgba(b.col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';

    const nw = Math.max(2, Math.ceil(W / 2)), nh = Math.max(2, Math.ceil(H / 2));
    const nc = document.createElement('canvas'); nc.width = nw; nc.height = nh;
    const nctx = nc.getContext('2d');
    const img = nctx.createImageData(nw, nh);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 14;
    }
    nctx.putImageData(img, 0, 0);
    c.globalAlpha = 0.6;
    c.drawImage(nc, 0, 0, W, H);
    c.globalAlpha = 1;

    const vig = c.createRadialGradient(W * 0.5, H * 0.45, big * 0.28, W * 0.5, H * 0.45, big * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);

    nebula = off;
  }
  function makeStars() {
    stars = [];
    const count = Math.round((W * H) / 6000);
    const tints = [[255, 255, 255], [210, 224, 255], [255, 244, 224]];
    for (let i = 0; i < count; i++) {
      const bright = Math.random() < 0.06;
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        s: bright ? Math.random() * 1.2 + 1.4 : Math.random() * 1.1 + 0.2,
        base: bright ? Math.random() * 0.3 + 0.55 : Math.random() * 0.4 + 0.1,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.0012 + Math.random() * 0.0016,
        col: tints[Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? 1 : 2)],
        bright,
      });
    }
  }
  function makeBg() {
    if (THEME === 'nebula') { makeNebula(); makeStars(); }
    else { makeIceSurface(); }
  }

  // ====================================================================
  // 背景绘制
  // ====================================================================
  function drawBgIce() {
    ctx.fillStyle = '#e9edf2';
    ctx.fillRect(0, 0, W, H);
    if (surface) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(bgRot);
      const dx = Math.sin(time * 0.00003) * 16, dy = Math.cos(time * 0.000023) * 14;
      ctx.drawImage(surface, -surfSize / 2 + dx, -surfSize / 2 + dy);
      ctx.restore();
    }
  }
  function drawBgNebula() {
    const drift = 6;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, W, H);
    if (nebula) {
      ctx.globalAlpha = 1;
      ctx.drawImage(nebula, Math.sin(time * 0.00004) * drift, Math.cos(time * 0.00003) * drift);
    }
    for (const st of stars) {
      const a = Math.max(0, st.base + Math.sin(time * st.twSpeed + st.tw) * 0.14);
      if (st.bright) {
        const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.s * 4);
        g.addColorStop(0, `rgba(${st.col[0]},${st.col[1]},${st.col[2]},${a * 0.5})`);
        g.addColorStop(1, `rgba(${st.col[0]},${st.col[1]},${st.col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.s * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${st.col[0]},${st.col[1]},${st.col[2]},${a})`;
      ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ====================================================================
  // 边/节点/标签绘制:两套
  // ====================================================================
  function drawIce() {
    const hov = ptr.hoverId;
    const linked = hov ? adj[hov] : null;
    const P = pal();

    // 边:神经纤维。静息暗灰蓝很淡;与当前节点相连的边 → 点亮青色脉冲
    ctx.lineCap = 'round';
    for (const e of edges) {
      const a = nodeById[e.a], b = nodeById[e.b];
      if (!a || !b) continue;
      const active = hov && (e.a === hov || e.b === hov);
      const col = active ? P.accent : P.edge;
      const baseA = active ? 0.34 : (0.10 + e.w * 0.015);
      const c = edgeControl(e, a, b);
      const breathe = 0.5 + 0.5 * Math.sin(time * e.brFreq + e.brPhase);
      ctx.lineWidth = (active ? 3.0 : 1.6) / view.scale;
      ctx.strokeStyle = rgba(col, baseA * 0.55);
      curve(a, c, b);
      let head = (e.boff + time * 0.001 * e.bspeed) % 1;
      if (head < 0) head += 1;
      const bandW = 0.16;
      const peakA = active ? 0.95 : (0.18 + 0.12 * breathe);
      const lg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      lg.addColorStop(0, rgba(col, baseA));
      const lo = head - bandW, hi = head + bandW;
      if (lo > 0) lg.addColorStop(lo, rgba(col, baseA));
      lg.addColorStop(clamp01(head), rgba(col, peakA));
      if (hi < 1) lg.addColorStop(hi, rgba(col, baseA));
      lg.addColorStop(1, rgba(col, baseA));
      ctx.lineWidth = (active ? 1.8 : 1.0) / view.scale;
      ctx.strokeStyle = lg;
      curve(a, c, b);
    }

    // 节点:落影 + 深色反差核 + 顶部高光;当前/相连 → 青色强调环
    for (const nd of nodes) {
      const hovered = nd.id === hov;
      const isLinked = linked && linked.has(nd.id);
      const x = nd.x, y = nd.y;
      const r = nd.r * (hovered ? 1.3 : 1);
      const sh = ctx.createRadialGradient(x, y + r * 0.6, 0, x, y + r * 0.6, r * 4.5);
      sh.addColorStop(0, 'rgba(18,28,42,0.28)');
      sh.addColorStop(1, 'rgba(18,28,42,0)');
      ctx.fillStyle = sh;
      ctx.beginPath(); ctx.arc(x, y + r * 0.6, r * 4.5, 0, Math.PI * 2); ctx.fill();
      if (hovered || isLinked) {
        const ga = hovered ? 0.5 : 0.24;
        const ring = ctx.createRadialGradient(x, y, 0, x, y, r * 3.6);
        ring.addColorStop(0, rgba(P.accent, ga));
        ring.addColorStop(0.5, rgba(P.accent, ga * 0.35));
        ring.addColorStop(1, rgba(P.accent, 0));
        ctx.fillStyle = ring;
        ctx.beginPath(); ctx.arc(x, y, r * 3.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = rgba(colorOf(nd), 1);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      const hl = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x - r * 0.3, y - r * 0.4, r * 1.25);
      hl.addColorStop(0, 'rgba(255,255,255,0.5)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (hovered) {
        ctx.fillStyle = rgba(P.accent, 0.92);
        ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 标签:深字 + 白描边,恒正
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const nd of nodes) {
      const hovered = nd.id === hov;
      const isLinked = linked && linked.has(nd.id);
      const a = hovered ? 1 : (isLinked ? 0.82 : 0.52);
      ctx.font = `${(hovered ? 13 : 12) / view.scale}px -apple-system, "Microsoft YaHei", sans-serif`;
      const ty = nd.y + nd.r * 2.8 + 4;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 / view.scale;
      ctx.strokeStyle = `rgba(255,255,255,${0.72 * a})`;
      ctx.strokeText(nd.label, nd.x, ty);
      ctx.fillStyle = `rgba(26,34,48,${a})`;
      ctx.fillText(nd.label, nd.x, ty);
    }
  }

  function drawNebula() {
    const P = pal();
    // 边:发光神经纤维(叠加发光,一道亮带沿线流动)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const e of edges) {
      const a = nodeById[e.a], b = nodeById[e.b];
      if (!a || !b) continue;
      const c = edgeControl(e, a, b);
      const breathe = 0.5 + 0.5 * Math.sin(time * e.brFreq + e.brPhase);
      const ambient = (0.05 + e.w * 0.02) * (0.6 + 0.4 * breathe);
      let head = (e.boff + time * 0.001 * e.bspeed) % 1;
      if (head < 0) head += 1;
      const bandW = 0.16;
      ctx.lineWidth = 3.4 / view.scale;
      ctx.strokeStyle = rgba(P.edge, ambient * 0.55);
      curve(a, c, b);
      const peak = Math.min(1, ambient + 0.55 + 0.3 * breathe);
      const lg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      lg.addColorStop(0, rgba(P.edge, ambient));
      const lo = head - bandW, hi = head + bandW;
      if (lo > 0) lg.addColorStop(lo, rgba(P.edge, ambient));
      lg.addColorStop(Math.max(0, Math.min(1, head)), rgba(P.edge, peak));
      if (hi < 1) lg.addColorStop(hi, rgba(P.edge, ambient));
      lg.addColorStop(1, rgba(P.edge, ambient));
      ctx.lineWidth = 1.3 / view.scale;
      ctx.strokeStyle = lg;
      curve(a, c, b);
    }

    // 节点:光晕 + 实心核 + 白心
    for (const nd of nodes) {
      const hovered = nd.id === ptr.hoverId;
      const x = nd.x, y = nd.y;
      const r = nd.r * (hovered ? 1.25 : 1);
      const glow = nd.glow * (hovered ? 1.4 : 1);
      const col = colorOf(nd);
      const halo = r * 6.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
      g.addColorStop(0, rgba(col, 0.9 * glow));
      g.addColorStop(0.18, rgba(col, 0.45 * glow));
      g.addColorStop(0.5, rgba(col, 0.12 * glow));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, halo, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(col, 1);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.9 * glow})`;
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 标签:默认淡,hover 变亮
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const nd of nodes) {
      const hovered = nd.id === ptr.hoverId;
      const a = hovered ? 0.95 : 0.4;
      ctx.font = `${(hovered ? 13 : 12) / view.scale}px -apple-system, "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = `rgba(230,235,240,${a})`;
      ctx.fillText(nd.label, nd.x, nd.y + nd.r * 2.8 + 4);
    }
  }

  // ====================================================================
  // 绘制总入口
  // ====================================================================
  function draw() {
    if (THEME === 'nebula') drawBgNebula(); else drawBgIce();
    ctx.save();
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.scale, view.scale);
    if (THEME === 'nebula') drawNebula(); else drawIce();
    ctx.restore();
  }

  // 自动适配:旋转主题用最大半径当包围盒(任何角度不出界);静止主题用真实包围盒(贴更紧)。
  function fitView() {
    if (!nodes.length || !W || !H) return;
    const pad = THEMES[THEME].rotate ? 150 : 140;
    let span;
    if (THEMES[THEME].rotate) {
      let maxR = 0;
      for (const nd of nodes) maxR = Math.max(maxR, Math.hypot(nd.bx, nd.by));
      span = maxR * 2 + pad * 2;
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const nd of nodes) {
        minX = Math.min(minX, nd.bx); maxX = Math.max(maxX, nd.bx);
        minY = Math.min(minY, nd.by); maxY = Math.max(maxY, nd.by);
      }
      span = Math.max((maxX - minX), (maxY - minY)) + pad * 2;
    }
    const scale = Math.min(W / span, H / span, 1.6);
    view.scale = Math.max(0.3, scale);
    view.x = 0; view.y = 0;
  }

  function loop(ts) {
    if (!t0) { t0 = ts; lastTs = ts; }
    time = ts - t0;
    let dt = ts - lastTs;
    lastTs = ts;
    if (dt > 100) dt = 100;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ====================================================================
  // 坐标 / 命中测试 / 交互
  // ====================================================================
  function screenToWorld(sx, sy) {
    return { x: (sx - W / 2 - view.x) / view.scale, y: (sy - H / 2 - view.y) / view.scale };
  }
  function nodeAt(sx, sy) {
    const w = screenToWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const nd of nodes) {
      const dx = w.x - nd.x, dy = w.y - nd.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const hitR = nd.r * 2 + 12 / view.scale;
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
          const cos = Math.cos(rot), sin = Math.sin(rot);
          nd.bx = w.x * cos + w.y * sin;  // 逆旋转回基准坐标系(rot=0 时即原值)
          nd.by = -w.x * sin + w.y * cos;
          nd.x = w.x; nd.y = w.y;
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
        if (window.StarnetApp) window.StarnetApp.openItemFromGraph(ptr.dragId);
      }
      ptr.down = false; ptr.dragId = null; ptr.panning = false;
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('mouseleave', () => {
      if (!ptr.down) { ptr.hoverId = null; canvas.style.cursor = 'grab'; }
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
  // 主题切换
  // ====================================================================
  function applyHostBg() { if (host) host.style.background = THEMES[THEME].hostBg; }
  function updateThemeBtn() { if (themeBtn) themeBtn.textContent = '主题:' + THEMES[THEME].label; }
  function switchTheme() {
    THEME = THEME === 'ice' ? 'nebula' : 'ice';
    saveTheme(THEME);
    rot = 0; rotSpeed = 0; bgRot = 0;
    applyHostBg();
    updateThemeBtn();
    makeBg();
    fitView();
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
    makeBg();
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
    if (themeBtn) themeBtn.classList.toggle('hidden', !hasData);
    if (!hasData) {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      return;
    }

    if (!canvas) {
      canvas = document.createElement('canvas');
      host.appendChild(canvas);
      ctx = canvas.getContext('2d');
      bindEvents();
      if (themeBtn) themeBtn.addEventListener('click', switchTheme);
      const ro = new ResizeObserver(() => resize());
      ro.observe(host);
    }
    applyHostBg();
    updateThemeBtn();
    resize();
    nodeById = buildGraph(items);
    fitView();
    t0 = 0; time = 0; lastTs = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  window.StarnetGraph = { render };
  render().catch((err) => console.error('节点图启动渲染失败', err));
})();
