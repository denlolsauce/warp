/* Chapter C.4 — Semiconductors */
(function () {
  'use strict';
  const D = EM.draw;
  const colors = EM.colors;
  const T = (ctx, s, x, y, o) => D.text(ctx, s, x, y, o);
  const rnd = Math.random;
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ shared helpers */

  function fmtOhm(r) {
    if (r >= 1e6) return Number((r / 1e6).toPrecision(3)) + ' MΩ';
    if (r >= 1e3) return Number((r / 1e3).toPrecision(3)) + ' kΩ';
    return Number(r.toPrecision(3)) + ' Ω';
  }
  function fmtA(i) {
    const a = Math.abs(i);
    if (a < 1e-9) return '0 A';
    if (a >= 1) return EM.fmt(i, 3) + ' A';
    if (a >= 1e-3) return EM.fmt(i * 1e3, 3) + ' mA';
    return EM.fmt(i * 1e6, 3) + ' μA';
  }
  const fmtAText = (i) => fmtA(i).replace(/<[^>]+>/g, '');
  /** Log-slider value → resistance rounded to 2 significant figures (so 10^2.48 shows and uses 300 Ω). */
  const niceR = (lg) => Number(Math.pow(10, lg).toPrecision(2));
  const softplus = (x) => (x > 30 ? x : Math.log(1 + Math.exp(x)));
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;

  /** Paint the background over a wire under a component. */
  function clearRect(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** Cell drawn horizontally. plusLeft: long (+) plate on the left. */
  function cellH(ctx, x, y, plusLeft, o = {}) {
    const g = 5;
    clearRect(ctx, x - g + 1.5, y - 17, 2 * g - 3, 34);
    const lx = plusLeft ? x - g : x + g;
    const sx = plusLeft ? x + g : x - g;
    ctx.save();
    ctx.strokeStyle = o.color || colors.wire;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, y - 15);
    ctx.lineTo(lx, y + 15);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx, y - 8);
    ctx.lineTo(sx, y + 8);
    ctx.stroke();
    ctx.restore();
    if (o.signs !== false) {
      T(ctx, '+', lx + (plusLeft ? -9 : 9), y - 20, { size: 15, weight: 700, color: colors.pos });
      T(ctx, '−', sx + (plusLeft ? 9 : -9), y - 20, { size: 15, weight: 700, color: '#93c5fd' });
    }
    if (o.label) T(ctx, o.label, x, y + (o.labelDy || 28), { size: 12, color: colors.muted });
  }
  /** Cell drawn vertically. plusTop: long (+) plate on top. */
  function cellV(ctx, x, y, plusTop, o = {}) {
    const g = 5;
    clearRect(ctx, x - 17, y - g + 1.5, 34, 2 * g - 3);
    const ly = plusTop ? y - g : y + g;
    const sy = plusTop ? y + g : y - g;
    ctx.save();
    ctx.strokeStyle = o.color || colors.wire;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 15, ly);
    ctx.lineTo(x + 15, ly);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 8, sy);
    ctx.lineTo(x + 8, sy);
    ctx.stroke();
    ctx.restore();
    if (o.signs !== false) {
      const sx = o.signsLeft ? x - 24 : x + 24;
      T(ctx, '+', sx, ly + (plusTop ? -6 : 6), { size: 15, weight: 700, color: colors.pos });
      T(ctx, '−', sx, sy + (plusTop ? 6 : -6), { size: 15, weight: 700, color: '#93c5fd' });
    }
    if (o.label) T(ctx, o.label, x + (o.labelDx || 36), y, { size: 12, color: colors.muted, align: 'left' });
  }

  /** Diode symbol (hollow triangle + bar), horizontal. dir = +1 → conducts left-to-right. */
  function diodeSym(ctx, x, y, dir, s = 13, color = colors.wire) {
    clearRect(ctx, x - s, y - s - 1, 2 * s, 2 * s + 2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - dir * s, y - s);
    ctx.lineTo(x - dir * s, y + s);
    ctx.lineTo(x + dir * s, y);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + dir * s, y - s);
    ctx.lineTo(x + dir * s, y + s);
    ctx.stroke();
    ctx.restore();
  }

  /** NPN transistor symbol. Returns terminal points. */
  function transistorSym(ctx, cx, cy, o = {}) {
    const r = o.r || 22;
    const color = o.color || colors.wire;
    ctx.save();
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    const bx = cx - 7;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(bx, cy - 12);
    ctx.lineTo(bx, cy + 12);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(bx, cy);
    ctx.moveTo(bx, cy - 6);
    ctx.lineTo(cx + 9, cy - r + 6);
    ctx.lineTo(cx + 9, cy - r - 4);
    ctx.moveTo(bx, cy + 6);
    ctx.lineTo(cx + 9, cy + r - 6);
    ctx.lineTo(cx + 9, cy + r + 4);
    ctx.stroke();
    // emitter arrow (points away from the base for NPN)
    const ex = cx + 9,
      ey = cy + r - 6;
    const ang = Math.atan2(ey - (cy + 6), ex - bx);
    const hx = bx + (ex - bx) * 0.85,
      hy = cy + 6 + (ey - cy - 6) * 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - 8 * Math.cos(ang - 0.45), hy - 8 * Math.sin(ang - 0.45));
    ctx.lineTo(hx - 8 * Math.cos(ang + 0.45), hy - 8 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return { b: [cx - r, cy], c: [cx + 9, cy - r - 4], e: [cx + 9, cy + r + 4] };
  }

  /** Vertical resistor box (clears the wire behind it). */
  function resV(ctx, x, y, len = 46, color) {
    D.resistor(ctx, x, y, { vertical: true, w: len, h: 15, color });
  }
  function resH(ctx, x, y, len = 46) {
    D.resistor(ctx, x, y, { w: len, h: 15 });
  }

  /** LDR symbol: resistor in a circle with light arrows coming in. */
  function ldrSym(ctx, x, y, light = 0.5) {
    ctx.save();
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = colors.wire;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    resV(ctx, x, y, 30);
    const c = `rgba(253,224,71,${0.35 + 0.65 * light})`;
    D.arrow(ctx, x - 46, y + 30, x - 24, y + 10, { color: c, width: 2, head: 7 });
    D.arrow(ctx, x - 46, y + 16, x - 26, y - 2, { color: c, width: 2, head: 7 });
  }
  /** Thermistor symbol: resistor with a diagonal line and a short foot. */
  function thermSym(ctx, x, y) {
    resV(ctx, x, y, 46);
    ctx.save();
    ctx.strokeStyle = colors.wire;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 20, y + 24);
    ctx.lineTo(x - 13, y + 24);
    ctx.lineTo(x + 13, y - 24);
    ctx.stroke();
    ctx.restore();
  }

  /** AC supply symbol. */
  function acSym(ctx, x, y, r = 20) {
    ctx.save();
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = colors.wire;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      const px = x - r * 0.6 + u * r * 1.2;
      const py = y - Math.sin(u * TAU) * r * 0.35;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Speed (px/s) for current dots on a log scale so tiny and large currents are both visible. */
  function dotSpeed(I) {
    const a = Math.abs(I);
    if (a < 1e-7) return 0;
    return Math.max(10, 16 + 17 * (Math.log10(a) + 6));
  }

  /* ------------------------------------------------------------------ sim: conductor / semiconductor / insulator */

  function materialsSim(el) {
    const st = { T: 20, pd: false };
    const boxes = [
      { x: 20, name: 'Good conductor', eg: '(e.g. copper)', elecs: [] },
      { x: 250, name: 'Semiconductor', eg: '(e.g. silicon)', elecs: [] },
      { x: 480, name: 'Insulator', eg: '(e.g. glass)', elecs: [] },
    ];
    const BW = 220,
      BY = 50,
      BH = 150;
    const target = (i) => {
      if (i === 0) return 10;
      if (i === 1) return st.T < -200 ? 0 : Math.round(9 / (1 + Math.exp(-(st.T - 45) / 30)));
      return Math.round(1.2 / (1 + Math.exp(-(st.T - 175) / 10)));
    };
    const newE = (b) => ({ x: b.x + 15 + rnd() * (BW - 30), y: BY + 15 + rnd() * (BH - 30), vx: 0, vy: 0, flash: 0.5 });
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Free electrons in a conductor, a semiconductor and an insulator',
      draw(ctx, sim, dt) {
        boxes.forEach((b, i) => {
          const n = target(i);
          while (b.elecs.length < n) b.elecs.push(newE(b));
          if (b.elecs.length > n && rnd() < dt * 3) b.elecs.pop();
          const hl = i === 1;
          ctx.save();
          ctx.strokeStyle = hl ? '#a78bfa' : 'rgba(203,213,225,0.5)';
          ctx.lineWidth = hl ? 2.5 : 1.5;
          D.roundRect(ctx, b.x, BY, BW, BH, 10);
          ctx.stroke();
          ctx.restore();
          T(ctx, b.name, b.x + BW / 2, 18, { weight: 700, size: 14, color: hl ? '#c4b5fd' : colors.text });
          T(ctx, b.eg, b.x + BW / 2, 36, { size: 12, color: colors.muted });
          // fixed positive ions (atoms that have lost/share electrons)
          for (let r = 0; r < 2; r++)
            for (let c = 0; c < 4; c++) {
              const x = b.x + 30 + c * 48 + (r ? 24 : 0),
                y = BY + 45 + r * 60;
              ctx.save();
              ctx.fillStyle = '#7c3aed';
              ctx.beginPath();
              ctx.arc(x, y, 10, 0, TAU);
              ctx.fill();
              ctx.restore();
              D.sign(ctx, x, y, 1, 5);
            }
          for (const e of b.elecs) {
            e.vx += (-e.vx * 2) * dt + gauss() * 160 * Math.sqrt(dt);
            e.vy += (-e.vy * 2) * dt + gauss() * 160 * Math.sqrt(dt);
            e.x += (e.vx - (st.pd ? 45 : 0)) * dt;
            e.y += e.vy * dt;
            if (e.x < b.x + 8) e.x += BW - 16;
            if (e.x > b.x + BW - 8) e.x -= BW - 16;
            if (e.y < BY + 8) (e.y = BY + 8), (e.vy = Math.abs(e.vy));
            if (e.y > BY + BH - 8) (e.y = BY + BH - 8), (e.vy = -Math.abs(e.vy));
            if (e.flash > 0) {
              e.flash -= dt;
              ctx.save();
              ctx.strokeStyle = `rgba(253,224,71,${e.flash * 1.6})`;
              ctx.beginPath();
              ctx.arc(e.x, e.y, 12 - e.flash * 10, 0, TAU);
              ctx.stroke();
              ctx.restore();
            }
            D.electron(ctx, e.x, e.y, 4.5);
          }
          // current bar
          const cur = st.pd ? b.elecs.length / 10 : 0;
          T(ctx, 'Free electrons: ' + b.elecs.length, b.x + BW / 2, 220, { size: 12, color: colors.text });
          ctx.save();
          ctx.fillStyle = 'rgba(148,163,184,0.18)';
          ctx.fillRect(b.x + 20, 238, BW - 40, 12);
          ctx.fillStyle = colors.current;
          ctx.fillRect(b.x + 20, 238, (BW - 40) * EM.clamp(cur, 0, 1), 12);
          ctx.restore();
          const word = !st.pd ? 'no p.d. applied' : cur > 0.75 ? 'large current' : cur > 0.05 ? 'small current' : 'almost no current';
          T(ctx, 'Current: ' + word, b.x + BW / 2, 266, { size: 12, color: colors.muted });
        });
        if (st.pd) T(ctx, '+ terminal on the left → free electrons drift left', 360, 290, { size: 11, color: colors.efield });
        else T(ctx, 'Not to scale: a real metal has about 10²⁸ free electrons per m³', 360, 290, { size: 11, color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.slider(c, { label: 'Temperature', min: -270, max: 200, step: 1, value: 20, unit: '°C', fmt: (v) => String(Math.round(v)).replace('-', '−'), onInput: (v) => (st.T = v) });
    EM.toggle(c, { label: 'Apply a p.d. (connect a battery)', value: false, onChange: (v) => (st.pd = v) });
    const s = EM.status(el);
    EM.every(250, () => {
      if (st.T < -200) s.set('Near absolute zero the semiconductor has <strong>no free electrons</strong> — it behaves like an insulator.', 'warn');
      else if (st.T > 120) s.set('Hot: many more bonds break, so the semiconductor conducts <strong>much better</strong> — its resistance falls.', 'good');
      else s.set('The semiconductor’s conductivity is <strong>between</strong> the conductor’s and the insulator’s. Change the temperature to see it change.', '');
    });
  }

  /* ------------------------------------------------------------------ sim: Bohr atoms */

  const ATOMS = {
    Si: { name: 'Silicon', shells: [2, 8, 4], col: '#fca5a5', note: ['4 valence electrons, each shared in a', 'covalent bond with a neighbour.', 'They are not free → silicon is a', 'semiconductor.'] },
    Na: { name: 'Sodium (a metal)', shells: [2, 8, 1], col: '#cbd5e1', note: ['Only 1 valence electron, easily freed', 'from the atom → current flows readily.', 'Metals have 1–3 valence electrons', '→ good conductors.'] },
    Al: { name: 'Aluminium (a metal)', shells: [2, 8, 3], col: '#cbd5e1', note: ['3 valence electrons, easily freed', 'from the atom → current flows readily.', 'Metals have 1–3 valence electrons', '→ good conductors.'] },
    P: { name: 'Phosphorus', shells: [2, 8, 5], col: '#fde68a', note: ['5 valence electrons: 4 bond with', 'silicon neighbours, the 5th is left', 'over as a free electron', '→ used to make n-type silicon.'] },
    B: { name: 'Boron', shells: [2, 3], col: '#86efac', note: ['3 valence electrons: one bond with', 'silicon is missing an electron', '→ a positive hole', '→ used to make p-type silicon.'] },
  };
  function atomSim(el) {
    const st = { el: 'Si' };
    EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Electron shells of an atom',
      draw(ctx, sim) {
        const a = ATOMS[st.el];
        const cx = 200,
          cy = 150;
        const radii = a.shells.length === 3 ? [42, 80, 118] : [50, 100];
        a.shells.forEach((n, k) => {
          const r = radii[k];
          const val = k === a.shells.length - 1;
          ctx.save();
          ctx.strokeStyle = val ? 'rgba(251,191,36,0.85)' : 'rgba(203,213,225,0.45)';
          ctx.lineWidth = val ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.stroke();
          ctx.restore();
          const w = (0.6 / (k + 1)) * (k % 2 ? -1 : 1);
          for (let i = 0; i < n; i++) {
            const ang = sim.t * w + (i / n) * TAU;
            D.electron(ctx, cx + r * Math.cos(ang), cy + r * Math.sin(ang), val ? 6 : 4.5, val ? '#fbbf24' : colors.electron);
          }
        });
        ctx.save();
        ctx.fillStyle = a.col;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, TAU);
        ctx.fill();
        ctx.restore();
        T(ctx, st.el, cx, cy, { size: 18, weight: 700, color: '#0f172a' });
        const vx = 400;
        T(ctx, a.name, vx, 52, { size: 20, weight: 700, align: 'left' });
        T(ctx, 'Electron arrangement: ' + a.shells.join(', '), vx, 86, { size: 14, align: 'left', color: colors.muted });
        T(ctx, 'Valence (outer-shell) electrons: ' + a.shells[a.shells.length - 1], vx, 112, { size: 14, align: 'left', weight: 700, color: '#fbbf24' });
        a.note.forEach((line, i) => T(ctx, line, vx, 150 + i * 22, { size: 14, align: 'left' }));
        T(ctx, 'Gold ring = valence shell', vx, 260, { size: 12, align: 'left', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Atom',
      options: [
        { value: 'Si', label: 'Silicon' },
        { value: 'Na', label: 'Sodium' },
        { value: 'Al', label: 'Aluminium' },
        { value: 'P', label: 'Phosphorus' },
        { value: 'B', label: 'Boron' },
      ],
      value: 'Si',
      onChange: (v) => (st.el = v),
    });
  }

  /* ------------------------------------------------------------------ sim: how a hole moves (stepper-driven) */

  function holeStepSim(el) {
    const N = 6,
      X0 = 110,
      DX = 100,
      Y = 112;
    const slotPos = (b, k) => [X0 + b * DX + DX / 2 + (k ? 6 : -6), Y];
    // hole positions per step (bond index, slot 0); step 0 = no hole
    const holeBond = [null, 4, 3, 2, 1];
    const st = { step: 0, anim: null, free: null };
    const sim = EM.canvas(el, {
      width: 720,
      height: 230,
      label: 'A row of silicon atoms showing how a hole moves',
      draw(ctx, s, dt) {
        // bonds
        ctx.save();
        ctx.strokeStyle = 'rgba(148,163,184,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X0 - DX / 2, Y);
        ctx.lineTo(X0 + (N - 0.5) * DX, Y);
        for (let i = 0; i < N; i++) {
          ctx.moveTo(X0 + i * DX, Y - 50);
          ctx.lineTo(X0 + i * DX, Y + 50);
        }
        ctx.stroke();
        ctx.restore();
        // vertical bond electrons (decoration)
        for (let i = 0; i < N; i++)
          for (const dy of [-36, -24, 24, 36]) D.electron(ctx, X0 + i * DX, Y + dy, 3.5, '#fdba74');
        // left/right stub electrons
        for (const x of [X0 - DX / 2 + 4, X0 + (N - 0.5) * DX - 4]) D.electron(ctx, x, Y, 3.5, '#fdba74');
        const hole = holeBond[st.step];
        if (st.anim) {
          st.anim.t += dt / 0.7;
          if (st.anim.t >= 1) st.anim = null;
        }
        for (let b = 0; b < N - 1; b++)
          for (let k = 0; k < 2; k++) {
            const [x, y] = slotPos(b, k);
            const isHole = hole != null && b === hole && k === 0;
            const arriving = st.anim && st.anim.to && st.anim.to[0] === b && st.anim.to[1] === k;
            if (isHole) {
              const pulse = 1 + 0.25 * Math.sin(s.t * 6);
              ctx.save();
              ctx.fillStyle = 'rgba(248,113,113,0.18)';
              ctx.beginPath();
              ctx.arc(x, y, 11 * pulse, 0, TAU);
              ctx.fill();
              ctx.restore();
              D.hole(ctx, x, y, 5.5);
            } else if (!arriving) D.electron(ctx, x, y, 3.8, '#fdba74');
          }
        if (st.anim) {
          const u = Math.min(1, st.anim.t),
            e = u * u * (3 - 2 * u);
          const x = EM.lerp(st.anim.from[0], st.anim.toXY[0], e),
            y = EM.lerp(st.anim.from[1], st.anim.toXY[1], e) - Math.sin(Math.PI * e) * 22;
          D.electron(ctx, x, y, 4.5, st.anim.free ? colors.electron : '#fdba74');
        }
        // atoms
        for (let i = 0; i < N; i++) {
          D.charge(ctx, X0 + i * DX, Y, 0, { r: 17 });
          T(ctx, 'Si', X0 + i * DX, Y, { size: 12, weight: 700 });
        }
        // free electron wanders off to the right
        if (st.step >= 1 && !(st.anim && st.anim.free)) {
          st.free = st.free || { x: slotPos(4, 0)[0] + 10, y: 34 };
          st.free.x = Math.min(690, st.free.x + 14 * dt);
          D.electron(ctx, st.free.x, st.free.y + Math.sin(s.t * 3) * 3, 5);
          T(ctx, 'free (conduction) electron', Math.min(st.free.x, 600), 16, { size: 11, color: colors.electron });
        }
        if (st.step >= 4) {
          D.arrow(ctx, slotPos(4, 0)[0], 196, slotPos(1, 0)[0], 196, { color: colors.hole, width: 3 });
          T(ctx, 'hole moves this way (like a + charge)', (slotPos(1, 0)[0] + slotPos(4, 0)[0]) / 2, 214, { size: 12, color: colors.hole });
          D.arrow(ctx, slotPos(1, 0)[0] - 30, 172, slotPos(4, 0)[0] - 30, 172, { color: '#fdba74', width: 2 });
          T(ctx, 'valence electrons hop this way', (slotPos(1, 0)[0] + slotPos(4, 0)[0]) / 2 - 30, 160, { size: 11, color: '#fdba74' });
        }
      },
    });
    return {
      sim,
      go(i, prev) {
        st.anim = null;
        if (i === 0) st.free = null;
        if (i === prev + 1 && i === 1) {
          const from = slotPos(4, 0);
          st.anim = { from, toXY: [from[0] + 10, 34], free: true, t: 0 };
          st.free = null;
        } else if (i === prev + 1 && i >= 2) {
          // electron from the next slot to the left hops into the old hole
          const from = slotPos(holeBond[i], 0);
          const to = [holeBond[i - 1], 0];
          st.anim = { from, toXY: slotPos(to[0], to[1]), to, t: 0 };
        }
        st.step = i;
      },
    };
  }

  /* ------------------------------------------------------------------ sim: silicon lattice (temperature + doping) */

  function latticeSim(el, opts = {}) {
    const W = 720,
      H = 400,
      NC = 7,
      NR = 4,
      X0 = 60,
      DX = 100,
      Y0 = 46,
      DY = 86;
    const XMIN = X0 - DX / 2,
      XMAX = X0 + (NC - 0.5) * DX,
      YMIN = Y0 - DY / 2,
      YMAX = Y0 + (NR - 0.5) * DY;
    const st = { T: 20, doping: opts.initial || 'pure', field: false };
    let atoms, bonds, slots, free;
    const sites = [
      [1, 1],
      [4, 2],
      [5, 0],
      [2, 3],
    ];
    const id = (i, j) => (((j % NR) + NR) % NR) * NC + (((i % NC) + NC) % NC);

    function build() {
      atoms = [];
      bonds = [];
      slots = [];
      free = [];
      for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) atoms.push({ i, j, x: X0 + i * DX, y: Y0 + j * DY, kind: 'Si', bonds: [] });
      atoms.forEach((a) => {
        [
          [1, 0],
          [0, 1],
        ].forEach(([di, dj]) => {
          const b = { a: id(a.i, a.j), b: id(a.i + di, a.j + dj), h: di === 1, slots: [] };
          b.x = a.x + (di * DX) / 2;
          b.y = a.y + (dj * DY) / 2;
          b.wrap = di ? a.i === NC - 1 : a.j === NR - 1;
          b.mx = b.h ? b.x - NC * DX : b.x;
          b.my = b.h ? b.y : b.y - NR * DY;
          const bi = bonds.length;
          bonds.push(b);
          atoms[b.a].bonds.push(bi);
          atoms[b.b].bonds.push(bi);
          for (const k of [-1, 1]) {
            b.slots.push(slots.length);
            slots.push({ bond: bi, filled: true, dx: b.h ? k * 6 : 0, dy: b.h ? 0 : k * 6, anim: null, hopT: rnd() * 2, flash: 0 });
          }
        });
      });
      if (st.doping !== 'pure') {
        sites.forEach(([i, j]) => {
          const a = atoms[id(i, j)];
          a.kind = st.doping === 'n' ? 'P' : 'B';
          if (a.kind === 'P') free.push({ x: a.x + 16, y: a.y - 16, vx: 20, vy: -20, immune: 1 });
          else slots[bonds[a.bonds[0]].slots[0]].filled = false;
        });
      }
    }
    build();

    const copies = (s) => {
      const b = bonds[s.bond];
      const out = [[b.x + s.dx, b.y + s.dy]];
      if (b.wrap) out.push([b.mx + s.dx, b.my + s.dy]);
      return out;
    };
    const nearest = (s, x, y) => {
      let best = null,
        bd = Infinity;
      for (const p of copies(s)) {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) (bd = d), (best = p);
      }
      return { p: best, d: bd };
    };
    const ni = () => {
      const K = st.T + 273.15;
      return K < 60 ? 0 : 3.2 * Math.exp(-1240 * (1 / K - 1 / 293.15));
    };
    const holes = () => slots.filter((s) => !s.filled);

    function step(dt) {
      const K = st.T + 273.15;
      const sig = 90 * Math.sqrt(Math.max(0.05, K / 293));
      const hs = holes();
      const n = free.length,
        p = hs.length;
      const n2 = ni() * ni();
      // thermal generation of electron–hole pairs
      if (n * p < n2 && rnd() < 1.4 * dt) {
        const cands = slots.filter((s) => s.filled && !s.anim);
        const s = cands[(rnd() * cands.length) | 0];
        if (s) {
          s.filled = false;
          s.flash = 0.6;
          const [x, y] = copies(s)[0];
          const ang = rnd() * TAU;
          free.push({ x, y, vx: Math.cos(ang) * 80, vy: Math.sin(ang) * 80, immune: 0.9 });
        }
      }
      const excess = p > 0 && n * p > n2 * 1.3 + 0.5;
      // free electrons: random thermal motion + drift opposite to E
      for (let k = free.length - 1; k >= 0; k--) {
        const e = free[k];
        e.vx += -e.vx * 1.5 * dt + gauss() * sig * Math.sqrt(dt) * 1.4;
        e.vy += -e.vy * 1.5 * dt + gauss() * sig * Math.sqrt(dt) * 1.4;
        let tx = 0,
          ty = 0,
          best = null,
          bd = Infinity;
        if (e.immune <= 0) {
          for (const s of hs) {
            if (s.filled) continue;
            const q = nearest(s, e.x, e.y);
            if (q.d < bd) (bd = q.d), (best = s), (tx = q.p[0]), (ty = q.p[1]);
          }
        }
        if (excess && best) {
          e.vx += ((tx - e.x) / (bd + 1)) * 140 * dt;
          e.vy += ((ty - e.y) / (bd + 1)) * 140 * dt;
        }
        e.x += (e.vx - (st.field ? 40 : 0)) * dt;
        e.y += e.vy * dt;
        if (e.x < XMIN) e.x += XMAX - XMIN;
        if (e.x >= XMAX) e.x -= XMAX - XMIN;
        if (e.y < YMIN) e.y += YMAX - YMIN;
        if (e.y >= YMAX) e.y -= YMAX - YMIN;
        e.immune -= dt;
        if (best && bd < 11) {
          // recombination: the free electron drops into the hole
          best.filled = true;
          best.flash = -0.5;
          free.splice(k, 1);
        }
      }
      // holes move when a neighbouring valence electron hops in
      const rate = st.field ? 2.4 : 1.1;
      for (const s of slots) {
        if (s.filled) continue;
        s.hopT -= dt;
        if (s.hopT > 0) continue;
        s.hopT = -Math.log(rnd() + 1e-9) / rate;
        const b = bonds[s.bond];
        const [hx, hy] = copies(s)[0];
        const cand = [];
        for (const ai of [b.a, b.b])
          for (const bi of atoms[ai].bonds) {
            if (bi === s.bond) continue;
            for (const si of bonds[bi].slots) {
              const c = slots[si];
              if (!c.filled || c.anim) continue;
              const q = nearest(c, hx, hy);
              if (q.d > DX) continue;
              const w = st.field ? Math.exp((3 * (q.p[0] - hx)) / DX) : 1; // holes drift along E (to the right)
              cand.push({ c, p: q.p, w });
            }
          }
        if (!cand.length) continue;
        let tot = cand.reduce((a, x) => a + x.w, 0),
          r = rnd() * tot,
          pick = cand[0];
        for (const x of cand) if ((r -= x.w) <= 0) {
          pick = x;
          break;
        }
        // hole moves to pick (the electron moves from pick into s)
        pick.c.filled = false;
        pick.c.hopT = 0.3 + rnd() / rate;
        s.filled = true;
        s.anim = { fx: pick.p[0], fy: pick.p[1], tx: hx, ty: hy, t: 0 };
      }
    }

    const sim = EM.canvas(el, {
      width: W,
      height: H,
      label: 'Silicon crystal lattice with electrons and holes',
      draw(ctx, s, dt) {
        step(dt);
        // bonds
        ctx.save();
        ctx.strokeStyle = 'rgba(148,163,184,0.32)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const b of bonds) {
          const A = atoms[b.a];
          if (!b.wrap) {
            const B = atoms[b.b];
            ctx.moveTo(A.x, A.y);
            ctx.lineTo(B.x, B.y);
          } else {
            const B = atoms[b.b];
            ctx.moveTo(A.x, A.y);
            ctx.lineTo(A.x + (b.h ? DX : 0), A.y + (b.h ? 0 : DY));
            ctx.moveTo(B.x, B.y);
            ctx.lineTo(B.x - (b.h ? DX : 0), B.y - (b.h ? 0 : DY));
          }
        }
        ctx.stroke();
        ctx.restore();
        // bond electrons / holes
        for (const sl of slots) {
          for (const [x, y] of copies(sl)) {
            if (x < -5 || x > W + 5 || y < -5 || y > 352) continue;
            if (sl.flash > 0) {
              ctx.save();
              ctx.strokeStyle = `rgba(253,224,71,${sl.flash})`;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(x, y, 16 - sl.flash * 12, 0, TAU);
              ctx.stroke();
              ctx.restore();
            }
            if (sl.filled && !sl.anim) D.electron(ctx, x, y, 3.4, '#fdba74');
            else if (!sl.filled) D.hole(ctx, x, y, 5);
          }
          if (sl.flash > 0) sl.flash = Math.max(0, sl.flash - dt);
          if (sl.flash < 0) sl.flash = Math.min(0, sl.flash + dt);
          if (sl.anim) {
            sl.anim.t += dt / 0.35;
            const u = Math.min(1, sl.anim.t);
            D.electron(ctx, EM.lerp(sl.anim.fx, sl.anim.tx, u), EM.lerp(sl.anim.fy, sl.anim.ty, u), 3.6, '#fdba74');
            if (sl.anim.t >= 1) sl.anim = null;
          }
        }
        // atoms
        for (const a of atoms) {
          const col = a.kind === 'P' ? '#eab308' : a.kind === 'B' ? '#16a34a' : '#2563eb';
          ctx.save();
          const g = ctx.createRadialGradient(a.x - 6, a.y - 6, 2, a.x, a.y, 17);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.3, col);
          g.addColorStop(1, D.shade(col, -0.35));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(a.x, a.y, 16, 0, TAU);
          ctx.fill();
          ctx.restore();
          T(ctx, a.kind, a.x, a.y + 1, { size: 12, weight: 700, color: a.kind === 'P' ? '#1c1917' : '#fff' });
          if (a.kind === 'P') {
            ctx.save();
            ctx.fillStyle = colors.pos;
            ctx.beginPath();
            ctx.arc(a.x + 14, a.y - 14, 7, 0, TAU);
            ctx.fill();
            ctx.restore();
            D.sign(ctx, a.x + 14, a.y - 14, 1, 0.1);
            T(ctx, '+', a.x + 14, a.y - 14, { size: 11, weight: 700, color: '#fff' });
          }
          if (a.kind === 'B' && a.bonds.every((bi) => bonds[bi].slots.every((si) => slots[si].filled))) {
            ctx.save();
            ctx.fillStyle = colors.neg;
            ctx.beginPath();
            ctx.arc(a.x + 14, a.y - 14, 7, 0, TAU);
            ctx.fill();
            ctx.restore();
            T(ctx, '−', a.x + 14, a.y - 14, { size: 11, weight: 700, color: '#fff' });
          }
        }
        for (const e of free) D.electron(ctx, e.x, e.y, 4.8);
        // legend strip
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 352, W, H - 352);
        ctx.restore();
        D.electron(ctx, 20, 368, 3.6, '#fdba74');
        T(ctx, 'valence electron (in a bond)', 30, 368, { size: 11, align: 'left' });
        D.electron(ctx, 200, 368, 4.5);
        T(ctx, 'conduction (free) electron', 210, 368, { size: 11, align: 'left' });
        D.hole(ctx, 372, 368, 5);
        T(ctx, 'positive hole', 382, 368, { size: 11, align: 'left' });
        if (st.doping === 'n') T(ctx, 'P = phosphorus; ⊕ ion left behind after donating its 5th electron', 20, 389, { size: 11, align: 'left', color: '#fde68a' });
        else if (st.doping === 'p') T(ctx, 'B = boron; it has only 3 valence electrons, so one bond is missing an electron (a hole)', 20, 389, { size: 11, align: 'left', color: '#86efac' });
        else T(ctx, 'Si = silicon (pure). Every Si atom shares 4 valence electrons with 4 neighbours.', 20, 389, { size: 11, align: 'left', color: colors.muted });
        if (st.field) {
          D.arrow(ctx, 480, 368, 530, 368, { color: colors.efield, width: 2.5 });
          T(ctx, 'E  (+ on left, − on right)', 540, 368, { size: 11, align: 'left', color: colors.efield });
        } else T(ctx, 'no p.d.: carriers wander randomly', 480, 368, { size: 11, align: 'left', color: colors.muted });
      },
    });

    const c = EM.controls(el);
    if (opts.doping) {
      EM.segmented(c, {
        label: 'Doping',
        options: [
          { value: 'pure', label: 'Pure silicon' },
          { value: 'n', label: '+ Phosphorus (n-type)' },
          { value: 'p', label: '+ Boron (p-type)' },
        ],
        value: st.doping,
        onChange: (v) => {
          st.doping = v;
          build();
        },
      });
    }
    EM.slider(c, { label: 'Temperature', min: -270, max: 200, step: 1, value: st.T, unit: '°C', fmt: (v) => String(Math.round(v)).replace('-', '−'), onInput: (v) => (st.T = v) });
    EM.toggle(c, { label: 'Apply a p.d. across the crystal', value: false, onChange: (v) => (st.field = v) });
    EM.button(c, 'Reset', () => build());
    const ro = EM.readout(el, [
      { key: 'e', label: 'Conduction electrons' },
      { key: 'h', label: 'Positive holes' },
      { key: 'type', label: 'Type of conduction' },
      { key: 'maj', label: 'Majority carriers' },
    ]);
    const stat = EM.status(el);
    EM.every(250, () => {
      const n = free.length,
        p = holes().length;
      ro.set('e', String(n));
      ro.set('h', String(p));
      ro.set('type', st.doping === 'pure' ? 'Intrinsic (pure)' : 'Extrinsic (doped)');
      ro.set('maj', st.doping === 'n' ? 'Electrons' : st.doping === 'p' ? 'Holes' : 'Neither — equal numbers');
      let msg;
      if (st.doping === 'pure') {
        if (st.T < -150) msg = 'Very cold: no bonds break, so there are no free carriers — pure silicon barely conducts.';
        else msg = 'Heat breaks some covalent bonds → each break makes <strong>one conduction electron and one hole</strong>, so the numbers stay equal.';
        if (st.field && st.T >= -150) msg += ' With a p.d., electrons drift towards + and holes drift towards −.';
      } else if (st.doping === 'n') msg = 'n-type: each phosphorus atom gives a free electron. <strong>Electrons are the majority carriers</strong>; holes (only from broken bonds) are the minority.';
      else msg = 'p-type: each boron atom leaves a hole. <strong>Holes are the majority carriers</strong>; free electrons (only from broken bonds) are the minority.';
      stat.set(msg, st.doping === 'pure' ? '' : 'good');
    });
    return sim;
  }

  /* ------------------------------------------------------------------ sim: p–n junction formation */

  function pnFormationSim(el) {
    const JX = 360,
      YT = 64,
      YB = 284,
      NEQ = 14;
    let holes, elecs, minor, flights, launched, pairs, timer, running, bounce;
    function reset() {
      holes = [];
      elecs = [];
      flights = [];
      launched = 0;
      pairs = 0;
      timer = 0;
      running = false;
      bounce = null;
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 11; c++) {
          const jx = (rnd() - 0.5) * 10,
            jy = (rnd() - 0.5) * 10;
          holes.push({ hx: 45 + c * 30 + jx, hy: 84 + r * 30 + jy, ion: false, used: false, ph: rnd() * TAU });
          elecs.push({ hx: 375 + c * 30 - jx, hy: 84 + r * 30 - jy, ion: false, used: false, ph: rnd() * TAU });
        }
      minor = [
        { x: 105, y: 129, e: true },
        { x: 225, y: 219, e: true },
        { x: 165, y: 249, e: true },
        { x: 495, y: 99, e: false },
        { x: 615, y: 189, e: false },
        { x: 555, y: 249, e: false },
      ];
    }
    reset();
    // Only the NEQ carriers nearest the junction take part, so the depletion region ends up free of carriers.
    const pick = (arr, cmp) => {
      const near = arr.slice().sort(cmp).slice(0, NEQ).filter((x) => !x.used);
      return near[(rnd() * near.length) | 0];
    };
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Formation of the depletion region at a p-n junction',
      draw(ctx, s, dt) {
        if (running && launched < NEQ) {
          timer -= dt;
          if (timer <= 0) {
            timer = 0.22;
            const e = pick(elecs, (a, b) => a.hx - b.hx);
            const h = pick(holes, (a, b) => b.hx - a.hx);
            e.used = h.used = true;
            flights.push({ e, h, t: 0 });
            launched++;
          }
        }
        // block
        ctx.save();
        ctx.fillStyle = 'rgba(239,68,68,0.10)';
        ctx.fillRect(30, YT, JX - 30, YB - YT);
        ctx.fillStyle = 'rgba(59,130,246,0.10)';
        ctx.fillRect(JX, YT, 690 - JX, YB - YT);
        ctx.strokeStyle = 'rgba(203,213,225,0.5)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(30, YT, 660, YB - YT);
        ctx.restore();
        // depletion region
        const ionsH = holes.filter((h) => h.ion),
          ionsE = elecs.filter((e) => e.ion);
        if (ionsH.length && ionsE.length) {
          const L = Math.min(...ionsH.map((h) => h.hx)) - 14,
            R = Math.max(...ionsE.map((e) => e.hx)) + 14;
          ctx.save();
          ctx.fillStyle = 'rgba(148,163,184,0.16)';
          ctx.fillRect(L, YT, R - L, YB - YT);
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(203,213,225,0.7)';
          ctx.beginPath();
          ctx.moveTo(L, YT);
          ctx.lineTo(L, YB);
          ctx.moveTo(R, YT);
          ctx.lineTo(R, YB);
          ctx.stroke();
          ctx.restore();
          T(ctx, 'depletion region', (L + R) / 2, 46, { size: 12, weight: 700, color: '#e2e8f0' });
          if (pairs >= NEQ) D.arrow(ctx, R - 4, 57, L + 4, 57, { color: colors.efield, width: 2, head: 7 });
        }
        ctx.save();
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(JX, YT);
        ctx.lineTo(JX, YB);
        ctx.stroke();
        ctx.restore();
        T(ctx, 'p region', 150, 46, { size: 13, weight: 700, color: '#fca5a5' });
        T(ctx, 'n region', 570, 46, { size: 13, weight: 700, color: '#93c5fd' });
        T(ctx, 'junction', JX, 20, { size: 11, color: colors.copper });
        // carriers
        for (const h of holes) {
          if (h.ion) D.charge(ctx, h.hx, h.hy, -1, { r: 8 });
          else if (!h.used || flights.some((f) => f.h === h)) D.hole(ctx, h.hx + 2 * Math.sin(s.t * 2 + h.ph), h.hy + 2 * Math.cos(s.t * 1.7 + h.ph), 5.5);
        }
        for (const e of elecs) {
          if (e.ion) D.charge(ctx, e.hx, e.hy, 1, { r: 8 });
          else if (!e.used) {
            let ox = 0;
            if (bounce && bounce.e === e) ox = -Math.sin(Math.PI * bounce.t) * 16;
            D.electron(ctx, e.hx + ox + 2 * Math.sin(s.t * 2.2 + e.ph), e.hy + 2 * Math.cos(s.t * 1.9 + e.ph), 4.5);
          }
        }
        for (const m of minor) {
          if (m.e) D.electron(ctx, m.x + 2 * Math.sin(s.t * 2 + m.x), m.y, 4.5);
          else D.hole(ctx, m.x + 2 * Math.sin(s.t * 2 + m.y), m.y, 5.5);
        }
        // electrons in flight
        for (let i = flights.length - 1; i >= 0; i--) {
          const f = flights[i];
          f.t += dt / 0.9;
          const u = Math.min(1, f.t);
          const x = EM.lerp(f.e.hx, f.h.hx, u),
            y = EM.lerp(f.e.hy, f.h.hy, u) - Math.sin(Math.PI * u) * 18;
          D.electron(ctx, x, y, 5);
          if (f.t >= 1) {
            f.e.ion = true;
            f.h.ion = true;
            pairs++;
            flights.splice(i, 1);
          }
        }
        // repelled electrons once equilibrium is reached
        if (pairs >= NEQ) {
          if (!bounce || bounce.t >= 1) {
            const cands = elecs.filter((e) => !e.used && !e.ion && e.hx < 470);
            bounce = cands.length ? { e: cands[(rnd() * cands.length) | 0], t: 0 } : null;
          } else bounce.t += dt / 0.9;
        }
        // junction voltage meter
        const fr = pairs / NEQ;
        T(ctx, 'Space charge / junction voltage', 34, 312, { size: 12, align: 'left', color: colors.muted });
        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.18)';
        ctx.fillRect(230, 305, 200, 14);
        ctx.fillStyle = colors.efield;
        ctx.fillRect(230, 305, 200 * fr, 14);
        ctx.restore();
        T(ctx, fr >= 1 ? 'built up — further diffusion blocked' : fr > 0 ? 'building up…' : 'none yet', 442, 312, { size: 12, align: 'left', color: fr >= 1 ? colors.efield : colors.muted });
        D.hole(ctx, 40, 344, 5);
        T(ctx, 'hole', 50, 344, { size: 11, align: 'left' });
        D.electron(ctx, 100, 344, 4.5);
        T(ctx, 'free electron', 110, 344, { size: 11, align: 'left' });
        D.charge(ctx, 210, 344, -1, { r: 7 });
        T(ctx, 'negative ion (p side)', 222, 344, { size: 11, align: 'left' });
        D.charge(ctx, 370, 344, 1, { r: 7 });
        T(ctx, 'positive ion (n side)', 382, 344, { size: 11, align: 'left' });
        if (pairs >= NEQ) {
          D.arrow(ctx, 545, 344, 515, 344, { color: colors.efield, width: 2, head: 7 });
          T(ctx, 'E-field across the region', 552, 344, { size: 11, align: 'left', color: colors.efield });
        }
      },
    });
    const c = EM.controls(el);
    EM.button(c, '▶ Join p and n (form the junction)', () => (running = true), 'primary');
    EM.button(c, 'Reset', () => reset());
    const s = EM.status(el);
    EM.every(200, () => {
      if (!running) s.set('Before joining: the p region has extra <strong>holes</strong>, the n region has extra <strong>free electrons</strong>. Press the button.', '');
      else if (pairs < NEQ) s.set('Electrons near the junction <strong>diffuse across</strong> and fill holes: each leaves a <strong>+ ion</strong> on the n side and makes a <strong>− ion</strong> on the p side.', 'warn');
      else s.set('The ions form a <strong>space charge</strong>: the <strong>depletion region</strong> (no free carriers → acts as an insulator). Its p.d. is the <strong>junction voltage</strong>; the − ions now repel further electrons.', 'good');
    });
  }

  /* ------------------------------------------------------------------ sim: water-valve analogy */

  function valveSim(el) {
    const st = { dir: 1, flap: 0 };
    const parts = Array.from({ length: 34 }, (_, i) => ({ x: 40 + i * 19, y: 70 + (rnd() - 0.5) * 22 }));
    EM.canvas(el, {
      width: 720,
      height: 250,
      label: 'Water check-valve analogy for a diode',
      draw(ctx, s, dt) {
        const open = st.dir > 0;
        st.flap += ((open ? 1 : 0) - st.flap) * Math.min(1, dt * 6);
        // pipe
        ctx.save();
        ctx.fillStyle = 'rgba(56,189,248,0.18)';
        ctx.fillRect(30, 48, 660, 44);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.strokeRect(30, 48, 660, 44);
        ctx.fillStyle = '#334155';
        ctx.fillRect(320, 36, 80, 12);
        ctx.fillRect(320, 92, 80, 12);
        // seat (stop) on the left of the flap
        ctx.fillStyle = '#64748b';
        ctx.fillRect(344, 84, 8, 8);
        ctx.restore();
        // flap hinged at (356,50)
        const ang = st.flap * 1.25;
        ctx.save();
        ctx.translate(356, 50);
        ctx.rotate(-ang);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-3, 0, 6, 40);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(356, 50, 4, 0, TAU);
        ctx.fill();
        ctx.restore();
        // water particles
        const v = 90 * st.dir;
        for (const p of parts) {
          let nx = p.x + v * dt * (open ? 1 : 1);
          if (!open) {
            // blocked: particles to the right of the valve pile up against the flap
            if (p.x >= 360 && nx < 362) nx = 362 + rnd() * 3;
            if (p.x < 352) nx = p.x; // left side stays still
          }
          if (nx > 690) nx -= 660;
          if (nx < 30) nx += 660;
          p.x = nx;
          ctx.save();
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        T(ctx, 'check valve', 360, 20, { size: 12, color: colors.muted });
        T(ctx, open ? 'Water allowed to pass →' : '← Water NOT allowed to pass (no back-flow)', 360, 116, { size: 13, weight: 700, color: open ? colors.good : colors.bad });
        // diode equivalent
        D.wire(ctx, [
          [180, 190],
          [540, 190],
        ]);
        if (open) D.flowDots(ctx, [[180, 190], [540, 190]], s.t, { speed: 70 });
        diodeSym(ctx, 360, 190, 1, 16);
        T(ctx, '+', 300, 168, { size: 16, weight: 700, color: colors.pos });
        T(ctx, '−', 420, 168, { size: 16, weight: 700, color: '#93c5fd' });
        T(ctx, 'p', 345, 222, { size: 12, color: colors.muted });
        T(ctx, 'n', 378, 222, { size: 12, color: colors.muted });
        if (!open)
          for (let x = 400; x < 540; x += 22) {
            ctx.save();
            ctx.fillStyle = colors.current;
            ctx.beginPath();
            ctx.arc(x + ((s.t * 10) % 3), 190, 3, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
        T(ctx, 'Diode', 120, 190, { size: 13, weight: 700, align: 'right' });
        T(ctx, open ? 'current flows ✓' : 'current blocked ✗', 560, 190, { size: 12, align: 'left', color: open ? colors.good : colors.bad });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Push the water / current',
      options: [
        { value: 1, label: 'Left → right' },
        { value: -1, label: 'Right → left' },
      ],
      value: 1,
      onChange: (v) => (st.dir = v),
    });
  }

  /* ------------------------------------------------------------------ sim: rectifier (AC → DC) */

  function rectifierSim(el) {
    const st = { on: true, dir: 1, f: 0.4, ph: 0 };
    const A = 5;
    const vout = (v) => (!st.on ? v : st.dir > 0 ? Math.max(0, v - 0.6) : Math.min(0, v + 0.6));
    EM.canvas(el, {
      width: 720,
      height: 320,
      label: 'Half-wave rectifier: AC input and DC output graphs',
      draw(ctx, s, dt) {
        st.ph = (st.ph + st.f * dt) % 2;
        const vin = A * Math.sin(TAU * st.ph);
        const vo = vout(vin);
        // circuit
        const pts = [
          [60, 140],
          [60, 70],
          [270, 70],
          [270, 250],
          [60, 250],
          [60, 180],
        ];
        D.wire(ctx, pts);
        if (Math.abs(vo) > 0.05) D.flowDots(ctx, pts, s.t, { speed: (vo > 0 ? 1 : -1) * (25 + 18 * Math.abs(vo)) });
        acSym(ctx, 60, 160, 22);
        if (st.on) diodeSym(ctx, 165, 70, st.dir, 13);
        else T(ctx, '(plain wire)', 165, 54, { size: 11, color: colors.muted });
        resV(ctx, 270, 160, 50);
        T(ctx, 'AC supply', 92, 160, { size: 12, align: 'left', color: colors.muted });
        if (st.on) T(ctx, 'diode', 165, 98, { size: 12, color: colors.muted });
        T(ctx, 'load', 256, 160, { size: 12, align: 'right', color: colors.muted });
        T(ctx, vin >= 0 ? 'top terminal +' : 'top terminal −', 60, 286, { size: 12, color: vin >= 0 ? colors.pos : '#93c5fd' });
        T(ctx, Math.abs(vo) > 0.05 ? 'current flowing' : 'no current', 165, 286, { size: 12, color: Math.abs(vo) > 0.05 ? colors.good : colors.muted });
        // graphs
        const mk = [{ x: st.ph, y: vin, color: '#fff' }];
        D.plot(ctx, { x: 380, y: 30, w: 320, h: 100 }, { xMin: 0, xMax: 2, yMin: -6, yMax: 6, title: 'Input: AC from the mains (changes direction)', yLabel: 'V / V', series: [{ fn: (x) => A * Math.sin(TAU * x), color: colors.efield }], markers: mk, xTicks: 4, yTicks: 4 });
        D.plot(ctx, { x: 380, y: 190, w: 320, h: 100 }, { xMin: 0, xMax: 2, yMin: -6, yMax: 6, title: st.on ? 'Output across the load: one direction only (DC)' : 'Output across the load: still AC', yLabel: 'V / V', xLabel: 'time (cycles)', series: [{ fn: (x) => vout(A * Math.sin(TAU * x)), color: colors.good }], markers: [{ x: st.ph, y: vo, color: '#fff' }], xTicks: 4, yTicks: 4 });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Diode in the circuit', value: true, onChange: (v) => (st.on = v) });
    EM.segmented(c, {
      label: 'Diode direction',
      options: [
        { value: 1, label: 'Pointing → (pass + half)' },
        { value: -1, label: 'Pointing ← (pass − half)' },
      ],
      value: 1,
      onChange: (v) => (st.dir = v),
    });
    EM.slider(c, { label: 'AC frequency (slowed down)', min: 0.1, max: 1, step: 0.05, value: 0.4, unit: 'Hz', onInput: (v) => (st.f = v) });
    const s = EM.status(el);
    EM.every(250, () => {
      if (!st.on) s.set('Without the diode the current reverses every half-cycle — that is AC.', 'warn');
      else s.set('The diode only conducts when it is <strong>forward biased</strong>, so the current through the load always flows <strong>the same way</strong>: AC has been converted to (bumpy) DC.', 'good');
    });
  }

  /* ------------------------------------------------------------------ sim: transistor symbol + structure */

  function structureSim(el) {
    EM.canvas(el, {
      width: 720,
      height: 280,
      label: 'Transistor circuit symbol and NPN structure',
      draw(ctx, s) {
        T(ctx, 'Circuit symbol (NPN)', 170, 18, { size: 13, weight: 700 });
        const t = transistorSym(ctx, 170, 145, { r: 34 });
        D.wire(ctx, [t.b, [70, 145]]);
        D.wire(ctx, [t.c, [t.c[0], 50]]);
        D.wire(ctx, [t.e, [t.e[0], 240]]);
        T(ctx, 'B', 58, 145, { size: 15, weight: 700 });
        T(ctx, 'C', t.c[0] + 18, 50, { size: 15, weight: 700 });
        T(ctx, 'E', t.e[0] + 18, 240, { size: 15, weight: 700 });
        // current arrows
        D.arrow(ctx, 82, 128, 118, 128, { color: colors.current, width: 2, head: 8 });
        T(ctx, 'I', 92, 112, { size: 13, weight: 700, color: colors.current });
        T(ctx, 'B', 99, 116, { size: 9, weight: 700, color: colors.current });
        D.arrow(ctx, t.c[0] - 16, 56, t.c[0] - 16, 90, { color: colors.current, width: 2, head: 8 });
        T(ctx, 'I', t.c[0] - 34, 70, { size: 13, weight: 700, color: colors.current });
        T(ctx, 'C', t.c[0] - 27, 74, { size: 9, weight: 700, color: colors.current });
        D.arrow(ctx, t.e[0] - 16, 200, t.e[0] - 16, 234, { color: colors.current, width: 2, head: 8 });
        T(ctx, 'I', t.e[0] - 34, 216, { size: 13, weight: 700, color: colors.current });
        T(ctx, 'E', t.e[0] - 27, 220, { size: 9, weight: 700, color: colors.current });
        D.flowDots(ctx, [[70, 145], t.b], s.t, { speed: 20, spacing: 40, r: 2 });
        D.flowDots(ctx, [[t.c[0], 50], t.c], s.t, { speed: 50, spacing: 12, r: 2.5 });
        D.flowDots(ctx, [t.e, [t.e[0], 240]], s.t, { speed: 50, spacing: 11, r: 2.5 });
        T(ctx, 'arrow on the emitter = conventional current direction', 170, 268, { size: 11, color: colors.muted });
        // structure
        T(ctx, 'Inside an NPN transistor', 520, 18, { size: 13, weight: 700 });
        const X = 420,
          Wd = 110;
        const layers = [
          { y: 40, h: 90, name: 'Collector (n)', sub: 'moderately n-doped', col: 'rgba(59,130,246,0.30)', dots: 14, e: true },
          { y: 130, h: 24, name: 'Base (p)', sub: 'very thin, lightly p-doped', col: 'rgba(239,68,68,0.35)', dots: 3, e: false },
          { y: 154, h: 90, name: 'Emitter (n)', sub: 'heavily n-doped', col: 'rgba(59,130,246,0.30)', dots: 34, e: true },
        ];
        layers.forEach((L, k) => {
          ctx.save();
          ctx.fillStyle = L.col;
          ctx.fillRect(X, L.y, Wd, L.h);
          ctx.strokeStyle = 'rgba(203,213,225,0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(X, L.y, Wd, L.h);
          ctx.restore();
          for (let i = 0; i < L.dots; i++) {
            const px = X + 8 + ((i * 37 + k * 11) % (Wd - 16)) + Math.sin(s.t * 2 + i) * 2;
            const py = L.y + 6 + ((i * 23 + k * 7) % Math.max(4, L.h - 12)) + Math.cos(s.t * 2 + i) * 1.5;
            if (L.e) D.electron(ctx, px, py, 2.6);
            else D.hole(ctx, px, py, 3.4);
          }
          const thin = L.h < 30;
          T(ctx, L.name, X + Wd + 16, L.y + L.h / 2 - (thin ? 7 : 8), { size: 13, weight: 700, align: 'left' });
          T(ctx, L.sub, X + Wd + 16, L.y + L.h / 2 + (thin ? 9 : 10), { size: 11, align: 'left', color: colors.muted });
        });
        D.wire(ctx, [[X + Wd / 2, 40], [X + Wd / 2, 28]]);
        D.wire(ctx, [[X + Wd / 2, 244], [X + Wd / 2, 258]]);
        D.wire(ctx, [[X, 142], [X - 26, 142]]);
        T(ctx, 'C', X + Wd / 2 + 14, 30, { size: 12, weight: 700 });
        T(ctx, 'E', X + Wd / 2 + 14, 256, { size: 12, weight: 700 });
        T(ctx, 'B', X - 36, 142, { size: 12, weight: 700 });
      },
    });
  }

  /* ------------------------------------------------------------------ sim: NPN electron flow with one / two supplies */

  function npnSim(el) {
    const st = { setup: 'both', V: 0.85 };
    const EX0 = 230,
      EB = 380,
      BC = 416,
      CX1 = 540,
      BY0 = 160,
      BY1 = 250,
      MY = 205,
      BL = 398;
    const BETA = 100,
      ICMAX = 0.025;
    const model = () => {
      if (st.setup !== 'both') return { IB: 0, IC: 0, IE: 0 };
      let IB = 20e-6 * softplus((st.V - 0.65) / 0.025);
      if (IB < 1e-7) IB = 0;
      const IC = Math.min(BETA * IB, ICMAX);
      return { IB, IC, IE: IB + IC };
    };
    const parts = [];
    let spawn = 0;
    EM.canvas(el, {
      width: 720,
      height: 380,
      label: 'Electron flow through an NPN transistor',
      draw(ctx, s, dt) {
        const m = model();
        const both = st.setup === 'both';
        const flip = st.setup === 'flip';
        // wires
        D.wire(ctx, [[EX0, MY], [150, MY], [150, 330], [640, 330], [640, MY], [CX1, MY]]);
        if (both) D.wire(ctx, [[150, MY], [150, 70], [BL, 70], [BL, BY0]]);
        else D.wire(ctx, [[BL, BY0], [BL, 120]], 'rgba(203,213,225,0.35)');
        // flowing electrons in the wires (electron flow: − to +)
        const on = m.IC > 1e-6;
        const sp = 18 + 60 * EM.clamp(m.IC / ICMAX, 0, 1);
        if (on) {
          D.flowDots(ctx, [[315, 330], [150, 330], [150, MY], [EX0, MY]], s.t, { speed: sp, spacing: 16, color: colors.electron, r: 3 });
          D.flowDots(ctx, [[CX1, MY], [640, MY], [640, 330], [345, 330]], s.t, { speed: sp, spacing: 16, color: colors.electron, r: 3 });
          D.flowDots(ctx, [[250, 70], [150, 70], [150, MY - 2]], s.t, { speed: 16, spacing: 46, color: colors.electron, r: 3 });
          D.flowDots(ctx, [[BL, BY0], [BL, 70], [280, 70]], s.t, { speed: 16, spacing: 46, color: colors.electron, r: 3 });
        }
        // the block
        const regions = [
          [EX0, EB, 'rgba(59,130,246,0.28)'],
          [EB, BC, 'rgba(239,68,68,0.32)'],
          [BC, CX1, 'rgba(59,130,246,0.22)'],
        ];
        ctx.save();
        for (const [a, b, col] of regions) {
          ctx.fillStyle = col;
          ctx.fillRect(a, BY0, b - a, BY1 - BY0);
        }
        ctx.restore();
        // depletion layers
        let wEB, wBC;
        if (both) {
          wEB = 16 * Math.sqrt(Math.max(0.01, (0.75 - Math.min(st.V, 0.74)) / 0.75));
          wBC = 26;
        } else if (flip) {
          wEB = 30;
          wBC = 7;
        } else {
          wEB = 7;
          wBC = 30;
        }
        ctx.save();
        ctx.fillStyle = 'rgba(226,232,240,0.22)';
        ctx.fillRect(EB - wEB / 2, BY0, wEB, BY1 - BY0);
        ctx.fillRect(BC - wBC / 2, BY0, wBC, BY1 - BY0);
        ctx.strokeStyle = 'rgba(203,213,225,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(EX0, BY0, CX1 - EX0, BY1 - BY0);
        ctx.restore();
        // static majority carriers
        for (let i = 0; i < 26; i++) {
          const px = EX0 + 8 + ((i * 41) % (EB - EX0 - 24)),
            py = BY0 + 8 + ((i * 29) % (BY1 - BY0 - 16));
          if (px < EB - wEB / 2 - 4) D.electron(ctx, px + Math.sin(s.t * 2 + i) * 2, py, 2.6);
        }
        for (let i = 0; i < 12; i++) {
          const px = BC + 6 + ((i * 47) % (CX1 - BC - 12)),
            py = BY0 + 8 + ((i * 37) % (BY1 - BY0 - 16));
          if (px > BC + wBC / 2 + 4) D.electron(ctx, px + Math.sin(s.t * 2 + i) * 2, py, 2.6);
        }
        for (let i = 0; i < 4; i++) D.hole(ctx, BL + (i % 2 ? 6 : -6), BY0 + 22 + i * 18, 3.2);
        // moving electrons inside
        if (on) {
          spawn += dt * (6 + 30 * EM.clamp(m.IC / ICMAX, 0, 1));
          while (spawn >= 1) {
            spawn -= 1;
            parts.push({ x: EX0, y: BY0 + 12 + rnd() * (BY1 - BY0 - 24), mode: 'em', life: 1 });
          }
        }
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (p.mode === 'em') {
            p.x += 110 * dt;
            p.y += gauss() * 30 * dt;
            if (p.x >= EB) {
              const r = rnd();
              p.mode = r < 0.08 ? 'up' : r < 0.12 ? 'recomb' : 'col';
            }
          } else if (p.mode === 'up') {
            const dx = BL - p.x,
              dy = BY0 - p.y,
              d = Math.hypot(dx, dy);
            if (d < 4) p.life = 0;
            else (p.x += (dx / d) * 90 * dt), (p.y += (dy / d) * 90 * dt);
          } else if (p.mode === 'recomb') {
            p.x += 30 * dt;
            p.life -= dt * 2;
          } else {
            p.x += 170 * dt;
            if (p.x > CX1) p.life = 0;
          }
          p.y = EM.clamp(p.y, BY0 + 5, BY1 - 5);
          if (p.life <= 0 || !on) {
            parts.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = EM.clamp(p.life, 0, 1);
          D.electron(ctx, p.x, p.y, 3.4, p.mode === 'up' ? '#fde68a' : colors.electron);
          ctx.restore();
        }
        // labels inside / under the block
        T(ctx, 'n', (EX0 + EB) / 2, BY0 - 12, { size: 14, weight: 700, color: '#93c5fd' });
        T(ctx, 'p', BL + 14, BY0 - 12, { size: 14, weight: 700, color: '#fca5a5' });
        T(ctx, 'n', (BC + CX1) / 2, BY0 - 12, { size: 14, weight: 700, color: '#93c5fd' });
        T(ctx, 'Emitter', (EX0 + EB) / 2, 266, { size: 12, weight: 700 });
        T(ctx, 'Base', BL, 266, { size: 12, weight: 700 });
        T(ctx, 'Collector', (BC + CX1) / 2 + 10, 266, { size: 12, weight: 700 });
        T(ctx, 'heavy n', (EX0 + EB) / 2, 282, { size: 11, color: colors.muted });
        T(ctx, 'thin, light p', BL, 282, { size: 11, color: colors.muted });
        T(ctx, 'moderate n', (BC + CX1) / 2 + 10, 282, { size: 11, color: colors.muted });
        // reverse-biased junction marker
        const revX = both ? BC : flip ? EB : BC;
        if (!on) T(ctx, 'reverse biased: wide depletion layer', revX, 300, { size: 11, color: colors.bad, weight: 700 });
        // supplies
        cellH(ctx, 330, 330, flip, { label: 'main supply (collector circuit)', labelDy: 28 });
        if (both) {
          cellH(ctx, 265, 70, false, { label: '2nd (base) supply: ' + st.V.toFixed(2) + ' V', labelDy: -36, signs: true });
        }
        // lamp
        const br = EM.clamp(m.IC / ICMAX, 0, 1);
        D.bulb(ctx, 640, 268, br * br, { r: 15 });
        T(ctx, 'lamp', 662, 268, { size: 12, align: 'left', color: colors.muted });
        if (on) {
          T(ctx, 'a few e⁻ leave', BL + 12, 112, { size: 11, align: 'left', color: '#fde68a' });
          T(ctx, 'via the base', BL + 12, 126, { size: 11, align: 'left', color: '#fde68a' });
          T(ctx, 'most e⁻ are pulled', 604, 166, { size: 11, color: colors.electron });
          T(ctx, 'to the collector', 604, 180, { size: 11, color: colors.electron });
        }
        T(ctx, 'Dots show ELECTRON flow (− → +)', 12, 18, { size: 11, align: 'left', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    const sl = { el: null };
    EM.segmented(c, {
      label: 'Set-up',
      options: [
        { value: 'one', label: 'One supply' },
        { value: 'flip', label: 'One supply, reversed' },
        { value: 'both', label: 'Add 2nd (base) supply' },
      ],
      value: 'both',
      onChange: (v) => {
        st.setup = v;
        sl.el.el.style.opacity = v === 'both' ? 1 : 0.4;
      },
    });
    sl.el = EM.slider(c, { label: 'Base supply voltage V<sub>BE</sub>', min: 0, max: 1, step: 0.01, value: st.V, unit: 'V', fmt: (v) => v.toFixed(2), onInput: (v) => (st.V = v) });
    const ro = EM.readout(el, [
      { key: 'ib', label: 'Base current I<sub>B</sub>' },
      { key: 'ic', label: 'Collector current I<sub>C</sub>' },
      { key: 'ie', label: 'Emitter current I<sub>E</sub>' },
      { key: 'state', label: 'Transistor' },
    ]);
    const s = EM.status(el);
    EM.every(200, () => {
      const m = model();
      ro.set('ib', fmtA(m.IB));
      ro.set('ic', fmtA(m.IC));
      ro.set('ie', fmtA(m.IE));
      ro.set('state', m.IC > 1e-3 ? '<span style="color:#22c55e">ON</span>' : m.IC > 1e-6 ? 'barely on' : 'OFF');
      if (st.setup === 'one') s.set('One supply (collector +): the <strong>base–collector (p–n) junction is reverse biased</strong>, its depletion layer is too wide → no current. Transistor OFF.', 'bad');
      else if (st.setup === 'flip') s.set('Reversed: now the <strong>emitter–base (n–p) junction is reverse biased</strong> instead → still no current. Whichever way you connect one supply, the transistor stays OFF.', 'bad');
      else if (st.V < 0.6) s.set('The base supply is too small to overcome the barrier at the emitter–base junction (needs about <strong>0.7 V</strong>). Raise V<sub>BE</sub>.', 'warn');
      else s.set('Electrons flood from the emitter into the thin base: a <strong>few</strong> combine with holes or leave through the base; <strong>most</strong> are pulled across to the collector. Small I<sub>B</sub> → large I<sub>C</sub>.', 'good');
    });
  }

  /* ------------------------------------------------------------------ sim: light / temperature controlled switch */

  const VS = 12,
    RBASE = 1000,
    GAIN = 200,
    RLAMP = 200;
  function dividerTransistor(Rtop, Rbot) {
    const Vth = (VS * Rbot) / (Rtop + Rbot),
      Rth = (Rtop * Rbot) / (Rtop + Rbot);
    const IB = Math.max(0, (Vth - 0.7) / (Rth + RBASE));
    const ICmax = (VS - 0.2) / RLAMP;
    const IC = Math.min(GAIN * IB, ICmax);
    return { Vbot: Vth, Vtop: VS - Vth, Idiv: VS / (Rtop + Rbot), IB, IC, frac: IC / ICmax };
  }
  const ldrR = (L) => Math.pow(10, 6 - 4 * L);
  const thermR = (Tc) => 1e4 * Math.exp(3950 * (1 / (Tc + 273.15) - 1 / 298.15));

  function sensorSim(el, kind) {
    const isL = kind === 'ldr';
    const defaults = isL ? { A: 4, B: 4 } : { A: Math.log10(300), B: Math.log10(22000) };
    const st = { circ: 'A', L: 0.15, Tc: 20, logR: defaults.A };
    const sensorR = () => (isL ? ldrR(st.L) : thermR(st.Tc));
    const calc = () => {
      const R = niceR(st.logR),
        S = sensorR();
      // LDR circuits: A = R top, LDR bottom; B = LDR top, R bottom.
      // Thermistor circuits: A = thermistor top, R bottom; B = R top, thermistor bottom.
      const sensorBottom = isL ? st.circ === 'A' : st.circ === 'B';
      const m = sensorBottom ? dividerTransistor(R, S) : dividerTransistor(S, R);
      m.R = R;
      m.S = S;
      m.sensorBottom = sensorBottom;
      m.Vsensor = sensorBottom ? m.Vbot : m.Vtop;
      m.VR = sensorBottom ? m.Vtop : m.Vbot;
      return m;
    };
    const sname = isL ? 'LDR' : 'Thermistor';
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: isL ? 'Transistor as a light-controlled switch' : 'Transistor as a temperature-controlled switch',
      draw(ctx, s) {
        const m = calc();
        T(ctx, '(' + st.circ + ')', 16, 18, { size: 14, weight: 700, align: 'left' });
        // wires
        D.wire(ctx, [[80, 50], [420, 50], [420, 290], [80, 290], [80, 50]]);
        D.wire(ctx, [[80, 170], [278, 170]]);
        D.wire(ctx, [[309, 50], [309, 290]]);
        // current dots (conventional)
        const sd = dotSpeed(m.Idiv),
          sb = dotSpeed(m.IB),
          sc = dotSpeed(m.IC);
        if (sd) D.flowDots(ctx, [[420, 162], [420, 50], [80, 50], [80, 290], [420, 290], [420, 178]], s.t, { speed: sd, spacing: 30, r: 2.5 });
        if (sb) D.flowDots(ctx, [[80, 170], [278, 170], [309, 196], [309, 290], [420, 290]], s.t, { speed: sb, spacing: 26, r: 2.5 });
        if (sc) D.flowDots(ctx, [[420, 50], [309, 50], [309, 290], [420, 290]], s.t, { speed: sc, spacing: 16, r: 3 });
        // components
        const topY = 110,
          botY = 230;
        const drawSensor = (y) => (isL ? ldrSym(ctx, 80, y, st.L) : thermSym(ctx, 80, y));
        if (m.sensorBottom) {
          resV(ctx, 80, topY, 46);
          drawSensor(botY);
        } else {
          drawSensor(topY);
          resV(ctx, 80, botY, 46);
        }
        T(ctx, m.sensorBottom ? 'R' : sname, 112, topY - 8, { size: 12, align: 'left', weight: 700 });
        T(ctx, m.sensorBottom ? sname : 'R', 112, botY - 8, { size: 12, align: 'left', weight: 700 });
        T(ctx, fmtOhm(m.sensorBottom ? m.R : m.S), 112, topY + 9, { size: 11, align: 'left', color: colors.muted });
        T(ctx, fmtOhm(m.sensorBottom ? m.S : m.R), 112, botY + 9, { size: 11, align: 'left', color: colors.muted });
        resH(ctx, 200, 170, 40);
        T(ctx, 'base resistor', 200, 152, { size: 11, color: colors.muted });
        transistorSym(ctx, 300, 170);
        T(ctx, 'b', 266, 160, { size: 11, color: colors.muted });
        T(ctx, 'c', 322, 140, { size: 11, color: colors.muted });
        T(ctx, 'e', 322, 202, { size: 11, color: colors.muted });
        D.bulb(ctx, 309, 96, m.frac * m.frac, { r: 14 });
        T(ctx, 'Lamp', 287, 96, { size: 12, align: 'right', color: colors.muted });
        cellV(ctx, 420, 170, true, { label: VS + ' V', labelDx: 30 });
        T(ctx, 'base–emitter arm', 80, 312, { size: 11, color: colors.muted });
        ctx.save();
        ctx.strokeStyle = 'rgba(52,211,153,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(36, 176, 70, 108);
        ctx.restore();
        // right panel: environment
        if (isL) {
          const L = st.L;
          ctx.save();
          const sky = `rgb(${Math.round(EM.lerp(12, 125, L))},${Math.round(EM.lerp(20, 211, L))},${Math.round(EM.lerp(48, 252, L))})`;
          ctx.fillStyle = sky;
          D.roundRect(ctx, 490, 14, 220, 82, 8);
          ctx.fill();
          ctx.globalAlpha = L;
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(530, 52, 18, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1 - L;
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.arc(530, 52, 14, 0, TAU);
          ctx.fill();
          ctx.fillStyle = sky;
          ctx.beginPath();
          ctx.arc(537, 46, 12, 0, TAU);
          ctx.fill();
          ctx.restore();
          T(ctx, 'Light level ' + Math.round(L * 100) + '%', 630, 44, { size: 13, weight: 700, color: L > 0.55 ? '#0f172a' : '#e2e8f0' });
          T(ctx, L < 0.35 ? 'dark' : L < 0.65 ? 'dim' : 'bright', 630, 66, { size: 12, color: L > 0.55 ? '#0f172a' : '#cbd5e1' });
        } else {
          ctx.save();
          ctx.fillStyle = '#1e293b';
          D.roundRect(ctx, 490, 14, 220, 82, 8);
          ctx.fill();
          const f = EM.clamp((st.Tc + 20) / 140, 0, 1);
          ctx.fillStyle = '#e2e8f0';
          D.roundRect(ctx, 520, 24, 14, 56, 7);
          ctx.fill();
          ctx.fillStyle = colors.bad;
          ctx.fillRect(523, 24 + 56 - 6 - 46 * f, 8, 46 * f + 4);
          ctx.beginPath();
          ctx.arc(527, 82, 9, 0, TAU);
          ctx.fill();
          ctx.restore();
          T(ctx, 'Temperature ' + Math.round(st.Tc) + ' °C', 630, 44, { size: 13, weight: 700 });
          T(ctx, st.Tc < 5 ? 'near freezing' : st.Tc > 60 ? 'hot' : 'mild', 630, 66, { size: 12, color: colors.muted });
        }
        // badge
        const state = m.frac > 0.9 ? 'ON' : m.frac > 0.05 ? 'PARTLY ON' : 'OFF';
        const bcol = state === 'ON' ? colors.good : state === 'OFF' ? '#475569' : colors.warn;
        ctx.save();
        ctx.fillStyle = bcol;
        D.roundRect(ctx, 530, 106, 140, 26, 13);
        ctx.fill();
        ctx.restore();
        T(ctx, 'Transistor ' + state, 600, 119, { size: 12, weight: 700, color: '#fff' });
        // divider bar
        const by0 = 146,
          bh = 160,
          bx = 520;
        const fTop = m.Vtop / VS;
        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.45)';
        ctx.fillRect(bx, by0, 34, bh * fTop);
        ctx.fillStyle = 'rgba(52,211,153,0.75)';
        ctx.fillRect(bx, by0 + bh * fTop, 34, bh * (1 - fTop));
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by0, 34, bh);
        ctx.restore();
        const y07 = by0 + bh - (bh * 0.7) / VS;
        D.line(ctx, bx - 6, y07, bx + 40, y07, colors.efield, 1.5, [3, 3]);
        T(ctx, '0.7 V', bx - 8, y07, { size: 10, align: 'right', color: colors.efield });
        T(ctx, VS + ' V split', bx + 17, by0 + bh + 12, { size: 11, color: colors.muted });
        let yt = by0 + (bh * fTop) / 2,
          yb = by0 + bh * fTop + (bh * (1 - fTop)) / 2;
        yt = EM.clamp(yt, by0 + 12, by0 + bh - 46);
        yb = EM.clamp(yb, yt + 34, by0 + bh - 10);
        const topName = m.sensorBottom ? 'R' : sname,
          botName = m.sensorBottom ? sname : 'R';
        T(ctx, topName + ': ' + m.Vtop.toFixed(3) + ' V', bx + 46, yt - 7, { size: 12, align: 'left' });
        T(ctx, '(top arm)', bx + 46, yt + 9, { size: 10, align: 'left', color: colors.muted });
        T(ctx, botName + ': ' + m.Vbot.toFixed(3) + ' V', bx + 46, yb - 7, { size: 12, align: 'left', color: '#6ee7b7' });
        T(ctx, '(base–emitter arm)', bx + 46, yb + 9, { size: 10, align: 'left', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    let rSlider;
    EM.segmented(c, {
      label: 'Circuit',
      options: isL
        ? [
            { value: 'A', label: '(A) on in the dark' },
            { value: 'B', label: '(B) on in brightness' },
          ]
        : [
            { value: 'A', label: '(A) on when hot' },
            { value: 'B', label: '(B) on when cold' },
          ],
      value: 'A',
      onChange: (v) => {
        st.circ = v;
        st.logR = defaults[v];
        rSlider.set(st.logR);
      },
    });
    if (isL) EM.slider(c, { label: 'Light level', min: 0, max: 1, step: 0.01, value: st.L, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => (st.L = v) });
    else EM.slider(c, { label: 'Temperature', min: -20, max: 120, step: 1, value: st.Tc, unit: '°C', fmt: (v) => String(Math.round(v)).replace('-', '−'), onInput: (v) => (st.Tc = v) });
    rSlider = EM.slider(c, { label: 'Fixed resistor R', min: 2, max: 6, step: 0.01, value: st.logR, fmt: (v) => fmtOhm(niceR(v)), onInput: (v) => (st.logR = v) });
    const ro = EM.readout(el, [
      { key: 's', label: (isL ? 'LDR' : 'Thermistor') + ' resistance' },
      { key: 'v', label: 'p.d. across ' + (isL ? 'LDR' : 'thermistor') },
      { key: 'vr', label: 'p.d. across R' },
      { key: 'ib', label: 'Base current I<sub>B</sub>' },
      { key: 'ic', label: 'Lamp (collector) current I<sub>C</sub>' },
    ]);
    const s = EM.status(el);
    EM.every(200, () => {
      const m = calc();
      ro.set('s', fmtOhm(m.S));
      ro.set('v', m.Vsensor.toFixed(3) + ' V');
      ro.set('vr', m.VR.toFixed(3) + ' V');
      ro.set('ib', fmtA(m.IB));
      ro.set('ic', fmtA(m.IC));
      const on = m.frac > 0.05;
      const cond = isL ? (st.L < 0.4 ? 'dark' : st.L > 0.6 ? 'bright' : 'dim') : st.Tc < 10 ? 'cold' : st.Tc > 50 ? 'hot' : 'mild';
      const sensorWord = isL ? (st.L < 0.5 ? 'high' : 'low') : st.Tc < 30 ? 'high' : 'low';
      let msg = `It is ${cond}: the ${isL ? 'LDR' : 'thermistor'}’s resistance is ${sensorWord} (${fmtOhm(m.S)}). The base–emitter arm has ${m.Vbot.toFixed(2)} V across it — `;
      msg += m.Vbot < 0.7 ? 'less than 0.7 V, so no base current flows and the lamp is <strong>off</strong>.' : on ? 'enough for a base current, so the transistor switches the lamp <strong>on</strong>.' : 'only just above 0.7 V, so the base current is tiny and the lamp is <strong>off</strong>.';
      s.set(msg, on ? 'good' : '');
    });
  }

  /* ------------------------------------------------------------------ sim: transistor as a switch (S1/S2) */

  function switchSim(el) {
    const st = { s1: true, s2: true, VB: 2.5, beta: 100, elec: false };
    const RB = 4700,
      VCC = 6,
      RL = 100;
    const ICMAX = (VCC - 0.2) / RL;
    const model = () => {
      const IB = st.s1 && st.VB > 0.7 ? (st.VB - 0.7) / RB : 0;
      const IC = st.s2 ? Math.min(st.beta * IB, ICMAX) : 0;
      return { IB, IC, IE: IB + IC, sat: st.s2 && st.beta * IB > ICMAX };
    };
    EM.canvas(el, {
      width: 720,
      height: 340,
      label: 'Transistor switch circuit with switches S1 and S2',
      draw(ctx, s) {
        const m = model();
        const dirSign = st.elec ? -1 : 1;
        const dcol = st.elec ? colors.electron : colors.current;
        // wires
        D.wire(ctx, [[60, 198], [60, 150], [278, 150]]);
        D.wire(ctx, [[309, 176], [309, 270], [190, 270]]);
        D.wire(ctx, [[150, 270], [60, 270], [60, 212]]);
        D.wire(ctx, [[309, 270], [380, 270]]);
        D.wire(ctx, [[420, 270], [450, 270], [450, 170]]);
        D.wire(ctx, [[450, 150], [450, 60], [309, 60], [309, 124]]);
        // dots
        if (m.IB > 0) D.flowDots(ctx, [[60, 198], [60, 150], [278, 150], [309, 176], [309, 270], [60, 270], [60, 212]], s.t, { speed: dirSign * (20 + 30 * (m.IB / 1.2e-3)), spacing: 34, color: dcol, r: 2.6 });
        if (m.IC > 0) D.flowDots(ctx, [[450, 152], [450, 60], [309, 60], [309, 124], [309, 176], [309, 270], [450, 270], [450, 168]], s.t, { speed: dirSign * (30 + 120 * (m.IC / ICMAX)), spacing: 15, color: dcol, r: 3 });
        // components
        resH(ctx, 165, 150, 46);
        T(ctx, 'Resistor', 165, 128, { size: 12, color: colors.muted });
        transistorSym(ctx, 300, 150);
        T(ctx, 'b', 268, 138, { size: 12, weight: 700 });
        T(ctx, 'c', 324, 116, { size: 12, weight: 700 });
        T(ctx, 'e', 324, 186, { size: 12, weight: 700 });
        D.switch(ctx, 150, 270, 190, st.s1, { label: 'S1' });
        D.switch(ctx, 380, 270, 420, st.s2, { label: 'S2' });
        cellV(ctx, 60, 205, true, { label: st.VB.toFixed(1) + ' V', labelDx: -52, signsLeft: true });
        cellV(ctx, 450, 160, true, { label: VCC + ' V' });
        D.bulb(ctx, 380, 60, Math.pow(m.IC / ICMAX, 2), { r: 14 });
        T(ctx, 'lamp', 380, 88, { size: 11, color: colors.muted });
        // current labels
        T(ctx, 'Base current I_B', 165, 172, { size: 12, color: m.IB > 0 ? dcol : colors.muted, weight: 700 });
        T(ctx, 'Collector current I_C', 380, 34, { size: 12, color: m.IC > 0 ? dcol : colors.muted, weight: 700 });
        T(ctx, 'Emitter current I_E', 318, 230, { size: 12, color: m.IE > 0 ? dcol : colors.muted, weight: 700, align: 'left' });
        T(ctx, st.elec ? 'Showing electron flow (− → +)' : 'Showing conventional current (+ → −)', 12, 18, { size: 11, align: 'left', color: dcol });
        T(ctx, 'V_BE ≈ ' + (m.IB > 0 ? '0.7' : st.s1 ? Math.min(st.VB, 0.7).toFixed(1) : '0') + ' V', 240, 200, { size: 11, color: colors.muted });
        // graph of IC against IB
        const r = { x: 556, y: 40, w: 148, h: 220 };
        D.plot(ctx, r, {
          xMin: 0,
          xMax: 1.2,
          yMin: 0,
          yMax: 70,
          title: 'I_C against I_B',
          xLabel: 'I_B / mA',
          yLabel: 'I_C / mA',
          xTicks: 3,
          yTicks: 4,
          series: [{ fn: (x) => Math.min(st.beta * x, ICMAX * 1000), color: colors.good }],
          markers: [{ x: m.IB * 1000, y: m.IC * 1000, color: '#fff' }],
        });
        if (m.sat) T(ctx, 'fully on (lamp limits I_C)', r.x + r.w / 2, 306, { size: 11, color: colors.warn });
        else if (m.IC > 0) T(ctx, 'straight line: I_C ∝ I_B', r.x + r.w / 2, 306, { size: 11, color: colors.good });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'S1 (base circuit) closed', value: st.s1, onChange: (v) => (st.s1 = v) });
    EM.toggle(c, { label: 'S2 (collector circuit) closed', value: st.s2, onChange: (v) => (st.s2 = v) });
    EM.slider(c, { label: 'Base supply voltage', min: 0, max: 6, step: 0.1, value: st.VB, unit: 'V', fmt: (v) => v.toFixed(1), onInput: (v) => (st.VB = v) });
    EM.slider(c, { label: 'Current gain β (I<sub>C</sub> ÷ I<sub>B</sub>)', min: 10, max: 1000, step: 10, value: st.beta, fmt: (v) => String(Math.round(v)), onInput: (v) => (st.beta = v) });
    EM.segmented(c, {
      label: 'Show',
      options: [
        { value: 0, label: 'Conventional current' },
        { value: 1, label: 'Electron flow' },
      ],
      value: 0,
      onChange: (v) => (st.elec = !!v),
    });
    const ro = EM.readout(el, [
      { key: 'ib', label: 'I<sub>B</sub>' },
      { key: 'ic', label: 'I<sub>C</sub>' },
      { key: 'ie', label: 'I<sub>E</sub> = I<sub>B</sub> + I<sub>C</sub>' },
      { key: 'ratio', label: 'I<sub>C</sub> ÷ I<sub>B</sub>' },
    ]);
    const s = EM.status(el);
    EM.every(200, () => {
      const m = model();
      ro.set('ib', fmtA(m.IB));
      ro.set('ic', fmtA(m.IC));
      ro.set('ie', fmtA(m.IE));
      ro.set('ratio', m.IB > 0 && m.IC > 0 ? String(Math.round(m.IC / m.IB)) : '–');
      if (!st.s1) s.set('S1 open: I<sub>B</sub> = 0, so I<sub>C</sub> = 0 — even though the collector supply is connected. The lamp is off.', 'bad');
      else if (st.VB <= 0.7) s.set('S1 closed but the base–emitter p.d. is below about 0.7 V, so no base current flows → no collector current.', 'warn');
      else if (!st.s2) s.set('A base current flows, but S2 is open so the collector circuit is broken: I<sub>C</sub> = 0.', 'warn');
      else if (m.sat) s.set('The transistor is <strong>fully on</strong>: the lamp’s resistance now limits I<sub>C</sub>, so a bigger I<sub>B</sub> cannot raise it further.', 'good');
      else s.set(`A small base current (${fmtA(m.IB)}) switches on a collector current ${Math.round(st.beta)} times bigger (${fmtA(m.IC)}).`, 'good');
    });
  }

  /* ------------------------------------------------------------------ sim: diode forward / reverse bias */

  function diodeBiasSim(el) {
    const st = { fwd: true, V: 3 };
    const RB = 20,
      nVt = 0.04,
      Is = 5e-3 / Math.exp(15);
    const Id = (v) => Is * (Math.exp(v / nVt) - 1);
    const solve = () => {
      const V = st.fwd ? st.V : -st.V;
      let lo = Math.min(V, 0) - 0.01,
        hi = Math.max(0, Math.min(V, 1.2)) + 0.01;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (mid + Id(mid) * RB > V) hi = mid;
        else lo = mid;
      }
      const vd = (lo + hi) / 2;
      return { vd, i: Id(vd) };
    };
    const IMAX = 0.27;
    EM.canvas(el, {
      width: 720,
      height: 360,
      label: 'Diode in forward and reverse bias with a bulb, plus its I-V curve',
      draw(ctx, s) {
        const { vd, i } = solve();
        const on = i > 1e-3;
        // circuit (battery top, bulb right, diode bottom)
        const pts = [
          [175, 50],
          [50, 50],
          [50, 200],
          [310, 200],
          [310, 50],
          [185, 50],
        ];
        D.wire(ctx, pts);
        if (on) D.flowDots(ctx, pts, s.t, { speed: 30 + 150 * (i / IMAX), spacing: 20 });
        cellH(ctx, 180, 50, st.fwd);
        T(ctx, st.V.toFixed(1) + ' V', 180, 84, { size: 12, color: colors.muted });
        diodeSym(ctx, 180, 200, 1, 13);
        T(ctx, st.fwd ? '+' : '−', 155, 180, { size: 13, weight: 700, color: st.fwd ? colors.pos : '#93c5fd' });
        T(ctx, 'p', 168, 224, { size: 12, color: colors.muted });
        T(ctx, 'n', 193, 224, { size: 12, color: colors.muted });
        T(ctx, st.fwd ? '−' : '+', 205, 180, { size: 13, weight: 700, color: st.fwd ? '#93c5fd' : colors.pos });
        D.bulb(ctx, 310, 125, Math.pow(EM.clamp(i / IMAX, 0, 1), 1.3), { r: 18 });
        T(ctx, on ? 'bulb lights' : 'bulb off', 310, 160, { size: 12, color: on ? colors.good : colors.muted });
        T(ctx, st.fwd ? 'Forward bias: + to p, − to n' : 'Reverse bias: + to n, − to p', 180, 20, { size: 13, weight: 700, color: st.fwd ? colors.good : colors.bad });
        // junction close-up
        const jy = 250,
          jh = 70,
          jx0 = 40,
          jx1 = 320,
          JX = 180;
        const w = 14 * Math.sqrt(Math.max(0.02, (0.7 - Math.min(vd, 0.69)) / 0.7));
        ctx.save();
        ctx.fillStyle = 'rgba(239,68,68,0.14)';
        ctx.fillRect(jx0, jy, JX - jx0, jh);
        ctx.fillStyle = 'rgba(59,130,246,0.14)';
        ctx.fillRect(JX, jy, jx1 - JX, jh);
        ctx.fillStyle = 'rgba(226,232,240,0.22)';
        ctx.fillRect(JX - w, jy, 2 * w, jh);
        ctx.strokeStyle = 'rgba(203,213,225,0.55)';
        ctx.strokeRect(jx0, jy, jx1 - jx0, jh);
        ctx.restore();
        T(ctx, 'close-up of the junction', 180, 240, { size: 11, color: colors.muted });
        T(ctx, 'depletion layer ' + (w > 20 ? 'wide' : w < 6 ? 'very narrow' : 'narrow'), 180, jy + jh + 14, { size: 12, color: '#e2e8f0' });
        for (let k = 0; k < 10; k++) {
          const yy = jy + 10 + ((k * 13) % (jh - 20));
          let hx = jx0 + 10 + ((k * 31) % (JX - jx0 - 20));
          let ex = JX + 10 + ((k * 29) % (jx1 - JX - 20));
          if (on) {
            const sp = 30 + 80 * (i / IMAX);
            hx = jx0 + 10 + ((hx - jx0 + s.t * sp) % (jx1 - jx0 - 20));
            ex = jx1 - 10 - ((jx1 - ex + s.t * sp) % (jx1 - jx0 - 20));
          }
          if (Math.abs(hx - JX) > w + 4 && hx < jx1 - 6) D.hole(ctx, hx, yy, 3.6);
          if (Math.abs(ex - JX) > w + 4 && ex > jx0 + 6) D.electron(ctx, ex, yy + 6, 3);
        }
        // I–V graph
        D.plot(ctx, { x: 420, y: 36, w: 280, h: 250 }, {
          xMin: -6,
          xMax: 1.5,
          yMin: -20,
          yMax: 300,
          title: 'I–V curve of the diode',
          xLabel: 'p.d. across the diode / V',
          yLabel: 'current / mA',
          xTicks: 7,
          yTicks: 6,
          series: [{ fn: (x) => { const y = Id(x) * 1000; return y > 400 ? NaN : y; }, color: colors.efield }],
          vLines: [{ x: 0.6, color: colors.good }],
          markers: [{ x: vd, y: i * 1000, color: '#fff' }],
        });
        T(ctx, '≈0.6 V', 560, 60, { size: 11, color: colors.good, align: 'left' });
        T(ctx, 'reverse bias: ~no current', 500, 255, { size: 11, color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Battery connection',
      options: [
        { value: 1, label: 'Forward bias (p to +)' },
        { value: 0, label: 'Reverse bias (p to −)' },
      ],
      value: 1,
      onChange: (v) => (st.fwd = !!v),
    });
    EM.slider(c, { label: 'Battery voltage', min: 0, max: 6, step: 0.05, value: st.V, unit: 'V', fmt: (v) => v.toFixed(2), onInput: (v) => (st.V = v) });
    const ro = EM.readout(el, [
      { key: 'vd', label: 'p.d. across diode' },
      { key: 'i', label: 'Current' },
      { key: 'b', label: 'Bulb' },
    ]);
    const s = EM.status(el);
    EM.every(200, () => {
      const { vd, i } = solve();
      ro.set('vd', EM.fmt(vd, 3) + ' V');
      ro.set('i', i > 1e-6 ? fmtA(i) : '≈ 0');
      ro.set('b', i > 0.02 ? 'ON' : i > 1e-3 ? 'faint glow' : 'OFF');
      if (!st.fwd) s.set('Reverse bias: the battery pulls electrons and holes <strong>away</strong> from the junction, the depletion layer <strong>widens</strong> and no current flows.', 'bad');
      else if (st.V < 0.55) s.set('Forward bias, but below about <strong>0.6 V</strong> the electrons cannot overcome the Coulomb barrier of the depletion region — almost no current.', 'warn');
      else s.set('Forward bias above ≈0.6 V: the depletion layer has shrunk and electrons flow across with very little resistance — the bulb lights.', 'good');
    });
  }

  /* ------------------------------------------------------------------ sim: potential divider explorer */

  function dividerSim(el) {
    const st = { V: 12, logR: 4, logL: 6 };
    const sim = EM.canvas(el, {
      width: 720,
      height: 300,
      label: 'Potential divider made of a fixed resistor R and an LDR',
      draw(ctx) {
        const R = niceR(st.logR),
          L = niceR(st.logL);
        const RT = R + L,
          I = st.V / RT,
          VR = I * R,
          VL = I * L;
        D.wire(ctx, [[150, 30], [150, 270]]);
        D.wire(ctx, [[150, 30], [250, 30]]);
        D.wire(ctx, [[150, 150], [250, 150]]);
        D.wire(ctx, [[150, 270], [250, 270]]);
        resV(ctx, 150, 90, 50);
        ldrSym(ctx, 150, 210, 0.3);
        T(ctx, 'R', 172, 90, { size: 13, weight: 700, align: 'left' });
        T(ctx, 'LDR', 180, 210, { size: 13, weight: 700, align: 'left' });
        T(ctx, st.V.toFixed(1) + ' V in', 256, 30, { size: 12, align: 'left' });
        T(ctx, 'Base', 256, 150, { size: 12, align: 'left' });
        T(ctx, 'Emitter (0 V)', 256, 270, { size: 12, align: 'left' });
        // brackets
        const br = (y0, y1, txt, col) => {
          D.line(ctx, 100, y0 + 4, 100, y1 - 4, col, 1.5);
          D.line(ctx, 100, y0 + 4, 108, y0 + 4, col, 1.5);
          D.line(ctx, 100, y1 - 4, 108, y1 - 4, col, 1.5);
          T(ctx, txt, 92, (y0 + y1) / 2 - 8, { size: 12, weight: 700, align: 'right', color: col });
          T(ctx, 'drop', 92, (y0 + y1) / 2 + 8, { size: 11, align: 'right', color: colors.muted });
        };
        br(34, 146, VR.toFixed(3) + ' V', colors.text);
        br(154, 266, VL.toFixed(3) + ' V', '#6ee7b7');
        const x = 360;
        const n = (v) => Math.round(v).toLocaleString('en-IE');
        const lines = [
          ['R_T = R + R_LDR = ' + n(R) + ' + ' + n(L), colors.text, 30],
          ['= ' + n(RT) + ' Ω', colors.text, 50],
          ['I = V ÷ R_T = ' + st.V.toFixed(1) + ' ÷ ' + n(RT) + ' = ' + fmtAText(I), colors.text, 84],
          ['V_R = I × R = ' + VR.toFixed(3) + ' V', colors.text, 118],
          ['V_LDR = I × R_LDR = ' + VL.toFixed(3) + ' V', '#6ee7b7', 152],
          ['Check: V_R + V_LDR = ' + (VR + VL).toFixed(3) + ' V', colors.muted, 186],
        ];
        lines.forEach(([t, col, y], i) => T(ctx, t, i === 1 ? x + 42 : x, y, { size: 13, align: 'left', color: col }));
        const on = VL >= 0.7;
        ctx.save();
        ctx.fillStyle = on ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.15)';
        D.roundRect(ctx, x - 8, 222, 350, 50, 8);
        ctx.fill();
        ctx.restore();
        T(ctx, on ? 'Base–emitter p.d. ≥ 0.7 V' : 'Base–emitter p.d. < 0.7 V', x, 238, { size: 13, weight: 700, align: 'left', color: on ? colors.good : colors.bad });
        T(ctx, on ? '→ base current flows → transistor ON' : '→ no base current → transistor OFF', x, 258, { size: 13, align: 'left', color: on ? colors.good : colors.bad });
      },
    });
    const c = EM.controls(el);
    const sV = EM.slider(c, { label: 'Supply V', min: 1, max: 24, step: 0.5, value: 12, unit: 'V', fmt: (v) => v.toFixed(1), onInput: (v) => (st.V = v) });
    const sR = EM.slider(c, { label: 'Fixed resistor R', min: 2, max: 6, step: 0.01, value: 4, fmt: (v) => fmtOhm(niceR(v)), onInput: (v) => (st.logR = v) });
    const sL = EM.slider(c, { label: 'LDR resistance (dark = high)', min: 2, max: 6, step: 0.01, value: 6, fmt: (v) => fmtOhm(niceR(v)), onInput: (v) => (st.logL = v) });
    EM.button(c, 'Load the notes’ example', () => {
      st.V = 12;
      st.logR = 4;
      st.logL = 6;
      sV.set(12);
      sR.set(4);
      sL.set(6);
    });
    return sim;
  }

  /* ================================================================== chapter */

  EM.chapter({
    id: 'c4',
    code: 'C.4',
    title: 'Semiconductors',
    color: '#059669',
    blurb: 'Silicon, electrons and holes, doping, the p–n junction and diodes, and transistors used as switches controlled by light and temperature.',

    terms: [
      { id: 'semiconductor', term: 'Semiconductor', def: 'A solid substance that has conductivity between that of an insulator and that of a good conductor.' },
      { id: 'valence', term: 'Valence electrons', def: 'The electrons in an atom’s outermost shell (the valence shell). Silicon has 4; metals typically have 1–3.' },
      { id: 'lattice', term: 'Crystal lattice', def: 'The stable, repeating pattern in which semiconductor atoms (e.g. silicon) are joined to their neighbours.' },
      { id: 'covalent', term: 'Covalent bond', def: 'A bond in which neighbouring atoms share valence electrons. Each silicon atom shares its 4 valence electrons with 4 neighbours.' },
      { id: 'conduction-electron', term: 'Conduction electron', def: 'A valence electron that has gained enough thermal energy to break its covalent bond and is free to wander from atom to atom.' },
      { id: 'hole', term: 'Positive hole', def: 'The gap left in a covalent bond when an electron breaks free. A neighbouring valence electron can move into it, so the hole moves and acts like a positive charge carrier.' },
      { id: 'intrinsic', term: 'Intrinsic conduction', def: 'The movement of charges through a pure semiconductor.' },
      { id: 'doping', term: 'Doping', def: 'The adding of small amounts of certain impurities to a pure semiconductor to increase its conductivity.' },
      { id: 'p-type', term: 'P-type semiconductor', def: 'A semiconductor in which the impurity added produces extra positive holes for conduction (e.g. boron, with 3 outer electrons, added to silicon).' },
      { id: 'n-type', term: 'N-type semiconductor', def: 'A semiconductor in which the impurity added produces more free electrons for conduction (e.g. phosphorus, with 5 outer electrons, added to silicon).' },
      { id: 'majority', term: 'Majority / minority charge carriers', def: 'In p-type, holes are the majority carriers and electrons the minority carriers. In n-type, electrons are the majority carriers and holes the minority carriers.' },
      { id: 'extrinsic', term: 'Extrinsic conduction', def: 'The movement of charges through a doped semiconductor.' },
      { id: 'pn-junction', term: 'P-N junction', def: 'A piece of semiconductor with part of it doped n-type and the rest of it doped p-type.' },
      { id: 'depletion', term: 'Depletion region (layer)', def: 'The region at a p-n junction where electrons have filled holes, leaving negative ions on the p-side and positive ions on the n-side. It has no free carriers, so it acts as an insulator.' },
      { id: 'junction-voltage', term: 'Junction voltage', def: 'The potential difference across a p-n junction caused by its depletion layer.' },
      { id: 'diode', term: 'Diode', def: 'A p-n junction device that allows current to flow in one direction only.' },
      { id: 'forward-bias', term: 'Forward bias', def: 'The p-type region is connected to the positive terminal and the n-type region to the negative terminal: current flows (once about 0.6 V is applied).' },
      { id: 'reverse-bias', term: 'Reverse bias', def: 'The n-type region is connected to the positive terminal and the p-type region to the negative terminal: the depletion layer widens and no current flows.' },
      { id: 'transistor', term: 'Transistor', def: 'A semiconductor component, primarily made of silicon, that acts as an electrical switch or amplifier, thus controlling electrical current in circuits.' },
      { id: 'emitter', term: 'Emitter (E)', def: 'The heavily n-type doped region that supplies electrons as charge carriers to the transistor.' },
      { id: 'base', term: 'Base (B)', def: 'The lightly p-type doped middle region that is very thin and acts as the control terminal.' },
      { id: 'collector', term: 'Collector (C)', def: 'The moderately n-type doped region that collects the charge carriers sent from the emitter.' },
      { id: 'ldr', term: 'LDR (light-dependent resistor)', def: 'A resistor whose resistance increases when it gets dark and decreases when it is bright.' },
      { id: 'thermistor', term: 'Thermistor', def: 'A semiconductor device (thermal resistor) whose resistance changes with temperature: as the temperature increases, its resistance decreases.' },
    ],

    formulas: [
      {
        id: 'gain',
        name: 'Transistor current gain',
        display: `<var>I</var><sub>C</sub> = <var>β</var> × <var>I</var><sub>B</sub>`,
        vars: [
          { sym: 'IC', label: 'I<sub>C</sub>', name: 'Collector current', unit: 'A', value: 0.02 },
          { sym: 'beta', label: 'β', name: 'Current gain (no unit)', unit: '', value: 100 },
          { sym: 'IB', label: 'I<sub>B</sub>', name: 'Base current', unit: 'A', value: 0.0002 },
        ],
        solve: {
          IC: (v) => v.beta * v.IB,
          beta: (v) => v.IC / v.IB,
          IB: (v) => v.IC / v.beta,
        },
        notes: 'The notes say I<sub>C</sub> is <strong>directly proportional</strong> to I<sub>B</sub> and is typically <strong>10 to 1,000 times bigger</strong>. Writing the constant of proportionality as β (the current gain) gives this equation. It only applies while the transistor is not yet fully on; if I<sub>B</sub> = 0 then I<sub>C</sub> = 0.',
        example: { q: 'A transistor has a base current of 0.2 mA and a current gain of 100. Find the collector current.', a: 'I<sub>C</sub> = β × I<sub>B</sub> = 100 × 0.0002 = <strong>0.02 A (20 mA)</strong>. A tiny base current controls a current 100 times larger.' },
      },
      {
        id: 'emitter-current',
        name: 'Emitter current',
        display: `<var>I</var><sub>E</sub> = <var>I</var><sub>B</sub> + <var>I</var><sub>C</sub>`,
        vars: [
          { sym: 'IE', label: 'I<sub>E</sub>', name: 'Emitter current', unit: 'A', value: 0.0202 },
          { sym: 'IB', label: 'I<sub>B</sub>', name: 'Base current', unit: 'A', value: 0.0002 },
          { sym: 'IC', label: 'I<sub>C</sub>', name: 'Collector current', unit: 'A', value: 0.02 },
        ],
        solve: {
          IE: (v) => v.IB + v.IC,
          IB: (v) => v.IE - v.IC,
          IC: (v) => v.IE - v.IB,
        },
        notes: 'In the switch circuit the base current and the collector current both leave through the emitter, so they add up (charge is conserved). Because I<sub>B</sub> is so small, I<sub>E</sub> ≈ I<sub>C</sub>.',
        example: { q: 'I<sub>B</sub> = 0.2 mA and I<sub>C</sub> = 20 mA. Find I<sub>E</sub>.', a: 'I<sub>E</sub> = 0.0002 + 0.02 = <strong>0.0202 A (20.2 mA)</strong>.' },
      },
      {
        id: 'series',
        name: 'Total resistance of the divider (series)',
        display: `<var>R</var><sub>T</sub> = <var>R</var> + <var>R</var><sub>LDR</sub>`,
        vars: [
          { sym: 'RT', label: 'R<sub>T</sub>', name: 'Total resistance', unit: 'Ω', value: 1010000 },
          { sym: 'R', label: 'R', name: 'Fixed resistor', unit: 'Ω', value: 10000 },
          { sym: 'RL', label: 'R<sub>LDR</sub>', name: 'LDR resistance', unit: 'Ω', value: 1000000 },
        ],
        solve: {
          RT: (v) => v.R + v.RL,
          R: (v) => v.RT - v.RL,
          RL: (v) => v.RT - v.R,
        },
        notes: 'R and the LDR are connected in series, so their resistances add.',
        example: { q: 'R = 10,000 Ω and the LDR (in the dark) = 1,000,000 Ω. Find R<sub>T</sub>.', a: 'R<sub>T</sub> = 10,000 + 1,000,000 = <strong>1,010,000 Ω</strong>.' },
      },
      {
        id: 'ohm',
        name: 'Ohm’s law (used for the divider)',
        display: `<var>V</var> = <var>I</var> × <var>R</var> &nbsp;&nbsp;⇔&nbsp;&nbsp; <var>I</var> = ${EM.frac('<var>V</var>', '<var>R</var>')}`,
        vars: [
          { sym: 'V', label: 'V', name: 'Potential difference', unit: 'V', value: 12 },
          { sym: 'I', label: 'I', name: 'Current', unit: 'A', value: 0.0000118812 },
          { sym: 'R', label: 'R', name: 'Resistance', unit: 'Ω', value: 1010000 },
        ],
        solve: {
          V: (v) => v.I * v.R,
          I: (v) => v.V / v.R,
          R: (v) => v.V / v.I,
        },
        notes: 'The notes use this three times: I = V ÷ R<sub>T</sub> for the whole divider, then V = I × R for each resistor.',
        example: {
          q: '12 V is applied across R<sub>T</sub> = 1,010,000 Ω. Find the current, then the p.d. across R = 10,000 Ω.',
          a: 'I = 12 ÷ 1,010,000 = 0.0000119 A (1.19 × 10<sup>−5</sup> A; the notes round this to 0.000011 A).<br>V<sub>R</sub> = I × R = 0.0000119 × 10,000 = <strong>0.119 V</strong>.',
        },
      },
      {
        id: 'divider',
        name: 'Potential divider: p.d. across the LDR',
        display: `<var>V</var><sub>LDR</sub> = <var>V</var> × ${EM.frac('<var>R</var><sub>LDR</sub>', '<var>R</var> + <var>R</var><sub>LDR</sub>')}`,
        vars: [
          { sym: 'VL', label: 'V<sub>LDR</sub>', name: 'p.d. across the LDR (base–emitter)', unit: 'V', value: 11.8812 },
          { sym: 'V', label: 'V', name: 'Supply p.d. across the divider', unit: 'V', value: 12 },
          { sym: 'R', label: 'R', name: 'Fixed resistor', unit: 'Ω', value: 10000 },
          { sym: 'RL', label: 'R<sub>LDR</sub>', name: 'LDR resistance', unit: 'Ω', value: 1000000 },
        ],
        solve: {
          VL: (v) => (v.V * v.RL) / (v.R + v.RL),
          V: (v) => (v.VL * (v.R + v.RL)) / v.RL,
          RL: (v) => (v.VL * v.R) / (v.V - v.VL),
          R: (v) => (v.RL * (v.V - v.VL)) / v.VL,
        },
        notes: 'This combines the notes’ three steps into one line. The p.d. splits in the same ratio as the resistances: the bigger resistance gets the bigger share. Similarly V<sub>R</sub> = V × R ÷ (R + R<sub>LDR</sub>), and V<sub>R</sub> + V<sub>LDR</sub> = V.',
        derivation: ['R and the LDR are in series: R<sub>T</sub> = R + R<sub>LDR</sub>.', 'The same current flows through both: I = V ÷ (R + R<sub>LDR</sub>).', 'p.d. across the LDR: V<sub>LDR</sub> = I × R<sub>LDR</sub> = V × R<sub>LDR</sub> ÷ (R + R<sub>LDR</sub>).'],
        example: { q: 'V = 12 V, R = 10,000 Ω, LDR = 1,000,000 Ω (dark). Find V<sub>LDR</sub> and V<sub>R</sub>.', a: 'V<sub>LDR</sub> = 12 × 1,000,000 ÷ 1,010,000 = <strong>11.881 V</strong>; V<sub>R</sub> = 12 − 11.881 = <strong>0.119 V</strong>. Plenty for the base–emitter junction → transistor on.' },
      },
    ],

    experiments: [
      {
        id: 'diode-bias',
        title: 'Virtual investigation: A diode in forward and reverse bias',
        aim: 'To show that a diode conducts in one direction only, and to find the p.d. needed before a forward-biased diode conducts.',
        apparatus: ['Battery (variable p.d.)', 'Diode (p-n junction)', 'Bulb', 'Connecting wires'],
        steps: [
          'Connect the battery, a bulb and a diode in series, with the p side of the diode towards the + terminal (<strong>forward bias</strong>).',
          'Slowly increase the battery voltage from 0 V. Watch the bulb, the current and the depletion layer.',
          'Note the p.d. across the diode when current starts to flow (where the I–V graph shoots up).',
          'Now reverse the battery so the p side is connected to − (<strong>reverse bias</strong>) and increase the voltage again.',
        ],
        result: 'Forward bias: almost no current until about 0.6 V is across the diode, then the current rises steeply and the bulb lights. Reverse bias: the depletion layer widens and (practically) no current flows; the bulb stays off.',
        conclusion: 'A diode only lets current flow one way. Forward bias needs about 0.6 V to overcome the Coulomb barrier of the depletion region; reverse bias widens the depletion layer and blocks the current.',
        sim: diodeBiasSim,
      },
      {
        id: 'transistor-switch',
        title: 'Virtual investigation: The transistor as a switch',
        aim: 'To show that a small base current switches on a much larger collector current, and that I<sub>C</sub> ∝ I<sub>B</sub>.',
        apparatus: ['NPN transistor', 'Base resistor (4.7 kΩ)', 'Variable base supply', '6 V collector supply', 'Lamp', 'Switches S1 and S2'],
        steps: [
          'Open S1 and close S2. Note I<sub>B</sub> and I<sub>C</sub>.',
          'Close S1 with the base supply set below 0.7 V. Then raise it above 0.7 V.',
          'Increase the base supply in steps and record I<sub>B</sub> and I<sub>C</sub>. Look at the I<sub>C</sub>–I<sub>B</sub> graph and the ratio I<sub>C</sub> ÷ I<sub>B</sub>.',
          'Open S2 while a base current flows.',
          'Switch the display to electron flow to compare it with conventional current.',
        ],
        result: 'With S1 open, I<sub>B</sub> = 0 and I<sub>C</sub> = 0 even though the collector supply is connected. Once V<sub>BE</sub> reaches about 0.7 V, a small I<sub>B</sub> flows and a much larger I<sub>C</sub> flows (if S2 is closed). The graph of I<sub>C</sub> against I<sub>B</sub> is a straight line through the origin until the lamp limits the current.',
        conclusion: 'A transistor is a current-controlled switch and amplifier: I<sub>C</sub> is typically 10–1,000 times I<sub>B</sub>, and I<sub>C</sub> ∝ I<sub>B</sub>.',
        sim: switchSim,
      },
      {
        id: 'light-switch',
        title: 'Virtual investigation: A light-controlled switch',
        aim: 'To see how an LDR in a potential divider turns a transistor (and lamp) on in the dark — or in brightness.',
        apparatus: ['12 V supply', 'Fixed resistor R', 'LDR', 'Base resistor', 'NPN transistor', 'Lamp'],
        steps: [
          'Choose circuit (A): R on top, LDR in the lower (base–emitter) arm.',
          'Slide the light level from bright to dark. Watch the LDR resistance, the p.d. across each arm and the lamp.',
          'Switch to circuit (B), where the LDR and R swap places, and repeat.',
          'Change the fixed resistor R and see how it changes the light level at which the lamp switches.',
        ],
        result: '(A) In the dark the LDR’s resistance rises, so the p.d. across it (the base–emitter arm) rises above 0.7 V and the lamp comes on. (B) In bright light the LDR’s resistance falls, the p.d. across R rises and the lamp comes on.',
        conclusion: 'A potential divider with an LDR controls the base of a transistor, making an automatic light-controlled switch (e.g. garden lights and street lights).',
        sim: (el) => sensorSim(el, 'ldr'),
      },
    ],

    topics: [
      /* ---------------------------------------------------------------- 1 */
      {
        id: 'what',
        title: 'What is a semiconductor?',
        summary: 'Materials such as silicon whose conductivity lies between that of conductors and insulators.',
        keywords: 'semiconductor conductor insulator silicon germanium boron carbon gallium arsenide LED copper glass transistor diode integrated circuit smartphone solar panel AI medical',
        render(el, ui) {
          const s1 = EM.section(el, 'Between conductors and insulators');
          EM.p(s1, 'Semiconductors are materials, typically <strong>silicon</strong>, with electrical conductivity <strong>between</strong> that of conductors (like copper) and insulators (like glass). Their ability to <strong>control</strong> electrical current — acting as both a conductor and an insulator — is the foundation of modern electronics.');
          ui.term('semiconductor', s1);
          const sp = EM.simPanel(s1, 'Conductor vs semiconductor vs insulator', 'Purple circles are fixed atoms; blue dots are free electrons that can carry current. Change the temperature and connect a battery.');
          materialsSim(sp);
          EM.callout(s1, 'tip', 'Unlike a metal, a semiconductor <strong>conducts better when it is hotter</strong>: heat frees more electrons. You will see why in the next topic.', 'Notice');

          const s2 = EM.section(el, 'Why do semiconductors matter?');
          EM.p(s2, 'Semiconductors power the transistors, diodes and integrated circuits (chips) found in:');
          EM.cards(
            s2,
            [
              { icon: '💻', title: 'Computers & smartphones', html: 'Processors and memory are built from billions of transistors.' },
              { icon: '☀️', title: 'Solar panels', html: 'Silicon cells turn light into electricity.' },
              { icon: '🤖', title: 'AI technologies', html: 'The chips that train and run AI are semiconductor devices.' },
              { icon: '🩺', title: 'Medical equipment', html: 'Scanners, monitors and many other devices rely on them.' },
            ],
            { cols: 2 }
          );
          EM.callout(s2, 'key', 'Semiconductors allow smaller, more efficient and more powerful electronic components. Without them, modern digital technology would not exist.');

          const s3 = EM.section(el, 'Semiconductor materials');
          EM.p(s3, '<strong>Silicon</strong> is the most common semiconductor material because:');
          EM.list(s3, ['it is <strong>abundant</strong> — about <strong>28% of the Earth’s crust</strong> is silicon;', 'it is <strong>stable</strong>;', 'it has a very <strong>high heat resistance</strong>, so it withstands the high temperatures associated with computer processing.']);
          EM.p(s3, 'Other materials include <strong>germanium</strong>, <strong>boron</strong>, <strong>carbon</strong> and <strong>gallium arsenide</strong>, which is used in LEDs.');
        },
      },
      /* ---------------------------------------------------------------- 2 */
      {
        id: 'conduction',
        title: 'Conduction in semiconductors',
        summary: 'Silicon’s 4 valence electrons form covalent bonds; heat frees some, creating conduction electrons and positive holes.',
        keywords: 'valence electrons valence shell covalent bond crystal lattice conduction electron positive hole thermal energy intrinsic conduction pure silicon metals',
        render(el, ui) {
          const s1 = EM.section(el, 'Valence electrons');
          EM.p(s1, 'A silicon atom has <strong>4 electrons in its outermost shell</strong> (the valence shell). These <strong>valence electrons</strong> are involved in covalent bonds with 4 other silicon atoms, so they are <strong>not free to move</strong>.');
          EM.p(s1, 'In metals, the valence shell typically has <strong>between 1 and 3 electrons</strong>. These are easily freed from the atom, so current flows readily through the material.');
          ui.term('valence', s1);
          const sp = EM.simPanel(s1, 'Electron shells', 'Compare silicon with two metals and with the two doping atoms you will meet next.');
          atomSim(sp);

          const s2 = EM.section(el, 'The crystal lattice and covalent bonds');
          EM.p(s2, 'Having exactly 4 valence electrons makes silicon ideal as a semiconductor. Its atoms connect in a stable repeating pattern called a <strong>crystal lattice</strong>. Each silicon atom bonds with its neighbours by <strong>sharing</strong> its four valence electrons — a <strong>covalent bond</strong>. These bonds let electrons move only in a controlled way, which allows precise control over electric currents.');
          ui.term('lattice', s2);
          ui.term('covalent', s2);

          const s3 = EM.section(el, 'Electrons and holes');
          EM.p(s3, 'At room temperature some valence electrons have enough <strong>thermal energy</strong> to break their covalent bond. They are then free to wander from atom to atom: they are <strong>conduction electrons</strong>. Each one leaves behind a <strong>positive hole</strong>.');
          EM.p(s3, 'A valence electron from a neighbouring atom can move into this hole, producing another hole where it came from, and so on. In this way the hole moves through the crystal. <strong>This is how conduction occurs in semiconductors.</strong>');
          ui.term('conduction-electron', s3);
          ui.term('hole', s3);
          const hp = EM.simPanel(s3, 'How a hole moves', 'Step through: watch which way the electrons hop and which way the hole moves.');
          const hs = holeStepSim(hp);
          let prev = 0;
          EM.stepper(
            hp,
            [
              { title: 'All bonds complete', html: 'Very cold silicon: every valence electron (orange) is held in a covalent bond. There are no free carriers, so it cannot conduct.' },
              { title: 'Heat breaks a bond', html: 'An electron gains enough thermal energy to break free. It becomes a <strong>conduction electron</strong> and leaves a <strong>positive hole</strong> behind.' },
              { title: 'A neighbour fills the hole', html: 'A valence electron from the neighbouring bond moves into the hole… so the hole is now one place to the left.' },
              { title: '…and again', html: 'Another valence electron moves into the new hole. The hole keeps moving.' },
              { title: 'The hole acts like a + charge', html: 'Valence electrons moved <strong>right</strong>; the hole moved <strong>left</strong>. A moving hole behaves exactly like a positive charge carrier.' },
            ],
            (i) => {
              hs.go(i, prev);
              prev = i;
            }
          );
          const lp = EM.simPanel(s3, 'Pure silicon lattice', 'Each blue Si atom shares electrons with 4 neighbours (the lattice wraps round at the edges). Raise the temperature to break bonds; apply a p.d. to make the carriers drift.');
          latticeSim(lp, { doping: false });
          EM.p(s3, 'In pure silicon every broken bond makes <strong>one</strong> conduction electron <strong>and one</strong> hole, so there are always equal numbers of each.');
          ui.term('intrinsic', s3);
        },
      },
      /* ---------------------------------------------------------------- 3 */
      {
        id: 'doping',
        title: 'Doping: n-type and p-type',
        summary: 'Adding phosphorus gives extra free electrons (n-type); adding boron gives extra holes (p-type).',
        keywords: 'doping impurity phosphorus boron n-type p-type majority minority charge carriers extrinsic intrinsic conduction donor',
        render(el, ui) {
          const s1 = EM.section(el, 'Doping');
          ui.term('doping', s1);
          EM.cards(
            s1,
            [
              { icon: '🟡', title: 'Phosphorus → n-type', html: 'Phosphorus atoms have <strong>5</strong> electrons in their outer shell; silicon has only 4. Four bond with silicon neighbours, so there is <strong>1 free electron</strong> for conduction.' },
              { icon: '🟢', title: 'Boron → p-type', html: 'Boron atoms have <strong>3</strong> electrons in their outer shell; silicon has 4. One bond is missing an electron, so there is an <strong>extra positive hole</strong> for conduction.' },
            ],
            { cols: 2 }
          );
          ui.term('n-type', s1);
          ui.term('p-type', s1);
          const sp = EM.simPanel(s1, 'Dope the lattice', 'Switch between pure silicon, phosphorus doping and boron doping. Count the carriers in the readout below.');
          latticeSim(sp, { doping: true, initial: 'n' });

          const s2 = EM.section(el, 'Majority and minority carriers');
          EM.add(s2, 'table', {
            class: 'data-table',
            html: '<tr><th>Type</th><th>Impurity</th><th>Majority carriers</th><th>Minority carriers</th></tr><tr><td><strong>P-type</strong> (positive type)</td><td>Boron (3 outer electrons)</td><td>Holes</td><td>Electrons</td></tr><tr><td><strong>N-type</strong> (negative type)</td><td>Phosphorus (5 outer electrons)</td><td>Electrons</td><td>Holes</td></tr>',
          });
          ui.term('majority', s2);
          EM.callout(s2, 'tip', 'The minority carriers come from bonds broken by heat, exactly as in pure silicon. Doping only adds lots of <strong>one</strong> kind of carrier.', 'Where do minority carriers come from?');
          EM.callout(s2, 'warn', 'n-type and p-type material are both electrically <strong>neutral</strong> overall: each free electron in n-type is balanced by a positive phosphorus ion. “n” and “p” describe the <strong>carriers</strong>, not a net charge.', 'Going further');

          const s3 = EM.section(el, 'Intrinsic vs extrinsic conduction');
          ui.term('intrinsic', s3);
          ui.term('extrinsic', s3);
        },
      },
      /* ---------------------------------------------------------------- 4 */
      {
        id: 'pn-junction',
        title: 'The p–n junction',
        summary: 'Electrons diffuse across a p–n junction, creating ions, a depletion region and a junction voltage.',
        keywords: 'p-n junction pn diffusion recombine holes ions space charge depletion region layer insulator junction voltage forward bias',
        render(el, ui) {
          const s1 = EM.section(el, 'Joining p-type and n-type');
          ui.term('pn-junction', s1);
          EM.p(s1, 'A basic p-n junction creates a <strong>diode</strong> that allows current to flow in one direction only.');
          EM.p(s1, 'In the p-type region there are extra holes; in the n-type region there are extra electrons. When the junction is formed:');
          EM.list(
            s1,
            [
              'some electrons from the n-region <strong>diffuse</strong> across the junction and <strong>combine with holes</strong>;',
              'filling a hole makes a <strong>negative ion on the p-side</strong> and leaves behind a <strong>positive ion on the n-side</strong>;',
              'a <strong>space charge</strong> builds up, creating a <strong>depletion region</strong> (which acts as an insulator);',
              'the depletion region stops any further electron transfer — unless it is helped by putting a <strong>forward bias</strong> on the junction;',
              'the depletion layer causes a potential difference across the junction: its <strong>junction voltage</strong>.',
            ],
            { ordered: true }
          );
          const sp = EM.simPanel(s1, 'Watch a depletion region form', 'Press the button to join the two pieces. Electrons near the junction cross over and fill holes.');
          pnFormationSim(sp);
          ui.term('depletion', s1);
          ui.term('junction-voltage', s1);
          EM.callout(s1, 'tip', 'For silicon the junction voltage is roughly 0.6–0.7 V. That is why a forward-biased silicon diode needs about 0.6 V before it conducts (next topic).', 'Going further');
        },
      },
      /* ---------------------------------------------------------------- 5 */
      {
        id: 'diodes',
        title: 'Diodes: AC to DC, forward and reverse bias',
        summary: 'A diode lets current flow one way only; it conducts when forward biased (≈0.6 V) and blocks when reverse biased.',
        keywords: 'diode one direction AC DC rectifier battery digital logic water valve check valve symbol forward bias reverse bias 0.6 V Coulomb barrier bulb',
        render(el, ui) {
          const s1 = EM.section(el, 'Diodes');
          ui.term('diode', s1);
          EM.p(s1, 'We get <strong>alternating current (AC)</strong> from the mains supply, but our electronic devices need <strong>direct current (DC)</strong>. <strong>A diode will convert AC to DC.</strong> Devices need DC because:');
          EM.list(s1, [
            'phones, iPads and laptops all have batteries — you <strong>can’t store AC</strong> in a battery, only DC;',
            'modern electronics are built on semiconductors (transistors and diodes) that act as switches, allowing current in only one direction — they cannot work properly with the <strong>fluctuating polarity</strong> of AC;',
            'digital electronics and integrated circuits need a <strong>constant voltage level</strong> to tell binary logic levels (0 and 1) apart; AC drops to zero every cycle, which would reset and disrupt them.',
          ]);
          const rp = EM.simPanel(s1, 'A diode converting AC to DC', 'The marker shows the present moment. The diode only conducts when its p side is positive, so the load gets current in one direction only.');
          rectifierSim(rp);
          EM.callout(s1, 'tip', 'One diode gives “half-wave” DC: it flows one way but in bursts. Real chargers use several diodes plus a capacitor to give a smooth, steady DC.', 'Going further');

          const s2 = EM.section(el, 'The water-valve analogy and the symbol');
          EM.p(s2, 'A diode is like a <strong>water (check) valve</strong> for electric current: it lets water flow in one direction only, making sure there is no back-flow. In the circuit symbol the triangle points in the direction conventional current is allowed to flow, from the + (p) side to the − (n) side.');
          const vp = EM.simPanel(s2, 'Check valve vs diode', 'Push the water each way.');
          valveSim(vp);

          const s3 = EM.section(el, 'Forward bias and reverse bias');
          ui.term('forward-bias', s3);
          EM.p(s3, 'An applied voltage of approximately <strong>0.6 V</strong> is needed in a forward-biased circuit to help electrons overcome the <strong>Coulomb barrier of repulsion</strong> in the depletion region. After that, electrons flow with very small resistance in the forward direction — a bulb in series <strong>will</strong> light (+ to + and − to −).');
          ui.term('reverse-bias', s3);
          EM.p(s3, 'A reverse voltage drives the electrons <strong>away</strong> from the junction, preventing conduction by <strong>widening the depletion layer</strong>. A bulb in series will <strong>not</strong> light (+ to − and − to +).');
          ui.experiment('diode-bias', el);
        },
      },
      /* ---------------------------------------------------------------- 6 */
      {
        id: 'transistors',
        title: 'Transistors (NPN)',
        summary: 'Three-layer n-p-n devices in which a small base current controls a large collector current.',
        keywords: 'transistor switch amplifier BJT FET NPN PNP emitter base collector Bell Labs 1947 Bardeen Brattain Shockley vacuum tubes billion smartphone back to back diodes 0.7 V elevator analogy',
        render(el, ui) {
          const s1 = EM.section(el, 'What is a transistor?');
          ui.term('transistor', s1);
          EM.p(s1, 'Transistors are the <strong>building blocks of modern electronics</strong> used to process data. They use p-type and n-type semiconductor materials, doped to control the flow of charge carriers. A modern smartphone contains <strong>10 to 16 billion transistors</strong> in its main processor, packed onto a chip the size of a fingernail.');
          EM.callout(s1, 'history', 'The transistor was invented in <strong>1947 at Bell Labs, New Jersey</strong>, by <strong>John Bardeen, Walter Brattain and William Shockley</strong>. Transistors replaced inefficient vacuum tubes.');
          EM.p(s1, 'These three-terminal devices come in two main types: <strong>Bipolar Junction Transistors (BJTs)</strong> and <strong>Field-Effect Transistors (FETs)</strong>. There are two types of BJT:');
          EM.list(s1, ['<strong>NPN</strong>: n-type emitter, p-type base, n-type collector;', '<strong>PNP</strong>: p-type emitter, n-type base, p-type collector.']);
          EM.callout(s1, 'note', 'For this course we focus on the operation of the <strong>NPN BJT</strong> only.');

          const s2 = EM.section(el, 'Symbol and structure');
          EM.add(s2, 'table', { class: 'data-table', html: '<tr><th>Terminal</th><th>Current</th></tr><tr><td>C = Collector</td><td>I<sub>C</sub> = collector current</td></tr><tr><td>B = Base</td><td>I<sub>B</sub> = base current</td></tr><tr><td>E = Emitter</td><td>I<sub>E</sub> = emitter current</td></tr>' });
          const sp = EM.simPanel(s2, 'NPN symbol and layers', 'The dot density shows how heavily each layer is doped.');
          structureSim(sp);
          ui.term('emitter', s2);
          ui.term('base', s2);
          ui.term('collector', s2);

          const s3 = EM.section(el, 'Two diodes back to back');
          EM.p(s3, 'A transistor is essentially <strong>two diodes sandwiched back to back</strong>: an n-p junction and a p-n junction. Connect one supply across the ends: with + on the left n region, the left (n-p) junction is reverse biased while the right (p-n) junction is forward biased. Swap the connections and the left becomes forward biased but the right becomes reverse biased.');
          EM.callout(s3, 'key', 'Whichever way you connect a single supply, <strong>one junction is always reverse biased</strong> and its depletion layer is too large — the transistor stays <strong>off</strong>.');
          EM.p(s3, 'Now connect a <strong>2nd power supply</strong> between the emitter and the base, forward biased (+ to + (p) and − to − (n)), with enough voltage — <strong>greater than 0.7 V</strong> — to overcome the Coulomb barrier of repulsion:');
          EM.list(s3, [
            'a large number of electrons are emitted from the n-region (<strong>emitter</strong>) into the p-region (<strong>base</strong>);',
            'some combine with holes in the base and <strong>a few flow out of the base</strong> towards the + terminal of the 2nd supply;',
            'because the base is <strong>very thin</strong> and its depletion layer has been reduced, <strong>the remaining electrons are attracted to the + terminal of the first supply</strong> through the collector.',
          ]);
          const np = EM.simPanel(s3, 'Electron flow in an NPN transistor', 'Try one supply each way round, then add the base supply and raise V<sub>BE</sub> past 0.7 V.');
          npnSim(np);
          EM.callout(s3, 'key', 'A <strong>small</strong> current from the emitter to the base switches the transistor <strong>on</strong> and allows a <strong>large</strong> current to flow from the emitter to the collector — so it can be used as an <strong>amplifier</strong>.');
          EM.callout(s3, 'real', 'You walk up to the heavy automatic door of an elevator. You don’t push the door open; you press a <strong>tiny button</strong> (the base). The button activates the door motor, which opens the heavy door. The button isn’t supplying the energy to open the door — the power supply is — but if you don’t press the button, nothing happens.', 'Analogy: the elevator button');
        },
      },
      /* ---------------------------------------------------------------- 7 */
      {
        id: 'switch',
        title: 'The transistor as a switch',
        summary: 'I<sub>B</sub> = 0 means I<sub>C</sub> = 0; with V<sub>BE</sub> ≈ 0.7 V a small I<sub>B</sub> switches on a large I<sub>C</sub>.',
        keywords: 'transistor switch S1 S2 base current collector current emitter current 0.7 V proportional gain beta conventional current electron flow base resistor',
        render(el, ui) {
          const s1 = EM.section(el, 'Conventional current vs electron flow');
          EM.callout(s1, 'note', 'In the explanation of how a transistor works, the current was taken the correct way: <strong>electrons flow from − to +</strong>. In circuit diagrams, textbooks and <strong>the exam</strong>, <strong>conventional current</strong> is used, i.e. from <strong>+ to −</strong>. The arrow on the transistor symbol’s emitter shows conventional current.');

          const s2 = EM.section(el, 'The switching circuit');
          EM.p(s2, 'The base circuit (left battery, resistor, switch S1) and the collector circuit (right battery, switch S2) share the emitter. Both currents leave through the emitter.');
          EM.list(s2, [
            'With <strong>S1 open</strong> and S2 closed, no current flows in either path. The collector current is zero if the base current is zero, <strong>even if there is a large voltage between the collector and the emitter</strong>: I<sub>B</sub> = 0 ⇒ I<sub>C</sub> = 0.',
            'When <strong>S1 is closed</strong> and the voltage between the base and the emitter is about <strong>0.7 V</strong>, a small current I<sub>B</sub> flows through the base. When the base current flows, the collector current also flows, provided S2 is closed.',
            'I<sub>C</sub> is typically between <strong>10 and 1,000 times bigger</strong> than I<sub>B</sub>.',
            'I<sub>C</sub> is <strong>directly proportional</strong> to I<sub>B</sub>.',
          ]);
          EM.callout(s2, 'note', 'A <strong>resistor is always connected in series with the base</strong> of a transistor.');
          EM.callout(s2, 'tip', 'Without it, once the base–emitter p.d. passes about 0.7 V the base current would rise enormously and could destroy the transistor; the resistor limits I<sub>B</sub>.', 'Going further: why the base resistor?');
          ui.experiment('transistor-switch', el);
          const s3 = EM.section(el, 'Formulas');
          ui.formula('gain', s3);
          ui.formula('emitter-current', s3);
        },
      },
      /* ---------------------------------------------------------------- 8 */
      {
        id: 'sensors',
        title: 'Light- and temperature-controlled switches',
        summary: 'An LDR or thermistor in a potential divider turns the transistor on in the dark, in brightness, when hot or when cold.',
        keywords: 'light controlled switch LDR light dependent resistor dark brightness street lights garden lights thermistor temperature controlled switch car temperature gauge incubator frost warning oven fridge battery charging potential divider',
        render(el, ui) {
          const s1 = EM.section(el, 'Transistor as a light-controlled switch');
          EM.p(s1, 'A fixed resistor R and an <strong>LDR</strong> form a potential divider across the supply. The p.d. across the <strong>lower arm</strong> is applied (through a base resistor) between the base and the emitter, so it decides whether the transistor — and the lamp in its collector circuit — is on.');
          ui.term('ldr', s1);
          EM.cards(
            s1,
            [
              {
                title: '(A) The bulb comes on in the dark',
                html: 'R on top, LDR below.<ul class="nice-list"><li>When it is dark, the LDR’s resistance <strong>increases</strong>, so the p.d. across the LDR also increases.</li><li>So the p.d. across R decreases.</li><li>With only a small p.d. across R, there is a large enough base current to turn on the transistor and the lamp in the dark.</li></ul><strong>Application:</strong> outdoor solar-powered garden lights that turn on automatically when it gets dark; turning on street lights at night.',
              },
              {
                title: '(B) The bulb comes on in brightness',
                html: 'LDR on top, R below.<ul class="nice-list"><li>When it is bright, the LDR’s resistance <strong>decreases</strong>, so the p.d. across the LDR also decreases.</li><li>So the p.d. across R increases.</li><li>With only a small p.d. across the LDR, there is a large enough base current to turn on the transistor and the lamp in bright light.</li></ul><strong>Application:</strong> turning off street lights during the day time (the transistor can drive a switch that cuts the lights).',
              },
            ],
            { cols: 2 }
          );
          ui.experiment('light-switch', el);

          const s2 = EM.section(el, 'Thermistors');
          ui.term('thermistor', s2);
          EM.p(s2, 'Thermistors are usually made of copper, nickel or cobalt. Uses include:');
          EM.list(s2, ['ovens and fridges, to manage heating and cooling cycles;', 'battery-charging systems in phones and iPads, to make sure the battery doesn’t overheat.']);
          EM.callout(s2, 'tip', 'Strictly, thermistors are made from <strong>oxides</strong> of metals such as manganese, nickel, cobalt and copper — these oxides behave as semiconductors, which is why heating frees more carriers and the resistance falls.', 'Going further');

          const s3 = EM.section(el, 'Transistor as a temperature-controlled switch');
          EM.cards(
            s3,
            [
              {
                title: '(A) A rise in temperature lights the bulb',
                html: 'Thermistor on top, R below.<ul class="nice-list"><li>As the temperature increases, the thermistor’s resistance <strong>decreases</strong>, so the p.d. across it decreases.</li><li>So the p.d. across R increases.</li><li>With only a small p.d. across the thermistor, there is a large enough base current to turn on the transistor and the lamp when it is hot.</li></ul><strong>Application:</strong> a car temperature gauge — a dashboard warning light comes on if the engine’s coolant gets too hot.',
              },
              {
                title: '(B) A fall in temperature lights the bulb',
                html: 'R on top, thermistor below.<ul class="nice-list"><li>As the temperature decreases, the thermistor’s resistance <strong>increases</strong>, so the p.d. across it increases.</li><li>So the p.d. across R decreases.</li><li>With only a small p.d. across R, there is a large enough base current to turn on the transistor and the lamp when it is cold.</li></ul><strong>Applications:</strong> incubator heaters (switch on a heating element when an animal’s environment drops below a safe temperature); frost warning systems (light a bulb when greenhouse or outdoor temperatures drop near freezing — protecting plants or warning drivers of icy roads).',
              },
            ],
            { cols: 2 }
          );
          const tp = EM.simPanel(s3, 'Temperature-controlled switch', 'Change the temperature, try both circuits, and adjust R to set the switching temperature.');
          sensorSim(tp, 'therm');
          EM.callout(s3, 'tip', 'In real circuits R is often a <strong>variable resistor</strong>, so you can set the exact light level or temperature at which the lamp switches.', 'Going further');
        },
      },
      /* ---------------------------------------------------------------- 9 */
      {
        id: 'maths',
        title: 'The maths: why an LDR switches the transistor on',
        summary: 'A worked potential-divider calculation: 12 V across 10 kΩ and a 1 MΩ LDR leaves 11.881 V across the base–emitter arm.',
        keywords: 'potential divider calculation worked example 12 V 10000 ohm 1000000 ohm LDR total resistance current 0.119 V 11.881 V base emitter',
        render(el, ui) {
          const s1 = EM.section(el, 'Worked example from the notes');
          EM.p(s1, 'Why can an LDR turn on a light in the darkness? Take circuit (A): R on top, the LDR in the base–emitter arm. Let the p.d. applied to the divider be <strong>12 V</strong>, the fixed resistor <strong>R = 10,000 Ω</strong> and the LDR (in the dark) <strong>1,000,000 Ω</strong>.');
          EM.stepper(s1, [
            { title: 'Total resistance', html: 'R and the LDR are in series, so R<sub>T</sub> = 10,000 Ω + 1,000,000 Ω = <strong>1,010,000 Ω</strong>.' },
            { title: 'Current', html: 'I = V ÷ R = 12 ÷ 1,010,000 = <strong>0.0000119 A</strong> (the notes round this down to 0.000011 A).' },
            { title: 'p.d. across R', html: 'V = I × R = 0.0000119 × 10,000 = <strong>0.119 V</strong>.' },
            { title: 'p.d. across the LDR', html: 'V = I × R = 0.0000119 × 1,000,000 = <strong>11.881 V</strong>. (Check: 0.119 + 11.881 = 12 V.)' },
            { title: 'Conclusion', html: 'Only 0.119 V is dropped across R. There is <strong>11.881 V</strong> across the base–emitter arm — plenty to let a base current flow, which <strong>turns on the transistor</strong>.' },
          ]);
          const sp = EM.simPanel(s1, 'Potential-divider explorer', 'Change the supply, R and the LDR resistance. Load the notes’ example to check the numbers.');
          dividerSim(sp);
          EM.callout(s1, 'tip', 'In the real circuit the base–emitter junction itself only needs (and holds at) about <strong>0.7 V</strong>. Once the transistor turns on, the base current pulls the divider’s output down to ≈0.7 V, and the rest of the p.d. is dropped across R and the base resistor. The divider calculation tells you <strong>whether</strong> the base can reach 0.7 V — if it can, the transistor switches on.', 'Going further');

          const s2 = EM.section(el, 'Formulas used');
          ui.formula('series', s2);
          ui.formula('ohm', s2);
          ui.formula('divider', s2);
        },
      },
    ],

    quiz: [
      { q: 'Which is the definition of a semiconductor?', options: ['A solid with conductivity between that of an insulator and a good conductor', 'A metal with 1–3 valence electrons', 'A material that conducts only in one direction', 'A liquid that conducts when heated'], answer: 0, explain: 'A semiconductor is a solid substance with conductivity between that of an insulator and that of a good conductor.' },
      { q: 'Why is silicon the most common semiconductor material?', options: ['It is abundant (28% of the Earth’s crust) and stable', 'It is a metal with free electrons', 'It has 5 valence electrons', 'It is the only element that can be doped'], answer: 0, explain: 'Silicon is abundant, stable and has a high heat resistance.' },
      { q: 'How many valence electrons does a silicon atom have?', options: ['4', '1', '3', '5'], answer: 0, explain: 'Silicon has 4 outer electrons, each shared in a covalent bond with one of 4 neighbours.' },
      { q: 'At room temperature a covalent bond in silicon breaks. What is produced?', options: ['A conduction electron and a positive hole', 'Two positive holes', 'A positive ion and a negative ion', 'A proton and an electron'], answer: 0, explain: 'The freed electron becomes a conduction electron and leaves a positive hole behind.' },
      { q: 'A hole moves to the left through a silicon crystal. Which way did the valence electrons hop?', options: ['To the right', 'To the left', 'Up and down only', 'They did not move'], answer: 0, explain: 'Each hop of an electron into the hole moves the hole the opposite way.' },
      { q: 'Doping is…', options: ['adding small amounts of certain impurities to a pure semiconductor to increase its conductivity', 'heating a semiconductor to free electrons', 'joining p-type and n-type material', 'coating a semiconductor with metal'], answer: 0, explain: 'That is the definition given in the notes.' },
      { q: 'Phosphorus (5 outer electrons) is added to silicon. What type of semiconductor is made?', options: ['N-type, with extra free electrons', 'P-type, with extra holes', 'Intrinsic', 'An insulator'], answer: 0, explain: 'Four of phosphorus’s electrons bond; the fifth is free. Extra electrons → n-type.' },
      { q: 'What are the majority charge carriers in a p-type semiconductor?', options: ['Holes', 'Electrons', 'Positive ions', 'Protons'], answer: 0, explain: 'In p-type the holes are the majority carriers and electrons are the minority carriers.' },
      { q: 'Extrinsic conduction is the movement of charges through…', options: ['a doped semiconductor', 'a pure semiconductor', 'a metal', 'a vacuum'], answer: 0, explain: 'Extrinsic = doped; intrinsic = pure.' },
      { q: 'What is found in the depletion region of a p–n junction?', options: ['Negative ions on the p-side and positive ions on the n-side, with no free carriers', 'Lots of free electrons', 'Lots of free holes', 'A thin layer of metal'], answer: 0, explain: 'Electrons filling holes create fixed ions; the region has no free carriers so it acts as an insulator.' },
      { q: 'A diode is forward biased when…', options: ['the p-type region is connected to the + terminal and the n-type to the − terminal', 'the n-type region is connected to the + terminal', 'both regions are connected to the + terminal', 'it is connected to AC'], answer: 0, explain: 'Forward bias: p to +, n to − (“+ to + and − to −”).' },
      { q: 'About what p.d. must be applied to a forward-biased silicon diode before current flows?', options: ['0.6 V', '0.06 V', '6 V', '60 V'], answer: 0, explain: 'About 0.6 V is needed to overcome the Coulomb barrier of the depletion region.' },
      { q: 'What happens to the depletion layer when a diode is reverse biased?', options: ['It widens and no current flows', 'It disappears and a large current flows', 'It stays the same and a small current flows', 'It moves into the n-region'], answer: 0, explain: 'The reverse voltage drives carriers away from the junction, widening the depletion layer.' },
      { q: 'Which is a reason our devices need DC rather than AC?', options: ['Batteries can only store DC', 'DC is cheaper to generate at power stations', 'AC cannot travel through copper', 'DC has a higher frequency'], answer: 0, explain: 'You can’t store AC in a battery; also digital logic needs a constant voltage. A diode converts AC to DC.' },
      { q: 'The transistor was invented in 1947 at Bell Labs by…', options: ['Bardeen, Brattain and Shockley', 'Faraday, Ampère and Ohm', 'Edison, Tesla and Bell', 'Maxwell, Hertz and Volta'], answer: 0, explain: 'John Bardeen, Walter Brattain and William Shockley — transistors replaced vacuum tubes.' },
      { q: 'In an NPN transistor, the emitter is…', options: ['heavily n-type doped and supplies the electrons', 'lightly p-type doped and very thin', 'moderately n-type doped and collects electrons', 'undoped silicon'], answer: 0, explain: 'Emitter: heavily n-doped; base: thin, lightly p-doped; collector: moderately n-doped.' },
      { q: 'In the transistor switch circuit, S1 (base circuit) is open and S2 is closed. What is I<sub>C</sub>?', options: ['Zero', 'Equal to the supply current', '10 times I<sub>B</sub>', 'Very large'], answer: 0, explain: 'I<sub>B</sub> = 0 ⇒ I<sub>C</sub> = 0, even with a large collector–emitter voltage.' },
      { q: 'A transistor has I<sub>B</sub> = 0.1 mA and a current gain of 200. What is I<sub>C</sub>?', options: ['20 mA', '2 mA', '0.5 mA', '200 mA'], answer: 0, explain: 'I<sub>C</sub> = β I<sub>B</sub> = 200 × 0.1 mA = 20 mA.' },
      { q: 'In circuit (A) (R on top, LDR below), why does the lamp come on in the dark?', options: ['The LDR’s resistance rises, so the p.d. across it (base–emitter) rises above 0.7 V', 'The LDR’s resistance falls, so more current flows through it', 'The fixed resistor’s resistance rises in the dark', 'Light stops reaching the transistor'], answer: 0, explain: 'Dark → LDR resistance up → bigger share of the p.d. across the LDR → base current flows → transistor on.' },
      { q: '12 V is applied across R = 10,000 Ω in series with an LDR of 1,000,000 Ω. What is the p.d. across the LDR?', options: ['11.881 V', '0.119 V', '6 V', '12 V'], answer: 0, explain: 'I = 12 ÷ 1,010,000 = 1.19 × 10⁻⁵ A, so V = I × 1,000,000 = 11.881 V.' },
    ],
  });
})();
