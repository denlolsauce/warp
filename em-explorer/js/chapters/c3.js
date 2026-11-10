/* Chapter C.3 — Heating effects of an electric current */
(function () {
  'use strict';
  const { draw: D, colors: C } = EM;
  const ACC = '#dc2626';
  const LIVE = '#c2702a'; // brown live wire (lightened so it reads on the dark canvas)
  const NEU = '#3b82f6';
  const EG = '#16a34a';
  const EY = '#facc15';
  const DARK = '#0f172a';

  /* ------------------------------------------------------------ shared helpers */

  function pl(ctx, pts, color, w = 3, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.lineCap = dash ? 'butt' : 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.restore();
  }
  function earthWire(ctx, pts, w = 4) {
    pl(ctx, pts, EG, w);
    pl(ctx, pts, EY, w, [7, 7]);
  }
  function rect(ctx, x, y, w, hgt, fill, stroke, lw = 2, r = 0) {
    ctx.save();
    if (r) D.roundRect(ctx, x, y, w, hgt, r);
    else {
      ctx.beginPath();
      ctx.rect(x, y, w, hgt);
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.restore();
  }
  function circle(ctx, x, y, r, fill, stroke, lw = 2) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Zig-zag heating coil from (x1,y1) to (x2,y2). o: {n, amp, color, width, glow, blur} */
  function coil(ctx, x1, y1, x2, y2, o = {}) {
    const n = o.n || 8;
    const amp = o.amp || 8;
    const dx = x2 - x1,
      dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const px = -dy / L,
      py = dx / L;
    const lead = 0.08;
    ctx.save();
    ctx.strokeStyle = o.color || C.wire;
    ctx.lineWidth = o.width || 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = o.blur || 12;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + dx * lead, y1 + dy * lead);
    for (let i = 0; i < n; i++) {
      const f = lead + ((1 - 2 * lead) * (i + 0.5)) / n;
      const s = i % 2 ? -1 : 1;
      ctx.lineTo(x1 + dx * f + px * amp * s, y1 + dy * f + py * amp * s);
    }
    ctx.lineTo(x2 - dx * lead, y2 - dy * lead);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /** Temperature (0..1) → colour of a heated metal: grey → dull red → red → orange → yellow-white. */
  const GLOW = [
    [0, [120, 133, 153]],
    [0.3, [140, 34, 34]],
    [0.55, [220, 38, 38]],
    [0.78, [249, 115, 22]],
    [1, [254, 243, 199]],
  ];
  function glow(t) {
    t = EM.clamp(t, 0, 1);
    for (let i = 1; i < GLOW.length; i++) {
      if (t <= GLOW[i][0]) {
        const [a, ca] = GLOW[i - 1];
        const [b, cb] = GLOW[i];
        const f = (t - a) / (b - a);
        return 'rgb(' + ca.map((c, j) => Math.round(c + (cb[j] - c) * f)).join(',') + ')';
      }
    }
    return 'rgb(254,243,199)';
  }

  /** Rising heat-haze lines above (x..x+w, y). s = strength 0..1 */
  function shimmer(ctx, x, y, w, s, t, hgt = 40) {
    if (s < 0.03) return;
    const n = Math.max(2, Math.round(w / 24));
    ctx.save();
    ctx.strokeStyle = `rgba(251,146,60,${Math.min(0.85, 0.15 + 0.7 * s)})`;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < n; i++) {
      const x0 = x + ((i + 0.5) * w) / n;
      ctx.beginPath();
      for (let k = 0; k <= 16; k++) {
        const yy = y - (k * hgt * (0.5 + 0.5 * s)) / 16;
        const xx = x0 + Math.sin(k * 0.8 - t * (3 + 5 * s) + i * 1.7) * 4;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Stick person standing with feet at (x, feet). o: {hand:[x,y], elbow:[x,y], shock, scale} */
  function person(ctx, x, feet, o = {}) {
    const s = o.scale || 1;
    const head = feet - 82 * s,
      sh = feet - 64 * s,
      hip = feet - 32 * s;
    ctx.save();
    ctx.strokeStyle = o.shock ? '#fca5a5' : '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (o.shock) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(x, head, 9 * s, 0, Math.PI * 2);
    ctx.moveTo(x, head + 9 * s);
    ctx.lineTo(x, hip);
    ctx.moveTo(x - 10 * s, feet);
    ctx.lineTo(x, hip);
    ctx.lineTo(x + 10 * s, feet);
    const hands = o.hands || (o.hand ? [{ hand: o.hand, elbow: o.elbow }] : []);
    for (const hd of hands) {
      ctx.moveTo(x, sh);
      if (hd.elbow) ctx.lineTo(hd.elbow[0], hd.elbow[1]);
      ctx.lineTo(hd.hand[0], hd.hand[1]);
    }
    if (hands.length < 2) {
      const side = hands.length && hands[0].hand[0] < x ? 1 : -1;
      ctx.moveTo(x, sh);
      ctx.lineTo(x + side * 12 * s, sh + 26 * s);
    }
    ctx.stroke();
    ctx.restore();
    return { head, sh, hip };
  }

  function earthSymbol(ctx, x, y, color = EG) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x - 9, y + 6);
    ctx.lineTo(x + 9, y + 6);
    ctx.moveTo(x - 4, y + 12);
    ctx.lineTo(x + 4, y + 12);
    ctx.stroke();
    ctx.restore();
  }

  function spark(ctx, x1, y1, x2, y2, t) {
    const n = 6;
    ctx.save();
    ctx.strokeStyle = Math.sin(t * 40) > 0 ? '#fde047' : '#ffffff';
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const dx = x2 - x1,
      dy = y2 - y1,
      L = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const off = (i % 2 ? 1 : -1) * 6 * Math.sin(t * 30 + i);
      ctx.lineTo(x1 + dx * f + (-dy / L) * off, y1 + dy * f + (dx / L) * off);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /** Circuit-breaker style device (main switch / RCD / MCB) with a lever. */
  function breaker(ctx, x, y, w, hgt, on, o = {}) {
    rect(ctx, x, y, w, hgt, o.body || '#f8fafc', o.outline || '#64748b', o.outline ? 2.5 : 1.5, 4);
    const lw = Math.min(18, w * 0.42),
      lh = hgt * 0.34;
    const lx = x + w / 2 - lw / 2;
    rect(ctx, lx, y + hgt * 0.2, lw, hgt * 0.6, '#cbd5e1', null);
    rect(ctx, lx, on ? y + hgt * 0.2 : y + hgt * 0.8 - lh, lw, lh, o.lever || '#1f2937', null, 0, 3);
    D.text(ctx, on ? 'ON' : 'OFF', x + w / 2, on ? y + hgt * 0.8 + 7 : y + hgt * 0.2 - 7, { size: 9, weight: 700, color: on ? '#15803d' : '#b91c1c' });
  }

  /** Format with SI prefix for canvas/readouts (plain text). */
  function si(x, unit, sig = 3) {
    if (!Number.isFinite(x)) return '–';
    if (x === 0) return '0 ' + unit;
    const ax = Math.abs(x);
    const pre = [
      [1e9, 'G'],
      [1e6, 'M'],
      [1e3, 'k'],
      [1, ''],
      [1e-3, 'm'],
    ];
    for (const [f, p] of pre) if (ax >= f * 0.9995) return EM.fmtText(x / f, sig) + ' ' + p + unit;
    return EM.fmtText(x * 1e3, sig) + ' m' + unit;
  }
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

  /* ------------------------------------------------------------ sim: inside a resistor */

  function simInsideResistor(el) {
    const X0 = 50,
      X1 = 650,
      Y0 = 80,
      Y1 = 200;
    const S = { I: 2, temp: 0.16, flashes: [] };
    const cols = 14,
      rows = 4;
    const gx = (X1 - X0 - 50) / (cols - 1),
      gy = (Y1 - Y0 - 36) / (rows - 1);
    const ions = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) ions.push({ x: X0 + 25 + c * gx, y: Y0 + 18 + r * gy, ph: Math.random() * 6.28 });
    const es = [];
    for (let i = 0; i < 38; i++) es.push({ x: X0 + 8 + Math.random() * (X1 - X0 - 16), y: Y0 + 8 + Math.random() * (Y1 - Y0 - 16), vy: (Math.random() - 0.5) * 80, jit: (Math.random() - 0.5) * 30, cool: 0 });
    EM.canvas(el, {
      width: 700,
      height: 290,
      label: 'Electrons drifting through a lattice of ions in a wire',
      draw(ctx, sim, dt) {
        const t = sim.t;
        S.temp += (S.I * S.I / 25 - S.temp) * Math.min(1, dt * 0.9);
        D.text(ctx, 'A metal wire (resistor), magnified: a lattice of positive ions with free electrons', 350, 30, { size: 13, color: C.muted });
        // wire body
        rect(ctx, X0, Y0, X1 - X0, Y1 - Y0, '#1e293b', '#475569', 2, 14);
        ctx.save();
        ctx.globalAlpha = Math.min(0.75, S.temp * 0.8);
        rect(ctx, X0, Y0, X1 - X0, Y1 - Y0, glow(S.temp), null, 0, 14);
        ctx.restore();
        if (S.temp > 0.35) {
          ctx.save();
          ctx.shadowColor = glow(S.temp);
          ctx.shadowBlur = 30 * S.temp;
          rect(ctx, X0, Y0, X1 - X0, Y1 - Y0, null, glow(S.temp), 3, 14);
          ctx.restore();
        }
        // ions vibrate more as the wire heats up
        const amp = 0.8 + 5 * S.temp;
        for (const ion of ions) {
          const ix = ion.x + Math.sin(t * 23 + ion.ph) * amp;
          const iy = ion.y + Math.cos(t * 29 + ion.ph * 1.3) * amp;
          circle(ctx, ix, iy, 8, '#64748b', '#94a3b8', 1.2);
          D.sign(ctx, ix, iy, 1, 3.5);
        }
        // electrons
        const vd = 24 * S.I;
        for (const e of es) {
          e.vy += (Math.random() - 0.5) * 500 * dt;
          e.vy = EM.clamp(e.vy, -70, 70);
          e.x += (vd + e.jit * (S.I > 0 ? 1 : 0.6)) * dt;
          e.y += e.vy * dt;
          if (e.y < Y0 + 6) (e.y = Y0 + 6), (e.vy = Math.abs(e.vy));
          if (e.y > Y1 - 6) (e.y = Y1 - 6), (e.vy = -Math.abs(e.vy));
          if (e.x > X1 - 6) e.x = X0 + 6;
          if (e.x < X0 + 6) e.x = X1 - 6;
          e.cool -= dt;
          if (S.I > 0.05 && e.cool <= 0) {
            const c = Math.round((e.x - X0 - 25) / gx),
              r = Math.round((e.y - Y0 - 18) / gy);
            if (c >= 0 && c < cols && r >= 0 && r < rows) {
              const ion = ions[c * rows + r];
              if (Math.hypot(e.x - ion.x, e.y - ion.y) < 12) {
                S.flashes.push({ x: ion.x, y: ion.y, life: 1 });
                e.vy = -e.vy + (Math.random() - 0.5) * 60;
                e.cool = 0.3;
              }
            }
          }
          D.electron(ctx, e.x, e.y, 3.5);
        }
        S.flashes = S.flashes.filter((f) => (f.life -= dt * 3) > 0);
        for (const f of S.flashes) {
          ctx.save();
          ctx.strokeStyle = `rgba(251,146,60,${f.life * 0.9})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 10 + (1 - f.life) * 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        shimmer(ctx, X0 + 20, Y0 - 6, X1 - X0 - 40, S.temp, t, 36);
        D.text(ctx, '− terminal side', X0 + 4, Y1 + 18, { size: 12, align: 'left', color: C.muted });
        D.text(ctx, '+ terminal side', X1 - 4, Y1 + 18, { size: 12, align: 'right', color: C.muted });
        if (S.I > 0.05) {
          D.arrow(ctx, 260, Y1 + 42, 440, Y1 + 42, { color: C.electron, width: 2.5 });
          D.text(ctx, 'electrons drift this way', 350, Y1 + 58, { size: 12, color: C.electron });
          D.arrow(ctx, 440, Y1 + 76, 260, Y1 + 76, { color: C.current, width: 2.5 });
          D.text(ctx, 'conventional current I', 470, Y1 + 76, { size: 12, color: C.current, align: 'left' });
        } else D.text(ctx, 'No current: electrons just jiggle randomly — no drift, no heating', 350, Y1 + 50, { size: 13, color: C.muted });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Current I', min: 0, max: 5, step: 0.1, value: S.I, unit: 'A', fmt: (v) => v.toFixed(1), onInput: (v) => (S.I = v) });
    const ro = EM.readout(el, [
      { key: 'p', label: 'Heat produced per second (R = 10 Ω)' },
      { key: 'x', label: 'Compared with 1 A' },
      { key: 'w', label: 'Wire' },
    ]);
    const st = EM.status(el);
    EM.every(150, () => {
      const P = S.I * S.I * 10;
      ro.set('p', EM.fmt(P) + ' W');
      ro.set('x', S.I > 0 ? '×' + EM.fmt(S.I * S.I) : '0');
      ro.set('w', S.temp < 0.1 ? 'cool' : S.temp < 0.3 ? 'warm' : S.temp < 0.55 ? 'hot — glowing dull red' : S.temp < 0.8 ? 'red hot' : 'white hot!');
      st.set(
        S.I > 0.05
          ? 'Electrons collide with the ions (orange flashes) and hand over energy. The ions vibrate more, so the wire gets <strong>hotter</strong>: electrical energy → heat energy.'
          : 'Turn up the current to see the electrons drift and collide with the ions.',
        S.I > 0.05 ? 'good' : ''
      );
    });
  }

  /* ------------------------------------------------------------ sim: Joule heating P = I²R */

  function simJouleHeating(el) {
    const S = { I: 2, R: 10, temp: 0.08, ghost: null };
    const loop = [
      [122, 60],
      [50, 60],
      [50, 270],
      [320, 270],
      [320, 60],
      [138, 60],
    ];
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: 'Heating coil glowing as the current increases, with a graph of power against current',
      draw(ctx, sim, dt) {
        const P = S.I * S.I * S.R;
        S.temp += (P / 500 - S.temp) * Math.min(1, dt * 1.5);
        D.grid(ctx, sim.W, sim.H);
        pl(ctx, [[50, 60], [122, 60]], C.wire, 3);
        pl(ctx, [[138, 60], [320, 60], [320, 270], [262, 270]], C.wire, 3);
        pl(ctx, [[98, 270], [50, 270], [50, 60]], C.wire, 3);
        D.cell(ctx, 130, 60, { label: 'power supply' });
        if (S.I > 0) D.flowDots(ctx, loop, sim.t, { speed: 22 * S.I });
        coil(ctx, 262, 270, 98, 270, { n: 12, amp: 13, color: glow(S.temp), width: 4, glow: S.temp > 0.25 ? glow(S.temp) : null, blur: 26 * S.temp });
        shimmer(ctx, 110, 248, 140, S.temp, sim.t, 70);
        D.text(ctx, `heating coil, R = ${S.R} Ω`, 180, 304, { size: 12, color: C.muted });
        D.meter(ctx, 245, 60, S.I / 5, { r: 24, centerZero: false, label: 'A', reading: S.I.toFixed(1) + ' A' });
        D.text(ctx, 'P = I²R = ' + EM.fmtText(P) + ' W', 185, 160, { size: 16, weight: 700, color: glow(Math.max(0.6, S.temp)) });
        const markers = [];
        if (S.ghost != null) {
          const gP = S.ghost * S.ghost * S.R;
          markers.push({ x: S.ghost, y: gP, color: '#94a3b8', label: `${EM.fmtText(S.ghost)} A → ${EM.fmtText(gP)} W` });
        }
        markers.push({ x: S.I, y: P, color: '#fde047', label: `${S.I.toFixed(1)} A → ${EM.fmtText(P)} W${S.ghost != null ? '  (×4!)' : ''}` });
        D.plot(ctx, { x: 420, y: 40, w: 270, h: 240 }, {
          xMin: 0,
          xMax: 5,
          yMin: 0,
          yMax: 500,
          xLabel: 'Current I (A)',
          yLabel: 'Power P (W)',
          title: 'Heating power against current',
          series: [{ fn: (x) => x * x * S.R, color: ACC, label: `P = I²R (R = ${S.R} Ω)` }],
          markers,
        });
      },
    });
    const c = EM.controls(el);
    const sI = EM.slider(c, { label: 'Current I', min: 0, max: 5, step: 0.1, value: S.I, unit: 'A', fmt: (v) => v.toFixed(1), onInput: (v) => ((S.I = v), (S.ghost = null)) });
    EM.slider(c, { label: 'Resistance R', min: 1, max: 20, step: 1, value: S.R, unit: 'Ω', onInput: (v) => (S.R = v) });
    EM.button(
      c,
      'Double the current',
      () => {
        if (S.I < 0.05) S.I = 1;
        if (S.I * 2 <= 5.0001) {
          S.ghost = S.I;
          S.I = Math.round(S.I * 20) / 10;
        } else S.ghost = Math.round(S.I * 10) / 20;
        sI.set(S.I);
      },
      'primary'
    );
    const ro = EM.readout(el, [
      { key: 'v', label: 'Voltage across coil V = IR' },
      { key: 'p', label: 'Power P = VI = I²R' },
      { key: 'w', label: 'Heat in 1 minute W = I²Rt' },
    ]);
    const st = EM.status(el);
    EM.every(150, () => {
      const P = S.I * S.I * S.R;
      ro.set('v', EM.fmt(S.I * S.R) + ' V');
      ro.set('p', EM.fmt(P) + ' W');
      ro.set('w', EM.fmt(P * 60) + ' J');
      if (S.ghost != null) {
        const ratio = (S.I / S.ghost) ** 2;
        st.set(`Current ×${EM.fmt(S.I / S.ghost)} → power ×${EM.fmt(ratio)}. Doubling the current <strong>quadruples</strong> the heat produced (P ∝ I²).`, 'good');
      } else st.set('Drag the current slider — the graph is a curve (parabola), not a straight line, because P ∝ I². Try “Double the current”.');
    });
  }

  /* ------------------------------------------------------------ sim: derivation flow chart */

  function derivationChain(el) {
    const N = {
      A: { x: 100, y: 42, t: 'P = W ÷ t', s: 0 },
      B: { x: 360, y: 42, t: 'V = W ÷ q  ⇒  W = Vq', s: 1 },
      C: { x: 620, y: 42, t: 'I = q ÷ t', s: 3 },
      D: { x: 230, y: 118, t: 'P = Vq ÷ t', s: 2 },
      E: { x: 490, y: 118, t: 'P = V × I', s: 3, key: true },
      F: { x: 100, y: 196, t: 'V = I × R', s: 4 },
      G: { x: 360, y: 196, t: 'P = I²R', s: 4, key: true },
      H: { x: 620, y: 196, t: 'W = P × t', s: 5 },
      I: { x: 620, y: 280, t: 'W = I²Rt', s: 5, key: true },
      J: { x: 100, y: 280, t: 'E = mcΔθ', s: 6 },
      K: { x: 360, y: 280, t: 'mcΔθ = I²Rt', s: 6, key: true },
    };
    const E = [
      ['A', 'D', 2],
      ['B', 'D', 2],
      ['D', 'E', 3],
      ['C', 'E', 3],
      ['E', 'G', 4],
      ['F', 'G', 4],
      ['G', 'I', 5],
      ['H', 'I', 5],
      ['I', 'K', 6],
      ['J', 'K', 6],
    ];
    const BW = 180,
      BH = 40;
    const S = { step: 0 };
    function edgePt(n, dx, dy) {
      const tt = Math.min(BW / 2 / (Math.abs(dx) || 1e-9), BH / 2 / (Math.abs(dy) || 1e-9));
      return [n.x + dx * tt, n.y + dy * tt];
    }
    EM.canvas(el, {
      width: 720,
      height: 320,
      label: 'Flow chart of the derivation of P = VI, P = I²R, W = I²Rt and mcΔθ = I²Rt',
      draw(ctx, sim) {
        D.grid(ctx, sim.W, sim.H);
        for (const [a, b, s] of E) {
          if (S.step < s) continue;
          const na = N[a],
            nb = N[b];
          const dx = nb.x - na.x,
            dy = nb.y - na.y,
            L = Math.hypot(dx, dy);
          const p1 = edgePt(na, dx / L, dy / L),
            p2 = edgePt(nb, -dx / L, -dy / L);
          const cur = s === S.step;
          D.arrow(ctx, p1[0], p1[1], p2[0], p2[1], { color: cur ? '#fca5a5' : 'rgba(148,163,184,0.7)', width: cur ? 3 : 2 });
        }
        for (const k in N) {
          const n = N[k];
          const shown = S.step >= n.s;
          const cur = n.s === S.step;
          ctx.save();
          ctx.globalAlpha = shown ? 1 : 0.18;
          const pulse = cur ? 0.5 + 0.5 * Math.sin(sim.t * 4) : 0;
          if (cur) {
            ctx.shadowColor = ACC;
            ctx.shadowBlur = 10 + 10 * pulse;
          }
          rect(ctx, n.x - BW / 2, n.y - BH / 2, BW, BH, cur ? '#3b0d0d' : '#131c31', n.key && shown ? '#fde047' : cur ? ACC : '#475569', n.key && shown ? 3 : 2, 8);
          ctx.restore();
          ctx.save();
          ctx.globalAlpha = shown ? 1 : 0.25;
          D.text(ctx, shown ? n.t : '?', n.x, n.y + 1, { size: 15, weight: 700, color: n.key && shown ? '#fde047' : C.text, font: 'Georgia, "Times New Roman", serif' });
          ctx.restore();
        }
      },
    });
    const steps = [
      { title: 'Start with power', html: `Power is the rate of doing work: <strong>P = ${EM.frac('W', 't')}</strong> &nbsp;(work done ÷ time taken).` },
      { title: 'Use the definition of voltage', html: `Voltage is work done per unit charge: V = ${EM.frac('W', 'q')}, so the work done is <strong>W = Vq</strong>.` },
      { title: 'Combine them', html: `Put W = Vq into P = ${EM.frac('W', 't')} to get <strong>P = ${EM.frac('Vq', 't')}</strong>.` },
      { title: 'Bring in current', html: `Current is charge per second: I = ${EM.frac('q', 't')}. So ${EM.frac('Vq', 't')} = V × ${EM.frac('q', 't')} = V × I, giving <strong>P = V × I</strong> (P = power, V = voltage, I = current).` },
      { title: 'Use Ohm’s law', html: 'Joule’s law says P ∝ I². Put V = I × R into P = V × I: P = I × R × I, so <strong>P = I²R</strong>. This is Joule’s law with R as the constant.' },
      { title: 'Find the heat energy', html: `Rearrange P = ${EM.frac('W', 't')} to W = P × t, then substitute P = I²R: <strong>W = I²Rt</strong>. This W is the heat energy produced when a current flows through a resistor.` },
      { title: 'Link to Strand 2 (heat)', html: 'N.B. The heat energy can warm a substance: E = mcΔθ. Work done is energy transferred (W = E), so <strong>mcΔθ = I²Rt</strong>.' },
    ];
    EM.stepper(el, steps, (i) => (S.step = i));
  }

  /* ------------------------------------------------------------ sim: live / neutral voltages */

  function simMainsVoltage(el) {
    const S = { mode: 'notes', tt: 0 };
    EM.canvas(el, {
      width: 700,
      height: 270,
      label: 'Graph of the live and neutral wire voltages against time',
      draw(ctx, sim, dt) {
        S.tt = (S.tt + dt * 0.02) % 0.06; // slowed down 50×: 1 s on screen = 20 ms of real time
        const Vpk = S.mode === 'notes' ? 220 : 325;
        const v = (ms) => Vpk * Math.sin((2 * Math.PI * 50 * ms) / 1000);
        const hLines = [
          { y: Vpk, color: LIVE, label: '+' + Vpk + ' V' },
          { y: -Vpk, color: LIVE, label: '−' + Vpk + ' V' },
        ];
        if (S.mode === 'real') hLines.push({ y: 230, color: '#fde047', label: '230 V rms (“effective” value)' });
        D.plot(ctx, { x: 80, y: 34, w: 590, h: 196 }, {
          xMin: 0,
          xMax: 60,
          yMin: -360,
          yMax: 360,
          xLabel: 'time (ms)',
          yLabel: 'voltage (V)',
          title: S.mode === 'notes' ? 'Live wire voltage (notes’ values: ±220 V)' : 'Live wire voltage (Irish mains: 230 V rms, ±325 V peak)',
          series: [
            { fn: v, color: LIVE, width: 3, label: 'Live (brown)' },
            { fn: () => 0, color: NEU, width: 3, label: 'Neutral (blue) ≈ 0 V' },
          ],
          hLines,
          vLines: [{ x: S.tt * 1000, color: '#e2e8f0', dash: [2, 3] }],
          markers: [{ x: S.tt * 1000, y: v(S.tt * 1000), color: '#fde047' }],
          xTicks: 6,
        });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Values',
      options: [
        { value: 'notes', label: 'As in the notes (±220 V)' },
        { value: 'real', label: 'Actual Irish mains' },
      ],
      value: S.mode,
      onChange: (v) => (S.mode = v),
    });
    const ro = EM.readout(el, [
      { key: 'l', label: 'Live voltage now' },
      { key: 'n', label: 'Neutral voltage' },
      { key: 'f', label: 'Changes direction' },
    ]);
    ro.set('n', '≈ 0 V');
    ro.set('f', '100 times a second');
    EM.status(el, 'Shown 50× slower than real life. The live swings between + and − (one full cycle every 20 ms, i.e. 50 Hz), crossing zero twice per cycle → 100 changes of direction per second.');
    EM.every(100, () => {
      const Vpk = S.mode === 'notes' ? 220 : 325;
      ro.set('l', Math.round(Vpk * Math.sin(2 * Math.PI * 50 * S.tt)) + ' V');
    });
  }

  /* ------------------------------------------------------------ sim: plug explorer */

  const PLUG_PARTS = {
    earth: { name: 'Earth wire (green/yellow)', html: '<strong>Earth wire (green/yellow)</strong> — goes to the top terminal and the earth pin. It provides a <strong>low-resistance path to the ground for fault currents</strong>, which helps prevent electric shocks.' },
    neutral: { name: 'Neutral wire (blue)', html: '<strong>Neutral wire (blue)</strong> — technically said to be at 0 V (but it may not be exactly). Its job is to <strong>complete the circuit</strong>, giving a safe return path for current back to the power source (panel/transformer) after it has passed through the appliance.' },
    live: { name: 'Live wire (brown)', html: '<strong>Live wire (brown)</strong> — always connected to the <strong>fuse</strong>. Its voltage swings between +220 V and −220 V (notes’ values), changing 100 times a second. This is the dangerous wire.' },
    fuse: { name: 'Fuse', html: '<strong>Fuse</strong> — a short length of wire with a very low melting point, inside a cartridge. If the current becomes too large for the appliance, the fuse <strong>melts and breaks the circuit</strong>. It is on the live side so that the appliance is disconnected from the live voltage.' },
    grip: { name: 'Cord grip', html: '<strong>Cord grip</strong> — clamps the outer sheath of the cable so that a tug on the flex pulls on the plug, not on the wires in their terminals.' },
    sheath: { name: 'Outer sheath', html: '<strong>Outer sheath</strong> — the outer layer of insulation that surrounds the three coloured wires. Each wire also has its own coloured insulation.' },
    epin: { name: 'Earth pin', html: '<strong>Earth pin (top pin)</strong> — longer than the other two. It goes into the socket first and <strong>opens the shutters</strong> covering the live and neutral holes. Press “Insert plug” to watch.' },
    sleeves: { name: 'Insulating sleeves', html: '<strong>Insulating sleeves</strong> on the live and neutral pins — help prevent an electric shock if your fingers wrap too far around the plug while the pins are partly in the socket.' },
    shutters: { name: 'Socket shutters', html: '<strong>Socket shutters</strong> — cover the live and neutral holes so nothing can be poked into them. Only the longer earth pin pushes them open.' },
  };

  function simPlug(el) {
    const S = { sel: 'live', ins: 0, pos: 0, hover: null };
    // hit areas (logical coords). Insert-dependent ones are computed in hit()
    function hit(p) {
      const dx = S.pos * 140;
      const inR = (x, y, w, hh) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + hh;
      if (inR(248, 54, 30, 104)) return 'fuse';
      if (inR(160, 60, 52, 40) || (p.x > 176 && p.x < 196 && p.y > 96 && p.y < 262)) return 'earth';
      if (inR(86, 178, 46, 36) || (p.x > 100 && p.x < 180 && p.y > 205 && p.y < 262 && p.x < 175)) return 'neutral';
      if (inR(242, 178, 46, 36) || (p.x > 195 && p.x < 270 && p.y > 205 && p.y < 262)) return 'live';
      if (inR(136, 270, 98, 22)) return 'grip';
      if (inR(166, 262, 38, 74)) return 'sheath';
      if (inR(460 + dx, 118, 90, 24)) return 'epin';
      if (inR(460 + dx, 196, 62, 62)) return 'sleeves';
      if (inR(596, 186, 20, 80)) return 'shutters';
      return null;
    }
    const hl = (k) => S.sel === k || S.hover === k;
    function outline(ctx, x, y, w, hh, k) {
      if (!hl(k)) return;
      ctx.save();
      ctx.shadowColor = '#fde047';
      ctx.shadowBlur = 12;
      rect(ctx, x, y, w, hh, null, S.sel === k ? '#fde047' : 'rgba(253,224,71,0.6)', 2.5, 6);
      ctx.restore();
    }
    function wireCurve(ctx, x1, y1, cx, cy, x2, y2, color, k, earth) {
      ctx.save();
      ctx.lineCap = 'round';
      if (hl(k)) {
        ctx.shadowColor = '#fde047';
        ctx.shadowBlur = 14;
      }
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
      };
      ctx.lineWidth = 11;
      ctx.strokeStyle = earth ? EG : color;
      path();
      ctx.stroke();
      if (earth) {
        ctx.shadowBlur = 0;
        ctx.setLineDash([8, 8]);
        ctx.lineCap = 'butt';
        ctx.strokeStyle = EY;
        path();
        ctx.stroke();
      }
      ctx.restore();
    }
    function terminal(ctx, x, y, w, hh, label, lx, ly) {
      rect(ctx, x - w / 2, y - hh / 2, w, hh, '#d4a017', '#92400e', 1.5, 3);
      circle(ctx, x, y, 6, '#e5e7eb', '#78716c', 1.5);
      D.line(ctx, x - 4, y, x + 4, y, '#57534e', 1.5);
      D.text(ctx, label, lx, ly, { size: 14, weight: 800, color: '#334155' });
    }
    EM.canvas(el, {
      width: 720,
      height: 350,
      label: 'Interactive three-pin plug and wall socket',
      cursor: 'pointer',
      onMove(p) {
        S.hover = hit(p);
      },
      onDown(p) {
        const k = hit(p);
        if (k) select(k);
      },
      draw(ctx, sim, dt) {
        S.pos += (S.ins - S.pos) * Math.min(1, dt * 2.2);
        if (!sim.pointer.inside) S.hover = null;
        // ---- opened plug (left)
        D.text(ctx, 'Inside a plug (cover removed) — click any part', 185, 12, { size: 12, color: C.muted });
        rect(ctx, 40, 24, 290, 312, '#e5e7eb', '#94a3b8', 2, 34);
        // terminals
        terminal(ctx, 186, 80, 44, 30, 'E', 146, 80);
        terminal(ctx, 109, 196, 40, 30, 'N', 74, 196);
        terminal(ctx, 265, 196, 40, 30, 'L', 300, 196);
        outline(ctx, 160, 62, 52, 36, 'earth');
        outline(ctx, 86, 178, 46, 36, 'neutral');
        outline(ctx, 242, 178, 46, 36, 'live');
        // fuse clips + cartridge
        rect(ctx, 256, 52, 18, 10, '#d4a017', null);
        rect(ctx, 256, 150, 18, 10, '#d4a017', null);
        pl(ctx, [[265, 160], [265, 181]], '#d4a017', 6);
        rect(ctx, 254, 62, 22, 16, '#cbd5e1', '#64748b', 1.5, 3);
        rect(ctx, 254, 134, 22, 16, '#cbd5e1', '#64748b', 1.5, 3);
        rect(ctx, 256, 78, 18, 56, 'rgba(255,255,255,0.75)', '#94a3b8', 1, 2);
        D.text(ctx, '13A', 265, 106, { size: 10, weight: 800, color: '#b91c1c' });
        D.text(ctx, 'fuse', 300, 106, { size: 12, weight: 700, color: '#334155' });
        outline(ctx, 248, 54, 30, 104, 'fuse');
        // wires from the cable end
        wireCurve(ctx, 186, 262, 186, 180, 186, 96, EG, 'earth', true);
        wireCurve(ctx, 178, 262, 120, 252, 112, 212, NEU, 'neutral');
        wireCurve(ctx, 194, 262, 252, 252, 262, 212, LIVE, 'live');
        // cable sheath + grip
        ctx.save();
        if (hl('sheath')) {
          ctx.shadowColor = '#fde047';
          ctx.shadowBlur = 14;
        }
        rect(ctx, 168, 258, 36, 80, '#f8fafc', '#94a3b8', 1.5, 6);
        ctx.restore();
        rect(ctx, 138, 272, 94, 18, '#475569', '#1f2937', 1.5, 4);
        circle(ctx, 148, 281, 4, '#cbd5e1');
        circle(ctx, 222, 281, 4, '#cbd5e1');
        outline(ctx, 136, 270, 98, 22, 'grip');
        D.text(ctx, 'cord grip', 98, 281, { size: 11, color: '#334155' });
        D.text(ctx, 'cable', 186, 326, { size: 11, color: '#475569' });

        // ---- pins + socket (right)
        const dx = S.pos * 140;
        D.text(ctx, 'Plug pins & wall socket (side view, simplified)', 550, 12, { size: 12, color: C.muted });
        // pins (drawn first so the socket face hides the parts inside it)
        rect(ctx, 460 + dx, 120, 90, 20, '#d4a017', '#92400e', 1.5, 2);
        for (const y of [200, 240]) {
          rect(ctx, 460 + dx, y, 62, 14, '#d4a017', '#92400e', 1.5, 2);
          rect(ctx, 460 + dx, y, 28, 14, '#111827', '#374151', 1, 2);
        }
        outline(ctx, 456 + dx, 116, 98, 28, 'epin');
        outline(ctx, 456 + dx, 194, 70, 66, 'sleeves');
        rect(ctx, 400 + dx, 90, 60, 200, '#e5e7eb', '#94a3b8', 2, 10);
        D.text(ctx, 'plug', 430 + dx, 300 - 22, { size: 11, color: '#334155' });
        // socket
        ctx.save();
        ctx.beginPath();
        ctx.rect(600, 80, 100, 220);
        ctx.clip();
        rect(ctx, 600, 80, 100, 220, '#f1f5f9', '#94a3b8', 2);
        rect(ctx, 600, 120, 100, 20, '#1e293b', null);
        rect(ctx, 600, 200, 100, 14, '#1e293b', null);
        rect(ctx, 600, 240, 100, 14, '#1e293b', null);
        // pins inside the socket
        if (460 + dx + 90 > 600) rect(ctx, 600, 122, 460 + dx + 90 - 600, 16, '#d4a017', null);
        for (const y of [200, 240]) if (460 + dx + 62 > 600) rect(ctx, 600, y + 2, 460 + dx + 62 - 600, 10, '#d4a017', null);
        const open = EM.clamp((dx - 40) / 30, 0, 1);
        rect(ctx, 600, 188 + open * 80, 16, 78, '#64748b', '#334155', 1.5, 2);
        ctx.restore();
        rect(ctx, 600, 80, 100, 220, null, '#94a3b8', 2);
        outline(ctx, 596, 186, 20, 80, 'shutters');
        D.text(ctx, 'wall socket', 650, 68, { size: 12, color: C.muted });
        D.text(ctx, 'earth pin (longer)', 464 + dx, 106, { size: 11, color: C.text, align: 'left' });
        D.text(ctx, 'sleeves', 464 + dx, 272, { size: 11, color: C.text, align: 'left' });
        D.text(ctx, open > 0.95 ? 'shutters open' : 'shutters closed', 650, 316, { size: 12, color: open > 0.95 ? C.good : C.warn, weight: 700 });
      },
    });
    const c = EM.controls(el);
    const sel = EM.select(c, { label: 'Part', options: Object.keys(PLUG_PARTS).map((k) => ({ value: k, label: PLUG_PARTS[k].name })), value: S.sel, onChange: (v) => select(v) });
    const btn = EM.button(c, 'Insert plug', () => {
      S.ins = S.ins ? 0 : 1;
      btn.textContent = S.ins ? 'Remove plug' : 'Insert plug';
      if (S.ins) select('epin');
    });
    const st = EM.status(el);
    function select(k) {
      S.sel = k;
      sel.set(k);
      st.set(PLUG_PARTS[k].html, 'good');
    }
    select('live');
  }

  /* ------------------------------------------------------------ sim: electrical bonding */

  function simBonding(el) {
    const S = { bond: true, fault: false, tripped: false, tf: 0 };
    const FEET = 300;
    function calc() {
      const live = S.fault && !S.tripped;
      if (!live) return { VA: 0, VB: 0, Ip: 0, If: 0 };
      if (S.bond) return { VA: 0.4, VB: 0.4, Ip: 0, If: 460 };
      return { VA: 230, VB: 0, Ip: 0.23, If: 0.23 };
    }
    EM.canvas(el, {
      width: 700,
      height: 320,
      label: 'Hot press with metal pipes, bonding wires and a person touching two pipes',
      draw(ctx, sim, dt) {
        const t = sim.t;
        if (S.fault && !S.tripped && S.bond) {
          S.tf += dt;
          if (S.tf > 0.5) S.tripped = true;
        }
        const r = calc();
        const liveA = r.VA > 100;
        // floor
        rect(ctx, 0, FEET, 700, 20, '#1c1917', null);
        D.text(ctx, 'Hot press', 40, 16, { size: 13, weight: 700, color: C.muted, align: 'left' });
        // breaker
        breaker(ctx, 600, 26, 44, 62, !S.tripped, { outline: '#2563eb' });
        D.text(ctx, 'breaker (MCB)', 622, 102, { size: 11, color: C.muted });
        // live supply to immersion heater
        pl(ctx, [[600, 40], [130, 40], [130, 120], [180, 120]], LIVE, 3);
        D.text(ctx, 'live supply', 360, 30, { size: 11, color: LIVE });
        // cylinder
        rect(ctx, 160, 90, 110, 175, liveA ? '#7c2d12' : '#b45309', liveA ? '#ef4444' : '#78350f', 3, 22);
        if (liveA) {
          ctx.save();
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 16 + 6 * Math.sin(t * 8);
          rect(ctx, 160, 90, 110, 175, null, '#ef4444', 2, 22);
          ctx.restore();
        }
        coil(ctx, 200, 120, 200, 235, { n: 10, amp: 9, color: '#cbd5e1', width: 2.5 });
        D.text(ctx, 'hot-water cylinder', 215, 280, { size: 11, color: C.muted });
        D.text(ctx, 'immersion', 240, 150, { size: 10, color: '#fde68a' });
        D.text(ctx, 'heater', 240, 163, { size: 10, color: '#fde68a' });
        if (S.fault && !S.tripped) spark(ctx, 205, 190, 262, 200, t);
        else if (S.fault) D.text(ctx, 'fault', 236, 200, { size: 10, color: '#fca5a5' });
        // pipes
        const pipeA = liveA ? '#ef4444' : '#d97706';
        pl(ctx, [[270, 120], [380, 120], [380, 300]], pipeA, 10);
        pl(ctx, [[500, 50], [500, 300]], '#d97706', 10);
        D.text(ctx, 'hot pipe', 380, 104, { size: 11, color: C.text });
        D.text(ctx, 'cold pipe', 500, 34, { size: 11, color: C.text });
        // person touching both pipes
        const shock = r.Ip > 0.05;
        const P = person(ctx, 440, FEET, { scale: 1.15, shock, hands: [{ hand: [385, 186] }, { hand: [495, 186] }] });
        if (shock) {
          D.flowDots(ctx, [[380, 186], [440, P.sh], [495, 186]], t, { speed: 50, color: '#f87171', spacing: 14 });
          D.text(ctx, '⚠ current through the person!', 440, 80, { size: 13, weight: 800, color: '#f87171', bg: 'rgba(11,18,32,0.85)' });
        }
        // bonding
        if (S.bond) {
          earthWire(ctx, [[380, 262], [380, 278], [640, 278]], 4);
          earthWire(ctx, [[500, 262], [500, 278]], 4);
          earthWire(ctx, [[640, 278], [640, 292]], 4);
          for (const x of [380, 500]) rect(ctx, x - 12, 254, 24, 10, '#94a3b8', '#475569', 1, 2);
          earthSymbol(ctx, 640, 296);
          D.text(ctx, 'main earth', 640, 262, { size: 11, color: EG });
          D.text(ctx, 'green/yellow bonding wires', 440, 311, { size: 11, color: EY });
          if (S.fault && !S.tripped) {
            D.flowDots(ctx, [[600, 40], [130, 40], [130, 120], [205, 190], [262, 200], [270, 120], [380, 120], [380, 278], [640, 278], [640, 292]], t, { speed: 230, spacing: 12, color: C.current });
            D.text(ctx, 'huge fault current → breaker trips', 560, 230, { size: 12, weight: 700, color: C.current, bg: 'rgba(11,18,32,0.85)' });
          }
        } else if (S.fault && !S.tripped) {
          D.flowDots(ctx, [[600, 40], [130, 40], [130, 120], [205, 190], [262, 200], [270, 120], [380, 120], [380, 186]], t, { speed: 45, spacing: 16, color: C.current });
        }
        if (S.tripped) D.text(ctx, 'TRIPPED — power off', 622, 118, { size: 11, weight: 800, color: '#f87171' });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Bonding wires fitted', value: S.bond, onChange: (v) => ((S.bond = v), (S.tf = 0)) });
    const fb = EM.button(
      c,
      '⚡ Create a fault',
      () => {
        if (S.fault) {
          S.fault = false;
          S.tripped = false;
          S.tf = 0;
          fb.innerHTML = '⚡ Create a fault';
        } else {
          S.fault = true;
          S.tf = 0;
          fb.innerHTML = 'Repair fault & reset breaker';
        }
      },
      'primary'
    );
    const ro = EM.readout(el, [
      { key: 'a', label: 'Hot pipe' },
      { key: 'b', label: 'Cold pipe' },
      { key: 'pd', label: 'p.d. across person' },
      { key: 'ip', label: 'Current through person' },
      { key: 'br', label: 'Breaker' },
    ]);
    const st = EM.status(el);
    EM.every(150, () => {
      const r = calc();
      ro.set('a', EM.fmt(r.VA, 2) + ' V');
      ro.set('b', EM.fmt(r.VB, 2) + ' V');
      ro.set('pd', EM.fmt(Math.abs(r.VA - r.VB), 2) + ' V');
      ro.set('ip', r.Ip ? Math.round(r.Ip * 1000) + ' mA' : '0');
      ro.set('br', S.tripped ? 'tripped (off)' : 'on');
      if (!S.fault) st.set('Everything is normal: all the metal pipes are at 0 V. Press “Create a fault” — the immersion heater’s live element touches the cylinder.');
      else if (S.tripped) st.set('<strong>Safe.</strong> The bonding gave the fault current a low-impedance path back to the source, so a large current flowed and the breaker tripped. Both pipes were at the same potential, so no current went through the person.', 'good');
      else if (S.bond) st.set('Bonded: both pipes are joined to earth, so they are at the <strong>same potential</strong> — no p.d. across the person. A huge fault current flows through the bonding wire…', 'good');
      else st.set('<strong>Danger!</strong> Without bonding the hot pipe is at 230 V and the cold pipe at 0 V. The person becomes the path of equalisation. The current (~230 mA) is far too small to trip the breaker.', 'bad');
    });
  }

  /* ------------------------------------------------------------ sim: double insulation */

  function simDoubleInsulation(el) {
    const S = { mode: 'double', depth: 0.6 };
    const PX = 18; // px per mm
    EM.canvas(el, {
      width: 700,
      height: 250,
      label: 'Cross-section of a cable being damaged by a blade',
      draw(ctx, sim) {
        const dbl = S.mode === 'double';
        const surface = dbl ? 70 : 94;
        const tip = surface + S.depth * PX;
        const exposed = tip >= 112;
        D.text(ctx, 'Cable cross-section', 255, 16, { size: 13, weight: 700, color: C.muted });
        if (dbl) rect(ctx, 150, 70, 210, 120, '#e5e7eb', '#94a3b8', 2, 58);
        circle(ctx, 210, 130, 36, LIVE, '#78350f', 1.5);
        circle(ctx, 300, 130, 36, NEU, '#1e3a8a', 1.5);
        circle(ctx, 210, 130, 18, '#d97706', '#92400e', 1.5);
        circle(ctx, 300, 130, 18, '#d97706', '#92400e', 1.5);
        // cut wedge
        ctx.save();
        ctx.fillStyle = DARK;
        ctx.beginPath();
        ctx.moveTo(196, 40);
        ctx.lineTo(224, 40);
        ctx.lineTo(210, tip);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // blade
        ctx.save();
        const g = ctx.createLinearGradient(196, 0, 224, 0);
        g.addColorStop(0, '#94a3b8');
        g.addColorStop(0.5, '#f1f5f9');
        g.addColorStop(1, '#64748b');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(194, tip - 60);
        ctx.lineTo(226, tip - 60);
        ctx.lineTo(210, tip);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        D.text(ctx, 'blade / nail', 236, tip - 48, { size: 11, color: C.text, align: 'left' });
        if (exposed) {
          ctx.save();
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 18;
          circle(ctx, 210, 130, 18, null, '#ef4444', 3);
          ctx.restore();
          D.text(ctx, '⚠ live copper reached!', 255, 222, { size: 14, weight: 800, color: '#f87171' });
        } else D.text(ctx, '✓ copper still covered by insulation', 255, 222, { size: 14, weight: 700, color: C.good });
        // leader labels
        const lab = (txt, x, y, tx, ty) => {
          D.line(ctx, x, y, tx, ty, 'rgba(148,163,184,0.7)', 1);
          D.text(ctx, txt, x - 4, y, { size: 11, color: C.text, align: 'right' });
        };
        if (dbl) lab('outer sheath (2nd layer)', 140, 60, 168, 80);
        lab('inner insulation', 140, 106, 180, 114);
        lab('copper conductor', 140, 146, 196, 136);
        D.text(ctx, 'live (brown)', 210, 182 + (dbl ? 18 : 0), { size: 10, color: C.muted });
        D.text(ctx, 'neutral (blue)', 300, 182 + (dbl ? 18 : 0), { size: 10, color: C.muted });
        // symbol
        rect(ctx, 520, 70, 76, 76, null, '#e2e8f0', 3);
        rect(ctx, 536, 86, 44, 44, null, '#e2e8f0', 3);
        D.text(ctx, 'double-insulation symbol', 558, 166, { size: 12, color: C.text });
        D.text(ctx, '(on the appliance’s label)', 558, 184, { size: 11, color: C.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Cable',
      options: [
        { value: 'single', label: 'Single layer' },
        { value: 'double', label: 'Double insulated' },
      ],
      value: S.mode,
      onChange: (v) => (S.mode = v),
    });
    EM.slider(c, { label: 'Depth of damage', min: 0, max: 2.6, step: 0.1, value: S.depth, unit: 'mm', fmt: (v) => v.toFixed(1), onInput: (v) => (S.depth = v) });
    const st = EM.status(el);
    EM.every(150, () => {
      const need = S.mode === 'double' ? (112 - 70) / PX : (112 - 94) / PX;
      st.set(
        S.depth * PX + (S.mode === 'double' ? 70 : 94) >= 112
          ? `The damage has gone through all the insulation (${need.toFixed(1)} mm here). ${S.mode === 'single' ? 'Switch to double insulation and try again.' : ''}`
          : `Damage must go deeper than <strong>${need.toFixed(1)} mm</strong> to reach the copper. Two layers give greater resistance to penetration and are more durable.`,
        S.depth * PX + (S.mode === 'double' ? 70 : 94) >= 112 ? 'bad' : 'good'
      );
    });
  }

  /* ------------------------------------------------------------ sim: fuse box (MCB + RCD) */

  function simFuseBox(el) {
    const S = { I: 10, leak: 0, main: true, rcd: true, mcb: true, heat: 0, test: 0 };
    const MCBS = [
      { x: 236, rating: 'B6', name: 'Lights' },
      { x: 320, rating: 'B16', name: 'Sockets', live: true },
      { x: 404, rating: 'B20', name: 'Cooker' },
      { x: 488, rating: 'B16', name: 'Immersion' },
      { x: 572, rating: 'B10', name: 'Shower pump' },
    ];
    const powered = () => S.main && S.rcd;
    function step(dt) {
      if (!powered() || !S.mcb) {
        S.heat = Math.max(0, S.heat - dt * 0.5);
        return;
      }
      if (S.I >= 80) S.mcb = false; // magnetic (instant) trip on a short circuit
      else if (S.I > 16) {
        S.heat += (dt * ((S.I / 16) ** 2 - 1)) / 3; // thermal trip: bigger overload → faster
        if (S.heat >= 1) S.mcb = false;
      } else S.heat = Math.max(0, S.heat - dt * 0.5);
      if (S.leak >= 30) S.rcd = false;
      if (!S.mcb) S.heat = 0;
    }
    function hitDevice(p) {
      if (p.y < 44 || p.y > 168) return null;
      if (p.x > 36 && p.x < 116) return 'main';
      if (p.x > 136 && p.x < 212) return 'rcd';
      if (p.x > 320 && p.x < 384) return 'mcb';
      return null;
    }
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Fuse box with main switch, RCD and MCBs',
      cursor: 'pointer',
      onDown(p) {
        const k = hitDevice(p);
        if (k === 'main') S.main = !S.main;
        if (k === 'rcd') {
          if (!S.rcd) S.rcd = true;
          else if (p.y < 70 && p.x > 158 && p.x < 190) S.rcd = false; // TEST button
        }
        if (k === 'mcb' && !S.mcb) S.mcb = true;
      },
      draw(ctx, sim, dt) {
        step(dt);
        const on = powered();
        rect(ctx, 20, 20, 680, 172, '#e2e8f0', '#94a3b8', 2, 10);
        D.text(ctx, 'FUSE BOX (consumer unit)', 34, 32, { size: 11, weight: 800, color: '#334155', align: 'left' });
        breaker(ctx, 46, 48, 60, 100, S.main, { body: '#fecaca', lever: '#dc2626', outline: '#dc2626' });
        D.text(ctx, 'MAIN', 76, 162, { size: 11, weight: 800, color: '#b91c1c' });
        D.text(ctx, 'SWITCH', 76, 176, { size: 11, weight: 800, color: '#b91c1c' });
        breaker(ctx, 140, 48, 68, 100, S.rcd, { outline: '#16a34a' });
        circle(ctx, 174, 60, 7, '#facc15', '#a16207', 1.5);
        D.text(ctx, 'T', 174, 60, { size: 9, weight: 800, color: '#713f12' });
        D.text(ctx, 'RCD', 174, 162, { size: 12, weight: 800, color: '#15803d' });
        D.text(ctx, '30 mA', 174, 176, { size: 10, color: '#15803d' });
        for (const m of MCBS) {
          const isOn = m.live ? S.mcb : true;
          breaker(ctx, m.x, 48, 60, 100, isOn, { outline: m.live ? '#2563eb' : null });
          D.text(ctx, m.rating, m.x + 30, 162, { size: 11, weight: 800, color: '#1d4ed8' });
          D.text(ctx, m.name, m.x + 30, 176, { size: 10, color: '#334155' });
          if (!on) rect(ctx, m.x, 48, 60, 100, 'rgba(15,23,42,0.25)', null, 0, 4);
        }
        D.text(ctx, 'MCBs', 404, 32 + 0, { size: 11, weight: 800, color: '#1d4ed8' });
        if (S.heat > 0.02 && S.mcb) {
          ctx.save();
          ctx.globalAlpha = Math.min(0.7, S.heat);
          rect(ctx, 320, 48, 60, 100, null, '#f97316', 4, 4);
          ctx.restore();
        }
        // gauges
        const live = on && S.mcb;
        const I = live ? S.I : 0;
        const leak = live ? S.leak : 0;
        const gauge = (y, label, val, max, mark, markLabel, unit, extra) => {
          const x0 = 210,
            w = 470;
          D.text(ctx, label, 20, y, { size: 12, align: 'left', color: C.text });
          rect(ctx, x0, y - 8, w, 16, '#1e293b', '#475569', 1, 4);
          const fw = (EM.clamp(val, 0, max) / max) * w;
          if (fw > 0) rect(ctx, x0, y - 8, fw, 16, val > mark ? '#f97316' : '#22c55e', null, 0, 4);
          const mx = x0 + (mark / max) * w;
          D.line(ctx, mx, y - 13, mx, y + 13, '#fde047', 2);
          D.text(ctx, markLabel, mx, y + 22, { size: 10, color: '#fde047' });
          if (extra) {
            const ex = x0 + (extra.v / max) * w;
            D.line(ctx, ex, y - 13, ex, y + 13, '#f87171', 2);
            D.text(ctx, extra.label, ex, y + 22, { size: 10, color: '#f87171' });
          }
          D.text(ctx, EM.fmtText(val) + ' ' + unit, x0 + w + 6, y, { size: 11, align: 'left', color: C.text });
        };
        gauge(220, 'Sockets circuit current', I, 100, 16, '16 A rating', 'A', { v: 80, label: 'instant trip' });
        gauge(268, 'Live − neutral (leakage)', leak, 100, 30, '30 mA', 'mA');
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Current drawn on the sockets circuit', min: 0, max: 100, step: 1, value: S.I, unit: 'A', onInput: (v) => (S.I = v) });
    EM.slider(c, { label: 'Current leaking to earth (e.g. through a person)', min: 0, max: 100, step: 1, value: S.leak, unit: 'mA', onInput: (v) => (S.leak = v) });
    EM.button(c, 'Press RCD “TEST”', () => (S.rcd = false));
    EM.button(
      c,
      'Reset tripped devices',
      () => {
        S.rcd = true;
        S.mcb = true;
        S.main = true;
        S.heat = 0;
      },
      'primary'
    );
    const ro = EM.readout(el, [
      { key: 'mcb', label: 'Sockets MCB (B16)' },
      { key: 'rcd', label: 'RCD (30 mA)' },
      { key: 'sock', label: 'Sockets' },
    ]);
    const st = EM.status(el);
    EM.every(150, () => {
      ro.set('mcb', S.mcb ? (S.heat > 0.02 ? 'warming… ' + Math.round(S.heat * 100) + '%' : 'on') : 'TRIPPED');
      ro.set('rcd', S.rcd ? 'on' : 'TRIPPED');
      const live = S.main && S.rcd && S.mcb;
      ro.set('sock', live ? 'live' : 'off');
      if (!S.main) st.set('The main switch is off — the whole house is disconnected.');
      else if (!S.rcd) st.set('<strong>RCD tripped.</strong> It switched off very quickly because the live and neutral currents were not equal — some current was leaking down an unintended path (e.g. through a person). Remove the leak, then reset.', 'bad');
      else if (!S.mcb) st.set('<strong>MCB tripped</strong> to protect the wiring from too much current. Unlike a fuse it doesn’t need replacing — reduce the load and just switch it back on.', 'bad');
      else if (S.heat > 0.02) st.set('Overload! The MCB’s current is above its 16 A rating — it is heating up and will trip soon (a bigger overload trips it faster).', 'warn');
      else st.set('Normal. Try overloading the sockets circuit (over 16 A), a short circuit (80 A +), or a leak of 30 mA or more. Click a tripped lever to reset it; the yellow T button on the RCD is its test button.', 'good');
    });
  }

  /* ------------------------------------------------------------ chapter */

  EM.chapter({
    id: 'c3',
    code: 'C.3',
    title: 'Heating Effects of an Electric Current',
    color: ACC,
    blurb: 'Joule heating, Joule’s law (P = I²R), heating water with mcΔθ = I²Rt, why the grid uses high voltage, and how fuses, earthing, bonding, MCBs and RCDs keep us safe.',

    terms: [
      { id: 'joule-heating', term: 'Joule heating (resistive heating)', def: 'The heating effect of an electric current: when a current flows through a resistance, electrical energy is converted to heat energy.' },
      { id: 'joules-law', term: 'Joule’s law', def: 'The heat produced in a fixed time for a given resistance is proportional to the current squared (heat ∝ I², so P = I²R).' },
      { id: 'empirical', term: 'Empirical', def: 'Obtained purely by experiment rather than theoretically. Joule found his law empirically.' },
      { id: 'power', term: 'Power', def: 'The rate of doing work: power = work done ÷ time taken, P = W/t. Unit: the watt (W), 1 W = 1 J s⁻¹.' },
      { id: 'fuse', term: 'Fuse', def: 'A short length of wire with a very low melting point. If the current becomes too large for an appliance, the fuse in the plug melts, breaking the circuit.' },
      { id: 'live', term: 'Live wire (brown)', def: 'Always connected to the fuse. Its voltage alternates between +220 V and −220 V (notes’ values), changing 100 times a second.' },
      { id: 'neutral', term: 'Neutral wire (blue)', def: 'Technically said to be at 0 V (but may not be). It completes the circuit by giving a safe return path for current back to the source (panel/transformer) after passing through an appliance.' },
      { id: 'earth-wire', term: 'Earth wire (green/yellow)', def: 'Provides a low-resistance path to the ground for fault currents, which helps prevent electric shocks.' },
      { id: 'bonding', term: 'Electrical bonding', def: 'Joining two electrical conductors together (two wires, or a wire and a pipe) so that all metal parts not meant to carry current are at the same electrical potential.' },
      { id: 'double-insulation', term: 'Double insulation', def: 'Using two or more layers of insulation. It gives greater resistance to penetration than a single layer and is more durable.' },
      { id: 'mcb', term: 'MCB (miniature circuit breaker)', def: 'A mechanical alternative to a fuse, installed in the fuse box, that protects a circuit from damage by too much current or short circuits. When tripped it is reset, not replaced.' },
      { id: 'rcd', term: 'RCD (residual current device)', def: 'A device for human safety, installed in the fuse box, that detects an imbalance between the live and neutral currents and switches the circuit off very quickly.' },
    ],

    formulas: [
      {
        id: 'power',
        name: 'Power = work done ÷ time',
        display: `<var>P</var> = ${EM.frac('<var>W</var>', '<var>t</var>')}`,
        vars: [
          { sym: 'P', label: 'P', name: 'Power', unit: 'W', value: 3000 },
          { sym: 'W', label: 'W', name: 'Work done (energy transferred)', unit: 'J', value: 360000 },
          { sym: 't', label: 't', name: 'Time taken', unit: 's', value: 120 },
        ],
        solve: { P: (v) => v.W / v.t, W: (v) => v.P * v.t, t: (v) => v.W / v.P },
        notes: 'Power is the <em>rate</em> of doing work. 1 watt = 1 joule per second. Rearranged: W = P × t.',
        example: { q: 'A kettle does 360 000 J of work heating water in 2 minutes. What is its power?', a: 't = 2 × 60 = 120 s. P = W ÷ t = 360 000 ÷ 120 = <strong>3000 W (3 kW)</strong>.' },
      },
      {
        id: 'p-vi',
        name: 'Electrical power P = VI',
        display: `<var>P</var> = <var>V</var> × <var>I</var>`,
        vars: [
          { sym: 'P', label: 'P', name: 'Power', unit: 'W', value: 2300 },
          { sym: 'V', label: 'V', name: 'Voltage (potential difference)', unit: 'V', value: 230 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 10 },
        ],
        solve: { P: (v) => v.V * v.I, V: (v) => v.P / v.I, I: (v) => v.P / v.V },
        notes: 'Works for any electrical device. For a fixed power, a bigger voltage means a smaller current — the key to high-voltage transmission.',
        derivation: [`P = ${EM.frac('W', 't')} (power = work done ÷ time taken)`, `V = ${EM.frac('W', 'q')} &nbsp;⇒&nbsp; W = Vq`, `Combine: P = ${EM.frac('Vq', 't')}`, `Substitute I = ${EM.frac('q', 't')}: <strong>P = V × I</strong>`],
        example: { q: 'A hair dryer on 230 V mains draws a current of 8 A. Find its power.', a: 'P = VI = 230 × 8 = <strong>1840 W</strong>.' },
      },
      {
        id: 'p-i2r',
        name: 'Joule’s law: P = I²R',
        display: `<var>P</var> = <var>I</var><sup>2</sup><var>R</var>`,
        vars: [
          { sym: 'P', label: 'P', name: 'Power (heat produced per second)', unit: 'W', value: 200 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 2 },
          { sym: 'R', label: 'R', name: 'Resistance', unit: 'Ω', value: 50 },
        ],
        solve: { P: (v) => v.I * v.I * v.R, I: (v) => Math.sqrt(v.P / v.R), R: (v) => v.P / (v.I * v.I) },
        notes: 'P ∝ I² for a fixed resistance: double the current → four times the heat. That’s why currents must be carefully controlled to avoid damage, fires and wasted energy.',
        derivation: ['Joule’s law: P ∝ I²', 'P = V × I and Ohm’s law V = I × R', 'Substitute: P = (I × R) × I', '<strong>P = I²R</strong>'],
        example: { q: 'A current of 2 A flows through a 50 Ω resistor. Find the power. What happens if the current is doubled?', a: 'P = I²R = 2² × 50 = <strong>200 W</strong>. At 4 A: P = 4² × 50 = <strong>800 W</strong> — four times as much.' },
      },
      {
        id: 'w-i2rt',
        name: 'Heat produced in a resistor: W = I²Rt',
        display: `<var>W</var> = <var>I</var><sup>2</sup><var>R</var><var>t</var>`,
        vars: [
          { sym: 'W', label: 'W', name: 'Heat energy produced (work done)', unit: 'J', value: 54000 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 3 },
          { sym: 'R', label: 'R', name: 'Resistance', unit: 'Ω', value: 20 },
          { sym: 't', label: 't', name: 'Time', unit: 's', value: 300 },
        ],
        solve: { W: (v) => v.I * v.I * v.R * v.t, I: (v) => Math.sqrt(v.W / (v.R * v.t)), R: (v) => v.W / (v.I * v.I * v.t), t: (v) => v.W / (v.I * v.I * v.R) },
        notes: 'The work done here is the heat energy W generated when a current flows through a resistor. Time must be in seconds.',
        derivation: [`P = ${EM.frac('W', 't')} rearranges to W = P × t`, 'Substitute P = I²R', '<strong>W = I²Rt</strong>'],
        example: { q: 'A current of 3 A flows through a 20 Ω heating element for 5 minutes. How much heat is produced?', a: 't = 5 × 60 = 300 s. W = I²Rt = 3² × 20 × 300 = <strong>54 000 J (54 kJ)</strong>.' },
      },
      {
        id: 'mc-i2rt',
        name: 'Electrical heating of a substance: mcΔθ = I²Rt',
        display: `<var>m</var><var>c</var>Δ<var>θ</var> = <var>I</var><sup>2</sup><var>R</var><var>t</var>`,
        vars: [
          { sym: 'm', label: 'm', name: 'Mass of substance heated', unit: 'kg', value: 0.5 },
          { sym: 'c', label: 'c', name: 'Specific heat capacity', unit: 'J kg<sup>−1</sup> K<sup>−1</sup>', value: 4180 },
          { sym: 'dT', label: 'Δθ', name: 'Rise in temperature', unit: '°C (or K)', value: 17.22 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 2 },
          { sym: 'R', label: 'R', name: 'Resistance of heater', unit: 'Ω', value: 30 },
          { sym: 't', label: 't', name: 'Time', unit: 's', value: 300 },
        ],
        solve: {
          dT: (v) => (v.I * v.I * v.R * v.t) / (v.m * v.c),
          c: (v) => (v.I * v.I * v.R * v.t) / (v.m * v.dT),
          m: (v) => (v.I * v.I * v.R * v.t) / (v.c * v.dT),
          I: (v) => Math.sqrt((v.m * v.c * v.dT) / (v.R * v.t)),
          R: (v) => (v.m * v.c * v.dT) / (v.I * v.I * v.t),
          t: (v) => (v.m * v.c * v.dT) / (v.I * v.I * v.R),
        },
        notes: 'Heat gained by the substance (E = mcΔθ, from Strand 2) = heat produced by the current (W = I²Rt). Use it to find (a) the temperature rise, (b) the specific heat capacity, or (c) the current or resistance needed to heat a mass in a given time. Assumes no heat is lost to the surroundings. Water: c = 4180 J kg⁻¹ K⁻¹.',
        derivation: ['Heat produced by the current: W = I²Rt', 'Heat gained by the substance: E = mcΔθ', 'Work done is energy transferred, so W = E', '<strong>mcΔθ = I²Rt</strong>'],
        example: {
          q: '(a) A 30 Ω heater carrying 2 A is placed in 0.5 kg of water (c = 4180 J kg⁻¹ K⁻¹) for 5 minutes. Find the rise in temperature. (c) What current would give a 30 °C rise in the same time?',
          a: '(a) I²Rt = 2² × 30 × 300 = 36 000 J. Δθ = 36 000 ÷ (0.5 × 4180) = <strong>17.2 °C</strong>.<br>(c) I = √(mcΔθ ÷ Rt) = √(0.5 × 4180 × 30 ÷ (30 × 300)) = √6.97 = <strong>2.64 A</strong>.',
        },
      },
      {
        id: 'mc-vit',
        name: 'Measuring specific heat capacity: mcΔθ = VIt',
        display: `<var>m</var><var>c</var>Δ<var>θ</var> = <var>V</var><var>I</var><var>t</var>`,
        vars: [
          { sym: 'm', label: 'm', name: 'Mass of substance', unit: 'kg', value: 0.2 },
          { sym: 'c', label: 'c', name: 'Specific heat capacity', unit: 'J kg<sup>−1</sup> K<sup>−1</sup>', value: 4186 },
          { sym: 'dT', label: 'Δθ', name: 'Rise in temperature', unit: '°C (or K)', value: 25.8 },
          { sym: 'V', label: 'V', name: 'Voltage across heater', unit: 'V', value: 12 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 3 },
          { sym: 't', label: 't', name: 'Time', unit: 's', value: 600 },
        ],
        solve: {
          c: (v) => (v.V * v.I * v.t) / (v.m * v.dT),
          dT: (v) => (v.V * v.I * v.t) / (v.m * v.c),
          m: (v) => (v.V * v.I * v.t) / (v.c * v.dT),
          V: (v) => (v.m * v.c * v.dT) / (v.I * v.t),
          I: (v) => (v.m * v.c * v.dT) / (v.V * v.t),
          t: (v) => (v.m * v.c * v.dT) / (v.V * v.I),
        },
        notes: 'Use (b) in the notes: measure current, voltage, time and temperature rise to find c. It follows from the notes’ formulas: I²Rt = (IR) × I × t = VIt, since V = IR.',
        derivation: ['W = I²Rt = (I × R) × I × t', 'V = IR, so W = VIt', 'Set equal to the heat gained: <strong>mcΔθ = VIt</strong>'],
        example: { q: '(b) A 12 V heater draws 3 A and warms 0.2 kg of water by 25.8 °C in 10 minutes. Find the specific heat capacity of water.', a: 'VIt = 12 × 3 × 600 = 21 600 J. c = 21 600 ÷ (0.2 × 25.8) = <strong>≈ 4186 J kg⁻¹ K⁻¹</strong>.' },
      },
      {
        id: 'p-loss',
        name: 'Transmission line heat loss',
        display: `<var>P</var><sub>loss</sub> = <var>I</var><sup>2</sup><var>R</var> = ${EM.frac('<var>P</var>', '<var>V</var>')}<sup>2</sup> <var>R</var>`,
        vars: [
          { sym: 'L', label: 'P<sub>loss</sub>', name: 'Power wasted as heat in the line', unit: 'W', value: 500 },
          { sym: 'P', label: 'P', name: 'Power being transmitted', unit: 'W', value: 1e6 },
          { sym: 'V', label: 'V', name: 'Transmission voltage', unit: 'V', value: 1e5 },
          { sym: 'R', label: 'R', name: 'Resistance of the line', unit: 'Ω', value: 5 },
        ],
        solve: {
          L: (v) => (v.P / v.V) ** 2 * v.R,
          P: (v) => v.V * Math.sqrt(v.L / v.R),
          V: (v) => v.P * Math.sqrt(v.R / v.L),
          R: (v) => (v.L * v.V * v.V) / (v.P * v.P),
        },
        notes: 'This follows from the notes’ reasoning: the line current is I = P ÷ V (from P = VI) and the heat wasted in the line is I²R (Joule’s law). Raise V ×10 → I ÷10 → loss ÷100.',
        derivation: ['For a fixed power P = VI, the line current is I = P ÷ V', 'Heat wasted in the line (Joule’s law): P<sub>loss</sub> = I²R', '<strong>P<sub>loss</sub> = (P ÷ V)² R</strong>'],
        example: { q: '1 MW is sent along a line of resistance 5 Ω. Compare the heat loss at 10 kV and 100 kV.', a: 'At 10 kV: I = 10⁶ ÷ 10⁴ = 100 A, loss = 100² × 5 = <strong>50 000 W</strong> (5%).<br>At 100 kV: I = 10 A, loss = 10² × 5 = <strong>500 W</strong> (0.05%) — 100 times less.' },
      },
    ],

    experiments: [
      {
        id: 'joules-law-calorimeter',
        title: 'Virtual investigation: Joule’s law (heating water with a coil)',
        aim: 'To show that the heat produced in a fixed time by a given resistance is proportional to the current squared (Δθ ∝ I²).',
        apparatus: ['Heating coil (R = 6 Ω)', 'Lagged calorimeter with 0.20 kg of water', 'Thermometer', 'Stirrer', 'Variable DC supply / rheostat', 'Ammeter', 'Stopwatch'],
        steps: [
          'Put a known mass of cold water in the lagged calorimeter with the heating coil fully covered. Note the starting temperature.',
          'Switch on and adjust the supply (rheostat) so the ammeter reads a chosen current I. Keep it steady.',
          'Heat for a fixed time (3 minutes), stirring, then record the rise in temperature Δθ.',
          'Repeat with fresh cold water for several different currents, keeping the time and resistance the same.',
          'Plot a graph of Δθ against I² (and, for comparison, Δθ against I).',
        ],
        result: 'The graph of Δθ against I² is a straight line through the origin; Δθ against I is a curve.',
        conclusion: 'Δθ ∝ heat produced, so heat ∝ I² for a fixed resistance and time — Joule’s law. The same data give the specific heat capacity using mcΔθ = I²Rt.',
        sim(el) {
          const m = 0.2,
            c = 4180,
            R = 6,
            T = 180,
            th0 = 15;
          const k = (R * T) / (m * c); // °C per A²
          const S = { I: 2, running: false, el: 0, runI: 2, theta: th0, pts: [], mode: 'I2', queue: [], last: null, rate: 40 };
          function start(I) {
            S.runI = I;
            S.el = 0;
            S.theta = th0;
            S.running = true;
          }
          function fit() {
            let sxy = 0,
              sxx = 0;
            for (const [I, d] of S.pts) {
              sxy += I * I * d;
              sxx += I ** 4;
            }
            return sxx ? sxy / sxx : 0;
          }
          EM.canvas(el, {
            width: 700,
            height: 360,
            label: 'Calorimeter with heating coil, thermometer and graph of temperature rise',
            draw(ctx, sim, dt) {
              if (!S.running && S.queue.length) {
                S.rate = 160;
                start(S.queue.shift());
              }
              if (S.running) {
                S.el += dt * S.rate;
                if (S.el >= T) {
                  S.el = T;
                  S.running = false;
                  const noise = 1 + (Math.random() - 0.5) * 0.03;
                  const d = Math.round(k * S.runI * S.runI * noise * 10) / 10;
                  S.theta = th0 + d;
                  S.pts = S.pts.filter((p) => p[0] !== S.runI);
                  S.pts.push([S.runI, d]);
                  S.last = { I: S.runI, d };
                } else S.theta = th0 + k * S.runI * S.runI * (S.el / T);
              }
              const heating = S.running;
              const temp = heating ? Math.min(1, (S.runI * S.runI * R) / 110) : 0;
              // supply + ammeter + wires
              rect(ctx, 30, 24, 80, 46, '#1e293b', '#64748b', 2, 6);
              D.text(ctx, 'DC supply', 70, 40, { size: 11, color: C.text });
              circle(ctx, 98, 58, 5, '#ef4444');
              circle(ctx, 50, 58, 5, '#111827', '#94a3b8', 1.5);
              pl(ctx, [[110, 47], [190, 47], [190, 150]], C.wire, 3);
              pl(ctx, [[50, 70], [50, 120], [150, 120], [150, 150]], C.wire, 3);
              if (heating) {
                D.flowDots(ctx, [[110, 47], [190, 47], [190, 150]], sim.t, { speed: 25 * S.runI });
                D.flowDots(ctx, [[150, 150], [150, 120], [50, 120], [50, 70]], sim.t, { speed: 25 * S.runI });
              }
              D.meter(ctx, 152, 47, (heating ? S.runI : 0) / 4, { r: 22, centerZero: false, label: 'A', reading: (heating ? S.runI.toFixed(2) : '0.00') + ' A' });
              // calorimeter
              rect(ctx, 110, 150, 140, 180, '#334155', '#64748b', 2, 6);
              D.text(ctx, 'lagging', 125, 316, { size: 9, color: C.muted, align: 'left' });
              rect(ctx, 124, 160, 112, 150, '#1e293b', '#b45309', 3, 4);
              rect(ctx, 127, 182, 106, 125, 'rgba(59,130,246,0.45)', null, 0, 3);
              // coil
              pl(ctx, [[150, 150], [150, 188]], C.wire, 2.5);
              coil(ctx, 150, 188, 150, 290, { n: 12, amp: 9, color: glow(temp), width: 3, glow: temp > 0.3 ? glow(temp) : null, blur: 12 });
              pl(ctx, [[150, 290], [150, 298], [190, 298], [190, 150]], C.wire, 2.5);
              if (heating) shimmer(ctx, 140, 186, 40, temp * 0.6, sim.t, 18);
              // thermometer
              const ty = (th) => 290 - ((th - 10) / 30) * 185;
              rect(ctx, 210, 95, 10, 205, 'rgba(255,255,255,0.85)', '#94a3b8', 1, 5);
              circle(ctx, 215, 304, 8, '#ef4444', '#94a3b8', 1);
              rect(ctx, 213, ty(S.theta), 4, 304 - ty(S.theta), '#ef4444', null);
              for (let th = 10; th <= 40; th += 10) {
                D.line(ctx, 220, ty(th), 226, ty(th), '#94a3b8', 1);
                D.text(ctx, String(th), 230, ty(th), { size: 9, color: C.muted, align: 'left' });
              }
              D.text(ctx, S.theta.toFixed(1) + ' °C', 226, 84, { size: 13, weight: 700, color: '#fca5a5', align: 'left' });
              // stopwatch
              circle(ctx, 300, 120, 24, '#f8fafc', '#64748b', 2);
              const a = -Math.PI / 2 + (S.el / 60) * Math.PI * 2;
              D.line(ctx, 300, 120, 300 + Math.cos(a) * 18, 120 + Math.sin(a) * 18, '#dc2626', 2);
              rect(ctx, 296, 90, 8, 6, '#64748b', null);
              D.text(ctx, Math.floor(S.el) + ' s', 300, 158, { size: 12, color: C.text, weight: 600 });
              D.text(ctx, 'Water 0.20 kg · coil R = 6 Ω · t = 3 min', 180, 346, { size: 11, color: C.muted });
              // graph
              const isI2 = S.mode === 'I2';
              const kf = S.pts.length >= 2 ? fit() : 0;
              const markers = S.pts.map(([I, d]) => ({ x: isI2 ? I * I : I, y: d, color: '#fde047', r: 4.5 }));
              if (S.running) markers.push({ x: isI2 ? S.runI ** 2 : S.runI, y: S.theta - th0, color: '#f97316', r: 5 });
              D.plot(ctx, { x: 400, y: 36, w: 285, h: 270 }, {
                xMin: 0,
                xMax: isI2 ? 16 : 4,
                yMin: 0,
                yMax: 25,
                xLabel: isI2 ? 'I² (A²)' : 'I (A)',
                yLabel: 'Δθ (°C)',
                title: isI2 ? 'Δθ against I²' : 'Δθ against I',
                series: kf ? [{ fn: (x) => (isI2 ? kf * x : kf * x * x), color: ACC, width: 2, dash: isI2 ? null : [6, 4], label: isI2 ? 'best-fit straight line' : 'curve (Δθ ∝ I²)' }] : [],
                markers,
              });
            },
          });
          const cc = EM.controls(el);
          EM.slider(cc, { label: 'Current I', min: 0.5, max: 4, step: 0.25, value: S.I, unit: 'A', fmt: (v) => v.toFixed(2), onInput: (v) => (S.I = v) });
          EM.button(
            cc,
            '▶ Heat for 3 minutes',
            () => {
              if (S.running) return;
              S.rate = 40;
              start(S.I);
            },
            'primary'
          );
          EM.button(cc, 'Auto: take 7 readings', () => {
            if (S.running) return;
            S.pts = [];
            S.queue = [1, 1.5, 2, 2.5, 3, 3.5, 4];
          });
          EM.button(cc, 'Clear results', () => {
            S.pts = [];
            S.queue = [];
            S.last = null;
          });
          EM.segmented(cc, {
            label: 'Plot',
            options: [
              { value: 'I2', label: 'Δθ vs I²' },
              { value: 'I', label: 'Δθ vs I' },
            ],
            value: S.mode,
            onChange: (v) => (S.mode = v),
          });
          const ro = EM.readout(el, [
            { key: 'i', label: 'Current I' },
            { key: 'i2', label: 'I²' },
            { key: 't', label: 'Time' },
            { key: 'd', label: 'Δθ' },
            { key: 'c', label: 'c = I²Rt ÷ mΔθ' },
          ]);
          const st = EM.status(el);
          EM.every(150, () => {
            const I = S.running ? S.runI : S.last ? S.last.I : S.I;
            ro.set('i', I.toFixed(2) + ' A');
            ro.set('i2', EM.fmt(I * I) + ' A²');
            ro.set('t', Math.floor(S.el) + ' s');
            ro.set('d', f1(S.theta - th0) + ' °C');
            ro.set('c', !S.running && S.last ? Math.round((S.last.I ** 2 * R * T) / (m * S.last.d)) + ' J kg⁻¹ K⁻¹' : '–');
            if (S.running) st.set(`Heating with I = ${S.runI.toFixed(2)} A… (time sped up)`);
            else if (S.pts.length < 2) st.set('Choose a current and heat for 3 minutes. Take readings at several currents (fresh cold water each time), or press Auto.');
            else st.set(S.mode === 'I2' ? `${S.pts.length} readings: Δθ against I² is a <strong>straight line through the origin</strong> → heat ∝ I² (Joule’s law). Switch the plot to Δθ vs I to compare.` : 'Δθ against I is a <strong>curve</strong> — doubling I gives four times the temperature rise.', 'good');
          });
        },
      },
      {
        id: 'transmission',
        title: 'Virtual investigation: why electricity is transmitted at high voltage',
        aim: 'To see how raising the transmission voltage reduces the current in the line and so reduces the I²R heat loss, for the same power delivered.',
        apparatus: ['Power station (generator)', 'Step-up transformer', 'Long transmission line (resistance R)', 'Step-down transformer', 'Town (the load)'],
        steps: [
          'Set the power the town needs (P) and the resistance of the line (R).',
          'Start with the generator’s own voltage (11 kV, no step-up). Note the line current I = P ÷ V and the heat lost, I²R.',
          'Raise the transmission voltage in steps (38 kV, 110 kV, 220 kV, 400 kV) and record the current and the loss each time.',
          'Compare: what happens to the loss when the voltage goes up ten times?',
        ],
        result: 'As V increases, I = P ÷ V falls, and the heat loss I²R falls even faster (with the square of the current). Raising V by ×10 reduces the loss by ×100.',
        conclusion: 'For a fixed power (P = VI), a bigger voltage means a smaller current, and a smaller current means less energy wasted as heat (Joule’s law). That’s why the national grid transmits at very high voltage.',
        sim(el) {
          const S = { V: 110e3, P: 10e6, R: 5 };
          const pyl = [230, 360, 490];
          const cable = [];
          (function build() {
            const pts = [[160, 196], [pyl[0], 132], [pyl[1], 132], [pyl[2], 132], [570, 196]];
            for (let i = 0; i < pts.length - 1; i++) {
              const [x1, y1] = pts[i],
                [x2, y2] = pts[i + 1];
              const sag = i === 0 || i === pts.length - 2 ? 8 : 22;
              for (let j = 0; j < 16; j++) {
                const f = j / 16;
                cable.push([x1 + (x2 - x1) * f, y1 + (y2 - y1) * f + sag * 4 * f * (1 - f)]);
              }
            }
            cable.push(pts[pts.length - 1]);
          })();
          function tx(ctx, x, label, active) {
            rect(ctx, x - 18, 196, 36, 54, '#1e293b', active ? '#a78bfa' : '#475569', 2, 4);
            coil(ctx, x - 8, 204, x - 8, 242, { n: 6, amp: 4, color: '#d97706', width: 2 });
            coil(ctx, x + 8, 204, x + 8, 242, { n: active ? 10 : 6, amp: 4, color: '#d97706', width: 2 });
            D.text(ctx, label, x, 268, { size: 11, color: active ? C.text : C.muted });
          }
          EM.canvas(el, {
            width: 720,
            height: 340,
            label: 'Power station, transformers, transmission line and town',
            draw(ctx, sim) {
              const t = sim.t;
              const I = S.P / S.V,
                loss = I * I * S.R,
                frac = Math.min(1, loss / S.P),
                deliv = S.P - loss;
              rect(ctx, 0, 250, 720, 4, '#334155', null);
              // power station
              rect(ctx, 18, 186, 84, 64, '#475569', '#94a3b8', 2, 3);
              rect(ctx, 72, 140, 16, 46, '#64748b', '#94a3b8', 1.5);
              for (let i = 0; i < 3; i++) {
                const ph = (t * 0.4 + i / 3) % 1;
                circle(ctx, 80 + ph * 22, 132 - ph * 50, 6 + ph * 8, `rgba(203,213,225,${0.5 * (1 - ph)})`);
              }
              D.text(ctx, 'generator', 60, 218, { size: 11, color: C.text });
              D.text(ctx, 'Power station', 60, 268, { size: 11, color: C.muted });
              pl(ctx, [[102, 222], [142, 222]], C.wire, 3);
              tx(ctx, 160, S.V > 11e3 ? 'step-up' : 'no step-up', S.V > 11e3);
              // pylons
              for (const x of pyl) {
                ctx.save();
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - 16, 250);
                ctx.lineTo(x - 4, 124);
                ctx.lineTo(x + 4, 124);
                ctx.lineTo(x + 16, 250);
                for (let y = 150; y < 250; y += 25) {
                  const w1 = 4 + ((y - 124) / 126) * 12;
                  const w2 = 4 + ((y + 25 - 124) / 126) * 12;
                  ctx.moveTo(x - w1, y);
                  ctx.lineTo(x + Math.min(16, w2), Math.min(250, y + 25));
                  ctx.moveTo(x + w1, y);
                  ctx.lineTo(x - Math.min(16, w2), Math.min(250, y + 25));
                }
                ctx.moveTo(x - 26, 128);
                ctx.lineTo(x + 26, 128);
                ctx.stroke();
                ctx.restore();
              }
              // cable
              ctx.save();
              if (frac > 0.04) {
                ctx.shadowColor = glow(0.3 + frac);
                ctx.shadowBlur = 6 + 20 * frac;
              }
              pl(ctx, cable, glow(frac > 0.004 ? 0.25 + frac * 1.1 : 0), 3);
              ctx.restore();
              D.flowDots(ctx, cable, t, { speed: EM.clamp(10 + I * 0.1, 10, 120), spacing: 18, r: 2.5 });
              for (let i = 0; i < pyl.length - 1; i++) shimmer(ctx, pyl[i] + 20, 132, pyl[i + 1] - pyl[i] - 40, EM.clamp(frac * 2.5, 0, 1), t, 40);
              D.text(ctx, `${S.V / 1000} kV   ·   line current I = ${EM.fmtText(I)} A`, 360, 72, { size: 14, weight: 700, color: '#fde047', bg: 'rgba(11,18,32,0.85)' });
              D.text(ctx, `heat lost in the line: ${si(loss, 'W')}`, 360, 96, { size: 12, color: frac > 0.05 ? '#fb923c' : C.muted });
              tx(ctx, 570, 'step-down', S.V > 11e3);
              pl(ctx, [[588, 222], [610, 222]], C.wire, 3);
              // town
              const b = deliv / S.P;
              for (const [x, w, hh] of [[612, 28, 34], [646, 30, 46], [682, 28, 30]]) {
                rect(ctx, x, 250 - hh, w, hh, '#334155', '#64748b', 1.5);
                ctx.save();
                ctx.fillStyle = '#475569';
                ctx.beginPath();
                ctx.moveTo(x - 3, 250 - hh);
                ctx.lineTo(x + w / 2, 250 - hh - 14);
                ctx.lineTo(x + w + 3, 250 - hh);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                for (let wy = 250 - hh + 8; wy < 244; wy += 13) {
                  rect(ctx, x + 5, wy, 7, 7, `rgba(253,224,71,${0.15 + 0.85 * b})`, null);
                  rect(ctx, x + w - 12, wy, 7, 7, `rgba(253,224,71,${0.15 + 0.85 * b})`, null);
                }
              }
              D.text(ctx, 'Town', 660, 268, { size: 11, color: C.muted });
              // energy bar
              const bx = 150,
                bw = 420;
              rect(ctx, bx, 292, bw, 18, '#1e293b', '#475569', 1, 4);
              rect(ctx, bx, 292, bw * (1 - frac), 18, '#22c55e', null, 0, 4);
              if (frac > 0.002) rect(ctx, bx + bw * (1 - frac), 292, Math.max(2, bw * frac), 18, '#f97316', null, 0, 2);
              D.text(ctx, `delivered ${EM.fmtText((1 - frac) * 100, 3)}%`, bx, 324, { size: 12, color: '#86efac', align: 'left' });
              D.text(ctx, `lost as heat ${EM.fmtText(frac * 100, 2)}%`, bx + bw, 324, { size: 12, color: '#fdba74', align: 'right' });
              D.text(ctx, 'Where the power goes:', bx - 8, 301, { size: 12, color: C.muted, align: 'right' });
            },
          });
          const cc = EM.controls(el);
          EM.segmented(cc, {
            label: 'Transmission voltage',
            options: [11e3, 38e3, 110e3, 220e3, 400e3].map((v) => ({ value: v, label: v / 1000 + ' kV' })),
            value: S.V,
            onChange: (v) => (S.V = v),
          });
          EM.slider(cc, { label: 'Power needed by the town P', min: 2, max: 10, step: 1, value: S.P / 1e6, unit: 'MW', onInput: (v) => (S.P = v * 1e6) });
          EM.slider(cc, { label: 'Line resistance R', min: 1, max: 10, step: 0.5, value: S.R, unit: 'Ω', onInput: (v) => (S.R = v) });
          const ro = EM.readout(el, [
            { key: 'i', label: 'Line current I = P/V' },
            { key: 'l', label: 'Heat loss I²R' },
            { key: 'f', label: 'Lost' },
            { key: 'd', label: 'Delivered' },
          ]);
          const st = EM.status(el);
          EM.every(150, () => {
            const I = S.P / S.V,
              loss = I * I * S.R;
            ro.set('i', EM.fmt(I) + ' A');
            ro.set('l', si(loss, 'W'));
            ro.set('f', EM.fmt((loss / S.P) * 100, 3) + ' %');
            ro.set('d', si(S.P - loss, 'W'));
            const r = S.V / 11e3;
            st.set(
              S.V === 11e3
                ? 'At the generator’s 11 kV the current is huge, so a big share of the power is wasted heating the line. Step the voltage up!'
                : `Compared with 11 kV, the voltage is ×${EM.fmt(r)} so the current is ÷${EM.fmt(r)} and the heat loss is ÷${EM.fmt(r * r)} (I²!). Same power, far less waste.`,
              S.V === 11e3 ? 'warn' : 'good'
            );
          });
        },
      },
      {
        id: 'safety-lab',
        title: 'Virtual investigation: the plug & fuse box safety lab',
        aim: 'To see how the fuse, earth wire, MCB, RCD and double insulation protect people and equipment when something goes wrong.',
        apparatus: ['Fuse box (main switch, RCD, MCB)', 'Socket and 3-pin plug with fuse', 'Live (brown), neutral (blue) and earth (green/yellow) wires', 'Metal-cased kettle / double-insulated appliance', 'Earth connection in the footpath'],
        steps: [
          'Choose “Normal use”: current flows out along the live, through the heating element, and back along the neutral. The live and neutral currents are equal.',
          '“Too much current”: introduce the fault and watch the fuse in the plug heat up and melt.',
          '“Short circuit”: the live touches the neutral. A huge current flows and the MCB trips. Reset it — no replacement needed.',
          '“Live touches metal case”: with the earth wire connected the fault current flows to earth and the protection cuts the power. Then disconnect the earth wire and try again, with and without an RCD.',
          '“Person touches live”: watch the RCD detect the imbalance between live and neutral and trip. Then remove the RCD.',
          '“Double-insulated”: the live touches an inner part but the outer case is insulated, so the person is safe without an earth wire.',
        ],
        result: 'Fuses and MCBs break the circuit when the current is too large; the earth wire carries fault currents safely to the ground; the RCD trips very quickly when current leaks through an unintended path (like a person); double insulation stops the case ever becoming live.',
        conclusion: 'Fuses and MCBs mainly protect the wiring and appliances from too much current. The RCD is designed for human safety — a shock current of a fraction of an amp is far too small to blow a 13 A fuse, but easily trips a 30 mA RCD.',
        sim(el) {
          const G = 372;
          const S = { scn: 'normal', earth: true, rcd: true, phase: 'idle', tf: 0, trip: {}, danger: false, fuseHeat: 0 };
          const SC = {
            normal: { label: 'Normal use', person: null },
            overload: { label: 'Too much current', person: null },
            short: { label: 'Short circuit', person: null },
            earth: { label: 'Live touches metal case', person: 'A' },
            touch: { label: 'Person touches live', person: 'B' },
            double: { label: 'Double-insulated', person: 'A' },
          };
          const isOn = () => !S.trip.fuse && !S.trip.mcb && !S.trip.rcd;
          function calc() {
            const on = isOn();
            if (!on) return { IL: 0, IN: 0, IE: 0, IP: 0, on };
            let IL = 8.7,
              IN = 8.7,
              IE = 0,
              IP = 0;
            if (S.phase === 'fault') {
              if (S.scn === 'overload') IL = IN = 20;
              else if (S.scn === 'short') IL = IN = 480;
              else if (S.scn === 'earth') {
                if (S.earth) {
                  IE = 230;
                  IL = IN + IE;
                } else {
                  IP = 0.23;
                  IL = IN + IP;
                }
              } else if (S.scn === 'touch') {
                IP = 0.23;
                IL = IN + IP;
              }
            }
            return { IL, IN, IE, IP, on };
          }
          function step(dt) {
            if (S.phase !== 'fault' || !isOn()) return;
            S.tf += dt;
            const sc = S.scn;
            if (sc === 'overload') {
              S.fuseHeat = Math.min(1, S.tf / 1.6);
              if (S.tf >= 1.6) S.trip.fuse = true;
            } else if (sc === 'short') {
              if (S.tf >= 0.3) S.trip.mcb = true;
            } else if (sc === 'earth' && S.earth) {
              if (S.rcd && S.tf >= 0.25) S.trip.rcd = true;
              else if (!S.rcd) {
                S.fuseHeat = Math.min(1, S.tf / 0.45);
                if (S.tf >= 0.45) S.trip.fuse = true;
              }
            } else if (sc === 'earth' || sc === 'touch') {
              if (S.rcd && S.tf >= 0.25) S.trip.rcd = true;
              else if (!S.rcd && S.tf >= 0.6) S.danger = true;
            }
          }
          function reset(keepScn) {
            S.phase = 'idle';
            S.tf = 0;
            S.trip = {};
            S.danger = false;
            S.fuseHeat = 0;
            if (!keepScn) S.scn = 'normal';
          }
          // current paths
          const P_LIVE = [[210, 70], [240, 70], [240, 190], [351, 190], [351, 240], [550, 240], [550, 270], [630, 270]];
          const P_NEUT = [[630, 270], [630, 215], [225, 215], [225, 100], [210, 100]];
          const P_SHORT = [[210, 70], [240, 70], [240, 190], [351, 190], [351, 240], [480, 240], [480, 215], [225, 215], [225, 100], [210, 100]];
          const P_LIVE_TO = (x) => [[210, 70], [240, 70], [240, 190], [351, 190], [351, 240], [x, 240]];
          const P_EARTHF = [[540, 240], [540, 300], [520, 300], [520, 190], [365, 190], [365, 240], [300, 240], [60, 240], [60, G + 16]];
          const HAND_A = [661, 262],
            HAND_B = [452, 243];
          const P_PERSON_A = [[540, 240], [540, 300], [660, 300], [660, 262], HAND_A, [694, 308], [694, 340], [694, G], [694, 380], [60, 380]];
          const P_PERSON_B = [[450, 240], HAND_B, [466, 276], [450, 308], [450, 340], [450, G], [450, 380], [60, 380]];
          const speed = (I) => (I > 100 ? 240 : 30 + 5 * Math.min(I, 30));
          EM.canvas(el, {
            width: 720,
            height: 400,
            label: 'Fuse box, socket, plug and appliance with fault scenarios',
            draw(ctx, sim, dt) {
              step(dt);
              const t = sim.t;
              const r = calc();
              const sc = S.scn;
              const dbl = sc === 'double';
              const fault = S.phase === 'fault';
              // ground
              rect(ctx, 0, G, 720, 400 - G, '#1c1917', null);
              D.text(ctx, 'ground', 700, 392, { size: 10, color: '#78716c', align: 'right' });
              // fuse box
              rect(ctx, 20, 14, 190, 136, '#e2e8f0', '#94a3b8', 2, 8);
              D.text(ctx, 'Fuse box', 115, 26, { size: 11, weight: 800, color: '#334155' });
              breaker(ctx, 30, 40, 46, 78, true, { body: '#fecaca', lever: '#dc2626' });
              if (S.rcd) breaker(ctx, 88, 40, 52, 78, !S.trip.rcd, { outline: '#16a34a' });
              else {
                rect(ctx, 88, 40, 52, 78, '#cbd5e1', '#94a3b8', 1, 4);
                D.text(ctx, 'none', 114, 79, { size: 10, color: '#64748b' });
              }
              breaker(ctx, 152, 40, 46, 78, !S.trip.mcb, { outline: '#2563eb' });
              D.text(ctx, 'Main', 53, 134, { size: 10, weight: 700, color: '#334155' });
              D.text(ctx, 'RCD', 114, 134, { size: 10, weight: 700, color: '#15803d' });
              D.text(ctx, 'MCB', 175, 134, { size: 10, weight: 700, color: '#1d4ed8' });
              // supply wiring (socket side: L 190, N 215, E 240)
              pl(ctx, [[210, 70], [240, 70], [240, 190], [300, 190]], LIVE, 4);
              pl(ctx, [[210, 100], [225, 100], [225, 215], [300, 215]], NEU, 4);
              earthWire(ctx, [[300, 240], [60, 240], [60, G + 22]]);
              earthWire(ctx, [[60, 150], [60, 240]]);
              rect(ctx, 54, G + 2, 12, 22, '#64748b', null);
              D.text(ctx, 'earth connection (in the footpath)', 74, G + 16, { size: 10, color: '#a8a29e', align: 'left' });
              D.text(ctx, 'L', 270, 182, { size: 11, weight: 700, color: LIVE });
              D.text(ctx, 'N', 270, 207, { size: 11, weight: 700, color: NEU });
              D.text(ctx, 'E', 270, 232, { size: 11, weight: 700, color: EG });
              // flex (L 240, N 215, E 190)
              pl(ctx, [[380, 240], [520, 240]], LIVE, 4);
              pl(ctx, [[380, 215], [520, 215]], NEU, 4);
              if (!dbl) {
                if (S.earth) earthWire(ctx, [[380, 190], [520, 190]]);
                else {
                  earthWire(ctx, [[380, 190], [458, 190]]);
                  earthWire(ctx, [[482, 190], [520, 190]]);
                  D.text(ctx, '✗ earth wire broken', 470, 174, { size: 11, weight: 700, color: '#f87171' });
                }
              }
              if (sc === 'touch') {
                rect(ctx, 440, 236, 20, 8, '#f59e0b', null, 0, 2);
                D.text(ctx, 'damaged insulation', 470, 258, { size: 10, color: '#fbbf24', align: 'left' });
              }
              // appliance
              if (dbl) {
                rect(ctx, 520, 140, 140, 160, '#1e293b', '#f8fafc', 3, 10);
                rect(ctx, 528, 148, 124, 144, null, '#f8fafc', 1.5, 8);
                rect(ctx, 538, 228, 104, 58, 'rgba(148,163,184,0.15)', '#64748b', 1.5, 4);
                D.text(ctx, 'Double-insulated (plastic case)', 590, 128, { size: 11, weight: 700, color: C.text });
                D.text(ctx, 'inner metal part', 590, 210, { size: 10, color: C.muted });
                D.text(ctx, '2-core flex: no earth', 450, 174, { size: 10, color: C.muted });
              } else {
                rect(ctx, 520, 140, 140, 160, '#334155', '#94a3b8', 3, 10);
                D.text(ctx, 'Kettle (metal case)', 590, 128, { size: 11, weight: 700, color: C.text });
                circle(ctx, 528, 190, 4, EY);
                D.text(ctx, 'earth to case', 590, 180, { size: 10, color: '#a3e635' });
              }
              const elemT = r.on ? (fault && sc === 'overload' ? 1 : 0.62) : 0;
              pl(ctx, [[520, 240], [550, 240], [550, 270]], LIVE, 3);
              pl(ctx, [[630, 270], [630, 215], [520, 215]], NEU, 3);
              coil(ctx, 550, 270, 630, 270, { n: 10, amp: 7, color: glow(elemT), width: 3, glow: elemT > 0.3 ? glow(elemT) : null, blur: 14 });
              D.text(ctx, 'heating element', 590, 290, { size: 10, color: C.muted });
              // fault markers
              if (fault) {
                if (sc === 'short') spark(ctx, 480, 240, 480, 215, t);
                if (sc === 'earth') spark(ctx, 540, 244, 540, 298, t);
                if (sc === 'double') spark(ctx, 550, 252, 560, 284, t);
                if (sc === 'overload') D.text(ctx, 'faulty appliance draws 20 A', 590, 156, { size: 10, weight: 700, color: '#fb923c' });
              }
              // current dots
              if (r.on) {
                if (fault && sc === 'short') D.flowDots(ctx, P_SHORT, t, { speed: speed(r.IL), spacing: 12, color: '#fde047' });
                else {
                  if (fault && (sc === 'earth' || sc === 'touch')) {
                    D.flowDots(ctx, P_LIVE, t, { speed: speed(r.IN) });
                    if (r.IE) {
                      D.flowDots(ctx, P_LIVE_TO(540), t, { speed: speed(r.IL), spacing: 12 });
                      D.flowDots(ctx, P_EARTHF, t, { speed: speed(r.IE), spacing: 12, color: '#a3e635' });
                    }
                  } else D.flowDots(ctx, P_LIVE, t, { speed: speed(r.IL) });
                  D.flowDots(ctx, P_NEUT, t, { speed: speed(r.IN) });
                  if (r.IP) D.flowDots(ctx, sc === 'touch' ? P_PERSON_B : P_PERSON_A, t, { speed: 40, spacing: 14, color: '#f87171' });
                }
              }
              // socket + plug (drawn over the wire transitions)
              rect(ctx, 296, 172, 26, 86, '#f1f5f9', '#94a3b8', 1.5, 3);
              rect(ctx, 322, 176, 58, 78, '#475569', '#94a3b8', 1.5, 8);
              D.text(ctx, 'socket', 309, 268, { size: 10, color: C.muted });
              D.text(ctx, 'plug', 351, 268, { size: 10, color: C.muted });
              // plug fuse on the live
              const blown = S.trip.fuse;
              rect(ctx, 330, 184, 8, 12, '#cbd5e1', null, 0, 2);
              rect(ctx, 364, 184, 8, 12, '#cbd5e1', null, 0, 2);
              rect(ctx, 338, 185, 26, 10, blown ? '#1f2937' : 'rgba(255,255,255,0.8)', '#94a3b8', 1, 2);
              if (blown) {
                D.line(ctx, 340, 190, 348, 188, '#64748b', 1.5);
                D.line(ctx, 354, 192, 362, 190, '#64748b', 1.5);
              } else D.line(ctx, 340, 190, 362, 190, S.fuseHeat > 0.05 ? glow(0.3 + S.fuseHeat * 0.7) : '#64748b', 2);
              D.text(ctx, blown ? 'fuse MELTED' : 'fuse', 351, 165, { size: 11, weight: 700, color: blown ? '#f87171' : C.text });
              // person
              const pType = SC[sc].person;
              if (pType === 'A') person(ctx, 694, G, { hand: HAND_A, shock: r.IP > 0 });
              if (pType === 'B') person(ctx, 450, G, { hand: HAND_B, elbow: [466, 276], shock: r.IP > 0 });
              if (S.danger) {
                const px = pType === 'B' ? 450 : 640;
                if (Math.sin(t * 10) > -0.3) D.text(ctx, '⚠ SHOCK — nothing has tripped!', px, 330, { size: 13, weight: 800, color: '#f87171', bg: 'rgba(11,18,32,0.9)' });
              }
              const tripped = Object.keys(S.trip).filter((k) => S.trip[k]);
              if (tripped.length) D.text(ctx, 'Power cut off by: ' + tripped.map((k) => k.toUpperCase()).join(' + '), 470, 58, { size: 14, weight: 800, color: '#86efac', bg: 'rgba(11,18,32,0.85)' });
            },
          });
          const cc = EM.controls(el);
          const seg = EM.segmented(cc, {
            label: 'Scenario',
            options: Object.keys(SC).map((k) => ({ value: k, label: SC[k].label })),
            value: S.scn,
            onChange: (v) => {
              reset(true);
              S.scn = v;
              faultBtn.disabled = v === 'normal';
            },
          });
          EM.toggle(cc, { label: 'Earth wire connected', value: S.earth, onChange: (v) => ((S.earth = v), reset(true)) });
          EM.toggle(cc, { label: 'RCD fitted', value: S.rcd, onChange: (v) => ((S.rcd = v), reset(true)) });
          const faultBtn = EM.button(
            cc,
            '⚡ Introduce the fault',
            () => {
              if (S.scn === 'normal' || S.phase === 'fault') return;
              S.phase = 'fault';
              S.tf = 0;
            },
            'primary'
          );
          faultBtn.disabled = true;
          EM.button(cc, 'Reset (replace fuse / reset breakers)', () => reset(true));
          void seg;
          const ro = EM.readout(el, [
            { key: 'l', label: 'Live current' },
            { key: 'n', label: 'Neutral current' },
            { key: 'e', label: 'Earth wire current' },
            { key: 'p', label: 'Through person' },
          ]);
          const st = EM.status(el);
          const A = (x) => (x ? (x >= 100 ? '≈ ' + Math.round(x) + ' A' : x.toFixed(x < 1 ? 2 : 1) + ' A') : '0');
          EM.every(150, () => {
            const r = calc();
            ro.set('l', A(r.IL));
            ro.set('n', A(r.IN));
            ro.set('e', A(r.IE));
            ro.set('p', r.IP ? Math.round(r.IP * 1000) + ' mA' : '0');
            const sc = S.scn,
              f = S.phase === 'fault';
            let msg = '',
              type = '';
            if (sc === 'normal') msg = 'Normal: current goes out on the live, through the element and back on the neutral — <strong>live current = neutral current</strong>, so the RCD stays on. 8.7 A is under the 13 A fuse rating.';
            else if (!f) msg = 'Press “Introduce the fault” to see what happens. (Events are slowed down — real protective devices act in a fraction of a second.)';
            else if (sc === 'overload') {
              if (S.trip.fuse) (msg = 'The 20 A current was too large for the 13 A fuse: the low-melting-point wire <strong>melted and broke the circuit</strong>. A blown fuse must be replaced.'), (type = 'good');
              else (msg = '20 A is more than the fuse’s 13 A rating — the fuse wire is heating up (P = I²R)…'), (type = 'warn');
            } else if (sc === 'short') {
              if (S.trip.mcb) (msg = 'The live touched the neutral, so a huge current flowed. The <strong>MCB tripped</strong> to protect the wiring. Live and neutral currents were equal, so the RCD didn’t need to act. Reset the MCB — no replacement needed.'), (type = 'good');
              else msg = 'Short circuit! Hundreds of amps…';
            } else if (sc === 'earth' && S.earth) {
              if (S.trip.rcd) (msg = 'The fault current took the <strong>low-resistance earth wire</strong> to the ground, not the person. Because the current wasn’t coming back on the neutral, the <strong>RCD</strong> saw the imbalance and tripped. (Turn the RCD off to see the fuse do the job.)'), (type = 'good');
              else if (S.trip.fuse) (msg = 'The earth wire carried a very large fault current straight to the ground, so the <strong>fuse melted</strong> and cut off the live. The case never stayed live — the person is safe.'), (type = 'good');
              else msg = 'Live touches the case: a large fault current flows down the earth wire…';
            } else if (sc === 'earth' || sc === 'touch') {
              if (S.trip.rcd) (msg = `Current leaked through the person to earth, so the live current was bigger than the neutral current. The <strong>RCD detected the imbalance</strong> and switched off very quickly.`), (type = 'good');
              else if (S.danger) (msg = `<strong>Danger!</strong> About 230 mA flows through the person — enough to kill — but the total current (${A(r.IL)}) is well under 13 A, so the fuse and MCB do nothing. Only an RCD would save them.`), (type = 'bad');
              else (msg = sc === 'earth' ? 'With no earth wire the case is at mains voltage, and the person touching it becomes the path to earth…' : 'The person touches the exposed live wire…'), (type = 'warn');
            } else if (sc === 'double') (msg = 'The live has touched an inner part, but there are two layers of insulation between it and the outer plastic case. <strong>The case can’t become live</strong>, so no earth wire is needed and the person is safe.'), (type = 'good');
            st.set(msg, type);
          });
        },
      },
    ],

    topics: [
      {
        id: 'effects',
        title: 'The three effects of an electric current',
        summary: 'A current can heat, magnetise and cause chemical change; this chapter is about the heating effect (Joule heating).',
        keywords: 'heating effect magnetic effect chemical effect joule heating resistive heating resistance cooker kettle hair dryer filament bulb',
        render(el) {
          const s1 = EM.section(el, 'Three effects');
          EM.p(s1, 'There are <strong>3 effects of an electric current</strong>. In this chapter we learn about the heating effect only.');
          EM.cards(
            s1,
            [
              { icon: '🔥', title: '1) The heating effect', html: 'A current warms the conductor it flows through. <em>This chapter.</em>' },
              { icon: '🧲', title: '2) The magnetic effect', html: 'A current produces a magnetic field around it (see later chapters).' },
              { icon: '⚗️', title: '3) The chemical effect', html: 'A current can cause chemical changes, e.g. when it passes through a solution.' },
            ],
            { cols: 3 }
          );
          const s2 = EM.section(el, 'The heating effect (Joule heating)');
          EM.p(s2, 'Appliances such as <strong>electric cookers, kettles, hair dryers and filament light bulbs</strong> heat up when a current is passed through them. This is due to <strong>resistance</strong>: electrical energy gets converted to heat energy.');
          EM.cards(
            s2,
            [
              { icon: '🍳', title: 'Electric cooker', html: 'Rings and oven elements get hot enough to cook.' },
              { icon: '🫖', title: 'Kettle', html: 'An element under the water heats it to boiling.' },
              { icon: '💨', title: 'Hair dryer', html: 'A hot coil warms air that a fan blows out.' },
              { icon: '💡', title: 'Filament bulb', html: 'A thin wire gets so hot it glows white — giving light (and lots of heat).' },
            ],
            { cols: 4 }
          );
          EM.callout(s2, 'key', 'This heating effect of an electric current is also known as <strong>Joule heating</strong> or <strong>resistive heating</strong>.');
          const sp = EM.simPanel(s2, 'Why does resistance make heat?', 'Inside a wire, free electrons drift through a lattice of positive ions. Turn up the current and watch the collisions heat the wire.');
          simInsideResistor(sp);
        },
      },
      {
        id: 'joules-law',
        title: 'Joule’s law',
        summary: 'The heat produced in a fixed time by a given resistance is proportional to the current squared.',
        keywords: 'james joule 1841 empirical joules law current squared I squared quadruple double power dissipation fires damage inefficiency',
        render(el, ui) {
          const s1 = EM.section(el, 'Electrical power and Joule’s law');
          EM.callout(s1, 'history', 'In <strong>1841 James Joule</strong> (England, 1818–1889) investigated the heating effect of an electric current. His discovery became known as <strong>Joule’s law</strong>. Joule found the relationship <em>empirically</em> — purely by experiment rather than theoretically.');
          ui.term('empirical', s1);
          ui.term('joules-law', s1);
          EM.p(s1, 'In symbols: heat produced ∝ I² (for fixed R and t), which we will show leads to <strong>P = I²R</strong>.');
          const s2 = EM.section(el, 'Why the I² matters');
          EM.list(s2, [
            'The term <strong>I²</strong> shows why current has such a large impact on heating.',
            'If you <strong>double the current</strong> you <strong>quadruple</strong> the power dissipated (and the heat generated). Triple it → 9 times the heat.',
            'This squared relationship is why <strong>careful control of current</strong> is important in electrical design: to prevent excessive heat, which can lead to <strong>component damage, electrical fires</strong> and overall <strong>inefficiency</strong> in circuits.',
          ]);
          const sp = EM.simPanel(s2, 'Joule heating: P = I²R live', 'Turn up the current and watch the coil glow. The graph shows how the heating power grows with the square of the current.');
          simJouleHeating(sp);
          ui.formula('p-i2r', el);
        },
      },
      {
        id: 'power-formulas',
        title: 'Deriving P = VI, P = I²R and W = I²Rt',
        summary: 'Combining P = W/t, V = W/q and I = q/t gives P = VI; adding V = IR gives P = I²R and W = I²Rt.',
        keywords: 'power work done time voltage charge current P=VI P=I2R W=I2Rt derivation watt ohms law',
        render(el, ui) {
          const s1 = EM.section(el, 'The three starting definitions');
          ui.term('power', s1);
          EM.p(s1, `We know that <strong>power = ${EM.frac('work done', 'time taken')}</strong>, and from earlier chapters that <strong>V = ${EM.frac('W', 'q')}</strong> (work done per unit charge) and <strong>I = ${EM.frac('q', 't')}</strong> (charge per second).`);
          const s2 = EM.section(el, 'Step through the derivation');
          EM.p(s2, 'Press <em>Next step</em> to build up each result. The boxed (yellow) equations are the ones to learn.');
          derivationChain(s2);
          EM.callout(s2, 'key', 'The work done, W = I²Rt, is the <strong>heat energy generated when a current flows through a resistor</strong>.');
          const s3 = EM.section(el, 'The formulas');
          ui.formula('power', s3);
          ui.formula('p-vi', s3);
          ui.formula('w-i2rt', s3);
          EM.callout(s3, 'tip', 'Pick the power formula that matches the data you are given: know V and I → P = VI; know I and R → P = I²R. (With V and R you can also use P = V²/R, which comes from the same two equations.)', 'Exam tip');
        },
      },
      {
        id: 'heating-substances',
        title: 'Heating a substance: mcΔθ = I²Rt',
        summary: 'Setting the electrical heat I²Rt equal to the heat gained, mcΔθ, lets you find temperature rises, specific heat capacities and the current needed.',
        keywords: 'specific heat capacity mc delta theta strand 2 temperature rise calorimeter W=E energy work done VIt',
        render(el, ui) {
          const s1 = EM.section(el, 'Linking electricity and heat');
          EM.callout(s1, 'note', 'Replacing W in Joule’s law (W = I²Rt) with the specific heat capacity equation from Strand 2, <strong>E = mcΔθ</strong>, gives <strong>mcΔθ = I²Rt</strong>.<br>W is work done and E is energy (the ability to do work), so <strong>W = E</strong>.');
          EM.p(s1, 'This equation can be used to:');
          EM.tabs(s1, [
            {
              label: '(a) Temperature rise',
              render(p) {
                EM.p(p, 'Calculate how much the temperature of a substance will rise for a given current, resistance and time:');
                EM.p(p, `<span class="math">Δ<var>θ</var> = ${EM.frac('<var>I</var><sup>2</sup><var>R</var><var>t</var>', '<var>m</var><var>c</var>')}</span>`);
                EM.callout(p, 'example', '2 A through a 30 Ω heater for 300 s in 0.5 kg of water: Δθ = (2² × 30 × 300) ÷ (0.5 × 4180) = 36 000 ÷ 2090 = <strong>17.2 °C</strong>.');
              },
            },
            {
              label: '(b) Specific heat capacity',
              render(p) {
                EM.p(p, 'By measuring the current, voltage, time and temperature rise you can determine the specific heat capacity of a substance. Since V = IR, I²Rt = VIt:');
                EM.p(p, `<span class="math"><var>c</var> = ${EM.frac('<var>V</var><var>I</var><var>t</var>', '<var>m</var>Δ<var>θ</var>')}</span>`);
                EM.callout(p, 'example', '12 V, 3 A, 600 s, 0.2 kg of water, Δθ = 25.8 °C: c = 21 600 ÷ (0.2 × 25.8) ≈ <strong>4186 J kg⁻¹ K⁻¹</strong>.');
              },
            },
            {
              label: '(c) Current or resistance needed',
              render(p) {
                EM.p(p, 'Work out the current (I) or resistance (R) needed to heat a mass (m) within a certain time (t):');
                EM.p(p, `<span class="math"><var>I</var> = ${EM.sqrt(EM.frac('<var>m</var><var>c</var>Δ<var>θ</var>', '<var>R</var><var>t</var>'))}</span> &nbsp;&nbsp; <span class="math"><var>R</var> = ${EM.frac('<var>m</var><var>c</var>Δ<var>θ</var>', '<var>I</var><sup>2</sup><var>t</var>')}</span>`);
                EM.callout(p, 'example', 'To warm 0.5 kg of water by 30 °C in 300 s with a 30 Ω heater: I = √(0.5 × 4180 × 30 ÷ (30 × 300)) = <strong>2.64 A</strong>.');
              },
            },
          ]);
          ui.formula('mc-i2rt', el);
          ui.formula('mc-vit', el);
          ui.experiment('joules-law-calorimeter', el);
          EM.callout(el, 'real', 'In a real experiment some heat escapes to the surroundings and warms the calorimeter itself, so the measured Δθ is a little smaller than mcΔθ = I²Rt predicts. Lagging and a lid reduce this.');
        },
      },
      {
        id: 'transmission',
        title: 'Why high voltage is used for transmission',
        summary: 'For a fixed power P = VI, raising the voltage lowers the current, which cuts the I²R heat wasted in the lines.',
        keywords: 'transmission national grid high voltage pylons step-up transformer power loss heat I2R current fixed power',
        render(el, ui) {
          const s1 = EM.section(el, 'The argument, step by step');
          EM.list(
            s1,
            [
              'According to Joule’s law, the <strong>larger the current, the more heat energy is dissipated</strong> (P = I²R).',
              'Since <strong>P = V × I</strong>, for a fixed amount of power (homes and businesses need a specific amount of energy to run their lights and appliances), the <strong>bigger the voltage, the smaller the current</strong>.',
              'This smaller current means a smaller amount of <strong>waste due to heat</strong> in the cables.',
              'So: raise the voltage → reduce the current while still achieving the same power → reduce the current → lower the losses.',
            ],
            { ordered: true }
          );
          EM.callout(s1, 'key', 'Because the loss depends on <strong>I²</strong>, ten times the voltage gives one tenth of the current and only <strong>one hundredth</strong> of the heat loss.');
          ui.experiment('transmission', el);
          ui.formula('p-loss', el);
        },
      },
      {
        id: 'plug',
        title: 'The fuse and the three-pin plug',
        summary: 'A fuse melts if the current is too large; live (brown), neutral (blue) and earth (green/yellow) wires each have a job.',
        keywords: 'fuse low melting point plug live brown neutral blue earth green yellow 220V 100 times a second earth pin longer shutters insulating sleeves footpath earth connection',
        render(el, ui) {
          const s1 = EM.section(el, 'Safety designs in household circuits: the fuse');
          ui.term('fuse', s1);
          EM.p(s1, 'Because the heating effect depends on I², a current that is too large makes the fuse wire hot enough to melt <em>before</em> the appliance or flex overheats.');
          const sp = EM.simPanel(s1, 'Explore a three-pin plug', 'Click any part of the plug (or choose it from the list) to see what it does. Press “Insert plug” to see why the earth pin is longer.');
          simPlug(sp);
          const s2 = EM.section(el, 'The three wires');
          ui.term('live', s2);
          ui.term('neutral', s2);
          ui.term('earth-wire', s2);
          EM.add(s2, 'table', {
            class: 'data-table',
            html: '<tr><th>Wire</th><th>Colour</th><th>Job</th></tr><tr><td>Live</td><td>Brown</td><td>Carries the alternating supply voltage; always connected to the fuse</td></tr><tr><td>Neutral</td><td>Blue</td><td>Return path to the source; ≈ 0 V</td></tr><tr><td>Earth</td><td>Green/yellow</td><td>Low-resistance path to ground for fault currents</td></tr>',
          });
          const sp2 = EM.simPanel(s2, 'Live and neutral voltages', 'The live wire’s voltage alternates; the neutral stays close to 0 V.');
          simMainsVoltage(sp2);
          EM.callout(s2, 'tip', 'The notes’ “+220 V and −220 V” is a simplification. Irish mains is <strong>230 V rms</strong>, which means the live actually peaks at about <strong>±325 V</strong> (230 × √2) — see chapter C.6 on alternating current. The supply is 50 Hz: the live goes positive and negative 50 times each per second, so it changes direction <strong>100 times a second</strong>.', 'Going further');
          const s3 = EM.section(el, 'The earth connection, earth pin and sleeves');
          EM.cards(s3, [
            { icon: '🟩', title: 'Earth connection to the house', html: 'The house’s earth connection can usually be found <strong>embedded in the footpath</strong> at the side of the house (a small metal plate).' },
            { icon: '📏', title: 'Earth pin is longer', html: 'The earth pin (top pin) is longer than the other two. It <strong>opens the live and neutral shutters</strong> (panels) on the wall socket.' },
            { icon: '🧤', title: 'Insulating sleeves', html: 'The live and neutral pins have <strong>insulating sleeves</strong>, to help prevent an electric shock if your fingers wrap too far around the plug.' },
          ], { cols: 3 });
        },
      },
      {
        id: 'bonding-insulation',
        title: 'Electrical bonding & double insulation',
        summary: 'Bonding keeps metal parts at the same potential so no current can flow through you; double insulation uses two layers so the case can’t become live.',
        keywords: 'bonding same potential pipes kitchen bathroom hot press low impedance breaker trip double insulation drill lamp toaster kettle hand blender',
        render(el) {
          const s1 = EM.section(el, 'Electrical bonding');
          EM.p(s1, '<strong>Electrical bonding</strong> is the act of joining two electrical conductors together — two wires, or a wire and a pipe. All the metal parts that are <em>not</em> supposed to carry current during normal operation are connected so that they are at the <strong>same electrical potential</strong>.');
          EM.list(s1, [
            '<strong>No current can flow between two bonded bodies</strong>, because they have the same potential as each other.',
            'It protects equipment and people by not allowing <strong>you</strong> to become the path of equalisation if the metal parts happen to be at different potentials.',
            'It is used in <strong>kitchens and bathrooms</strong> (and you’ll see green/yellow bonding wires clamped to the copper pipes in the <strong>hot press</strong> of a typical home).',
            'Bonding also creates a <strong>low-impedance path back to the source</strong>. If a fault occurs, this forces a large current to flow (because of the low resistance), which <strong>trips the breaker</strong>.',
          ]);
          const sp = EM.simPanel(s1, 'Bonding in the hot press', 'A person is touching the hot and cold pipes. Create a fault with and without the bonding wires.');
          simBonding(sp);
          const s2 = EM.section(el, 'Double insulation');
          EM.p(s2, '<strong>Double-insulated</strong> wires use two or more layers of insulation. This gives <strong>greater resistance to penetration</strong> than single-layer cables and is <strong>more durable</strong>.');
          const sp2 = EM.simPanel(s2, 'How deep must the damage go?', 'Push the blade into the cable and compare single and double insulation.');
          simDoubleInsulation(sp2);
          EM.p(s2, 'Examples of double-insulated electrical appliances:');
          EM.cards(
            s2,
            [
              { icon: '🔩', title: 'Electric drill', html: '' },
              { icon: '🛋️', title: 'Lamp', html: '' },
              { icon: '🍞', title: 'Toaster', html: '' },
              { icon: '🫖', title: 'Kettle', html: '' },
              { icon: '🥣', title: 'Hand blender', html: '' },
            ],
            { cols: 5 }
          );
        },
      },
      {
        id: 'mcb-rcd',
        title: 'MCBs, RCDs and the fuse box',
        summary: 'An MCB protects circuits from too much current and can be reset; an RCD protects people by detecting a live/neutral imbalance.',
        keywords: 'MCB miniature circuit breaker RCD residual current device fuse box consumer unit overcurrent short circuit imbalance power tools lawnmower trip reset',
        render(el, ui) {
          const s1 = EM.section(el, 'MCB and RCD');
          ui.term('mcb', s1);
          EM.list(s1, [
            'Protects the electrical circuit from damage by <strong>too much current</strong> or <strong>short circuits</strong> caused by faults in the wiring or malfunctioning equipment.',
            'A <strong>mechanical alternative to a fuse</strong>; unlike a fuse, when it’s tripped it <strong>doesn’t have to be replaced</strong> — just reset.',
            'Installed in the <strong>fuse box</strong>.',
          ]);
          ui.term('rcd', s1);
          EM.list(s1, [
            'Designed for <strong>human safety</strong>. Used for <strong>power tools and electric lawnmowers</strong>.',
            'Detects an <strong>imbalance between the live and neutral current</strong>. If electricity flows down an unintended path — such as through a person who has touched a live part — the RCD switches the circuit off <strong>very quickly</strong>, significantly reducing the risk of death or serious injury.',
            'Installed in the <strong>fuse box</strong>.',
          ]);
          const sp = EM.simPanel(s1, 'Inside the fuse box', 'Overload the sockets circuit or let some current leak to earth, and see which device trips.');
          simFuseBox(sp);
          EM.add(s1, 'table', {
            class: 'data-table',
            html: '<tr><th></th><th>Fuse</th><th>MCB</th><th>RCD</th></tr><tr><td>Where</td><td>In the plug</td><td>Fuse box</td><td>Fuse box</td></tr><tr><td>Responds to</td><td>Too much current</td><td>Too much current / short circuit</td><td>Live ≠ neutral current (leak)</td></tr><tr><td>Main job</td><td>Protect appliance & flex</td><td>Protect the circuit wiring</td><td>Protect people</td></tr><tr><td>After it acts</td><td>Replace it</td><td>Reset it</td><td>Reset it</td></tr>',
          });
          ui.experiment('safety-lab', el);
        },
      },
    ],

    quiz: [
      { q: 'Which of these is NOT one of the three effects of an electric current?', options: ['Gravitational effect', 'Heating effect', 'Magnetic effect', 'Chemical effect'], answer: 0, explain: 'The three effects are heating, magnetic and chemical.' },
      { q: 'The heating effect of an electric current is also known as…', options: ['Joule heating (resistive heating)', 'Electromagnetic induction', 'Electrolysis', 'Static heating'], answer: 0, explain: 'Resistance converts electrical energy to heat — Joule or resistive heating.' },
      { q: 'Joule’s law states that the heat produced in a fixed time for a given resistance is proportional to…', options: ['the current squared', 'the current', 'the resistance squared', 'the square root of the current'], answer: 0, explain: 'Heat ∝ I² for fixed R and t, giving P = I²R.' },
      { q: 'Joule discovered his law “empirically”. This means he…', options: ['found it purely by experiment', 'derived it from theory', 'copied it from Ohm', 'guessed it'], answer: 0, explain: 'Empirical = obtained by experiment rather than theoretically.' },
      { q: 'The current through a resistor is doubled. The heat produced per second becomes…', options: ['four times as big', 'twice as big', 'half as big', 'unchanged'], answer: 0, explain: 'P = I²R, so (2I)² = 4I² — the power quadruples.' },
      { q: 'Which three equations combine to give P = VI?', options: ['P = W/t, V = W/q and I = q/t', 'V = IR, P = I²R and W = Pt', 'E = mcΔθ, W = Pt and V = IR', 'F = ma, W = Fs and P = W/t'], answer: 0, explain: 'P = W/t with W = Vq gives P = Vq/t, and q/t = I.' },
      { q: 'A current of 3 A flows through a 20 Ω resistor. What power is dissipated?', options: ['180 W', '60 W', '1200 W', '6.7 W'], answer: 0, explain: 'P = I²R = 3² × 20 = 180 W.' },
      { q: 'How much heat is produced when 2 A flows through a 10 Ω resistor for 1 minute?', options: ['2400 J', '40 J', '1200 J', '240 J'], answer: 0, explain: 'W = I²Rt = 2² × 10 × 60 = 2400 J (time in seconds!).' },
      { q: 'A heater supplies 41 800 J to 0.5 kg of water (c = 4180 J kg⁻¹ K⁻¹). Ignoring losses, the temperature rise is…', options: ['20 °C', '10 °C', '40 °C', '2 °C'], answer: 0, explain: 'Δθ = E/(mc) = 41 800 ÷ (0.5 × 4180) = 20 °C.' },
      { q: 'Why can we write mcΔθ = I²Rt?', options: ['Work done is energy transferred, so W = E', 'Power always equals energy', 'Resistance equals specific heat capacity', 'Current is the same as temperature'], answer: 0, explain: 'The heat produced by the current, W = I²Rt, equals the heat gained by the substance, E = mcΔθ.' },
      { q: 'Why is electricity transmitted at very high voltage?', options: ['For a fixed power a higher voltage means a smaller current, so less I²R heat is lost', 'A higher voltage increases the resistance of the cables', 'High voltage makes the current bigger so more power arrives', 'High voltage is safer near homes'], answer: 0, explain: 'P = VI: raising V lowers I, and the loss I²R falls with the square of the current.' },
      { q: 'The transmission voltage is increased 10 times for the same power. The heat lost in the line becomes…', options: ['100 times smaller', '10 times smaller', '10 times bigger', 'unchanged'], answer: 0, explain: 'I falls by 10, and loss ∝ I², so it falls by 10² = 100.' },
      { q: 'A fuse is best described as…', options: ['a short wire with a very low melting point that melts if the current is too large', 'a device that detects a difference between live and neutral currents', 'a thick wire with a very high melting point', 'a wire joining metal pipes together'], answer: 0, explain: 'If the current becomes too large for the appliance, the fuse melts and breaks the circuit.' },
      { q: 'In a plug, the fuse is always connected to the…', options: ['live wire (brown)', 'neutral wire (blue)', 'earth wire (green/yellow)', 'outer sheath'], answer: 0, explain: 'The live wire is always connected to the fuse, so a blown fuse disconnects the live.' },
      { q: 'What is the job of the earth wire?', options: ['To give a low-resistance path to the ground for fault currents', 'To carry the current back to the transformer in normal use', 'To carry the alternating supply voltage', 'To make the plug heavier'], answer: 0, explain: 'The earth wire carries fault currents safely to the ground, helping prevent shocks. The neutral is the normal return path.' },
      { q: 'Why is the earth pin on a plug longer than the other two pins?', options: ['It opens the shutters on the live and neutral holes of the socket', 'It carries more current', 'It holds the fuse', 'It has an insulating sleeve'], answer: 0, explain: 'The earth pin enters first and opens the live and neutral panels (shutters).' },
      { q: 'Electrical bonding protects you because bonded metal parts…', options: ['are at the same electrical potential, so no current flows between them', 'have a very high resistance', 'are covered in two layers of insulation', 'are connected to the live wire'], answer: 0, explain: 'With no potential difference between bonded parts, you can’t become the path of equalisation.' },
      { q: 'An RCD switches off a circuit when it detects…', options: ['an imbalance between the live and neutral currents', 'a current above 13 A in the neutral', 'that the fuse has melted', 'a voltage below 220 V'], answer: 0, explain: 'If current leaks down an unintended path (e.g. a person), live and neutral currents differ and the RCD trips very quickly.' },
      { q: 'What is an advantage of an MCB over a fuse?', options: ['When it trips it can be reset instead of replaced', 'It detects current flowing through a person', 'It is fitted inside every plug', 'It never trips on a short circuit'], answer: 0, explain: 'An MCB is a mechanical alternative to a fuse: after tripping you just switch it back on.' },
      { q: 'Which appliance is given in the notes as an example of a double-insulated appliance?', options: ['An electric drill', 'An electric cooker', 'A metal-cased washing machine', 'A fuse box'], answer: 0, explain: 'The notes list an electric drill, a lamp, a toaster, a kettle and a hand blender.' },
    ],
  });
})();
