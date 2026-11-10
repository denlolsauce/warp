/* C.2 Electrical Circuits — potential difference, EMF, current, resistance, Ohm's law,
   series/parallel circuits, potential dividers, LDRs and resistivity. */
(function () {
  'use strict';
  const { h, add, draw, colors } = EM;
  const D = draw;

  /* ------------------------------------------------------------------ shared helpers */

  const VCOL = '#22d3ee'; // voltmeters
  const ACOL = colors.current; // ammeters
  const OCOL = '#4ade80'; // ohmmeters
  const VWIRE = 'rgba(34,211,238,0.6)';
  const HL = '#f59e0b';

  const fx = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  const SUP = { '-': '⁻', '−': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  // Canvas text can't do <sup>, so turn fmtText's "10^19" into "10¹⁹".
  const sig = (x, s = 3) => EM.fmtText(x, s).replace(/\^([−-]?\d+)/g, (_, e) => [...e].map((c) => SUP[c]).join(''));
  function fmtOhm(R, s = 3) {
    if (!Number.isFinite(R)) return '∞ Ω';
    if (R >= 1e6) return sig(R / 1e6, s) + ' MΩ';
    if (R >= 1e3) return sig(R / 1e3, s) + ' kΩ';
    return sig(R, s) + ' Ω';
  }

  // .data-table th is uppercased by the stylesheet, which would turn ρ into P and m into M.
  const headRow = (...cols) => h('tr', {}, cols.map((c) => h('th', { html: c, style: { textTransform: 'none' } })));

  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  function polyAt(pts, f) {
    let d = EM.clamp(f, 0, 1) * polyLen(pts);
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= l || i === pts.length - 1) {
        const k = l ? Math.min(1, d / l) : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      }
      d -= l;
    }
    return pts[pts.length - 1];
  }

  /** Circuit-symbol meter (circle with a letter) plus an optional reading tag. */
  function meter(ctx, x, y, letter, reading, o = {}) {
    const r = o.r || 14;
    const col = o.color || (letter === 'V' ? VCOL : letter === 'A' ? ACOL : OCOL);
    if (o.hl) {
      ctx.save();
      ctx.strokeStyle = HL;
      ctx.lineWidth = 3;
      ctx.shadowColor = HL;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    D.text(ctx, letter, x, y + 1, { size: 13, weight: 800, color: col });
    if (reading) {
      let tx = x,
        ty = y + r + 13,
        al = 'center';
      const pos = o.pos || 'below';
      if (Array.isArray(pos)) [tx, ty, al] = pos;
      else if (pos === 'above') ty = y - r - 13;
      else if (pos === 'left') (tx = x - r - 6), (ty = y), (al = 'right');
      else if (pos === 'right') (tx = x + r + 6), (ty = y), (al = 'left');
      D.text(ctx, reading, tx, ty, { size: 12, weight: 700, color: col, align: al, bg: 'rgba(11,18,32,0.88)' });
    }
  }
  /** Voltmeter leads: from (x1,yw) and (x2,yw) out to a meter at ((x1+x2)/2, ym). */
  function vLeads(ctx, x1, x2, yw, ym) {
    D.wire(ctx, [[x1, yw], [x1, ym], [x2, ym], [x2, yw]], VWIRE, 1.6);
    node(ctx, x1, yw, VCOL);
    node(ctx, x2, yw, VCOL);
  }
  function node(ctx, x, y, col) {
    ctx.save();
    ctx.fillStyle = col || colors.wire;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function flow(ctx, pts, t, I, o = {}) {
    if (!(Math.abs(I) > 1e-4)) return;
    D.flowDots(ctx, pts, t, { speed: EM.clamp(I * (o.k || 30), -220, 220), spacing: o.spacing || 20, r: o.r || 3, color: o.color });
  }
  function hlBox(ctx, x, y, w, hh, label, below) {
    ctx.save();
    ctx.strokeStyle = HL;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    D.roundRect(ctx, x, y, w, hh, 10);
    ctx.stroke();
    ctx.restore();
    if (label) D.text(ctx, label, x + w / 2, below ? y + hh + 12 : y - 10, { size: 12, weight: 700, color: HL, bg: 'rgba(11,18,32,0.9)' });
  }
  function rot(ctx, x, y, a, fn) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a || 0);
    fn();
    ctx.restore();
  }
  function leads(ctx, len) {
    D.wire(ctx, [[-len, 0], [len, 0]], colors.wire, 2.5);
  }
  /* Component symbols drawn at the origin of the current transform (use rot()). */
  function symFixed(ctx, len = 40) {
    leads(ctx, len);
    D.resistor(ctx, 0, 0, { w: 44, h: 16 });
  }
  function symVariable(ctx, len = 40) {
    leads(ctx, len);
    D.resistor(ctx, 0, 0, { w: 44, h: 16 });
    D.arrow(ctx, -18, 16, 20, -20, { color: colors.wire, width: 2, head: 8 });
  }
  function symPot(ctx, len = 40) {
    leads(ctx, len);
    D.resistor(ctx, 0, 0, { w: 44, h: 16 });
    D.wire(ctx, [[34, -30], [0, -30], [0, -18]], colors.wire, 2.5);
    D.arrow(ctx, 0, -24, 0, -9, { color: colors.wire, width: 2, head: 8 });
  }
  function symLDR(ctx, len = 40, rr = 15) {
    leads(ctx, len);
    ctx.save();
    ctx.strokeStyle = colors.wire;
    ctx.lineWidth = 2;
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(0, 0, rr + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    D.resistor(ctx, 0, 0, { w: rr * 2.3, h: 12 });
    D.arrow(ctx, -30, -38, -14, -22, { color: colors.efield, width: 2, head: 7 });
    D.arrow(ctx, -18, -44, -2, -28, { color: colors.efield, width: 2, head: 7 });
  }
  function symThermistor(ctx, len = 40) {
    leads(ctx, len);
    D.resistor(ctx, 0, 0, { w: 44, h: 16 });
    D.wire(ctx, [[-32, 18], [-22, 18], [20, -20]], colors.wire, 2);
  }
  function symDiode(ctx, len = 30) {
    leads(ctx, len);
    ctx.save();
    ctx.fillStyle = colors.wire;
    ctx.beginPath();
    ctx.moveTo(-9, -11);
    ctx.lineTo(-9, 11);
    ctx.lineTo(9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    D.line(ctx, 10, -11, 10, 11, colors.wire, 3);
  }

  /* Component models */
  const ldrR = (lux) => EM.clamp(16000 * Math.pow(Math.max(lux, 1e-3) / 10, -0.8), 50, 2e6);
  const thermR = (Tc) => 10000 * Math.exp(3950 * (1 / (Tc + 273.15) - 1 / 298.15));
  const BULB = { Vr: 6, Ir: 0.6, n: 0.6 };
  const bulbI = (V) => Math.sign(V) * BULB.Ir * Math.pow(Math.abs(V) / BULB.Vr, BULB.n);
  const bulbV = (I) => Math.sign(I) * BULB.Vr * Math.pow(Math.abs(I) / BULB.Ir, 1 / BULB.n);
  const DIODE = { Is: 1e-9, nVt: 0.045, Rp: 10 };
  const diodeVofI = (I) => (I > 0 ? DIODE.nVt * Math.log(I / DIODE.Is + 1) : 0);
  /** Diode in series with a protective resistor across supply Vs → {Vd, I}. */
  function diodeOp(Vs) {
    let lo = Math.min(0, Vs),
      hi = Math.max(0, Vs);
    const f = (vd) => DIODE.Is * (Math.exp(vd / DIODE.nVt) - 1) - (Vs - vd) / DIODE.Rp;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (f(m) > 0) hi = m;
      else lo = m;
    }
    const Vd = (lo + hi) / 2;
    return { Vd, I: (Vs - Vd) / DIODE.Rp };
  }
  /** Operating point of a component on supply Vs: {V across component, I}. */
  function compOp(kind, Vs) {
    if (kind === 'resistor') return { V: Vs, I: Vs / 10 };
    if (kind === 'bulb') return { V: Vs, I: bulbI(Vs) };
    const o = diodeOp(Vs);
    return { V: o.Vd, I: o.I };
  }

  const MATERIALS = {
    copper: { name: 'Copper', rho: 1.7e-8, alpha: 0.0039, col: '#d97706' },
    aluminium: { name: 'Aluminium', rho: 2.8e-8, alpha: 0.0039, col: '#cbd5e1' },
    iron: { name: 'Iron', rho: 1.0e-7, alpha: 0.005, col: '#78716c' },
    constantan: { name: 'Constantan', rho: 4.9e-7, alpha: 0.00001, col: '#e7c27d' },
    nichrome: { name: 'Nichrome', rho: 1.1e-6, alpha: 0.0004, col: '#a8a29e' },
  };

  /* ------------------------------------------------------------------ simulations */

  /** Energy picture of voltage: charges gain W = Vq in the battery and give it up in the bulb. */
  function energySim(el) {
    const st = { V: 9, mode: 'elec' };
    const cSegs = [
      [[204, 250], [176, 250]],
      [[176, 250], [70, 250], [70, 90], [172, 90]],
      [[172, 90], [208, 90]],
      [[208, 90], [310, 90], [310, 250], [204, 250]],
    ];
    const fr = [0.18, 0.32, 0.18, 0.32];
    const N = 6;
    function seg(p) {
      let acc = 0;
      for (let i = 0; i < 4; i++) {
        if (p < acc + fr[i] || i === 3) return [i, Math.min(1, (p - acc) / fr[i])];
        acc += fr[i];
      }
    }
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Charges gaining energy in a battery and losing it in a bulb',
      draw(ctx, s) {
        const V = st.V,
          water = st.mode === 'water';
        D.grid(ctx, s.W, s.H);
        // ---- circuit
        D.wire(ctx, [[194, 250], [310, 250], [310, 90], [70, 90], [70, 250], [186, 250]]);
        D.cell(ctx, 190, 250, {});
        D.text(ctx, water ? 'battery = pump' : 'battery', 190, 216, { size: 12, color: colors.muted });
        D.bulb(ctx, 190, 90, V / 12, { r: 16 });
        D.text(ctx, water ? 'bulb = waterwheel' : 'bulb', 190, 118, { size: 12, color: colors.muted });
        vLeads(ctx, 150, 230, 90, 45);
        meter(ctx, 190, 45, 'V', fx(V, 1) + ' V', { pos: 'above' });
        vLeads(ctx, 150, 230, 250, 295);
        meter(ctx, 190, 295, 'V', fx(V, 1) + ' V', { pos: 'below' });
        // ---- energy hill
        const base = 280,
          top = base - (V / 12) * 180;
        const hSegs = [
          [[450, base], [510, top]],
          [[510, top], [630, top]],
          [[630, top], [690, base]],
          [[690, base], [450, base]],
        ];
        D.text(ctx, water ? 'Energy per unit of water' : 'Energy per coulomb', 570, 24, { size: 13, weight: 700 });
        ctx.save();
        ctx.fillStyle = water ? 'rgba(59,130,246,0.12)' : 'rgba(250,204,21,0.08)';
        ctx.beginPath();
        ctx.moveTo(450, base);
        ctx.lineTo(510, top);
        ctx.lineTo(630, top);
        ctx.lineTo(690, base);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        D.wire(ctx, [[450, base], [510, top], [630, top], [690, base], [450, base]], 'rgba(203,213,225,0.5)', 2);
        D.arrow(ctx, 436, base - 4, 496, top - 4, { color: VCOL, width: 3 });
        D.arrow(ctx, 644, top - 4, 704, base - 4, { color: colors.pos, width: 3 });
        D.text(ctx, `${water ? 'water carries' : 'charge carries'} ${fx(V, 1)} J`, 570, top - 32, { size: 12, color: colors.text });
        D.text(ctx, 'wires: no energy change', 570, base + 14, { size: 11, color: colors.muted });
        D.text(ctx, water ? `Pump gives ${fx(V, 1)} J to each unit of water ↑` : `Battery gives ${fx(V, 1)} J to each coulomb ↑`, 360, 320, { size: 13, weight: 700, color: VCOL, align: 'left' });
        D.text(ctx, water ? `Waterwheel uses ${fx(V, 1)} J from each unit of water ↓` : `Bulb uses ${fx(V, 1)} J from each coulomb ↓`, 712, 342, { size: 13, weight: 700, color: colors.pos, align: 'right' });
        if (water) {
          // waterwheel on the down slope
          const wx = 662,
            wy = (top + base) / 2;
          ctx.save();
          ctx.translate(wx, wy);
          ctx.rotate(s.t * 1.5);
          ctx.strokeStyle = colors.copper;
          ctx.lineWidth = 2;
          for (let k = 0; k < 8; k++) {
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(16, 0);
            ctx.stroke();
          }
          ctx.restore();
        }
        // ---- moving parcels
        for (let k = 0; k < N; k++) {
          const p = (s.t / 7 + k / N) % 1;
          const [i, f] = seg(p);
          const e = i === 0 ? f * V : i === 1 ? V : i === 2 ? (1 - f) * V : 0;
          const [cx, cy] = polyAt(cSegs[i], f);
          const [hx, hy] = polyAt(hSegs[i], f);
          const col = water ? `rgba(96,165,250,${0.35 + 0.65 * (e / Math.max(V, 0.1))})` : `rgba(250,204,21,${0.3 + 0.7 * (e / Math.max(V, 0.1))})`;
          for (const [x, y] of [
            [cx, cy],
            [hx, hy - 9],
          ]) {
            ctx.save();
            ctx.fillStyle = col;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
        D.text(ctx, water ? '● = 1 unit of water (brighter = more energy)' : '● = 1 coulomb (brighter = more energy)', 12, 346, { size: 12, align: 'left', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Picture',
      options: [
        { value: 'elec', label: 'Charges in a circuit' },
        { value: 'water', label: 'Water analogy' },
      ],
      value: 'elec',
      onChange: (v) => (st.mode = v),
    });
    EM.slider(c, { label: 'Battery voltage', min: 1.5, max: 12, step: 0.5, value: 9, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.V = v) });
    const ro = EM.readout(el, [
      { key: 'g', label: 'Energy given to each coulomb' },
      { key: 'u', label: 'Energy used from each coulomb' },
      { key: 'v', label: 'V = W ÷ q' },
    ]);
    const stat = EM.status(el);
    EM.every(150, () => {
      ro.set('g', fx(st.V, 1) + ' J');
      ro.set('u', fx(st.V, 1) + ' J');
      ro.set('v', `${fx(st.V, 1)} J ÷ 1 C = <strong>${fx(st.V, 1)} V</strong>`);
      stat.set(
        st.mode === 'water'
          ? 'The pump lifts each unit of water up the hill (gives it energy); the water gives that energy to the waterwheel on the way down. The battery is the pump, the bulb is the waterwheel.'
          : `Each coulomb is “lifted” ${fx(st.V, 1)} J in the battery and gives up ${fx(st.V, 1)} J in the bulb (as light and heat). The charge itself is not used up — it goes round again.`
      );
    });
  }

  /** EMF vs terminal voltage with internal resistance. */
  function emfSim(el) {
    const st = { E: 9, r: 1, R: 8, closed: false };
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Battery with internal resistance, a load resistor and a switch',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const I = st.closed ? st.E / (st.R + st.r) : 0;
        const Vt = st.E - I * st.r;
        const L = 110,
          Rt = 590,
          T = 130,
          B = 250;
        D.wire(ctx, [[296, T], [L, T], [L, B], [470, B]]);
        D.wire(ctx, [[520, B], [Rt, B], [Rt, T], [304, T]]);
        D.cell(ctx, 300, T, {});
        D.resistor(ctx, 370, T, { w: 34, h: 12 });
        D.text(ctx, 'r', 370, T + 18, { size: 12, color: colors.pos, weight: 700 });
        D.text(ctx, '+', 290, T - 22, { size: 14, weight: 800, color: colors.pos });
        D.text(ctx, '−', 312, T - 22, { size: 14, weight: 800, color: colors.neg });
        ctx.save();
        ctx.strokeStyle = '#a78bfa';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        D.roundRect(ctx, 272, T - 38, 128, 70, 8);
        ctx.stroke();
        ctx.restore();
        D.text(ctx, 'battery: EMF ℰ + internal resistance r', 335, T + 48, { size: 12, color: '#c4b5fd' });
        node(ctx, 240, T);
        node(ctx, 430, T);
        D.text(ctx, 'A′', 232, T + 16, { size: 12, color: colors.muted });
        D.text(ctx, 'B′', 440, T + 16, { size: 12, color: colors.muted });
        vLeads(ctx, 240, 430, T, 52);
        meter(ctx, 335, 52, 'V', fx(Vt) + ' V', { pos: 'right' });
        D.resistor(ctx, 300, B, { w: 52, h: 16 });
        D.text(ctx, 'R (load) = ' + fx(st.R, 1) + ' Ω', 300, B - 22, { size: 12, color: colors.muted });
        node(ctx, 250, B);
        node(ctx, 350, B);
        D.text(ctx, 'A', 250, B + 16, { size: 12, color: colors.muted });
        D.text(ctx, 'B', 350, B + 16, { size: 12, color: colors.muted });
        D.switch(ctx, 470, B, 520, st.closed, { label: st.closed ? 'switch closed' : 'switch open' });
        if (st.closed) flow(ctx, [[296, T], [L, T], [L, B], [Rt, B], [Rt, T], [304, T]], s.t, I, { k: 40 });
        // bars
        const by = 262,
          sc = 180 / 12;
        const bar = (x, v, col, lab) => {
          ctx.fillStyle = col;
          ctx.fillRect(x - 12, by - v * sc, 24, v * sc);
          D.text(ctx, lab, x, by + 14, { size: 12, weight: 700, color: col });
          D.text(ctx, fx(v, 1), x, by - v * sc - 10, { size: 11, color: colors.text });
        };
        bar(632, st.E, '#a78bfa', 'ℰ');
        bar(682, Vt, VCOL, 'V');
        if (I > 0) {
          ctx.save();
          ctx.strokeStyle = colors.pos;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(670, by - st.E * sc, 24, (st.E - Vt) * sc);
          ctx.restore();
          D.text(ctx, 'lost', 682, by - st.E * sc - 10, { size: 11, color: colors.pos });
        }
      },
    });
    const c = EM.controls(el);
    const tg = EM.toggle(c, { label: 'Close the switch', value: false, onChange: (v) => (st.closed = v) });
    EM.slider(c, { label: 'EMF ℰ', min: 1.5, max: 12, step: 0.5, value: 9, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.E = v) });
    EM.slider(c, { label: 'Internal resistance r', min: 0, max: 4, step: 0.1, value: 1, unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => (st.r = v) });
    EM.slider(c, { label: 'Load resistance R', min: 1, max: 30, step: 0.5, value: 8, unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => (st.R = v) });
    const ro = EM.readout(el, [
      { key: 'e', label: 'EMF ℰ' },
      { key: 'i', label: 'Current I' },
      { key: 'v', label: 'Terminal voltage V' },
      { key: 'l', label: '“Lost volts” Ir' },
    ]);
    const stat = EM.status(el);
    tg.el.title = 'Open/close the circuit';
    EM.every(120, () => {
      const I = st.closed ? st.E / (st.R + st.r) : 0;
      const Vt = st.E - I * st.r;
      ro.set('e', fx(st.E) + ' V');
      ro.set('i', fx(I) + ' A');
      ro.set('v', fx(Vt) + ' V');
      ro.set('l', fx(I * st.r) + ' V');
      if (!st.closed) stat.set(`Open circuit: no current flows, so the voltmeter reads the full EMF (${fx(st.E)} V).`, 'good');
      else if (st.r === 0) stat.set('With zero internal resistance nothing is “lost” inside the battery, so V = ℰ even with current flowing (an ideal battery).', '');
      else stat.set(`Current flows: the terminal voltage (${fx(Vt)} V) is <strong>less than</strong> the EMF (${fx(st.E)} V). ${fx(I * st.r)} V is used pushing the current through the battery itself.`, 'warn');
    });
  }

  /** Charge counter: current = charge passing a point per second. */
  function chargeFlowSim(el) {
    const st = { I: 2, t: 0, q: 0, run: true };
    const es = Array.from({ length: 70 }, () => ({ x: 40 + Math.random() * 640, y: 98 + Math.random() * 64, j: 0.8 + Math.random() * 0.4 }));
    let flash = 0;
    EM.canvas(el, {
      width: 720,
      height: 260,
      label: 'Electrons flowing past a counting point in a wire',
      draw(ctx, s, dt) {
        D.grid(ctx, s.W, s.H);
        if (st.run) {
          st.t += dt;
          st.q += st.I * dt;
        }
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 3;
        D.roundRect(ctx, 30, 85, 660, 90, 14);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        for (const e of es) {
          const ox = e.x;
          if (st.run) e.x += 32 * st.I * e.j * dt;
          if (ox < 360 && e.x >= 360) flash = 0.15;
          if (e.x > 680) e.x -= 640;
          D.electron(ctx, e.x, e.y, 4);
        }
        flash = Math.max(0, flash - dt);
        D.line(ctx, 360, 72, 360, 188, flash > 0 ? '#fca5a5' : colors.pos, 2.5, [6, 4]);
        D.text(ctx, 'counting point', 360, 200, { size: 12, color: colors.pos });
        D.arrow(ctx, 560, 50, 670, 50, { color: colors.electron, width: 3 });
        D.text(ctx, 'electron flow', 615, 30, { size: 12, color: colors.electron });
        D.arrow(ctx, 160, 50, 50, 50, { color: colors.current, width: 3 });
        D.text(ctx, 'conventional current', 105, 30, { size: 12, color: colors.current });
        meter(ctx, 360, 42, 'A', fx(st.I) + ' A', { pos: 'right' });
        const perS = st.I * 6.24e18;
        D.text(ctx, `Each second ${fx(st.I)} C ≈ ${sig(perS)} electrons pass the counting point`, 360, 236, { size: 13, color: colors.text });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Current', min: 0.5, max: 5, step: 0.25, value: 2, unit: 'A', fmt: (v) => fx(v), onInput: (v) => (st.I = v) });
    EM.button(c, '⟲ Reset stopwatch', () => {
      st.t = 0;
      st.q = 0;
    });
    const pb = EM.button(c, '⏸ Pause', () => {
      st.run = !st.run;
      pb.textContent = st.run ? '⏸ Pause' : '▶ Resume';
    });
    const ro = EM.readout(el, [
      { key: 't', label: 'Time t' },
      { key: 'q', label: 'Charge passed q' },
      { key: 'i', label: 'I = q ÷ t' },
      { key: 'n', label: 'Electrons passed' },
    ]);
    EM.every(100, () => {
      ro.set('t', fx(st.t, 1) + ' s');
      ro.set('q', fx(st.q, 1) + ' C');
      ro.set('i', st.t > 0.05 ? `${fx(st.q, 1)} ÷ ${fx(st.t, 1)} = <strong>${fx(st.q / st.t)} A</strong>` : '–');
      ro.set('n', EM.fmt(st.q * 6.24e18, 3));
    });
  }

  /** DC vs AC: electron motion and current-time graph (slow motion). */
  function dcacSim(el) {
    const st = { mode: 'ac', slow: 50, tau: 0 };
    const x0 = Array.from({ length: 34 }, (_, i) => ({ x: 110 + i * 17.5, y: 62 + ((i * 37) % 30) }));
    let dcShift = 0;
    const w = 2 * Math.PI * 50;
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: 'Electrons in a wire carrying direct or alternating current, with a current–time graph',
      draw(ctx, s, dt) {
        D.grid(ctx, s.W, s.H);
        const dtau = dt / st.slow;
        st.tau += dtau;
        const ac = st.mode === 'ac';
        const I = ac ? Math.sin(w * st.tau) : 1;
        if (!ac) dcShift += 20 * w * dtau;
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 2.5;
        D.roundRect(ctx, 100, 50, 600, 50, 12);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // source symbol
        if (ac) {
          ctx.save();
          ctx.strokeStyle = colors.wire;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(55, 75, 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k <= 20; k++) {
            const xx = 42 + (k / 20) * 26;
            const yy = 75 - 8 * Math.sin((k / 20) * 2 * Math.PI);
            k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
          }
          ctx.stroke();
          ctx.restore();
          D.text(ctx, 'mains', 55, 112, { size: 12, color: colors.muted });
        } else {
          D.cell(ctx, 55, 75, {});
          D.text(ctx, 'battery', 55, 112, { size: 12, color: colors.muted });
        }
        D.wire(ctx, [[77, 75], [100, 75]]);
        ctx.save();
        ctx.beginPath();
        ctx.rect(102, 52, 596, 46);
        ctx.clip();
        for (const e of x0) {
          let x = ac ? e.x - 20 * Math.cos(w * st.tau) : e.x + dcShift;
          x = 110 + ((((x - 110) % 600) + 600) % 600);
          D.electron(ctx, x, e.y, 4);
        }
        ctx.restore();
        const ex = 400;
        if (Math.abs(I) > 0.05) D.arrow(ctx, ex - 60 * I, 30, ex + 60 * I, 30, { color: colors.electron, width: 3 });
        D.text(ctx, 'electron flow', ex + (I >= 0 ? -150 : 150), 30, { size: 12, color: colors.electron });
        // graph
        const tm = st.tau % 0.04;
        const r = { x: 80, y: 160, w: 600, h: 140 };
        const g = D.plot(ctx, r, {
          xMin: 0,
          xMax: 0.04,
          yMin: -1.3,
          yMax: 1.3,
          xTicks: 4,
          yTicks: 2,
          xLabel: 'time (s)',
          yLabel: 'current',
          series: [{ fn: ac ? (t) => Math.sin(w * t) : () => 1, color: colors.current, width: 3 }],
          markers: [{ x: tm, y: I, color: '#fff', r: 6 }],
        });
        if (ac) {
          for (let k = 0; k < 4; k++) {
            const fwd = k % 2 === 0;
            ctx.fillStyle = fwd ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';
            ctx.fillRect(g.sx(k * 0.01), r.y, g.sx(0.01) - g.sx(0), r.h);
            D.text(ctx, fwd ? '→ one way: 1/100 s' : '← other way: 1/100 s', g.sx(k * 0.01 + 0.005), fwd ? r.y + 12 : r.y + r.h - 12, { size: 11, color: fwd ? colors.good : '#fca5a5' });
          }
        } else D.text(ctx, 'steady current in ONE direction', g.sx(0.02), r.y + 20, { size: 12, color: colors.good });
        D.text(ctx, ac ? 'Alternating current (AC), 50 Hz' : 'Direct current (DC)', r.x + r.w / 2, 140, { size: 13, weight: 700 });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Supply',
      options: [
        { value: 'dc', label: 'DC (battery)' },
        { value: 'ac', label: 'AC (mains)' },
      ],
      value: 'ac',
      onChange: (v) => (st.mode = v),
    });
    EM.segmented(c, {
      label: 'Slow motion',
      options: [
        { value: 100, label: '÷100' },
        { value: 50, label: '÷50' },
        { value: 25, label: '÷25' },
        { value: 1, label: 'real speed' },
      ],
      value: 50,
      onChange: (v) => (st.slow = v),
    });
    const ro = EM.readout(el, [
      { key: 't', label: 'Real time elapsed' },
      { key: 'd', label: 'Electrons moving' },
      { key: 'n', label: 'Direction reversals so far' },
    ]);
    const stat = EM.status(el);
    EM.every(100, () => {
      const ac = st.mode === 'ac';
      ro.set('t', fx(st.tau, 3) + ' s');
      ro.set('d', ac ? (Math.sin(w * st.tau) >= 0 ? '→ forwards' : '← backwards') : '→ forwards (always)');
      ro.set('n', ac ? String(Math.floor(st.tau / 0.01)) : '0');
      stat.set(
        ac
          ? 'AC: for 1/100 s the electrons flow one way, for the next 1/100 s the other way — 100 reversals every second, i.e. 50 complete cycles per second (50 Hz).'
          : 'DC: the electrons drift steadily in one direction only.'
      );
    });
  }

  /** Cartoon of resistance: free electrons colliding with vibrating ions in a metal lattice. */
  function latticeSim(el) {
    const st = { V: 6, T: 20, col: 0, colRate: 0, drift: 0 };
    const ions = [];
    for (let i = 0; i < 11; i++) for (let j = 0; j < 4; j++) ions.push({ bx: 80 + i * 56 + (j % 2) * 28, by: 92 + j * 44, ph: Math.random() * 6.28, heat: 0, x: 0, y: 0 });
    const es = Array.from({ length: 46 }, () => {
      const a = Math.random() * 6.28;
      return { x: 40 + Math.random() * 640, y: 70 + Math.random() * 180, vx: 40 * Math.cos(a), vy: 40 * Math.sin(a), cool: 0 };
    });
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Free electrons colliding with vibrating metal ions',
      draw(ctx, s, dt) {
        const amp = 1.5 + st.T / 45;
        let heatSum = 0;
        for (const ion of ions) {
          ion.heat *= Math.exp(-dt * 0.9);
          heatSum += ion.heat;
          const a = amp * (1 + 1.5 * Math.min(ion.heat, 1));
          ion.x = ion.bx + a * Math.sin(s.t * 23 + ion.ph);
          ion.y = ion.by + a * Math.cos(s.t * 19 + ion.ph * 1.3);
        }
        const heat = heatSum / ions.length;
        ctx.save();
        ctx.fillStyle = `rgba(239,68,68,${Math.min(0.28, heat * 0.9 + st.T / 2500)})`;
        ctx.fillRect(30, 60, 660, 200);
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(30, 60, 660, 200);
        ctx.restore();
        const R = 11 + amp;
        let colNow = 0,
          vsum = 0;
        for (const e of es) {
          e.vx += st.V * 14 * dt;
          const sp = Math.hypot(e.vx, e.vy);
          if (sp > 380) {
            e.vx *= 380 / sp;
            e.vy *= 380 / sp;
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.y < 66) (e.y = 66), (e.vy = Math.abs(e.vy));
          if (e.y > 254) (e.y = 254), (e.vy = -Math.abs(e.vy));
          if (e.x > 686) e.x -= 652;
          if (e.x < 34) e.x += 652;
          e.cool -= dt;
          if (e.cool <= 0)
            for (const ion of ions) {
              const dx = e.x - ion.x,
                dy = e.y - ion.y;
              if (dx * dx + dy * dy < R * R) {
                const ke = Math.hypot(e.vx, e.vy);
                const a = Math.random() * 6.28;
                const ns = 25 + Math.random() * 25;
                e.vx = ns * Math.cos(a);
                e.vy = ns * Math.sin(a);
                e.cool = 0.06;
                ion.heat += 0.05 + ke / 900;
                colNow++;
                break;
              }
            }
          vsum += e.vx;
        }
        st.colRate += ((dt > 0 ? colNow / dt : 0) - st.colRate) * Math.min(1, dt * 1.5);
        st.drift += (vsum / es.length - st.drift) * Math.min(1, dt * 1.5);
        for (const ion of ions) {
          const g = Math.min(1, ion.heat);
          ctx.save();
          ctx.fillStyle = `rgb(${Math.round(148 + 100 * g)},${Math.round(163 - 60 * g)},${Math.round(184 - 120 * g)})`;
          ctx.beginPath();
          ctx.arc(ion.x, ion.y, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          D.sign(ctx, ion.x, ion.y, 1, 4);
        }
        for (const e of es) D.electron(ctx, e.x, e.y, 3.5);
        D.text(ctx, '⊕ metal ion (vibrating)', 40, 280, { size: 12, align: 'left', color: colors.metal });
        D.text(ctx, '● free electron', 240, 280, { size: 12, align: 'left', color: colors.electron });
        D.text(ctx, 'red glow = heat produced by collisions', 690, 280, { size: 12, align: 'right', color: '#fca5a5' });
        if (st.V > 0) D.arrow(ctx, 300, 32, 420, 32, { color: colors.electron, width: 3 });
        D.text(ctx, st.V > 0 ? 'push from the applied voltage →' : 'no voltage: random motion only', st.V > 0 ? 290 : 360, 32, { size: 12, align: st.V > 0 ? 'right' : 'center', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Applied voltage', min: 0, max: 12, step: 0.5, value: 6, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.V = v) });
    EM.slider(c, { label: 'Temperature of the metal', min: 20, max: 400, step: 5, value: 20, unit: '°C', fmt: (v) => fx(v, 0), onInput: (v) => (st.T = v) });
    const ro = EM.readout(el, [
      { key: 'c', label: 'Collisions per second' },
      { key: 'd', label: 'Average drift speed' },
    ]);
    const stat = EM.status(el);
    EM.every(200, () => {
      ro.set('c', fx(st.colRate, 0));
      ro.set('d', fx(Math.max(0, st.drift), 0) + ' px/s');
      stat.set(
        st.T > 150
          ? 'Hot metal: the ions vibrate more, so electrons collide more often and drift more slowly → <strong>higher resistance</strong>.'
          : 'Each collision passes kinetic energy to an ion, making it vibrate more — electrical energy becomes heat. This “friction” is resistance.'
      );
    });
  }

  /** V–I graphs for an ohmic resistor, a filament bulb and a diode. */
  function viCompareSim(el) {
    const st = { Vs: 4, show: 'all' };
    const comps = [
      { k: 'resistor', name: 'Resistor (10 Ω)', col: colors.good },
      { k: 'bulb', name: 'Filament bulb', col: colors.current },
      { k: 'diode', name: 'Diode', col: '#f472b6' },
    ];
    const diodePts = [[0, -7], [0, 0]];
    for (let i = 1; i <= 80; i++) {
      const I = 0.7 * Math.pow(i / 80, 2);
      diodePts.push([I, diodeVofI(I)]);
    }
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Graph of voltage against current for three components',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const r = { x: 80, y: 30, w: 400, h: 280 };
        const vis = (k) => st.show === 'all' || st.show === k;
        const series = [];
        if (vis('resistor')) series.push({ fn: (I) => 10 * I, color: colors.good, width: 3, label: 'resistor' });
        if (vis('bulb')) series.push({ fn: (I) => bulbV(I), color: colors.current, width: 3, label: 'filament bulb' });
        if (vis('diode')) series.push({ points: diodePts, color: '#f472b6', width: 3, label: 'diode' });
        const markers = [];
        const ops = comps.map((c) => ({ c, op: compOp(c.k, st.Vs) }));
        for (const { c, op } of ops) if (vis(c.k)) markers.push({ x: EM.clamp(op.I, -0.7, 0.7), y: op.V, color: c.col, r: 6 });
        D.plot(ctx, r, { xMin: -0.7, xMax: 0.7, yMin: -7, yMax: 7, xTicks: 7, yTicks: 7, xLabel: 'current I (A)', yLabel: 'voltage V (V)', series, markers });
        // table
        let y = 50;
        D.text(ctx, `Supply: ${fx(st.Vs, 1)} V`, 600, y, { size: 13, weight: 700 });
        y += 30;
        for (const { c, op } of ops) {
          const a = vis(c.k) ? 1 : 0.35;
          ctx.globalAlpha = a;
          D.text(ctx, c.name, 510, y, { size: 13, weight: 700, color: c.col, align: 'left' });
          D.text(ctx, `V = ${fx(op.V)} V`, 520, y + 20, { size: 12, align: 'left' });
          D.text(ctx, `I = ${fx(op.I, 3)} A`, 520, y + 38, { size: 12, align: 'left' });
          D.text(ctx, `V ÷ I = ${Math.abs(op.I) < 1e-4 ? 'very large' : fmtOhm(op.V / op.I)}`, 520, y + 56, { size: 12, align: 'left' });
          ctx.globalAlpha = 1;
          y += 86;
        }
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Supply voltage (negative = connections reversed)', min: -6, max: 6, step: 0.1, value: 4, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.Vs = v) });
    EM.segmented(c, {
      label: 'Show',
      options: [
        { value: 'all', label: 'All three' },
        { value: 'resistor', label: 'Resistor' },
        { value: 'bulb', label: 'Bulb' },
        { value: 'diode', label: 'Diode' },
      ],
      value: 'all',
      onChange: (v) => (st.show = v),
    });
    const stat = EM.status(el);
    EM.every(200, () => {
      const m = {
        all: 'Only the resistor gives a straight line through the origin (0,0) — it is ohmic. The bulb and diode are non-ohmic.',
        resistor: 'Ohmic: straight line through the origin. V ÷ I is the same (10 Ω) at every point — double V, double I.',
        bulb: 'Non-ohmic: as the current rises the filament gets hotter, its resistance (V ÷ I) rises, and the graph curves upward.',
        diode: 'Non-ohmic: in reverse almost no current flows; forwards, current only flows once V ≈ 0.7 V. (A 10 Ω protective resistor is in series with the diode.)',
      };
      stat.set(m[st.show]);
    });
  }

  /** Ohm's law investigation: record V and I for a chosen component and plot V against I. */
  function ohmInvestigationSim(el) {
    const st = { kind: 'resistor', Vs: 3, rev: false, data: { resistor: [], bulb: [], diode: [] } };
    const names = { resistor: 'Resistor (metal wire at constant temperature)', bulb: 'Filament bulb', diode: 'Diode' };
    const op = () => compOp(st.kind, st.rev ? -st.Vs : st.Vs);
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Ohm’s law circuit with ammeter and voltmeter, and a graph of recorded readings',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const o = op();
        const L = 40,
          R = 330,
          T = 110,
          B = 290;
        const diode = st.kind === 'diode';
        D.wire(ctx, [[146, B], [L, B], [L, T], [140, T]]);
        D.wire(ctx, [[230, T], [R, T], [R, B], [154, B]]);
        // variable supply
        D.cell(ctx, 150, B, {});
        D.arrow(ctx, 132, B + 16, 170, B - 18, { color: colors.wire, width: 2, head: 7 });
        D.text(ctx, 'variable supply 0–6 V', 150, B + 34, { size: 12, color: colors.muted });
        // component
        if (st.kind === 'resistor') rot(ctx, 185, T, 0, () => D.resistor(ctx, 0, 0, { w: 52, h: 16 }));
        else if (st.kind === 'bulb') D.bulb(ctx, 185, T, Math.abs(o.I) / 0.6, { r: 16 });
        else rot(ctx, 185, T, 0, () => symDiode(ctx, 0));
        D.wire(ctx, [[140, T], [165, T]]);
        D.wire(ctx, [[205, T], [230, T]]);
        if (diode) {
          rot(ctx, R, 200, Math.PI / 2, () => D.resistor(ctx, 0, 0, { w: 46, h: 14 }));
          D.text(ctx, 'protective 10 Ω', R - 14, 200, { size: 11, color: colors.muted, align: 'right' });
        }
        vLeads(ctx, 145, 225, T, 55);
        meter(ctx, 185, 55, 'V', fx(o.V) + ' V', { pos: 'right' });
        meter(ctx, L, 200, 'A', fx(o.I, 3) + ' A', { pos: 'right' });
        flow(ctx, [[146, B], [L, B], [L, T], [R, T], [R, B], [154, B]], s.t, o.I, { k: 120 });
        D.text(ctx, names[st.kind].split(' (')[0], 185, 148, { size: 12, color: colors.text, weight: 700 });
        // graph
        const data = st.data[st.kind];
        const neg = st.rev || data.some((p) => p.I < 0 || p.V < 0);
        const r = { x: 420, y: 40, w: 270, h: 250 };
        const series = [];
        if (data.length >= 2) {
          const ratios = data.filter((p) => Math.abs(p.I) > 1e-4).map((p) => p.V / p.I);
          const lin = ratios.length >= 2 && Math.max(...ratios) / Math.min(...ratios) < 1.03 && Math.min(...ratios) > 0;
          if (lin) {
            const k = data.reduce((a, p) => a + p.I * p.V, 0) / data.reduce((a, p) => a + p.I * p.I, 0);
            series.push({ fn: (I) => k * I, color: colors.good, width: 2, dash: [6, 4] });
          } else {
            const pts = data.map((p) => [p.I, p.V]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            series.push({ points: pts, color: colors.warn, width: 2, dash: [6, 4] });
          }
        }
        const markers = data.map((p) => ({ x: p.I, y: p.V, color: '#fff', r: 4.5 }));
        const g = D.plot(ctx, r, { xMin: neg ? -0.7 : 0, xMax: 0.7, yMin: neg ? -7 : 0, yMax: 7, xTicks: neg ? 4 : 7, yTicks: neg ? 4 : 7, xLabel: 'current I (A)', yLabel: 'voltage V (V)', title: 'V against I (recorded points)', series, markers });
        ctx.save();
        ctx.strokeStyle = HL;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.sx(EM.clamp(o.I, neg ? -0.7 : 0, 0.7)), g.sy(EM.clamp(o.V, neg ? -7 : 0, 7)), 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Component',
      options: [
        { value: 'resistor', label: 'Resistor' },
        { value: 'bulb', label: 'Filament bulb' },
        { value: 'diode', label: 'Diode' },
      ],
      value: 'resistor',
      onChange: (v) => {
        st.kind = v;
        renderTable();
      },
    });
    EM.slider(c, { label: 'Supply setting', min: 0, max: 6, step: 0.25, value: 3, unit: 'V', fmt: (v) => fx(v), onInput: (v) => (st.Vs = v) });
    EM.toggle(c, { label: 'Reverse the connections', value: false, onChange: (v) => (st.rev = v) });
    EM.button(c, '● Record reading', () => {
      const o = op();
      const d = st.data[st.kind];
      if (!d.some((p) => Math.abs(p.V - o.V) < 1e-6 && Math.abs(p.I - o.I) < 1e-6)) d.push({ V: o.V, I: o.I });
      renderTable();
    }, 'primary');
    EM.button(c, 'Clear', () => {
      st.data[st.kind] = [];
      renderTable();
    });
    const stat = EM.status(el, 'Choose a supply setting, press “Record reading”, then change the setting and record again (aim for 6+ readings).');
    const tableWrap = add(el, 'div', {});
    function renderTable() {
      const d = st.data[st.kind];
      tableWrap.innerHTML = '';
      if (!d.length) {
        stat.set('Choose a supply setting, press “Record reading”, then change the setting and record again (aim for 6+ readings).');
        return;
      }
      const t = add(tableWrap, 'table', { class: 'data-table' });
      t.append(headRow('V (V)', 'I (A)', 'V ÷ I (Ω)'));
      for (const p of d) t.append(h('tr', {}, h('td', { text: fx(p.V) }), h('td', { text: fx(p.I, 3) }), h('td', { text: Math.abs(p.I) < 1e-4 ? 'very large' : fx(p.V / p.I, 1) })));
      if (d.length < 4) stat.set(`${d.length} reading(s) recorded — keep going.`);
      else {
        const ratios = d.filter((p) => Math.abs(p.I) > 1e-4).map((p) => p.V / p.I);
        const lin = ratios.length >= 2 && Math.max(...ratios) / Math.min(...ratios) < 1.03 && Math.min(...ratios) > 0 && ratios.length === d.length;
        if (lin) stat.set(`Straight line through the origin: V ÷ I is constant (≈ ${fx(ratios.reduce((a, b) => a + b, 0) / ratios.length, 1)} Ω = the gradient). I ∝ V → this conductor is <strong>ohmic</strong>.`, 'good');
        else stat.set('Not a straight line through the origin: V ÷ I changes → this component is <strong>non-ohmic</strong>.', 'warn');
      }
    }
  }

  /** Series vs parallel bulb board: click bulbs to blow/replace them. */
  function bulbBoardSim(el) {
    const st = { ser: [false, false, false], par: [false, false, false], sSw: true, pSw: true };
    const sB = [110, 180, 250].map((x) => [x, 80]);
    const pB = [70, 140, 210].map((y) => [540, y]);
    const solve = () => {
      const sOn = st.sSw && !st.ser.some((b) => b);
      const sI = sOn ? 6 / 18 : 0;
      const pI = st.par.map((b) => (st.pSw && !b ? 1 : 0));
      return { sOn, sI, pI };
    };
    EM.canvas(el, {
      width: 720,
      height: 320,
      label: 'Three bulbs in series and three bulbs in parallel; click a bulb to blow it',
      cursor: 'pointer',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const { sOn, sI, pI } = solve();
        D.line(ctx, 360, 20, 360, 300, 'rgba(148,163,184,0.25)', 1.5, [4, 4]);
        // series
        D.text(ctx, '1) In series', 180, 30, { size: 14, weight: 700 });
        D.wire(ctx, [[146, 250], [40, 250], [40, 80], [320, 80], [320, 250], [275, 250]]);
        D.wire(ctx, [[230, 250], [154, 250]]);
        D.cell(ctx, 150, 250, { label: '6 V battery' });
        D.switch(ctx, 230, 250, 275, st.sSw, { label: 'switch' });
        if (sOn) flow(ctx, [[146, 250], [40, 250], [40, 80], [320, 80], [320, 250], [154, 250]], s.t, sI, { k: 90 });
        sB.forEach(([x, y], i) => D.bulb(ctx, x, y, sOn ? Math.sqrt((sI * sI * 6) / 6) : 0, { r: 16, broken: st.ser[i], label: st.ser[i] ? 'blown' : sOn ? '2.0 V' : '0 V' }));
        D.text(ctx, `Current from battery: ${fx(sI)} A`, 180, 300, { size: 13, color: sOn ? colors.current : colors.muted, weight: 700 });
        // parallel
        D.text(ctx, '2) In parallel', 540, 30, { size: 14, weight: 700 });
        D.wire(ctx, [[516, 270], [420, 270], [420, 70], [660, 70], [660, 270], [620, 270]]);
        D.wire(ctx, [[580, 270], [524, 270]]);
        D.wire(ctx, [[420, 140], [660, 140]]);
        D.wire(ctx, [[420, 210], [660, 210]]);
        D.cell(ctx, 520, 270, {});
        D.text(ctx, '6 V battery', 470, 290, { size: 12, color: colors.muted });
        D.switch(ctx, 580, 270, 620, st.pSw, {});
        D.text(ctx, 'switch', 640, 290, { size: 12, color: colors.muted });
        pB.forEach(([x, y], i) => {
          if (pI[i]) flow(ctx, [[516, 270], [420, 270], [420, y], [660, y], [660, 270], [524, 270]], s.t + i * 0.11, pI[i], { k: 90 });
        });
        pB.forEach(([x, y], i) => D.bulb(ctx, x, y, pI[i], { r: 16, broken: st.par[i], label: st.par[i] ? 'blown' : pI[i] ? '6.0 V' : '0 V' }));
        const pTot = pI.reduce((a, b) => a + b, 0);
        D.text(ctx, `Current from battery: ${fx(pTot)} A`, 540, 312, { size: 13, color: pTot ? colors.current : colors.muted, weight: 700 });
      },
      onDown(p) {
        sB.forEach(([x, y], i) => {
          if (Math.hypot(p.x - x, p.y - y) < 24) st.ser[i] = !st.ser[i];
        });
        pB.forEach(([x, y], i) => {
          if (Math.hypot(p.x - x, p.y - y) < 24) st.par[i] = !st.par[i];
        });
        if (p.x > 222 && p.x < 283 && p.y > 215 && p.y < 262) st.sSw = !st.sSw;
        if (p.x > 572 && p.x < 628 && p.y > 240 && p.y < 282) st.pSw = !st.pSw;
      },
    });
    const c = EM.controls(el);
    EM.button(c, '💥 Blow the middle bulb in both', () => {
      st.ser[1] = true;
      st.par[1] = true;
    });
    EM.button(c, '🔄 Replace all bulbs', () => {
      st.ser = [false, false, false];
      st.par = [false, false, false];
    });
    EM.button(c, 'Flip both switches', () => {
      st.sSw = !st.sSw;
      st.pSw = !st.pSw;
    });
    const stat = EM.status(el);
    EM.every(150, () => {
      const sBlown = st.ser.some((b) => b),
        pBlown = st.par.filter((b) => b).length;
      if (!st.sSw && !st.pSw) stat.set('Both switches open: no complete circuit, so no current flows anywhere.');
      else if (sBlown && pBlown && pBlown < 3) stat.set('Series: one blown bulb breaks the only path, so <strong>every</strong> bulb goes out. Parallel: the other bulbs stay lit at full brightness — each still has a complete circuit.', 'warn');
      else if (sBlown) stat.set('Series: a blown bulb breaks the circuit, so all the series bulbs go out.', 'warn');
      else if (pBlown === 3) stat.set('All parallel bulbs are blown, so no path is left for the current.', 'warn');
      else if (pBlown) stat.set('Parallel: the other bulbs keep working at full brightness because they still have a complete circuit.', 'good');
      else stat.set('Click any bulb to blow (or replace) it, and click a switch to open/close it. Series bulbs share the 6 V (2 V each), so they are dimmer; each parallel bulb gets the full 6 V.');
    });
  }

  /** Current splitting at a junction (8 A → 5 A + 3 A). */
  function junctionSim(el) {
    const st = { I: 8, Ra: 3, Rb: 5 };
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Current splitting between two parallel branches with ammeters',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const Ia = (st.I * st.Rb) / (st.Ra + st.Rb),
          Ib = st.I - Ia;
        D.wire(ctx, [[20, 150], [200, 150]]);
        D.wire(ctx, [[200, 150], [200, 70], [520, 70], [520, 150]]);
        D.wire(ctx, [[200, 150], [200, 230], [520, 230], [520, 150]]);
        D.wire(ctx, [[520, 150], [700, 150]]);
        flow(ctx, [[20, 150], [200, 150]], s.t, st.I, { k: 14 });
        flow(ctx, [[200, 150], [200, 70], [520, 70], [520, 150]], s.t, Ia, { k: 14 });
        flow(ctx, [[200, 150], [200, 230], [520, 230], [520, 150]], s.t, Ib, { k: 14 });
        flow(ctx, [[520, 150], [700, 150]], s.t, st.I, { k: 14 });
        D.resistor(ctx, 410, 70, { w: 52, h: 16, label: 'path 1: ' + fx(st.Ra, 1) + ' Ω' });
        D.resistor(ctx, 410, 230, { w: 52, h: 16 });
        D.text(ctx, 'path 2: ' + fx(st.Rb, 1) + ' Ω', 410, 254, { size: 12, color: colors.muted });
        node(ctx, 200, 150);
        node(ctx, 520, 150);
        meter(ctx, 110, 150, 'A', fx(st.I) + ' A', { pos: 'above' });
        meter(ctx, 290, 70, 'A', fx(Ia) + ' A', { pos: 'above' });
        meter(ctx, 290, 230, 'A', fx(Ib) + ' A', { pos: 'below' });
        meter(ctx, 610, 150, 'A', fx(st.I) + ' A', { pos: 'above' });
        D.text(ctx, 'before the junction', 110, 182, { size: 11, color: colors.muted });
        D.text(ctx, 'after the junction', 610, 182, { size: 11, color: colors.muted });
        D.text(ctx, `${fx(Ia)} A + ${fx(Ib)} A = ${fx(st.I)} A`, 360, 150, { size: 14, weight: 700, color: colors.current, bg: 'rgba(11,18,32,0.9)' });
      },
    });
    const c = EM.controls(el);
    const sI = EM.slider(c, { label: 'Current in', min: 1, max: 10, step: 0.5, value: 8, unit: 'A', fmt: (v) => fx(v, 1), onInput: (v) => (st.I = v) });
    const sa = EM.slider(c, { label: 'Path 1 resistance', min: 1, max: 12, step: 0.5, value: 3, unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => (st.Ra = v) });
    const sb = EM.slider(c, { label: 'Path 2 resistance', min: 1, max: 12, step: 0.5, value: 5, unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => (st.Rb = v) });
    EM.button(c, 'Identical paths', () => {
      sb.set(sa.value, true);
    });
    EM.button(c, 'Notes’ example (8 A → 5 A + 3 A)', () => {
      sI.set(8, true);
      sa.set(3, true);
      sb.set(5, true);
    });
    const stat = EM.status(el);
    EM.every(150, () => {
      if (Math.abs(st.Ra - st.Rb) < 1e-9) stat.set('Identical paths → the current splits equally. Ammeter before = ammeter after = sum of the two branch ammeters.', 'good');
      else stat.set(`More current takes the easier (lower-resistance) path. The branch ammeters add up to ${fx(st.I)} A — the same as the ammeters before and after the junctions.`);
    });
  }

  /** Meters on a series or parallel circuit of three resistors. */
  function metersSim(el) {
    const st = { mode: 'series', V: 12, R: [4, 2, 6] };
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: 'Three resistors in series or in parallel with ammeters and voltmeters',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const [R1, R2, R3] = st.R;
        if (st.mode === 'series') {
          const Rt = R1 + R2 + R3,
            I = st.V / Rt;
          const L = 60,
            Rr = 660,
            T = 110,
            B = 270;
          D.wire(ctx, [[356, B], [L, B], [L, T], [Rr, T], [Rr, B], [364, B]]);
          D.cell(ctx, 360, B, { label: fx(st.V, 1) + ' V' });
          flow(ctx, [[356, B], [L, B], [L, T], [Rr, T], [Rr, B], [364, B]], s.t, I, { k: 25 });
          [200, 360, 520].forEach((x, i) => {
            D.resistor(ctx, x, T, { w: 50, h: 16 });
            D.text(ctx, `R${'₁₂₃'[i]} = ${fx(st.R[i], 1)} Ω`, x, T + 22, { size: 12, color: colors.muted });
            vLeads(ctx, x - 34, x + 34, T, 58);
            meter(ctx, x, 58, 'V', `V${'₁₂₃'[i]} = ${fx(I * st.R[i])} V`, { pos: 'above' });
          });
          meter(ctx, L, 190, 'A', fx(I) + ' A', { pos: 'right' });
          meter(ctx, 280, T, 'A', fx(I) + ' A', { pos: [280, T + 30, 'center'] });
          meter(ctx, Rr, 190, 'A', fx(I) + ' A', { pos: 'left' });
          vLeads(ctx, 330, 390, B, 310);
          meter(ctx, 360, 310, 'V', `V = ${fx(st.V)} V`, { pos: [400, 310, 'left'] });
        } else {
          const Is = st.R.map((r) => st.V / r);
          const It = Is[0] + Is[1] + Is[2];
          const L = 140,
            Rr = 580,
            B = 300,
            ys = [70, 150, 230];
          D.wire(ctx, [[356, B], [L, B], [L, ys[0]]]);
          D.wire(ctx, [[Rr, ys[0]], [Rr, B], [364, B]]);
          D.cell(ctx, 360, B, {});
          D.text(ctx, fx(st.V, 1) + ' V', 360, B + 26, { size: 12, color: colors.muted });
          ys.forEach((y, i) => {
            D.wire(ctx, [[L, y], [Rr, y]]);
            flow(ctx, [[356, B], [L, B], [L, y], [Rr, y], [Rr, B], [364, B]], s.t + i * 0.07, Is[i], { k: 25 });
          });
          ys.forEach((y, i) => {
            node(ctx, L, y);
            node(ctx, Rr, y);
            D.resistor(ctx, 400, y, { w: 50, h: 16 });
            D.text(ctx, `R${'₁₂₃'[i]} = ${fx(st.R[i], 1)} Ω`, 400, y + 21, { size: 12, color: colors.muted });
            vLeads(ctx, 366, 434, y, y - 30);
            meter(ctx, 400, y - 30, 'V', `${fx(st.V)} V`, { pos: [446, y - 30, 'left'], r: 12 });
            meter(ctx, 240, y, 'A', `I${'₁₂₃'[i]} = ${fx(Is[i])} A`, { pos: [240, y - 25, 'center'], r: 12 });
          });
          meter(ctx, 220, B, 'A', fx(It) + ' A', { pos: 'above' });
          meter(ctx, 500, B, 'A', fx(It) + ' A', { pos: 'above' });
          D.text(ctx, 'total in', 220, B + 26, { size: 11, color: colors.muted });
          D.text(ctx, 'total out', 500, B + 26, { size: 11, color: colors.muted });
        }
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Connection',
      options: [
        { value: 'series', label: 'Series' },
        { value: 'parallel', label: 'Parallel' },
      ],
      value: 'series',
      onChange: (v) => (st.mode = v),
    });
    EM.slider(c, { label: 'Supply', min: 1, max: 12, step: 0.5, value: 12, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.V = v) });
    ['R₁', 'R₂', 'R₃'].forEach((n, i) => EM.slider(c, { label: n, min: 1, max: 12, step: 0.5, value: st.R[i], unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => (st.R[i] = v) }));
    const ro = EM.readout(el, [
      { key: 'rt', label: 'Total resistance' },
      { key: 'i', label: 'Current' },
      { key: 'v', label: 'Voltages' },
    ]);
    const stat = EM.status(el);
    EM.every(150, () => {
      const [R1, R2, R3] = st.R;
      if (st.mode === 'series') {
        const Rt = R1 + R2 + R3,
          I = st.V / Rt;
        ro.set('rt', `${fx(R1, 1)} + ${fx(R2, 1)} + ${fx(R3, 1)} = ${fx(Rt)} Ω`);
        ro.set('i', `${fx(I)} A at every point`);
        ro.set('v', `${fx(I * R1)} + ${fx(I * R2)} + ${fx(I * R3)} = ${fx(st.V)} V`);
        stat.set('Series: the current is the <strong>same everywhere</strong>; the voltage is <strong>shared</strong> (the biggest resistor gets the biggest share) and V₁ + V₂ + V₃ = the supply voltage.', 'good');
      } else {
        const Is = st.R.map((r) => st.V / r);
        const It = Is[0] + Is[1] + Is[2];
        ro.set('rt', `1 ÷ (1/${fx(R1, 1)} + 1/${fx(R2, 1)} + 1/${fx(R3, 1)}) = ${fx(st.V / It)} Ω`);
        ro.set('i', `${fx(Is[0])} + ${fx(Is[1])} + ${fx(Is[2])} = ${fx(It)} A`);
        ro.set('v', `${fx(st.V)} V across every path`);
        stat.set('Parallel: the voltage across each path is the <strong>same</strong>; the current is <strong>shared</strong> (most through the smallest resistor) and the branch currents add up to the total.', 'good');
      }
    });
  }

  /** The notes' worked example: 3 Ω in series with 4 Ω ∥ 5 Ω ∥ 6 Ω on 12 V. */
  function workedCircuit(el, st) {
    EM.canvas(el, {
      width: 720,
      height: 400,
      label: 'Worked example circuit with meters on every part',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const c = solveWorked(st);
        const T = 60,
          M = 225,
          ys = [140, 225, 310],
          X1 = 320,
          X2 = 520;
        D.wire(ctx, [[346, T], [60, T], [60, M], [X1, M]]);
        D.wire(ctx, [[X2, M], [640, M], [640, T], [354, T]]);
        D.wire(ctx, [[X1, ys[0]], [X1, ys[2]]]);
        D.wire(ctx, [[X2, ys[0]], [X2, ys[2]]]);
        ys.forEach((y) => D.wire(ctx, [[X1, y], [X2, y]]));
        D.cell(ctx, 350, T, { label: fx(st.V, 1) + ' V' });
        flow(ctx, [[346, T], [60, T], [60, M], [X1, M]], s.t, c.I, { k: 30 });
        ys.forEach((y, i) => flow(ctx, [[X1, M], [X1, y], [X2, y], [X2, M]], s.t, c.Ib[i], { k: 30 }));
        flow(ctx, [[X2, M], [640, M], [640, T], [354, T]], s.t, c.I, { k: 30 });
        node(ctx, X1, M);
        node(ctx, X2, M);
        D.resistor(ctx, 200, M, { w: 50, h: 18 });
        D.text(ctx, fx(st.Rs, 1) + ' Ω', 200, M + 24, { size: 12, color: colors.text, weight: 700 });
        ys.forEach((y, i) => {
          D.resistor(ctx, 440, y, { w: 54, h: 18 });
          D.text(ctx, fx(st.Rp[i], 1) + ' Ω', 440, y + 1, { size: 11, color: colors.text, weight: 700 });
        });
        if (st.hl === 0) hlBox(ctx, 300, 112, 240, 220, 'parallel part: ' + fx(c.Rp) + ' Ω', true);
        if (st.hl === 1) hlBox(ctx, 140, 112, 400, 220, 'total: ' + fx(c.Rt) + ' Ω', true);
        vLeads(ctx, 160, 240, M, 182);
        meter(ctx, 60, 140, 'A', fx(c.I) + ' A', { pos: 'right', hl: st.hl === 2 || st.hl === 6 });
        meter(ctx, 200, 182, 'V', fx(c.Vs) + ' V', { pos: 'above', hl: st.hl === 3 });
        ys.forEach((y, i) => meter(ctx, 370, y, 'A', fx(c.Ib[i]) + ' A', { pos: 'above', r: 12, hl: st.hl === 5 || st.hl === 6 }));
        vLeads(ctx, X1, X2, ys[2], 360);
        meter(ctx, 420, 360, 'V', fx(c.Vp) + ' V', { pos: [534, 360, 'left'], hl: st.hl === 4 });
        D.text(ctx, '* conventional current', 712, 20, { size: 11, color: colors.muted, align: 'right' });
      },
    });
  }
  function solveWorked(st) {
    const Rp = 1 / (1 / st.Rp[0] + 1 / st.Rp[1] + 1 / st.Rp[2]);
    const Rt = st.Rs + Rp;
    const I = st.V / Rt;
    const Vs = I * st.Rs;
    const Vp = st.V - Vs;
    const Ib = st.Rp.map((r) => Vp / r);
    return { Rp, Rt, I, Vs, Vp, Ib };
  }

  /** Potential divider with fixed resistors, LDR, thermistor or potentiometer. */
  function dividerSim(el) {
    const st = { mode: 'fixed', Vin: 6, R1: 2, R2: 4, logLux: 2, T: 20, pos: 0.5 };
    const vals = () => {
      let R1, R2;
      if (st.mode === 'fixed') (R1 = st.R1), (R2 = st.R2);
      else if (st.mode === 'ldr') (R1 = 10000), (R2 = ldrR(Math.pow(10, st.logLux)));
      else if (st.mode === 'therm') (R1 = 30000), (R2 = thermR(st.T));
      else (R1 = (1 - st.pos) * 10000), (R2 = st.pos * 10000);
      const I = st.Vin / (R1 + R2);
      return { R1, R2, I, V1: I * R1, Vout: I * R2 };
    };
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Potential divider circuit with output voltage',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const v = vals();
        const X = 300,
          T = 50,
          Bm = 320;
        const yB = st.mode === 'pot' ? 300 - st.pos * 230 : 185;
        D.wire(ctx, [[110, 181], [110, T], [420, T]]);
        D.wire(ctx, [[110, 189], [110, Bm], [420, Bm]]);
        D.cell(ctx, 110, 185, { vertical: true, label: fx(st.Vin, 1) + ' V' });
        if (st.mode === 'pot') {
          D.wire(ctx, [[X, T], [X, Bm]]);
          rot(ctx, X, 185, 0, () => D.resistor(ctx, 0, 0, { vertical: true, w: 240, h: 20 }));
          D.wire(ctx, [[420, yB], [X + 34, yB]], colors.wire, 2.5);
          D.arrow(ctx, X + 34, yB, X + 12, yB, { color: colors.wire, width: 2.5, head: 9 });
          D.text(ctx, 'potentiometer', X - 16, 185, { size: 12, color: colors.muted, align: 'right' });
          D.text(ctx, '10 kΩ track', X - 16, 202, { size: 11, color: colors.muted, align: 'right' });
        } else {
          D.wire(ctx, [[X, T], [X, Bm]]);
          D.wire(ctx, [[X, 185], [420, 185]]);
          rot(ctx, X, 117, 0, () => D.resistor(ctx, 0, 0, { vertical: true, w: 60, h: 20 }));
          if (st.mode === 'fixed') rot(ctx, X, 253, 0, () => D.resistor(ctx, 0, 0, { vertical: true, w: 60, h: 20 }));
          else if (st.mode === 'ldr') rot(ctx, X, 253, Math.PI / 2, () => symLDR(ctx, 0));
          else rot(ctx, X, 253, Math.PI / 2, () => symThermistor(ctx, 0));
          const n2 = st.mode === 'fixed' ? 'R₂' : st.mode === 'ldr' ? 'LDR' : 'thermistor';
          D.text(ctx, `R₁ = ${fmtOhm(v.R1)}`, X - 22, 117, { size: 12, color: colors.text, align: 'right' });
          D.text(ctx, `${n2} = ${fmtOhm(v.R2)}`, X - 34, 253, { size: 12, color: colors.text, align: 'right' });
          node(ctx, X, 185);
        }
        [
          ['A', T],
          ['B', yB],
          ['C', Bm],
        ].forEach(([n, y]) => {
          node(ctx, 420, y, '#fff');
          D.text(ctx, n, 434, y, { size: 13, weight: 700, align: 'left' });
        });
        const varrow = (y1, y2, val) => {
          if (y2 - y1 < 22) return;
          D.arrow(ctx, 370, (y1 + y2) / 2, 370, y1 + 4, { color: VCOL, width: 2, head: 7 });
          D.arrow(ctx, 370, (y1 + y2) / 2, 370, y2 - 4, { color: VCOL, width: 2, head: 7 });
          D.text(ctx, fx(val) + ' V', 380, (y1 + y2) / 2, { size: 12, weight: 700, color: VCOL, align: 'left', bg: 'rgba(11,18,32,0.9)' });
        };
        varrow(T + 6, yB - 6, v.V1);
        varrow(yB + 6, Bm - 6, v.Vout);
        // output gauge
        const gx = 500,
          gy0 = 300,
          gh = 230;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(gx, gy0 - gh, 34, gh);
        ctx.fillStyle = VCOL;
        const fh = (v.Vout / st.Vin) * gh;
        ctx.fillRect(gx, gy0 - fh, 34, fh);
        ctx.strokeStyle = colors.muted;
        ctx.strokeRect(gx, gy0 - gh, 34, gh);
        D.text(ctx, 'output (B–C)', gx + 17, 52, { size: 12, color: colors.muted });
        D.text(ctx, fx(v.Vout) + ' V', gx + 17, gy0 + 16, { size: 14, weight: 800, color: VCOL });
        // mode-specific device
        const dx = 630;
        if (st.mode === 'ldr') {
          const on = v.Vout > st.Vin / 2;
          const lux = Math.pow(10, st.logLux);
          D.text(ctx, lux > 200 ? '☀️' : lux > 15 ? '⛅' : '🌙', dx, 80, { size: 30 });
          D.text(ctx, `${sig(lux, 2)} lux`, dx, 112, { size: 12, color: colors.muted });
          D.line(ctx, dx, 290, dx, 170, '#64748b', 5);
          D.line(ctx, dx, 170, dx + 32, 160, '#64748b', 5);
          D.bulb(ctx, dx + 38, 172, on ? 1 : 0, { r: 12 });
          D.text(ctx, on ? 'street light ON' : 'street light OFF', dx, 312, { size: 12, weight: 700, color: on ? colors.current : colors.muted });
        } else if (st.mode === 'therm') {
          const on = v.Vout > st.Vin / 2;
          ctx.fillStyle = '#1e293b';
          D.roundRect(ctx, dx - 8, 70, 16, 170, 8);
          ctx.fill();
          const th = ((st.T + 10) / 110) * 150;
          ctx.fillStyle = colors.pos;
          ctx.fillRect(dx - 4, 230 - th, 8, th);
          ctx.beginPath();
          ctx.arc(dx, 248, 14, 0, Math.PI * 2);
          ctx.fill();
          D.text(ctx, fx(st.T, 0) + ' °C', dx, 280, { size: 13, weight: 700 });
          D.text(ctx, on ? '❄ frost warning ON' : 'frost warning off', dx, 312, { size: 12, weight: 700, color: on ? '#93c5fd' : colors.muted });
        } else if (st.mode === 'pot') {
          D.text(ctx, '🔊', dx, 110, { size: 34 });
          for (let k = 0; k < 8; k++) {
            const on = k < Math.round(st.pos * 8);
            ctx.fillStyle = on ? colors.good : '#1e293b';
            ctx.fillRect(dx - 44 + k * 11, 230 - k * 9, 8, 14 + k * 9);
          }
          D.text(ctx, 'volume', dx, 270, { size: 12, color: colors.muted });
        } else {
          D.text(ctx, `I = ${fx(v.I)} A`, dx, 120, { size: 14, weight: 700, color: colors.current });
          D.text(ctx, `V across AB = ${fx(v.V1)} V`, dx, 160, { size: 13 });
          D.text(ctx, `V across BC = ${fx(v.Vout)} V`, dx, 184, { size: 13 });
          D.text(ctx, `sum = ${fx(v.V1 + v.Vout)} V`, dx, 214, { size: 13, color: colors.muted });
        }
        // kΩ circuits carry only ~mA, so scale the dot speed up to stay visible
        flow(ctx, [[110, 181], [110, T], [X, T], [X, Bm], [110, Bm], [110, 189]], s.t, v.I * (st.mode === 'fixed' ? 1 : 3000), { k: 30 });
      },
    });
    const c = EM.controls(el);
    const sliders = {};
    EM.segmented(c, {
      label: 'Lower part of the divider',
      options: [
        { value: 'fixed', label: 'Fixed resistors' },
        { value: 'ldr', label: 'LDR' },
        { value: 'therm', label: 'Thermistor' },
        { value: 'pot', label: 'Potentiometer' },
      ],
      value: 'fixed',
      onChange: (v) => {
        st.mode = v;
        show();
      },
    });
    sliders.vin = EM.slider(c, { label: 'Supply voltage', min: 1, max: 12, step: 0.5, value: 6, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => (st.Vin = v) });
    sliders.r1 = EM.slider(c, { label: 'R₁ (top)', min: 1, max: 20, step: 1, value: 2, unit: 'Ω', fmt: (v) => fx(v, 0), onInput: (v) => (st.R1 = v) });
    sliders.r2 = EM.slider(c, { label: 'R₂ (bottom)', min: 1, max: 20, step: 1, value: 4, unit: 'Ω', fmt: (v) => fx(v, 0), onInput: (v) => (st.R2 = v) });
    sliders.lux = EM.slider(c, { label: 'Light level', min: 0, max: 4, step: 0.05, value: 2, fmt: (v) => sig(Math.pow(10, v), 2) + ' lux', onInput: (v) => (st.logLux = v) });
    sliders.t = EM.slider(c, { label: 'Temperature', min: -10, max: 100, step: 1, value: 20, unit: '°C', fmt: (v) => fx(v, 0), onInput: (v) => (st.T = v) });
    sliders.pos = EM.slider(c, { label: 'Slider position (volume knob)', min: 0, max: 1, step: 0.01, value: 0.5, fmt: (v) => fx(v * 100, 0) + '%', onInput: (v) => (st.pos = v) });
    // .ctl sets display:flex, which beats the [hidden] attribute, so toggle display directly.
    const vis = (s, on) => (s.el.style.display = on ? '' : 'none');
    function show() {
      vis(sliders.r1, st.mode === 'fixed');
      vis(sliders.r2, st.mode === 'fixed');
      vis(sliders.lux, st.mode === 'ldr');
      vis(sliders.t, st.mode === 'therm');
      vis(sliders.pos, st.mode === 'pot');
    }
    show();
    const ro = EM.readout(el, [
      { key: 'r', label: 'Total resistance' },
      { key: 'i', label: 'Current I = V ÷ R<sub>total</sub>' },
      { key: 'v', label: 'V<sub>out</sub> = I × R<sub>2</sub>' },
    ]);
    const stat = EM.status(el);
    EM.every(150, () => {
      const v = vals();
      ro.set('r', fmtOhm(v.R1 + v.R2));
      ro.set('i', v.I < 0.01 ? sig(v.I * 1000) + ' mA' : fx(v.I) + ' A');
      ro.set('v', `<strong>${fx(v.Vout)} V</strong>`);
      const m = {
        fixed: 'The supply voltage is shared in proportion to the resistances: the bigger resistor gets the bigger share.',
        ldr: 'Darker → LDR resistance rises → it takes a bigger share of the voltage → V<sub>out</sub> rises. Above half the supply, the street light switches on.',
        therm: 'Colder → thermistor resistance rises → V<sub>out</sub> rises. Below about 2 °C the frost warning comes on.',
        pot: 'A potentiometer is a variable resistor with a sliding contact: moving the slider changes how the track is split, giving any output from 0 V up to the full supply — just like a volume knob.',
      };
      stat.set(m[st.mode]);
    });
  }

  /** Static symbol chart. */
  function symbolsSim(el, which) {
    const all = {
      fixed: ['Fixed resistor', symFixed],
      variable: ['Variable resistor', symVariable],
      pot: ['Potentiometer', symPot],
      ldr: ['LDR', symLDR],
      therm: ['Thermistor', symThermistor],
    };
    const list = which || Object.keys(all);
    const W = 720,
      Hh = 150;
    EM.canvas(el, {
      width: W,
      height: Hh,
      label: 'Circuit symbols',
      draw(ctx) {
        const step = W / list.length;
        list.forEach((k, i) => {
          const x = step * (i + 0.5);
          rot(ctx, x, 80, 0, () => all[k][1](ctx, 48));
          D.text(ctx, all[k][0], x, 132, { size: 13, weight: 700 });
        });
      },
    });
  }

  /** Inside an LDR: photons free electrons, lowering resistance. */
  function ldrPhotonSim(el) {
    const st = { p: 0.4, high: true };
    const atoms = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) atoms.push({ x: 222 + i * 35, y: 118 + j * 27, free: null });
    const photons = [];
    const freeE = [];
    let acc = 0;
    EM.canvas(el, {
      width: 720,
      height: 280,
      label: 'Photons freeing electrons inside a light dependent resistor',
      draw(ctx, s, dt) {
        D.grid(ctx, s.W, s.H);
        // light source
        ctx.save();
        const lg = ctx.createLinearGradient(0, 18, 0, 100);
        lg.addColorStop(0, st.high ? `rgba(253,224,71,${0.5 * st.p})` : `rgba(220,38,38,${0.5 * st.p})`);
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(200, 18, 320, 82);
        ctx.restore();
        D.text(ctx, st.high ? 'visible light (high-energy photons)' : 'infrared (low-energy photons)', 360, 12, { size: 12, color: st.high ? colors.current : '#fca5a5' });
        acc += 14 * st.p * dt;
        while (acc > 1) {
          acc -= 1;
          photons.push({ x: 215 + Math.random() * 290, y: 22 });
        }
        for (let i = photons.length - 1; i >= 0; i--) {
          const ph = photons[i];
          ph.y += 170 * dt;
          if (ph.y >= 100) {
            photons.splice(i, 1);
            if (st.high) {
              const bound = atoms.filter((a) => !a.free);
              if (bound.length) {
                const a = bound.reduce((b, c) => (Math.abs(c.x - ph.x) < Math.abs(b.x - ph.x) && Math.random() < 0.6 ? c : b), bound[(Math.random() * bound.length) | 0]);
                const e = { x: a.x, y: a.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 1.6 + Math.random(), home: a };
                a.free = e;
                freeE.push(e);
              }
            }
            continue;
          }
          ctx.save();
          ctx.strokeStyle = st.high ? colors.current : '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let k = 0; k <= 12; k++) {
            const yy = ph.y - 22 + k * 2;
            const xx = ph.x + 4 * Math.sin(k * 1.2 + s.t * 10);
            k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
          }
          ctx.stroke();
          ctx.restore();
        }
        // slab
        ctx.save();
        ctx.fillStyle = '#2b2140';
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 2;
        D.roundRect(ctx, 200, 100, 320, 120, 8);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        D.text(ctx, 'semiconductor', 360, 236, { size: 12, color: '#c4b5fd' });
        for (const a of atoms) {
          ctx.fillStyle = 'rgba(148,163,184,0.35)';
          ctx.beginPath();
          ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
          ctx.fill();
          if (a.free) D.hole(ctx, a.x, a.y, 4);
          else D.electron(ctx, a.x + 6 * Math.cos(s.t * 3 + a.x), a.y + 6 * Math.sin(s.t * 3 + a.x), 2.5, '#64748b');
        }
        for (let i = freeE.length - 1; i >= 0; i--) {
          const e = freeE[i];
          e.life -= dt;
          e.vx += 40 * dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.y < 106 || e.y > 214) e.vy *= -1;
          if (e.x > 514) e.x = 206;
          if (e.life <= 0) {
            e.home.free = null;
            freeE.splice(i, 1);
            continue;
          }
          D.electron(ctx, e.x, e.y, 4);
        }
        // ohmmeter
        D.wire(ctx, [[200, 160], [160, 160], [160, 258], [625, 258], [625, 190]]);
        D.wire(ctx, [[520, 160], [565, 160]]);
        ctx.save();
        ctx.fillStyle = '#ea580c';
        D.roundRect(ctx, 565, 110, 120, 80, 10);
        ctx.fill();
        ctx.fillStyle = '#c7d2a5';
        ctx.fillRect(577, 122, 96, 36);
        ctx.restore();
        const R = rLDR();
        D.text(ctx, fmtOhm(R), 625, 141, { size: 16, weight: 800, color: '#111827', font: 'ui-monospace, monospace' });
        D.text(ctx, 'ohmmeter', 625, 176, { size: 12, weight: 700, color: '#fff' });
        D.text(ctx, `free electrons: ${freeE.length}`, 40, 120, { size: 12, align: 'left', color: colors.electron });
        D.text(ctx, '● bound electron', 40, 145, { size: 12, align: 'left', color: '#94a3b8' });
        D.text(ctx, '○ gap left behind', 40, 170, { size: 12, align: 'left', color: colors.hole });
      },
    });
    function rLDR() {
      return st.high ? ldrR(Math.pow(10, 4 * st.p)) : ldrR(1);
    }
    const c = EM.controls(el);
    EM.slider(c, { label: 'Light intensity', min: 0, max: 1, step: 0.01, value: 0.4, fmt: (v) => fx(v * 100, 0) + '%', onInput: (v) => (st.p = v) });
    EM.segmented(c, {
      label: 'Type of light',
      options: [
        { value: 1, label: 'Visible (high energy)' },
        { value: 0, label: 'Infrared (low energy)' },
      ],
      value: 1,
      onChange: (v) => (st.high = !!v),
    });
    const stat = EM.status(el);
    EM.every(200, () => {
      if (!st.high) stat.set('These photons do not have enough energy to free electrons, so the resistance stays high however bright the light is.', 'warn');
      else stat.set(`More light → more photons → more freed electrons to carry charge → <strong>lower resistance</strong> (now ${fmtOhm(rLDR())}).`, 'good');
    });
  }

  /** DEMO: LDR resistance vs distance of a torch, read on an ohmmeter. */
  function ldrDemoSim(el) {
    const st = { d: 40, torch: true, room: true, drag: false, data: [] };
    const X0 = 352,
      K = 3.5;
    const lux = () => (st.torch ? 1500 * Math.pow(10 / st.d, 2) : 0) + (st.room ? 20 : 0.5);
    EM.canvas(el, {
      width: 720,
      height: 400,
      label: 'Torch shining on an LDR connected to an ohmmeter; drag the torch',
      cursor: 'grab',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const E = lux(),
          R = ldrR(E);
        const hx = X0 + st.d * K;
        // beam
        if (st.torch) {
          ctx.save();
          const a = EM.clamp(0.08 + 18 / st.d, 0, 0.75);
          const gr = ctx.createLinearGradient(hx, 0, X0, 0);
          gr.addColorStop(0, `rgba(253,230,138,${a})`);
          gr.addColorStop(1, `rgba(253,230,138,${a * 0.6})`);
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.moveTo(hx, 140);
          ctx.lineTo(hx, 160);
          ctx.lineTo(X0 - 6, 175);
          ctx.lineTo(X0 - 6, 125);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        // torch
        ctx.save();
        ctx.fillStyle = '#334155';
        ctx.fillRect(hx + 16, 140, 60, 20);
        ctx.fillStyle = '#475569';
        ctx.fillRect(hx, 134, 18, 32);
        ctx.fillStyle = st.torch ? '#fde68a' : '#64748b';
        ctx.fillRect(hx, 136, 4, 28);
        ctx.restore();
        D.text(ctx, 'torch (drag me)', hx + 40, 120, { size: 11, color: colors.muted });
        // LDR
        ctx.save();
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(330, 150, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7c2d12';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const yy = 136 + k * 5.5;
          ctx.moveTo(316, yy);
          ctx.lineTo(344, yy);
        }
        ctx.stroke();
        ctx.restore();
        D.wire(ctx, [[322, 172], [322, 200]], '#cbd5e1', 2);
        D.wire(ctx, [[338, 172], [338, 200]], '#cbd5e1', 2);
        D.text(ctx, 'LDR', 330, 112, { size: 12, weight: 700 });
        // ruler
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(X0, 206, 80 * K, 10);
        for (let cm = 0; cm <= 80; cm += 10) {
          D.line(ctx, X0 + cm * K, 206, X0 + cm * K, 214, '#92400e', 1.5);
          D.text(ctx, String(cm), X0 + cm * K, 226, { size: 10, color: colors.muted });
        }
        D.text(ctx, 'cm', X0 + 80 * K + 14, 226, { size: 10, color: colors.muted });
        // multimeter
        ctx.save();
        ctx.fillStyle = '#ea580c';
        D.roundRect(ctx, 30, 30, 150, 190, 14);
        ctx.fill();
        ctx.fillStyle = '#1f2937';
        D.roundRect(ctx, 40, 40, 130, 170, 10);
        ctx.fill();
        ctx.fillStyle = '#c7d2a5';
        ctx.fillRect(50, 52, 110, 42);
        ctx.restore();
        D.text(ctx, fmtOhm(R), 105, 73, { size: 18, weight: 800, color: '#111827', font: 'ui-monospace, monospace' });
        ctx.save();
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        ctx.arc(105, 145, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(105, 145);
        ctx.lineTo(105 + 24 * Math.cos(-2.2), 145 + 24 * Math.sin(-2.2));
        ctx.stroke();
        ctx.restore();
        D.text(ctx, 'Ω', 80, 108, { size: 13, weight: 800, color: '#fff' });
        D.text(ctx, 'Ohmmeter', 105, 196, { size: 12, weight: 700, color: '#fff' });
        node(ctx, 85, 216, '#dc2626');
        node(ctx, 125, 216, '#111827');
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(85, 216);
        ctx.bezierCurveTo(90, 270, 300, 250, 322, 200);
        ctx.stroke();
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(125, 216);
        ctx.bezierCurveTo(130, 290, 330, 260, 338, 200);
        ctx.stroke();
        ctx.restore();
        // graph
        const pts = st.data.slice().sort((a, b) => a.d - b.d);
        const ymax = Math.max(1, R / 1000, ...pts.map((p) => p.R / 1000)) * 1.15;
        D.plot(ctx, { x: 420, y: 262, w: 270, h: 100 }, {
          xMin: 0,
          xMax: 80,
          yMin: 0,
          yMax: ymax,
          xTicks: 4,
          yTicks: 3,
          xLabel: 'distance of torch (cm)',
          title: 'Resistance (kΩ) vs distance',
          series: pts.length > 1 ? [{ points: pts.map((p) => [p.d, p.R / 1000]), color: OCOL, width: 2 }] : [],
          markers: pts.map((p) => ({ x: p.d, y: p.R / 1000, color: '#fff', r: 4 })).concat([{ x: st.d, y: R / 1000, color: HL, r: 5 }]),
        });
        D.text(ctx, `light on LDR ≈ ${sig(E, 2)} lux`, 40, 300, { size: 13, align: 'left', color: colors.current });
        D.text(ctx, `torch distance = ${fx(st.d, 0)} cm`, 40, 324, { size: 13, align: 'left' });
        D.text(ctx, `ohmmeter reading = ${fmtOhm(R)}`, 40, 348, { size: 13, align: 'left', color: OCOL, weight: 700 });
      },
      onDown(p) {
        const hx = X0 + st.d * K;
        if (p.x > hx - 12 && p.x < hx + 80 && p.y > 115 && p.y < 180) st.drag = true;
      },
      onMove(p) {
        if (st.drag) {
          st.d = EM.clamp(Math.round((p.x - X0 - 20) / K), 5, 80);
          dSl.set(st.d);
        }
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    const dSl = EM.slider(c, { label: 'Distance of torch from LDR', min: 5, max: 80, step: 1, value: 40, unit: 'cm', fmt: (v) => fx(v, 0), onInput: (v) => (st.d = v) });
    EM.toggle(c, { label: 'Torch on', value: true, onChange: (v) => (st.torch = v) });
    EM.toggle(c, { label: 'Room lights on', value: true, onChange: (v) => (st.room = v) });
    EM.button(c, '● Record reading', () => {
      const R = ldrR(lux());
      const prev = st.data[st.data.length - 1];
      st.data = st.data.filter((p) => p.d !== st.d || p.torch !== st.torch);
      st.data.push({ d: st.d, R, torch: st.torch });
      if (prev && prev.torch && st.torch && st.d !== prev.d) {
        const closer = st.d < prev.d;
        stat.set(closer ? `Torch moved closer (${prev.d} → ${st.d} cm): more light, and the reading <strong>decreased</strong> (${fmtOhm(prev.R)} → ${fmtOhm(R)}).` : `Torch moved further away (${prev.d} → ${st.d} cm): less light, and the reading <strong>increased</strong> (${fmtOhm(prev.R)} → ${fmtOhm(R)}).`, closer ? 'good' : '');
      } else stat.set(`Recorded ${fmtOhm(R)} at ${st.d} cm. Now move the torch closer and record again.`);
      renderTable();
    }, 'primary');
    EM.button(c, 'Clear', () => {
      st.data = [];
      renderTable();
    });
    const stat = EM.status(el, 'Drag the torch (or use the slider) and watch the ohmmeter. Record readings at several distances.');
    const tw = add(el, 'div', {});
    function renderTable() {
      tw.innerHTML = '';
      if (!st.data.length) return;
      const t = add(tw, 'table', { class: 'data-table' });
      t.append(headRow('Distance (cm)', 'Torch', 'Ohmmeter reading'));
      st.data
        .slice()
        .sort((a, b) => a.d - b.d)
        .forEach((p) => t.append(h('tr', {}, h('td', { text: String(p.d) }), h('td', { text: p.torch ? 'on' : 'off' }), h('td', { text: fmtOhm(p.R) }))));
    }
  }

  /** Wire explorer: R = ρL/A with temperature. */
  function wireSim(el) {
    const st = { mat: 'nichrome', L: 1, d: 0.5, T: 20 };
    const calc = () => {
      const m = MATERIALS[st.mat];
      const rho = m.rho * (1 + m.alpha * (st.T - 20));
      const A = (Math.PI * Math.pow(st.d * 1e-3, 2)) / 4;
      return { m, rho, A, R: (rho * st.L) / A };
    };
    EM.canvas(el, {
      width: 720,
      height: 270,
      label: 'A wire whose length, thickness, material and temperature can be changed',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const { m, A, R } = calc();
        const Lpx = 60 + ((st.L - 0.1) / 1.9) * 540;
        const t = 4 + ((st.d - 0.1) / 1.9) * 36;
        const x0 = 360 - Lpx / 2,
          x1 = 360 + Lpx / 2,
          y = 100;
        // leads to ohmmeter
        D.wire(ctx, [[x0, y], [x0, 170], [330, 170], [330, 195]], '#dc2626', 2);
        D.wire(ctx, [[x1, y], [x1, 170], [390, 170], [390, 195]], '#64748b', 2);
        ctx.save();
        const g = ctx.createLinearGradient(0, y - t / 2, 0, y + t / 2);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.3, m.col);
        g.addColorStop(1, '#1f2937');
        ctx.fillStyle = g;
        D.roundRect(ctx, x0, y - t / 2, Lpx, t, Math.min(t / 2, 8));
        ctx.fill();
        if (st.T > 20) {
          ctx.fillStyle = `rgba(239,68,68,${Math.min(0.6, (st.T - 20) / 300)})`;
          D.roundRect(ctx, x0, y - t / 2, Lpx, t, Math.min(t / 2, 8));
          ctx.fill();
        }
        ctx.restore();
        node(ctx, x0, y, '#dc2626');
        node(ctx, x1, y, '#e5e7eb');
        D.arrow(ctx, 360, y - t / 2 - 18, x1, y - t / 2 - 18, { color: colors.muted, width: 1.5, head: 7 });
        D.arrow(ctx, 360, y - t / 2 - 18, x0, y - t / 2 - 18, { color: colors.muted, width: 1.5, head: 7 });
        D.text(ctx, `L = ${fx(st.L)} m`, 360, y - t / 2 - 32, { size: 12, color: colors.text, bg: 'rgba(11,18,32,0.9)' });
        // ohmmeter
        ctx.save();
        ctx.fillStyle = '#ea580c';
        D.roundRect(ctx, 290, 195, 140, 60, 10);
        ctx.fill();
        ctx.fillStyle = '#c7d2a5';
        ctx.fillRect(300, 203, 120, 32);
        ctx.restore();
        D.text(ctx, fmtOhm(R), 360, 220, { size: 16, weight: 800, color: '#111827', font: 'ui-monospace, monospace' });
        D.text(ctx, 'ohmmeter', 360, 246, { size: 11, weight: 700, color: '#fff' });
        // cross-section
        const cr = t / 2;
        ctx.save();
        ctx.fillStyle = m.col;
        ctx.beginPath();
        ctx.arc(650, 222, Math.max(cr, 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        D.text(ctx, 'cross-section', 650, 182, { size: 11, color: colors.muted });
        D.text(ctx, `d = ${fx(st.d)} mm`, 450, 207, { size: 12, align: 'left' });
        D.text(ctx, `A = ${sig(A * 1e6)} mm²`, 450, 227, { size: 12, align: 'left', color: colors.muted });
        D.text(ctx, `${m.name} at ${fx(st.T, 0)} °C`, 20, 215, { size: 13, weight: 700, align: 'left', color: m.col });
      },
    });
    const c = EM.controls(el);
    EM.select(c, { label: 'Material', options: Object.entries(MATERIALS).map(([k, m]) => ({ value: k, label: m.name })), value: 'nichrome', onChange: (v) => (st.mat = v) });
    EM.slider(c, { label: 'Length L', min: 0.1, max: 2, step: 0.05, value: 1, unit: 'm', fmt: (v) => fx(v), onInput: (v) => (st.L = v) });
    EM.slider(c, { label: 'Diameter d', min: 0.1, max: 2, step: 0.05, value: 0.5, unit: 'mm', fmt: (v) => fx(v), onInput: (v) => (st.d = v) });
    EM.slider(c, { label: 'Temperature', min: 0, max: 300, step: 5, value: 20, unit: '°C', fmt: (v) => fx(v, 0), onInput: (v) => (st.T = v) });
    const ro = EM.readout(el, [
      { key: 'rho', label: 'Resistivity ρ' },
      { key: 'a', label: 'Area A = πr²' },
      { key: 'r', label: 'R = ρL ÷ A' },
    ]);
    const stat = EM.status(el);
    let last = null;
    EM.every(150, () => {
      const { rho, A, R } = calc();
      ro.set('rho', EM.fmt(rho, 3) + ' Ω m');
      ro.set('a', EM.fmt(A, 3) + ' m²');
      ro.set('r', '<strong>' + fmtOhm(R) + '</strong>');
      const key = JSON.stringify(st);
      if (key !== last) {
        last = key;
        stat.set('Longer → more resistance (R ∝ L). Thicker → less resistance (R ∝ 1/A, so doubling the diameter quarters R). Hotter metal → more resistance. Different materials have different resistivities.');
      }
    });
  }

  /** Investigation: measure the resistivity of a wire sample. */
  function resistivityInvSim(el) {
    const SAMPLES = {
      A: { mat: 'nichrome', d: 0.315, reads: [0.318, 0.312, 0.316] },
      B: { mat: 'constantan', d: 0.457, reads: [0.455, 0.46, 0.457] },
      C: { mat: 'copper', d: 0.2, reads: [0.201, 0.198, 0.2] },
    };
    const st = { s: 'A', L: 50, drag: false, data: [] };
    const X0 = 60,
      K = 6;
    const sample = () => SAMPLES[st.s];
    const meanD = () => sample().reads.reduce((a, b) => a + b, 0) / 3;
    const R = () => {
      const sm = sample();
      const A = (Math.PI * Math.pow(sm.d * 1e-3, 2)) / 4;
      return (MATERIALS[sm.mat].rho * (st.L / 100)) / A;
    };
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: 'Wire on a metre stick with a sliding crocodile clip and an ohmmeter',
      cursor: 'grab',
      draw(ctx, s) {
        D.grid(ctx, s.W, s.H);
        const sm = sample();
        const m = MATERIALS[sm.mat];
        // metre stick
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(X0, 120, 100 * K, 22);
        for (let cm = 0; cm <= 100; cm += 5) {
          D.line(ctx, X0 + cm * K, 120, X0 + cm * K, cm % 10 ? 128 : 134, '#92400e', 1.2);
          if (cm % 10 === 0) D.text(ctx, String(cm), X0 + cm * K, 152, { size: 10, color: colors.muted });
        }
        D.text(ctx, 'metre stick (cm)', 360, 168, { size: 11, color: colors.muted });
        D.line(ctx, X0 - 10, 100, X0 + 100 * K + 10, 100, m.col, 3);
        D.text(ctx, `wire sample ${st.s}`, X0 + 20, 80, { size: 12, align: 'left', color: m.col, weight: 700 });
        const cx = X0 + st.L * K;
        // clips
        const clip = (x, col) => {
          ctx.save();
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(x - 7, 88);
          ctx.lineTo(x + 7, 88);
          ctx.lineTo(x + 4, 108);
          ctx.lineTo(x - 4, 108);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };
        D.wire(ctx, [[X0, 88], [X0, 60], [30, 60], [30, 240], [90, 240]], '#dc2626', 2);
        D.wire(ctx, [[cx, 88], [cx, 50], [690, 50], [690, 190], [200, 190], [200, 240], [190, 240]], '#64748b', 2);
        clip(X0, '#dc2626');
        clip(cx, '#111827');
        D.text(ctx, 'drag clip', cx, 36, { size: 11, color: colors.muted, bg: 'rgba(11,18,32,0.9)' });
        ctx.save();
        ctx.fillStyle = 'rgba(250,204,21,0.25)';
        ctx.fillRect(X0, 96, cx - X0, 8);
        ctx.restore();
        // ohmmeter
        ctx.save();
        ctx.fillStyle = '#ea580c';
        D.roundRect(ctx, 80, 210, 120, 70, 10);
        ctx.fill();
        ctx.fillStyle = '#c7d2a5';
        ctx.fillRect(90, 220, 100, 32);
        ctx.restore();
        D.text(ctx, fx(R(), 2) + ' Ω', 140, 237, { size: 16, weight: 800, color: '#111827', font: 'ui-monospace, monospace' });
        D.text(ctx, 'ohmmeter', 140, 268, { size: 11, weight: 700, color: '#fff' });
        D.text(ctx, `L = ${fx(st.L / 100)} m`, 140, 300, { size: 13, weight: 700 });
        D.text(ctx, `mean d = ${fx(meanD(), 3)} mm`, 140, 322, { size: 12, color: colors.muted });
        // graph
        const pts = st.data.slice().sort((a, b) => a.L - b.L);
        const ymax = Math.max(R(), ...pts.map((p) => p.R), 1) * 1.15;
        D.plot(ctx, { x: 320, y: 220, w: 370, h: 80 }, {
          xMin: 0,
          xMax: 1,
          yMin: 0,
          yMax: ymax,
          xTicks: 5,
          yTicks: 2,
          xLabel: 'length L (m)',
          series: pts.length > 1 ? [{ points: [[0, 0]].concat(pts.map((p) => [p.L, p.R])), color: OCOL, width: 2, dash: [5, 4] }] : [],
          markers: pts.map((p) => ({ x: p.L, y: p.R, color: '#fff', r: 4 })).concat([{ x: st.L / 100, y: R(), color: HL, r: 5 }]),
        });
        D.text(ctx, 'R (Ω)', 300, 212, { size: 11, color: colors.muted, align: 'left' });
      },
      onDown(p) {
        const cx = X0 + st.L * K;
        if (Math.abs(p.x - cx) < 20 && p.y > 30 && p.y < 150) st.drag = true;
      },
      onMove(p) {
        if (st.drag) {
          st.L = EM.clamp(Math.round((p.x - X0) / K), 10, 100);
          sl.set(st.L);
        }
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.select(c, {
      label: 'Wire sample',
      options: [
        { value: 'A', label: 'Sample A' },
        { value: 'B', label: 'Sample B' },
        { value: 'C', label: 'Sample C' },
      ],
      value: 'A',
      onChange: (v) => {
        st.s = v;
        st.data = [];
        render();
      },
    });
    const sl = EM.slider(c, { label: 'Length between the clips', min: 10, max: 100, step: 1, value: 50, unit: 'cm', fmt: (v) => fx(v, 0), onInput: (v) => (st.L = v) });
    EM.button(c, '● Record reading', () => {
      st.data = st.data.filter((p) => Math.abs(p.L - st.L / 100) > 1e-9);
      st.data.push({ L: st.L / 100, R: Math.round(R() * 100) / 100 });
      render();
    }, 'primary');
    EM.button(c, 'Clear', () => {
      st.data = [];
      render();
    });
    const out = add(el, 'div', {});
    const stat = EM.status(el);
    function render() {
      const sm = sample();
      const dm = meanD();
      const A = (Math.PI * Math.pow((dm / 2) * 1e-3, 2));
      out.innerHTML = `<p style="margin:10px 0 4px"><strong>Micrometer readings of the diameter:</strong> ${sm.reads.map((r) => fx(r, 3)).join(' mm, ')} mm → mean d = ${fx(dm, 3)} mm, so r = ${fx(dm / 2, 4)} mm = ${EM.fmt((dm / 2) * 1e-3, 3)} m and A = πr² = ${EM.fmt(A, 3)} m².</p>`;
      if (!st.data.length) {
        stat.set('Drag the black clip (or use the slider) to set the length, then record the ohmmeter reading. Repeat for at least 5 lengths.');
        return;
      }
      const t = add(out, 'table', { class: 'data-table' });
      t.append(headRow('L (m)', 'R (Ω)', 'ρ = RA/L (Ω m)'));
      const rhos = [];
      st.data
        .slice()
        .sort((a, b) => a.L - b.L)
        .forEach((p) => {
          const rho = (p.R * A) / p.L;
          rhos.push(rho);
          t.append(h('tr', {}, h('td', { text: fx(p.L) }), h('td', { text: fx(p.R) }), h('td', { html: EM.fmt(rho, 3) })));
        });
      const mean = rhos.reduce((a, b) => a + b, 0) / rhos.length;
      const m = MATERIALS[sm.mat];
      stat.set(
        rhos.length < 3
          ? `${rhos.length} reading(s) — record a few more lengths.`
          : `Mean ρ = <strong>${EM.fmt(mean, 3)} Ω m</strong>. R ∝ L (straight line through the origin). This matches ${m.name.toLowerCase()} (ρ ≈ ${EM.fmt(m.rho, 2)} Ω m).`,
        rhos.length < 3 ? '' : 'good'
      );
    }
    render();
  }

  /* ------------------------------------------------------------------ chapter */

  EM.chapter({
    id: 'c2',
    code: 'C.2',
    title: 'Electrical Circuits',
    color: '#2563eb',
    blurb: 'Potential difference, EMF, current (DC and AC), resistance and Ohm’s law, series and parallel circuits, potential dividers, LDRs and resistivity.',

    terms: [
      { id: 'potential-difference', term: 'Potential difference (p.d.)', def: 'The potential difference between two points is the work done in bringing a charge of 1 coulomb from one point to the other. Unit: the volt (V), or joule per coulomb (J/C). Measured with a voltmeter connected in parallel.' },
      { id: 'voltage', term: 'Voltage', def: 'The measure of the electrical potential energy difference between two points — a measure of the work done to bring this about. V = W/q.' },
      { id: 'volt', term: 'Volt (V)', def: 'One volt is the potential difference between two points if the work done in bringing a charge of 1 coulomb from one point to the other is 1 joule. 1 V = 1 J/C.' },
      { id: 'emf', term: 'EMF (electromotive force)', def: 'The voltage present at a source’s ends in an open circuit, when no current is flowing. It is the maximum energy the source can provide to each unit of charge, and it is a constant value.' },
      { id: 'terminal-voltage', term: 'Terminal voltage', def: 'The actual potential difference measured across a source’s terminals when it is powering a circuit. It is less than the EMF while current flows; with no current it equals the EMF.' },
      { id: 'current', term: 'Current', def: 'Current is the amount of charge passing any point in a conductor per second. I = q/t. Unit: the ampere (A); measured with an ammeter connected in series.' },
      { id: 'ampere', term: 'Ampere (A)', def: 'The unit of current. 1 A is 1 coulomb of charge per second — about 6.24 × 10<sup>18</sup> electrons passing a point every second.' },
      { id: 'coulomb', term: 'Coulomb (C)', def: 'The unit of charge: 1 coulomb is the charge on 6.24 × 10<sup>18</sup> electrons.' },
      { id: 'dc', term: 'Direct current (DC)', def: 'A current flowing in one direction only. Direct current comes from a battery.' },
      { id: 'ac', term: 'Alternating current (AC)', def: 'A current that reverses its direction 100 times every second. It comes from the mains supply and has a frequency of 50 Hz.' },
      { id: 'resistance', term: 'Resistance', def: 'Resistance is the opposition to current flow in an electrical circuit. Unit: the ohm (Ω); measured using an ohmmeter.' },
      { id: 'ohm-unit', term: 'Ohm (Ω)', def: 'The unit of resistance, measured using an ohmmeter. From V = IR, 1 Ω = 1 volt per ampere.' },
      { id: 'ohms-law', term: 'Ohm’s law', def: 'For certain conductors with a fixed resistance and a constant temperature, the current flowing through them is directly proportional to the potential difference across them. V = IR.' },
      { id: 'ohmic', term: 'Ohmic conductor', def: 'A conductor that obeys Ohm’s law. Its graph of voltage against current is a straight line through the origin (0,0).' },
      { id: 'non-ohmic', term: 'Non-ohmic conductor', def: 'A conductor that does not obey Ohm’s law, e.g. filament bulbs and diodes. Its graph of voltage against current is not a straight line through the origin.' },
      { id: 'series', term: 'Series circuit', def: 'Components connected one after another in a single loop. The current is the same at every point; the voltage is shared. If one bulb blows, the circuit fails. R<sub>Total</sub> = R<sub>1</sub> + R<sub>2</sub> + …' },
      { id: 'parallel', term: 'Parallel circuit', def: 'Components connected on separate paths (branches) between the same two points. The voltage across each path is the same; the current is shared. If one bulb blows the others keep working. 1/R<sub>Total</sub> = 1/R<sub>1</sub> + 1/R<sub>2</sub> + …' },
      { id: 'junction-rule', term: 'Current at a point (junction)', def: 'The sum of the current entering a point in a circuit always equals the sum of the current leaving it.' },
      { id: 'series-voltage', term: 'Voltage in a series circuit', def: 'The potential difference across two or more consecutive parts of a series circuit is equal to the sum of the potential differences across each part: V = V<sub>1</sub> + V<sub>2</sub> + V<sub>3</sub> + … The emf of a circuit = the sum of all the individual voltages.' },
      { id: 'parallel-voltage', term: 'Voltage in a parallel circuit', def: 'The potential difference across each of a number of conductors connected in parallel with each other is the same: V<sub>1</sub> = V<sub>2</sub> = V<sub>3</sub> = …' },
      { id: 'potential-divider', term: 'Potential divider', def: 'Used to get a variety of different voltages from a single voltage supply. It consists of two resistors connected in series with a battery.' },
      { id: 'ldr', term: 'Light dependent resistor (LDR)', def: 'A semiconductor whose resistance decreases when the amount of light falling on it increases.' },
      { id: 'resistivity', term: 'Resistivity (ρ)', def: 'The resistivity of a material is a measure of how strongly it resists the flow of electric current. Unit: the ohm-metre (Ω m). ρ = RA/L.' },
    ],

    formulas: [
      {
        id: 'v-wq',
        name: 'Voltage (potential difference)',
        display: `<var>V</var> = ${EM.frac('<var>W</var>', '<var>q</var>')}`,
        vars: [
          { sym: 'V', name: 'Voltage (potential difference)', unit: 'V', value: 9 },
          { sym: 'W', name: 'Work done (energy transferred)', unit: 'J', value: 18 },
          { sym: 'q', name: 'Charge', unit: 'C', value: 2 },
        ],
        solve: {
          V: (v) => v.W / v.q,
          W: (v) => v.V * v.q,
          q: (v) => v.W / v.V,
        },
        notes: '1 V = 1 J/C: a 9 V battery gives 9 J of energy to every coulomb that passes through it, and 9 J is used from each coulomb in the rest of the circuit.',
        example: { q: 'A 9 V battery drives 2 C of charge round a circuit. How much energy does the bulb receive?', a: 'W = Vq = 9 × 2 = <strong>18 J</strong> (9 J from each coulomb).' },
      },
      {
        id: 'i-qt',
        name: 'Current',
        display: `<var>I</var> = ${EM.frac('<var>q</var>', '<var>t</var>')}`,
        vars: [
          { sym: 'I', name: 'Current', unit: 'A', value: 2 },
          { sym: 'q', name: 'Charge', unit: 'C', value: 10 },
          { sym: 't', name: 'Time', unit: 's', value: 5 },
        ],
        solve: {
          I: (v) => v.q / v.t,
          q: (v) => v.I * v.t,
          t: (v) => v.q / v.I,
        },
        notes: '1 A = 1 C per second ≈ 6.24 × 10<sup>18</sup> electrons per second. Use seconds for t (1 minute = 60 s).',
        example: { q: 'A charge of 10 C passes a point in a wire in 5 s. Find the current. How many electrons is that?', a: 'I = q/t = 10/5 = <strong>2 A</strong>. Number of electrons = 10 × 6.24 × 10<sup>18</sup> = <strong>6.24 × 10<sup>19</sup></strong>.' },
      },
      {
        id: 'ohm',
        name: 'Ohm’s law',
        display: '<var>V</var> = <var>I</var> × <var>R</var>',
        vars: [
          { sym: 'V', name: 'Voltage', unit: 'V', value: 12 },
          { sym: 'I', name: 'Current', unit: 'A', value: 2 },
          { sym: 'R', name: 'Resistance', unit: 'Ω', value: 6 },
        ],
        solve: {
          V: (v) => v.I * v.R,
          I: (v) => v.V / v.R,
          R: (v) => v.V / v.I,
        },
        notes: 'Only true for ohmic conductors (fixed resistance, constant temperature). Rearranged: I = V/R and R = V/I.',
        example: { q: 'In the notes’ worked example a current of 2.59 A flows through the 3 Ω resistor. Find the voltage across it.', a: 'V = IR = 2.59 × 3 = <strong>7.8 V</strong>' },
      },
      {
        id: 'series-r',
        name: 'Resistors in series',
        display: '<var>R</var><sub>Total</sub> = <var>R</var><sub>1</sub> + <var>R</var><sub>2</sub> + <var>R</var><sub>3</sub> + …',
        vars: [
          { sym: 'RT', label: 'R<sub>T</sub>', name: 'Total resistance', unit: 'Ω', value: 7 },
          { sym: 'R1', label: 'R<sub>1</sub>', name: 'First resistor', unit: 'Ω', value: 3 },
          { sym: 'R2', label: 'R<sub>2</sub>', name: 'Second resistor', unit: 'Ω', value: 4 },
          { sym: 'R3', label: 'R<sub>3</sub>', name: 'Third resistor (enter 0 if there are only two)', unit: 'Ω', value: 0 },
        ],
        solve: {
          RT: (v) => v.R1 + v.R2 + v.R3,
          R1: (v) => {
            const r = v.RT - v.R2 - v.R3;
            return r > 0 ? r : NaN;
          },
        },
        notes: 'Adding resistors in series always <em>increases</em> the total resistance.',
        derivation: [
          'The emf of a circuit = the sum of all the individual voltages: <var>V</var> = <var>V</var><sub>1</sub> + <var>V</var><sub>2</sub> + …',
          'From Ohm’s law <var>V</var> = <var>IR</var>, and the same current <var>I</var> flows through every part of a series circuit.',
          'Sub in <var>IR</var> for each <var>V</var>: <var>IR</var> = <var>IR</var><sub>1</sub> + <var>IR</var><sub>2</sub> + …',
          'Divide by <var>I</var>: <var>R</var> = <var>R</var><sub>1</sub> + <var>R</var><sub>2</sub> + …',
        ],
        example: { q: 'In the notes’ worked example the parallel group (1.62 Ω) is in series with a 3 Ω resistor. Find the total resistance.', a: 'R<sub>T</sub> = 3 + 1.62 = <strong>4.62 Ω</strong>' },
      },
      {
        id: 'parallel-r',
        name: 'Resistors in parallel',
        display: `${EM.frac('1', '<var>R</var><sub>Total</sub>')} = ${EM.frac('1', '<var>R</var><sub>1</sub>')} + ${EM.frac('1', '<var>R</var><sub>2</sub>')} + ${EM.frac('1', '<var>R</var><sub>3</sub>')} + …`,
        vars: [
          { sym: 'RT', label: 'R<sub>T</sub>', name: 'Total resistance', unit: 'Ω', value: 1.62 },
          { sym: 'R1', label: 'R<sub>1</sub>', name: 'First resistor', unit: 'Ω', value: 4 },
          { sym: 'R2', label: 'R<sub>2</sub>', name: 'Second resistor', unit: 'Ω', value: 5 },
          { sym: 'R3', label: 'R<sub>3</sub>', name: 'Third resistor (enter 0 if there are only two)', unit: 'Ω', value: 6 },
        ],
        solve: {
          RT: (v) => {
            const s = [v.R1, v.R2, v.R3].reduce((a, r) => a + (r === 0 ? 0 : 1 / r), 0);
            return v.R1 > 0 && v.R2 > 0 && v.R3 >= 0 ? 1 / s : NaN;
          },
          R1: (v) => {
            const x = 1 / v.RT - 1 / v.R2 - (v.R3 === 0 ? 0 : 1 / v.R3);
            return x > 0 ? 1 / x : NaN;
          },
        },
        notes: 'Remember to flip the answer: work out 1/R<sub>T</sub>, then take 1 ÷ that. The total is always <em>smaller</em> than the smallest resistor in the group.',
        derivation: [
          'The sum of the current entering a point = the sum leaving it: <var>I</var> = <var>I</var><sub>1</sub> + <var>I</var><sub>2</sub> + …',
          `From Ohm’s law <var>V</var> = <var>IR</var> ⇒ <var>I</var> = ${EM.frac('<var>V</var>', '<var>R</var>')}, and the voltage <var>V</var> is the same across every parallel path.`,
          `Sub in for each <var>I</var>: ${EM.frac('<var>V</var>', '<var>R</var>')} = ${EM.frac('<var>V</var>', '<var>R</var><sub>1</sub>')} + ${EM.frac('<var>V</var>', '<var>R</var><sub>2</sub>')} + …`,
          `Divide by <var>V</var>: ${EM.frac('1', '<var>R</var>')} = ${EM.frac('1', '<var>R</var><sub>1</sub>')} + ${EM.frac('1', '<var>R</var><sub>2</sub>')} + …`,
        ],
        example: { q: 'Find the total resistance of 4 Ω, 5 Ω and 6 Ω in parallel (notes’ worked example).', a: '1/R<sub>T</sub> = 1/4 + 1/5 + 1/6 = 0.617, so R<sub>T</sub> = 1 ÷ 0.617 = <strong>1.62 Ω</strong>' },
      },
      {
        id: 'series-v',
        name: 'Voltage in a series circuit',
        display: '<var>V</var> = <var>V</var><sub>1</sub> + <var>V</var><sub>2</sub> + <var>V</var><sub>3</sub> + …',
        vars: [
          { sym: 'V', name: 'Total voltage (emf of the supply)', unit: 'V', value: 12 },
          { sym: 'V1', label: 'V<sub>1</sub>', name: 'Voltage across part 1', unit: 'V', value: 7.8 },
          { sym: 'V2', label: 'V<sub>2</sub>', name: 'Voltage across part 2', unit: 'V', value: 4.2 },
          { sym: 'V3', label: 'V<sub>3</sub>', name: 'Voltage across part 3 (0 if only two parts)', unit: 'V', value: 0 },
        ],
        solve: {
          V: (v) => v.V1 + v.V2 + v.V3,
          V1: (v) => v.V - v.V2 - v.V3,
        },
        notes: 'The emf of a circuit = the sum of all the individual voltages in that circuit. In series the voltage is shared.',
        example: { q: 'A 12 V supply drives current through a 3 Ω resistor, which has 7.8 V across it, in series with a parallel group. What is the voltage across the parallel group?', a: '12 = 7.8 + V<sub>2</sub> ⇒ V<sub>2</sub> = 12 − 7.8 = <strong>4.2 V</strong>' },
      },
      {
        id: 'parallel-v',
        name: 'Voltage in a parallel circuit',
        display: '<var>V</var><sub>1</sub> = <var>V</var><sub>2</sub> = <var>V</var><sub>3</sub> = …',
        vars: [
          { sym: 'V1', label: 'V<sub>1</sub>', name: 'Voltage across path 1', unit: 'V' },
          { sym: 'V2', label: 'V<sub>2</sub>', name: 'Voltage across path 2', unit: 'V' },
          { sym: 'V3', label: 'V<sub>3</sub>', name: 'Voltage across path 3', unit: 'V' },
        ],
        notes: 'P.d. across path 1 = p.d. across path 2 = p.d. across path 3 … Every parallel path is connected between the same two points, so each gets the same voltage (no calculator needed!).',
        example: { q: 'In the worked example, the 4 Ω, 5 Ω and 6 Ω resistors are in parallel and 4.2 V is across the group. What is the voltage across the 5 Ω resistor?', a: 'The same as across the group: <strong>4.2 V</strong> (and 4.2 V across the 4 Ω and the 6 Ω too).' },
      },
      {
        id: 'junction',
        name: 'Current at a junction',
        display: '<var>I</var> = <var>I</var><sub>1</sub> + <var>I</var><sub>2</sub> + <var>I</var><sub>3</sub> + …',
        vars: [
          { sym: 'I', name: 'Total current (into the junction)', unit: 'A', value: 8 },
          { sym: 'I1', label: 'I<sub>1</sub>', name: 'Current in path 1', unit: 'A', value: 5 },
          { sym: 'I2', label: 'I<sub>2</sub>', name: 'Current in path 2', unit: 'A', value: 3 },
          { sym: 'I3', label: 'I<sub>3</sub>', name: 'Current in path 3 (0 if only two paths)', unit: 'A', value: 0 },
        ],
        solve: {
          I: (v) => v.I1 + v.I2 + v.I3,
          I1: (v) => v.I - v.I2 - v.I3,
        },
        notes: 'The sum of the current entering a point = the sum of the current leaving it. In parallel the current is shared.',
        example: { q: 'A current of 8 A splits at a junction and 5 A goes along one path. How much goes along the other?', a: '8 = 5 + I<sub>2</sub> ⇒ I<sub>2</sub> = <strong>3 A</strong>. (Worked example check: 1.05 + 0.84 + 0.7 = 2.59 A = total current.)' },
      },
      {
        id: 'divider',
        name: 'Potential divider (output voltage)',
        display: `<var>V</var><sub>out</sub> = <var>V</var><sub>in</sub> × ${EM.frac('<var>R</var><sub>2</sub>', '<var>R</var><sub>1</sub> + <var>R</var><sub>2</sub>')}`,
        vars: [
          { sym: 'Vout', label: 'V<sub>out</sub>', name: 'Voltage across R₂ (output)', unit: 'V', value: 4 },
          { sym: 'Vin', label: 'V<sub>in</sub>', name: 'Supply voltage', unit: 'V', value: 6 },
          { sym: 'R1', label: 'R<sub>1</sub>', name: 'Other resistor', unit: 'Ω', value: 2 },
          { sym: 'R2', label: 'R<sub>2</sub>', name: 'Resistor the output is taken across', unit: 'Ω', value: 4 },
        ],
        solve: {
          Vout: (v) => (v.Vin * v.R2) / (v.R1 + v.R2),
          Vin: (v) => (v.Vout * (v.R1 + v.R2)) / v.R2,
          R1: (v) => {
            const r = (v.R2 * (v.Vin - v.Vout)) / v.Vout;
            return r >= 0 ? r : NaN;
          },
          R2: (v) => {
            const r = (v.Vout * v.R1) / (v.Vin - v.Vout);
            return r >= 0 ? r : NaN;
          },
        },
        notes: 'The notes work this out in two steps — exactly what this formula does in one: find the current I = V ÷ R<sub>total</sub>, then V = I × R for each resistor.',
        derivation: [
          'The two resistors are in series, so R<sub>total</sub> = R<sub>1</sub> + R<sub>2</sub>.',
          `The current is <var>I</var> = ${EM.frac('<var>V</var><sub>in</sub>', '<var>R</var><sub>1</sub> + <var>R</var><sub>2</sub>')} (the same through both).`,
          `The voltage across R<sub>2</sub> is <var>V</var><sub>out</sub> = <var>I</var> × <var>R</var><sub>2</sub> = <var>V</var><sub>in</sub> × ${EM.frac('<var>R</var><sub>2</sub>', '<var>R</var><sub>1</sub> + <var>R</var><sub>2</sub>')}.`,
        ],
        example: { q: 'A 6 V battery is connected across a 2 Ω and a 4 Ω resistor in series (notes’ example). Find the voltage across each.', a: 'Total resistance = 6 Ω. I = V/R = 6/6 = 1 A. V<sub>2Ω</sub> = 1 × 2 = <strong>2 V</strong>; V<sub>4Ω</sub> = 1 × 4 = <strong>4 V</strong>.' },
      },
      {
        id: 'resistivity',
        name: 'Resistivity',
        display: `<var>ρ</var> = ${EM.frac('<var>R</var><var>A</var>', '<var>L</var>')}`,
        vars: [
          { sym: 'rho', label: 'ρ', name: 'Resistivity', unit: 'Ω m', value: 1.1e-6 },
          { sym: 'R', name: 'Resistance', unit: 'Ω', value: 5.6 },
          { sym: 'A', name: 'Cross-sectional area (πr²)', unit: 'm<sup>2</sup>', value: 1.963e-7 },
          { sym: 'L', name: 'Length', unit: 'm', value: 1 },
        ],
        solve: {
          rho: (v) => (v.R * v.A) / v.L,
          R: (v) => (v.rho * v.L) / v.A,
          A: (v) => (v.rho * v.L) / v.R,
          L: (v) => (v.R * v.A) / v.rho,
        },
        notes: 'A = πr² is the cross-sectional area of the (circular) wire, in m². Convert mm to m first: 0.25 mm = 0.25 × 10<sup>−3</sup> m.',
        example: { q: 'A 1.0 m length of nichrome wire of diameter 0.50 mm has a resistance of 5.6 Ω. Find the resistivity of nichrome. (Practice example.)', a: 'r = 0.25 × 10<sup>−3</sup> m, A = πr² = π(0.25 × 10<sup>−3</sup>)² = 1.96 × 10<sup>−7</sup> m². ρ = RA/L = 5.6 × 1.96 × 10<sup>−7</sup> / 1.0 = <strong>1.1 × 10<sup>−6</sup> Ω m</strong>' },
      },
      {
        id: 'resistivity-d',
        name: 'Resistivity using the wire’s diameter',
        display: `<var>ρ</var> = ${EM.frac('<var>R</var> π<var>d</var><sup>2</sup>', '4<var>L</var>')}`,
        vars: [
          { sym: 'rho', label: 'ρ', name: 'Resistivity', unit: 'Ω m', value: 1.1e-6 },
          { sym: 'R', name: 'Resistance', unit: 'Ω', value: 5.6 },
          { sym: 'd', name: 'Diameter of the wire', unit: 'm', value: 5e-4 },
          { sym: 'L', name: 'Length', unit: 'm', value: 1 },
        ],
        solve: {
          rho: (v) => (v.R * Math.PI * v.d * v.d) / (4 * v.L),
          R: (v) => (4 * v.rho * v.L) / (Math.PI * v.d * v.d),
          d: (v) => Math.sqrt((4 * v.rho * v.L) / (Math.PI * v.R)),
          L: (v) => (v.R * Math.PI * v.d * v.d) / (4 * v.rho),
        },
        notes: 'The same formula with A = πr² and r = d/2 substituted, so A = πd²/4 — handy because a micrometer measures the diameter.',
        derivation: ['ρ = RA/L, with A = πr².', 'The radius is half the diameter: r = d/2, so A = π(d/2)² = πd²/4.', 'Substitute: ρ = R·πd² / 4L.'],
        example: { q: 'Find the resistance of 2.0 m of copper wire (ρ = 1.7 × 10<sup>−8</sup> Ω m) of diameter 0.20 mm.', a: 'R = 4ρL/(πd²) = 4 × 1.7 × 10<sup>−8</sup> × 2.0 / (π × (0.20 × 10<sup>−3</sup>)²) = <strong>1.08 Ω</strong>' },
      },
      {
        id: 'area',
        name: 'Cross-sectional area of a wire',
        display: '<var>A</var> = π<var>r</var><sup>2</sup>',
        vars: [
          { sym: 'A', name: 'Cross-sectional area', unit: 'm<sup>2</sup>', value: 1.963e-7 },
          { sym: 'r', name: 'Radius (half the diameter)', unit: 'm', value: 2.5e-4 },
        ],
        solve: {
          A: (v) => Math.PI * v.r * v.r,
          r: (v) => Math.sqrt(v.A / Math.PI),
        },
        notes: 'Don’t forget to halve the diameter and convert to metres before squaring.',
        example: { q: 'A wire has a diameter of 0.50 mm. Find its cross-sectional area.', a: 'r = 0.25 mm = 2.5 × 10<sup>−4</sup> m; A = π(2.5 × 10<sup>−4</sup>)² = <strong>1.96 × 10<sup>−7</sup> m²</strong>' },
      },
    ],

    experiments: [
      {
        id: 'ohms-law-inv',
        title: 'Virtual investigation: Ohm’s law — how current varies with potential difference',
        aim: 'To investigate how the current through a conductor varies with the potential difference across it, and to compare an ohmic resistor with a filament bulb and a diode.',
        apparatus: ['Low-voltage d.c. supply / battery', 'Rheostat (variable resistor)', 'Ammeter (in series)', 'Voltmeter (in parallel)', 'Resistor or metal wire', 'Filament bulb', 'Diode + protective resistor', 'Connecting leads'],
        steps: [
          'Set up the circuit with the <strong>ammeter in series</strong> with the component and the <strong>voltmeter in parallel</strong> across it.',
          'Adjust the supply/rheostat to set a small potential difference. Record V and I.',
          'Increase the p.d. in steps, recording V and I each time (6 or more readings). Reverse the connections and repeat for negative values.',
          'Plot a graph of voltage (V) against current (I).',
          'Repeat with a filament bulb and with a diode in place of the resistor.',
        ],
        result: 'Resistor (constant temperature): a straight line through the origin — V ÷ I is the same every time. Filament bulb: a curve — V ÷ I increases as the filament heats up. Diode: almost no current one way; the other way, current rises sharply once about 0.7 V is reached.',
        conclusion: 'For a conductor at constant temperature, I ∝ V (Ohm’s law), so the resistor is ohmic and the gradient of its V–I graph is its resistance. The filament bulb and the diode are non-ohmic.',
        sim: ohmInvestigationSim,
      },
      {
        id: 'ldr-demo',
        title: 'To show how the resistance of an LDR varies with the intensity of the light falling on it',
        aim: 'To show how the resistance of an LDR changes as the light falling on it gets brighter.',
        apparatus: ['LDR', 'Ohmmeter (multimeter set to Ω)', 'Torch / light source', 'Metre stick'],
        steps: ['Connect the LDR to the ohmmeter.', 'Shine a light on the LDR and note the reading on the ohmmeter.', 'Move the light source closer and note the reading on the ohmmeter again.'],
        result: 'As the light source is moved closer, the reading on the ohmmeter decreases.',
        conclusion: 'This proves that when the amount of light falling on the LDR increases, the resistance of the LDR decreases.',
        sim: ldrDemoSim,
      },
      {
        id: 'resistivity-inv',
        title: 'Virtual investigation: measuring the resistivity of a wire',
        aim: 'To find the resistivity of the material of a wire using ρ = RA/L.',
        apparatus: ['Wire sample', 'Metre stick', 'Micrometer (screw gauge)', 'Ohmmeter', 'Crocodile clips'],
        steps: [
          'Use the micrometer to measure the diameter of the wire at several places along it; take the average d.',
          'Calculate r = d/2 (in metres) and the cross-sectional area A = πr².',
          'Clip the ohmmeter leads onto the wire and measure the length L between the clips with the metre stick.',
          'Read the resistance R of that length from the ohmmeter.',
          'Calculate ρ = RA/L. Repeat for several different lengths and find the average ρ.',
        ],
        result: 'R increases in proportion to L (a graph of R against L is a straight line through the origin), and ρ = RA/L comes out the same for every length.',
        conclusion: 'Resistivity depends only on the material (at a given temperature), not on the size or shape of the sample. The value found identifies the material.',
        sim: resistivityInvSim,
      },
    ],

    topics: [
      {
        id: 'pd-voltage',
        title: 'Potential difference, voltage & EMF',
        summary: 'A volt measures energy per coulomb: the work done moving 1 C of charge between two points.',
        keywords: 'potential difference voltage volt joule per coulomb voltmeter parallel work done W=Vq energy volta battery cell emf electromotive force terminal voltage internal resistance open circuit',
        render(el, ui) {
          const s1 = EM.section(el, 'Potential difference');
          EM.p(s1, 'In this chapter we learn what <strong>potential difference, voltage, electromotive force, current, resistance</strong> and <strong>resistivity</strong> mean.');
          ui.term('potential-difference', s1);
          EM.p(s1, 'Its unit is the <strong>volt (V)</strong> or <strong>joule per coulomb (J/C)</strong>. It is measured with a <strong>voltmeter</strong>, which is connected <strong>in parallel</strong> with (across) the component whose potential difference you want to measure.');
          ui.term('voltage', s1);
          ui.formula('v-wq', s1);

          const s2 = EM.section(el, '9 J given, 9 J used');
          EM.p(s2, 'The notes picture a 9 V battery like a pump on a hill: the battery gives <strong>9 J to each coulomb</strong> of charge, and the bulb uses <strong>9 J from each coulomb</strong>. Water pumped up a hill (given 100 J per unit of water) loses that energy turning a waterwheel on the way down in exactly the same way.');
          const sp = EM.simPanel(s2, 'The energy hill', 'Each ball is one coulomb. Watch it gain energy in the battery and lose it in the bulb — the voltmeters across the battery and across the bulb read the same. Change the battery voltage or switch to the water picture.');
          energySim(sp);
          ui.term('volt', s2);
          EM.callout(s2, 'history', '<strong>Alessandro Volta</strong> (Italy, 1745–1827) developed the first chemical cell. He joined a series of cells together to make the first ever <strong>battery</strong>. The volt is named after him.');

          const s3 = EM.section(el, 'EMF and terminal voltage');
          EM.p(s3, 'Voltage and <strong>EMF</strong> (electromotive force) are related but slightly different.');
          ui.term('emf', s3);
          ui.term('terminal-voltage', s3);
          EM.list(s3, [
            'For a 9 V battery, the EMF (9 V) is the <em>maximum</em> energy the battery can provide to each unit of charge — it is constant.',
            'When the circuit is closed and current flows, the voltage across the terminals (A′–B′) is what is actually available to the circuit (A–B).',
            'The EMF is only higher than the terminal voltage when the battery is supplying current. If no current flows, the voltage = the EMF.',
          ]);
          const sp2 = EM.simPanel(s3, 'EMF vs terminal voltage', 'The voltmeter is connected across the battery’s terminals A′ and B′. Open and close the switch and compare its reading with the EMF.');
          emfSim(sp2);
          EM.callout(s3, 'tip', 'Why is the terminal voltage lower? Every real battery has a small <strong>internal resistance r</strong> (shown in the notes’ diagram). When a current I flows, some voltage, I × r, is used up inside the battery itself, so the terminal voltage is V = ℰ − Ir. With no current, Ir = 0 and V = ℰ.', 'Going further');
        },
      },
      {
        id: 'current',
        title: 'Current: DC and AC',
        summary: 'Current is the charge passing a point each second; DC flows one way, AC reverses 100 times a second.',
        keywords: 'current ampere amp ammeter series charge per second I=q/t coulomb electrons 6.24 x 10^18 direct current dc battery alternating current ac mains 50 Hz frequency conventional current',
        render(el, ui) {
          const s1 = EM.section(el, 'What is current?');
          ui.term('current', s1);
          ui.formula('i-qt', s1);
          EM.p(s1, 'The unit of current is the <strong>ampere (A)</strong>. Current is measured with an <strong>ammeter</strong>, which is connected <strong>in series</strong> in the circuit (so that the current flows through it).');
          ui.term('ampere', s1);
          ui.term('coulomb', s1);
          const sp = EM.simPanel(s1, 'Counting charge', 'Count the charge passing the red line. Whatever current you choose, charge passed ÷ time taken always gives the current.');
          chargeFlowSim(sp);
          EM.callout(s1, 'note', 'Electrons are negative, so they actually flow from the − terminal to the + terminal. <strong>Conventional current</strong> is taken to flow the other way, from + to − (the notes use conventional current in the worked example).');

          const s2 = EM.section(el, 'Direct current and alternating current');
          ui.term('dc', s2);
          ui.term('ac', s2);
          EM.p(s2, `Alternating current comes from the <strong>mains supply</strong>. In the first ${EM.frac('1', '100')} th of a second the electrons flow in one direction, and during the next ${EM.frac('1', '100')} th of a second they flow in the other direction. One complete back-and-forth takes ${EM.frac('1', '50')} s, so AC has a frequency of <strong>50 Hz</strong>.`);
          const sp2 = EM.simPanel(s2, 'DC vs AC in slow motion', 'Real mains AC is far too fast to see, so time is slowed down. Switch between DC and AC and watch the electrons and the current–time graph.');
          dcacSim(sp2);
          EM.cards(s2, [
            { icon: '🔋', title: 'DC', html: 'One direction only. From a battery. Graph of current against time: a flat line.' },
            { icon: '🔌', title: 'AC', html: 'Reverses 100 times every second (50 Hz). From the mains. Graph: a wave above and below zero.' },
          ]);
        },
      },
      {
        id: 'resistance',
        title: 'Resistance & Ohm’s law',
        summary: 'Resistance opposes current; for an ohmic conductor at constant temperature, V = IR.',
        keywords: 'resistance ohm ohmmeter lattice collisions heat friction georg ohm ohms law V=IR proportional ohmic non-ohmic filament bulb diode graph straight line origin',
        render(el, ui) {
          const s1 = EM.section(el, 'Resistance');
          ui.term('resistance', s1);
          EM.p(s1, 'Electrical resistance happens because the flow of electrons through a conductor, such as a metal wire, is not smooth or unobstructed. As free electrons move through the <strong>atomic lattice</strong> of a material in response to an applied voltage (the lattice is the internal, scaffold-like structure that defines a material’s physical properties, such as strength and density), they constantly interact — via the electromagnetic (Coulomb) force — with the metal atoms and ions.');
          EM.p(s1, 'These microscopic <strong>collisions are the “friction” of electricity</strong>, converting electrical energy into heat via kinetic energy.');
          const sp = EM.simPanel(s1, 'Inside a metal wire', 'A cartoon model: free electrons are pushed along by the voltage but keep bumping into the vibrating metal ions, handing over energy as heat.');
          latticeSim(sp);
          ui.term('ohm-unit', s1);

          const s2 = EM.section(el, 'Ohm’s law');
          EM.callout(s2, 'history', '<strong>Georg Ohm</strong> (German, 1789–1854) was responsible for Ohm’s law. The unit of resistance, the ohm, is named after him.');
          ui.term('ohms-law', s2);
          ui.formula('ohm', s2);
          ui.term('ohmic', s2);
          ui.term('non-ohmic', s2);
          EM.callout(s2, 'note', 'A graph of voltage against current for an <strong>ohmic</strong> conductor is a <strong>straight line through the origin</strong>, i.e. through the point (0,0). A non-ohmic graph of voltage against current is <em>not</em> a straight line through the origin.');
          const sp2 = EM.simPanel(s2, 'Ohmic or non-ohmic?', 'Graphs of voltage against current for a 10 Ω resistor, a filament bulb and a diode. Move the supply voltage and watch V ÷ I.');
          viCompareSim(sp2);
          EM.callout(s2, 'tip', 'Why are they non-ohmic? A <strong>filament bulb</strong> gets much hotter as the current increases — and hotter metal has more resistance, so its temperature isn’t constant. A <strong>diode</strong> is a one-way valve: it barely conducts in one direction.', 'Going further');
          ui.experiment('ohms-law-inv', el);
        },
      },
      {
        id: 'series-parallel',
        title: 'Series & parallel circuits',
        summary: 'In series one blown bulb breaks the circuit; in parallel the others keep working.',
        keywords: 'series parallel bulbs blow switch battery house lights total resistance R total = R1 + R2 1/R total = 1/R1 + 1/R2 voltage shared current shared',
        render(el, ui) {
          const s1 = EM.section(el, 'Two ways to connect components');
          EM.p(s1, 'Electrical components can be connected in two ways in a circuit: <strong>1) in series</strong> and <strong>2) in parallel</strong>.');
          ui.term('series', s1);
          ui.term('parallel', s1);
          const sp = EM.simPanel(s1, 'Blow a bulb', 'Click a bulb to blow it (click again to replace it). Click a switch to open or close it.');
          bulbBoardSim(sp);
          EM.list(s1, ['In the <strong>series</strong> circuit, if one bulb blows then the circuit fails.', 'In the <strong>parallel</strong> circuit, if one bulb blows then the circuit does not fail, because the current still has a complete circuit to follow.']);
          EM.callout(s1, 'real', 'The lights in your home are connected in <strong>parallel</strong>. You can turn off your bedroom light and this has no effect on the lights in the rest of the house.');

          const s2 = EM.section(el, 'Adding resistors');
          EM.p(s2, 'Mathematically, when adding resistors <strong>in series</strong> we use:');
          ui.formula('series-r', s2);
          EM.p(s2, 'When adding resistors <strong>in parallel</strong> we use:');
          ui.formula('parallel-r', s2);
          EM.callout(s2, 'note', 'In a <strong>series</strong> circuit the <strong>voltage is shared</strong>.<br>In a <strong>parallel</strong> circuit the <strong>current is shared</strong>.');
          EM.callout(s2, 'tip', 'Quick check: series total is <em>bigger</em> than any single resistor; parallel total is <em>smaller</em> than the smallest one (adding another path makes it easier for current to flow).');
        },
      },
      {
        id: 'current-voltage-rules',
        title: 'Current & voltage in series and parallel',
        summary: 'Current is the same all round a series circuit and splits at junctions; voltages add in series and are equal in parallel.',
        keywords: 'current series same everywhere junction sum entering leaving charges not used up potential energy heat parallel split 8A 5A 3A identical wires ammeter before after voltage series sum V=V1+V2+V3 emf parallel same V1=V2=V3 derivation',
        render(el, ui) {
          const s1 = EM.section(el, 'Current in a series circuit');
          EM.p(s1, 'The current is the <strong>same at every point</strong> in a series circuit.');
          ui.term('junction-rule', s1);
          EM.p(s1, 'So basically the size of the current flowing out of a battery = the size of the current flowing back into the battery.');
          EM.callout(s1, 'key', 'As the charges move around the circuit, the <strong>charges themselves do not get used up</strong>. All that happens is that the charges lose potential energy to heat (and light).');

          const s2 = EM.section(el, 'Current in a parallel circuit');
          EM.p(s2, 'When the current gets split as it enters the junctions in parallel, some current goes through each path — e.g. <strong>8 A</strong> splitting into <strong>5 A</strong> and <strong>3 A</strong>.');
          const sp = EM.simPanel(s2, 'Splitting at a junction', 'Four ammeters: one before the junction, one on each path and one after the paths rejoin. Change the path resistances.');
          junctionSim(sp);
          EM.list(s2, [
            'The same current doesn’t necessarily pass through each path. For that to happen, the paths would have to be made from <strong>identical wires</strong>.',
            'An ammeter placed in series <strong>before</strong> the parallel junctions reads the same as an ammeter placed in series <strong>after</strong> them.',
            'If an ammeter is placed in each path, the <strong>sum</strong> of their readings equals the reading on the ammeter before the junction (and the one after it).',
          ]);
          ui.formula('junction', s2);

          const s3 = EM.section(el, 'Voltage in series and parallel circuits');
          ui.term('series-voltage', s3);
          ui.formula('series-v', s3);
          ui.term('parallel-voltage', s3);
          ui.formula('parallel-v', s3);
          const sp2 = EM.simPanel(s3, 'Meters everywhere', 'Three resistors with an ammeter and a voltmeter on every part. Switch between series and parallel and change the resistors.');
          metersSim(sp2);

          const s4 = EM.section(el, 'Deriving the resistance formulas');
          EM.tabs(s4, [
            {
              label: 'Resistors in series',
              render(p) {
                EM.stepper(p, [
                  { title: 'Voltages add', html: 'The emf of a circuit = the sum of all the individual voltages in that circuit:<div class="formula-display"><var>V</var> = <var>V</var><sub>1</sub> + <var>V</var><sub>2</sub> + …</div>' },
                  { title: 'Use Ohm’s law', html: 'From Ohm’s law, <var>V</var> = <var>I</var> × <var>R</var>. In series the same current <var>I</var> flows through every resistor.' },
                  { title: 'Substitute', html: 'Sub in <var>IR</var> for each <var>V</var>:<div class="formula-display"><var>IR</var> = <var>IR</var><sub>1</sub> + <var>IR</var><sub>2</sub> + …</div>' },
                  { title: 'Divide by I', html: '<div class="formula-display"><var>R</var> = <var>R</var><sub>1</sub> + <var>R</var><sub>2</sub> + …</div>' },
                ]);
              },
            },
            {
              label: 'Resistors in parallel',
              render(p) {
                EM.stepper(p, [
                  { title: 'Currents add', html: 'The sum of the current entering a point = the sum of the current leaving it:<div class="formula-display"><var>I</var> = <var>I</var><sub>1</sub> + <var>I</var><sub>2</sub> + …</div>' },
                  { title: 'Use Ohm’s law', html: `From Ohm’s law <var>V</var> = <var>I</var> × <var>R</var>, so <var>I</var> = ${EM.frac('<var>V</var>', '<var>R</var>')}. In parallel every path has the same voltage <var>V</var>.` },
                  { title: 'Substitute', html: `Sub in ${EM.frac('<var>V</var>', '<var>R</var>')} for each <var>I</var>:<div class="formula-display">${EM.frac('<var>V</var>', '<var>R</var>')} = ${EM.frac('<var>V</var>', '<var>R</var><sub>1</sub>')} + ${EM.frac('<var>V</var>', '<var>R</var><sub>2</sub>')} + …</div>` },
                  { title: 'Divide by V', html: `<div class="formula-display">${EM.frac('1', '<var>R</var>')} = ${EM.frac('1', '<var>R</var><sub>1</sub>')} + ${EM.frac('1', '<var>R</var><sub>2</sub>')} + …</div>` },
                ]);
              },
            },
          ]);
        },
      },
      {
        id: 'worked-example',
        title: 'Worked example: a mixed circuit',
        summary: 'Step by step: 3 Ω in series with 4 Ω, 5 Ω and 6 Ω in parallel on a 12 V supply.',
        keywords: 'worked example question current through each resistor parallel 3 ohm 4 ohm 5 ohm 6 ohm 12 V 1.62 4.62 2.59 A 7.8 V 4.2 V 1.05 A 0.84 A 0.7 A conventional current',
        render(el, ui) {
          const st = { V: 12, Rs: 3, Rp: [4, 5, 6], hl: 0 };
          const s1 = EM.section(el, 'The question');
          EM.p(s1, 'A 12 V supply is connected to a 3 Ω resistor in series with three resistors (4 Ω, 5 Ω and 6 Ω) in parallel. <strong>Find the current flowing through each resistor in parallel.</strong> (We take conventional current.)');
          const sp = EM.simPanel(s1, 'The circuit — with a meter on every part', 'Step through the notes’ solution below; the part of the circuit used in each step is highlighted.');
          workedCircuit(sp, st);
          EM.stepper(
            s1,
            [
              { title: 'Total resistance of the parallel part', html: `${EM.frac('1', 'R<sub>T</sub>')} = ${EM.frac('1', 'R<sub>1</sub>')} + ${EM.frac('1', 'R<sub>2</sub>')} + ${EM.frac('1', 'R<sub>3</sub>')} = ${EM.frac('1', '4')} + ${EM.frac('1', '5')} + ${EM.frac('1', '6')} = 0.617, so R<sub>T</sub> = <strong>1.62 Ω</strong>.` },
              { title: 'Add the series resistor', html: 'Add it to the resistor in series: 3 Ω + 1.62 Ω = <strong>4.62 Ω</strong> total resistance.' },
              { title: 'Total current', html: `I = ${EM.frac('V', 'R')} = ${EM.frac('12', '4.62')} = <strong>2.59 A</strong> (the ammeter in the main circuit).` },
              { title: 'Voltage across the 3 Ω resistor', html: 'V = I × R = 2.59 × 3 = <strong>7.8 V</strong>.' },
              { title: 'Voltage across the parallel resistors', html: 'The total voltage is 12 V, so the voltage across the resistors in parallel is 12 V − 7.8 V = <strong>4.2 V</strong> (the same across each path).' },
              { title: 'Current through each parallel resistor', html: `I = ${EM.frac('V', 'R')}: ${EM.frac('4.2', '4')} = <strong>1.05 A</strong>, ${EM.frac('4.2', '5')} = <strong>0.84 A</strong>, ${EM.frac('4.2', '6')} = <strong>0.7 A</strong>.` },
              { title: 'Check', html: '1.05 A + 0.84 A + 0.7 A = <strong>2.59 A</strong> = the total current in the circuit. ✓' },
            ],
            (i) => (st.hl = i)
          );
          EM.callout(s1, 'tip', 'Small rounding differences are normal: 12 ÷ 4.62 = 2.597…, which the notes write as 2.59 A (2.60 A to 3 significant figures). The live working below uses unrounded values, so it shows 2.60 A, 7.79 V and 4.21 V.', 'Rounding');

          const s2 = EM.section(el, 'Try it with your own values');
          EM.p(s2, 'Change the values; the meters on the diagram above and the full working below update instantly.');
          const c = EM.controls(s2);
          const sl = [];
          sl.push(EM.slider(c, { label: 'Supply V', min: 1, max: 24, step: 0.5, value: 12, unit: 'V', fmt: (v) => fx(v, 1), onInput: (v) => ((st.V = v), upd()) }));
          sl.push(EM.slider(c, { label: 'Series resistor', min: 1, max: 20, step: 0.5, value: 3, unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => ((st.Rs = v), upd()) }));
          ['R₁', 'R₂', 'R₃'].forEach((n, i) => sl.push(EM.slider(c, { label: 'Parallel ' + n, min: 1, max: 20, step: 0.5, value: st.Rp[i], unit: 'Ω', fmt: (v) => fx(v, 1), onInput: (v) => ((st.Rp[i] = v), upd()) })));
          EM.button(c, 'Reset to the notes’ values', () => {
            [12, 3, 4, 5, 6].forEach((v, i) => sl[i].set(v));
            st.V = 12;
            st.Rs = 3;
            st.Rp = [4, 5, 6];
            upd();
          });
          const work = add(s2, 'div', { class: 'callout callout-example' });
          function upd() {
            const r = solveWorked(st);
            const [a, b, cc] = st.Rp;
            work.innerHTML = `<div class="callout-title">Live working</div><div class="callout-body"><ol class="deriv">
              <li>1/R<sub>p</sub> = 1/${fx(a, 1)} + 1/${fx(b, 1)} + 1/${fx(cc, 1)} = ${fx(1 / r.Rp, 3)} ⇒ R<sub>p</sub> = <strong>${fx(r.Rp)} Ω</strong></li>
              <li>R<sub>total</sub> = ${fx(st.Rs, 1)} + ${fx(r.Rp)} = <strong>${fx(r.Rt)} Ω</strong></li>
              <li>I = V/R = ${fx(st.V, 1)} / ${fx(r.Rt)} = <strong>${fx(r.I)} A</strong></li>
              <li>V across ${fx(st.Rs, 1)} Ω = ${fx(r.I)} × ${fx(st.Rs, 1)} = <strong>${fx(r.Vs)} V</strong></li>
              <li>V across parallel part = ${fx(st.V, 1)} − ${fx(r.Vs)} = <strong>${fx(r.Vp)} V</strong></li>
              <li>Currents: ${fx(r.Vp)}/${fx(a, 1)} = <strong>${fx(r.Ib[0])} A</strong>, ${fx(r.Vp)}/${fx(b, 1)} = <strong>${fx(r.Ib[1])} A</strong>, ${fx(r.Vp)}/${fx(cc, 1)} = <strong>${fx(r.Ib[2])} A</strong></li>
              <li>Check: ${fx(r.Ib[0])} + ${fx(r.Ib[1])} + ${fx(r.Ib[2])} = ${fx(r.Ib[0] + r.Ib[1] + r.Ib[2])} A = total current ✓</li></ol></div>`;
          }
          upd();
          ui.formula('parallel-r', s2);
        },
      },
      {
        id: 'potential-divider',
        title: 'Potential divider',
        summary: 'Two resistors in series share a supply voltage, giving a smaller output voltage.',
        keywords: 'potential divider two resistors series battery output voltage volume control knob radio toys variable resistor potentiometer rheostat LDR thermistor 6 V 2 ohm 4 ohm 1 A',
        render(el, ui) {
          const s1 = EM.section(el, 'What is a potential divider?');
          ui.term('potential-divider', s1);
          EM.p(s1, 'Potential dividers are widely found in electronic circuits to reduce a voltage to a lower level. They are used in <strong>volume control knobs</strong> in audio systems, <strong>radios</strong>, and various <strong>toys and electronic devices</strong>.');
          EM.p(s1, 'The resistors in a potential divider can have fixed values, or one may be a variable component like an <strong>LDR</strong> or a <strong>thermistor</strong>. These allow the output voltage to change in response to conditions such as <strong>light</strong> or <strong>temperature</strong>, which makes potential dividers versatile for many applications.');
          const sym = EM.simPanel(s1, 'Circuit symbols', null);
          symbolsSim(sym);
          EM.p(s1, 'A <strong>variable resistor</strong> can be used as a potential divider.');
          EM.callout(s1, 'tip', 'The notes describe a potential divider as “a variable resistor”. More precisely: a potential divider is <em>any</em> pair of resistances in series. A <strong>potentiometer</strong> — a variable resistor with a sliding contact (the symbol with the arrow pointing at the resistor) — is a ready-made, adjustable potential divider, which is why it is used as a volume knob.', 'Going further');

          const s2 = EM.section(el, 'Example from the notes');
          EM.callout(
            s2,
            'example',
            'A 6 V battery is connected across a 2 Ω resistor (A to B) and a 4 Ω resistor (B to C) in series.<ol class="deriv"><li>The total resistance = 2 + 4 = <strong>6 Ω</strong>.</li><li>The total current I = V/R = 6/6 = <strong>1 A</strong>.</li><li>V<sub>2Ω</sub> = I × R = 1 × 2 = <strong>2 V</strong> (between A and B).</li><li>V<sub>4Ω</sub> = I × R = 1 × 4 = <strong>4 V</strong> (between B and C).</li></ol>The 6 V is divided in the ratio of the resistances, 2 : 4.'
          );
          const sp = EM.simPanel(s2, 'Build a potential divider', 'Start with the notes’ 6 V, 2 Ω, 4 Ω circuit, then swap the lower resistor for an LDR, a thermistor, or use a potentiometer.');
          dividerSim(sp);
          ui.formula('divider', s2);
        },
      },
      {
        id: 'ldr',
        title: 'Light dependent resistor (LDR)',
        summary: 'More light on an LDR frees more electrons, so its resistance falls.',
        keywords: 'LDR light dependent resistor semiconductor photons electrons light intensity resistance decreases street lights burglar alarms light meters circuit symbol ohmmeter torch demo',
        render(el, ui) {
          const s1 = EM.section(el, 'How an LDR works');
          ui.term('ldr', s1);
          EM.p(s1, 'If the light falling on the LDR is of <strong>high enough energy</strong>, photons absorbed by the semiconductor give electrons enough energy to leave their orbits. The resulting <strong>free electrons conduct electricity</strong>, thereby lowering the resistance.');
          const sp = EM.simPanel(s1, 'Inside an LDR', 'Each wavy line is a photon. Turn up the light and watch freed electrons drift through the semiconductor — then try low-energy infrared.');
          ldrPhotonSim(sp);

          const s2 = EM.section(el, 'Uses and symbol');
          EM.cards(
            s2,
            [
              { icon: '💡', title: 'Street lights', html: 'Switch on automatically when it gets dark (LDR resistance rises).' },
              { icon: '🚨', title: 'Burglar alarms', html: 'A beam of light on an LDR is broken by an intruder, changing its resistance.' },
              { icon: '📷', title: 'Light meters', html: 'Measure the brightness of light, e.g. for photography.' },
            ],
            { cols: 3 }
          );
          const sym = EM.simPanel(s2, 'Circuit symbol of an LDR', 'A resistor in a circle, with two arrows showing light falling on it (an ordinary fixed resistor is shown for comparison).');
          symbolsSim(sym, ['fixed', 'ldr']);
          ui.experiment('ldr-demo', el);
        },
      },
      {
        id: 'resistivity',
        title: 'Resistance of a wire & resistivity',
        summary: 'A wire’s resistance depends on its length, temperature, cross-sectional area and material; ρ = RA/L.',
        keywords: 'factors resistance metallic conductor length temperature cross-sectional area material resistivity rho ohm metre RA/L pi r squared copper good conductor insulator micrometer',
        render(el, ui) {
          const s1 = EM.section(el, 'Resistance of a metallic conductor');
          EM.p(s1, 'The factors that determine the resistance of a metallic conductor are:');
          EM.list(s1, [
            '<strong>a) Its length</strong> — a longer wire has more resistance (R ∝ L).',
            '<strong>b) Its temperature</strong> — for a metal, the hotter it is the greater its resistance.',
            '<strong>c) Its cross-sectional area</strong> — a thicker wire has less resistance (R ∝ 1/A).',
            '<strong>d) The material from which it’s made</strong> — its resistivity.',
          ]);
          const sp = EM.simPanel(s1, 'Wire explorer', 'Change one factor at a time and watch the ohmmeter.');
          wireSim(sp);

          const s2 = EM.section(el, 'Resistivity of the material');
          EM.p(s2, 'Different materials have different abilities to conduct electricity. <strong>Copper</strong>, for example, is a good conductor because it has a low resistance, while <strong>insulators</strong> are bad conductors because they have a high resistance. We call this property of the material its <strong>resistivity</strong>. Materials with higher resistivity resist current more.');
          ui.term('resistivity', s2);
          EM.p(s2, 'The symbol of resistivity is <strong>ρ</strong> (the Greek letter “rho”) and its unit is the <strong>ohm-metre (Ω m)</strong>.');
          ui.formula('resistivity', s2);
          ui.formula('area', s2);
          ui.formula('resistivity-d', s2);
          const tbl = add(s2, 'table', { class: 'data-table' });
          tbl.append(headRow('Material', 'Typical resistivity at 20 °C (Ω m)'));
          Object.values(MATERIALS).forEach((m) => tbl.append(h('tr', {}, h('td', { text: m.name }), h('td', { html: EM.fmt(m.rho, 2) }))));
          tbl.append(h('tr', {}, h('td', { text: 'Glass (insulator)' }), h('td', { html: '≈ 10<sup>12</sup>' })));
          ui.experiment('resistivity-inv', el);
        },
      },
    ],

    quiz: [
      { q: 'The potential difference between two points is…', options: ['the work done in bringing a charge of 1 C from one point to the other', 'the charge passing a point per second', 'the opposition to current flow', 'the number of electrons moving between the points'], answer: 0, explain: 'P.d. = work done per coulomb, V = W/q, measured in volts (J/C).' },
      { q: 'How much energy does a 9 V battery give to each coulomb of charge?', options: ['9 J', '1 J', '0.11 J', '81 J'], answer: 0, explain: '1 V = 1 J/C, so 9 V means 9 J given to each coulomb (and 9 J used from each coulomb in the circuit).' },
      { q: 'How are a voltmeter and an ammeter connected in a circuit?', options: ['Voltmeter in parallel, ammeter in series', 'Voltmeter in series, ammeter in parallel', 'Both in series', 'Both in parallel'], answer: 0, explain: 'A voltmeter measures across a component (parallel); an ammeter must have the current flow through it (series).' },
      { q: 'A battery with an EMF of 9 V is supplying current to a circuit. Its terminal voltage is…', options: ['less than 9 V', 'more than 9 V', 'exactly 9 V', 'zero'], answer: 0, explain: 'The EMF is only higher than the terminal voltage when current flows; with no current, the voltage equals the EMF.' },
      { q: 'A charge of 30 C passes a point in a wire in 1 minute. What is the current?', options: ['0.5 A', '30 A', '2 A', '1800 A'], answer: 0, explain: 'I = q/t = 30/60 = 0.5 A — remember to convert minutes to seconds.' },
      { q: 'How many times per second does the mains (AC) current reverse direction?', options: ['100', '50', '1', '25'], answer: 0, explain: 'It flows one way for 1/100 s and the other way for the next 1/100 s: 100 reversals per second, a frequency of 50 Hz.' },
      { q: 'Why does a metal wire have resistance?', options: ['Free electrons collide with the atoms/ions of the lattice, converting electrical energy to heat', 'The electrons get used up as they flow', 'The wire stores charge', 'The protons in the wire move the opposite way'], answer: 0, explain: 'The collisions are the “friction” of electricity — electrical energy becomes heat via kinetic energy.' },
      { q: 'Ohm’s law states that, for a conductor at constant temperature…', options: ['the current is directly proportional to the potential difference', 'the current is inversely proportional to the potential difference', 'the resistance is proportional to the current', 'the voltage is the same everywhere'], answer: 0, explain: 'I ∝ V (fixed resistance, constant temperature), written V = IR.' },
      { q: 'A current of 0.5 A flows through a 24 Ω resistor. What is the voltage across it?', options: ['12 V', '48 V', '0.02 V', '24.5 V'], answer: 0, explain: 'V = IR = 0.5 × 24 = 12 V.' },
      { q: 'Which of these is a non-ohmic conductor?', options: ['A filament bulb', 'A fixed resistor', 'A copper wire at constant temperature', 'A nichrome wire at constant temperature'], answer: 0, explain: 'Filament bulbs (and diodes) are non-ohmic — the filament heats up so its resistance changes.' },
      { q: 'What does the graph of voltage against current look like for an ohmic conductor?', options: ['A straight line through the origin', 'A curve that gets steeper', 'A horizontal line', 'A straight line that does not pass through the origin'], answer: 0, explain: 'Ohmic: straight line through (0,0); the gradient is the resistance.' },
      { q: 'Three bulbs are connected in series and one blows. What happens?', options: ['All the bulbs go out', 'The other two get brighter', 'Only the blown bulb goes out', 'The battery current increases'], answer: 0, explain: 'In series there is only one path, so a blown bulb breaks the circuit and it fails.' },
      { q: 'Why are the lights in a house connected in parallel?', options: ['Each can be switched on or off without affecting the others', 'It uses less wire', 'So the current is the same in every light', 'So the voltage is shared between the lights'], answer: 0, explain: 'In parallel each light has its own complete circuit — turning off your bedroom light doesn’t affect the rest.' },
      { q: 'Resistors of 4 Ω, 5 Ω and 6 Ω are connected in parallel. What is the total resistance?', options: ['1.62 Ω', '15 Ω', '0.62 Ω', '5 Ω'], answer: 0, explain: '1/R = 1/4 + 1/5 + 1/6 = 0.617, so R = 1.62 Ω (smaller than the smallest resistor).' },
      { q: 'A current of 8 A enters a junction and 5 A goes along one path. How much goes along the other path?', options: ['3 A', '8 A', '13 A', '5 A'], answer: 0, explain: 'Current entering a point = current leaving it: 8 = 5 + 3.' },
      { q: 'A 12 V supply is connected to two resistors in series. The voltage across one is 7.8 V. What is the voltage across the other?', options: ['4.2 V', '12 V', '7.8 V', '19.8 V'], answer: 0, explain: 'In series the voltage is shared: V = V₁ + V₂, so V₂ = 12 − 7.8 = 4.2 V.' },
      { q: 'A potential divider has a 2 Ω and a 4 Ω resistor in series across a 6 V battery. What is the voltage across the 4 Ω resistor?', options: ['4 V', '2 V', '6 V', '1 V'], answer: 0, explain: 'I = 6/6 = 1 A, so V = IR = 1 × 4 = 4 V.' },
      { q: 'A torch shining on an LDR is moved closer. What happens to the ohmmeter reading?', options: ['It decreases', 'It increases', 'It stays the same', 'It drops to zero then rises'], answer: 0, explain: 'More light falling on the LDR → lower resistance.' },
      { q: 'Which is NOT a factor that determines the resistance of a metallic conductor?', options: ['The current flowing through it', 'Its length', 'Its cross-sectional area', 'Its temperature'], answer: 0, explain: 'The four factors are length, temperature, cross-sectional area and material.' },
      { q: 'What is the unit of resistivity?', options: ['Ω m (ohm-metre)', 'Ω/m (ohm per metre)', 'Ω m² (ohm square metre)', 'Ω (ohm)'], answer: 0, explain: 'ρ = RA/L has units Ω × m² ÷ m = Ω m.' },
    ],
  });
})();
