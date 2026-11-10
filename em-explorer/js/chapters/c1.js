/* C.1 Electric Charge & Electric Fields */
(function () {
  'use strict';
  const { draw, colors } = EM;
  const D = draw;
  const TAU = Math.PI * 2;
  const clamp = EM.clamp;
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const rand = (a, b) => a + Math.random() * (b - a);
  const EPS0 = 8.854e-12;
  const K = 1 / (4 * Math.PI * EPS0);

  /* ================================================================== drawing helpers */

  /** Filled charge marker with a white sign (readable on any background). */
  function chip(ctx, x, y, sign, r = 6, alpha = 1) {
    if (!sign) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = sign > 0 ? colors.pos : colors.neg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.4, r / 3.4);
    ctx.beginPath();
    const s = r * 0.55;
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    if (sign > 0) {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Yellow air ion with a dark sign (as in the notes' lightning-conductor diagram). */
  function ion(ctx, x, y, sign, alpha = 1, r = 5.5) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const s = r * 0.55;
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    if (sign > 0) {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
    }
    ctx.stroke();
    ctx.restore();
  }

  const ROD_STYLE = {
    polythene: { fill: '#334155', edge: '#94a3b8' },
    perspex: { fill: 'rgba(226,232,240,0.30)', edge: 'rgba(226,232,240,0.85)' },
    metal: { fill: '#94a3b8', edge: '#e2e8f0' },
    plastic: { fill: '#b45309', edge: '#fbbf24' },
  };

  /** Rod (capsule) from (x1,y1) to (x2,y2). o: {mat, w, n, sign, from, to, hand} — charges drawn on the from..to part. */
  function drawRod(ctx, x1, y1, x2, y2, o = {}) {
    const st = ROD_STYLE[o.mat || 'polythene'];
    const w = o.w || 16;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = w + 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = o.mat === 'perspex' ? '#1e293b' : st.fill;
    ctx.lineWidth = w;
    ctx.stroke();
    if (o.mat === 'perspex') {
      ctx.strokeStyle = st.fill;
      ctx.stroke();
    }
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len,
      ny = (x2 - x1) / len;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * w * 0.25, y1 + ny * w * 0.25);
    ctx.lineTo(x2 + nx * w * 0.25, y2 + ny * w * 0.25);
    ctx.stroke();
    ctx.restore();
    if (o.hand) {
      ctx.save();
      ctx.fillStyle = '#f2c9a0';
      ctx.strokeStyle = '#7c5a3a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x1, y1, w * 0.95, w * 0.8, Math.atan2(y2 - y1, x2 - x1), 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    const n = Math.min(o.n || 0, 14);
    const a = o.from ?? 0.45,
      b = o.to ?? 0.95;
    for (let i = 0; i < n; i++) {
      const t = a + ((b - a) * (i + 0.5)) / n;
      chip(ctx, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, o.sign, Math.min(6, w * 0.36));
    }
  }

  /**
   * Gold leaf electroscope. (x, y) = centre of the top of the cap, s = scale.
   * st: {angle (rad), capQ, leafQ (signed counts to draw), label, finger}
   * Returns geometry {capL, capR, capY, bottom}.
   */
  function drawElectroscope(ctx, x, y, s, st = {}) {
    const capW = 36 * s,
      capH = 7 * s;
    const caseTop = y + 34 * s,
      caseBot = y + 178 * s,
      hw = 60 * s;
    ctx.save();
    // base
    ctx.fillStyle = '#475569';
    D.roundRect(ctx, x - hw - 10 * s, caseBot, 2 * (hw + 10 * s), 16 * s, 4 * s);
    ctx.fill();
    // glass case
    ctx.fillStyle = 'rgba(148,163,184,0.10)';
    ctx.fillRect(x - hw, caseTop, 2 * hw, caseBot - caseTop);
    ctx.strokeStyle = 'rgba(203,213,225,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - hw, caseTop, 2 * hw, caseBot - caseTop);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x - hw - 4 * s, caseTop, 7 * s, caseBot - caseTop);
    ctx.fillRect(x + hw - 3 * s, caseTop, 7 * s, caseBot - caseTop);
    ctx.fillRect(x - hw - 4 * s, caseTop - 3 * s, 2 * hw + 8 * s, 6 * s);
    // scale behind leaf
    const hx = x,
      hy = y + 96 * s,
      L = 52 * s;
    ctx.strokeStyle = 'rgba(203,213,225,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * 1.2;
      ctx.beginPath();
      ctx.moveTo(hx + Math.sin(a) * (L + 6 * s), hy + Math.cos(a) * (L + 6 * s));
      ctx.lineTo(hx + Math.sin(a) * (L + (i % 4 === 0 ? 14 : 10) * s), hy + Math.cos(a) * (L + (i % 4 === 0 ? 14 : 10) * s));
      ctx.stroke();
    }
    // insulator bush
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#475569';
    D.roundRect(ctx, x - 8 * s, caseTop - 16 * s, 16 * s, 28 * s, 3 * s);
    ctx.fill();
    ctx.stroke();
    // metal rod
    ctx.strokeStyle = colors.metal;
    ctx.lineWidth = 3.5 * s;
    ctx.beginPath();
    ctx.moveTo(x, y + capH);
    ctx.lineTo(x, y + 134 * s);
    ctx.stroke();
    // gold leaf
    const a = clamp(st.angle || 0, 0, 1.25);
    ctx.strokeStyle = colors.gold;
    ctx.lineWidth = 5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx + 2 * s, hy);
    ctx.lineTo(hx + 2 * s + Math.sin(a) * L, hy + Math.cos(a) * L);
    ctx.stroke();
    // earth terminal
    ctx.fillStyle = '#eab308';
    D.roundRect(ctx, x + hw + 4 * s, y + 104 * s, 13 * s, 14 * s, 3 * s);
    ctx.fill();
    // cap
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.2;
    D.roundRect(ctx, x - capW, y, 2 * capW, capH, 3 * s);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // charges
    if (st.capQ) {
      const n = Math.min(8, Math.round(Math.abs(st.capQ)));
      for (let i = 0; i < n; i++) chip(ctx, x - capW + (2 * capW * (i + 0.5)) / n, y - 7 * s, Math.sign(st.capQ), 5 * s);
    }
    if (st.leafQ) {
      const n = Math.min(10, Math.round(Math.abs(st.leafQ)));
      const sg = Math.sign(st.leafQ);
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          const t = 0.15 + 0.85 * ((i / 2 + 0.5) / Math.ceil(n / 2));
          chip(ctx, x - 9 * s, hy + t * 34 * s - 6 * s, sg, 4.5 * s);
        } else {
          const t = 0.25 + 0.75 * (((i - 1) / 2 + 0.5) / Math.floor(n / 2));
          const px = hx + 2 * s + Math.sin(a) * L * t,
            py = hy + Math.cos(a) * L * t;
          chip(ctx, px + Math.cos(a) * 9 * s, py - Math.sin(a) * 9 * s, sg, 4.5 * s);
        }
      }
    }
    if (st.finger) {
      ctx.save();
      ctx.fillStyle = '#f2c9a0';
      ctx.strokeStyle = '#7c5a3a';
      ctx.lineWidth = 1.5;
      D.roundRect(ctx, x + capW - 4 * s, y - 16 * s, 46 * s, 14 * s, 7 * s);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      D.text(ctx, 'earthed (finger)', x + capW + 22 * s, y - 28 * s, { size: 11, color: colors.good, weight: 700 });
    }
    if (st.label) D.text(ctx, st.label, x, caseBot + 28 * s, { size: 12, color: colors.muted });
    return { capL: x - capW, capR: x + capW, capY: y, bottom: caseBot + 16 * s };
  }

  /** Van de Graaff generator: dome centre (x,y) radius r, base top at baseY. */
  function drawVdG(ctx, x, y, r, baseY, o = {}) {
    ctx.save();
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - 10, y + r * 0.7, 20, baseY - (y + r * 0.7));
    ctx.strokeRect(x - 10, y + r * 0.7, 20, baseY - (y + r * 0.7));
    ctx.fillStyle = '#1d4ed8';
    D.roundRect(ctx, x - 52, baseY, 104, 30, 6);
    ctx.fill();
    ctx.fillStyle = o.on === false ? '#475569' : '#ef4444';
    ctx.beginPath();
    ctx.arc(x + 34, baseY + 10, 4, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#f8fafc');
    g.addColorStop(0.45, '#94a3b8');
    g.addColorStop(1, '#334155');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (o.charged) {
      const n = o.n || 12;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (TAU * (i + 0.5)) / n;
        if (o.skip && o.skip(a)) continue;
        chip(ctx, x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9), 1, 5);
      }
    }
    if (o.label) D.text(ctx, o.label, x, baseY + 15, { size: 11, color: '#e2e8f0', weight: 600 });
  }

  /** Pear-shaped conductor outline. Local tip along +x (rotated by rot). */
  const PEAR_K = 2.1;
  function pearPoints(cx, cy, R, rot, n = 48) {
    const beta = Math.acos(1 / PEAR_K);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = beta + ((TAU - 2 * beta) * i) / n;
      pts.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    pts.push([PEAR_K * R, 0]);
    const c = Math.cos(rot),
      s = Math.sin(rot);
    return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }
  /** Charge sites on a pear in local coordinates: few on the rounded end, crowded near the point. */
  function pearSites(R) {
    const beta = Math.acos(1 / PEAR_K);
    const out = [];
    for (const deg of [180, 145, 215, 110, 250]) {
      const a = (deg * Math.PI) / 180;
      out.push([(R + 8) * Math.cos(a), (R + 8) * Math.sin(a)]);
    }
    const tx = PEAR_K * R;
    for (const side of [1, -1]) {
      const px = R * Math.cos(beta),
        py = side * R * Math.sin(beta);
      const len = Math.hypot(tx - px, py);
      // outward normal of the straight edge running from the tangent point to the tip
      const nx = Math.abs(py) / len,
        ny = (side * (tx - px)) / len;
      for (const f of [0.5, 0.72, 0.9]) out.push([px + (tx - px) * f + nx * 8, py * (1 - f) + ny * 8]);
    }
    out.push([tx + 9, 0]);
    return out;
  }
  function drawPear(ctx, cx, cy, R, rot, charged) {
    const pts = pearPoints(cx, cy, R, rot);
    ctx.save();
    // insulating handle (always straight up)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - R - 46);
    ctx.stroke();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.stroke();
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 2, cx, cy, R * 1.6);
    g.addColorStop(0, '#f1f5f9');
    g.addColorStop(1, '#64748b');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (charged) {
      const c = Math.cos(rot),
        s = Math.sin(rot);
      for (const [x, y] of pearSites(R)) chip(ctx, cx + x * c - y * s, cy + x * s + y * c, 1, 4.5);
    }
  }

  /** Candle flame with base at (x, y). lean in radians (positive → leans right). */
  function drawFlame(ctx, x, y, lean, t, size = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    const fl = 1 + 0.07 * Math.sin(t * 23) + 0.05 * Math.sin(t * 37);
    ctx.scale(size * (1 - Math.abs(lean) * 0.15), size * fl);
    const g = ctx.createRadialGradient(0, -8, 1, 0, -12, 26);
    g.addColorStop(0, '#fff7ed');
    g.addColorStop(0.35, '#fde047');
    g.addColorStop(1, 'rgba(249,115,22,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-10, -6, -7, -22, 0, -34);
    ctx.bezierCurveTo(7, -22, 10, -6, 0, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(59,130,246,0.6)';
    ctx.beginPath();
    ctx.ellipse(0, -3, 3.5, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Move obj {x,y,rot?} along obj.path = [{x,y,rot?,wait?,fn?}] at speed px/s. Returns true while moving. */
  function follow(obj, dt, speed) {
    if (!obj.path || !obj.path.length) return false;
    if (obj.wait > 0) {
      obj.wait -= dt;
      return true;
    }
    const tgt = obj.path[0];
    const dx = tgt.x - obj.x,
      dy = tgt.y - obj.y,
      d = Math.hypot(dx, dy),
      step = speed * dt;
    if (d <= step) {
      obj.x = tgt.x;
      obj.y = tgt.y;
      if (tgt.rot != null) obj.rot = tgt.rot;
      obj.path.shift();
      if (tgt.wait) obj.wait = tgt.wait;
      if (tgt.fn) tgt.fn();
    } else {
      if (tgt.rot != null) obj.rot += (tgt.rot - obj.rot) * Math.min(1, step / d);
      obj.x += (dx / d) * step;
      obj.y += (dy / d) * step;
    }
    return true;
  }

  /* ================================================================== field-line helpers */

  /**
   * EM.physics.fieldLines only seeds from positive charges when any exist, so lines from an excess of
   * negative charge out to infinity would be missing. Trace from negatives too and keep those lines
   * that don't end on a positive charge.
   */
  function traceAll(charges, o) {
    const P = EM.physics;
    const hasPos = charges.some((c) => c.q > 0),
      hasNeg = charges.some((c) => c.q < 0);
    if (!hasPos && !hasNeg) return [];
    let lines = P.fieldLines(charges, o);
    if (hasPos && hasNeg) {
      const r0 = o.r0 || 14;
      for (const ln of P.fieldLines(charges, Object.assign({}, o, { from: 'neg' }))) {
        const e = ln.points[ln.points.length - 1];
        if (!charges.some((c) => c.q > 0 && Math.hypot(e[0] - c.x, e[1] - c.y) < r0 * 1.6)) lines.push(ln);
      }
    }
    return lines;
  }

  /** Keep only the parts of each line outside the circle (cx, cy, R). */
  function clipOutside(lines, cx, cy, R) {
    const out = [];
    for (const ln of lines) {
      let cur = [];
      const pts = ln.points;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const outside = Math.hypot(p[0] - cx, p[1] - cy) >= R;
        if (outside) {
          if (!cur.length && i > 0) cur.push(edgePoint(pts[i - 1], p, cx, cy, R));
          cur.push(p);
        } else if (cur.length) {
          cur.push(edgePoint(pts[i - 1], p, cx, cy, R));
          if (cur.length > 1) out.push({ points: cur, dir: ln.dir });
          cur = [];
        }
      }
      if (cur.length > 1) out.push({ points: cur, dir: ln.dir });
    }
    return out;
  }
  function edgePoint(a, b, cx, cy, R) {
    let lo = 0,
      hi = 1;
    const ina = Math.hypot(a[0] - cx, a[1] - cy) < R;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      const x = a[0] + (b[0] - a[0]) * m,
        y = a[1] + (b[1] - a[1]) * m;
      const inside = Math.hypot(x - cx, y - cy) < R;
      if (inside === ina) lo = m;
      else hi = m;
    }
    const m = (lo + hi) / 2;
    return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
  }

  /* ================================================================== topic sims */

  /* ---------- rub the rod ---------- */
  function simRubRod(el) {
    const W = 680,
      H = 300;
    const ROD = { x0: 130, x1: 540, y: 175, w: 22 };
    const MAX = 16;
    const st = { mat: 'polythene', rodSigns: [], clothSigns: [], fly: [], cloth: { x: 600, y: 95, w: 96, h: 64 }, drag: null, acc: 0, auto: 0 };
    const overlaps = () => {
      const c = st.cloth;
      return c.x + c.w / 2 > ROD.x0 && c.x - c.w / 2 < ROD.x1 && c.y + c.h / 2 > ROD.y - ROD.w / 2 && c.y - c.h / 2 < ROD.y + ROD.w / 2;
    };
    const moved = () => st.rodSigns.length + st.fly.length;
    function rubBy(dist) {
      if (!overlaps()) return;
      st.acc += dist;
      while (st.acc > 42 && moved() < MAX) {
        st.acc -= 42;
        const rx = clamp(st.cloth.x + rand(-30, 30), ROD.x0 + 14, ROD.x1 - 14);
        const local = { x: rand(-st.cloth.w / 2 + 12, st.cloth.w / 2 - 12), y: rand(-st.cloth.h / 2 + 12, st.cloth.h / 2 - 12) };
        const toRod = st.mat === 'polythene';
        st.fly.push({ t: 0, rx, ry: ROD.y + rand(-4, 4), local, toRod });
      }
      if (moved() >= MAX) st.acc = 0;
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Rub a rod with a woollen cloth',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        if (st.auto > 0) {
          st.auto -= dt;
          const nx = 335 + 160 * Math.sin(s.t * 5.5);
          const d = Math.abs(nx - st.cloth.x);
          st.cloth.x = nx;
          st.cloth.y = approach(st.cloth.y, ROD.y, 10, dt);
          rubBy(d);
        }
        const mat = st.mat;
        drawRod(ctx, ROD.x0, ROD.y, ROD.x1, ROD.y, { mat, w: ROD.w });
        D.text(ctx, mat === 'polythene' ? 'Polythene rod' : 'Perspex rod', ROD.x0, ROD.y + 34, { align: 'left', size: 13, color: colors.muted });
        const rodSign = mat === 'polythene' ? -1 : 1;
        for (const r of st.rodSigns) chip(ctx, r.x, r.y, rodSign, 6.5);
        // cloth
        const c = st.cloth;
        ctx.save();
        ctx.fillStyle = 'rgba(190,24,93,0.55)';
        ctx.strokeStyle = '#f9a8d4';
        ctx.lineWidth = 2;
        D.roundRect(ctx, c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(253,242,248,0.25)';
        ctx.lineWidth = 1;
        for (let k = -c.w / 2 + 8; k < c.w / 2; k += 9) {
          ctx.beginPath();
          ctx.moveTo(c.x + k, c.y - c.h / 2 + 4);
          ctx.lineTo(c.x + k - 4, c.y + c.h / 2 - 4);
          ctx.stroke();
        }
        ctx.restore();
        for (const cs of st.clothSigns) chip(ctx, c.x + cs.x, c.y + cs.y, -rodSign, 6.5);
        D.text(ctx, 'Woollen cloth (drag me)', c.x, c.y - c.h / 2 - 12, { size: 12, color: '#f9a8d4', weight: 600 });
        // flying electrons
        for (let i = st.fly.length - 1; i >= 0; i--) {
          const f = st.fly[i];
          f.t += dt / 0.45;
          const cx = c.x + f.local.x,
            cy = c.y + f.local.y;
          const [ax, ay, bx, by] = f.toRod ? [cx, cy, f.rx, f.ry] : [f.rx, f.ry, cx, cy];
          const tt = Math.min(1, f.t);
          D.electron(ctx, ax + (bx - ax) * tt, ay + (by - ay) * tt - Math.sin(tt * Math.PI) * 24, 4.5);
          if (f.t >= 1) {
            st.fly.splice(i, 1);
            st.rodSigns.push({ x: f.rx, y: f.ry });
            st.clothSigns.push(f.local);
          }
        }
        D.text(ctx, 'Each ● = an electron moving.  Each sign = one unit of excess charge.', W / 2, H - 16, { size: 12, color: colors.muted });
        const n = st.rodSigns.length;
        rd.set('n', String(n));
        rd.set('rod', (n ? (rodSign < 0 ? '−' : '+') : '') + n);
        rd.set('cloth', (n ? (rodSign < 0 ? '+' : '−') : '') + n);
        rd.set('tot', '0 ✓');
      },
      onDown(p) {
        const c = st.cloth;
        if (Math.abs(p.x - c.x) < c.w / 2 + 6 && Math.abs(p.y - c.y) < c.h / 2 + 6) st.drag = { dx: p.x - c.x, dy: p.y - c.y, lx: p.x, ly: p.y };
      },
      onMove(p) {
        if (!st.drag) return;
        st.auto = 0;
        const c = st.cloth;
        c.x = clamp(p.x - st.drag.dx, c.w / 2, W - c.w / 2);
        c.y = clamp(p.y - st.drag.dy, c.h / 2 + 16, H - c.h / 2 - 26);
        rubBy(Math.abs(p.x - st.drag.lx) + 0.3 * Math.abs(p.y - st.drag.ly));
        st.drag.lx = p.x;
        st.drag.ly = p.y;
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    function reset() {
      st.rodSigns = [];
      st.clothSigns = [];
      st.fly = [];
      st.acc = 0;
      st.auto = 0;
      st.cloth.x = 600;
      st.cloth.y = 95;
      paint();
    }
    EM.segmented(c, {
      label: 'Rod material',
      options: [
        { value: 'polythene', label: 'Polythene' },
        { value: 'perspex', label: 'Perspex' },
      ],
      value: 'polythene',
      onChange: (v) => {
        st.mat = v;
        reset();
      },
    });
    EM.button(c, '▶ Rub for me', () => (st.auto = 2.4), 'primary');
    EM.button(c, 'Reset (neutral)', reset);
    const rd = EM.readout(el, [
      { key: 'n', label: 'Electrons moved' },
      { key: 'rod', label: 'Rod charge (units)' },
      { key: 'cloth', label: 'Cloth charge (units)' },
      { key: 'tot', label: 'Total charge' },
    ]);
    const status = EM.status(el);
    function paint() {
      status.set(
        st.mat === 'polythene'
          ? 'Polythene + wool: electrons move <strong>from the cloth to the rod</strong> → rod <strong>negative</strong>, cloth <strong>positive</strong>.'
          : 'Perspex + wool: electrons move <strong>from the rod to the cloth</strong> → rod <strong>positive</strong>, cloth <strong>negative</strong>.',
        'good'
      );
    }
    paint();
  }

  /* ---------- conductor vs insulator ---------- */
  function simConductors(el) {
    const W = 680,
      H = 300;
    const bars = {
      metal: { x0: 230, x1: 600, y: 92, h: 30, es: [], label: 'Metal bar (conductor)' },
      plastic: { x0: 230, x1: 600, y: 212, h: 30, es: [], label: 'Plastic bar (insulator)' },
    };
    const free = Array.from({ length: 34 }, () => ({ x: rand(236, 594), y: rand(-10, 10), vx: rand(-40, 40), vy: rand(-30, 30) }));
    const bound = Array.from({ length: 30 }, (_, i) => ({ x: 240 + i * 12.2, y: (i % 2 ? 6 : -6), ph: rand(0, TAU) }));
    const rod = { x: 200, y: 152, path: [], wait: 0 };
    const st = { finger: 0, msg: '' };
    function layoutMetal() {
      const b = bars.metal,
        n = b.es.length;
      b.es.forEach((e, i) => {
        e.tx = b.x0 + 14 + ((b.x1 - b.x0 - 28) * (i + 0.5)) / n;
        e.ty = b.y + (i % 2 ? 7 : -7);
      });
    }
    function touch(which) {
      if (rod.path.length) return;
      const b = bars[which];
      rod.path = [
        { x: b.x0 - 4, y: b.y, wait: 0.35, fn: () => addElectrons(which) },
        { x: 200, y: 152 },
      ];
    }
    function addElectrons(which) {
      const b = bars[which];
      for (let i = 0; i < 8; i++) {
        const e = { x: b.x0 + 4, y: b.y, tx: b.x0 + 8 + rand(0, 34), ty: b.y + rand(-9, 9) };
        b.es.push(e);
      }
      if (which === 'metal') {
        layoutMetal();
        st.msg = 'Metal: the electrons <strong>spread out over the whole bar</strong> — charge flows through a conductor.';
      } else st.msg = 'Plastic: the electrons <strong>stay where the rod touched</strong> — charge can’t flow through an insulator.';
    }
    function earth() {
      st.finger = 1.4;
      const m = bars.metal;
      m.es.forEach((e) => {
        e.leave = true;
        e.tx = m.x1 + 30;
        e.ty = m.y - 30;
      });
      const pl = bars.plastic;
      pl.es.forEach((e) => {
        if (e.x > pl.x1 - 40) {
          e.leave = true;
          e.tx = pl.x1 + 30;
          e.ty = pl.y - 30;
        }
      });
      st.msg = 'Touching the far ends: the metal loses all its excess electrons to earth through you; the plastic keeps its charge (it’s at the other end).';
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Conductor versus insulator',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        follow(rod, dt, 520);
        for (const key of ['metal', 'plastic']) {
          const b = bars[key];
          ctx.save();
          ctx.fillStyle = '#0f172a';
          ctx.fillRect((b.x0 + b.x1) / 2 - 5, b.y + b.h / 2, 10, 46);
          if (key === 'metal') {
            const g = ctx.createLinearGradient(0, b.y - b.h / 2, 0, b.y + b.h / 2);
            g.addColorStop(0, '#cbd5e1');
            g.addColorStop(1, '#64748b');
            ctx.fillStyle = g;
          } else ctx.fillStyle = '#7c2d12';
          D.roundRect(ctx, b.x0, b.y - b.h / 2, b.x1 - b.x0, b.h, 6);
          ctx.fill();
          ctx.restore();
          D.text(ctx, b.label, b.x0, b.y - b.h / 2 - 13, { align: 'left', size: 13, weight: 600 });
          D.text(ctx, 'insulating stand', (b.x0 + b.x1) / 2 + 10, b.y + b.h / 2 + 40, { align: 'left', size: 11, color: colors.muted });
          if (key === 'metal') {
            for (const f of free) {
              f.x += f.vx * dt;
              f.y += f.vy * dt;
              if (f.x < b.x0 + 4 || f.x > b.x1 - 4) f.vx *= -1;
              if (Math.abs(f.y) > 11) f.vy *= -1;
              f.x = clamp(f.x, b.x0 + 4, b.x1 - 4);
              f.y = clamp(f.y, -11, 11);
              ctx.fillStyle = 'rgba(30,58,138,0.55)';
              ctx.beginPath();
              ctx.arc(f.x, b.y + f.y, 2.2, 0, TAU);
              ctx.fill();
            }
          } else {
            for (const q of bound) {
              q.ph += dt * 6;
              ctx.fillStyle = 'rgba(253,186,116,0.45)';
              ctx.beginPath();
              ctx.arc(q.x + Math.cos(q.ph) * 3, b.y + q.y + Math.sin(q.ph) * 3, 2, 0, TAU);
              ctx.fill();
            }
          }
          for (let i = b.es.length - 1; i >= 0; i--) {
            const e = b.es[i];
            const rate = key === 'metal' || e.leave ? 4 : 9;
            e.x = approach(e.x, e.tx, rate, dt);
            e.y = approach(e.y, e.ty, rate, dt);
            D.electron(ctx, e.x, e.y, 4.5);
            if (e.leave && Math.hypot(e.x - e.tx, e.y - e.ty) < 6) b.es.splice(i, 1);
          }
        }
        if (st.finger > 0) {
          st.finger -= dt;
          for (const key of ['metal', 'plastic']) {
            const b = bars[key];
            ctx.save();
            ctx.fillStyle = '#f2c9a0';
            ctx.strokeStyle = '#7c5a3a';
            ctx.lineWidth = 1.5;
            D.roundRect(ctx, b.x1 - 4, b.y - 8, 60, 16, 8);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          D.text(ctx, 'finger → earth', 640, 150, { size: 12, color: colors.good, weight: 700 });
        }
        drawRod(ctx, rod.x - 170, rod.y, rod.x, rod.y, { mat: 'polythene', w: 16, n: 5, sign: -1, from: 0.55, to: 0.97 });
        D.text(ctx, 'Charged polythene rod', rod.x - 85, rod.y + 26, { size: 12, color: colors.muted });
        rd.set('m', String(bars.metal.es.length));
        rd.set('p', String(bars.plastic.es.length));
      },
    });
    const c = EM.controls(el);
    EM.button(c, 'Touch the metal bar', () => touch('metal'), 'primary');
    EM.button(c, 'Touch the plastic bar', () => touch('plastic'), 'primary');
    EM.button(c, 'Touch the far ends (earth)', earth);
    EM.button(c, 'Reset', () => {
      bars.metal.es = [];
      bars.plastic.es = [];
      st.msg = '';
    });
    const rd = EM.readout(el, [
      { key: 'm', label: 'Excess electrons on metal' },
      { key: 'p', label: 'Excess electrons on plastic' },
    ]);
    const status = EM.status(el);
    EM.every(200, () => status.set(st.msg || 'Touch each bar with the charged rod and watch where the extra electrons (bright dots) go. Faint dots in the metal are its loosely bound “free” electrons.', st.msg ? 'good' : ''));
  }

  /* ---------- gold leaf electroscope ---------- */
  function simElectroscope(el) {
    const W = 680,
      H = 380;
    const CAP = { x: 470, y: 92 },
      SC = 1.05;
    const capL = CAP.x - 36 * SC;
    const st = { Qe: 0, rod: 'polythene', level: 2, tipX: 170, angle: 0, wasContact: false, earthT: 0, drag: null, event: '', eventT: 0 };
    const rodY = CAP.y - 3;
    const rodCharge = () => (st.rod === 'polythene' ? -3 * st.level : st.rod === 'perspex' ? 3 * st.level : 0);
    function physics(dt) {
      const gap = capL - st.tipX;
      const contact = gap <= 1;
      const f = contact ? 1 : Math.pow(clamp(1 - gap / 260, 0, 1), 2);
      const indu = rodCharge() * f * 0.5;
      if (contact && !st.wasContact) {
        if (rodCharge()) {
          st.Qe = clamp(st.Qe + rodCharge() * 0.5, -12, 12);
          setEvent('Touching the cap: some of the rod’s charge flows onto the electroscope, so it stays charged when the rod is removed.');
        } else if (st.rod === 'metal') setEvent('Leaf collapses: the metal rod <strong>conducts</strong> the charge away through your hand to earth → it is a <strong>conductor</strong>.');
        else setEvent('Leaf doesn’t move: plastic does not let charge flow through it → it is an <strong>insulator</strong>.');
      }
      st.wasContact = contact;
      const earthing = st.earthT > 0 || (contact && st.rod === 'metal');
      if (st.earthT > 0) st.earthT -= dt;
      if (earthing) st.Qe = approach(st.Qe, -indu / 0.6, 7, dt);
      const leaf = 0.6 * st.Qe + indu,
        capQ = 0.4 * st.Qe - indu;
      st.angle = approach(st.angle, 1.05 * (1 - Math.exp(-Math.abs(leaf) / 3.2)), 5, dt);
      return { contact, f, indu, leaf, capQ, earthing };
    }
    function setEvent(msg) {
      st.event = msg;
      st.eventT = 4;
    }
    let ph = {};
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Gold leaf electroscope',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        ph = physics(dt);
        if (st.eventT > 0) st.eventT -= dt;
        drawElectroscope(ctx, CAP.x, CAP.y, SC, { angle: st.angle, capQ: ph.capQ, leafQ: ph.leaf, finger: st.earthT > 0 });
        // labels
        const lab = (t, x, y, tx, ty) => {
          D.line(ctx, x, y, tx, ty, 'rgba(148,163,184,0.6)', 1);
          D.text(ctx, t, x + 4, y, { align: 'left', size: 12, color: colors.muted });
        };
        lab('Metal cap', 560, 60, CAP.x + 36, CAP.y + 3);
        lab('Insulator', 572, 118, CAP.x + 9, CAP.y + 34);
        lab('Metal rod', 572, 160, CAP.x + 2, CAP.y + 72);
        lab('Gold leaf', 572, 214, CAP.x + 8, CAP.y + 130);
        lab('Earth connection', 572, 258, CAP.x + 74, CAP.y + 118);
        // rod
        const mat = st.rod;
        const n = Math.abs(rodCharge());
        drawRod(ctx, st.tipX - 250, rodY, st.tipX, rodY, { mat, w: 15, n: n ? n : 0, sign: Math.sign(rodCharge()), from: 0.55, to: 0.97, hand: mat === 'metal' });
        const names = { polythene: 'Charged polythene rod (−)', perspex: 'Charged Perspex rod (+)', metal: 'Metal rod held in your hand', plastic: 'Uncharged plastic ruler' };
        D.text(ctx, names[mat] + ' — drag it', clamp(st.tipX - 125, 150, 330), rodY + 26, { size: 12, color: colors.muted });
        D.text(ctx, 'Leaf divergence: ' + Math.round((st.angle * 180) / Math.PI) + '°', 140, H - 22, { size: 13, weight: 700, color: colors.gold });
      },
      onDown(p) {
        if (Math.abs(p.y - rodY) < 24 && p.x < st.tipX + 12 && p.x > st.tipX - 260) st.drag = { dx: p.x - st.tipX };
      },
      onMove(p) {
        if (st.drag) st.tipX = clamp(p.x - st.drag.dx, 60, capL);
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    const scen = {
      detect: { Qe: 0, rod: 'polythene', hint: 'Function 1 — <strong>detect charge</strong>: drag the charged rod towards the cap. The leaf diverges even before it touches.' },
      sign: { Qe: -5, rod: 'polythene', hint: 'Function 2 — <strong>identify the sign</strong>: the electroscope is already <strong>negative</strong>. Bring a rod near: more divergence → same sign as the electroscope; less → opposite sign.' },
      size: { Qe: 0, rod: 'polythene', hint: 'Function 3 — <strong>size of charge</strong>: change the amount of charge on the rod and bring it to the same spot. More charge → bigger divergence.' },
      conductor: { Qe: -5, rod: 'metal', hint: 'Function 4 — <strong>conductor or insulator?</strong> The electroscope is charged. Touch the cap with the metal rod (held in your hand), then reset and try the plastic ruler.' },
    };
    const sel = EM.select(c, {
      label: 'Function to try',
      options: [
        { value: 'detect', label: '1. Detect a charge' },
        { value: 'sign', label: '2. Is it + or −?' },
        { value: 'size', label: '3. How big is the charge?' },
        { value: 'conductor', label: '4. Conductor or insulator?' },
      ],
      value: 'detect',
      onChange: (v) => applyScenario(v),
    });
    const rodSeg = EM.segmented(c, {
      label: 'Object',
      options: [
        { value: 'polythene', label: 'Polythene (−)' },
        { value: 'perspex', label: 'Perspex (+)' },
        { value: 'metal', label: 'Metal rod' },
        { value: 'plastic', label: 'Plastic ruler' },
      ],
      value: 'polythene',
      onChange: (v) => {
        st.rod = v;
        st.tipX = 170;
        st.wasContact = false;
      },
    });
    EM.slider(c, { label: 'Charge on rod', min: 1, max: 3, step: 1, value: 2, fmt: (v) => ['small', 'medium', 'large'][v - 1], onInput: (v) => (st.level = v) });
    EM.button(c, 'Earth the cap (touch with finger)', () => {
      st.earthT = 1.2;
      setEvent('Earthing: electrons flow between the electroscope and the earth until the leaf is neutral.');
    });
    EM.button(c, 'Reset', () => applyScenario(sel.value));
    const status = EM.status(el);
    let hint = '';
    function applyScenario(v) {
      const sc = scen[v];
      st.Qe = sc.Qe;
      st.rod = sc.rod;
      rodSeg.set(sc.rod);
      st.tipX = 170;
      st.wasContact = false;
      st.earthT = 0;
      st.eventT = 0;
      st.angle = 1.05 * (1 - Math.exp(-Math.abs(0.6 * sc.Qe) / 3.2));
      hint = sc.hint;
    }
    applyScenario('detect');
    EM.every(150, () => {
      if (st.eventT > 0) return status.set(st.event, 'good');
      const base = 0.6 * st.Qe;
      if (rodCharge() && ph.f > 0.08 && !ph.contact) {
        if (Math.abs(st.Qe) < 0.3) return status.set('The leaf <strong>diverges</strong>: the rod repels like charges down onto the rod and leaf, which then repel each other → a charge is <strong>detected</strong>.', 'good');
        if (Math.abs(ph.leaf) > Math.abs(base) + 0.4 && Math.sign(ph.leaf) === Math.sign(base)) return status.set('Divergence <strong>increases</strong> → the rod has the <strong>same sign</strong> as the electroscope.', 'good');
        if (Math.abs(ph.leaf) < Math.abs(base) - 0.4 || Math.sign(ph.leaf) !== Math.sign(base)) return status.set('Divergence <strong>decreases</strong> → the rod has the <strong>opposite sign</strong> to the electroscope.', 'warn');
      }
      status.set(hint, '');
    });
  }

  /* ---------- John Travoltage ---------- */
  function simTravoltage(el) {
    const W = 680,
      H = 340,
      FLOOR = 300;
    const HANDLE = { x: 574, y: 196 };
    const st = { px: 150, phase: 0, mode: 'neg', drag: null, acc: 0, toks: [], spark: 0, msg: '', msgT: 0 };
    function limbs() {
      const px = st.px,
        sw = Math.sin(st.phase) * 14;
      const sh = { x: px, y: 146 },
        hips = { x: px, y: 214 };
      let hand2;
      if (px > 360) {
        const dx = HANDLE.x - sh.x,
          dy = HANDLE.y - sh.y,
          d = Math.hypot(dx, dy),
          L = Math.min(d, 86);
        hand2 = { x: sh.x + (dx / d) * L, y: sh.y + (dy / d) * L };
      } else hand2 = { x: px + 22, y: 206 };
      return {
        head: { x: px, y: 106 },
        neck: { x: px, y: 124 },
        sh,
        hips,
        lf: { x: px - 12 + sw, y: FLOOR - 4 },
        rf: { x: px + 12 - sw, y: FLOOR - 4 },
        hand1: { x: px - 18, y: 206 },
        hand2,
      };
    }
    const SEGS = [
      ['hips', 'lf'],
      ['hips', 'rf'],
      ['neck', 'hips'],
      ['sh', 'hand1'],
      ['sh', 'hand2'],
    ];
    function segPoint(Lm, tok) {
      const [a, b] = SEGS[tok.seg];
      const A = Lm[a],
        B = Lm[b];
      return { x: A.x + (B.x - A.x) * tok.t + tok.off, y: A.y + (B.y - A.y) * tok.t };
    }
    function addCharge() {
      const Lm = limbs();
      const seg = Math.random() < 0.5 ? 0 : 1;
      const tok = { seg, t: rand(0.85, 1), off: rand(-4, 4), age: 0 };
      const p = segPoint(Lm, tok);
      tok.x = p.x;
      tok.y = p.y;
      st.toks.push(tok);
    }
    function discharge() {
      const Lm = limbs();
      st.spark = 0.35;
      if (st.mode === 'neg') {
        st.toks.forEach((t) => {
          t.state = 'leave';
          t.path = [{ x: Lm.sh.x, y: Lm.sh.y }, { x: Lm.hand2.x, y: Lm.hand2.y }, { x: HANDLE.x + 4, y: HANDLE.y }];
        });
        st.msg = 'Zap! Excess electrons rush <strong>from you to the metal handle</strong>. The charges equalise — you feel a small shock and may see a spark.';
      } else {
        st.toks.forEach((t, i) => {
          t.state = 'wait';
          t.e = { x: HANDLE.x, y: HANDLE.y, delay: i * 0.03 };
        });
        st.msg = 'Zap! Electrons rush <strong>from the metal handle into you</strong> to cancel your positive charge — a small shock and spark.';
      }
      st.msgT = 4;
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'John Travoltage: charging by walking on carpet',
      draw(ctx, s, dt) {
        // room
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, W, FLOOR);
        ctx.fillStyle = '#7c2d12';
        ctx.fillRect(0, FLOOR, W, H - FLOOR);
        ctx.strokeStyle = 'rgba(254,215,170,0.18)';
        for (let x = -20; x < W; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, FLOOR);
          ctx.lineTo(x + 20, H);
          ctx.stroke();
        }
        D.text(ctx, 'carpet', 40, FLOOR + 22, { size: 11, color: '#fed7aa' });
        // door
        ctx.fillStyle = '#92400e';
        ctx.fillRect(560, 64, 120, FLOOR - 64);
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 3;
        ctx.strokeRect(560, 64, 120, FLOOR - 64);
        ctx.fillStyle = '#cbd5e1';
        D.roundRect(ctx, HANDLE.x - 4, HANDLE.y - 5, 26, 10, 4);
        ctx.fill();
        D.text(ctx, 'metal door handle', 616, 232, { size: 11, color: '#fde68a' });
        // person
        const Lm = limbs();
        ctx.save();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(Lm.lf.x, Lm.lf.y);
        ctx.lineTo(Lm.hips.x, Lm.hips.y);
        ctx.lineTo(Lm.rf.x, Lm.rf.y);
        ctx.moveTo(Lm.neck.x, Lm.neck.y);
        ctx.lineTo(Lm.hips.x, Lm.hips.y);
        ctx.moveTo(Lm.hand1.x, Lm.hand1.y);
        ctx.lineTo(Lm.sh.x, Lm.sh.y);
        ctx.lineTo(Lm.hand2.x, Lm.hand2.y);
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(Lm.head.x, Lm.head.y, 17, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(Lm.head.x + 6, Lm.head.y - 3, 2.2, 0, TAU);
        ctx.fill();
        ctx.restore();
        // spark
        const d = Math.hypot(Lm.hand2.x - HANDLE.x, Lm.hand2.y - HANDLE.y);
        if (d < 14 && st.toks.some((t) => !t.state) && st.spark <= 0) discharge();
        if (st.spark > 0) {
          st.spark -= dt;
          ctx.save();
          ctx.strokeStyle = '#fef9c3';
          ctx.shadowColor = '#fde047';
          ctx.shadowBlur = 14;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(Lm.hand2.x, Lm.hand2.y);
          for (let k = 1; k < 5; k++) ctx.lineTo(Lm.hand2.x + ((HANDLE.x - Lm.hand2.x) * k) / 5 + rand(-6, 6), Lm.hand2.y + ((HANDLE.y - Lm.hand2.y) * k) / 5 + rand(-6, 6));
          ctx.lineTo(HANDLE.x, HANDLE.y);
          ctx.stroke();
          ctx.restore();
          D.text(ctx, 'ZAP!', HANDLE.x - 20, HANDLE.y - 34, { size: 18, weight: 800, color: '#fde047' });
        }
        // charges
        for (let i = st.toks.length - 1; i >= 0; i--) {
          const t = st.toks[i];
          t.age += dt;
          if (!t.state) {
            if (t.age > 0.5 && !t.spread) {
              t.spread = true;
              t.seg = Math.floor(rand(0, SEGS.length));
              t.t = rand(0.05, 0.95);
            }
            const p = segPoint(Lm, t);
            t.x = approach(t.x, p.x, 3, dt);
            t.y = approach(t.y, p.y, 3, dt);
          }
          if (t.state === 'leave') {
            if (!follow(t, dt, 380)) {
              st.toks.splice(i, 1);
              continue;
            }
          }
          if (t.state === 'wait') {
            const e = t.e;
            e.delay -= dt;
            if (e.delay <= 0) {
              const dx = t.x - e.x,
                dy = t.y - e.y,
                dd = Math.hypot(dx, dy),
                stp = 420 * dt;
              if (dd <= stp) {
                st.toks.splice(i, 1);
                continue;
              }
              e.x += (dx / dd) * stp;
              e.y += (dy / dd) * stp;
              D.electron(ctx, e.x, e.y, 4);
            }
          }
          if (st.mode === 'neg') D.electron(ctx, t.x, t.y, 4.2);
          else chip(ctx, t.x, t.y, 1, 5);
        }
        D.text(ctx, st.px < 360 ? 'Drag the person back and forth across the carpet…' : '…then walk up to the door handle.', 20, 24, { align: 'left', size: 13, color: colors.muted });
        if (st.msgT > 0) st.msgT -= dt;
        const n = st.toks.filter((t) => !t.state).length;
        rd.set('q', n ? (st.mode === 'neg' ? '−' : '+') + n : '0');
        rd.set('d', st.px > 360 ? Math.max(0, Math.round(d - 14)) + ' px' : '–');
      },
      onDown(p) {
        if (Math.abs(p.x - st.px) < 46 && p.y > 80 && p.y < FLOOR + 10) st.drag = { dx: p.x - st.px, lx: p.x };
      },
      onMove(p) {
        if (!st.drag) return;
        const nx = clamp(p.x - st.drag.dx, 70, 524);
        const dx = nx - st.px;
        st.px = nx;
        st.phase += dx * 0.09;
        st.acc += Math.abs(dx);
        while (st.acc > 20) {
          st.acc -= 20;
          if (st.toks.filter((t) => !t.state).length < 34 && st.px < 470) addCharge();
        }
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'When you shuffle, your shoes…',
      options: [
        { value: 'neg', label: 'gain electrons (−)' },
        { value: 'pos', label: 'lose electrons (+)' },
      ],
      value: 'neg',
      onChange: (v) => {
        st.mode = v;
        st.toks = [];
      },
    });
    EM.button(c, 'Reset', () => {
      st.toks = [];
      st.px = 150;
      st.msgT = 0;
    });
    const rd = EM.readout(el, [
      { key: 'q', label: 'Excess charge on you (units)' },
      { key: 'd', label: 'Gap from hand to handle' },
    ]);
    const status = EM.status(el);
    EM.every(200, () => {
      if (st.msgT > 0) return status.set(st.msg, 'good');
      const n = st.toks.filter((t) => !t.state).length;
      if (!n) return status.set('You are neutral. Friction between your shoes and the carpet will move electrons ' + (st.mode === 'neg' ? 'onto you.' : 'off you.'));
      status.set(st.mode === 'neg' ? `You have gained ${n} units of electrons — you are <strong>negatively charged</strong>. Now touch a conductor…` : `You have lost electrons — you are <strong>positively charged</strong> (+${n}). Now touch a conductor…`, 'warn');
    });
  }

  /* ---------- balloons ---------- */
  function simBalloon(el) {
    const W = 680,
      H = 320;
    const st = { scene: 'wall', charged: false, b: { x: 360, y: 140 }, home: { x: 360, y: 140 }, drag: null, stuck: false, th: 0, sites: [] };
    const RX = 40,
      RY = 50;
    st.sites = Array.from({ length: 12 }, (_, i) => {
      const a = Math.PI * 0.55 + (Math.PI * 0.9 * (i + 0.5)) / 12;
      const r = 0.55 + 0.35 * ((i * 7) % 5) / 4;
      return [Math.cos(a) * RX * r, Math.sin(a) * RY * r];
    });
    function balloon(ctx, x, y, charged, sites, tilt = 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(226,232,240,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + RY);
      ctx.quadraticCurveTo(x + 12, y + RY + 50, x - 4, y + RY + 110);
      ctx.stroke();
      const g = ctx.createRadialGradient(x - 12, y - 18, 4, x, y, RY * 1.1);
      g.addColorStop(0, '#fecaca');
      g.addColorStop(0.4, '#ef4444');
      g.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, RX, RY, tilt, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 5, y + RY + 6);
      ctx.lineTo(x + 5, y + RY + 6);
      ctx.lineTo(x, y + RY - 2);
      ctx.fill();
      ctx.restore();
      if (charged) for (const [sx, sy] of sites) chip(ctx, x + sx, y + sy, -1, 5.5);
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Charged balloons',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        if (st.scene === 'wall') {
          // wall
          ctx.fillStyle = '#78350f';
          ctx.fillRect(0, 0, 104, H);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          for (let y = 0; y < H; y += 24) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(104, y);
            ctx.stroke();
          }
          D.text(ctx, 'wall', 52, H - 14, { size: 12, color: '#fde68a', weight: 700 });
          const b = st.b;
          if (!st.drag) {
            if (st.stuck) b.x = 104 + RX + 1;
            else {
              b.x = approach(b.x, st.home.x, 2, dt);
              b.y = approach(b.y, st.home.y, 2, dt);
            }
          }
          // wall molecules polarise
          for (let y = 20; y < H; y += 26) {
            for (const x of [30, 58, 86]) {
              const dx = b.x - x,
                dy = b.y - y,
                dist = Math.hypot(dx, dy);
              const m = st.charged ? clamp(1.5 - dist / 170, 0, 1) : 0;
              const ux = dx / dist,
                uy = dy / dist;
              const sep = 1 + 7 * m;
              if (m < 0.05) {
                ctx.fillStyle = 'rgba(253,230,138,0.35)';
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, TAU);
                ctx.fill();
              } else {
                chip(ctx, x - ux * sep, y - uy * sep, -1, 4, 0.75);
                chip(ctx, x + ux * sep, y + uy * sep, 1, 4, 0.95);
              }
            }
          }
          balloon(ctx, b.x, b.y, st.charged, st.sites);
          D.text(ctx, st.stuck ? 'Stuck to the wall!' : 'Drag the balloon to the wall', clamp(b.x, 200, 600), clamp(b.y - RY - 18, 14, H), { size: 12, color: colors.muted });
        } else {
          const PX = 340,
            PY = 22,
            L = 200,
            half = RX + 1;
          const Kc = 8200;
          let target = 0;
          if (st.charged) {
            let th = 0.3;
            for (let k = 0; k < 30; k++) {
              const sep = 2 * half + 2 * L * Math.sin(th);
              th = Math.atan(Kc / (sep * sep));
            }
            target = th;
          }
          st.th = approach(st.th, target, 2.5, dt);
          ctx.fillStyle = '#475569';
          ctx.fillRect(PX - 90, PY - 8, 180, 8);
          for (const sg of [-1, 1]) {
            const ax = PX + sg * half,
              bx = ax + sg * L * Math.sin(st.th),
              by = PY + L * Math.cos(st.th);
            D.line(ctx, ax, PY, bx, by - RY, 'rgba(226,232,240,0.6)', 1.2);
            ctx.save();
            const g = ctx.createRadialGradient(bx - 12, by - 18, 4, bx, by, RY * 1.1);
            g.addColorStop(0, '#fecaca');
            g.addColorStop(0.4, '#ef4444');
            g.addColorStop(1, '#7f1d1d');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(bx, by, RX, RY, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
            if (st.charged) for (const [sx, sy] of st.sites.slice(0, 9)) chip(ctx, bx + sx * sg * -1, by + sy * 0.9 - 4, -1, 5);
          }
          if (st.charged && st.th > 0.1) {
            const y = PY + L * Math.cos(st.th);
            const xl = PX - half - L * Math.sin(st.th) - RX - 8,
              xr = PX + half + L * Math.sin(st.th) + RX + 8;
            D.arrow(ctx, xl, y, xl - 40, y, { color: colors.force });
            D.arrow(ctx, xr, y, xr + 40, y, { color: colors.force, label: '' });
            D.text(ctx, 'repel', xr + 64, y, { size: 12, color: colors.force, weight: 700 });
          }
          D.text(ctx, 'Two balloons hanging from threads', PX, H - 18, { size: 12, color: colors.muted });
        }
      },
      onDown(p) {
        if (st.scene !== 'wall') return;
        if (Math.hypot((p.x - st.b.x) / RX, (p.y - st.b.y) / RY) < 1.2) st.drag = { dx: p.x - st.b.x, dy: p.y - st.b.y };
      },
      onMove(p) {
        if (!st.drag) return;
        st.stuck = false;
        st.b.x = clamp(p.x - st.drag.dx, 104 + RX, W - RX);
        st.b.y = clamp(p.y - st.drag.dy, RY + 4, H - RY - 30);
      },
      onUp() {
        if (!st.drag) return;
        st.drag = null;
        if (st.charged && st.b.x - RX < 112) {
          st.stuck = true;
          st.home.y = st.b.y;
        } else st.home = { x: 360, y: 140 };
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Scene',
      options: [
        { value: 'wall', label: 'Balloon & wall' },
        { value: 'two', label: 'Two balloons' },
      ],
      value: 'wall',
      onChange: (v) => {
        st.scene = v;
        st.stuck = false;
        st.home = { x: 360, y: 140 };
      },
    });
    EM.button(c, 'Rub balloon(s) on your hair', () => (st.charged = true), 'primary');
    EM.button(c, 'Discharge', () => {
      st.charged = false;
      st.stuck = false;
      st.home = { x: 360, y: 140 };
    });
    const status = EM.status(el);
    EM.every(200, () => {
      if (!st.charged) return status.set('The balloon is neutral. Rub it on your hair: electrons move onto the balloon, making it negative.');
      if (st.scene === 'two') return status.set('Both balloons are negative. <strong>Objects with the same charge repel each other</strong>, so the threads swing apart.', 'good');
      if (st.stuck) return status.set('The balloon’s negative charges attract the positive charges on the wall’s surface — strong enough to hold it there.', 'good');
      status.set('Bring the negative balloon near the wall: the wall’s charges shift, + towards the balloon and − away. Let go when it touches.', '');
    });
  }

  /* ---------- where does the charge go? (charges relaxing in a conductor) ---------- */
  function pointInPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i],
        [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function nearestOnPoly(pts, x, y) {
    let best = null,
      bd = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j],
        [bx, by] = pts[i];
      const vx = bx - ax,
        vy = by - ay;
      const t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      const px = ax + vx * t,
        py = ay + vy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        best = [px, py];
      }
    }
    return { p: best, d: bd };
  }

  /** Pear outline whose point is rounded off with a small radius rt (a perfectly sharp vertex would trap charges on one spot). */
  function roundedPear(cx, cy, R, rt, n = 90) {
    const beta = Math.acos(1 / PEAR_K);
    const c = PEAR_K * (R - rt); // tip-circle centre: tangent to both straight edges
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = beta + ((TAU - 2 * beta) * i) / n;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    for (let i = 0; i <= 12; i++) {
      const a = -beta + (2 * beta * i) / 12;
      pts.push([cx + c + rt * Math.cos(a), cy + rt * Math.sin(a)]);
    }
    return pts;
  }

  function simChargeRelax(el) {
    const W = 680,
      H = 320;
    const pear = roundedPear(240, 160, 90, 8);
    const SHAPES = {
      sphere: {
        label: 'Sphere (A)',
        inside: (x, y) => Math.hypot(x - 340, y - 160) <= 115,
        project(x, y) {
          const d = Math.hypot(x - 340, y - 160) || 1;
          return [340 + ((x - 340) / d) * 115, 160 + ((y - 160) / d) * 115];
        },
        edgeDist: (x, y) => Math.abs(115 - Math.hypot(x - 340, y - 160)),
        path(ctx) {
          ctx.arc(340, 160, 115, 0, TAU);
        },
      },
      pear: {
        label: 'Pear-shaped (B)',
        inside: (x, y) => pointInPoly(pear, x, y),
        project: (x, y) => nearestOnPoly(pear, x, y).p,
        edgeDist: (x, y) => nearestOnPoly(pear, x, y).d,
        path(ctx) {
          pear.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
        },
      },
      can: {
        label: 'Hollow conductor (cross-section)',
        inside: (x, y) => {
          const d = Math.hypot(x - 340, y - 160);
          return d <= 120 && d >= 80;
        },
        project(x, y) {
          const d = Math.hypot(x - 340, y - 160) || 1;
          const r = d > 120 ? 120 : 80;
          return [340 + ((x - 340) / d) * r, 160 + ((y - 160) / d) * r];
        },
        edgeDist: (x, y) => Math.abs(120 - Math.hypot(x - 340, y - 160)),
        path(ctx) {
          ctx.arc(340, 160, 120, 0, TAU);
          ctx.moveTo(420, 160);
          ctx.arc(340, 160, 80, 0, TAU, true);
        },
      },
    };
    const st = { shape: 'pear', ps: [] };
    function sprinkle() {
      const sh = SHAPES[st.shape];
      st.ps = [];
      let guard = 0;
      while (st.ps.length < 48 && guard++ < 20000) {
        const x = rand(110, 600),
          y = rand(40, 280);
        if (!sh.inside(x, y)) continue;
        if (st.shape !== 'can' && sh.edgeDist(x, y) < 18) continue;
        if (st.shape === 'can' && Math.abs(Math.hypot(x - 340, y - 160) - 100) > 10) continue;
        st.ps.push({ x, y });
      }
    }
    sprinkle();
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Charges spreading out on a conductor',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        const sh = SHAPES[st.shape];
        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.28)';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        sh.path(ctx);
        ctx.fill('evenodd');
        ctx.stroke();
        ctx.restore();
        // relax: 2D (cylinder cross-section) Coulomb repulsion, overdamped
        const ps = st.ps;
        for (let sub = 0; sub < 3; sub++) {
          for (let i = 0; i < ps.length; i++) {
            let fx = 0,
              fy = 0;
            for (let j = 0; j < ps.length; j++) {
              if (i === j) continue;
              const dx = ps[i].x - ps[j].x,
                dy = ps[i].y - ps[j].y;
              const r2 = dx * dx + dy * dy + 9;
              fx += dx / r2;
              fy += dy / r2;
            }
            // tiny jitter so no charge can balance on an unstable point inside the metal
            let mx = fx * 14 + rand(-0.15, 0.15),
              my = fy * 14 + rand(-0.15, 0.15);
            const m = Math.hypot(mx, my);
            if (m > 2.5) {
              mx *= 2.5 / m;
              my *= 2.5 / m;
            }
            const nx = ps[i].x + mx,
              ny = ps[i].y + my;
            if (sh.inside(nx, ny)) {
              ps[i].x = nx;
              ps[i].y = ny;
            } else {
              const p = sh.project(nx, ny);
              ps[i].x = p[0];
              ps[i].y = p[1];
            }
          }
        }
        for (const p of ps) chip(ctx, p.x, p.y, 1, 5.5);
        D.text(ctx, sh.label, 20, 22, { align: 'left', size: 13, weight: 700 });
        if (st.shape === 'can') D.text(ctx, 'cavity', 340, 160, { size: 12, color: colors.muted });
        let surf = 0;
        for (const p of ps) if (sh.edgeDist(p.x, p.y) < 2.5 && (st.shape !== 'can' || Math.hypot(p.x - 340, p.y - 160) > 100)) surf++;
        rd.set('s', `${surf} of ${ps.length}`);
        if (st.shape === 'pear') {
          // local density ~ 1 / (mean gap to the two nearest neighbours) of the charge nearest each end
          const gapAt = (x, y) => {
            if (ps.length < 3) return NaN;
            const p0 = ps.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b));
            const ds = ps.filter((q) => q !== p0).map((q) => Math.hypot(q.x - p0.x, q.y - p0.y)).sort((a, b) => a - b);
            return (ds[0] + ds[1]) / 2;
          };
          const ratio = gapAt(150, 160) / gapAt(240 + PEAR_K * 90, 160);
          rd.set('d', Number.isFinite(ratio) ? '× ' + ratio.toFixed(1) + (ratio > 1.15 ? ' — higher at the point' : '') : '–');
          D.text(ctx, 'point', 240 + PEAR_K * 90 + 26, 160, { align: 'left', size: 12, color: colors.muted });
          D.text(ctx, 'rounded end', 140, 160, { align: 'right', size: 12, color: colors.muted });
        } else rd.set('d', 'even all round');
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Conductor',
      options: [
        { value: 'sphere', label: 'Sphere (A)' },
        { value: 'pear', label: 'Pear-shaped (B)' },
        { value: 'can', label: 'Hollow' },
      ],
      value: 'pear',
      onChange: (v) => {
        st.shape = v;
        sprinkle();
      },
    });
    EM.button(c, '↺ Sprinkle the charge again', sprinkle, 'primary');
    const rd = EM.readout(el, [
      { key: 's', label: 'Charges on the outer surface' },
      { key: 'd', label: 'Charge density at point ÷ at rounded end' },
    ]);
    EM.status(el, 'Like charges repel, so they push each other as far apart as possible: <strong>all the charge ends up on the outside surface</strong>, spread evenly on the sphere but crowded at the <strong>point</strong> of the pear (greatest curvature → greatest charge density). Nothing stays on the inside of the hollow conductor.');
  }

  /* ---------- Faraday cage ---------- */
  function simFaraday(el) {
    const W = 680,
      H = 340;
    const C = { x: 450, y: 170 },
      R = 82;
    const st = { q: { x: 160, y: 170 }, sign: 1, cage: true, lines: [], dirty: true, drag: false, chs: [] };
    function charges() {
      const real = { x: st.q.x, y: st.q.y, q: 2 * st.sign };
      if (!st.cage) return [real];
      const dx = real.x - C.x,
        dy = real.y - C.y,
        d = Math.hypot(dx, dy);
      // image charges for a neutral conducting sphere (exact outside the sphere)
      return [real, { x: C.x + (dx / d) * ((R * R) / d), y: C.y + (dy / d) * ((R * R) / d), q: (-2 * st.sign * R) / d }, { x: C.x, y: C.y, q: (2 * st.sign * R) / d }];
    }
    function recompute() {
      st.chs = charges();
      let lines = traceAll(st.chs, { perUnit: 7, step: 3, maxSteps: 1400, r0: 12, bounds: { x0: -30, y0: -30, x1: W + 30, y1: H + 30 } });
      if (st.cage) lines = clipOutside(lines, C.x, C.y, R);
      st.lines = lines;
      st.dirty = false;
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Faraday cage shielding',
      draw(ctx) {
        if (st.dirty) recompute();
        D.grid(ctx, W, H);
        D.fieldLines(ctx, st.lines, { arrowEvery: 110 });
        // cage
        ctx.save();
        if (st.cage) {
          ctx.fillStyle = colors.bg;
          ctx.beginPath();
          ctx.arc(C.x, C.y, R, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 4;
          ctx.setLineDash([7, 4]);
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(148,163,184,0.35)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(C.x, C.y, R, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
        // induced charges on the cage surface
        if (st.cage) {
          const ens = [];
          for (let i = 0; i < 28; i++) {
            const a = (TAU * i) / 28;
            const nx = Math.cos(a),
              ny = Math.sin(a);
            const [ex, ey] = EM.physics.E(st.chs, C.x + nx * (R + 2), C.y + ny * (R + 2), 1);
            ens.push({ a, en: ex * nx + ey * ny });
          }
          const mx = Math.max(...ens.map((e) => Math.abs(e.en))) || 1;
          for (const e of ens) {
            const rel = Math.abs(e.en) / mx;
            if (rel > 0.16) chip(ctx, C.x + Math.cos(e.a) * (R - 10), C.y + Math.sin(e.a) * (R - 10), Math.sign(e.en), 3 + 2.5 * rel);
          }
        }
        // phone inside
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        D.roundRect(ctx, C.x - 13, C.y - 22, 26, 44, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(C.x - 9, C.y - 16, 18, 28);
        ctx.restore();
        D.text(ctx, st.cage ? 'E = 0 inside' : 'phone', C.x, C.y + 38, { size: 12, weight: 700, color: st.cage ? colors.good : colors.text });
        D.charge(ctx, st.q.x, st.q.y, st.sign, { r: 18 });
        D.text(ctx, 'drag the charge', st.q.x, st.q.y + 32, { size: 11, color: colors.muted });
        const [ex, ey] = EM.physics.E([{ x: st.q.x, y: st.q.y, q: 2 }], C.x, C.y, 1);
        rd.set('e', st.cage ? '<span style="color:var(--good)">0 — shielded</span>' : EM.fmt(Math.hypot(ex, ey) * 4e4, 2) + ' (relative units)');
      },
      onDown(p) {
        if (Math.hypot(p.x - st.q.x, p.y - st.q.y) < 26) st.drag = true;
      },
      onMove(p) {
        if (!st.drag) return;
        let x = clamp(p.x, 24, W - 24),
          y = clamp(p.y, 24, H - 24);
        const dx = x - C.x,
          dy = y - C.y,
          d = Math.hypot(dx, dy);
        if (d < R + 40) {
          x = C.x + (dx / (d || 1)) * (R + 40);
          y = C.y + (dy / (d || 1)) * (R + 40);
        }
        st.q = { x, y };
        st.dirty = true;
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, {
      label: 'Faraday cage around the phone',
      value: true,
      onChange: (v) => {
        st.cage = v;
        st.dirty = true;
      },
    });
    EM.segmented(c, {
      label: 'Outside charge',
      options: [
        { value: 1, label: 'Positive' },
        { value: -1, label: 'Negative' },
      ],
      value: 1,
      onChange: (v) => {
        st.sign = v;
        st.dirty = true;
      },
    });
    const rd = EM.readout(el, [{ key: 'e', label: 'Electric field at the phone' }]);
    EM.status(el, 'With the cage on, charges in the metal rearrange (− on one side, + on the other) so that the field <strong>inside is zero</strong>. Notice that the field lines meet the metal at <strong>right angles</strong>.');
  }

  /* ---------- lightning conductor & point discharge ---------- */
  function simLightning(el) {
    const W = 680,
      H = 340;
    const TIP = { x: 340, y: 172 };
    const st = { cloud: 0.75, shape: 'sharp', neutrals: [], ions: [], made: 0, rate: 0 };
    const inConductor = (x, y) => y > TIP.y - 4 && Math.abs(x - TIP.x) < 6 + ((y - TIP.y) / (H - TIP.y)) * 40;
    function spawnNeutral() {
      for (let k = 0; k < 20; k++) {
        const x = rand(30, W - 30),
          y = rand(96, H - 10);
        if (!inConductor(x, y) && Math.hypot(x - TIP.x, y - TIP.y) > 26) return { x, y, vx: rand(-8, 8), vy: rand(-8, 8) };
      }
      return { x: 60, y: 200, vx: 0, vy: 0 };
    }
    for (let i = 0; i < 90; i++) st.neutrals.push(spawnNeutral());
    function pair(x, y) {
      st.ions.push({ x: x - 2, y, vx: 0, vy: 0, s: 1 }, { x: x + 2, y, vx: 0, vy: 0, s: -1 });
      st.made++;
    }
    // air is continually replenished, so ionisation events happen at random spots in the strong-field zone
    function ioniseNearTip(rz) {
      for (let k = 0; k < 10; k++) {
        const r = 14 + (rz - 14) * Math.pow(Math.random(), 1.5),
          a = -Math.PI - 0.5 + Math.random() * (Math.PI + 1);
        const x = TIP.x + Math.cos(a) * r,
          y = TIP.y + Math.sin(a) * r;
        if (!inConductor(x, y) && y > 92) return pair(x, y);
      }
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Point discharge at a lightning conductor',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        const sharp = st.shape === 'sharp';
        const rz = (sharp ? 120 : 45) * st.cloud;
        for (const n of st.neutrals) {
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          if (n.x < 20 || n.x > W - 20) n.vx *= -1;
          if (n.y < 92 || n.y > H - 6) n.vy *= -1;
        }
        let expected = dt * (sharp ? 28 : 3) * st.cloud * st.cloud;
        while (expected > 0 && st.ions.length < 240) {
          if (Math.random() < Math.min(1, expected)) ioniseNearTip(rz);
          expected -= 1;
        }
        ctx.fillStyle = 'rgba(148,163,184,0.55)';
        for (const n of st.neutrals) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.6, 0, TAU);
          ctx.fill();
        }
        // ions
        for (let i = st.ions.length - 1; i >= 0; i--) {
          const p = st.ions[i];
          const dx = p.x - TIP.x,
            dy = p.y - TIP.y,
            d = Math.hypot(dx, dy) || 1;
          const a = (sharp ? 9e5 : 3e5) * st.cloud / (d * d + 400);
          p.vx += (p.s * a * dx) / d * dt;
          p.vy += ((p.s * a * dy) / d - (p.s > 0 ? 30 : 0)) * dt;
          p.vx *= 1 - 0.8 * dt;
          p.vy *= 1 - 0.8 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.s < 0 && d < 9) {
            st.ions.splice(i, 1);
            continue;
          }
          // fast + ions knock further ions out of air atoms they collide with
          if (p.s > 0 && Math.hypot(p.vx, p.vy) > 90 && st.ions.length < 240 && Math.random() < dt * 1.2) pair(p.x + rand(-4, 4), p.y + rand(-4, 4));
          if (p.x < -10 || p.x > W + 10 || p.y < 70 || p.y > H + 10) {
            st.ions.splice(i, 1);
            continue;
          }
          ion(ctx, p.x, p.y, p.s, 1, 5);
        }
        // cloud
        ctx.save();
        ctx.fillStyle = '#334155';
        for (const [x, y, r] of [[120, 30, 44], [210, 22, 52], [310, 34, 50], [410, 22, 56], [510, 30, 48], [600, 26, 44], [60, 40, 36], [660, 40, 36]]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        const nc = Math.round(4 + st.cloud * 12);
        for (let i = 0; i < nc; i++) chip(ctx, 50 + ((W - 100) * (i + 0.5)) / nc, 70, -1, 5.5);
        D.text(ctx, 'negatively charged thundercloud', W / 2, 26, { size: 12, color: '#e2e8f0', weight: 600 });
        // conductor
        ctx.save();
        const g = ctx.createLinearGradient(TIP.x - 40, 0, TIP.x + 40, 0);
        g.addColorStop(0, '#64748b');
        g.addColorStop(0.5, '#e2e8f0');
        g.addColorStop(1, '#475569');
        ctx.fillStyle = g;
        ctx.beginPath();
        if (sharp) {
          ctx.moveTo(TIP.x, TIP.y);
          ctx.lineTo(TIP.x + 40, H);
          ctx.lineTo(TIP.x - 40, H);
        } else {
          ctx.moveTo(TIP.x + 24, TIP.y + 24);
          ctx.lineTo(TIP.x + 40, H);
          ctx.lineTo(TIP.x - 40, H);
          ctx.lineTo(TIP.x - 24, TIP.y + 24);
          ctx.arc(TIP.x, TIP.y + 24, 24, Math.PI, 0);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // induced + charge, crowded at the point
        const np = Math.round(3 + st.cloud * 11);
        for (let i = 0; i < np; i++) {
          if (sharp) {
            const t = Math.pow((i + 0.5) / np, 1.8);
            const y = TIP.y + 6 + t * 120,
              hw = 6 + ((y - TIP.y) / (H - TIP.y)) * 40;
            chip(ctx, TIP.x + (i % 2 ? hw : -hw) * 0.55, y, 1, 5);
          } else {
            const a = Math.PI + (Math.PI * (i + 0.5)) / np;
            chip(ctx, TIP.x + Math.cos(a) * 16, TIP.y + 24 + Math.sin(a) * 16, 1, 4.5);
          }
        }
        D.text(ctx, sharp ? 'tip of a lightning conductor' : 'rounded top', TIP.x + 52, H - 20, { align: 'left', size: 12, color: colors.muted });
        st.rate = approach(st.rate, 0, 1.5, dt);
        st.rate += st.made;
        rd.set('r', String(Math.round(st.rate * 1.5)));
        st.made = 0;
        rd.set('i', String(st.ions.length));
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Charge on the cloud', min: 0, max: 1, step: 0.05, value: 0.75, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => (st.cloud = v) });
    EM.segmented(c, {
      label: 'Conductor top',
      options: [
        { value: 'sharp', label: 'Sharp point' },
        { value: 'round', label: 'Rounded' },
      ],
      value: 'sharp',
      onChange: (v) => (st.shape = v),
    });
    const rd = EM.readout(el, [
      { key: 'r', label: 'Ions made per second' },
      { key: 'i', label: 'Ions in the air' },
    ]);
    EM.status(el, 'Grey dots = neutral air molecules. In the strong field at the tip they are split into ions: <strong>− ions are attracted to the tip</strong> and pass to earth; <strong>+ ions are repelled</strong> and knock more ions loose — the “electric wind”.');
  }

  /* ---------- field-line sandbox ---------- */
  function simSandbox(el) {
    const W = 680,
      H = 420;
    let gid = 1;
    const st = { charges: [], lines: [], dirty: true, tool: 'pos', mag: 1, drag: null, vec: false, preset: 'opposite' };
    const plate = (x, sign, g) => Array.from({ length: 13 }, (_, i) => ({ x, y: 120 + i * 15, q: 0.25 * sign, g, plate: true }));
    const PRESETS = {
      'single-pos': () => [{ x: 340, y: 210, q: 1 }],
      'single-neg': () => [{ x: 340, y: 210, q: -1 }],
      opposite: () => [{ x: 270, y: 210, q: 1 }, { x: 410, y: 210, q: -1 }],
      'two-pos': () => [{ x: 260, y: 210, q: 1 }, { x: 420, y: 210, q: 1 }],
      'two-neg': () => [{ x: 260, y: 210, q: -1 }, { x: 420, y: 210, q: -1 }],
      unequal: () => [{ x: 270, y: 210, q: 2 }, { x: 420, y: 210, q: -1 }],
      plates: () => plate(270, 1, 'P+').concat(plate(410, -1, 'P−')),
      empty: () => [],
    };
    function load(name) {
      st.preset = name;
      st.charges = PRESETS[name]().map((c) => Object.assign({ g: c.g || 'c' + gid++ }, c));
      st.dirty = true;
    }
    load('opposite');
    const rOf = (c) => (c.plate ? 5 : 10 + 4 * Math.abs(c.q));
    function recompute() {
      const plates = st.charges.some((c) => c.plate);
      st.lines = plates ? tracePlates(st.charges) : traceAll(st.charges, { perUnit: 8, step: 3, maxSteps: 1100, r0: 12, bounds: { x0: -40, y0: -40, x1: W + 40, y1: H + 40 } });
      st.dirty = false;
    }
    /**
     * Plates are rows of small charges; seeding every one of them in all directions (as fieldLines does) sends half
     * the lines out of the back of the plates, wrongly suggesting the outside field is as strong as the inside one.
     * Seed each + plate charge once on the side facing the − charges instead.
     */
    function tracePlates(chs) {
      const P = EM.physics;
      const negs = chs.filter((c) => c.q < 0);
      const nx = negs.length ? negs.reduce((a, c) => a + c.x, 0) / negs.length : null;
      const seeds = [];
      for (const c of chs) {
        const n = Math.round(8 * Math.abs(c.q));
        if (c.q > 0 && c.plate) seeds.push({ x: c.x + (nx == null ? 1 : Math.sign(nx - c.x) || 1) * 6, y: c.y, src: c, sg: 1 });
        else if (!c.plate) for (let i = 0; i < n; i++) seeds.push({ x: c.x + 12 * Math.cos((TAU * (i + 0.5)) / n), y: c.y + 12 * Math.sin((TAU * (i + 0.5)) / n), src: c, sg: Math.sign(c.q) });
      }
      const lines = [];
      for (const s of seeds) {
        let x = s.x,
          y = s.y,
          end = null;
        const pts = [[x, y]];
        for (let k = 0; k < 900; k++) {
          let [ex, ey] = P.E(chs, x, y, 1);
          let m = Math.hypot(ex, ey) || 1;
          [ex, ey] = P.E(chs, x + (1.5 * s.sg * ex) / m, y + (1.5 * s.sg * ey) / m, 1);
          m = Math.hypot(ex, ey) || 1;
          x += (3 * s.sg * ex) / m;
          y += (3 * s.sg * ey) / m;
          pts.push([x, y]);
          if (x < -40 || x > W + 40 || y < -40 || y > H + 40) break;
          end = chs.find((c) => c !== s.src && Math.sign(c.q) === -s.sg && Math.hypot(x - c.x, y - c.y) < (c.plate ? 5 : 10));
          if (end) break;
        }
        // lines traced backwards from − charges are only needed if they don't end on a + charge
        if (s.sg < 0 && end) continue;
        lines.push({ points: pts, dir: s.sg });
      }
      return lines;
    }
    function hit(p) {
      for (let i = st.charges.length - 1; i >= 0; i--) {
        const c = st.charges[i];
        if (Math.hypot(p.x - c.x, p.y - c.y) < rOf(c) + 6) return c;
      }
      return null;
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Electric field line sandbox',
      cursor: 'crosshair',
      draw(ctx, s) {
        if (st.dirty) recompute();
        D.grid(ctx, W, H);
        if (st.vec && st.charges.length) {
          for (let y = 20; y < H; y += 36) {
            for (let x = 20; x < W; x += 36) {
              const [ex, ey] = EM.physics.E(st.charges, x, y, 30);
              const m = Math.hypot(ex, ey);
              if (!m) continue;
              const a = clamp(Math.log10(m * 1e5) / 3, 0.12, 1);
              ctx.save();
              ctx.globalAlpha = a;
              D.arrow(ctx, x - (ex / m) * 9, y - (ey / m) * 9, x + (ex / m) * 9, y + (ey / m) * 9, { color: '#fde68a', width: 1.5, head: 6 });
              ctx.restore();
            }
          }
        }
        D.fieldLines(ctx, st.lines, { arrowEvery: 80 });
        // plates drawn as bars behind their charges
        const groups = {};
        for (const c of st.charges) if (c.plate) (groups[c.g] = groups[c.g] || []).push(c);
        for (const g of Object.values(groups)) {
          const xs = g.map((c) => c.x),
            ys = g.map((c) => c.y);
          const x = xs.reduce((a, b) => a + b, 0) / xs.length;
          ctx.save();
          ctx.fillStyle = g[0].q > 0 ? 'rgba(239,68,68,0.85)' : 'rgba(59,130,246,0.85)';
          D.roundRect(ctx, x - 6, Math.min(...ys) - 8, 12, Math.max(...ys) - Math.min(...ys) + 16, 4);
          ctx.fill();
          ctx.restore();
          for (const c of g) D.sign(ctx, c.x, c.y, Math.sign(c.q), 3.5);
        }
        for (const c of st.charges) if (!c.plate) D.charge(ctx, c.x, c.y, Math.sign(c.q), { r: rOf(c) });
        // test charge at the pointer
        const p = s.pointer;
        if (p.inside && !st.drag && st.charges.length && !hit(p)) {
          const [ex, ey] = EM.physics.E(st.charges, p.x, p.y, 4);
          const m = Math.hypot(ex, ey);
          if (m > 0) {
            const L = clamp(14 + 14 * Math.log10(m * 1e5), 10, 60);
            D.arrow(ctx, p.x, p.y, p.x + (ex / m) * L, p.y + (ey / m) * L, { color: colors.force, width: 2.5 });
            chip(ctx, p.x, p.y, 1, 5);
          }
          rd.set('E', EM.fmt(m * 1e5, 2));
        }
        rd.set('n', String(st.charges.filter((c) => !c.plate).length + Object.keys(groups).length));
      },
      onDown(p) {
        const c = hit(p);
        if (c) {
          if (st.tool === 'del') {
            st.charges = st.charges.filter((x) => x.g !== c.g);
            st.dirty = true;
          } else st.drag = { g: c.g, lx: p.x, ly: p.y };
          return;
        }
        if (st.tool === 'del') return;
        if (st.charges.filter((x) => !x.plate).length >= 10) return;
        st.charges.push({ x: p.x, y: p.y, q: (st.tool === 'pos' ? 1 : -1) * st.mag, g: 'c' + gid++ });
        st.dirty = true;
      },
      onMove(p) {
        if (!st.drag) return;
        const dx = p.x - st.drag.lx,
          dy = p.y - st.drag.ly;
        const grp = st.charges.filter((c) => c.g === st.drag.g);
        const okx = grp.every((c) => c.x + dx > 8 && c.x + dx < W - 8),
          oky = grp.every((c) => c.y + dy > 8 && c.y + dy < H - 8);
        for (const c of grp) {
          if (okx) c.x += dx;
          if (oky) c.y += dy;
        }
        st.drag.lx = p.x;
        st.drag.ly = p.y;
        st.dirty = true;
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    const sel = EM.select(c, {
      label: 'Pattern from the notes',
      options: [
        { value: 'single-pos', label: 'Single positive charge' },
        { value: 'single-neg', label: 'Single negative charge' },
        { value: 'opposite', label: 'Two opposite charges' },
        { value: 'two-pos', label: 'Two positive charges' },
        { value: 'two-neg', label: 'Two negative charges' },
        { value: 'unequal', label: 'Unequal charges (+2 and −1)' },
        { value: 'plates', label: 'Parallel plates' },
        { value: 'empty', label: 'Empty — build your own' },
      ],
      value: 'opposite',
      onChange: (v) => load(v),
    });
    EM.segmented(c, {
      label: 'Click on empty space to…',
      options: [
        { value: 'pos', label: 'Add +' },
        { value: 'neg', label: 'Add −' },
        { value: 'del', label: 'Delete' },
      ],
      value: 'pos',
      onChange: (v) => (st.tool = v),
    });
    EM.slider(c, { label: 'Size of new charges', min: 0.5, max: 3, step: 0.5, value: 1, fmt: (v) => v + ' unit' + (v === 1 ? '' : 's'), onInput: (v) => (st.mag = v) });
    EM.toggle(c, { label: 'Field direction arrows', value: false, onChange: (v) => (st.vec = v) });
    EM.button(c, 'Clear', () => {
      sel.set('empty');
      load('empty');
    });
    const rd = EM.readout(el, [
      { key: 'n', label: 'Charges / plates' },
      { key: 'E', label: 'Field strength at pointer (relative)' },
    ]);
    EM.status(el, 'Drag charges to move them. Hover to see the force (green) on a small <strong>+ test charge</strong>. Each charge gives 8 lines per unit, so a bigger charge has more lines — denser lines mean a stronger field.');
  }

  /* ---------- A, B, C: strength of charge ---------- */
  function drawABC(el) {
    EM.canvas(el, {
      width: 680,
      height: 220,
      label: 'Charges A, B and C with 8, 12 and 16 field lines',
      draw(ctx) {
        [['A', 8, 120, 'weakest'], ['B', 12, 340, ''], ['C', 16, 560, 'strongest']].forEach(([name, n, x, cap]) => {
          const y = 100;
          for (let i = 0; i < n; i++) {
            const a = (TAU * i) / n - Math.PI / 2;
            D.arrow(ctx, x + Math.cos(a) * 30, y + Math.sin(a) * 30, x + Math.cos(a) * 86, y + Math.sin(a) * 86, { color: colors.efield, width: 1.6, head: 7 });
          }
          ctx.fillStyle = colors.pos;
          ctx.beginPath();
          ctx.arc(x, y, 26, 0, TAU);
          ctx.fill();
          D.text(ctx, name, x, y + 1, { size: 20, weight: 800, color: '#fff' });
          D.text(ctx, `${n} lines${cap ? ' — ' + cap : ''}`, x, 204, { size: 13, color: colors.muted });
        });
      },
    });
  }

  /* ---------- Coulomb's law explorer ---------- */
  function simCoulomb(el) {
    const W = 680,
      H = 400;
    const X0 = 110,
      PX = 1000,
      Y = 66;
    const st = { q1: 2, q2: 5, d: 0.2, drag: false };
    const force = (d) => (K * st.q1 * 1e-6 * st.q2 * 1e-6) / (d * d);
    EM.canvas(el, {
      width: W,
      height: H,
      label: "Coulomb's law explorer",
      draw(ctx) {
        D.grid(ctx, W, H);
        const x2 = X0 + st.d * PX;
        const F = force(st.d);
        // ruler
        D.line(ctx, X0, Y + 44, x2, Y + 44, colors.muted, 1.5);
        D.line(ctx, X0, Y + 38, X0, Y + 50, colors.muted, 1.5);
        D.line(ctx, x2, Y + 38, x2, Y + 50, colors.muted, 1.5);
        D.text(ctx, 'd = ' + st.d.toFixed(2) + ' m', (X0 + x2) / 2, Y + 58, { size: 12, color: colors.text, weight: 600 });
        // arrows (log length so tiny and huge forces are both visible)
        if (F !== 0) {
          const L = clamp(14 + 24 * Math.log10(1 + Math.abs(F) / 0.01), 14, 110);
          const dir = F > 0 ? 1 : -1;
          const r1 = 12 + 3 * Math.abs(st.q1),
            r2 = 12 + 3 * Math.abs(st.q2);
          if (dir > 0) {
            D.arrow(ctx, x2 + r2 + 2, Y, x2 + r2 + 2 + L, Y, { color: colors.force });
            D.arrow(ctx, X0 - r1 - 2, Y, X0 - r1 - 2 - Math.min(L, 80), Y, { color: colors.force });
          } else {
            D.arrow(ctx, x2 - r2 - 2, Y, x2 - r2 - 2 - Math.min(L, (x2 - X0) / 2 - r2 - 6), Y, { color: colors.force });
            D.arrow(ctx, X0 + r1 + 2, Y, X0 + r1 + 2 + Math.min(L, (x2 - X0) / 2 - r1 - 6), Y, { color: colors.force });
          }
        }
        D.charge(ctx, X0, Y, Math.sign(st.q1), { r: 12 + 3 * Math.abs(st.q1) });
        D.charge(ctx, x2, Y, Math.sign(st.q2), { r: 12 + 3 * Math.abs(st.q2) });
        D.text(ctx, 'q₁ = ' + st.q1 + ' μC', X0, 16, { size: 12, weight: 600 });
        D.text(ctx, 'q₂ = ' + st.q2 + ' μC (drag)', clamp(x2, 90, W - 70), 16, { size: 12, weight: 600 });
        // graph
        const Fr = Math.abs(force(0.1));
        const yMax = Fr ? Fr * 1.12 : 1;
        const vLines = [{ x: st.d, color: colors.velocity, label: 'd' }];
        const hLines = [{ y: Math.abs(F), color: colors.velocity, label: 'F' }];
        if (2 * st.d <= 0.5) {
          vLines.push({ x: 2 * st.d, color: colors.efield, label: '2d' });
          hLines.push({ y: Math.abs(F) / 4, color: colors.efield, label: 'F/4' });
        }
        D.plot(ctx, { x: 96, y: 150, w: 550, h: 196 }, {
          xMin: 0.1,
          xMax: 0.5,
          yMin: 0,
          yMax,
          xLabel: 'distance between the charges, d (m)',
          yLabel: 'force F (N)',
          series: [{ fn: (d) => Math.abs(force(d)), color: colors.force }],
          vLines,
          hLines,
          markers: [{ x: st.d, y: Math.abs(F), color: colors.velocity }].concat(2 * st.d <= 0.5 ? [{ x: 2 * st.d, y: Math.abs(F) / 4, color: colors.efield }] : []),
        });
        rd.set('F', EM.fmt(Math.abs(F), 3) + ' N');
        rd.set('t', F > 0 ? 'repulsion' : F < 0 ? 'attraction' : 'none');
        rd.set('E', EM.fmt(Math.abs((K * st.q1 * 1e-6) / (st.d * st.d)), 3) + ' N C<sup>−1</sup>');
        rd.set('F2', 2 * st.d <= 0.5 ? EM.fmt(Math.abs(F) / 4, 3) + ' N' : '(off the graph)');
      },
      onDown(p) {
        const x2 = X0 + st.d * PX;
        if (Math.abs(p.x - x2) < 30 && Math.abs(p.y - Y) < 34) st.drag = true;
      },
      onMove(p) {
        if (!st.drag) return;
        st.d = Math.round(clamp((p.x - X0) / PX, 0.1, 0.5) * 100) / 100;
        dSl.set(st.d);
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'q₁', min: -5, max: 5, step: 0.5, value: 2, unit: 'μC', onInput: (v) => (st.q1 = v) });
    EM.slider(c, { label: 'q₂', min: -5, max: 5, step: 0.5, value: 5, unit: 'μC', onInput: (v) => (st.q2 = v) });
    const dSl = EM.slider(c, { label: 'Distance d', min: 0.1, max: 0.5, step: 0.01, value: 0.2, unit: 'm', fmt: (v) => v.toFixed(2), onInput: (v) => (st.d = v) });
    const rd = EM.readout(el, [
      { key: 'F', label: 'Force on each charge' },
      { key: 't', label: 'Type' },
      { key: 'F2', label: 'Force at 2d' },
      { key: 'E', label: 'E at q₂’s position (from q₁)' },
    ]);
    EM.status(el, 'Charges in air, so ε = ε₀. Double d and F drops to a quarter (the yellow marker). Change q₂: the force changes but <strong>E at that point doesn’t</strong> — E depends only on q₁ and d.');
  }

  /* ================================================================== experiment sims */

  /* ---------- DEMO 1: forces between charges (paper stirrup, seen from above) ---------- */
  function expForces(el) {
    const W = 640,
      H = 360;
    const P = { x: 390, y: 180 },
      HALF = 150;
    const DIR = { x: Math.cos(-0.8), y: Math.sin(-0.8) };
    const st = { th: 0, om: 0, hang: 'polythene', held: 'polythene', tip: { x: 190, y: 268 }, drag: null, F: { x: 0, y: 0 } };
    const sgn = (m) => (m === 'polythene' ? -1 : 1);
    const hangPts = () => [-148, -134, -120, -106, -92].map((s) => ({ x: P.x + s * Math.cos(st.th), y: P.y + s * Math.sin(st.th) }));
    const heldPts = () => [0, 14, 28, 42, 56].map((k) => ({ x: st.tip.x - k * DIR.x, y: st.tip.y - k * DIR.y }));
    function step(dt) {
      const hs = hangPts(),
        ss = heldPts();
      const qq = sgn(st.hang) * sgn(st.held);
      let tau = 0,
        Fx = 0,
        Fy = 0;
      for (const h of hs) {
        let fx = 0,
          fy = 0;
        for (const s of ss) {
          const dx = h.x - s.x,
            dy = h.y - s.y;
          const r2 = dx * dx + dy * dy + 64,
            r = Math.sqrt(r2);
          const f = (16000 * qq) / r2;
          fx += (f * dx) / r;
          fy += (f * dy) / r;
          if (r < 22) {
            fx += (60 * (22 - r) * dx) / r;
            fy += (60 * (22 - r) * dy) / r;
          }
        }
        tau += ((h.x - P.x) * fy - (h.y - P.y) * fx) / 1000;
        Fx += fx;
        Fy += fy;
      }
      st.F = { x: Fx, y: Fy };
      st.om += (tau - 5 * st.th - 3.2 * st.om) * dt;
      st.th = clamp(st.th + st.om * dt, -1.3, 1.3);
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Forces between charged rods',
      draw(ctx, s, dt) {
        for (let k = 0; k < 4; k++) step(dt / 4);
        D.grid(ctx, W, H);
        D.text(ctx, 'View from above', 16, 18, { align: 'left', size: 12, color: colors.muted, weight: 700 });
        // clamp arm
        ctx.save();
        ctx.fillStyle = '#334155';
        ctx.fillRect(P.x, P.y - 6, W - P.x, 12);
        ctx.restore();
        D.text(ctx, 'clamp arm', 560, P.y - 16, { size: 11, color: colors.muted });
        const c = Math.cos(st.th),
          sn = Math.sin(st.th);
        drawRod(ctx, P.x - HALF * c, P.y - HALF * sn, P.x + HALF * c, P.y + HALF * sn, { mat: st.hang, w: 16, n: 5, sign: sgn(st.hang), from: 0.02, to: 0.36 });
        // paper stirrup + thread
        ctx.save();
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.moveTo(P.x - 12 * c + 9 * sn, P.y - 12 * sn - 9 * c);
        ctx.lineTo(P.x + 12 * c + 9 * sn, P.y + 12 * sn - 9 * c);
        ctx.lineTo(P.x + 12 * c - 9 * sn, P.y + 12 * sn + 9 * c);
        ctx.lineTo(P.x - 12 * c - 9 * sn, P.y - 12 * sn + 9 * c);
        ctx.closePath();
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(P.x, P.y, 3, 0, TAU);
        ctx.fill();
        D.text(ctx, 'paper stirrup on a thread', P.x + 40, P.y + 30, { align: 'left', size: 11, color: '#fde68a' });
        // held rod
        const base = { x: st.tip.x - 220 * DIR.x, y: st.tip.y - 220 * DIR.y };
        drawRod(ctx, base.x, base.y, st.tip.x, st.tip.y, { mat: st.held, w: 16, n: 5, sign: sgn(st.held), from: 0.7, to: 0.98, hand: true });
        const lab = { x: st.tip.x - 60 * DIR.x + DIR.y * 30, y: st.tip.y - 60 * DIR.y - DIR.x * 30 };
        D.text(ctx, 'drag this rod', clamp(lab.x, 50, W - 50), clamp(lab.y, 12, H - 12), { size: 11, color: colors.muted });
        // force on the hanging rod's charged end
        const end = { x: P.x - (HALF - 30) * c, y: P.y - (HALF - 30) * sn };
        const Fm = Math.hypot(st.F.x, st.F.y);
        if (Fm > 0.5) {
          const L = clamp(16 * Math.log10(1 + Fm), 12, 70);
          const like = sgn(st.hang) === sgn(st.held);
          D.arrow(ctx, end.x, end.y, end.x + (st.F.x / Fm) * L, end.y + (st.F.y / Fm) * L, { color: colors.force, width: 3, label: like ? 'repel' : 'attract' });
        }
        const sep = Math.min(...hangPts().map((h) => Math.hypot(h.x - st.tip.x, h.y - st.tip.y)));
        rd.set('a', Math.round(Math.abs((st.th * 180) / Math.PI)) + '°');
        rd.set('d', (sep / 10).toFixed(1) + ' cm');
      },
      onDown(p) {
        const base = { x: st.tip.x - 220 * DIR.x, y: st.tip.y - 220 * DIR.y };
        const vx = st.tip.x - base.x,
          vy = st.tip.y - base.y;
        const t = clamp(((p.x - base.x) * vx + (p.y - base.y) * vy) / (vx * vx + vy * vy), 0, 1);
        if (Math.hypot(p.x - (base.x + vx * t), p.y - (base.y + vy * t)) < 22) st.drag = { dx: p.x - st.tip.x, dy: p.y - st.tip.y };
      },
      onMove(p) {
        if (!st.drag) return;
        st.tip.x = clamp(p.x - st.drag.dx, 40, W - 40);
        st.tip.y = clamp(p.y - st.drag.dy, 30, H - 20);
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    const opts = [
      { value: 'polythene', label: 'Polythene (−)' },
      { value: 'perspex', label: 'Perspex (+)' },
    ];
    EM.segmented(c, { label: 'Hanging rod', options: opts, value: 'polythene', onChange: (v) => (st.hang = v) });
    EM.segmented(c, { label: 'Rod in your hand', options: opts, value: 'polythene', onChange: (v) => (st.held = v) });
    EM.button(c, 'Reset', () => {
      st.tip = { x: 190, y: 268 };
      st.th = 0;
      st.om = 0;
    });
    const rd = EM.readout(el, [
      { key: 'a', label: 'Hanging rod turned by' },
      { key: 'd', label: 'Gap between charged ends' },
    ]);
    const status = EM.status(el);
    EM.every(200, () => {
      const like = sgn(st.hang) === sgn(st.held);
      status.set(like ? 'Both rods have the <strong>same</strong> charge → they <strong>repel</strong>. Move closer and the push gets stronger.' : 'The rods have <strong>opposite</strong> charges → they <strong>attract</strong>.', like ? 'good' : 'warn');
    });
  }

  /* ---------- DEMO 2: charge a sphere by induction ---------- */
  function expInduction(el) {
    const W = 640,
      H = 360;
    const C = { x: 360, y: 158 },
      R = 68,
      P = 5;
    const NEAR_A = Math.PI + 0.35,
      FAR_A = 0.35;
    const J = { x: C.x + R, y: C.y },
      CORNER = { x: 540, y: C.y },
      EARTH = { x: 540, y: 300 };
    const dirV = { x: Math.cos(NEAR_A), y: Math.sin(NEAR_A) };
    const st = { sign: -1, near: false, earthed: false, rodU: 0, toks: [], Q: 0, pendingIn: 0, flowT: 0 };
    const arcTargets = (n, centre) => {
      const spread = Math.min(0.35 + 0.24 * n, 2.4);
      return Array.from({ length: n }, (_, i) => {
        const a = centre - spread / 2 + (spread * (i + 0.5)) / n;
        return { x: C.x + Math.cos(a) * (R - 14), y: C.y + Math.sin(a) * (R - 14) };
      });
    };
    const ringTargets = (n) =>
      Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (TAU * (i + 0.5)) / n;
        return { x: C.x + Math.cos(a) * (R - 14), y: C.y + Math.sin(a) * (R - 14) };
      });
    function desired() {
      const out = { pos: [], neg: [] };
      const put = (sign, list) => (sign > 0 ? out.pos : out.neg).push(...list);
      if (!st.near) {
        if (st.Q) put(Math.sign(st.Q), ringTargets(Math.abs(st.Q)));
        return out;
      }
      put(-st.sign, arcTargets(P, NEAR_A));
      const far = st.Q + st.sign * P;
      if (far) put(Math.sign(far), arcTargets(Math.abs(far), FAR_A));
      return out;
    }
    const live = (sign) => st.toks.filter((t) => t.state === 'live' && t.s === sign);
    function assign(toks, targets) {
      const free = toks.slice();
      for (const tg of targets) {
        let bi = -1,
          bd = Infinity;
        free.forEach((t, i) => {
          const d = Math.hypot(t.x - tg.x, t.y - tg.y);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        if (bi < 0) break;
        const t = free.splice(bi, 1)[0];
        t.tx = tg.x;
        t.ty = tg.y;
      }
    }
    function layout() {
      const d = desired();
      const lp = live(1),
        ln = live(-1);
      let exP = lp.length - d.pos.length,
        exN = ln.length - d.neg.length;
      while (exP > 0 && exN > 0) {
        let best = null,
          bd = Infinity;
        for (const a of lp) for (const b of ln) {
          const dd = Math.hypot(a.x - b.x, a.y - b.y);
          if (dd < bd) {
            bd = dd;
            best = [a, b];
          }
        }
        const [a, b] = best;
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        for (const t of best) {
          t.state = 'ann';
          t.tx = mx;
          t.ty = my;
        }
        lp.splice(lp.indexOf(a), 1);
        ln.splice(ln.indexOf(b), 1);
        exP--;
        exN--;
      }
      while (exP < 0 && exN < 0) {
        const x = C.x + rand(-10, 10),
          y = C.y + rand(-10, 10);
        const a = { s: 1, x, y, state: 'live' },
          b = { s: -1, x, y, state: 'live' };
        st.toks.push(a, b);
        lp.push(a);
        ln.push(b);
        exP++;
        exN++;
      }
      assign(lp, d.pos);
      assign(ln, d.neg);
    }
    function rebuild() {
      st.toks = [];
      st.pendingIn = 0;
      const d = desired();
      for (const t of d.pos) st.toks.push({ s: 1, x: t.x, y: t.y, tx: t.x, ty: t.y, state: 'live' });
      for (const t of d.neg) st.toks.push({ s: -1, x: t.x, y: t.y, tx: t.x, ty: t.y, state: 'live' });
    }
    const targetQ = () => (st.near ? -st.sign * P : 0);
    function loseElectron() {
      const neg = live(-1);
      let t;
      if (neg.length) t = neg.reduce((a, b) => (Math.hypot(a.x - J.x, a.y - J.y) < Math.hypot(b.x - J.x, b.y - J.y) ? a : b));
      else {
        st.toks.push({ s: 1, x: J.x - 8, y: J.y, state: 'live' });
        t = { s: -1, x: J.x - 8, y: J.y };
        st.toks.push(t);
      }
      t.state = 'out';
      t.path = [{ x: J.x, y: J.y }, { x: CORNER.x, y: CORNER.y }, { x: EARTH.x, y: EARTH.y - 8 }];
      st.Q += 1;
      layout();
    }
    function gainElectron() {
      st.pendingIn++;
      st.toks.push({ s: -1, x: EARTH.x, y: EARTH.y - 8, state: 'in', path: [{ x: CORNER.x, y: CORNER.y }, { x: J.x - 4, y: J.y }] });
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Charging a sphere by induction',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        // earth flow
        if (st.earthed) {
          st.flowT -= dt;
          if (st.flowT <= 0) {
            const eff = st.Q - st.pendingIn;
            if (eff < targetQ()) {
              loseElectron();
              st.flowT = 0.18;
            } else if (eff > targetQ()) {
              gainElectron();
              st.flowT = 0.18;
            }
          }
        }
        // stand
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(C.x - 6, C.y + R - 4, 12, 300 - (C.y + R - 4));
        ctx.fillRect(C.x - 40, 300, 80, 9);
        D.text(ctx, 'insulating stand', C.x + 12, 280, { align: 'left', size: 11, color: colors.muted });
        // wire to earth
        const closed = st.earthed;
        D.wire(ctx, [[J.x, J.y], [470, J.y]], colors.wire, 2.5);
        D.switch(ctx, 470, J.y, 500, closed);
        D.wire(ctx, [[500, J.y], [CORNER.x, CORNER.y], [EARTH.x, EARTH.y]], colors.wire, 2.5);
        for (let k = 0; k < 3; k++) D.line(ctx, EARTH.x - 16 + k * 5, EARTH.y + k * 6, EARTH.x + 16 - k * 5, EARTH.y + k * 6, colors.wire, 2.5);
        D.text(ctx, 'Earth', EARTH.x, EARTH.y + 30, { size: 12, color: colors.muted });
        D.text(ctx, closed ? 'earth connected' : 'earth disconnected', 485, J.y - 26, { size: 11, color: closed ? colors.good : colors.muted, weight: 600 });
        // sphere
        const g = ctx.createRadialGradient(C.x - 22, C.y - 24, 6, C.x, C.y, R);
        g.addColorStop(0, '#e2e8f0');
        g.addColorStop(1, '#475569');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(C.x, C.y, R, 0, TAU);
        ctx.fill();
        // tokens
        for (let i = st.toks.length - 1; i >= 0; i--) {
          const t = st.toks[i];
          if (t.state === 'live') {
            if (t.tx != null) {
              t.x = approach(t.x, t.tx, 5, dt);
              t.y = approach(t.y, t.ty, 5, dt);
            }
          } else if (t.state === 'ann') {
            t.x = approach(t.x, t.tx, 6, dt);
            t.y = approach(t.y, t.ty, 6, dt);
            if (Math.hypot(t.x - t.tx, t.y - t.ty) < 2.5) {
              st.toks.splice(i, 1);
              continue;
            }
          } else if (t.state === 'out') {
            if (!follow(t, dt, 300)) {
              st.toks.splice(i, 1);
              continue;
            }
          } else if (t.state === 'in') {
            if (!follow(t, dt, 300)) {
              t.state = 'live';
              st.Q -= 1;
              st.pendingIn--;
              layout();
            }
          }
          chip(ctx, t.x, t.y, t.s, 7);
        }
        // rod
        st.rodU = approach(st.rodU, st.near ? 1 : 0, 4, dt);
        const tip = { x: C.x + dirV.x * (R + 20 + (1 - st.rodU) * 180), y: C.y + dirV.y * (R + 20 + (1 - st.rodU) * 180) };
        drawRod(ctx, tip.x + dirV.x * 210, tip.y + dirV.y * 210, tip.x, tip.y, { mat: st.sign < 0 ? 'polythene' : 'perspex', w: 18, n: 6, sign: st.sign, from: 0.35, to: 0.95 });
        D.text(ctx, st.sign < 0 ? 'negatively charged polythene rod' : 'positively charged Perspex rod', clamp(tip.x - 40, 120, 300), clamp(tip.y - 64, 14, H), { size: 11, color: colors.muted });
        D.text(ctx, 'Only excess (unbalanced) charge is drawn', 16, H - 14, { align: 'left', size: 11, color: colors.muted });
        rd.set('q', st.Q ? (st.Q > 0 ? '+' : '−') + Math.abs(st.Q) + ' units' : '0 (neutral)');
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Inducing rod',
      options: [
        { value: -1, label: 'Polythene (−)' },
        { value: 1, label: 'Perspex (+)' },
      ],
      value: -1,
      onChange: (v) => {
        st.sign = v;
        stepper.go(0);
        st.Q = 0;
        rebuild();
      },
    });
    const bRod = EM.button(c, 'Bring rod near', () => {
      st.near = !st.near;
      layout();
      paint();
    });
    const bEarth = EM.button(c, 'Connect earth', () => {
      st.earthed = !st.earthed;
      paint();
    });
    EM.button(c, 'Reset', () => stepper.go(0));
    const rd = EM.readout(el, [{ key: 'q', label: 'Net charge on the sphere' }]);
    const status = EM.status(el);
    function paint() {
      bRod.innerHTML = st.near ? 'Take rod away' : 'Bring rod near';
      bEarth.innerHTML = st.earthed ? 'Disconnect earth' : 'Connect earth';
    }
    EM.every(200, () => {
      const rodName = st.sign < 0 ? 'negative' : 'positive';
      const flowing = st.toks.some((t) => t.state === 'out' || t.state === 'in');
      let msg, type = '';
      if (flowing) msg = st.toks.some((t) => t.state === 'out') ? 'Electrons are repelled <strong>down the wire to earth</strong>.' : 'Electrons flow <strong>up from the earth</strong> onto the sphere.';
      else if (st.near && !st.earthed && st.Q === 0) msg = `<strong>Separation of charge</strong>: the ${rodName} rod ${st.sign < 0 ? 'repels electrons to the far side' : 'attracts electrons to the near side'} of the sphere. The sphere is polarised but still neutral overall.`;
      else if (st.near && st.earthed) msg = 'Earthed with the rod still near: the charge on the near side is held there by the rod.';
      else if (st.near && !st.earthed) msg = 'Earth disconnected — the extra charge is now trapped on the sphere. Now remove the rod.';
      else if (!st.near && st.Q !== 0) {
        msg = `The sphere has been charged <strong>${st.Q > 0 ? 'positively' : 'negatively'}</strong> by induction — the <strong>opposite</strong> sign to the ${rodName} rod. The charge spreads evenly over the surface.`;
        type = 'good';
      } else if (!st.near && st.earthed) msg = 'Earthed with no rod nearby: the sphere stays (or becomes) neutral. (If you take the rod away <em>before</em> removing the earth, the charge just flows back!)';
      else msg = 'A neutral metal sphere on an insulating stand. Follow the steps below, or use the buttons in any order.';
      status.set(msg, type);
    });
    const STEPS = [
      { near: false, earthed: false, Q: 0 },
      { near: true, earthed: false, Q: 0 },
      { near: true, earthed: true, Q: null },
      { near: true, earthed: false, Q: 'ind' },
      { near: false, earthed: false, Q: 'ind' },
    ];
    const stepper = EM.stepper(
      el,
      [
        { title: 'Charge the rod', html: 'Charge a polythene rod negatively by friction using a woollen cloth.' },
        { title: 'Bring the rod near', html: 'Bring the negatively charged rod close to the sphere <strong>without touching it</strong>. Separation of charge occurs: negative charge on the sphere moves away from the rod.' },
        { title: 'Earth the sphere', html: 'Connect the sphere to ground. The repelled electrons flow to earth.' },
        { title: 'Disconnect the earth', html: 'Now disconnect the sphere from ground (keep the rod where it is).' },
        { title: 'Remove the rod', html: 'Remove the polythene rod. The sphere has been <strong>charged positively by induction</strong>.' },
      ],
      (i) => {
        const sp = STEPS[i];
        st.near = sp.near;
        st.earthed = sp.earthed;
        const want = sp.Q === 'ind' ? -st.sign * P : sp.Q;
        if (want != null && st.Q - st.pendingIn !== want) {
          st.Q = want;
          rebuild();
        } else layout();
        paint();
      }
    );
  }

  /* ---------- DEMO 3: charge resides on the outside of a hollow conductor ---------- */
  function expHollow(el) {
    const W = 640,
      H = 380;
    const V = { x: 180, y: 206, r: 60 },
      BASE = 336;
    const CAN = { x0: 150, x1: 210, top: 96, bot: 146 };
    const ES = { x: 500, y: 150, s: 0.9 };
    const HOME = { x: 330, y: 76 };
    const st = { on: true, plane: { x: HOME.x, y: HOME.y, path: [] }, pq: 0, Qe: 0, angle: 0, drag: null, det: 'gle', touched: '', msg: '' };
    function zone(x, y) {
      // y is the centre of the disc (seen edge-on, 22 px tall)
      const inY = y > CAN.top + 4 && y < CAN.bot - 4;
      if (inY && (Math.abs(x - (CAN.x0 - 7)) < 6 || Math.abs(x - (CAN.x1 + 7)) < 6)) return 'outside';
      if (x > CAN.x0 + 7 && x < CAN.x1 - 7 && y > CAN.top + 8 && y < CAN.bot - 10) return 'inside';
      if (Math.abs(x - ES.x) < 34 * ES.s && Math.abs(y - (ES.y - 12)) < 9) return 'cap';
      return '';
    }
    function contact() {
      const z = zone(st.plane.x, st.plane.y);
      if (z === st.touched) return;
      st.touched = z;
      if (z === 'outside') {
        st.pq = st.on ? 3 : 0;
        st.msg = st.on ? 'Touched the <strong>outside</strong>: the proof plane picks up charge.' : 'The generator is off — there is no charge to pick up.';
      } else if (z === 'inside') {
        st.pq = 0;
        st.msg = 'Touched the <strong>inside</strong>: no charge is picked up (any charge on the plane would even move to the outside of the can!).';
      } else if (z === 'cap') {
        st.Qe += st.pq;
        st.msg = st.pq ? 'Charge transferred to the detector → reading / divergence.' : 'The proof plane had no charge → no change.';
        st.pq = 0;
      }
    }
    function auto(where) {
      st.drag = null;
      const pts = [];
      if (where === 'outside') pts.push({ x: CAN.x0 - 30, y: 70 }, { x: CAN.x0 - 7, y: 122, wait: 0.4 }, { x: CAN.x0 - 30, y: 66 });
      else pts.push({ x: (CAN.x0 + CAN.x1) / 2, y: 68 }, { x: (CAN.x0 + CAN.x1) / 2, y: 126, wait: 0.4 }, { x: (CAN.x0 + CAN.x1) / 2, y: 66 });
      pts.push({ x: ES.x, y: 66 }, { x: ES.x, y: ES.y - 12, wait: 0.5 }, { x: HOME.x, y: HOME.y });
      st.plane.path = pts;
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Proof plane, calorimeter and Van de Graaff generator',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        follow(st.plane, dt, 260);
        contact();
        drawVdG(ctx, V.x, V.y, V.r, BASE, { on: st.on, charged: st.on, n: 12, skip: (a) => a < -1.15 && a > -1.99, label: 'Van de Graaff' });
        // calorimeter (cut-away so you can see inside)
        ctx.save();
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(CAN.x0, CAN.top, CAN.x1 - CAN.x0, CAN.bot - CAN.top);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(CAN.x0, CAN.top);
        ctx.lineTo(CAN.x0, CAN.bot);
        ctx.lineTo(CAN.x1, CAN.bot);
        ctx.lineTo(CAN.x1, CAN.top);
        ctx.stroke();
        ctx.restore();
        if (st.on) {
          for (let i = 0; i < 3; i++) {
            chip(ctx, CAN.x0 - 9, CAN.top + 10 + i * 16, 1, 4.5);
            chip(ctx, CAN.x1 + 9, CAN.top + 10 + i * 16, 1, 4.5);
          }
          chip(ctx, CAN.x0 - 4, CAN.top - 8, 1, 4.5);
          chip(ctx, CAN.x1 + 4, CAN.top - 8, 1, 4.5);
        }
        D.text(ctx, 'metal calorimeter', CAN.x0 - 18, CAN.top - 28, { align: 'right', size: 11, color: colors.muted });
        D.line(ctx, CAN.x0 - 16, CAN.top - 24, CAN.x0 - 2, CAN.top - 4, 'rgba(148,163,184,0.6)', 1);
        // detector
        let reading = '';
        if (st.det === 'gle') {
          st.angle = approach(st.angle, 1.05 * (1 - Math.exp(-st.Qe / 4)), 5, dt);
          drawElectroscope(ctx, ES.x, ES.y, ES.s, { angle: st.angle, capQ: st.Qe * 0.4, leafQ: st.Qe * 0.6, label: 'gold leaf electroscope' });
        } else {
          ctx.save();
          ctx.fillStyle = '#cbd5e1';
          D.roundRect(ctx, ES.x - 30, ES.y - 4, 60, 8, 3);
          ctx.fill();
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(ES.x - 4, ES.y + 4, 8, 40);
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 2;
          D.roundRect(ctx, ES.x - 80, ES.y + 44, 160, 100, 10);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#052e16';
          ctx.fillRect(ES.x - 64, ES.y + 60, 128, 44);
          ctx.restore();
          reading = '+' + (st.Qe * 1.2).toFixed(1) + ' nC';
          D.text(ctx, reading, ES.x, ES.y + 82, { size: 22, weight: 700, color: '#4ade80', font: 'ui-monospace, monospace' });
          D.text(ctx, 'nano-coulombmeter', ES.x, ES.y + 128, { size: 11, color: colors.muted });
        }
        // proof plane (disc seen edge-on + insulating handle)
        const pl = st.plane;
        ctx.save();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pl.x, pl.y - 8);
        ctx.lineTo(pl.x, pl.y - 58);
        ctx.stroke();
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.ellipse(pl.x, pl.y, 11, 4, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        if (st.pq) for (let i = 0; i < st.pq; i++) chip(ctx, pl.x - 8 + i * 8, pl.y + 10, 1, 4);
        D.text(ctx, 'proof plane', pl.x + 16, pl.y - 40, { align: 'left', size: 11, color: colors.muted });
        rd.set('pq', st.pq ? '+' + (st.pq * 1.2).toFixed(1) + ' nC' : '0');
        rd.set('qe', st.det === 'gle' ? Math.round((st.angle * 180) / Math.PI) + '° divergence' : reading);
      },
      onDown(p) {
        const pl = st.plane;
        if (Math.abs(p.x - pl.x) < 18 && p.y > pl.y - 64 && p.y < pl.y + 12) {
          pl.path = [];
          st.drag = { dx: p.x - pl.x, dy: p.y - pl.y };
        }
      },
      onMove(p) {
        if (!st.drag) return;
        st.plane.x = clamp(p.x - st.drag.dx, 20, W - 20);
        st.plane.y = clamp(p.y - st.drag.dy, 64, H - 20);
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    EM.button(c, '▶ Test the OUTSIDE', () => auto('outside'), 'primary');
    EM.button(c, '▶ Test the INSIDE', () => auto('inside'), 'primary');
    EM.button(c, 'Discharge detector', () => {
      st.Qe = 0;
      st.msg = 'Detector discharged (earthed).';
    });
    EM.toggle(c, { label: 'Van de Graaff on', value: true, onChange: (v) => (st.on = v) });
    EM.segmented(c, {
      label: 'Detector',
      options: [
        { value: 'gle', label: 'Gold leaf electroscope' },
        { value: 'nc', label: 'Nano-coulombmeter' },
      ],
      value: 'gle',
      onChange: (v) => (st.det = v),
    });
    const rd = EM.readout(el, [
      { key: 'pq', label: 'Charge on proof plane' },
      { key: 'qe', label: 'Detector' },
    ]);
    const status = EM.status(el);
    EM.every(200, () => status.set(st.msg || 'Drag the proof plane (or use the buttons): touch it on the outside or the inside of the calorimeter, then touch it on the detector.', st.msg ? 'good' : ''));
  }

  /* ---------- DEMO 4: charge accumulates at points ---------- */
  function expPoints(el) {
    const W = 640,
      H = 380;
    const V = { x: 320, y: 120, r: 54 },
      BASE = 300;
    const R = 20;
    const ESL = { x: 110, y: 196 },
      ESR = { x: 530, y: 196 },
      SC = 0.72;
    const mk = (end) => {
      const left = end === 'round';
      return {
        end,
        x: left ? 140 : 500,
        y: 90,
        rot: Math.PI, // rounded end faces right (left pear); point faces left (right pear)
        path: [],
        wait: 0,
        charged: false,
        angle: 0,
        es: left ? ESL : ESR,
      };
    };
    const st = { which: 'round', pears: { round: mk('round'), point: mk('point') }, msg: '' };
    const facing = (p) => {
      // world position of the end being tested
      const off = p.end === 'round' ? -R : PEAR_K * R;
      return { x: p.x + Math.cos(p.rot) * off, y: p.y + Math.sin(p.rot) * off };
    };
    function touchVdG() {
      const p = st.pears[st.which];
      if (p.path.length) return;
      if (p.end === 'round') p.path = [{ x: V.x - V.r - R, y: V.y, rot: Math.PI, wait: 0.4, fn: () => ((p.charged = true), (st.msg = 'Rounded end touched the dome: the pear-shaped conductor is now charged.')) }, { x: 170, y: 90 }];
      else p.path = [{ x: V.x + V.r + PEAR_K * R, y: V.y, rot: Math.PI, wait: 0.4, fn: () => ((p.charged = true), (st.msg = 'Pointed end touched the dome: the pear-shaped conductor is now charged.')) }, { x: 470, y: 90 }];
    }
    function bring() {
      const p = st.pears[st.which];
      if (p.path.length) return;
      const capY = p.es.y;
      if (p.end === 'round') p.path = [{ x: p.es.x, y: capY - 16 - R - 34, rot: -Math.PI / 2 }, { x: p.es.x, y: capY - 16 - R, rot: -Math.PI / 2 }];
      else p.path = [{ x: p.es.x, y: capY - 16 - PEAR_K * R - 34, rot: Math.PI / 2 }, { x: p.es.x, y: capY - 16 - PEAR_K * R, rot: Math.PI / 2 }];
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Pear-shaped conductor and electroscopes',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        drawVdG(ctx, V.x, V.y, V.r, BASE, { charged: true, n: 12, label: 'Van de Graaff' });
        for (const key of ['round', 'point']) {
          const p = st.pears[key];
          follow(p, dt, 240);
          const f = facing(p);
          const dist = Math.hypot(f.x - p.es.x, f.y - p.es.y);
          const near = clamp(1 - (dist - 16) / 140, 0, 1);
          const maxA = key === 'round' ? 0.22 : 0.95;
          p.angle = approach(p.angle, p.charged ? maxA * near : 0, 4, dt);
          const q = p.charged ? near * (key === 'round' ? 1.5 : 6) : 0;
          const deg = Math.round((p.angle * 180) / Math.PI) + '°';
          drawElectroscope(ctx, p.es.x, p.es.y, SC, { angle: p.angle, capQ: -q * 0.6, leafQ: q, label: (key === 'round' ? 'rounded end: ' : 'pointed end: ') + deg });
        }
        for (const key of ['round', 'point']) {
          const p = st.pears[key];
          drawPear(ctx, p.x, p.y, R, p.rot, p.charged);
          ctx.save();
          if (st.which === key) {
            ctx.strokeStyle = 'rgba(251,191,36,0.6)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(p.x + (key === 'point' ? Math.cos(p.rot) * R : 0), p.y + (key === 'point' ? Math.sin(p.rot) * R : 0), R * 2.1, 0, TAU);
            ctx.stroke();
          }
          ctx.restore();
        }
        D.text(ctx, 'pear-shaped conductors on insulating handles', W / 2, 14, { size: 11, color: colors.muted });
        rd.set('l', Math.round((st.pears.round.angle * 180) / Math.PI) + '°');
        rd.set('r', Math.round((st.pears.point.angle * 180) / Math.PI) + '°');
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'End to test',
      options: [
        { value: 'round', label: 'Rounded end (left)' },
        { value: 'point', label: 'Pointed end (right)' },
      ],
      value: 'round',
      onChange: (v) => (st.which = v),
    });
    EM.button(c, '1. Touch the Van de Graaff', touchVdG, 'primary');
    EM.button(c, '2. Bring to the electroscope', bring, 'primary');
    EM.button(c, 'Reset', () => {
      st.pears = { round: mk('round'), point: mk('point') };
      st.msg = '';
    });
    const rd = EM.readout(el, [
      { key: 'l', label: 'Rounded-end electroscope' },
      { key: 'r', label: 'Pointed-end electroscope' },
    ]);
    const status = EM.status(el);
    EM.every(200, () => {
      const a = st.pears.round,
        b = st.pears.point;
      if (a.angle > 0.1 && b.angle > 0.5) return status.set('Compare: the pointed end makes the leaf diverge <strong>far more</strong> than the rounded end → charge accumulates more at a point than on a rounded side.', 'good');
      if (b.angle > 0.5) return status.set('The pointed end makes the leaf diverge <strong>a lot</strong>. Now try the rounded end.', 'good');
      if (a.angle > 0.1) return status.set('The rounded end makes the leaf diverge only <strong>slightly</strong>. Now try the pointed end.', 'good');
      status.set(st.msg || 'Choose an end, then do step 1 and step 2. Notice where the + charges sit on the pear.');
    });
  }

  /* ---------- DEMO 5: point discharge and electric wind ---------- */
  function expDischarge(el) {
    const W = 640,
      H = 360;
    const V = { x: 140, y: 175, r: 58 },
      BASE = 300;
    const TIP = { x: 330, y: 96 };
    const st = { mode: 'candle', on: false, cx: 470, lit: true, blow: 0, ions: [], spin: 0, om: 0, drag: false, smoke: [] };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Point discharge: electric wind',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        drawVdG(ctx, V.x, V.y, V.r, BASE, { on: st.on, charged: st.on, n: 10, label: st.on ? 'ON' : 'OFF' });
        const candle = st.mode === 'candle';
        let emit = [];
        if (candle) {
          // needle conductor
          ctx.save();
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(V.x, V.y - V.r + 2);
          ctx.lineTo(V.x, TIP.y);
          ctx.lineTo(TIP.x - 60, TIP.y);
          ctx.stroke();
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.moveTo(TIP.x - 62, TIP.y - 3);
          ctx.lineTo(TIP.x, TIP.y);
          ctx.lineTo(TIP.x - 62, TIP.y + 3);
          ctx.fill();
          ctx.restore();
          D.text(ctx, 'pointed needle', TIP.x - 60, TIP.y - 16, { size: 11, color: colors.muted });
          if (st.on) for (let i = 0; i < 4; i++) chip(ctx, TIP.x - 4 - i * 9, TIP.y + (i % 2 ? 8 : -8), 1, 4);
          if (st.on) emit.push({ x: TIP.x + 4, y: TIP.y, a: 0, spread: 0.5 });
        } else {
          st.om = approach(st.om, st.on ? 5 : 0, st.on ? 0.8 : 0.5, dt);
          st.spin += st.om * dt;
          const PC = { x: V.x, y: 64 };
          D.line(ctx, V.x, V.y - V.r, PC.x, PC.y, '#cbd5e1', 3);
          for (let k = 0; k < 4; k++) {
            const a = st.spin + (k * Math.PI) / 2;
            const ex = PC.x + Math.cos(a) * 50,
              ey = PC.y + Math.sin(a) * 50 * 0.45;
            const ta = a - Math.PI / 2;
            const tx = ex + Math.cos(ta) * 16,
              ty = ey + Math.sin(ta) * 16 * 0.45;
            ctx.save();
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(PC.x, PC.y);
            ctx.lineTo(ex, ey);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.restore();
            if (st.on) {
              chip(ctx, tx, ty, 1, 3.5);
              if (Math.random() < 0.5) emit.push({ x: tx, y: ty, a: Math.atan2(ty - ey, tx - ex), spread: 0.3 });
            }
          }
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.arc(PC.x, PC.y, 4, 0, TAU);
          ctx.fill();
          D.text(ctx, 'pinwheel (spins in a horizontal plane)', PC.x + 70, 24, { align: 'left', size: 11, color: colors.muted });
        }
        // ions from the points
        for (const e of emit) {
          if (Math.random() < (candle ? 0.9 : 0.6)) {
            const a = e.a + rand(-e.spread, e.spread),
              sp = rand(130, 210);
            st.ions.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0 });
          }
        }
        for (let i = st.ions.length - 1; i >= 0; i--) {
          const p = st.ions[i];
          p.life += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 1 - 0.6 * dt;
          p.vy *= 1 - 0.6 * dt;
          if (p.life > 1.6 || p.x > W + 10 || p.y < -10 || p.y > H) {
            st.ions.splice(i, 1);
            continue;
          }
          ion(ctx, p.x, p.y, 1, clamp(1.3 - p.life, 0.15, 1), 4);
        }
        // candle
        if (candle) {
          const cx = st.cx;
          const dist = cx - TIP.x;
          const wind = st.on ? clamp(1.3 - dist / 190, 0, 1) : 0;
          if (st.lit) {
            st.blow = wind > 0.55 ? st.blow + dt : Math.max(0, st.blow - dt);
            if (st.blow > 1.4) {
              st.lit = false;
              for (let k = 0; k < 14; k++) st.smoke.push({ x: cx, y: TIP.y + 4, vx: rand(10, 40), vy: rand(-40, -15), life: 0 });
            }
          }
          ctx.fillStyle = '#7c2d12';
          ctx.fillRect(cx - 34, 250, 68, 50);
          D.text(ctx, 'block', cx, 275, { size: 10, color: '#fed7aa' });
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(cx - 12, TIP.y + 16, 24, 250 - (TIP.y + 16));
          D.line(ctx, cx, TIP.y + 16, cx, TIP.y + 8, '#1e293b', 2);
          if (st.lit) drawFlame(ctx, cx, TIP.y + 9, wind * 1.2 + (wind ? rand(-0.15, 0.15) : 0), s.t, 1);
          for (let i = st.smoke.length - 1; i >= 0; i--) {
            const m = st.smoke[i];
            m.life += dt;
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            if (m.life > 2) {
              st.smoke.splice(i, 1);
              continue;
            }
            ctx.fillStyle = `rgba(148,163,184,${0.4 * (1 - m.life / 2)})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, 4 + m.life * 6, 0, TAU);
            ctx.fill();
          }
          D.text(ctx, st.lit ? 'lit candle — drag it' : 'blown out!', cx, 318, { size: 12, color: st.lit ? colors.muted : colors.warn, weight: st.lit ? 500 : 700 });
          rd.set('w', st.on ? Math.round(wind * 100) + '%' : '0%');
          rd.set('x', st.lit ? (wind > 0.55 ? 'flickering…' : wind > 0 ? 'leaning away' : 'steady') : 'blown out');
        } else {
          rd.set('w', st.on ? 'strong at the tips' : '0%');
          rd.set('x', (st.om / TAU).toFixed(2) + ' rev/s');
        }
      },
      onDown(p) {
        if (st.mode === 'candle' && Math.abs(p.x - st.cx) < 36 && p.y > TIP.y - 30 && p.y < 305) st.drag = { dx: p.x - st.cx };
      },
      onMove(p) {
        if (st.drag) st.cx = clamp(p.x - st.drag.dx, TIP.x + 40, W - 40);
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Version of the demo',
      options: [
        { value: 'candle', label: 'Needle + candle' },
        { value: 'pinwheel', label: 'Pinwheel' },
      ],
      value: 'candle',
      onChange: (v) => {
        st.mode = v;
        st.ions = [];
        rdLabel();
      },
    });
    EM.toggle(c, { label: 'Generator on', value: false, onChange: (v) => (st.on = v) });
    EM.button(c, 'Relight candle', () => {
      st.lit = true;
      st.blow = 0;
    });
    const rd = EM.readout(el, [
      { key: 'w', label: 'Electric wind at candle' },
      { key: 'x', label: 'Flame' },
    ]);
    function rdLabel() {
      const labs = rd.el.querySelectorAll('.readout-label');
      labs[0].innerHTML = st.mode === 'candle' ? 'Electric wind at candle' : 'Electric wind';
      labs[1].innerHTML = st.mode === 'candle' ? 'Flame' : 'Pinwheel speed';
    }
    const status = EM.status(el);
    EM.every(200, () => {
      if (!st.on) return status.set('Turn the generator on.');
      if (st.mode === 'candle') return status.set(st.lit ? 'Charge piles up at the sharp tip; ions stream away from it as an <strong>electric wind</strong>. Drag the candle closer to the point…' : 'The electric wind has <strong>blown the candle out</strong> — point discharge in action.', st.lit ? '' : 'good');
      status.set('Like charges on the tips and in the air <strong>repel</strong>: ions are pushed off the points and the points are pushed back, so the pinwheel <strong>spins</strong>.', 'good');
    });
  }

  /* ---------- DEMO 6: field pattern between parallel plates (semolina in oil) ---------- */
  function expPlates(el) {
    const W = 640,
      H = 380;
    const D0 = { x: 320, y: 220, r: 145 };
    const PL = { xp: 258, xn: 382, y0: 150, y1: 290 };
    const st = { on: false, lines: false, grains: [], fl: [] };
    const charges = [];
    for (let i = 0; i <= 14; i++) {
      const y = PL.y0 + ((PL.y1 - PL.y0) * i) / 14;
      charges.push({ x: PL.xp, y, q: 1 }, { x: PL.xn, y, q: -1 });
    }
    const E0 = Math.hypot(...EM.physics.E(charges, 320, 220, 4));
    while (st.grains.length < 460) {
      const a = rand(0, TAU),
        r = Math.sqrt(Math.random()) * (D0.r - 10);
      const x = D0.x + Math.cos(a) * r,
        y = D0.y + Math.sin(a) * r;
      if (y > PL.y0 - 8 && y < PL.y1 + 8 && (Math.abs(x - PL.xp) < 7 || Math.abs(x - PL.xn) < 7)) continue;
      const [ex, ey] = EM.physics.E(charges, x, y, 4);
      const m = Math.hypot(ex, ey);
      st.grains.push({ x, y, a: rand(0, Math.PI), a0: 0, fa: Math.atan2(ey, ex), s: m / E0, off: rand(-0.9, 0.9) });
    }
    st.grains.forEach((g) => (g.a0 = g.a));
    // field lines from the inner face of the + plate
    for (let i = 0; i <= 12; i++) {
      let x = PL.xp + 3,
        y = PL.y0 + ((PL.y1 - PL.y0) * i) / 12;
      const pts = [[x, y]];
      for (let k = 0; k < 400; k++) {
        const [ex, ey] = EM.physics.E(charges, x, y, 4);
        const m = Math.hypot(ex, ey) || 1;
        x += (ex / m) * 3;
        y += (ey / m) * 3;
        pts.push([x, y]);
        if (Math.abs(x - PL.xn) < 3 && y > PL.y0 - 6 && y < PL.y1 + 6) break;
        if (Math.hypot(x - D0.x, y - D0.y) > D0.r) break;
      }
      st.fl.push({ points: pts, dir: 1 });
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Semolina grains between parallel plates',
      draw(ctx, s, dt) {
        D.grid(ctx, W, H);
        // EHT unit + wires
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        D.roundRect(ctx, 250, 12, 140, 40, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        D.text(ctx, 'EHT unit', 320, 25, { size: 12, weight: 700 });
        D.text(ctx, st.on ? '6,000 V  ON' : '6,000 V  off', 320, 41, { size: 11, color: st.on ? colors.good : colors.muted, weight: 700 });
        D.wire(ctx, [[250, 32], [PL.xp - 70, 32], [PL.xp - 70, PL.y0 - 30], [PL.xp, PL.y0 - 30], [PL.xp, PL.y0]], colors.pos, 2.5);
        D.wire(ctx, [[390, 32], [PL.xn + 70, 32], [PL.xn + 70, PL.y0 - 30], [PL.xn, PL.y0 - 30], [PL.xn, PL.y0]], colors.neg, 2.5);
        // dish with oil
        ctx.save();
        ctx.fillStyle = 'rgba(250,204,21,0.10)';
        ctx.strokeStyle = 'rgba(226,232,240,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(D0.x, D0.y, D0.r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // grains
        ctx.save();
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (const g of st.grains) {
          let target;
          if (st.on) {
            const align = Math.min(1, g.s * 1.6);
            target = g.fa + g.off * (1 - align);
            let d = target - g.a;
            d -= Math.PI * Math.round(d / Math.PI);
            g.a += d * (1 - Math.exp(-dt * 5 * Math.max(0.15, align)));
          } else g.a += rand(-0.3, 0.3) * dt;
          const c = Math.cos(g.a) * 3.6,
            sn = Math.sin(g.a) * 3.6;
          ctx.beginPath();
          ctx.moveTo(g.x - c, g.y - sn);
          ctx.lineTo(g.x + c, g.y + sn);
          ctx.stroke();
        }
        ctx.restore();
        if (st.lines && st.on) D.fieldLines(ctx, st.fl, { arrowEvery: 60, alpha: 0.8 });
        // plates
        ctx.fillStyle = colors.pos;
        ctx.fillRect(PL.xp - 4, PL.y0, 8, PL.y1 - PL.y0);
        ctx.fillStyle = colors.neg;
        ctx.fillRect(PL.xn - 4, PL.y0, 8, PL.y1 - PL.y0);
        const bg = 'rgba(11,18,32,0.85)';
        D.text(ctx, '+', PL.xp - 22, 220, { size: 22, weight: 800, color: colors.pos, bg });
        D.text(ctx, '−', PL.xn + 22, 220, { size: 22, weight: 800, color: colors.neg, bg });
        D.text(ctx, 'petri dish of oil', 95, 340, { size: 12, color: colors.muted });
        D.text(ctx, 'semolina grains', 548, 340, { size: 12, color: colors.muted });
        D.text(ctx, 'metal plates', 320, 306, { size: 12, color: colors.text, bg });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'EHT unit on (6,000 V)', value: false, onChange: (v) => (st.on = v) });
    EM.toggle(c, { label: 'Show field lines', value: false, onChange: (v) => (st.lines = v) });
    EM.button(c, 'Stir the grains', () => st.grains.forEach((g) => (g.a = rand(0, Math.PI))));
    const status = EM.status(el);
    EM.every(200, () =>
      status.set(
        st.on ? 'The grains line up along the field: <strong>straight, parallel and evenly spaced</strong> between the plates (a uniform field), <strong>bending outwards at the edges</strong>.' : 'The semolina grains lie in random directions. Switch on the EHT unit.',
        st.on ? 'good' : ''
      )
    );
  }

  /* ================================================================== chapter data */

  // rounded so the calculator inputs stay readable
  const F_DEFAULT = Number(((K * 2e-6 * 5e-6) / 0.09).toPrecision(4)); // 0.9986 N
  const E_DEFAULT = Number(((K * 2e-6) / 0.09).toPrecision(4)); // 1.997 × 10^5 N/C
  const fr = EM.frac;

  EM.chapter({
    id: 'c1',
    code: 'C.1',
    title: 'Electric Charge & Electric Fields',
    color: '#d97706',
    blurb: 'Static electricity, charging by friction and induction, the gold leaf electroscope, where charge sits on conductors, point discharge, field lines and Coulomb’s law.',

    terms: [
      { id: 'static-electricity', term: 'Static electricity', def: 'The build-up of electric charge on an object due to friction.' },
      { id: 'conservation', term: 'Law of conservation of charge', def: 'Charge can’t be created nor destroyed; it can only be transferred from one object to another.' },
      { id: 'law-of-charges', term: 'Forces between charges', def: 'Like charges repel each other and unlike charges attract each other.' },
      { id: 'electric-charge', term: 'Electric charge', def: 'The physical property of matter that causes it to experience a force when placed in an electric field.' },
      { id: 'electric-field', term: 'Electric field', def: 'A region where electric charges at rest experience a force.' },
      { id: 'coulomb-unit', term: 'Coulomb (C)', def: 'The unit of electric charge (named after Charles Coulomb). 1 C is the charge of 6.25 × 10<sup>18</sup> electrons. Charge can be measured using a coulomb meter.' },
      { id: 'insulator', term: 'Insulator', def: 'A material (e.g. rubber, plastic) that doesn’t allow electric charge to flow through it.' },
      { id: 'conductor', term: 'Conductor', def: 'A material (e.g. metals) that allows electric charge to flow through it. Its outer electrons are very loosely bound, so an energy boost easily moves them from atom to atom.' },
      { id: 'static-vs-current', term: 'Static vs current electricity', def: 'Static electricity builds up on insulators, whereas current electricity flows through conductors.' },
      { id: 'electroscope', term: 'Gold leaf electroscope', def: 'An instrument used to detect charge, identify whether a charge is positive or negative, indicate the size of a charge and distinguish between a conductor and an insulator.' },
      { id: 'proof-plane', term: 'Proof plane', def: 'A flat metal disc connected to an insulating handle. It is touched off a conductor to pick up a sample of its charge and carry it to a gold leaf electroscope or a digital nano-coulombmeter.' },
      { id: 'grounding', term: 'Grounding (earthing)', def: 'The process of connecting an electrical system or object to a common reference point (usually the Earth) to ensure safety.' },
      { id: 'polarisation', term: 'Polarisation', def: 'The redistribution of charge in a conductor caused by a nearby charged object, which repels or attracts the electrons within the conductor.' },
      { id: 'induction', term: 'Charging by induction', def: 'A method of electrostatically charging a neutral conductor by bringing a charged object near it without direct contact. The charged object polarises the conductor and, with grounding, the conductor acquires a net charge opposite in polarity to the inducing object.' },
      { id: 'outside-only', term: 'Charge on a hollow conductor', def: 'Charge is only found on the outside of a charged conductor.' },
      { id: 'faraday-cage', term: 'Faraday cage', def: 'A hollow conducting enclosure (metal box, net or mesh). Because charge sits only on its outside, the space inside is shielded from external electric fields.' },
      { id: 'curvature', term: 'Charge density and curvature', def: 'The greater the curvature of a conductor, the greater the charge density. Charge accumulates more at a point on a conductor than on a rounded side.' },
      { id: 'point-discharge', term: 'Point discharge (point effect)', def: 'The leaking of charge into the air from a sharp point on a charged conductor: the large charge at the point creates a strong electric field that ionises the air around it.' },
      { id: 'electric-wind', term: 'Electric wind', def: 'The stream of ions repelled from a sharp point on a charged conductor; they produce further ions by colliding with air atoms. It can blow out a candle flame.' },
      { id: 'field-line', term: 'Electric field line', def: 'A line that maps out the direction and strength of an electric field: it points the way a small positive charge would be pushed (away from +, towards −), and the closer the lines, the stronger the field.' },
      { id: 'coulombs-law', term: 'Coulomb’s law', def: 'The electrical force between two point charges is proportional to the product of the charges and inversely proportional to the square of the distance between them.' },
      { id: 'inverse-square', term: 'Inverse square law', def: 'F ∝ 1/d²: as the distance between two charges doubles, the force between them decreases by a factor of four.' },
      { id: 'permittivity', term: 'Permittivity (ε)', def: 'A property of the medium between the charges that appears in Coulomb’s law. ε<sub>0</sub> is the permittivity of a vacuum/free space or air: ε<sub>0</sub> = 8.854 × 10<sup>−12</sup> F m<sup>−1</sup>.' },
      { id: 'field-strength', term: 'Electric field strength (E)', def: 'The force per unit charge acting on a small positive test charge placed at a given point. Unit: newtons per coulomb (N C<sup>−1</sup>) or volts per metre (V m<sup>−1</sup>).' },
    ],

    formulas: [
      {
        id: 'charge-electrons',
        name: 'Charge carried by n electrons',
        display: '<var>Q</var> = <var>n</var><var>e</var>',
        vars: [
          { sym: 'Q', label: 'Q', name: 'Total charge', unit: 'C', value: 1 },
          { sym: 'n', label: 'n', name: 'Number of electrons', unit: '', value: 6.25e18 },
          { sym: 'e', label: 'e', name: 'Charge of one electron (size)', unit: 'C', value: 1.6e-19, constant: true },
        ],
        solve: { Q: (v) => v.n * v.e, n: (v) => v.Q / v.e },
        notes: 'The SI unit of charge is the coulomb. One electron carries only 1.6 × 10<sup>−19</sup> C, so a single coulomb is a huge number of electrons.',
        example: { q: 'How many electrons are there in one coulomb (1 C) of charge?', a: 'n = Q ÷ e = 1 ÷ (1.6 × 10<sup>−19</sup>) = <strong>6.25 × 10<sup>18</sup> electrons</strong>' },
      },
      {
        id: 'coulomb',
        name: 'Coulomb’s law',
        display: `<var>F</var> = ${fr('1', '4π<var>ε</var>')} × ${fr('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>')}`,
        vars: [
          { sym: 'F', label: 'F', name: 'Force between the two charges', unit: 'N', value: F_DEFAULT },
          { sym: 'q1', label: 'q<sub>1</sub>', name: 'Magnitude of the first charge', unit: 'C', value: 2e-6 },
          { sym: 'q2', label: 'q<sub>2</sub>', name: 'Magnitude of the second charge', unit: 'C', value: 5e-6 },
          { sym: 'd', label: 'd', name: 'Distance between the charges', unit: 'm', value: 0.3 },
          { sym: 'eps', label: 'ε', name: 'Permittivity of the medium (ε₀ for vacuum/air)', unit: 'F m<sup>−1</sup>', value: 8.854e-12, constant: true },
        ],
        solve: {
          F: (v) => (v.q1 * v.q2) / (4 * Math.PI * v.eps * v.d * v.d),
          q1: (v) => (v.F * 4 * Math.PI * v.eps * v.d * v.d) / v.q2,
          q2: (v) => (v.F * 4 * Math.PI * v.eps * v.d * v.d) / v.q1,
          d: (v) => Math.sqrt((v.q1 * v.q2) / (4 * Math.PI * v.eps * v.F)),
          eps: (v) => (v.q1 * v.q2) / (4 * Math.PI * v.F * v.d * v.d),
        },
        notes: `${fr('1', '4π<var>ε</var>')} is the constant of proportionality. N.B. The question will tell you the charges are in a vacuum/free space or in air, so just use ${fr('1', '4π<var>ε</var><sub>0</sub>')} with ε<sub>0</sub> = 8.854 × 10<sup>−12</sup> F m<sup>−1</sup>. (Use the sizes of the charges; the signs only tell you attract or repel.)`,
        derivation: [
          'Coulomb found the force is proportional to the product of the charges: <var>F</var> ∝ <var>q</var><sub>1</sub><var>q</var><sub>2</sub>',
          `…and inversely proportional to the square of the distance: <var>F</var> ∝ ${fr('1', '<var>d</var><sup>2</sup>')}`,
          `Together: <var>F</var> ∝ ${fr('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>')}`,
          `Insert the constant of proportionality ${fr('1', '4π<var>ε</var>')}: <var>F</var> = ${fr('1', '4π<var>ε</var>')} × ${fr('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>')}`,
        ],
        example: {
          q: 'Two point charges of +2 μC and +5 μC are 30 cm apart in air. Find the force between them.',
          a: `F = ${fr('1', '4π(8.854 × 10<sup>−12</sup>)')} × ${fr('(2 × 10<sup>−6</sup>)(5 × 10<sup>−6</sup>)', '(0.3)<sup>2</sup>')} = <strong>0.999 N ≈ 1.0 N</strong> (repulsion — both are positive). Remember to convert μC → C (× 10<sup>−6</sup>) and cm → m.`,
        },
      },
      {
        id: 'inverse-square',
        name: 'Inverse square law: F ∝ 1/d²',
        display: `<var>F</var><sub>2</sub> = <var>F</var><sub>1</sub> × <span class="math">(${fr('<var>d</var><sub>1</sub>', '<var>d</var><sub>2</sub>')})<sup>2</sup></span>`,
        vars: [
          { sym: 'F1', label: 'F<sub>1</sub>', name: 'Force at the first distance', unit: 'N', value: 8 },
          { sym: 'd1', label: 'd<sub>1</sub>', name: 'First distance', unit: 'm', value: 0.1 },
          { sym: 'F2', label: 'F<sub>2</sub>', name: 'Force at the new distance', unit: 'N', value: 2 },
          { sym: 'd2', label: 'd<sub>2</sub>', name: 'New distance', unit: 'm', value: 0.2 },
        ],
        solve: {
          F2: (v) => v.F1 * Math.pow(v.d1 / v.d2, 2),
          F1: (v) => v.F2 * Math.pow(v.d2 / v.d1, 2),
          d2: (v) => v.d1 * Math.sqrt(v.F1 / v.F2),
          d1: (v) => v.d2 * Math.sqrt(v.F2 / v.F1),
        },
        notes: 'Because F ∝ 1/d², the product F × d² stays the same when only the distance changes. Double the distance → ¼ of the force; triple it → 1/9; halve it → 4 × the force.',
        derivation: ['From Coulomb’s law with the same charges: <var>F</var> × <var>d</var><sup>2</sup> = constant', '<var>F</var><sub>1</sub><var>d</var><sub>1</sub><sup>2</sup> = <var>F</var><sub>2</sub><var>d</var><sub>2</sub><sup>2</sup>', `so <var>F</var><sub>2</sub> = <var>F</var><sub>1</sub> × (${fr('<var>d</var><sub>1</sub>', '<var>d</var><sub>2</sub>')})<sup>2</sup>`],
        example: { q: 'Two charges 10 cm apart repel each other with a force of 8 N. What is the force when they are moved 20 cm apart?', a: 'The distance doubles, so the force decreases by a factor of four: F = 8 × (0.1/0.2)<sup>2</sup> = <strong>2 N</strong>' },
      },
      {
        id: 'field-strength',
        name: 'Electric field strength',
        display: `<var>E</var> = ${fr('<var>F</var>', '<var>q</var>')}`,
        vars: [
          { sym: 'E', label: 'E', name: 'Electric field strength', unit: 'N C<sup>−1</sup>', value: E_DEFAULT },
          { sym: 'F', label: 'F', name: 'Force on the test charge', unit: 'N', value: F_DEFAULT },
          { sym: 'q', label: 'q', name: 'Size of the (small, positive) test charge', unit: 'C', value: 5e-6 },
        ],
        solve: { E: (v) => v.F / v.q, F: (v) => v.E * v.q, q: (v) => v.F / v.E },
        notes: 'Units: N C<sup>−1</sup> or, equivalently, V m<sup>−1</sup>. E is a vector: its direction is the direction of the force on a positive charge.',
        example: { q: 'A +5 μC test charge placed 30 cm from a +2 μC charge feels a force of 0.999 N. Find the electric field strength at that point.', a: 'E = F/q = 0.999 ÷ (5 × 10<sup>−6</sup>) = <strong>2.0 × 10<sup>5</sup> N C<sup>−1</sup></strong>' },
      },
      {
        id: 'field-point',
        name: 'Field strength near a point charge',
        display: `<var>E</var> = ${fr('1', '4π<var>ε</var>')} × ${fr('<var>q</var><sub>1</sub>', '<var>d</var><sup>2</sup>')} = ${fr('<var>q</var><sub>1</sub>', '4π<var>ε</var><var>d</var><sup>2</sup>')}`,
        vars: [
          { sym: 'E', label: 'E', name: 'Electric field strength at the point', unit: 'N C<sup>−1</sup>', value: E_DEFAULT },
          { sym: 'q1', label: 'q<sub>1</sub>', name: 'Charge creating the field', unit: 'C', value: 2e-6 },
          { sym: 'd', label: 'd', name: 'Distance from that charge', unit: 'm', value: 0.3 },
          { sym: 'eps', label: 'ε', name: 'Permittivity (ε₀ for vacuum/air)', unit: 'F m<sup>−1</sup>', value: 8.854e-12, constant: true },
        ],
        solve: {
          E: (v) => v.q1 / (4 * Math.PI * v.eps * v.d * v.d),
          q1: (v) => v.E * 4 * Math.PI * v.eps * v.d * v.d,
          d: (v) => Math.sqrt(v.q1 / (4 * Math.PI * v.eps * v.E)),
          eps: (v) => v.q1 / (4 * Math.PI * v.E * v.d * v.d),
        },
        notes: 'Only the charge <em>creating</em> the field (q<sub>1</sub>) matters — not the charge sitting at the point.',
        derivation: [
          `Start with <var>E</var> = ${fr('<var>F</var>', '<var>q</var>')} and <var>F</var> = ${fr('1', '4π<var>ε</var>')} × ${fr('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>')}`,
          `Putting them together (the test charge is <var>q</var> = <var>q</var><sub>2</sub>): <var>E</var> = ${fr(fr('1', '4π<var>ε</var>') + ' × ' + fr('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>'), '<var>q</var><sub>2</sub>')}`,
          'q<sub>1</sub> is the charge creating the field line, so the small test charge cancels top and bottom',
          `<var>E</var> = ${fr('1', '4π<var>ε</var>')} × ${fr('<var>q</var><sub>1</sub>', '<var>d</var><sup>2</sup>')} &nbsp;or&nbsp; <var>E</var> = ${fr('<var>q</var><sub>1</sub>', '4π<var>ε</var><var>d</var><sup>2</sup>')}`,
        ],
        example: { q: 'Find the electric field strength 30 cm from a +2 μC point charge in air.', a: `E = ${fr('2 × 10<sup>−6</sup>', '4π(8.854 × 10<sup>−12</sup>)(0.3)<sup>2</sup>')} = <strong>2.0 × 10<sup>5</sup> N C<sup>−1</sup></strong> — the same answer as using F/q with a test charge, as it must be.` },
      },
    ],

    experiments: [
      {
        id: 'forces',
        title: 'To show forces between electric charges',
        aim: 'To show that like charges repel and unlike charges attract.',
        apparatus: ['2 polythene rods', 'Woollen cloth', 'Paper stirrup', 'Clamp and thread', 'Perspex rod (to show attraction)'],
        steps: ['Rub two polythene rods with a wool cloth. This gives them both a negative charge because of friction.', 'Place one polythene rod in a paper stirrup hanging from a clamp.', 'Bring the second polythene rod near the rod that’s hanging in the stirrup.', 'Repeat with a charged Perspex rod (positive) brought near the hanging polythene rod.'],
        result: 'The two polythene rods repel each other (the hanging rod swings away). A Perspex rod attracts the hanging polythene rod.',
        conclusion: 'N.B. Like charges repel each other and unlike charges attract each other.',
        sim: expForces,
      },
      {
        id: 'induction-sphere',
        title: 'To charge a sphere by induction',
        aim: 'To give a neutral metal sphere a charge without touching it with the charged rod.',
        apparatus: ['Polythene rod', 'Woollen cloth', 'Metal sphere on an insulating stand', 'Earth connection (wire, or your finger)'],
        steps: ['Charge a polythene rod negatively by friction using a woollen cloth.', 'Bring the negatively charged rod close to the sphere without touching it.', 'Separation of charge will occur: negative charge on the sphere moves away from the negatively charged rod.', 'Connect the sphere to ground. Now disconnect the sphere from ground and remove the polythene rod.'],
        result: 'The sphere has been charged positively by induction.',
        conclusion: 'Charging by induction gives a conductor a charge opposite in sign to the inducing charge. The earth must be removed <em>before</em> the rod.',
        sim: expInduction,
      },
      {
        id: 'hollow-conductor',
        title: 'To show that charge resides on the outside of a hollow conductor',
        aim: 'To show that charge is only found on the outside of a charged hollow conductor.',
        apparatus: ['Van de Graaff generator', 'Metal calorimeter (hollow can)', 'Proof plane', 'Gold leaf electroscope (or nano-coulombmeter)'],
        steps: ['Place a metal calorimeter on top of a Van de Graaff generator and turn on the generator.', 'Place a proof plane along the outside of the calorimeter and bring it over to an uncharged gold leaf electroscope.', 'Now place the proof plane inside the metal calorimeter and bring it over to an uncharged gold leaf electroscope.'],
        result: 'Outside: the leaf of the electroscope diverges. Inside: the leaf does not move — it won’t diverge.',
        conclusion: 'N.B. Charge is only found on the outside of a charged conductor.',
        sim: expHollow,
      },
      {
        id: 'points',
        title: 'To show that charge accumulates at points on a conductor',
        aim: 'To compare the charge density at the rounded end and the pointed end of a pear-shaped conductor.',
        apparatus: ['Van de Graaff generator', '2 pear-shaped conductors on insulating handles', '2 gold leaf electroscopes'],
        steps: ['Bring the rounded end of a pear-shaped conductor up to touch the Van de Graaff generator.', 'Now bring the rounded end towards a gold leaf electroscope.', 'Bring the pointed end of a pear-shaped conductor up to touch the Van de Graaff generator.', 'Now bring the pointed end towards another gold leaf electroscope.'],
        result: 'Rounded end: the leaf only diverges slightly. Pointed end: the leaf diverges a lot more.',
        conclusion: 'N.B. Charge accumulates more at a point on a conductor than on a rounded side.',
        sim: expPoints,
      },
      {
        id: 'point-discharge',
        title: 'To show point discharge and electric wind',
        aim: 'To show that charge leaks from a sharp point, creating an electric wind.',
        apparatus: ['Van de Graaff generator', 'Pointed needle-shaped conductor and a lit candle', '<em>or</em> a pinwheel'],
        steps: ['<strong>Candle version:</strong> connect a pointed needle-shaped conductor to the top of a Van de Graaff generator.', 'Turn on the generator.', 'Bring a lit candle towards the pointed end of the conductor.', '<strong>Or, pinwheel version:</strong> connect a pinwheel to the top of the Van de Graaff generator and turn on the generator.'],
        result: 'Candle: the flame flickers and gets blown out. Pinwheel: electrostatic repulsion causes the pinwheel to spin.',
        conclusion: 'N.B. Charge accumulates at the sharpest end of the conductor. An electric wind is created, demonstrating point discharge.',
        sim: expDischarge,
      },
      {
        id: 'parallel-plates',
        title: 'To show the electric field pattern between two parallel metal plates',
        aim: 'To see the shape of the electric field between two oppositely charged parallel plates.',
        apparatus: ['Petri dish of oil', 'Two parallel metal plates', 'Semolina grains', 'EHT (Extra High Tension) unit, 6,000 V'],
        steps: ['Put two parallel metal plates into a petri dish of oil.', 'Sprinkle semolina grains between the two parallel plates.', 'Connect the plates to an EHT unit and turn it on.', 'Observe the movement and the shape taken by the semolina grains.'],
        result: 'The grains line up to form uniform, parallel field lines between the plates, curving at the edges.',
        conclusion: 'The field between parallel plates is uniform (straight) in the centre and bends at the edges.',
        sim: expPlates,
      },
    ],

    topics: [
      {
        id: 'static-friction',
        title: 'Static electricity & charging by friction',
        summary: 'Rubbing two insulators together moves electrons from one to the other.',
        keywords: 'Thales Miletus amber fur 600 BC friction static electricity electrons gain lose polythene perspex wool woollen cloth conservation of charge stirrup like charges repel unlike attract',
        render(el, ui) {
          const s1 = EM.section(el, 'Where it all started');
          EM.callout(s1, 'history', '<strong>Thales of Miletus</strong> (Greek, about 600 BC) discovered that a piece of <strong>amber</strong> (fossilised tree resin) rubbed with fur causes attraction between the fur and the amber. This is called <strong>static electricity</strong> and it is caused by <strong>friction</strong>.');
          const s2 = EM.section(el, 'Gaining and losing electrons');
          EM.p(s2, 'When two <strong>insulating</strong> materials are rubbed together, they may become electrically charged. Electrons can be gained or lost from a body:');
          EM.list(s2, ['If a body <strong>gains electrons</strong> it becomes <strong>negatively</strong> charged.', 'If a body <strong>loses electrons</strong> it becomes <strong>positively</strong> charged.']);
          EM.callout(s2, 'key', 'Only <strong>electrons</strong> move when you charge something by friction. The positive protons are locked inside the nuclei. A “positive” object is simply one that is short of electrons.');
          EM.cards(s2, [
            { icon: '➖', title: 'Polythene rod + woollen cloth', html: 'Electrons move <strong>from the cloth to the polythene</strong>. The polythene now has an overall <strong>negative</strong> charge; the cloth has an overall <strong>positive</strong> charge.' },
            { icon: '➕', title: 'Perspex rod + woollen cloth', html: 'Electrons move <strong>from the rod to the cloth</strong>. The Perspex rod now has an overall <strong>positive</strong> charge; the cloth has an overall <strong>negative</strong> charge.' },
          ]);
          const sp = EM.simPanel(s2, 'Charge a rod by friction', 'Drag the woollen cloth back and forth along the rod (or press “Rub for me”). Switch between polythene and Perspex and watch which way the electrons go.');
          simRubRod(sp);
          ui.term('conservation', s2);
          EM.p(s2, 'Notice in the simulation that the rod and cloth always end up with <em>equal and opposite</em> charges: the total stays zero. No charge was made — electrons were just moved.');
          const s3 = EM.section(el, 'Forces between charges');
          ui.term('law-of-charges', s3);
          ui.experiment('forces', s3);
        },
      },
      {
        id: 'charge-conductors',
        title: 'Charge, fields, conductors & insulators',
        summary: 'What charge and an electric field are, the coulomb, and why metals conduct.',
        keywords: 'electric charge electric field definition coulomb unit coulomb meter 6.25 x 10^18 electrons 1.6 x 10^-19 insulator conductor rubber plastic metal loosely bound outer electrons static current electricity',
        render(el, ui) {
          const s1 = EM.section(el, 'Key definitions');
          ui.term('electric-charge', s1);
          ui.term('electric-field', s1);
          ui.term('coulomb-unit', s1);
          EM.p(s1, 'We will meet Charles Coulomb, after whom the unit is named, at the end of this chapter. Charge can be measured with a <strong>coulomb meter</strong>.');
          ui.formula('charge-electrons', s1);
          const s2 = EM.section(el, 'Insulators and conductors');
          ui.term('insulator', s2);
          ui.term('conductor', s2);
          EM.p(s2, 'The outer electrons in a conductor are <strong>very loosely bound</strong> to their atoms, so an energy boost can easily make them move from atom to atom. In an insulator every electron is held tightly by its own atom, so charge put on it stays where it was put.');
          const sp = EM.simPanel(s2, 'Conductor vs insulator', 'Touch each bar with the charged polythene rod. Then touch the far ends with your finger.');
          simConductors(sp);
          const s3 = EM.section(el, 'Static vs current electricity');
          EM.callout(s3, 'note', 'That’s the one main difference between static electricity and current electricity: <strong>static electricity builds up on insulators</strong>, whereas <strong>current electricity flows through conductors</strong>.');
          ui.term('static-electricity', s3);
        },
      },
      {
        id: 'electroscope',
        title: 'The gold leaf electroscope & proof plane',
        summary: 'A simple instrument that detects charge, its sign and its size.',
        keywords: 'gold leaf electroscope metal cap insulator metal rod gold leaf earth connection detect charge identify positive negative size distinguish conductor insulator proof plane nano-coulombmeter',
        render(el, ui) {
          const s1 = EM.section(el, 'Parts of the electroscope');
          const t = EM.add(s1, 'table', { class: 'data-table' });
          t.innerHTML =
            '<tr><th>Part</th><th>What it does</th></tr>' +
            '<tr><td>Metal cap</td><td>Where charge is brought near or touched on</td></tr>' +
            '<tr><td>Insulator</td><td>Stops charge leaking from the rod to the case</td></tr>' +
            '<tr><td>Metal rod</td><td>Conducts charge from the cap down to the leaf</td></tr>' +
            '<tr><td>Gold leaf</td><td>Very light; it is repelled by the rod when both have the same charge, so it rises (diverges)</td></tr>' +
            '<tr><td>Earth connection</td><td>Connects the case to earth</td></tr>';
          ui.term('electroscope', s1);
          EM.p(s1, '<strong>Its functions include:</strong>');
          EM.list(s1, ['To detect charges.', 'To identify if the charge is positive or negative.', 'To indicate the size of the charge.', 'To distinguish between a conductor and an insulator.'], { ordered: true });
          const sp = EM.simPanel(s1, 'Virtual electroscope', 'Pick a function to try, then drag the rod towards the cap. You can touch the cap and earth it too.');
          simElectroscope(sp);
          EM.details(s1, 'How the electroscope does each job', '<ol class="deriv">' + '<li><strong>Detect:</strong> a charged object near the cap pushes like charges down to the rod and leaf. They repel, so the leaf rises.</li>' + '<li><strong>Sign:</strong> first give the electroscope a known charge (e.g. negative). Bring the object near: if the leaf rises <em>further</em>, the object has the same sign; if it falls, the opposite sign.</li>' + '<li><strong>Size:</strong> the bigger the charge brought to the same spot, the bigger the divergence.</li>' + '<li><strong>Conductor or insulator:</strong> charge the electroscope, then touch the cap with the object held in your hand. A conductor lets the charge flow away to earth through you, so the leaf collapses; an insulator does not, so the leaf stays up.</li></ol>');
          EM.callout(s1, 'tip', 'Only an <strong>increase</strong> in divergence is a sure test of sign. A decrease can also be caused by an uncharged conductor (such as your hand) brought near the cap.', 'Going further');
          const s2 = EM.section(el, 'The proof plane');
          EM.p(s2, 'Gold leaf electroscopes are commonly used alongside <strong>proof planes</strong> in experiments to study electric fields and electrostatics.');
          ui.term('proof-plane', s2);
          EM.p(s2, 'The proof plane is touched off the conductor being tested, and the charge is transferred to a gold leaf electroscope or a digital <strong>nano-coulombmeter</strong> (a coulomb meter sensitive enough to read charges of a few nC = 10<sup>−9</sup> C). Because charge on a conductor is not always spread evenly, you can touch it off different places to compare how much charge each spot has. You’ll use one in the hollow-conductor demo in “Where charge sits on a conductor”.');
        },
      },
      {
        id: 'everyday',
        title: 'Static in everyday life & grounding',
        summary: 'Balloons, door-handle shocks and why we connect things to earth.',
        keywords: 'balloon wall rub hair same charge repel shoes floor carpet door handle shock spark John Travoltage trampoline escalator rubber belt shopping trolley equalisation grounding earthing',
        render(el, ui) {
          const s1 = EM.section(el, 'Charging by friction around you');
          EM.list(s1, ['Rub a balloon on your hair and it becomes negatively charged. The <strong>negative charges on the balloon attract the positive charges on the wall</strong>, so it sticks.', 'Two charged balloons push apart: <strong>objects with the same charge repel each other</strong>.']);
          const tabs = EM.tabs(s1, [
            { label: '🎈 Balloons', render: (p) => simBalloon(EM.simPanel(p, 'Balloons', 'Rub the balloon, then drag it to the wall. Try the two-balloon scene too.')) },
            { label: '⚡ John Travoltage', render: (p) => simTravoltage(EM.simPanel(p, 'John Travoltage', 'Drag the person back and forth over the carpet to build up charge, then walk them to the door handle.')) },
          ]);
          void tabs;
          EM.callout(s1, 'tip', 'The wall isn’t charged overall. The balloon’s negative charge pushes the wall’s electrons slightly away, leaving the surface nearest the balloon slightly positive (the wall is <strong>polarised</strong>). The nearby + charges are attracted more strongly than the further − charges are repelled, so there is an overall attraction.', 'Going further');
          const s2 = EM.section(el, 'Shoes, floors and shocks');
          EM.p(s2, 'When you drag your shoes across the floor, this can cause either a build-up of electrons on your shoes <em>or</em> a loss of electrons from your shoes. You either <strong>gain electrons</strong> and become <strong>negatively charged</strong>, or you <strong>lose electrons</strong> and become <strong>positively charged</strong>.');
          EM.p(s2, 'If you then touch a conductor (e.g. a metal door handle), electrons flow <strong>from you to it</strong> if you are negatively charged, or <strong>from it to you</strong> if you are positively charged. The excess charge quickly moves to neutralise itself.');
          EM.p(s2, 'This <strong>equalisation of charge</strong> is felt as a small shock, and you may even see a small spark. The same build-up of excess charge can happen with most insulating materials, for example:');
          EM.list(s2, ['jumping on a trampoline', 'holding an escalator’s rubber belt', 'holding the plastic handle of a shopping trolley']);
          EM.p(s2, 'When you then touch a conductor, equalisation occurs.');
          EM.callout(s2, 'example', 'In the classic animation, <strong>John Travoltage</strong> shuffles his feet on the carpet, causing a build-up of electrons from the ground onto himself. He then touches the metal handle and gets a small shock through the equalisation process.');
          const s3 = EM.section(el, 'Grounding');
          ui.term('grounding', s3);
          EM.p(s3, 'Connecting something to earth gives excess charge a safe path to flow away (or lets electrons flow up from the earth) so that charge can’t build up to a dangerous level.');
        },
      },
      {
        id: 'induction',
        title: 'Charging by induction',
        summary: 'Charging a conductor without touching it, using polarisation and an earth connection.',
        keywords: 'charging by induction polarise polarisation redistribution separation of charge earth ground sphere polythene rod opposite polarity inducing',
        render(el, ui) {
          const s1 = EM.section(el, 'Charging without touching');
          ui.term('induction', s1);
          ui.term('polarisation', s1);
          EM.p(s1, 'There are three ingredients: a <strong>charged object</strong> brought <em>near</em> (not touching), a <strong>conductor</strong> whose electrons are free to move, and a <strong>connection to earth</strong> for a short time.');
          EM.callout(s1, 'key', 'The conductor always ends up with the <strong>opposite</strong> charge to the inducing object: a negative rod gives a positive sphere; a positive rod gives a negative sphere.');
          ui.experiment('induction-sphere', s1);
          EM.callout(s1, 'warn', 'Order matters: disconnect the earth <strong>before</strong> removing the rod. If you remove the rod first, the charge simply flows back through the earth connection and the sphere ends up neutral. Try it in the simulation!');
        },
      },
      {
        id: 'distribution',
        title: 'Where charge sits on a conductor',
        summary: 'Charge lives on the outside of a conductor and crowds where it is most curved.',
        keywords: 'distribution of charge conductor Faraday cage net calorimeter Van de Graaff proof plane outside hollow conductor linemen data security MRI microwave vehicle aircraft lightning Faraday bag key fob relay attack charge density curvature pear-shaped sphere shield field lines',
        render(el, ui) {
          const s1 = EM.section(el, 'Charge lives on the outside');
          EM.p(s1, 'We can use a <strong>Faraday net/cage</strong>, or a <strong>calorimeter on a Van de Graaff generator</strong> and a <strong>proof plane</strong>, to show that charge sits on the outside of a conductor.');
          ui.term('outside-only', s1);
          ui.experiment('hollow-conductor', s1);
          EM.p(s1, 'Why? Like charges repel, so they push each other as far apart as they can — and for a conductor “as far apart as possible” means on its outer surface.');
          const s2 = EM.section(el, 'Faraday cages');
          ui.term('faraday-cage', s2);
          const sp = EM.simPanel(s2, 'Faraday cage', 'Drag the charge around the cage, and switch the cage on and off.');
          simFaraday(sp);
          EM.p(s2, '<strong>Applications of Faraday cages:</strong>');
          EM.cards(s2, [
            { icon: '🦺', title: 'Electric power linemen', html: 'They are dressed in Faraday nets to protect themselves from the high voltages when working on high-voltage lines.' },
            { icon: '🔐', title: 'Electronics & data security', html: 'Used to shield data centres, servers and devices (computers) from hacking, eavesdropping and remote wiping.' },
            { icon: '🏥', title: 'MRI rooms', html: 'Walls are lined with copper to prevent outside radio waves from interfering with the scan.' },
            { icon: '🍲', title: 'Consumer safety', html: 'Microwave ovens are designed with a Faraday cage (metal mesh on the door) to keep the radiation inside.' },
            { icon: '✈️', title: 'Safety & protection', html: 'Vehicles and aircraft act as cages, protecting passengers from lightning strikes.' },
            { icon: '🔑', title: 'Faraday bags/boxes', html: 'Used to store car key fobs to prevent relay attacks if someone is trying to steal your car.' },
          ]);
          const s3 = EM.section(el, 'Charge build-up at a point');
          EM.p(s3, 'The charge on a <strong>spherical</strong> conductor (A) is <strong>uniformly distributed</strong>. The charge on a <strong>pear-shaped</strong> conductor (B) is <strong>concentrated near the pointed end</strong>.');
          ui.term('curvature', s3);
          const sp2 = EM.simPanel(s3, 'Where does the charge go?', 'Charge is sprinkled inside the metal at random. Watch where the repulsion pushes it. (A 2-D cross-section of a long conductor.)');
          simChargeRelax(sp2);
          EM.p(s3, '<strong>Why does charge accumulate at the pointed end?</strong> Think about two neighbouring charges on the surface and the field lines between them. Where the surface is flat, the field lines from one charge reach the other easily, so they repel strongly. Where the surface is sharply curved (like Fig. 3 in the notes, where the surface area gets smaller), the conductor itself <strong>shields more of the field lines</strong> between them than in Fig. 1 or Fig. 2, so the force of repulsion is less. This allows more charge to accumulate at the pointed end.');
          EM.callout(s3, 'key', 'The force of repulsion between two similar charges at sharp edges is less than at flat edges — so charge crowds onto points.');
          ui.experiment('points', s3);
        },
      },
      {
        id: 'point-discharge',
        title: 'Point discharge & lightning conductors',
        summary: 'Sharp points leak charge into the air as an “electric wind”.',
        keywords: 'point discharge point effect electric wind lightning conductor sharp tip positive charge induced cloud strong electric field negative ions positive ions earth collisions path for lightning candle flame Van de Graaff pinwheel needle',
        render(el, ui) {
          const s1 = EM.section(el, 'Point discharge / point effect / electric wind');
          ui.term('point-discharge', s1);
          EM.p(s1, 'How a <strong>lightning conductor</strong> works:');
          EM.list(s1, [
            'At the sharp end of a lightning conductor there is a large accumulation of <strong>positive charge induced by the lightning cloud</strong>.',
            'This positive charge causes a <strong>strong electric field</strong> in the region around the conductor tip.',
            'Any <strong>negative ions</strong> in the air (formed from neutral air atoms) are <strong>attracted to the tip</strong> of the conductor and pass to earth.',
            'Any <strong>positive ions</strong> in the air are <strong>repelled from the tip</strong>. The repelled positive ions produce further ions by collisions with atoms in the air, creating an <strong>“electric wind”</strong>. This can act as a path for the lightning.',
            'This can be demonstrated using a Van de Graaff generator and a candle flame — the flame gets quenched by the electric wind.',
          ]);
          const sp = EM.simPanel(s1, 'At the tip of a lightning conductor', 'Change the charge on the cloud, and compare a sharp tip with a rounded top.');
          simLightning(sp);
          ui.term('electric-wind', s1);
          ui.experiment('point-discharge', s1);
        },
      },
      {
        id: 'field-lines',
        title: 'Electric field lines',
        summary: 'Drawing the invisible: the rules of field lines and the patterns they make.',
        keywords: 'electric field lines never cross perpendicular conductor surface start end charges infinity away from positive towards negative density strength dense sparse people emit nerve heartbeat single point charge two opposite charges two positive two negative A B C strength parallel plates uniform edges semolina oil EHT',
        render(el, ui) {
          const s1 = EM.section(el, 'Rules for electric field lines');
          ui.term('field-line', s1);
          EM.list(s1, [
            'Electric field lines exist throughout space. They provide a visual tool to understand the invisible influence a charge exerts on the space around it.',
            'The field lines map out the intensity and direction of the field. The relative closeness (density) of the lines indicates the strength of the field: <strong>dense lines mean a strong field, sparse lines mean a weak field</strong>.',
            'Electric field lines <strong>never cross</strong>. If they did, it would mean the electric field had two different directions at the same point, which is physically impossible.',
            'Electric field lines are always <strong>perpendicular to the surface of a conductor</strong>.',
            'Electric field lines are continuous curves, <strong>starting and ending on charges or at infinity</strong>. The curvature represents the combined influence of multiple charges.',
            'The field lines always point <strong>away from positive</strong> charges and <strong>towards negative</strong> charges.',
          ]);
          EM.callout(s1, 'real', 'People emit electric field lines too! The body’s electrical activity comes from nerve signals, muscle contractions and our heartbeat, and also from the build-up of static electricity on our skin. These processes involve the movement of charged ions, so we produce a very weak electromagnetic field.');
          const s2 = EM.section(el, 'Field-line sandbox');
          const sp = EM.simPanel(s2, 'Build a field', 'Choose a pattern from the notes or build your own: click to add charges, drag to move them.');
          simSandbox(sp);
          EM.p(s2, 'Patterns from the notes to look for in the sandbox:');
          EM.list(s2, [
            '<strong>Single positive charge</strong>: straight lines radiating outwards. <strong>Single negative charge</strong>: straight lines pointing inwards.',
            '<strong>Two opposite charges</strong>: lines curve from the + to the −; the field is strongest in between.',
            '<strong>Two positive charges</strong> (or <strong>two negative charges</strong>): the lines push away from each other, leaving a neutral point midway where the field is zero.',
            '<strong>Parallel plates</strong>: straight, evenly spaced lines in the centre; bending at the edges.',
          ]);
          const s3 = EM.section(el, 'More lines = stronger charge');
          EM.p(s3, 'The diagram shows the strength of the charge. More lines mean a stronger field: charge A is the weakest and charge C is the strongest.');
          drawABC(EM.add(s3, 'div', { class: 'sim' }));
          const s4 = EM.section(el, 'Between parallel plates');
          EM.p(s4, 'In finite systems like parallel plates, the field is <strong>uniform (straight) in the centre</strong>. The field lines <strong>bend at the edges</strong> because there are no surrounding charges to balance them.');
          ui.experiment('parallel-plates', s4);
        },
      },
      {
        id: 'coulomb',
        title: 'Coulomb’s law & electric field strength',
        summary: 'How big the force between two charges is, and the field strength at a point.',
        keywords: 'Charles Coulomb France 1736 1806 Coulomb law force point charges product inversely proportional square distance inverse square law double quarter constant of proportionality 1/4 pi epsilon permittivity vacuum free space air 8.854 x 10^-12 electric field strength E = F/q N/C V/m test charge ISS gravity analogy derivation',
        render(el, ui) {
          const s1 = EM.section(el, 'Force on electric charges');
          EM.callout(s1, 'history', '<strong>Charles Coulomb</strong> (France, 1736 – 1806) investigated the force between electric charges. The unit of electric charge, the coulomb, is named after him.');
          ui.term('coulombs-law', s1);
          ui.formula('coulomb', s1);
          EM.p(s1, 'Coulomb discovered the relationship <var>F</var> ∝ ' + fr('1', '<var>d</var><sup>2</sup>') + '. It is an <strong>inverse square law</strong>: as the distance between the two charges doubles, the force acting on them decreases by a factor of four.');
          ui.term('inverse-square', s1);
          ui.formula('inverse-square', s1);
          ui.term('permittivity', s1);
          EM.callout(s1, 'note', 'The question will tell you that the charges are in a vacuum/free space or in air, so just use ' + fr('1', '4π<var>ε</var><sub>0</sub>') + ' in your equation, with ε<sub>0</sub> = 8.854 × 10<sup>−12</sup> F m<sup>−1</sup>.');
          const sp = EM.simPanel(s1, 'Coulomb’s law explorer', 'Drag q₂ (or use the sliders). The graph shows F against d — watch what happens when you double the distance.');
          simCoulomb(sp);
          const s2 = EM.section(el, 'Electric field strength');
          ui.term('field-strength', s2);
          ui.formula('field-strength', s2);
          EM.callout(s2, 'warn', '<strong>Important:</strong> if a question asks you to find the electric field strength at a point, say x, a given distance from another charge, it doesn’t matter what the size of any charge at x is. They are just asking what the field strength is at position x on a field line. All you need is the size of the charge that is <strong>creating</strong> the field where x is located.', 'Important');
          EM.callout(s2, 'example', 'Think of it like finding the acceleration due to gravity, g, 400 km up where the <strong>International Space Station</strong> is. The mass of the ISS is irrelevant. All you need is the mass of the object creating the gravitational field that pulls on the ISS — the mass of the Earth only.', 'Analogy: the ISS');
          EM.p(s2, 'Putting E = F/q together with Coulomb’s law gives the field strength near a single point charge (open the derivation):');
          ui.formula('field-point', s2);
        },
      },
    ],

    quiz: [
      { q: 'Who discovered (around 600 BC) that amber rubbed with fur attracts the fur?', options: ['Thales of Miletus', 'Charles Coulomb', 'Michael Faraday', 'Benjamin Franklin'], answer: 0, explain: 'Thales of Miletus, a Greek, noticed this effect of static electricity caused by friction.' },
      { q: 'A polythene rod is rubbed with a woollen cloth. What charge does the rod get, and why?', options: ['Negative — electrons move from the cloth to the rod', 'Positive — electrons move from the rod to the cloth', 'Negative — protons move from the rod to the cloth', 'Positive — protons move from the cloth to the rod'], answer: 0, explain: 'Electrons move from the wool onto the polythene, so the rod is negative and the cloth positive. Protons never move.' },
      { q: 'A Perspex rod is rubbed with a woollen cloth. Which statement is correct?', options: ['The rod becomes positive and the cloth negative', 'The rod becomes negative and the cloth positive', 'Both become positive', 'Neither becomes charged'], answer: 0, explain: 'Electrons move from the Perspex to the wool: the rod is positive and the cloth negative.' },
      { q: 'Which law says that charge can only be transferred from one object to another?', options: ['The law of conservation of charge', 'Coulomb’s law', 'The inverse square law', 'The law of induction'], answer: 0, explain: 'Charge can’t be created nor destroyed, only transferred.' },
      { q: 'How many electrons make up a charge of 1 C?', options: ['6.25 × 10¹⁸', '1.6 × 10⁻¹⁹', '6.25 × 10⁻¹⁸', '8.854 × 10¹²'], answer: 0, explain: 'n = Q/e = 1 ÷ 1.6 × 10⁻¹⁹ = 6.25 × 10¹⁸ electrons.' },
      { q: 'Why do metals conduct electric charge?', options: ['Their outer electrons are very loosely bound to the atoms', 'Their protons are free to move', 'They have no electrons', 'Their electrons are very tightly bound'], answer: 0, explain: 'An energy boost easily moves the loosely bound outer electrons from atom to atom.' },
      { q: 'Which of these is NOT a function of a gold leaf electroscope?', options: ['To measure the current in a circuit', 'To detect a charge', 'To indicate the size of a charge', 'To distinguish between a conductor and an insulator'], answer: 0, explain: 'The electroscope works with static charge: detecting it, finding its sign and size, and testing conductors/insulators.' },
      { q: 'A negatively charged electroscope has a diverged leaf. A rod brought near the cap makes the leaf diverge further. The rod is…', options: ['negatively charged', 'positively charged', 'uncharged', 'a conductor'], answer: 0, explain: 'An increase in divergence means the rod has the same sign as the electroscope.' },
      { q: 'A sphere is charged by induction using a negatively charged polythene rod. The sphere ends up…', options: ['positively charged', 'negatively charged', 'neutral', 'with no charge on its surface'], answer: 0, explain: 'Induction always gives a charge opposite in sign to the inducing charge.' },
      { q: 'A proof plane is touched on the inside of a charged hollow calorimeter and then on an uncharged electroscope. What happens?', options: ['The leaf does not diverge', 'The leaf diverges a lot', 'The leaf diverges slightly', 'The leaf diverges, then the electroscope sparks'], answer: 0, explain: 'There is no charge on the inside; charge is only found on the outside of a charged conductor.' },
      { q: 'Which is an application of a Faraday cage?', options: ['A metal mesh in a microwave oven door', 'A plastic handle on a shopping trolley', 'A rubber escalator belt', 'A polythene rod'], answer: 0, explain: 'The metal mesh forms a cage that keeps the microwave radiation inside.' },
      { q: 'Where is the charge density greatest on a charged pear-shaped conductor?', options: ['At the pointed end', 'At the rounded end', 'In the middle of the inside', 'It is the same everywhere'], answer: 0, explain: 'The greater the curvature, the greater the charge density.' },
      { q: 'A lit candle near a sharp point on a charged Van de Graaff generator goes out. This demonstrates…', options: ['point discharge (electric wind)', 'charging by induction', 'the inverse square law', 'conservation of charge'], answer: 0, explain: 'Charge accumulates at the point and ions are repelled, creating an electric wind.' },
      { q: 'In a lightning conductor, which ions are attracted to the positively charged tip and pass to earth?', options: ['Negative ions', 'Positive ions', 'Neutral atoms', 'Protons'], answer: 0, explain: 'Opposite charges attract: negative ions go to the tip; positive ions are repelled, creating the electric wind.' },
      { q: 'Why can electric field lines never cross?', options: ['The field would have two different directions at the same point', 'They would cancel each other out', 'Charges would be destroyed', 'They always point towards positive charges'], answer: 0, explain: 'At any point the field has only one direction.' },
      { q: 'At what angle do electric field lines meet the surface of a conductor?', options: ['90° (perpendicular)', '45°', '0° (along the surface)', 'Any angle'], answer: 0, explain: 'Electric field lines are always perpendicular to the surface of a conductor.' },
      { q: 'The distance between two point charges is doubled. The force between them becomes…', options: ['one quarter as big', 'half as big', 'twice as big', 'four times as big'], answer: 0, explain: 'Inverse square law: F ∝ 1/d², so doubling d gives F/4.' },
      { q: 'Two point charges of +2 μC and +5 μC are 30 cm apart in air. The force between them is about…', options: ['1.0 N', '0.30 N', '3.3 N', '1.0 × 10⁻¹¹ N'], answer: 0, explain: 'F = (2 × 10⁻⁶)(5 × 10⁻⁶) ÷ (4π × 8.854 × 10⁻¹² × 0.3²) ≈ 1.0 N.' },
      { q: 'What is the electric field strength 30 cm from a +2 μC charge in air?', options: ['2.0 × 10⁵ N C⁻¹', '6.0 × 10⁴ N C⁻¹', '2.0 × 10⁻⁵ N C⁻¹', '6.7 × 10⁵ N C⁻¹'], answer: 0, explain: 'E = q₁/(4πε₀d²) = 2 × 10⁻⁶ ÷ (4π × 8.854 × 10⁻¹² × 0.09) ≈ 2.0 × 10⁵ N C⁻¹.' },
      { q: 'Which is a correct unit of electric field strength?', options: ['V m⁻¹', 'C N⁻¹', 'F m⁻¹', 'N m'], answer: 0, explain: 'E is measured in newtons per coulomb (N C⁻¹) or, equivalently, volts per metre (V m⁻¹).' },
    ],
  });
})();
