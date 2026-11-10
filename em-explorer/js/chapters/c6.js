/* C.6 Electromagnetic Induction */
(function () {
  'use strict';
  const { h, add, draw, colors } = EM;
  const ft = EM.fmtText;
  const TAU = Math.PI * 2;
  const COPPER = '#d97706';
  const TEAL = '#14b8a6';
  const SKY = '#38bdf8';

  /* ------------------------------------------------------------------ shared helpers */

  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  /** Damped meter needle (springy like a real galvanometer). */
  function makeNeedle(k = 140, c = 16) {
    return {
      v: 0,
      w: 0,
      step(target, dt) {
        if (!(dt > 0)) return;
        this.w += (k * (target - this.v) - c * this.w) * dt;
        this.v = EM.clamp(this.v + this.w * dt, -1.15, 1.15);
      },
    };
  }

  function niceCeil(x) {
    if (!(x > 0)) return 1;
    const m = Math.pow(10, Math.floor(Math.log10(x)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * m >= x - 1e-12) return k * m;
    return 10 * m;
  }

  function pushHist(arr, sample, win) {
    arr.push(sample);
    while (arr.length && sample.t - arr[0].t > win + 0.5) arr.shift();
  }
  const pts = (arr, now, key) => arr.map((s) => [s.t - now, s[key]]);

  /** Wire seen end-on: ⊙ = current out of the page, ⊗ = into the page. */
  function wireEnd(ctx, x, y, dir, r = 12, glow = 0) {
    ctx.save();
    if (glow > 0.05) {
      const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
      g.addColorStop(0, `rgba(250,204,21,${0.55 * Math.min(1, glow)})`);
      g.addColorStop(1, 'rgba(250,204,21,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#92400e';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = '#fef3c7';
    if (dir > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, TAU);
      ctx.fill();
    } else if (dir < 0) {
      const s = r * 0.5;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Side view of a solenoid: half of every turn ('back' = left arcs, 'front' = right arcs). */
  function solenoid(ctx, x0, x1, cy, ry, n, half, alpha = 1) {
    ctx.save();
    ctx.strokeStyle = COPPER;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = half === 'back' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
      ctx.beginPath();
      if (half === 'back') ctx.ellipse(x, cy, 7, ry, 0, Math.PI / 2, (3 * Math.PI) / 2);
      else ctx.ellipse(x, cy, 7, ry, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Small legend row drawn on a canvas. items: [{color, label, dash}] */
  function legend(ctx, x, y, items, colW = 150, rowH = 18, perRow = 2) {
    items.forEach((it, i) => {
      const cx = x + (i % perRow) * colW;
      const cy = y + Math.floor(i / perRow) * rowH;
      draw.line(ctx, cx, cy, cx + 18, cy, it.color, 3, it.dash);
      draw.text(ctx, it.label, cx + 24, cy, { align: 'left', size: 11.5, color: colors.text });
    });
  }

  function heatGlow(ctx, x, y, r, a) {
    if (a < 0.02) return;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, `rgba(239,68,68,${Math.min(0.75, a)})`);
    g.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ SIM: wire through a horseshoe magnet */

  function wireInductionSim(el) {
    const W = 680,
      H = 360;
    const G = { x0: 250, x1: 430, y0: 105, y1: 255 };
    const st = { x: 340, y: 60, px: 340, py: 60, vx: 0, vy: 0, drag: false, off: [0, 0], auto: null, speed: 140, flow: 0 };
    const needle = makeNeedle();
    const bAt = (y) => {
      const d = y < G.y0 ? G.y0 - y : y > G.y1 ? y - G.y1 : 0;
      return Math.exp(-((d / 16) ** 2));
    };
    const clampPos = () => {
      st.x = EM.clamp(st.x, G.x0 + 16, G.x1 - 16);
      st.y = EM.clamp(st.y, 28, H - 28);
    };
    const teleport = (x, y) => {
      st.x = st.px = x;
      st.y = st.py = y;
      st.vx = st.vy = 0;
    };
    let I = 0; // mA

    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A wire moved between the poles of a horseshoe magnet, connected to an ammeter',
      cursor: 'grab',
      onDown(p) {
        if (Math.hypot(p.x - st.x, p.y - st.y) < 42) {
          st.drag = true;
          st.auto = null;
          st.off = [p.x - st.x, p.y - st.y];
        }
      },
      onMove(p) {
        if (!st.drag) return;
        st.x = p.x - st.off[0];
        st.y = p.y - st.off[1];
        clampPos();
      },
      onUp() {
        st.drag = false;
      },
      draw(ctx, s, dt) {
        if (st.auto) {
          const a = st.auto;
          st.x += a.vx * dt;
          st.y += a.vy * dt;
          if (a.kind === 'side') {
            if (st.x >= G.x1 - 16 || st.x <= G.x0 + 16) {
              a.vx = -a.vx;
              a.bounces++;
              if (a.bounces > 3) st.auto = null;
            }
          } else if ((a.vy < 0 && st.y <= 40) || (a.vy > 0 && st.y >= H - 40)) st.auto = null;
          clampPos();
        }
        if (dt > 0) {
          st.vx = approach(st.vx, (st.x - st.px) / dt, 14, dt);
          st.vy = approach(st.vy, (st.y - st.py) / dt, 14, dt);
        }
        st.px = st.x;
        st.py = st.y;
        const B = bAt(st.y);
        const vUp = -st.vy;
        const emf = B * vUp; // ∝ B L v (v = vertical component only)
        I = emf / 60; // mA, arbitrary scale
        needle.step(I / 4, dt);
        st.flow += needle.v * 110 * dt;

        draw.grid(ctx, W, H);
        // bend of the horseshoe (behind the wire)
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 64;
        ctx.strokeStyle = colors.south;
        ctx.beginPath();
        ctx.ellipse(340, 258, 130, 62, 0, Math.PI / 2, Math.PI);
        ctx.stroke();
        ctx.strokeStyle = colors.north;
        ctx.beginPath();
        ctx.ellipse(340, 258, 130, 62, 0, 0, Math.PI / 2);
        ctx.stroke();
        ctx.restore();
        // pole blocks
        const pole = (x, col, letter) => {
          const g = ctx.createLinearGradient(x, 0, x + 80, 0);
          g.addColorStop(0, draw.shade(col, -0.25));
          g.addColorStop(1, draw.shade(col, 0.1));
          ctx.fillStyle = g;
          draw.roundRect(ctx, x, 100, 80, 160, 6);
          ctx.fill();
          draw.text(ctx, letter, x + 40, 180, { size: 30, weight: 800, color: '#fff' });
        };
        pole(170, colors.south, 'S');
        pole(430, colors.north, 'N');
        draw.text(ctx, 'Horseshoe magnet', 210, 86, { size: 12, color: colors.muted });
        // field lines N → S (right to left)
        for (let y = 118; y <= 244; y += 21) draw.arrow(ctx, 428, y, 254, y, { color: 'rgba(167,139,250,0.75)', width: 1.5, head: 8 });
        // legend
        draw.text(ctx, 'B field: N → S', 16, 22, { align: 'left', size: 12, color: colors.bfield, weight: 600 });
        draw.text(ctx, '⊙ current out of page', 16, 42, { align: 'left', size: 12, color: colors.muted });
        draw.text(ctx, '⊗ current into page', 16, 60, { align: 'left', size: 12, color: colors.muted });
        // leads to the ammeter (wire seen end-on: one lead from each end)
        const mx = 600,
          my = 196;
        const bez = (x0, y0, cx, cy, x1, y1, n = 22) => {
          const out = [];
          for (let i = 0; i <= n; i++) {
            const t = i / n,
              u = 1 - t;
            out.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
          }
          return out;
        };
        const leadA = bez(st.x, st.y, 520, 40, mx - 44, my + 10);
        const leadB = bez(mx + 44, my + 10, 600, 330, st.x, st.y);
        draw.wire(ctx, leadA, '#c2410c', 2.5);
        draw.wire(ctx, leadB, '#c2410c', 2.5);
        if (Math.abs(needle.v) > 0.03) {
          draw.flowDots(ctx, leadA, st.flow, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, leadB, st.flow, { speed: 1, r: 2.6 });
        }
        draw.meter(ctx, mx, my, needle.v, { r: 46, label: 'A', reading: 'I = ' + ft(I, 2) + ' mA' });
        draw.text(ctx, 'end-on view:', 600, 282, { size: 11, color: colors.muted });
        draw.text(ctx, 'the wire runs into the page', 600, 297, { size: 11, color: colors.muted });
        // the wire
        const dir = Math.abs(needle.v) > 0.04 ? Math.sign(needle.v) : 0;
        wireEnd(ctx, st.x, st.y, dir, 13, Math.abs(needle.v));
        const sp = Math.hypot(st.vx, st.vy);
        if (sp > 15) {
          const L = Math.min(70, 20 + sp * 0.25);
          draw.arrow(ctx, st.x, st.y, st.x + (st.vx / sp) * L, st.y + (st.vy / sp) * L, { color: colors.velocity, width: 2.5, label: 'v' });
        }
        if (!st.drag && !st.auto && sp < 5) draw.text(ctx, 'drag me', st.x, st.y + 28, { size: 11, color: colors.muted, bg: 'rgba(11,18,32,0.8)' });
      },
    });

    const c = EM.controls(el);
    EM.button(c, '⬆ Move up', () => {
      teleport(340, H - 40);
      st.auto = { kind: 'up', vx: 0, vy: -st.speed };
    });
    EM.button(c, '⬇ Move down', () => {
      teleport(340, 40);
      st.auto = { kind: 'down', vx: 0, vy: st.speed };
    });
    EM.button(c, '↔ Move parallel to field', () => {
      teleport(G.x0 + 16, 180);
      st.auto = { kind: 'side', vx: st.speed, vy: 0, bounces: 0 };
    });
    EM.button(c, '✋ Hold still in field', () => {
      st.auto = null;
      teleport(340, 180);
    });
    EM.slider(c, { label: 'Speed of buttons', min: 40, max: 300, step: 10, value: st.speed, unit: 'px/s', onInput: (v) => (st.speed = v) });
    const ro = EM.readout(el, [
      { key: 'v', label: 'Vertical motion' },
      { key: 'cut', label: 'Cutting field lines?' },
      { key: 'i', label: 'Current' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      const vUp = -st.vy;
      const sp = Math.hypot(st.vx, st.vy);
      const B = bAt(st.y);
      const cutting = B > 0.2 && Math.abs(vUp) > 12;
      ro.set('v', Math.abs(vUp) < 8 ? 'none' : (vUp > 0 ? 'up ' : 'down ') + Math.round(Math.abs(vUp)) + ' px/s');
      ro.set('cut', cutting ? 'yes' : 'no');
      ro.set('i', Math.abs(I) < 0.05 ? '0' : EM.fmt(Math.abs(I), 2) + ' mA ' + (I > 0 ? '⊙ (one way)' : '⊗ (opposite way)'));
      if (B < 0.2) status.set('The wire is <strong>outside the field</strong> — no field lines are being cut, so no current.', '');
      else if (sp < 10) status.set('Wire <strong>stationary</strong> in the field → the field through the circuit is not changing → <strong>no current</strong>.', 'warn');
      else if (Math.abs(vUp) < 0.3 * sp) status.set('Moving <strong>parallel to the field lines</strong> → not cutting them → <strong>no current</strong>.', 'warn');
      else if (vUp > 0) status.set('Moving <strong>up</strong> through the field → current flows <strong>one way</strong> (⊙). Faster = bigger current.', 'good');
      else status.set('Moving <strong>down</strong> through the field → current flows the <strong>opposite way</strong> (⊗).', 'good');
    });
  }

  /* ------------------------------------------------------------------ SIM: magnet and coil (Faraday + Lenz) */

  function coilSim(el) {
    const W = 720,
      H = 420;
    const C = { x0: 100, x1: 300, cy: 100, ry: 40 };
    const ccx = (C.x0 + C.x1) / 2;
    const ML = 150,
      MT = 32,
      MIN = 235,
      MAX = 620,
      OUT = 600;
    const PHI_MAX = 2e-4; // Wb per turn when the magnet sits in the middle of the coil (1 px = 1 mm)
    const WIN = 6;
    const st = { mx: OUT, pmx: OUT, v: 0, N: 100, flip: false, phi: 0, dphi: 0, emf: 0, auto: null, drag: false, off: 0, skip: true, hist: [], flow: 0 };
    const needle = makeNeedle();
    const fluxAt = (mx) => (st.flip ? -1 : 1) * PHI_MAX * Math.pow(1 + ((mx - ccx) / 100) ** 2, -1.5);

    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A bar magnet moved into and out of a coil connected to a galvanometer, with flux and emf graphs',
      cursor: 'grab',
      onDown(p) {
        if (Math.abs(p.x - st.mx) < ML / 2 + 10 && Math.abs(p.y - C.cy) < MT / 2 + 16) {
          st.drag = true;
          st.auto = null;
          st.off = p.x - st.mx;
        }
      },
      onMove(p) {
        if (st.drag) st.mx = EM.clamp(p.x - st.off, MIN, MAX);
      },
      onUp() {
        st.drag = false;
      },
      draw(ctx, s, dt) {
        if (st.auto) {
          const d = Math.sign(st.auto.to - st.mx);
          st.mx += d * st.auto.speed * dt;
          if ((st.auto.to - st.mx) * d <= 0) {
            st.mx = st.auto.to;
            st.auto = null;
          }
        }
        const phi = fluxAt(st.mx);
        if (st.skip || !(dt > 0)) {
          st.skip = false;
          st.phi = phi;
          st.pmx = st.mx;
        } else {
          st.dphi = approach(st.dphi, (phi - st.phi) / dt, 18, dt);
          st.v = approach(st.v, (st.mx - st.pmx) / dt / 1000, 18, dt);
          st.phi = phi;
          st.pmx = st.mx;
        }
        st.emf = -st.N * st.dphi;
        const emV = st.emf * 1000;
        needle.step(emV / 100, dt);
        st.flow += EM.clamp(emV * 3, -160, 160) * dt;
        if (dt > 0) pushHist(st.hist, { t: s.t, phi: phi * 1e4, e: emV }, WIN);

        draw.grid(ctx, W, H);
        const n = EM.clamp(Math.round(st.N / 25), 4, 16);
        solenoid(ctx, C.x0, C.x1, C.cy, C.ry, n, 'back', 0.45);
        draw.magnet(ctx, st.mx, C.cy, ML, MT, st.flip ? 0 : Math.PI);
        solenoid(ctx, C.x0, C.x1, C.cy, C.ry, n, 'front', 1);
        draw.text(ctx, `Coil: N = ${st.N} turns`, ccx, 22, { size: 12.5, weight: 600 });
        // circuit + galvanometer
        const L = [
          [ccx - 38, 212],
          [C.x0, 212],
          [C.x0, C.cy + C.ry],
        ];
        const R = [
          [C.x1, C.cy + C.ry],
          [C.x1, 212],
          [ccx + 38, 212],
        ];
        draw.wire(ctx, L, colors.wire, 2.5);
        draw.wire(ctx, R, colors.wire, 2.5);
        if (Math.abs(emV) > 0.5) {
          draw.flowDots(ctx, L, st.flow, { speed: 1 });
          draw.flowDots(ctx, R, st.flow, { speed: 1 });
        }
        draw.meter(ctx, ccx, 205, needle.v, { r: 38, label: 'G' });
        draw.text(ctx, 'E = ' + ft(emV, 2) + ' mV' + (Math.abs(needle.v) >= 1 ? ' (off scale!)' : ''), ccx, 236, { size: 12, weight: 600 });
        // Lenz: which pole does the coil end become?
        const facing = st.flip ? 'S' : 'N';
        if (Math.abs(emV) > 0.8) {
          const approaching = (st.flip ? -1 : 1) * st.dphi > 0;
          const ind = approaching ? facing : facing === 'N' ? 'S' : 'N';
          const col = ind === 'N' ? colors.north : colors.south;
          ctx.save();
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(C.x1 + 4, 44, 12, 0, TAU);
          ctx.fill();
          ctx.restore();
          draw.text(ctx, ind, C.x1 + 4, 44, { size: 13, weight: 800, color: '#fff' });
          draw.text(ctx, approaching ? `coil end becomes ${ind} → repels the approaching ${facing}` : `coil end becomes ${ind} → attracts the leaving ${facing}`, C.x1 + 22, 44, {
            align: 'left',
            size: 12,
            color: colors.text,
            bg: 'rgba(11,18,32,0.85)',
          });
          if (Math.abs(st.v) > 0.004) {
            const d = -Math.sign(st.v);
            const len = EM.clamp(Math.abs(emV) * 1.2, 14, 60);
            draw.arrow(ctx, st.mx, C.cy - MT / 2 - 12, st.mx + d * len, C.cy - MT / 2 - 12, { color: colors.force, width: 3 });
          }
        }
        if (!st.drag && !st.auto) draw.text(ctx, 'drag me ↔', st.mx, C.cy + MT / 2 + 14, { size: 11, color: colors.muted, bg: 'rgba(11,18,32,0.8)' });
        // graphs
        const now = s.t;
        const rP = { x: 62, y: 274, w: 280, h: 108 };
        const rE = { x: 420, y: 274, w: 280, h: 108 };
        draw.plot(ctx, rP, { xMin: -WIN, xMax: 0, yMin: -2.2, yMax: 2.2, title: 'Flux per turn Φ (×10⁻⁴ Wb)', xLabel: 'time (s)', series: [{ points: pts(st.hist, now, 'phi'), color: colors.bfield, width: 2.2 }] });
        let m = 10;
        for (const p of st.hist) m = Math.max(m, Math.abs(p.e));
        const ym = niceCeil(m * 1.1);
        draw.plot(ctx, rE, { xMin: -WIN, xMax: 0, yMin: -ym, yMax: ym, title: 'Induced emf E = −N dΦ/dt (mV)', xLabel: 'time (s)', series: [{ points: pts(st.hist, now, 'e'), color: colors.current, width: 2.2 }] });
      },
    });

    const c = EM.controls(el);
    const go = (from, to, speed) => {
      if (from != null && Math.abs(st.mx - from) > 1) {
        st.mx = st.pmx = from;
        st.skip = true;
        st.dphi = 0;
      }
      st.auto = { to, speed };
    };
    EM.button(c, 'Push in slowly', () => go(OUT, MIN, 80));
    EM.button(c, 'Push in quickly', () => go(OUT, MIN, 500));
    EM.button(c, 'Pull out slowly', () => go(MIN, OUT, 80));
    EM.button(c, 'Pull out quickly', () => go(MIN, OUT, 500));
    const c2 = EM.controls(el);
    EM.slider(c2, { label: 'Turns on the coil, N', min: 10, max: 400, step: 10, value: st.N, onInput: (v) => (st.N = v) });
    EM.toggle(c2, {
      label: 'Flip the magnet (S pole faces the coil)',
      value: false,
      onChange: (v) => {
        st.flip = v;
        st.skip = true;
        st.dphi = 0;
      },
    });
    const ro = EM.readout(el, [
      { key: 'phi', label: 'Φ per turn' },
      { key: 'link', label: 'NΦ (all turns)' },
      { key: 'v', label: 'Magnet speed' },
      { key: 'rate', label: 'dΦ/dt' },
      { key: 'emf', label: 'Induced emf E' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      ro.set('phi', EM.fmt(st.phi, 3) + ' Wb');
      ro.set('link', EM.fmt(st.N * st.phi, 3) + ' Wb');
      ro.set('v', EM.fmt(Math.abs(st.v), 2) + ' m/s');
      ro.set('rate', EM.fmt(st.dphi, 3) + ' Wb/s');
      ro.set('emf', EM.fmt(st.emf * 1000, 3) + ' mV');
      const e = Math.abs(st.emf * 1000);
      if (e < 0.5) status.set('Magnet not moving (or far away) → flux through the coil is <strong>not changing</strong> → no emf, needle at zero.', '');
      else if (Math.abs(st.v) < 0.2) status.set('Slow movement → flux changes <strong>slowly</strong> → <strong>small</strong> deflection (small emf).', 'good');
      else status.set('Fast movement → flux changes <strong>rapidly</strong> → <strong>large</strong> deflection (large emf). In and out give opposite directions.', 'good');
    });
  }

  /* ------------------------------------------------------------------ SIM: Lenz's law copper pipe race */

  function lenzPipeSim(el) {
    const W = 680,
      H = 430;
    const TOP = 70,
      LEN = 1.5,
      PX = 200; // px per metre
    const S0 = -0.14,
      FLOOR = 1.575;
    const st = { strength: 1, copper: true, slow: false, running: false, a: null, b: null };
    const fresh = () => ({ s: S0, v: 0, t: 0, done: false, F: 0 });
    st.a = fresh();
    st.b = fresh();
    let flowA = 0,
      flowB = 0;
    const kFor = () => (st.copper ? 40 * st.strength * st.strength : 0);
    const yOf = (s) => TOP + s * PX;

    function stepObj(o, isMagnet, dt) {
      if (o.s >= FLOOR) {
        o.v = 0;
        o.F = 0;
        return;
      }
      const inside = o.s > -0.05 && o.s < LEN + 0.05;
      const k = isMagnet && inside ? kFor() : 0;
      o.F = k * o.v; // drag per unit mass
      const a = 9.8 - o.F;
      o.v += a * dt;
      o.s += o.v * dt;
      if (!o.done) o.t += dt;
      if (o.s >= LEN && !o.done) o.done = true;
      if (o.s >= FLOOR) o.s = FLOOR;
    }

    function pipe(ctx, x, front) {
      const w = 56;
      if (!front) {
        const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        g.addColorStop(0, '#7c2d12');
        g.addColorStop(0.5, st.copper ? '#9a3412' : '#334155');
        g.addColorStop(1, '#7c2d12');
        ctx.fillStyle = st.copper ? g : '#1e293b';
        ctx.fillRect(x - w / 2, TOP, w, LEN * PX);
      } else {
        ctx.save();
        const col = st.copper ? COPPER : '#94a3b8';
        ctx.fillStyle = col;
        ctx.fillRect(x - w / 2, TOP, 8, LEN * PX);
        ctx.fillRect(x + w / 2 - 8, TOP, 8, LEN * PX);
        ctx.globalAlpha = 0.16;
        for (let y = TOP + 6; y < TOP + LEN * PX; y += 9) ctx.fillRect(x - w / 2, y, w, 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = draw.shade(col, 0.3);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, TOP, w / 2, 6, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A metal cylinder and a magnet dropped down copper pipes',
      draw(ctx, s, dt) {
        const scale = st.slow ? 0.25 : 1;
        if (st.running) {
          const n = 4;
          for (let i = 0; i < n; i++) {
            stepObj(st.a, false, (dt * scale) / n);
            stepObj(st.b, true, (dt * scale) / n);
          }
          if (st.a.s >= FLOOR && st.b.s >= FLOOR) st.running = false;
        }
        const k = kFor();
        const vt = k > 0 ? 9.8 / k : Infinity;
        draw.grid(ctx, W, H);
        const XA = 220,
          XB = 460;
        draw.text(ctx, 'Non-magnetic metal cylinder', XA, 16, { size: 12.5, weight: 600 });
        draw.text(ctx, 'Magnet (same size & mass)', XB, 16, { size: 12.5, weight: 600 });
        pipe(ctx, XA, false);
        pipe(ctx, XB, false);
        // catch tray
        ctx.fillStyle = '#334155';
        ctx.fillRect(140, H - 26, 400, 6);
        // metal cylinder
        const ya = yOf(st.a.s);
        ctx.fillStyle = '#cbd5e1';
        draw.roundRect(ctx, XA - 15, ya - 17, 30, 34, 4);
        ctx.fill();
        // magnet + eddy currents
        const yb = yOf(st.b.s);
        const inPipe = st.b.s > -0.05 && st.b.s < LEN + 0.05;
        const strength = inPipe && st.copper ? EM.clamp((st.b.v * k) / 9.8, 0, 1) : 0;
        heatGlow(ctx, XB, yb, 60, strength * 0.55);
        draw.magnet(ctx, XB, yb, 34, 30, -Math.PI / 2);
        pipe(ctx, XA, true);
        pipe(ctx, XB, true);
        if (strength > 0.03) {
          flowA += 60 * strength * dt;
          for (const [dy, sgn] of [
            [-30, 1],
            [30, -1],
          ]) {
            const y = yb + dy;
            ctx.save();
            ctx.strokeStyle = `rgba(250,204,21,${0.35 + 0.6 * strength})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(XB, y, 36, 8, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
            // arrow on the front of the loop shows circulation (opposite above and below)
            draw.arrow(ctx, XB - sgn * 10, y + 8, XB + sgn * 14, y + 8, { color: colors.current, width: 2, head: 8 });
          }
          draw.text(ctx, 'eddy currents', XB + 44, yb - 30, { align: 'left', size: 11.5, color: colors.current, bg: 'rgba(11,18,32,0.8)' });
          draw.text(ctx, '(opposite ways)', XB + 44, yb + 30, { align: 'left', size: 11, color: colors.current, bg: 'rgba(11,18,32,0.8)' });
        }
        // forces on the magnet (per unit mass, weight = 9.8)
        if (st.b.s < FLOOR) {
          const scaleF = 4;
          draw.arrow(ctx, XB - 52, yb, XB - 52, yb + 9.8 * scaleF, { color: colors.force, width: 2.5, label: 'W' });
          if (st.b.F > 0.3) draw.arrow(ctx, XB - 66, yb, XB - 66, yb - Math.min(9.8, st.b.F) * scaleF, { color: colors.force, width: 2.5, label: 'F' });
        }
        if (st.a.s < FLOOR) draw.arrow(ctx, XA - 52, ya, XA - 52, ya + 9.8 * 4, { color: colors.force, width: 2.5, label: 'W' });
        // timers
        const tm = (o) => (o.t > 0 ? o.t.toFixed(2) + ' s' : '0.00 s') + (o.done ? ' ✓' : '');
        draw.text(ctx, 't = ' + tm(st.a), XA + 40, TOP + 16, { align: 'left', size: 13, weight: 700, color: colors.text, bg: 'rgba(11,18,32,0.85)' });
        draw.text(ctx, 't = ' + tm(st.b), XB + 40, TOP + 16, { align: 'left', size: 13, weight: 700, color: colors.text, bg: 'rgba(11,18,32,0.85)' });
        draw.text(ctx, st.copper ? 'copper pipe, 1.5 m' : 'plastic pipe, 1.5 m', 340, TOP + LEN * PX / 2, { size: 11.5, color: colors.muted });
        if (Number.isFinite(vt)) draw.text(ctx, 'terminal speed ≈ ' + ft(vt, 2) + ' m/s', 340, TOP + LEN * PX / 2 + 18, { size: 11.5, color: colors.muted });
      },
    });

    const c = EM.controls(el);
    EM.button(
      c,
      '▶ Drop both',
      () => {
        st.a = fresh();
        st.b = fresh();
        st.running = true;
      },
      'primary'
    );
    EM.button(c, '↺ Reset', () => {
      st.a = fresh();
      st.b = fresh();
      st.running = false;
    });
    EM.slider(c, { label: 'Magnet strength', min: 0, max: 1, step: 0.05, value: 1, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => (st.strength = v) });
    EM.segmented(c, {
      label: 'Pipe',
      options: [
        { value: 'cu', label: 'Copper' },
        { value: 'pl', label: 'Plastic (insulator)' },
      ],
      value: 'cu',
      onChange: (v) => (st.copper = v === 'cu'),
    });
    EM.toggle(c, { label: 'Slow motion (¼ speed)', value: false, onChange: (v) => (st.slow = v) });
    const ro = EM.readout(el, [
      { key: 'ta', label: 'Metal cylinder time' },
      { key: 'tb', label: 'Magnet time' },
      { key: 'vb', label: 'Magnet speed' },
      { key: 'ratio', label: 'Magnet ÷ cylinder' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      ro.set('ta', st.a.t.toFixed(2) + ' s');
      ro.set('tb', st.b.t.toFixed(2) + ' s');
      ro.set('vb', st.b.v.toFixed(2) + ' m/s');
      ro.set('ratio', st.a.done && st.b.done ? (st.b.t / st.a.t).toFixed(1) + ' ×' : '–');
      if (!st.running && !st.a.done) status.set('Press <strong>Drop both</strong>. Both objects have the same size and mass.', '');
      else if (st.a.done && st.b.done)
        status.set(
          st.b.t / st.a.t > 1.3
            ? `The magnet took <strong>${(st.b.t / st.a.t).toFixed(1)} times longer</strong>: eddy currents in the pipe push up on it (Lenz’s law).`
            : 'Both fell at about the same rate — no (or weak) eddy currents to slow the magnet.',
          'good'
        );
      else if (kFor() > 0 && st.b.s > 0 && st.b.s < LEN) status.set('The falling magnet’s changing field induces <strong>eddy currents</strong> in the copper, which oppose its fall.', 'good');
      else status.set('Falling…', '');
    });
  }

  /* ------------------------------------------------------------------ SIM: back emf in a motor */

  function backEmfSim(el) {
    const W = 700,
      H = 340;
    const k = 0.05,
      R = 2,
      J = 2e-3,
      b = 2e-5,
      WIN = 8;
    const st = { V: 12, on: true, load: 0, w: 0, th: 0, I: 0, hist: [], flow: 0 };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A DC motor speeding up while its back emf grows',
      draw(ctx, s, dt) {
        const V = st.on ? st.V : 0;
        if (dt > 0) {
          const n = 5,
            h_ = dt / n;
          for (let i = 0; i < n; i++) {
            const I = (V - k * st.w) / R;
            let torque = k * I - b * st.w - st.load;
            if (st.w <= 0 && torque < 0) {
              st.w = 0;
              torque = 0;
            }
            st.w = Math.max(0, st.w + (torque / J) * h_);
          }
        }
        st.I = (V - k * st.w) / R;
        const Vind = k * st.w;
        st.th += st.w * dt * 0.05;
        st.flow += st.I * 18 * dt;
        if (dt > 0) pushHist(st.hist, { t: s.t, vi: V, vb: Vind, ve: V - Vind, I: st.I }, WIN);

        draw.grid(ctx, W, H);
        // circuit
        const A = [
          [60, 166],
          [60, 60],
          [124, 60],
        ];
        const B = [
          [176, 60],
          [240, 60],
          [240, 112],
        ];
        const Cc = [
          [240, 228],
          [240, 290],
          [60, 290],
          [60, 174],
        ];
        [A, B, Cc].forEach((p) => draw.wire(ctx, p));
        if (Math.abs(st.I) > 0.02) [A, B, Cc].forEach((p) => draw.flowDots(ctx, p, st.flow, { speed: 1 }));
        draw.cell(ctx, 60, 170, { vertical: true, label: st.on ? `V = ${st.V} V` : 'switched off' });
        draw.meter(ctx, 150, 60, st.I / 6, { r: 26, label: 'A', centerZero: false });
        draw.text(ctx, 'I = ' + ft(st.I, 2) + ' A', 150, 82, { size: 12, weight: 600 });
        // motor
        ctx.save();
        ctx.fillStyle = '#111827';
        ctx.strokeStyle = colors.metal;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(240, 170, 58, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = colors.north;
        ctx.fillRect(188, 145, 14, 50);
        ctx.fillStyle = colors.south;
        ctx.fillRect(278, 145, 14, 50);
        draw.text(ctx, 'N', 195, 170, { size: 11, weight: 800, color: '#fff' });
        draw.text(ctx, 'S', 285, 170, { size: 11, weight: 800, color: '#fff' });
        const cx = 240 + Math.cos(st.th) * 32,
          cy = 170 + Math.sin(st.th) * 32;
        draw.line(ctx, 480 - cx, 340 - cy, cx, cy, COPPER, 5);
        ctx.fillStyle = colors.text;
        ctx.beginPath();
        ctx.arc(240, 170, 4, 0, TAU);
        ctx.fill();
        draw.text(ctx, 'back emf = ' + ft(Vind, 2) + ' V', 240, 252, { size: 12, color: colors.bfield, weight: 700, bg: 'rgba(11,18,32,0.85)' });
        draw.text(ctx, Math.round((st.w * 60) / TAU) + ' rpm', 240, 316, { size: 12, color: colors.muted });
        // graph
        const r = { x: 400, y: 30, w: 280, h: 222 };
        const now = s.t;
        draw.plot(ctx, r, {
          xMin: -WIN,
          xMax: 0,
          yMin: 0,
          yMax: 14,
          title: 'After switching on',
          xLabel: 'time (s)',
          series: [
            { points: pts(st.hist, now, 'vi'), color: colors.muted, width: 2, dash: [6, 4] },
            { points: pts(st.hist, now, 'vb'), color: colors.bfield, width: 2.4 },
            { points: pts(st.hist, now, 've'), color: colors.current, width: 2.4 },
            { points: pts(st.hist, now, 'I'), color: SKY, width: 2.4 },
          ],
        });
        legend(
          ctx,
          r.x - 10,
          300,
          [
            { color: colors.muted, label: 'V initial (V)', dash: [6, 4] },
            { color: colors.bfield, label: 'V induced = back emf (V)' },
            { color: colors.current, label: 'V effective (V)' },
            { color: SKY, label: 'Current I (A)' },
          ],
          150,
          20
        );
      },
    });
    const c = EM.controls(el);
    const btn = EM.button(c, '⏻ Switch off', () => {
      st.on = !st.on;
      btn.innerHTML = st.on ? '⏻ Switch off' : '⏻ Switch on';
    });
    EM.button(c, '↺ Restart from rest', () => {
      st.w = 0;
      st.on = true;
      btn.innerHTML = '⏻ Switch off';
    });
    EM.slider(c, { label: 'Supply voltage V<sub>initial</sub>', min: 0, max: 12, step: 0.5, value: 12, unit: 'V', onInput: (v) => (st.V = v) });
    EM.slider(c, { label: 'Load on the motor', min: 0, max: 0.28, step: 0.01, value: 0, fmt: (v) => (v === 0 ? 'none' : v >= 0.28 ? 'jammed' : Math.round((v / 0.3) * 100) + '%'), onInput: (v) => (st.load = v) });
    const ro = EM.readout(el, [
      { key: 'vi', label: 'V<sub>initial</sub>' },
      { key: 'vb', label: 'V<sub>induced</sub> (back emf)' },
      { key: 've', label: 'V<sub>effective</sub>' },
      { key: 'i', label: 'Current (R = 2 Ω)' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      const V = st.on ? st.V : 0;
      const Vb = k * st.w;
      ro.set('vi', EM.fmt(V, 3) + ' V');
      ro.set('vb', EM.fmt(Vb, 3) + ' V');
      ro.set('ve', EM.fmt(V - Vb, 3) + ' V');
      ro.set('i', EM.fmt(st.I, 3) + ' A');
      if (!st.on) status.set('Supply off: the spinning motor is now acting like a <strong>generator</strong> — it still has an induced emf while it slows down.', '');
      else if (st.w < 1 && V > 0) status.set('Stalled / just switched on: <strong>no back emf</strong> yet, so the current is very large. (This is why jammed motors overheat.)', 'warn');
      else if (V > 0 && (V - Vb) / V < 0.25) status.set('Full speed: back emf is almost as big as the supply, so V<sub>effective</sub> and the current are small.', 'good');
      else status.set('Speeding up: the faster it spins, the bigger the back emf, so V<sub>effective</sub> and the current fall.', 'good');
    });
  }

  /* ------------------------------------------------------------------ SIM: AC / DC generator */

  function generatorSim(el) {
    const W = 720,
      H = 400;
    const CX = 190,
      CY = 135,
      R = 62,
      NBA = 0.2,
      WIN = 4;
    const st = { alpha: 0, f: 0.5, mode: 'slip', frozen: false, hist: [], flow: 0 };
    const out = () => {
      const E = NBA * TAU * st.f * Math.cos(st.alpha);
      const V = st.mode === 'slip' ? E : Math.abs(E);
      return { E, V };
    };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'End-on view of a generator coil rotating between magnet poles with the output graph',
      draw(ctx, s, dt) {
        if (!st.frozen) {
          st.alpha += TAU * st.f * dt;
          const o = out();
          st.flow += o.V * 60 * dt;
          if (dt > 0) pushHist(st.hist, { t: s.t, v: o.V }, WIN);
          st.now = s.t;
        }
        const { E, V } = out();
        const th = Math.PI - st.alpha; // position angle of wire 1 (maths angle)
        draw.grid(ctx, W, H);
        // poles
        ctx.fillStyle = colors.north;
        draw.roundRect(ctx, 18, 40, 72, 190, 6);
        ctx.fill();
        ctx.fillStyle = colors.south;
        draw.roundRect(ctx, 290, 40, 72, 190, 6);
        ctx.fill();
        draw.text(ctx, 'N', 54, 135, { size: 28, weight: 800, color: '#fff' });
        draw.text(ctx, 'S', 326, 135, { size: 28, weight: 800, color: '#fff' });
        for (let y = 58; y <= 214; y += 26) draw.arrow(ctx, 94, y, 286, y, { color: 'rgba(167,139,250,0.45)', width: 1.4, head: 7 });
        // coil end-on
        const p1 = [CX + R * Math.cos(th), CY - R * Math.sin(th)];
        const p2 = [CX - R * Math.cos(th), CY + R * Math.sin(th)];
        draw.line(ctx, p1[0], p1[1], p2[0], p2[1], COPPER, 4);
        ctx.fillStyle = colors.text;
        ctx.beginPath();
        ctx.arc(CX, CY, 4, 0, TAU);
        ctx.fill();
        const mag = Math.abs(E) / (NBA * TAU * 1.5);
        const d1 = Math.abs(E) < 1e-3 ? 0 : E > 0 ? -1 : 1;
        wireEnd(ctx, p1[0], p1[1], d1, 11, mag * 1.5);
        wireEnd(ctx, p2[0], p2[1], -d1, 11, mag * 1.5);
        const lab = (p, t) => {
          const dx = p[0] - CX,
            dy = p[1] - CY,
            m = Math.hypot(dx, dy) || 1;
          draw.text(ctx, t, p[0] + (dx / m) * 24, p[1] + (dy / m) * 24, { size: 13, weight: 800, color: colors.current, bg: 'rgba(11,18,32,0.75)' });
        };
        lab(p1, '1');
        lab(p2, '2');
        if (st.f > 0) {
          const vx = Math.sin(th),
            vy = Math.cos(th);
          draw.arrow(ctx, p1[0], p1[1], p1[0] + vx * 30, p1[1] + vy * 30, { color: colors.velocity, width: 2.2, head: 8 });
          draw.arrow(ctx, p2[0], p2[1], p2[0] - vx * 30, p2[1] - vy * 30, { color: colors.velocity, width: 2.2, head: 8 });
        }
        // commutator inset
        const ringY = 300;
        let tA, tB;
        if (st.mode === 'slip') {
          [
            [150, '#f59e0b', 'ring 1'],
            [230, TEAL, 'ring 2'],
          ].forEach(([x, col, name]) => {
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(x, ringY, 20, 0, TAU);
            ctx.stroke();
            ctx.restore();
            draw.line(ctx, x, ringY, x + 20 * Math.cos(-th), ringY + 20 * Math.sin(-th), col, 2);
            ctx.fillStyle = '#334155';
            ctx.fillRect(x - 7, ringY + 23, 14, 10);
            draw.text(ctx, name, x, ringY - 34, { size: 11, color: col });
          });
          tA = [150, ringY + 33];
          tB = [230, ringY + 33];
          draw.text(ctx, 'Slip rings (each coil end keeps its own ring)', CX, 254, { size: 11.5, color: colors.muted });
        } else {
          const a0 = -th;
          ctx.save();
          ctx.lineWidth = 7;
          ctx.strokeStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(CX, ringY, 24, a0 - Math.PI / 2 + 0.12, a0 + Math.PI / 2 - 0.12);
          ctx.stroke();
          ctx.strokeStyle = TEAL;
          ctx.beginPath();
          ctx.arc(CX, ringY, 24, a0 + Math.PI / 2 + 0.12, a0 + (3 * Math.PI) / 2 - 0.12);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#334155';
          ctx.fillRect(CX - 42, ringY - 6, 12, 12);
          ctx.fillRect(CX + 30, ringY - 6, 12, 12);
          draw.text(ctx, 'Split ring: halves swap brushes every half turn', CX, 254, { size: 11.5, color: colors.muted });
          tA = [CX - 36, ringY + 6];
          tB = [CX + 36, ringY + 6];
        }
        draw.text(ctx, 'orange = coil end 1, teal = coil end 2', CX, 270, { size: 10.5, color: colors.muted });
        // output circuit
        const pA = [tA, [tA[0], 386], [350, 386], [350, 352]];
        const pB = [tB, [tB[0], 368], [290, 368], [290, 352]];
        draw.wire(ctx, pA);
        draw.wire(ctx, pB);
        if (Math.abs(V) > 0.02) {
          draw.flowDots(ctx, pA, st.flow, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, pB.slice().reverse(), st.flow, { speed: 1, r: 2.6 });
        }
        draw.meter(ctx, 320, 345, V / (NBA * TAU * 1.5), { r: 30, label: 'V' });
        draw.text(ctx, st.mode === 'slip' ? 'AC output' : 'DC output', 400, 340, { size: 12, weight: 700, color: st.mode === 'slip' ? colors.efield : colors.good });
        // graph
        const now = st.now || s.t;
        const r = { x: 450, y: 40, w: 250, h: 300 };
        const ym = 2;
        draw.plot(ctx, r, {
          xMin: -WIN,
          xMax: 0,
          yMin: -ym,
          yMax: ym,
          title: 'Output voltage (V)',
          xLabel: 'time (s)',
          series: [{ points: pts(st.hist, now, 'v'), color: st.mode === 'slip' ? colors.efield : colors.good, width: 2.4 }],
          markers: [{ x: 0, y: V, color: '#fff', r: 4.5 }],
        });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Commutator',
      options: [
        { value: 'slip', label: 'Slip rings (AC generator)' },
        { value: 'split', label: 'Split ring (DC generator)' },
      ],
      value: 'slip',
      onChange: (v) => (st.mode = v),
    });
    EM.slider(c, { label: 'Turbine speed', min: 0, max: 1.5, step: 0.05, value: 0.5, unit: 'rev/s', onInput: (v) => (st.f = v) });
    const c2 = EM.controls(el);
    const fr = EM.button(c2, '⏸ Freeze frame', () => {
      st.frozen = !st.frozen;
      fr.innerHTML = st.frozen ? '▶ Play' : '⏸ Freeze frame';
    });
    const snap = (a) => {
      st.alpha = a;
      st.frozen = true;
      fr.innerHTML = '▶ Play';
    };
    EM.button(c2, 'Image 1: wire 1 near N, moving up', () => snap(0));
    EM.button(c2, 'Image 2: wire 1 near S, moving down', () => snap(Math.PI));
    const ro = EM.readout(el, [
      { key: 'ang', label: 'Coil angle turned' },
      { key: 'v', label: 'Output now' },
      { key: 'pk', label: 'Peak V<sub>0</sub> = NBAω' },
      { key: 'f', label: 'Frequency' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      const { E, V } = out();
      const deg = Math.round((((st.alpha * 180) / Math.PI) % 360 + 360) % 360);
      ro.set('ang', deg + '°');
      ro.set('v', EM.fmt(V, 3) + ' V');
      ro.set('pk', EM.fmt(NBA * TAU * st.f, 3) + ' V');
      ro.set('f', EM.fmt(st.f, 2) + ' Hz');
      const c = Math.cos(st.alpha);
      if (st.f === 0) status.set('Coil not turning → no change of flux → <strong>no emf</strong>.', '');
      else if (Math.abs(c) < 0.2) status.set('Coil face-on to the field: wires move <strong>along</strong> the field lines → emf ≈ 0. ' + (st.mode === 'slip' ? 'Current is about to reverse.' : 'The split ring swaps brushes right now.'), 'warn');
      else
        status.set(
          `Wire 1 is moving <strong>${c > 0 ? 'up' : 'down'}</strong> near the <strong>${c > 0 ? 'N' : 'S'} pole</strong>, cutting the field → ` +
            (st.mode === 'slip' ? `current flows ${E > 0 ? 'one way' : 'the opposite way'} (AC).` : 'the split ring keeps the output the same way round (DC).'),
          'good'
        );
    });
  }

  /* ------------------------------------------------------------------ SIM: high-voltage transmission */

  function transmissionSim(el) {
    const W = 720,
      H = 250;
    const P = 20e6,
      Rc = 5;
    const st = { kV: 400, flow: 0 };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Power station, step-up transformer, transmission line, step-down transformers and a house',
      draw(ctx, s, dt) {
        const I = P / (st.kV * 1000);
        const loss = I * I * Rc;
        const frac = Math.min(1, loss / P);
        st.flow += (20 + I * 0.25) * dt;
        draw.grid(ctx, W, H);
        // power station
        ctx.fillStyle = '#475569';
        ctx.fillRect(20, 120, 70, 70);
        ctx.fillRect(30, 80, 12, 40);
        ctx.fillRect(56, 90, 12, 30);
        draw.text(ctx, 'Power station', 55, 206, { size: 11.5, weight: 600 });
        draw.text(ctx, '12 kV', 55, 222, { size: 11, color: colors.muted });
        // transformers
        const tbox = (x, label, sub) => {
          ctx.fillStyle = '#334155';
          ctx.strokeStyle = colors.metal;
          ctx.lineWidth = 2;
          ctx.fillRect(x - 20, 140, 40, 40);
          ctx.strokeRect(x - 20, 140, 40, 40);
          draw.text(ctx, '⚡', x, 160, { size: 14 });
          draw.text(ctx, label, x, 206, { size: 11.5, weight: 600 });
          draw.text(ctx, sub, x, 222, { size: 11, color: colors.muted });
        };
        tbox(135, 'Step-up', '12 kV → ' + st.kV + ' kV');
        tbox(580, 'Step-down', '→ 13 kV → 230 V');
        // pylons
        const pyl = [220, 345, 470];
        for (const x of pyl) {
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - 18, 190);
          ctx.lineTo(x, 72);
          ctx.lineTo(x + 18, 190);
          ctx.moveTo(x - 24, 82);
          ctx.lineTo(x + 24, 82);
          ctx.moveTo(x - 12, 140);
          ctx.lineTo(x + 12, 140);
          ctx.stroke();
        }
        // line with sag
        const line = [[155, 150]];
        const nodes = [[220, 82], [345, 82], [470, 82], [560, 150]];
        let prev = [220, 82];
        line.push(prev);
        for (let i = 1; i < nodes.length; i++) {
          const nx = nodes[i];
          for (let j = 1; j <= 12; j++) {
            const t = j / 12;
            const sag = i < 3 ? 18 * Math.sin(Math.PI * t) : 0;
            line.push([prev[0] + (nx[0] - prev[0]) * t, prev[1] + (nx[1] - prev[1]) * t + sag]);
          }
          prev = nx;
        }
        const hot = `rgb(${Math.round(250)},${Math.round(204 - 160 * frac)},${Math.round(21 + 20 * frac)})`;
        ctx.save();
        ctx.shadowColor = colors.bad;
        ctx.shadowBlur = 30 * frac;
        draw.wire(ctx, line, frac > 0.02 ? hot : colors.wire, 2 + 4 * frac);
        ctx.restore();
        draw.flowDots(ctx, line, st.flow, { speed: 1, r: 2 + Math.min(2, I / 400), spacing: 26 });
        draw.wire(ctx, [[90, 160], [115, 160]]);
        draw.wire(ctx, [[600, 160], [650, 160]]);
        // house
        ctx.fillStyle = '#64748b';
        ctx.fillRect(650, 140, 50, 50);
        ctx.fillStyle = '#b91c1c';
        ctx.beginPath();
        ctx.moveTo(644, 140);
        ctx.lineTo(675, 112);
        ctx.lineTo(706, 140);
        ctx.closePath();
        ctx.fill();
        draw.text(ctx, 'Home', 675, 206, { size: 11.5, weight: 600 });
        draw.text(ctx, '230 V', 675, 222, { size: 11, color: colors.muted });
        draw.text(ctx, `Transmission line at ${st.kV} kV:  I = P ÷ V = ${ft(I, 3)} A`, 345, 30, { size: 12.5, weight: 600 });
        draw.text(ctx, `heat lost in cables = I²R = ${ft(loss / 1000, 3)} kW  (${ft(frac * 100, 2)} % of 20 MW)`, 345, 48, { size: 12, color: frac > 0.05 ? colors.warn : colors.good });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Transmission voltage', min: 20, max: 400, step: 10, value: 400, unit: 'kV', onInput: (v) => (st.kV = v) });
    const ro = EM.readout(el, [
      { key: 'p', label: 'Power sent' },
      { key: 'i', label: 'Current in cables' },
      { key: 'l', label: 'Heat loss (R = 5 Ω)' },
      { key: 'd', label: 'Power delivered' },
    ]);
    EM.every(150, () => {
      const I = P / (st.kV * 1000),
        loss = I * I * Rc;
      ro.set('p', '20 MW');
      ro.set('i', EM.fmt(I, 3) + ' A');
      ro.set('l', EM.fmt(loss / 1e6, 3) + ' MW');
      ro.set('d', EM.fmt((P - loss) / 1e6, 4) + ' MW');
    });
    EM.status(el, 'Same power, higher voltage → smaller current → much less heat lost (heat loss = I²R, so halving the current quarters the loss).');
  }

  /* ------------------------------------------------------------------ SIM: DC vs AC graphs */

  function dcAcGraphs(el) {
    EM.canvas(el, {
      width: 700,
      height: 230,
      label: 'Graph of DC (steady 230 V) and AC (sine wave peaking at 325 V)',
      draw(ctx, s) {
        draw.grid(ctx, 700, 230);
        const T = (s.t * 0.25) % 0.04; // slowed: one 50 Hz cycle every 4 s… shown as a moving dot
        const ac = (t) => 325 * Math.sin(TAU * 50 * t);
        const o = { xMin: 0, xMax: 0.04, yMin: -380, yMax: 380, xLabel: 't (s)', xTicks: 4, yTicks: 4 };
        draw.plot(ctx, { x: 60, y: 28, w: 250, h: 160 }, { ...o, title: 'DC', series: [{ fn: () => 230, color: SKY, width: 2.5 }], markers: [{ x: T, y: 230, color: SKY, r: 4.5 }] });
        draw.plot(ctx, { x: 420, y: 28, w: 250, h: 160 }, {
          ...o,
          title: 'AC (Irish mains, 50 Hz)',
          series: [{ fn: ac, color: colors.pos, width: 2.5 }],
          hLines: [
            { y: 230, color: SKY, label: 'V rms = 230 V' },
            { y: 325, color: colors.muted, label: 'V₀ ≈ 325 V' },
          ],
          markers: [{ x: T, y: ac(T), color: colors.pos, r: 4.5 }],
        });
      },
    });
  }

  /* ------------------------------------------------------------------ SIM: RMS explorer */

  function rmsSim(el) {
    const W = 720,
      H = 390,
      Rb = 529; // 100 W bulb at 230 V
    const st = { V0: 325, Vdc: 325 };
    const Pmax = (400 * 400) / Rb;
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Voltage, voltage squared and rms of a sine wave, with AC and DC bulbs compared',
      draw(ctx, s) {
        const V0 = st.V0,
          Vr = V0 / Math.SQRT2;
        const T = (s.t * 0.01) % 0.04; // slowed 100×
        const v = (t) => V0 * Math.sin(TAU * 50 * t);
        draw.grid(ctx, W, H);
        const r1 = { x: 70, y: 30, w: 420, h: 140 };
        const r2 = { x: 70, y: 222, w: 420, h: 118 };
        draw.plot(ctx, r1, {
          xMin: 0,
          xMax: 0.04,
          yMin: -420,
          yMax: 420,
          title: 'Voltage V (volts) — mean value is 0',
          series: [{ fn: v, color: colors.pos, width: 2.5 }],
          hLines: [
            { y: V0, color: colors.muted, label: 'V₀ = ' + Math.round(V0) + ' V' },
            { y: Vr, color: SKY, label: 'V rms = ' + Math.round(Vr) + ' V' },
            { y: -Vr, color: SKY },
          ],
          markers: [{ x: T, y: v(T), color: '#fff', r: 4.5 }],
          xTicks: 4,
          yTicks: 4,
        });
        const sq = (t) => (v(t) * v(t)) / 1000;
        draw.plot(ctx, r2, {
          xMin: 0,
          xMax: 0.04,
          yMin: 0,
          yMax: 170,
          title: 'Squared: V² (×1000 V²) — always positive',
          xLabel: 'time (s)',
          series: [{ fn: sq, color: colors.efield, width: 2.5 }],
          hLines: [{ y: (V0 * V0) / 2000, color: colors.good, label: 'mean of V² = V₀²/2', dash: [6, 3] }],
          markers: [{ x: T, y: sq(T), color: '#fff', r: 4.5 }],
          xTicks: 4,
          yTicks: 4,
        });
        // bulbs
        const pInst = (v(T) * v(T)) / Rb;
        const pAc = (Vr * Vr) / Rb,
          pDc = (st.Vdc * st.Vdc) / Rb;
        draw.bulb(ctx, 565, 80, pInst / Pmax, { r: 22 });
        draw.bulb(ctx, 665, 80, pDc / Pmax, { r: 22 });
        draw.text(ctx, 'AC bulb', 565, 120, { size: 12, weight: 600 });
        draw.text(ctx, 'DC bulb', 665, 120, { size: 12, weight: 600 });
        draw.text(ctx, 'V₀ = ' + Math.round(V0) + ' V', 565, 136, { size: 11, color: colors.muted });
        draw.text(ctx, 'V = ' + Math.round(st.Vdc) + ' V', 665, 136, { size: 11, color: colors.muted });
        draw.text(ctx, 'Average heating', 615, 168, { size: 12, weight: 600 });
        const bar = (x, p, col) => {
          const hh = 150;
          ctx.fillStyle = 'rgba(148,163,184,0.15)';
          ctx.fillRect(x - 16, 190, 32, hh);
          const f = EM.clamp(p / Pmax, 0, 1);
          ctx.fillStyle = col;
          ctx.fillRect(x - 16, 190 + hh * (1 - f), 32, hh * f);
          draw.text(ctx, ft(p, 3) + ' W', x, 356, { size: 12, weight: 700 });
        };
        bar(565, pAc, colors.pos);
        bar(665, pDc, SKY);
        draw.text(ctx, '(slowed down 100×)', 280, 378, { size: 10.5, color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'AC peak voltage V<sub>0</sub>', min: 0, max: 400, step: 5, value: 325, unit: 'V', onInput: (v) => (st.V0 = v) });
    EM.slider(c, { label: 'DC voltage — make the heating match!', min: 0, max: 400, step: 5, value: 325, unit: 'V', onInput: (v) => (st.Vdc = v) });
    const ro = EM.readout(el, [
      { key: 'mean', label: 'Mean of V' },
      { key: 'msq', label: 'Mean of V²' },
      { key: 'rms', label: 'V<sub>rms</sub> = √(mean V²)' },
      { key: 'chk', label: 'V<sub>0</sub> ÷ √2' },
    ]);
    const status = EM.status(el);
    EM.every(150, () => {
      const Vr = st.V0 / Math.SQRT2;
      ro.set('mean', '0 V');
      ro.set('msq', EM.fmt((st.V0 * st.V0) / 2, 4) + ' V²');
      ro.set('rms', EM.fmt(Vr, 4) + ' V');
      ro.set('chk', EM.fmt(Vr, 4) + ' V');
      const pAc = (Vr * Vr) / Rb,
        pDc = (st.Vdc * st.Vdc) / Rb;
      if (st.V0 === 0) status.set('Turn up the AC peak voltage.', '');
      else if (Math.abs(pDc - pAc) / pAc < 0.04) status.set(`Match! A steady <strong>${Math.round(st.Vdc)} V DC</strong> heats the bulb exactly as much as AC with peak ${Math.round(st.V0)} V — that DC value is the <strong>rms</strong> voltage.`, 'good');
      else if (pDc > pAc) status.set('The DC bulb is heating <strong>more</strong> than the AC one. Lower the DC voltage.' + (Math.abs(st.Vdc - st.V0) < 3 ? ' (DC at the <em>peak</em> value gives double the power!)' : ''), 'warn');
      else status.set('The DC bulb is heating <strong>less</strong> than the AC one. Raise the DC voltage.', 'warn');
    });
  }

  /* ------------------------------------------------------------------ SIM: transformer */

  function transformerSim(el) {
    const W = 720,
      H = 350;
    const st = { Np: 1000, Ns: 50, Vp: 230, R: 10, eff: 100, ph: 0, fluxOff: 0, fp: 0, fs: 0 };
    const calc = () => {
      const Vs = (st.Vp * st.Ns) / st.Np;
      const Is = Vs / st.R;
      const Ps = Vs * Is;
      const Pin = Ps / (st.eff / 100);
      const Ip = st.Vp > 0 ? Pin / st.Vp : 0;
      return { Vs, Is, Ps, Pin, Ip };
    };
    const coil = (ctx, x, n, half) => {
      ctx.save();
      ctx.strokeStyle = COPPER;
      ctx.lineWidth = half === 'back' ? 1.6 : 2.6;
      ctx.globalAlpha = half === 'back' ? 0.5 : 1;
      for (let i = 0; i < n; i++) {
        const y = 124 + ((i + 0.5) * 112) / n;
        ctx.beginPath();
        ctx.ellipse(x, y, 40, 6, 0, half === 'back' ? Math.PI : 0, half === 'back' ? TAU : Math.PI);
        ctx.stroke();
      }
      ctx.restore();
    };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A transformer with primary and secondary coils on a soft iron core',
      draw(ctx, s, dt) {
        const r = calc();
        st.ph += TAU * 0.6 * dt;
        const sinp = Math.sin(st.ph);
        const sc = (I) => (I > 0 ? EM.clamp(0.35 + 0.3 * Math.log10(1 + I * 10), 0.2, 1) : 0);
        st.fluxOff += 70 * Math.cos(st.ph) * (st.Vp > 0 ? 1 : 0) * dt;
        st.fp += 60 * sinp * sc(r.Ip) * dt;
        st.fs += 60 * sinp * sc(r.Is) * dt;
        draw.grid(ctx, W, H);
        // core
        ctx.fillStyle = '#64748b';
        draw.roundRect(ctx, 230, 60, 260, 240, 6);
        ctx.fill();
        ctx.fillStyle = colors.bg;
        ctx.fillRect(290, 120, 140, 120);
        const maxN = Math.max(st.Np, st.Ns);
        const nP = EM.clamp(Math.round((st.Np / maxN) * 16), 2, 16);
        const nS = EM.clamp(Math.round((st.Ns / maxN) * 16), 2, 16);
        coil(ctx, 260, nP, 'back');
        coil(ctx, 460, nS, 'back');
        // flux path (violet dots circulating, reversing with the AC)
        const loop = [
          [260, 90],
          [460, 90],
          [460, 270],
          [260, 270],
          [260, 90],
        ];
        ctx.save();
        ctx.setLineDash([6, 6]);
        draw.wire(ctx, loop, 'rgba(167,139,250,0.35)', 1.5);
        ctx.restore();
        if (st.Vp > 0) draw.flowDots(ctx, loop, st.fluxOff, { speed: 1, color: colors.bfield, r: 3, spacing: 30 });
        coil(ctx, 260, nP, 'front');
        coil(ctx, 460, nS, 'front');
        draw.text(ctx, 'soft iron core', 360, 285, { size: 11.5, color: '#0f172a', weight: 700 });
        draw.text(ctx, 'alternating', 360, 172, { size: 11.5, color: colors.bfield });
        draw.text(ctx, 'magnetic flux', 360, 188, { size: 11.5, color: colors.bfield });
        draw.text(ctx, `Primary: Np = ${st.Np}`, 260, 40, { size: 12.5, weight: 700 });
        draw.text(ctx, `Secondary: Ns = ${st.Ns}`, 460, 40, { size: 12.5, weight: 700 });
        // circuits
        const pT = [
          [222, 124],
          [90, 124],
          [90, 158],
        ];
        const pB = [
          [90, 202],
          [90, 236],
          [222, 236],
        ];
        const sT = [
          [498, 124],
          [630, 124],
          [630, 156],
        ];
        const sB = [
          [630, 204],
          [630, 236],
          [498, 236],
        ];
        [pT, pB, sT, sB].forEach((p) => draw.wire(ctx, p));
        if (st.Vp > 0) {
          draw.flowDots(ctx, pT, st.fp, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, pB, st.fp, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, sT, st.fs, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, sB, st.fs, { speed: 1, r: 2.6 });
        }
        ctx.save();
        ctx.strokeStyle = colors.wire;
        ctx.fillStyle = colors.bg;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(90, 180, 22, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const x = 78 + (i / 20) * 24;
          const y = 180 - 7 * Math.sin((i / 20) * TAU);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
        draw.text(ctx, 'AC supply', 90, 262, { size: 11.5, color: colors.muted });
        draw.bulb(ctx, 630, 180, EM.clamp(Math.log10(1 + r.Ps) / 2.3, 0, 1), { r: 22 });
        draw.text(ctx, `load ${ft(st.R, 3)} Ω`, 630, 262, { size: 11.5, color: colors.muted });
        draw.text(ctx, 'Vp = ' + ft(st.Vp, 3) + ' V', 165, 168, { size: 12.5, weight: 700, color: colors.efield });
        draw.text(ctx, 'Ip = ' + ft(r.Ip, 3) + ' A', 165, 188, { size: 12, color: colors.text });
        draw.text(ctx, 'Vs = ' + ft(r.Vs, 3) + ' V', 555, 168, { size: 12.5, weight: 700, color: colors.efield });
        draw.text(ctx, 'Is = ' + ft(r.Is, 3) + ' A', 555, 188, { size: 12, color: colors.text });
        const type = st.Ns > st.Np ? 'STEP-UP: more turns on secondary → Vs > Vp' : st.Ns < st.Np ? 'STEP-DOWN: fewer turns on secondary → Vs < Vp' : 'Equal turns → Vs = Vp';
        draw.text(ctx, type, 360, 326, { size: 13, weight: 800, color: st.Ns > st.Np ? colors.warn : st.Ns < st.Np ? SKY : colors.text });
      },
    });
    const lg = (n) => Math.log10(n);
    const c = EM.controls(el);
    const sNp = EM.slider(c, { label: 'Primary turns N<sub>p</sub>', min: 1, max: 4.4, step: 0.005, value: lg(st.Np), fmt: (v) => String(Math.round(10 ** v)), onInput: (v) => (st.Np = Math.round(10 ** v)) });
    const sNs = EM.slider(c, { label: 'Secondary turns N<sub>s</sub>', min: 1, max: 4.4, step: 0.005, value: lg(st.Ns), fmt: (v) => String(Math.round(10 ** v)), onInput: (v) => (st.Ns = Math.round(10 ** v)) });
    const sVp = EM.slider(c, { label: 'Primary voltage V<sub>p</sub>', min: 0, max: 400, step: 1, value: st.Vp, unit: 'V', onInput: (v) => (st.Vp = v) });
    const c2 = EM.controls(el);
    const sR = EM.slider(c2, { label: 'Load resistance', min: 0, max: 6, step: 0.01, value: 1, fmt: (v) => EM.fmt(10 ** v, 3), unit: 'Ω', onInput: (v) => (st.R = 10 ** v) });
    EM.slider(c2, { label: 'Efficiency', min: 70, max: 100, step: 1, value: 100, unit: '%', onInput: (v) => (st.eff = v) });
    const c3 = EM.controls(el);
    const preset = (Np, Ns, Vp, Rl) => {
      st.Np = Np;
      st.Ns = Ns;
      st.Vp = Vp;
      st.R = Rl;
      sNp.set(lg(Np));
      sNs.set(lg(Ns));
      sVp.set(Vp);
      sR.set(lg(Rl));
    };
    EM.button(c3, '📱 Phone charger 230 V → 3.7 V', () => preset(3100, 50, 230, 2));
    EM.button(c3, '🍲 Microwave magnetron ≈ 4 000 V', () => preset(115, 2000, 230, 4000));
    EM.button(c3, '🩻 X-ray tube ≈ 50 000 V', () => preset(46, 10000, 230, 1e6));
    EM.button(c3, '🔬 Lab demo 6 V → 12 V', () => preset(400, 800, 6, 100));
    const ro = EM.readout(el, [
      { key: 'ratio', label: 'N<sub>p</sub> : N<sub>s</sub>' },
      { key: 'vs', label: 'V<sub>s</sub> = V<sub>p</sub>N<sub>s</sub>/N<sub>p</sub>' },
      { key: 'ps', label: 'P<sub>out</sub> = V<sub>s</sub>I<sub>s</sub>' },
      { key: 'pin', label: 'P<sub>in</sub> = V<sub>p</sub>I<sub>p</sub>' },
      { key: 'heat', label: 'Lost as heat' },
    ]);
    EM.every(150, () => {
      const r = calc();
      ro.set('ratio', st.Np >= st.Ns ? EM.fmt(st.Np / st.Ns, 3) + ' : 1' : '1 : ' + EM.fmt(st.Ns / st.Np, 3));
      ro.set('vs', EM.fmt(r.Vs, 4) + ' V');
      ro.set('ps', EM.fmt(r.Ps, 3) + ' W');
      ro.set('pin', EM.fmt(r.Pin, 3) + ' W');
      ro.set('heat', EM.fmt(r.Pin - r.Ps, 3) + ' W');
    });
    EM.status(el, 'Voltage goes up → current goes down (and vice versa): a transformer only changes the <strong>proportions</strong> of V and I. At 100 % efficiency V<sub>p</sub>I<sub>p</sub> = V<sub>s</sub>I<sub>s</sub>.');
  }

  /* ------------------------------------------------------------------ SIM: solid vs laminated core */

  function laminationSim(el) {
    const W = 680,
      H = 300;
    const st = { lam: false, n: 8, ph: 0, flows: [] };
    const losses = () => {
      const eddy = st.lam ? 80 / (st.n * st.n) : 80;
      const eff = (1000 - 20 - eddy) / 10;
      return { eddy, eff };
    };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Cross-section of a transformer core showing eddy currents in a solid and a laminated core',
      draw(ctx, s, dt) {
        st.ph += TAU * 0.5 * dt;
        const dphi = Math.cos(st.ph);
        const { eddy, eff } = losses();
        draw.grid(ctx, W, H);
        const X = 60,
          Y = 40,
          S = 230;
        ctx.fillStyle = '#475569';
        ctx.fillRect(X, Y, S, S);
        heatGlow(ctx, X + S / 2, Y + S / 2, S * 0.75, (eddy / 80) * 0.9);
        const fl = Math.sin(st.ph);
        draw.bGrid(ctx, X, Y, S, S, fl >= 0 ? 'out' : 'in', 38, `rgba(167,139,250,${0.25 + 0.6 * Math.abs(fl)})`);
        const n = st.lam ? st.n : 1;
        const pw = S / n;
        st.flows.length = n;
        for (let i = 0; i < n; i++) {
          const x0 = X + i * pw;
          const inset = st.lam ? Math.min(6, pw * 0.22) : 26;
          const loopPts = [
            [x0 + inset, Y + 22],
            [x0 + pw - inset, Y + 22],
            [x0 + pw - inset, Y + S - 22],
            [x0 + inset, Y + S - 22],
            [x0 + inset, Y + 22],
          ];
          const strength = st.lam ? 1 / n : 1;
          st.flows[i] = (st.flows[i] || 0) + 90 * dphi * Math.sqrt(strength) * dt;
          draw.wire(ctx, loopPts, `rgba(250,204,21,${0.25 + 0.5 * strength})`, 1.5);
          draw.flowDots(ctx, loopPts, st.flows[i], { speed: 1, r: st.lam ? 2 : 3.2, spacing: st.lam ? 26 : 30 });
          if (st.lam && i > 0) draw.line(ctx, x0, Y, x0, Y + S, '#fde68a', 2);
        }
        if (!st.lam) {
          const inner = [
            [X + 70, Y + 70],
            [X + S - 70, Y + 70],
            [X + S - 70, Y + S - 70],
            [X + 70, Y + S - 70],
            [X + 70, Y + 70],
          ];
          draw.wire(ctx, inner, 'rgba(250,204,21,0.6)', 1.5);
          draw.flowDots(ctx, inner, st.flows[0] * 0.6, { speed: 1, r: 3, spacing: 26 });
        }
        draw.text(ctx, st.lam ? `Laminated core: ${st.n} insulated plates` : 'Solid iron block', X + S / 2, Y - 18, { size: 12.5, weight: 700 });
        draw.text(ctx, 'Core cross-section, flux alternates ⊙ / ⊗', X + S / 2, Y + S + 18, { size: 11, color: colors.muted });
        // bars
        const bx = 360,
          bw = 290;
        draw.text(ctx, 'Eddy-current heat loss (1 kW transformer)', bx, 70, { align: 'left', size: 12.5, weight: 600 });
        ctx.fillStyle = 'rgba(148,163,184,0.15)';
        ctx.fillRect(bx, 84, bw, 20);
        ctx.fillStyle = colors.bad;
        ctx.fillRect(bx, 84, (bw * eddy) / 80, 20);
        draw.text(ctx, ft(eddy, 3) + ' W', bx + bw, 120, { align: 'right', size: 12, weight: 700 });
        draw.text(ctx, 'Efficiency = P_out ÷ P_in × 100 %', bx, 160, { align: 'left', size: 12.5, weight: 600 });
        ctx.fillStyle = 'rgba(148,163,184,0.15)';
        ctx.fillRect(bx, 174, bw, 20);
        ctx.fillStyle = colors.good;
        ctx.fillRect(bx, 174, (bw * (eff - 80)) / 20, 20);
        draw.text(ctx, ft(eff, 3) + ' %', bx + bw, 210, { align: 'right', size: 12, weight: 700 });
        draw.text(ctx, '(bar starts at 80 %)', bx, 210, { align: 'left', size: 10.5, color: colors.muted });
        draw.text(ctx, 'Other losses (resistance of the copper coils) fixed at 20 W', bx, 250, { align: 'left', size: 11, color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Core',
      options: [
        { value: 'solid', label: 'Solid iron block' },
        { value: 'lam', label: 'Laminated plates' },
      ],
      value: 'solid',
      onChange: (v) => (st.lam = v === 'lam'),
    });
    EM.slider(c, { label: 'Number of plates', min: 2, max: 20, step: 1, value: 8, onInput: (v) => (st.n = v) });
    const status = EM.status(el);
    EM.every(200, () => {
      const { eddy, eff } = losses();
      status.set(
        st.lam
          ? `Insulating glue between the plates breaks the big loops into thin ones → eddy loss falls to <strong>${EM.fmt(eddy, 3)} W</strong>, efficiency <strong>${EM.fmt(eff, 3)} %</strong>.`
          : `Big eddy currents circulate through the whole block → <strong>${EM.fmt(eddy, 3)} W</strong> wasted as heat, efficiency only <strong>${EM.fmt(eff, 3)} %</strong>.`,
        st.lam ? 'good' : 'warn'
      );
    });
  }

  /* ------------------------------------------------------------------ SIM: mutual induction */

  function mutualSim(el) {
    const W = 720,
      H = 380,
      I0 = 2,
      TAU_L = 0.12,
      WIN = 5;
    const st = { mode: 'ac', on: true, f: 0.6, gap: 90, Ip: 0, pIp: 0, dI: 0, ph: 0, hist: [], fp: 0, fs: 0 };
    const needle = makeNeedle();
    const Mfor = () => 5e-3 / (1 + ((st.gap - 70) / 50) ** 2); // henry
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Two coils: the bottom one connected to a supply, the top one to a galvanometer',
      draw(ctx, s, dt) {
        if (dt > 0) {
          if (st.mode === 'ac') {
            st.ph += TAU * st.f * dt;
            st.Ip = st.on ? I0 * Math.sin(st.ph) : 0;
          } else st.Ip = approach(st.Ip, st.on ? I0 : 0, 1 / TAU_L, dt);
          st.dI = approach(st.dI, (st.Ip - st.pIp) / dt, 25, dt);
          st.pIp = st.Ip;
        }
        const Es = -Mfor() * st.dI * 1000; // mV
        needle.step(Es / 60, dt);
        st.fp += st.Ip * 30 * dt;
        st.fs += needle.v * 90 * dt;
        if (dt > 0) pushHist(st.hist, { t: s.t, i: st.Ip, e: Es }, WIN);

        draw.grid(ctx, W, H);
        const topY = 125,
          botY = topY + st.gap,
          ry = 26;
        // field loops from the primary
        const a = Math.abs(st.Ip) / I0;
        if (a > 0.02) {
          ctx.save();
          ctx.strokeStyle = `rgba(167,139,250,${0.15 + 0.6 * a})`;
          ctx.lineWidth = 1.5;
          for (const [ax, ay] of [
            [110, 45],
            [130, 70],
            [150, 95],
          ]) {
            ctx.beginPath();
            ctx.ellipse(180, botY, ax, Math.min(ay + st.gap * 0.35, 150), 0, 0, TAU);
            ctx.stroke();
          }
          ctx.restore();
          const d = Math.sign(st.Ip);
          draw.arrow(ctx, 180 - 20 * d, botY, 180 + 20 * d, botY, { color: colors.bfield, width: 2.5 });
          draw.text(ctx, 'B', 180, botY - ry - 8, { size: 12, weight: 700, color: colors.bfield });
        }
        solenoid(ctx, 90, 270, topY, ry, 7, 'back', 0.45);
        solenoid(ctx, 90, 270, topY, ry, 7, 'front', 1);
        solenoid(ctx, 90, 270, botY, ry, 7, 'back', 0.45);
        solenoid(ctx, 90, 270, botY, ry, 7, 'front', 1);
        // secondary circuit (top) → galvanometer
        const sL = [
          [146, 56],
          [90, 56],
          [90, topY - ry],
        ];
        const sR = [
          [270, topY - ry],
          [270, 56],
          [214, 56],
        ];
        draw.wire(ctx, sL);
        draw.wire(ctx, sR);
        if (Math.abs(needle.v) > 0.03) {
          draw.flowDots(ctx, sL, st.fs, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, sR, st.fs, { speed: 1, r: 2.6 });
        }
        draw.meter(ctx, 180, 50, needle.v, { r: 34, label: 'G' });
        draw.text(ctx, 'secondary coil', 330, topY, { align: 'left', size: 12, color: colors.muted });
        draw.text(ctx, 'primary coil', 330, botY, { align: 'left', size: 12, color: colors.muted });
        // primary circuit (bottom) → supply
        const pL = [
          [90, botY + ry],
          [90, 345],
          [155, 345],
        ];
        const pR = st.mode === 'ac' ? [[205, 345], [270, 345], [270, botY + ry]] : [[240, 345], [270, 345], [270, botY + ry]];
        draw.wire(ctx, pL);
        draw.wire(ctx, pR);
        if (Math.abs(st.Ip) > 0.03) {
          draw.flowDots(ctx, pR.slice().reverse(), st.fp, { speed: 1, r: 2.6 });
          draw.flowDots(ctx, pL.slice().reverse(), st.fp, { speed: 1, r: 2.6 });
        }
        if (st.mode === 'ac') {
          ctx.save();
          ctx.strokeStyle = colors.wire;
          ctx.lineWidth = 2.5;
          ctx.fillStyle = colors.bg;
          ctx.beginPath();
          ctx.arc(180, 345, 22, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          for (let i = 0; i <= 20; i++) {
            const x = 168 + (i / 20) * 24,
              y = 345 - 7 * Math.sin((i / 20) * TAU);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
          if (!st.on) draw.text(ctx, 'off', 222, 330, { size: 11, color: colors.muted });
        } else {
          draw.wire(ctx, [[155, 345], [161, 345]]);
          draw.cell(ctx, 165, 345, {});
          draw.wire(ctx, [[169, 345], [200, 345]]);
          draw.switch(ctx, 200, 345, 240, st.on, {});
        }
        draw.text(ctx, st.mode === 'ac' ? 'AC supply' : 'DC battery + switch', 180, 374, { size: 11.5, color: colors.muted });
        // graphs
        const now = s.t;
        let m = 10;
        for (const p of st.hist) m = Math.max(m, Math.abs(p.e));
        const ym = niceCeil(m * 1.1);
        draw.plot(ctx, { x: 440, y: 36, w: 260, h: 118 }, { xMin: -WIN, xMax: 0, yMin: -2.4, yMax: 2.4, title: 'Primary current (A)', series: [{ points: pts(st.hist, now, 'i'), color: SKY, width: 2.3 }] });
        draw.plot(ctx, { x: 440, y: 214, w: 260, h: 118 }, { xMin: -WIN, xMax: 0, yMin: -ym, yMax: ym, title: 'Induced emf in secondary (mV)', xLabel: 'time (s)', series: [{ points: pts(st.hist, now, 'e'), color: colors.current, width: 2.3 }] });
      },
    });
    const c = EM.controls(el);
    let sw;
    EM.segmented(c, {
      label: 'Primary supply',
      options: [
        { value: 'ac', label: 'AC' },
        { value: 'dc', label: 'DC (battery)' },
      ],
      value: 'ac',
      onChange: (v) => {
        st.mode = v;
        st.on = true;
        sw.innerHTML = 'Switch OFF';
      },
    });
    sw = EM.button(c, 'Switch OFF', () => {
      st.on = !st.on;
      sw.innerHTML = st.on ? 'Switch OFF' : 'Switch ON';
    });
    EM.slider(c, { label: 'AC frequency (slowed down)', min: 0.2, max: 2, step: 0.1, value: 0.6, unit: 'Hz', onInput: (v) => (st.f = v) });
    EM.slider(c, { label: 'Distance between coils', min: 70, max: 170, step: 5, value: 90, fmt: (v) => (v <= 80 ? 'close' : v >= 160 ? 'far' : Math.round(v) + ' px'), onInput: (v) => (st.gap = v) });
    const status = EM.status(el);
    EM.every(150, () => {
      const changing = Math.abs(st.dI) > 0.05;
      if (st.mode === 'ac' && st.on) status.set('AC keeps the primary’s field <strong>changing all the time</strong> → the galvanometer needle <strong>fluctuates continuously</strong> (mutual induction).', 'good');
      else if (changing) status.set('The current (and so the field) is <strong>changing</strong> right now → a brief emf is induced in the secondary. Switching on and off kick the needle opposite ways.', 'good');
      else if (st.on) status.set('Steady DC → the field is constant → <strong>no induced emf</strong>, needle at zero. Try switching off and on.', 'warn');
      else status.set('No current in the primary → no field → no induced emf.', '');
    });
  }

  /* ------------------------------------------------------------------ chapter */

  EM.chapter({
    id: 'c6',
    code: 'C.6',
    title: 'Electromagnetic Induction',
    color: '#db2777',
    blurb: 'Faraday’s and Lenz’s laws, eddy currents, back emf, AC and DC generators, peak and rms values, transformers and mutual induction.',

    terms: [
      { id: 'emf', term: 'emf (electromotive force)', def: 'In other words a <strong>voltage</strong> — the voltage produced (for example induced in a coil) that can drive a current around a circuit. Measured in volts (V).' },
      { id: 'em-induction', term: 'Electromagnetic induction', def: 'The process where an emf is induced in a conductor whenever the magnetic field passing through the conductor changes.' },
      { id: 'flux', term: 'Magnetic flux (Φ)', def: 'A measure of the amount of magnetic field passing through (“threading”) an area: Φ = B × A. Unit: the weber (Wb).' },
      { id: 'faraday-law', term: 'Faraday’s law of electromagnetic induction', def: 'Whenever there is a change in the magnetic flux threading a closed loop, an emf is induced in the loop. This emf is proportional to the rate at which the flux threading it is changing.' },
      { id: 'lenz-law', term: 'Lenz’s law of electromagnetic induction', def: 'The direction of an induced emf is such that it will always oppose the change that is causing it.' },
      { id: 'eddy', term: 'Eddy current (magnetic damping)', def: 'A circulating current induced in a piece of metal (such as a copper pipe or a transformer core) by a changing magnetic field. It opposes the change and causes resistive heating and power loss.' },
      { id: 'back-emf', term: 'Back emf', def: 'The opposing voltage generated in an electric motor as its coils spin through a magnetic field. It opposes the driving voltage.' },
      { id: 'dc-generator', term: 'DC generator', def: 'A coil of wire rotating in a magnetic field that generates electrical energy, connected through a split-ring commutator so the output current always flows the same way (DC).' },
      { id: 'ac-generator', term: 'AC generator (alternator)', def: 'A generator that produces alternating current. It uses two slip-ring commutators (not a split ring), which keep a continuous connection while letting the current alternate naturally.' },
      { id: 'slip-rings', term: 'Slip rings', def: 'Two complete rings that rotate with the coil, each permanently connected to one end of the coil, keeping continuous contact with stationary carbon brushes. Used in AC generators.' },
      { id: 'split-ring', term: 'Split-ring commutator', def: 'A ring cut into two halves that swaps the coil’s connections to the brushes every half turn, so the output always flows in the same direction. Used in DC motors and DC generators.' },
      { id: 'ac', term: 'Alternating current (AC)', def: 'Current that changes (reverses) direction. Irish mains electricity is AC.' },
      { id: 'dc', term: 'Direct current (DC)', def: 'Current that flows steadily in one direction only, e.g. from a battery.' },
      { id: 'peak', term: 'Peak voltage (V<sub>0</sub>)', def: 'The maximum height reached on the graph of an alternating voltage. It is reached once in the positive direction and once in the negative direction each cycle. For Irish mains V<sub>0</sub> ≈ 325 V.' },
      { id: 'rms', term: 'Root mean square (rms) value', def: 'The value of a steady DC voltage (or current) that would produce the same heat dissipation (same average power) in a circuit as the alternating voltage (or current). For mains, V<sub>rms</sub> ≈ 230 V. V<sub>rms</sub> = V<sub>0</sub>/√2.' },
      { id: 'transformer', term: 'Transformer', def: 'A device that can increase or decrease AC voltage.' },
      { id: 'step-down', term: 'Step-down transformer', def: 'A transformer with fewer turns on the secondary coil than on the primary coil, so the induced voltage across the secondary is less than the applied voltage across the primary.' },
      { id: 'step-up', term: 'Step-up transformer', def: 'A transformer with more turns on the secondary coil than on the primary coil, so the induced voltage across the secondary is greater than the applied voltage across the primary.' },
      { id: 'soft-iron', term: 'Soft iron', def: 'Iron that is easily magnetised and demagnetised — used for transformer cores.' },
      { id: 'hard-iron', term: 'Hard iron (steel)', def: 'Iron with carbon added, which makes it difficult to magnetise, but once magnetised it retains its magnetism.' },
      { id: 'mutual', term: 'Mutual induction', def: 'When a changing magnetic field in one coil causes an induced emf to appear in a nearby coil.' },
    ],

    formulas: [
      {
        id: 'faraday',
        name: 'Faraday’s law (one loop)',
        display: `<var>E</var> = − ${EM.frac('d<var>Φ</var>', 'd<var>t</var>')}`,
        vars: [
          { sym: 'E', label: 'E', name: 'Induced emf (size)', unit: 'V', value: 0.03 },
          { sym: 'dPhi', label: 'dΦ', name: 'Change of magnetic flux', unit: 'Wb', value: 0.006 },
          { sym: 'dt', label: 'dt', name: 'Change of time (time taken)', unit: 's', value: 0.2 },
        ],
        solve: {
          E: (v) => v.dPhi / v.dt,
          dPhi: (v) => v.E * v.dt,
          dt: (v) => v.dPhi / v.E,
        },
        notes:
          'The minus sign is there <strong>because the induced emf opposes the change</strong> causing it (Lenz’s law). It tells you the <em>direction</em>, so this calculator works with <strong>sizes</strong> (magnitudes) — enter the change in flux as a positive number. The faster the flux changes (smaller d<var>t</var>), the bigger the emf.',
        example: {
          q: 'The magnetic flux through a single loop of wire rises from 0.002 Wb to 0.008 Wb in 0.2 s. Find the size of the induced emf.',
          a: 'dΦ = 0.008 − 0.002 = 0.006 Wb<br>E = dΦ / dt = 0.006 / 0.2 = <strong>0.03 V</strong> (the minus sign only says it opposes the increase in flux).',
        },
      },
      {
        id: 'faraday-n',
        name: 'Faraday’s law for a coil of N turns',
        display: `<var>E</var> = −<var>N</var> ${EM.frac('d<var>Φ</var>', 'd<var>t</var>')}`,
        vars: [
          { sym: 'E', label: 'E', name: 'Induced emf (size)', unit: 'V', value: 0.5 },
          { sym: 'N', label: 'N', name: 'Number of turns (coils) of wire', unit: '', value: 100 },
          { sym: 'dPhi', label: 'dΦ', name: 'Change of flux through each turn', unit: 'Wb', value: 5e-4 },
          { sym: 'dt', label: 'dt', name: 'Change of time', unit: 's', value: 0.1 },
        ],
        solve: {
          E: (v) => (v.N * v.dPhi) / v.dt,
          N: (v) => (v.E * v.dt) / v.dPhi,
          dPhi: (v) => (v.E * v.dt) / v.N,
          dt: (v) => (v.N * v.dPhi) / v.E,
        },
        notes: 'N.B. E = −dΦ/dt is for only <strong>one</strong> coil of wire. With N coils, each coil contributes to the emf, so the emf is N times bigger. Use Φ = B × A to find the flux and time = displacement ÷ velocity to find the time.',
        derivation: ['One loop: E = −dΦ/dt.', 'Every one of the N turns has the same flux change, so each adds the same emf.', 'The turns are in series, so the emfs add: E = −N dΦ/dt.'],
        example: {
          q: 'A coil of 100 turns has an area of 2 × 10<sup>−3</sup> m². A magnet is pushed 5 cm towards it at 0.5 m/s, and the magnetic flux density in the coil rises from 0 to 0.25 T. Find the induced emf.',
          a: 'Φ = B × A = 0.25 × 2×10<sup>−3</sup> = 5×10<sup>−4</sup> Wb, so dΦ = 5×10<sup>−4</sup> Wb<br>time = displacement ÷ velocity = 0.05 ÷ 0.5 = 0.1 s<br>E = N dΦ/dt = 100 × 5×10<sup>−4</sup> ÷ 0.1 = <strong>0.5 V</strong>',
        },
      },
      {
        id: 'flux',
        name: 'Magnetic flux',
        display: `<var>Φ</var> = <var>B</var> × <var>A</var>`,
        vars: [
          { sym: 'Phi', label: 'Φ', name: 'Magnetic flux', unit: 'Wb', value: 5e-4 },
          { sym: 'B', label: 'B', name: 'Magnetic flux density (field strength)', unit: 'T', value: 0.25 },
          { sym: 'A', label: 'A', name: 'Area the field passes through (at right angles)', unit: 'm²', value: 2e-3 },
        ],
        solve: {
          Phi: (v) => v.B * v.A,
          B: (v) => v.Phi / v.A,
          A: (v) => v.Phi / v.B,
        },
        notes: 'Use the area that the field lines pass through at right angles. 1 weber (Wb) = 1 tesla × 1 m².',
        example: { q: 'A field of 0.4 T passes at right angles through a loop of area 0.05 m². Find the flux.', a: 'Φ = B × A = 0.4 × 0.05 = <strong>0.02 Wb</strong>' },
      },
      {
        id: 'time',
        name: 'Time from displacement and velocity',
        display: `time = ${EM.frac('displacement', 'velocity')} &nbsp;&nbsp; <var>t</var> = ${EM.frac('<var>s</var>', '<var>v</var>')}`,
        vars: [
          { sym: 't', label: 't', name: 'Time taken', unit: 's', value: 0.1 },
          { sym: 's', label: 's', name: 'Displacement (distance moved)', unit: 'm', value: 0.05 },
          { sym: 'v', label: 'v', name: 'Velocity', unit: 'm/s', value: 0.5 },
        ],
        solve: {
          t: (v) => v.s / v.v,
          s: (v) => v.t * v.v,
          v: (v) => v.s / v.t,
        },
        notes: 'Used to find d<var>t</var> in Faraday’s law when you are told how far and how fast a magnet or wire moves.',
        example: { q: 'A magnet moves 5 cm into a coil at 0.5 m/s. How long does the flux take to change?', a: 't = s ÷ v = 0.05 ÷ 0.5 = <strong>0.1 s</strong>' },
      },
      {
        id: 'back-emf',
        name: 'Back emf in a motor',
        display: `<var>V</var><sub>effective</sub> = <var>V</var><sub>initial</sub> − <var>V</var><sub>induced</sub>`,
        vars: [
          { sym: 'Ve', label: 'V<sub>eff</sub>', name: 'Effective voltage driving current through the motor', unit: 'V', value: 3 },
          { sym: 'Vi', label: 'V<sub>initial</sub>', name: 'Applied (supply) voltage', unit: 'V', value: 12 },
          { sym: 'Vb', label: 'V<sub>induced</sub>', name: 'Induced voltage (back emf)', unit: 'V', value: 9 },
        ],
        solve: {
          Ve: (v) => v.Vi - v.Vb,
          Vi: (v) => v.Ve + v.Vb,
          Vb: (v) => v.Vi - v.Ve,
        },
        notes: 'The back emf grows as the motor speeds up, so the effective voltage (and the current) falls. When the motor first starts there is no back emf, so the current is largest.',
        example: {
          q: 'A 12 V motor running at full speed has a back emf of 9 V. What is the effective voltage? If its coil resistance is 2 Ω, what current flows?',
          a: 'V<sub>eff</sub> = 12 − 9 = <strong>3 V</strong>. Using V = IR from C.3: I = 3 ÷ 2 = <strong>1.5 A</strong> (compared with 12 ÷ 2 = 6 A when it first starts).',
        },
      },
      {
        id: 'vrms',
        name: 'rms voltage',
        display: `<var>V</var><sub>rms</sub> = ${EM.frac('<var>V</var><sub>0</sub>', EM.sqrt('2'))}`,
        vars: [
          { sym: 'Vrms', label: 'V<sub>rms</sub>', name: 'Root mean square voltage', unit: 'V', value: 230 },
          { sym: 'V0', label: 'V<sub>0</sub>', name: 'Peak voltage', unit: 'V', value: 325.3 },
        ],
        solve: {
          Vrms: (v) => v.V0 / Math.SQRT2,
          V0: (v) => v.Vrms * Math.SQRT2,
        },
        notes: 'The rms value, not the peak value, is the equivalent DC value that gives the same average power.',
        derivation: [
          'V = V<sub>0</sub> sin ωt. The average of V over a cycle is zero, so it is useless as a measure.',
          'Square it: V² = V<sub>0</sub>² sin²ωt, which is always positive.',
          'The mean of sin² over a whole cycle is ½, so mean(V²) = V<sub>0</sub>²/2.',
          'Square root: V<sub>rms</sub> = √(V<sub>0</sub>²/2) = V<sub>0</sub>/√2.',
        ],
        example: { q: 'Electric Ireland supplies 230 V (rms). What is the peak voltage?', a: 'V<sub>0</sub> = V<sub>rms</sub> × √2 = 230 × 1.414 = <strong>325 V</strong>' },
      },
      {
        id: 'irms',
        name: 'rms current',
        display: `<var>I</var><sub>rms</sub> = ${EM.frac('<var>I</var><sub>0</sub>', EM.sqrt('2'))}`,
        vars: [
          { sym: 'Irms', label: 'I<sub>rms</sub>', name: 'Root mean square current', unit: 'A', value: 10 },
          { sym: 'I0', label: 'I<sub>0</sub>', name: 'Peak current', unit: 'A', value: 14.14 },
        ],
        solve: {
          Irms: (v) => v.I0 / Math.SQRT2,
          I0: (v) => v.Irms * Math.SQRT2,
        },
        notes: 'Same idea as for voltage: a steady DC current equal to I<sub>rms</sub> would produce the same heating.',
        example: { q: 'An AC current has a peak value of 5 A. What is its rms value?', a: 'I<sub>rms</sub> = 5 ÷ √2 = <strong>3.54 A</strong>' },
      },
      {
        id: 'turns',
        name: 'Transformer turns ratio',
        display: `${EM.frac('<var>V</var><sub>p</sub>', '<var>V</var><sub>s</sub>')} = ${EM.frac('<var>N</var><sub>p</sub>', '<var>N</var><sub>s</sub>')}`,
        vars: [
          { sym: 'Vp', label: 'V<sub>p</sub>', name: 'Primary voltage', unit: 'V', value: 230 },
          { sym: 'Vs', label: 'V<sub>s</sub>', name: 'Secondary voltage', unit: 'V', value: 3.71 },
          { sym: 'Np', label: 'N<sub>p</sub>', name: 'Number of turns in the primary coil', unit: '', value: 3100 },
          { sym: 'Ns', label: 'N<sub>s</sub>', name: 'Number of turns in the secondary coil', unit: '', value: 50 },
        ],
        solve: {
          Vp: (v) => (v.Vs * v.Np) / v.Ns,
          Vs: (v) => (v.Vp * v.Ns) / v.Np,
          Np: (v) => (v.Vp * v.Ns) / v.Vs,
          Ns: (v) => (v.Vs * v.Np) / v.Vp,
        },
        notes: 'More turns on the secondary → step-up (V<sub>s</sub> &gt; V<sub>p</sub>). Fewer turns on the secondary → step-down (V<sub>s</sub> &lt; V<sub>p</sub>). Only works with AC.',
        example: {
          q: 'A phone charger’s transformer steps 230 V down for a 3.7 V battery. The primary has 3100 turns. How many turns are on the secondary?',
          a: 'N<sub>s</sub> = N<sub>p</sub> × V<sub>s</sub> ÷ V<sub>p</sub> = 3100 × 3.7 ÷ 230 = 49.9 ≈ <strong>50 turns</strong> (a step-down transformer).',
        },
      },
      {
        id: 'tpower',
        name: 'Power in = power out (ideal transformer)',
        display: `<var>V</var><sub>p</sub> × <var>I</var><sub>p</sub> = <var>V</var><sub>s</sub> × <var>I</var><sub>s</sub>`,
        vars: [
          { sym: 'Vp', label: 'V<sub>p</sub>', name: 'Primary voltage', unit: 'V', value: 230 },
          { sym: 'Ip', label: 'I<sub>p</sub>', name: 'Primary current', unit: 'A', value: 0.0322 },
          { sym: 'Vs', label: 'V<sub>s</sub>', name: 'Secondary voltage', unit: 'V', value: 3.7 },
          { sym: 'Is', label: 'I<sub>s</sub>', name: 'Secondary current', unit: 'A', value: 2 },
        ],
        solve: {
          Vp: (v) => (v.Vs * v.Is) / v.Ip,
          Ip: (v) => (v.Vs * v.Is) / v.Vp,
          Vs: (v) => (v.Vp * v.Ip) / v.Is,
          Is: (v) => (v.Vp * v.Ip) / v.Vs,
        },
        notes: 'From the law of conservation of energy: the power supplied to the primary (P<sub>p</sub> = V<sub>p</sub> × I<sub>p</sub>) equals the power received by the secondary (P<sub>s</sub> = V<sub>s</sub> × I<sub>s</sub>). A transformer only changes the <strong>proportions</strong> of voltage and current — step the voltage up and the current goes down.',
        example: {
          q: 'A phone charger supplies 2 A at 3.7 V. Assuming it is 100% efficient, what current does it draw from the 230 V mains?',
          a: 'P<sub>s</sub> = 3.7 × 2 = 7.4 W = P<sub>p</sub><br>I<sub>p</sub> = 7.4 ÷ 230 = <strong>0.032 A</strong>',
        },
      },
      {
        id: 'efficiency',
        name: 'Transformer efficiency',
        display: `Efficiency = ${EM.frac('<var>P</var><sub>out</sub>', '<var>P</var><sub>in</sub>')} × 100%`,
        vars: [
          { sym: 'eta', label: 'η', name: 'Efficiency', unit: '%', value: 92 },
          { sym: 'Pout', label: 'P<sub>out</sub>', name: 'Power out (secondary, V<sub>s</sub>I<sub>s</sub>)', unit: 'W', value: 460 },
          { sym: 'Pin', label: 'P<sub>in</sub>', name: 'Power in (primary, V<sub>p</sub>I<sub>p</sub>)', unit: 'W', value: 500 },
        ],
        solve: {
          eta: (v) => (v.Pout / v.Pin) * 100,
          Pout: (v) => (v.eta / 100) * v.Pin,
          Pin: (v) => v.Pout / (v.eta / 100),
        },
        notes: 'This standard formula extends the notes’ statement that “a well designed transformer can be 90% efficient or better”. The missing power is mostly heat (from eddy currents in the core and resistance of the coils).',
        example: { q: 'A transformer takes in 500 W and delivers 460 W. Find its efficiency and the power wasted.', a: 'Efficiency = 460 ÷ 500 × 100% = <strong>92%</strong>; wasted = 500 − 460 = <strong>40 W</strong> (as heat).' },
      },
    ],

    experiments: [
      {
        id: 'em-induction',
        title: 'To demonstrate electromagnetic induction',
        aim: 'To show that a current is induced in a wire when it moves through a magnetic field.',
        apparatus: ['Horseshoe (U-shaped) magnet', 'Length of copper wire', 'Sensitive (centre-zero) ammeter', 'Connecting leads'],
        steps: [
          'Set up the apparatus as shown: a wire held between the poles of a horseshoe magnet, connected to an ammeter.',
          'Move the wire <strong>up</strong> through the magnetic field and watch the ammeter.',
          'Move the wire <strong>down</strong> through the magnetic field.',
          'Hold the wire <strong>stationary</strong> in the field, then move it <strong>horizontally, parallel</strong> to the field lines.',
        ],
        result:
          'The current in the ammeter changes whenever the wire is moved vertically up or down through the field. Moving upwards makes the current flow in one direction; moving downwards makes it flow in the opposite direction. Keeping the wire stationary, or moving it parallel to the field lines, gives <strong>no current</strong>.',
        conclusion: 'An emf (and so a current) is induced in a conductor whenever the magnetic field passing through it changes — i.e. when it cuts across magnetic field lines. No battery is needed.',
        sim: wireInductionSim,
      },
      {
        id: 'faraday-law',
        title: 'To demonstrate Faraday’s law of electromagnetic induction',
        aim: 'To show that the induced emf depends on how fast the magnetic flux changes.',
        apparatus: ['Coil of wire', 'Bar magnet', 'Galvanometer', 'Connecting leads'],
        steps: [
          'Connect the coil to the galvanometer.',
          'Move the magnet towards and into the coil (or away from and out of the coil) <strong>slowly</strong>. Note the deflection.',
          'Repeat, moving the magnet <strong>quickly</strong>. Note the deflection.',
        ],
        result:
          'Slowly: the flux through the coil changes slowly and the galvanometer gives a <strong>small</strong> deflection (small induced emf). Quickly: the flux changes rapidly and the galvanometer gives a <strong>large</strong> deflection (large induced emf). Moving in and moving out deflect the needle in opposite directions.',
        conclusion: 'The induced emf is proportional to the rate of change of magnetic flux (Faraday’s law). More turns on the coil also give a bigger emf (E = −N dΦ/dt).',
        sim: coilSim,
      },
      {
        id: 'lenz-pipe',
        title: 'To demonstrate Lenz’s law of electromagnetic induction',
        aim: 'To show that induced currents oppose the change that causes them.',
        apparatus: ['Copper pipe', 'Small non-magnetic metal cylinder', 'Cylindrical magnet of identical shape and mass', 'Stopwatch'],
        steps: [
          'Drop the small cylindrical piece of metal through the copper pipe and measure how long it takes to fall straight through.',
          'Now drop the identical-shape-and-mass cylindrical magnet through the same pipe and measure how long it takes.',
          'Compare the two times.',
        ],
        result: 'The magnet takes much longer to fall through the pipe than the metal cylinder.',
        conclusion:
          'As the magnet falls, its changing magnetic field induces currents in the pipe. By Lenz’s law these currents oppose the change producing them, so they exert an upward force on the magnet, making it fall slower than the metal cylinder.',
        sim: lenzPipeSim,
      },
      {
        id: 'mutual',
        title: 'To demonstrate mutual induction',
        aim: 'To show that a changing magnetic field in one coil induces an emf in a nearby coil.',
        apparatus: ['Two coils', 'AC power supply', 'Galvanometer', 'Connecting leads'],
        steps: ['Place two coils near each other (one above the other).', 'Connect one coil (the bottom one) to an AC power supply and the other coil to a galvanometer.', 'Turn on the AC power supply and observe the galvanometer needle.'],
        result: 'The galvanometer needle deflects and <strong>fluctuates continuously</strong>.',
        conclusion: 'The changing magnetic field of the bottom coil induces a changing current in the top coil — mutual induction. (With steady DC there is only a flick when the switch is closed or opened.)',
        sim: mutualSim,
      },
    ],

    topics: [
      /* -------------------------------------------------------------- 1 */
      {
        id: 'induction',
        title: 'Faraday & electromagnetic induction',
        summary: 'A changing magnetic field can produce a voltage — and a current — without any battery.',
        keywords: 'Michael Faraday 1831 emf electromotive force induced current voltage horseshoe magnet ammeter wire cutting field lines first electric motor mercury needle voltaic pile everyday uses wireless charging induction cooking',
        render(el, ui) {
          const s1 = EM.section(el, 'Faraday’s discovery');
          EM.p(
            s1,
            'Electromagnetic induction was first discovered in <strong>1831</strong> by <strong>Michael Faraday</strong> (England, 1791–1867). Faraday noticed that when he moved a permanent magnet in and out of a coil, or a single loop of wire, it <strong>induced an emf</strong> — in other words a voltage — and therefore a current was produced.'
          );
          EM.callout(s1, 'key', 'Faraday had found a way of producing an electric current in a circuit using only the force of a <strong>magnetic field</strong> — no batteries.');
          ui.term('emf', s1);
          ui.term('em-induction', s1);
          EM.callout(
            s1,
            'history',
            'Faraday also built the world’s <strong>first electric motor</strong>, using a glass of <strong>mercury</strong>, a <strong>needle</strong> (wire), a <strong>permanent magnet</strong> and a <strong>battery (voltaic pile)</strong>. Current flowing through the hanging wire and the mercury made the wire circle continuously around the magnet.'
          );
          ui.experiment('em-induction', el);
          const s2 = EM.section(el, 'Electromagnetic induction in everyday use');
          EM.cards(s2, [
            { icon: '⚙️', title: 'Electric motor', html: 'Transforms <strong>electrical energy into mechanical</strong> energy.' },
            { icon: '🌀', title: 'Electric generator', html: 'Does the reverse: uses <strong>mechanical energy to generate electricity</strong>.' },
            { icon: '🔌', title: 'Transformer', html: 'An alternating current in one coil creates an alternating magnetic field, which induces a similar alternating current in another coil.' },
            { icon: '📱', title: 'Wireless charging', html: 'Charging pads use <strong>oscillating magnetic fields</strong> to transfer energy to a receiver coil in a smartphone or electric toothbrush — no plug needed.' },
            { icon: '🍳', title: 'Induction cooking', html: 'The cooktop makes an <strong>alternating magnetic field</strong> that induces currents in the metal of the pan, heating the pan itself.' },
          ]);
          EM.details(s2, 'Quick check: why must the field be <em>changing</em>?', 'A magnet sitting still beside a coil produces no current, however strong it is. Only a <strong>change</strong> — the magnet moving, the coil moving, or the field being switched/alternating — induces an emf. Try holding the wire still in the demo above.');
        },
      },
      /* -------------------------------------------------------------- 2 */
      {
        id: 'faraday',
        title: 'Faraday’s law',
        summary: 'The induced emf is proportional to how fast the magnetic flux through a loop changes.',
        keywords: 'faraday law magnetic flux phi weber rate of change emf galvanometer coil magnet slowly quickly turns N E = -N dphi/dt flux B x A time displacement velocity',
        render(el, ui) {
          const s1 = EM.section(el, 'Magnetic flux and Faraday’s law');
          EM.p(
            s1,
            'Think of <strong>magnetic flux</strong> (Φ) as “how many field lines thread through the loop”. It depends on the field strength B and the area A the lines pass through. Faraday found that what matters is not how much flux there is, but <strong>how fast it is changing</strong>.'
          );
          ui.term('flux', s1);
          ui.term('faraday-law', s1);
          ui.experiment('faraday-law', el);
          const s2 = EM.section(el, 'Faraday’s law mathematically');
          EM.p(s2, 'E = induced emf (V), dΦ = change of magnetic flux (Wb), dt = change of time (s). The minus sign is there because the induced emf <strong>opposes</strong> the change (see Lenz’s law).');
          ui.formula('faraday', s2);
          EM.callout(s2, 'note', 'The equation above is only for <strong>one</strong> coil of wire. If there are a number of coils of wire (N), each coil contributes to the emf produced, so the equation becomes E = −N dΦ/dt.');
          ui.formula('faraday-n', s2);
          ui.formula('flux', s2);
          ui.formula('time', s2);
          EM.callout(s2, 'tip', 'The notes say the minus sign is there “because it’s an opposing force”. Strictly, it is the induced <em>emf</em> (and current) that opposes the change in flux — any force (like the push on the magnet) is a result of that.', 'Going further');
          const s3 = EM.section(el, 'Worked example, step by step');
          EM.p(s3, 'A coil of <strong>100 turns</strong> and area <strong>2 × 10⁻³ m²</strong> has a magnet pushed <strong>5 cm</strong> towards it at <strong>0.5 m/s</strong>. The magnetic flux density in the coil rises from 0 to <strong>0.25 T</strong>. Find the induced emf.');
          EM.stepper(s3, [
            { title: 'Find the change in flux', html: 'Φ = B × A = 0.25 × 2×10⁻³ = 5×10⁻⁴ Wb. It started at 0, so <strong>dΦ = 5×10⁻⁴ Wb</strong>.' },
            { title: 'Find the time', html: 'time = displacement ÷ velocity = 0.05 m ÷ 0.5 m/s = <strong>0.1 s</strong>.' },
            { title: 'Use E = −N dΦ/dt', html: 'E = 100 × (5×10⁻⁴) ÷ 0.1 = <strong>0.5 V</strong> (in the direction that opposes the increase in flux).' },
            { title: 'Sense check', html: 'Push twice as fast → half the time → <strong>double</strong> the emf (1 V). Double the turns → also double the emf. That is exactly what the galvanometer showed in the demo.' },
          ]);
        },
      },
      /* -------------------------------------------------------------- 3 */
      {
        id: 'lenz',
        title: 'Lenz’s law & eddy currents',
        summary: 'The induced emf always opposes the change that causes it — which is why a magnet falls slowly through a copper pipe.',
        keywords: 'Heinrich Lenz 1833 Lenz law oppose change induced current direction copper pipe magnet falls slowly eddy current magnetic damping resistive heating power loss conservation of energy',
        render(el, ui) {
          const s1 = EM.section(el, 'Lenz’s law');
          EM.callout(s1, 'history', '<strong>Heinrich Lenz</strong> (1804–1865) was a Russian physicist of German ethnicity. He is most noted for formulating Lenz’s law in electrodynamics in <strong>1833</strong>. Lenz’s law is derived from Michael Faraday’s law of induction.');
          ui.term('lenz-law', s1);
          EM.p(
            s1,
            'Push the N pole of a magnet towards a coil and the induced current makes the near end of the coil an <strong>N pole</strong>, which <strong>repels</strong> the magnet. Pull it away and that end becomes an <strong>S pole</strong>, which <strong>attracts</strong> it back. Either way, the coil fights the change. Watch the label above the coil in the simulation below.'
          );
          const sp = EM.simPanel(s1, 'Which way does the induced current flow?', 'Drag the magnet in and out. The coil’s end turns into whichever pole <strong>opposes</strong> the motion, and the green arrow shows the opposing force on the magnet.');
          coilSim(sp);
          EM.callout(s1, 'key', 'Why must it oppose? If the induced current <em>helped</em> the magnet along, the magnet would speed up, inducing even more current — free energy from nothing. Lenz’s law is the law of <strong>conservation of energy</strong> in action: you must do work pushing the magnet, and that work becomes electrical energy.');
          ui.experiment('lenz-pipe', el);
          const s2 = EM.section(el, 'Eddy currents (magnetic damping)');
          EM.callout(s2, 'note', 'The induced emf within the copper pipe (because of the moving magnet) causes a <strong>circulating current</strong> to flow around it. This type of current is known as an <strong>eddy current</strong> or <strong>magnetic damping</strong>.');
          ui.term('eddy', s2);
          EM.p(s2, 'Eddy currents oppose the change that produces them, generating <strong>resistive heating and power loss</strong> within the pipe. The same effect heats the pan on an induction hob (useful!) and wastes energy in transformer cores (not useful — see Transformers).');
          EM.callout(s2, 'tip', 'The notes say eddy currents “oppose the flow of the induced current”. More precisely, eddy currents <em>are</em> induced currents; they oppose the <strong>change in flux / the motion</strong> that creates them, and as they flow through the metal’s resistance they turn energy into heat.', 'Going further');
        },
      },
      /* -------------------------------------------------------------- 4 */
      {
        id: 'back-emf',
        title: 'Back emf in motors',
        summary: 'A spinning motor also acts as a generator, producing a voltage that opposes the supply.',
        keywords: 'back emf motor opposing voltage Lenz Faraday coils rotate cut flux V effective = V initial - V induced current falls speed',
        render(el, ui) {
          const s1 = EM.section(el, 'What is back emf?');
          EM.p(s1, 'This is an important consequence of Lenz’s law.');
          ui.term('back-emf', s1);
          EM.p(
            s1,
            'When a voltage is applied to a motor, current flows, creating movement. But because the motor’s coils are rotating within a magnetic field, they <strong>cut through magnetic flux</strong>. According to Faraday’s law this induces a second voltage — the <strong>back emf</strong> — that <strong>opposes the driving voltage</strong>, which slows down the motor’s rotation.'
          );
          const sp = EM.simPanel(s1, 'Motor speeding up', 'Switch the motor on and watch: as it speeds up the back emf grows, so the effective voltage and the current fall. Add a load (or jam it) and the current shoots up.');
          backEmfSim(sp);
          const s2 = EM.section(el, 'Accounting for back emf');
          EM.p(s2, 'To account for the back emf in a circuit use:');
          ui.formula('back-emf', s2);
          EM.callout(s2, 'real', 'A motor draws its biggest current at the moment it is switched on (no back emf yet). That is why lights can dim briefly when a big motor such as a fridge compressor starts, and why a jammed motor can overheat and burn out.');
        },
      },
      /* -------------------------------------------------------------- 5 */
      {
        id: 'generators',
        title: 'Generating DC and AC',
        summary: 'A coil turning in a magnetic field generates electricity; the commutator decides whether it comes out as DC or AC.',
        keywords: 'electrical generation DC generator AC generator alternator car alternator slip rings split ring commutator carbon brushes turbine coil rotate half turn alternating current wire 1 north pole south pole',
        render(el, ui) {
          const s1 = EM.section(el, 'Generating DC');
          EM.p(s1, 'To generate DC (direct current) we use a <strong>DC generator</strong>. The DC generator operates on principles very similar to the DC motor:');
          EM.list(s1, ['In a <strong>DC motor</strong> we used electrical energy and magnetic energy to generate kinetic energy.', 'In a <strong>DC generator</strong> we have a coil of wire rotating in a magnetic field that in turn generates electrical energy.']);
          ui.term('dc-generator', s1);
          EM.p(s1, 'The resulting DC current is used where a <strong>steady and consistent flow</strong> of electricity is needed, such as batteries, electronic devices and some motors.');
          const s2 = EM.section(el, 'Generating AC');
          EM.p(s2, 'To generate AC we use <strong>AC generators</strong> or <strong>alternators</strong>. A car alternator internally generates alternating current (AC), which is then converted into direct current (DC) for the car’s battery and electronics.');
          ui.term('ac-generator', s2);
          EM.add(s2, 'table', {
            class: 'data-table',
            html:
              '<tr><th></th><th>AC generator</th><th>DC generator</th></tr>' +
              '<tr><td>Commutator</td><td>Two <strong>slip rings</strong></td><td>One <strong>split ring</strong></td></tr>' +
              '<tr><td>Connection</td><td>Each end of the coil always touches the same brush</td><td>Coil ends swap brushes every half turn</td></tr>' +
              '<tr><td>Output</td><td>Reverses every half turn → AC</td><td>Always the same direction → DC (pulsing)</td></tr>',
          });
          ui.term('slip-rings', s2);
          ui.term('split-ring', s2);
          const sp = EM.simPanel(s2, 'Generator: slip rings vs split ring', 'End-on view of the coil (wires 1 and 2) between the poles. Switch the commutator and compare the output graphs. The buttons recreate the two pictures in the notes.');
          generatorSim(sp);
          const s3 = EM.section(el, 'How an AC generator works');
          EM.stepper(s3, [
            { title: 'Turning the coil', html: 'A turbine, for example, turns the coil between the north and south poles of the magnets. As the coil rotates, it moves through the magnetic field.' },
            { title: 'Changing flux', html: 'The magnetic flux through the coil changes continuously, so — according to Faraday’s law — a changing magnetic flux induces an emf (voltage) in the coil.' },
            { title: 'Current flows', html: 'If the generator is connected to a circuit, the induced voltage causes an electric current to flow.' },
            { title: 'Every half turn…', html: 'The direction of the current changes every half turn. During the first half-turn the current flows in one direction. After the coil rotates another 180°, the sides of the coil move in opposite directions through the magnetic field.' },
            { title: 'Reversal', html: 'The induced voltage reverses direction, so the current also reverses.' },
            { title: 'Slip rings and brushes', html: 'The slip rings rotate with the coil and maintain continuous electrical contact with the stationary (carbon) brushes, which allow the current to be transferred to the external circuit.' },
            { title: 'Producing AC', html: 'Because each end of the coil stays connected to the same slip ring, the output reverses naturally every half turn, producing AC.' },
          ]);
          const s4 = EM.section(el, 'Wire 1 near the N pole vs near the S pole');
          EM.list(s4, [
            '<strong>Image 1:</strong> as <strong>wire 1</strong> moves <strong>up</strong> and cuts through the magnetic field near the <strong>north pole</strong>, it sends the current in one direction.',
            '<strong>Image 2:</strong> the same wire, wire 1, is now moving <strong>down</strong> and cuts through the field near the <strong>south pole</strong> — moving in the opposite direction to before — so it sends the current in the <strong>opposite direction</strong>.',
          ]);
          ui.term('ac', s4);
          ui.term('dc', s4);
        },
      },
      /* -------------------------------------------------------------- 6 */
      {
        id: 'ac-dc',
        title: 'AC and DC in power systems',
        summary: 'AC is used for the grid because transformers can easily change its voltage, cutting heat losses in long cables.',
        keywords: 'AC DC power systems transmission national grid high voltage low current heat loss I squared R transformers pylons 400 kV appliances fridge compressor washing machine toaster oven hair dryer electronic devices batteries',
        render(el, ui) {
          const s1 = EM.section(el, 'Why the grid uses AC');
          EM.p(
            s1,
            'AC is the standard for power generation and distribution because it can be <strong>easily transformed to higher or lower voltages using transformers</strong>. This makes AC ideal for transmitting electricity over long distances.'
          );
          EM.p(
            s1,
            'We saw in Chapter 3 that if you <strong>increase the voltage</strong> you can <strong>decrease the current</strong> and get the same power output (P = VI). This reduced current means <strong>less loss due to heat</strong> (P = I²R), making long-distance transmission more economical.'
          );
          const sp = EM.simPanel(s1, 'Sending 20 MW down the line', 'Change the transmission voltage and watch the current and the heat wasted in the cables.');
          transmissionSim(sp);
          EM.callout(s1, 'real', 'The journey in the notes: a power plant generates at about <strong>12 kV</strong> → a <strong>step-up</strong> transformer raises it to <strong>400 kV</strong> for the high-voltage transmission lines → a <strong>step-down</strong> transformer at a sub-station lowers it (e.g. to <strong>13 kV</strong>) → a final step-down transformer near your home gives <strong>230 V</strong>.');
          const s2 = EM.section(el, 'What uses AC and what uses DC?');
          EM.cards(s2, [
            { icon: '〰️', title: 'AC powers…', html: 'Refrigerator compressors, washing machines, toasters, electric ovens and electric hair dryers.' },
            { icon: '🔋', title: 'DC powers…', html: 'Electronic devices (because they have batteries) — phones, laptops, remote controls. Their chargers convert AC to DC.' },
          ]);
          EM.details(s2, 'Quick check: why not just transmit DC?', 'Transformers only work with a <strong>changing</strong> current (they rely on electromagnetic induction). With AC the voltage can be stepped up and down cheaply and easily, so the grid uses AC.');
        },
      },
      /* -------------------------------------------------------------- 7 */
      {
        id: 'rms',
        title: 'Peak and rms values',
        summary: 'Irish mains is 230 V rms, but the voltage actually swings up to a peak of about 325 V.',
        keywords: 'root mean square rms peak voltage V0 325 V 230 V Electric Ireland AC graph DC graph safety margins adapters heating effect average power Vrms = V0/root 2 Irms = I0/root 2',
        render(el, ui) {
          const s1 = EM.section(el, 'The mains supply');
          EM.p(s1, '<strong>Electric Ireland</strong> supply voltage to our homes at a value of roughly <strong>230 V</strong>. The current we receive is <strong>alternating current (AC)</strong>. Here is a graph of DC and a graph of AC:');
          dcAcGraphs(EM.simPanel(s1, 'DC vs AC', 'The dot shows the voltage at each moment (slowed down).'));
          const s2 = EM.section(el, 'Peak voltage');
          ui.term('peak', s2);
          EM.p(s2, 'So why doesn’t a 325 V peak destroy our electronics?');
          EM.list(s2, [
            'Components are built with <strong>safety margins</strong>, and protective parts block or absorb brief high spikes.',
            'Engineers design internal parts, like capacitors and transistors, with <strong>voltage ratings well above</strong> the expected regular peak.',
            'Normal AC peaks last for only a <strong>tiny fraction of a millisecond</strong>, leaving no time for the device to overheat.',
            '<strong>Adapters</strong> convert the incoming high AC peaks into low, steady DC voltages (like 5 V or 12 V) before power reaches sensitive microchips.',
          ]);
          const s3 = EM.section(el, 'The root mean square (rms) value');
          EM.p(
            s3,
            'The <strong>rms value</strong> is what we take as the supply voltage — approximately <strong>230 V</strong>. Because the voltage is alternating, the ordinary average is no use: adding the positive and negative values gives <strong>zero</strong>. Instead we <strong>square</strong> the values (so the negatives become positive), find their <strong>mean</strong> (add them and divide), and then take the <strong>square root</strong>.'
          );
          EM.callout(s3, 'tip', 'The notes describe squaring “both values” and dividing by 2. If you did that with just the two peaks (+325 and −325) you would get 325 V back! You must square <strong>every</strong> value across the whole cycle. The mean of all those squares is V<sub>0</sub>²/2, which is why V<sub>rms</sub> = V<sub>0</sub>/√2 ≈ 0.707 V<sub>0</sub>.', 'Going further');
          const sp = EM.simPanel(s3, 'RMS explorer', 'Square the wave, take the mean, then the square root. Then adjust the DC voltage until the DC bulb gives the same <em>average heating</em> as the AC bulb.');
          rmsSim(sp);
          ui.term('rms', s3);
          EM.callout(
            s3,
            'history',
            '<strong>Why do we use rms?</strong> The first known man-made source of electricity was the simple cell, which is DC. After the disadvantages of DC were realised, AC generating machines were invented, and their power had to be compared with the existing DC system. A value called the <strong>rms value</strong> was derived to compare the effectiveness of AC with DC. From then on, all measuring instruments were designed to measure the rms value of AC. So rms specifies the amount of DC voltage and current that will produce the <strong>same heat dissipation</strong> in a circuit.'
          );
          EM.callout(s3, 'note', 'The <strong>rms value, not the peak value</strong>, is the equivalent DC value that gives the same average power. The mathematical average of an AC sine wave is zero, and rms provides a direct equivalent to steady DC power.');
          ui.formula('vrms', s3);
          ui.formula('irms', s3);
        },
      },
      /* -------------------------------------------------------------- 8 */
      {
        id: 'transformers',
        title: 'Transformers',
        summary: 'Two coils on a soft iron core: the turns ratio sets the voltage, and power in equals power out.',
        keywords: 'transformer step-up step-down primary secondary coil turns ratio Vp/Vs = Np/Ns power conservation VpIp = VsIs soft iron core hard iron efficiency 90% oil cooled eddy currents laminated core phone charger x-ray microwave magnetron sub-station power pole housing estate',
        render(el, ui) {
          const s1 = EM.section(el, 'What is a transformer?');
          ui.term('transformer', s1);
          EM.p(s1, 'Transformers are used in devices like TVs, microwaves, mobile phone adapters, clock radios, computers, washing machines, dishwashers and more.');
          EM.cards(s1, [
            { icon: '🔬', title: 'Lab demo transformer', html: 'Two coils of copper wire on a removable iron core, with terminals on top — used for experiments in school.' },
            { icon: '🏘️', title: 'Housing-estate transformer', html: 'The green metal box/kiosk you see in estates, stepping the local supply down to 230 V for the houses.' },
            { icon: '🏭', title: 'Sub-station transformer', html: 'A huge oil-filled transformer with cooling fins and tall insulators, stepping down the very high transmission voltages.' },
            { icon: '🪵', title: 'Power-pole transformer', html: 'The grey cylinders mounted on wooden poles in the countryside, stepping down to 230 V for nearby homes.' },
          ]);
          const s2 = EM.section(el, 'The two types of transformer');
          EM.p(s2, 'A changing (alternating) current in the <strong>primary</strong> coil makes an alternating magnetic flux in the <strong>soft iron core</strong>. The core carries this flux through the <strong>secondary</strong> coil, where it induces an alternating emf. The magnetic flux alternates direction because of the AC.');
          ui.term('step-down', s2);
          EM.p(s2, 'Step-down transformers are used in <strong>mobile phone chargers</strong> to step down the 230 V to the 3.7 V of the battery. They are used in <strong>cordless appliances</strong> like hand-held hoovers, and are also found in <strong>bedside clock radios</strong>.');
          ui.term('step-up', s2);
          EM.p(s2, 'Step-up transformers are used in <strong>X-ray machines</strong>, which require about <strong>50 000 V</strong> to work. <strong>Microwave ovens</strong> need up to <strong>4 000 V</strong> to power the magnetron, so they need a step-up transformer too.');
          const sp = EM.simPanel(s2, 'Transformer lab', 'Change the turns and the primary voltage, or try the presets. Watch the alternating flux (violet) circulate around the core and V, I and power on each side.');
          transformerSim(sp);
          const s3 = EM.section(el, 'Transformer formulas');
          EM.p(s3, 'To calculate the primary voltage, secondary voltage, number of turns in the primary coil or number of turns in the secondary coil:');
          ui.formula('turns', s3);
          EM.p(s3, 'The law of <strong>conservation of energy</strong> tells us that power must be conserved in the transformer: the power supplied to the primary coil (P<sub>p</sub> = V<sub>p</sub> × I<sub>p</sub>) must equal the power received by the secondary coil (P<sub>s</sub> = V<sub>s</sub> × I<sub>s</sub>).');
          ui.formula('tpower', s3);
          EM.callout(s3, 'key', 'A transformer only changes the <strong>proportions</strong> of voltage and current. It cannot give you more power out than you put in.');
          const s4 = EM.section(el, 'Factors affecting the efficiency of transformers');
          EM.p(s4, 'A well designed transformer can be <strong>90% efficient or better</strong>. They’re not 100% efficient because some of the energy is transferred to unwanted forms like <strong>heat</strong>. Large transformers are <strong>oil cooled</strong> to remove this heat.');
          ui.formula('efficiency', s4);
          EM.p(s4, 'Transformers are made with a <strong>soft iron core</strong>:');
          ui.term('soft-iron', s4);
          ui.term('hard-iron', s4);
          EM.p(s4, 'The core’s magnetism has to reverse 100 times a second with 50 Hz AC, so it must be easy to magnetise and demagnetise — soft iron, not hard iron.');
          const s5 = EM.section(el, 'Eddy currents in the core and laminations');
          EM.p(
            s5,
            'Because of the changing magnetic flux in a transformer’s core, <strong>eddy currents</strong> are induced in the core, which in turn cause it to <strong>heat up</strong>. We can solve this problem by making the core out of <strong>laminated metal plates glued together</strong> rather than one monolithic iron block. Eddy currents need a surface area to flow in; laminating reduces the area in which they can flow. The decreased eddy currents also decrease the power lost as heat by the transformer.'
          );
          const sp2 = EM.simPanel(s5, 'Solid vs laminated core', 'Switch between a solid block and laminated plates, and add more plates.');
          laminationSim(sp2);
          EM.callout(s5, 'tip', 'The thin layers of insulating glue between the plates are the key: they block the big loops of current that would circulate through a solid block. Each eddy current is trapped in a thin plate, where the emf around its small loop is tiny and the resistance is high, so the heat loss falls roughly with the square of the plate thickness.', 'Going further');
        },
      },
      /* -------------------------------------------------------------- 9 */
      {
        id: 'mutual',
        title: 'Mutual induction',
        summary: 'A changing current in one coil induces an emf in a nearby coil — the principle behind every transformer.',
        keywords: 'mutual induction two coils primary secondary AC power supply galvanometer needle fluctuates changing magnetic field DC switch on off transformer wireless charging',
        render(el, ui) {
          const s1 = EM.section(el, 'Mutual induction');
          ui.term('mutual', s1);
          EM.p(s1, 'A current in one coil makes a magnetic field. If that current <strong>changes</strong>, the field threading a second, nearby coil changes too — so, by Faraday’s law, an emf is induced in the second coil, even though the coils are not connected.');
          ui.experiment('mutual', el);
          const s2 = EM.section(el, 'Where you meet mutual induction');
          EM.cards(s2, [
            { icon: '🔌', title: 'Transformers', html: 'The primary and secondary coils are linked by mutual induction through the iron core.' },
            { icon: '📱', title: 'Wireless charging', html: 'The pad’s coil and the phone’s receiver coil are two coils linked by an oscillating magnetic field.' },
          ]);
          EM.callout(s2, 'key', 'Mutual induction needs a <strong>changing</strong> current. AC changes all the time, so it works continuously; steady DC only induces an emf at the instant it is switched on or off.');
        },
      },
    ],

    quiz: [
      { q: 'Who first discovered electromagnetic induction, and when?', options: ['Michael Faraday, 1831', 'Heinrich Lenz, 1833', 'Michael Faraday, 1867', 'Alessandro Volta, 1800'], answer: 0, explain: 'Faraday discovered it in 1831 by moving a magnet in and out of a coil.' },
      { q: 'Electromagnetic induction is…', options: ['the process where an emf is induced in a conductor whenever the magnetic field passing through it changes', 'the force on a current-carrying wire in a magnetic field', 'the magnetic field produced around a current', 'the heating effect of a current'], answer: 0, explain: 'A changing magnetic field through a conductor induces an emf.' },
      { q: 'A wire between the poles of a horseshoe magnet is moved horizontally, parallel to the field lines. The ammeter reads…', options: ['zero', 'a current in one direction', 'a current that keeps reversing', 'a large steady current'], answer: 0, explain: 'Moving parallel to the field lines does not cut them, so no emf is induced.' },
      { q: 'Moving the wire up through the field gives a current one way. Moving it down gives…', options: ['a current the opposite way', 'the same current', 'no current', 'double the current'], answer: 0, explain: 'Reversing the motion reverses the induced current.' },
      { q: 'In the Faraday’s law demo, the magnet is pushed into the coil quickly instead of slowly. The galvanometer shows…', options: ['a larger deflection', 'a smaller deflection', 'the same deflection', 'no deflection'], answer: 0, explain: 'Faster movement → flux changes more rapidly → larger induced emf.' },
      { q: 'A coil of 200 turns has the flux through it change by 3 × 10⁻³ Wb in 0.1 s. The size of the induced emf is…', options: ['6 V', '0.6 V', '0.03 V', '60 V'], answer: 0, explain: 'E = N dΦ/dt = 200 × 0.003 ÷ 0.1 = 6 V.' },
      { q: 'A field of 0.4 T passes at right angles through a loop of area 0.05 m². The flux is…', options: ['0.02 Wb', '8 Wb', '0.45 Wb', '0.125 Wb'], answer: 0, explain: 'Φ = B × A = 0.4 × 0.05 = 0.02 Wb.' },
      { q: 'The minus sign in E = −N dΦ/dt shows that…', options: ['the induced emf opposes the change causing it', 'the emf is always negative', 'flux is lost from the coil', 'the coil has resistance'], answer: 0, explain: 'The sign represents Lenz’s law: the induced emf opposes the change in flux.' },
      { q: 'A magnet falls much more slowly through a copper pipe than an identical non-magnetic cylinder because…', options: ['eddy currents induced in the pipe oppose its motion', 'the magnet is attracted to the copper', 'air resistance is bigger for magnets', 'copper is magnetic'], answer: 0, explain: 'The changing field induces eddy currents whose magnetic effect pushes up on the magnet (Lenz’s law).' },
      { q: 'Eddy currents in a metal cause…', options: ['resistive heating and power loss', 'the metal to become a permanent magnet', 'an increase in the metal’s resistance only', 'the metal to cool down'], answer: 0, explain: 'The circulating currents flow through the metal’s resistance and turn energy into heat.' },
      { q: 'A 12 V motor at full speed has a back emf of 10 V. The effective voltage is…', options: ['2 V', '22 V', '12 V', '1.2 V'], answer: 0, explain: 'V_effective = V_initial − V_induced = 12 − 10 = 2 V.' },
      { q: 'The key difference between an AC generator and a DC generator is that the AC generator uses…', options: ['two slip rings instead of a split ring', 'a split ring instead of slip rings', 'a permanent magnet instead of an electromagnet', 'no brushes'], answer: 0, explain: 'Slip rings keep each coil end on the same brush, so the output alternates naturally.' },
      { q: 'In an AC generator the direction of the current changes…', options: ['every half turn', 'every full turn', 'every quarter turn', 'only when the speed changes'], answer: 0, explain: 'After 180° the sides of the coil move in opposite directions through the field, so the current reverses.' },
      { q: 'Electricity is transmitted at very high voltage mainly because…', options: ['the current is smaller, so less energy is lost as heat', 'high voltage travels faster', 'it makes the cables lighter', 'it increases the power generated'], answer: 0, explain: 'Same power at higher V means lower I, and heat loss depends on I² R.' },
      { q: 'The Irish mains supply is 230 V rms. Its peak voltage is about…', options: ['325 V', '163 V', '230 V', '460 V'], answer: 0, explain: 'V₀ = V_rms × √2 = 230 × 1.414 ≈ 325 V.' },
      { q: 'An AC current has a peak of 5 A. Its rms value is…', options: ['3.54 A', '7.07 A', '2.5 A', '5 A'], answer: 0, explain: 'I_rms = I₀ ÷ √2 = 5 ÷ 1.414 = 3.54 A.' },
      { q: 'The rms value of an AC voltage is…', options: ['the steady DC voltage that would give the same average power (heating)', 'the highest voltage reached', 'the ordinary average of the voltage', 'half the peak voltage'], answer: 0, explain: 'rms is the equivalent DC value; the plain average of a sine wave is zero.' },
      { q: 'A transformer has 500 primary turns and 50 secondary turns. With 230 V on the primary, the secondary voltage is…', options: ['23 V (step-down)', '2300 V (step-up)', '230 V', '11.5 V'], answer: 0, explain: 'Vs = Vp × Ns ÷ Np = 230 × 50 ÷ 500 = 23 V. Fewer secondary turns → step-down.' },
      { q: 'An ideal transformer gives 2 A at 12 V from a 240 V supply. The primary current is…', options: ['0.1 A', '40 A', '2 A', '0.5 A'], answer: 0, explain: 'Vp Ip = Vs Is → Ip = 12 × 2 ÷ 240 = 0.1 A.' },
      { q: 'Transformer cores are made of laminated soft-iron plates in order to…', options: ['reduce eddy currents and the heat they waste', 'make the core a permanent magnet', 'increase the number of turns', 'allow DC to be transformed'], answer: 0, explain: 'Insulated laminations break up the eddy-current loops, reducing heating and power loss; soft iron magnetises and demagnetises easily.' },
    ],
  });
})();
