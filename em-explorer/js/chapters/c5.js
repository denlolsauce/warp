/* C.5 Electromagnetism — magnets, fields of currents, electromagnets, the motor effect, charges in fields,
   Earth's field, the DC motor and magnetic flux. */
(function () {
  'use strict';
  const { h, add, draw, colors } = EM;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ local helpers */

  function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  /** Slightly under-damped compass needle: n = {a, w}. */
  function needleStep(n, target, dt, stiff = 70, damp = 9) {
    if (target == null) {
      n.w *= Math.max(0, 1 - damp * dt);
      n.a += n.w * dt;
      return;
    }
    n.w += (angDiff(n.a, target) * stiff - n.w * damp) * dt;
    n.a += n.w * dt;
  }
  /** 2D field of long straight wires (screen coords). wires: [{x,y,I}], I > 0 = current OUT of the page. */
  function wireField(wires, x, y, soft = 30) {
    let bx = 0,
      by = 0;
    for (const w of wires) {
      const dx = x - w.x,
        dy = y - w.y;
      const r2 = dx * dx + dy * dy + soft;
      bx += (w.I * dy) / r2;
      by += (-w.I * dx) / r2;
    }
    return [bx, by];
  }
  /** Trace one field line through field B(x,y)→[bx,by]. Returns {points, closed, exit}. */
  function traceLine(B, x0, y0, o = {}) {
    const step = o.step || 3,
      max = o.maxSteps || 2000,
      b = o.bounds,
      sg = o.sign || 1;
    const pts = [[x0, y0]];
    let x = x0,
      y = y0,
      closed = false,
      exit = false;
    for (let i = 0; i < max; i++) {
      let [bx, by] = B(x, y);
      let m = Math.hypot(bx, by);
      if (!m) break;
      const mx = x + (sg * step * bx) / m / 2,
        my = y + (sg * step * by) / m / 2;
      [bx, by] = B(mx, my);
      m = Math.hypot(bx, by);
      if (!m) break;
      x += (sg * step * bx) / m;
      y += (sg * step * by) / m;
      pts.push([x, y]);
      if (b && (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1)) {
        exit = true;
        break;
      }
      if (o.stop && o.stop(x, y)) break;
      if (o.closeCheck && i > 40 && Math.hypot(x - x0, y - y0) < step * 1.3) {
        closed = true;
        pts.push([x0, y0]);
        break;
      }
    }
    return { points: pts, closed, exit };
  }
  /** Closed loop (or open line if it leaves the bounds) through a seed point, oriented along +B. */
  function traceLoop(B, x0, y0, o) {
    const f = traceLine(B, x0, y0, Object.assign({}, o, { closeCheck: true }));
    if (f.closed) return { points: f.points, dir: 1 };
    const bk = traceLine(B, x0, y0, Object.assign({}, o, { sign: -1, closeCheck: false }));
    return { points: bk.points.reverse().concat(f.points.slice(1)), dir: 1 };
  }
  /** Current symbol: dir > 0 → out of the page (•), dir < 0 → into the page (×). */
  function curSym(ctx, x, y, dir, r = 9, color = colors.current) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    if (dir > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, TAU);
      ctx.fill();
    } else if (dir < 0) {
      const s = r * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    }
    ctx.restore();
  }
  function poly(ctx, pts, color, width = 2, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.restore();
  }
  function rect(ctx, x, y, w, hh, fill, stroke, r = 4) {
    ctx.save();
    draw.roundRect(ctx, x, y, w, hh, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
  /** Small arrowhead on an ellipse arc to show circulation. */
  function ellipseArrow(ctx, cx, cy, rx, ry, ang, cw, color) {
    const x = cx + rx * Math.cos(ang),
      y = cy + ry * Math.sin(ang);
    const s = cw ? 1 : -1;
    const tx = -rx * Math.sin(ang) * s,
      ty = ry * Math.cos(ang) * s;
    const m = Math.hypot(tx, ty) || 1;
    draw.arrow(ctx, x - (tx / m) * 6, y - (ty / m) * 6, x + (tx / m) * 6, y + (ty / m) * 6, { color, width: 2, head: 8 });
  }
  /** Seeded pseudo-random numbers so textures look the same every visit. */
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const fmtT = (x, s = 3) => EM.fmtText(x, s);

  /* ------------------------------------------------------------------ terms */

  const terms = [
    { id: 'permanent-magnet', term: 'Permanent magnet', def: 'A piece of iron, nickel or cobalt that is magnetised and creates its own magnetic field. It can attract other pieces of the same metal.' },
    { id: 'lodestone', term: 'Lodestone', def: 'A naturally magnetised piece of the mineral magnetite — a naturally-occurring magnet. (All other magnets in everyday use are manmade.)' },
    { id: 'magnetic-field', term: 'Magnetic field', def: 'The space around a magnet where a magnetic force has an effect.' },
    { id: 'field-line', term: 'Magnetic field line', def: 'The path along which a north pole would move if it were free to do so.' },
    { id: 'flux-density', term: 'Magnetic flux density (B)', def: 'A measurement of the strength and direction of the magnetic field at a specific point in space. It tells you how concentrated the field lines are. Unit: the tesla (T).' },
    { id: 'tesla', term: 'Tesla (T)', def: 'The unit of magnetic flux density B.' },
    { id: 'solenoid', term: 'Solenoid', def: 'A long coil of wire wrapped in many turns. When a current passes through it, it creates a uniform magnetic field inside.' },
    { id: 'electromagnet', term: 'Electromagnet', def: 'A type of magnet whose magnetic field is generated and sustained by an electric current. It typically consists of a coil of wire wrapped around a ferromagnetic core (like iron); the field disappears as soon as the current is switched off.' },
    { id: 'ferromagnetic', term: 'Ferromagnetic metals', def: 'Metals that are strongly attracted by magnets and can be magnetised: iron, nickel, cobalt and steel. An electromagnet will only attract ferromagnetic metals.' },
    { id: 'rh-grip-wire', term: 'Right-hand grip rule (straight wire)', def: 'Grip the wire with your right hand with the thumb pointing in the direction of the current: your fingers curl in the direction of the magnetic field.' },
    { id: 'rh-grip-solenoid', term: 'Right-hand grip rule (solenoid)', def: 'Grip the solenoid with your right hand so that your fingers curl in the direction of the current in the turns: your thumb points to the north pole of the solenoid.' },
    { id: 'flhr', term: 'Fleming’s left-hand rule', def: 'Hold the thumb, first finger and second finger of the LEFT hand at right angles. <strong>F</strong>irst finger = <strong>F</strong>ield, se<strong>C</strong>ond finger = <strong>C</strong>urrent, thu<strong>M</strong>b = <strong>M</strong>otion (force).' },
    { id: 'magnetic-flux', term: 'Magnetic flux (Φ)', def: 'The total amount of magnetic field passing through a given area. Φ = BA cos θ. Unit: the weber (Wb).' },
    { id: 'weber', term: 'Weber (Wb)', def: 'The SI unit of magnetic flux Φ (1 Wb = 1 T m²).' },
    { id: 'magnetosphere', term: 'Magnetosphere', def: 'The region of space dominated by Earth’s magnetic field: about 60 000–65 000 km on the sunlit side and stretched into a magnetotail over 6 million km long on the night side. Its exact reach fluctuates.' },
    { id: 'aurora', term: 'Aurora (borealis / australis)', def: 'Light in the sky near the poles: charged particles from the Sun are deflected towards the poles by Earth’s field, excite electrons in atoms of the upper atmosphere, and light is emitted when the electrons drop back to lower energy levels. Northern lights = aurora borealis; southern lights = aurora australis.' },
    { id: 'commutator', term: 'Split-ring commutator', def: 'A ring split into two halves, connected to the ends of a motor’s coil and touched by carbon brushes. It reverses the current in the coil every half turn so the coil keeps turning in one direction.' },
  ];

  /* ------------------------------------------------------------------ formulas */

  const formulas = [
    {
      id: 'bil',
      name: 'Force on a current-carrying conductor',
      display: '<var>F</var> = <var>B</var><var>I</var><var>L</var>',
      vars: [
        { sym: 'F', name: 'Force on the conductor', unit: 'N', value: 0.1 },
        { sym: 'B', name: 'Magnetic flux density', unit: 'T', value: 0.5 },
        { sym: 'I', name: 'Current', unit: 'A', value: 2 },
        { sym: 'L', name: 'Length of conductor in the field', unit: 'm', value: 0.1 },
      ],
      solve: {
        F: (v) => v.B * v.I * v.L,
        B: (v) => v.F / (v.I * v.L),
        I: (v) => v.F / (v.B * v.L),
        L: (v) => v.F / (v.B * v.I),
      },
      notes: 'The force depends on 1) the magnetic flux density B, 2) the current I and 3) the length L of conductor in the field. This form applies when the conductor is at right angles to the field (no force if it is parallel to the field). Direction: Fleming’s left-hand rule.',
      example: { q: 'A 10 cm length of wire carrying 2 A sits at right angles to a 0.5 T field. Find the force on it.', a: 'F = BIL = 0.5 × 2 × 0.1 = <strong>0.1 N</strong>' },
      tags: 'motor effect force on a wire BIL',
    },
    {
      id: 'qvb',
      name: 'Force on a moving charge',
      display: '<var>F</var> = <var>q</var><var>v</var><var>B</var>',
      vars: [
        { sym: 'F', name: 'Force on the charge', unit: 'N', value: 9.6e-14 },
        { sym: 'q', name: 'Charge', unit: 'C', value: 1.6e-19 },
        { sym: 'v', name: 'Velocity', unit: 'm s<sup>−1</sup>', value: 3e6 },
        { sym: 'B', name: 'Magnetic flux density', unit: 'T', value: 0.2 },
      ],
      solve: {
        F: (v) => v.q * v.v * v.B,
        q: (v) => v.F / (v.v * v.B),
        v: (v) => v.F / (v.q * v.B),
        B: (v) => v.F / (v.q * v.v),
      },
      notes: 'Use this for the force on a <em>single</em> moving charge (e.g. one electron in the conductor, or a particle in a beam) moving at right angles to the field. The force is perpendicular to both v and B.',
      example: { q: 'An electron (q = 1.6 × 10<sup>−19</sup> C) moves at 3 × 10<sup>6</sup> m s<sup>−1</sup> at right angles to a 0.2 T field. Find the force on it.', a: 'F = qvB = 1.6 × 10<sup>−19</sup> × 3 × 10<sup>6</sup> × 0.2 = <strong>9.6 × 10<sup>−14</sup> N</strong>' },
      tags: 'force on charge electron proton qvB',
    },
    {
      id: 'centripetal',
      name: 'Centripetal force',
      display: `<var>F</var> = ${EM.frac('<var>m</var><var>v</var><sup>2</sup>', '<var>r</var>')}`,
      vars: [
        { sym: 'F', name: 'Centripetal force (towards the centre)', unit: 'N', value: 9.6e-14 },
        { sym: 'm', name: 'Mass', unit: 'kg', value: 9.11e-31 },
        { sym: 'v', name: 'Speed', unit: 'm s<sup>−1</sup>', value: 3e6 },
        { sym: 'r', name: 'Radius of the circular path', unit: 'm', value: 8.54e-5 },
      ],
      solve: {
        F: (v) => (v.m * v.v * v.v) / v.r,
        m: (v) => (v.F * v.r) / (v.v * v.v),
        v: (v) => Math.sqrt((v.F * v.r) / v.m),
        r: (v) => (v.m * v.v * v.v) / v.F,
      },
      notes: 'Any object moving in a circle needs a force towards the centre of size mv²/r. For a charge in a magnetic field, the magnetic force qvB <em>is</em> the centripetal force.',
      example: { q: 'An electron (m = 9.11 × 10<sup>−31</sup> kg) moves at 3 × 10<sup>6</sup> m s<sup>−1</sup> in a circle of radius 8.54 × 10<sup>−5</sup> m. What centripetal force acts on it?', a: 'F = mv²/r = 9.11 × 10<sup>−31</sup> × (3 × 10<sup>6</sup>)² ÷ 8.54 × 10<sup>−5</sup> = <strong>9.6 × 10<sup>−14</sup> N</strong> — exactly qvB for B = 0.2 T.' },
      tags: 'circular motion centripetal mv2/r',
    },
    {
      id: 'qbmvr',
      name: 'Charged particle moving in a circle in a magnetic field',
      display: `<var>q</var><var>v</var><var>B</var> = ${EM.frac('<var>m</var><var>v</var><sup>2</sup>', '<var>r</var>')} &nbsp;⇒&nbsp; <var>q</var><var>B</var> = ${EM.frac('<var>m</var><var>v</var>', '<var>r</var>')} &nbsp;⇒&nbsp; <var>r</var> = ${EM.frac('<var>m</var><var>v</var>', '<var>q</var><var>B</var>')}`,
      vars: [
        { sym: 'r', name: 'Radius of the circular path', unit: 'm', value: 8.54e-5 },
        { sym: 'm', name: 'Mass of the particle', unit: 'kg', value: 9.11e-31 },
        { sym: 'v', name: 'Speed', unit: 'm s<sup>−1</sup>', value: 3e6 },
        { sym: 'q', name: 'Charge (size)', unit: 'C', value: 1.6e-19 },
        { sym: 'B', name: 'Magnetic flux density', unit: 'T', value: 0.2 },
      ],
      solve: {
        r: (v) => (v.m * v.v) / (v.q * v.B),
        m: (v) => (v.q * v.B * v.r) / v.v,
        v: (v) => (v.q * v.B * v.r) / v.m,
        q: (v) => (v.m * v.v) / (v.B * v.r),
        B: (v) => (v.m * v.v) / (v.q * v.r),
      },
      notes: 'Faster or heavier particles move in bigger circles; a bigger charge or a stronger field gives a tighter circle.',
      derivation: [
        'The magnetic force on the charge is F = qvB.',
        'Because this force is always perpendicular to the velocity, it is a centripetal force: F = mv²/r.',
        'They are both equal to F, so qvB = mv²/r.',
        'Cancel a v on both sides: <strong>qB = mv/r</strong>.',
        'Rearranged for the radius: r = mv/(qB).',
      ],
      example: { q: 'An electron (m = 9.11 × 10<sup>−31</sup> kg, q = 1.6 × 10<sup>−19</sup> C) enters a 0.2 T field at right angles with speed 3 × 10<sup>6</sup> m s<sup>−1</sup>. Find the radius of its path.', a: 'r = mv/(qB) = (9.11 × 10<sup>−31</sup> × 3 × 10<sup>6</sup>) ÷ (1.6 × 10<sup>−19</sup> × 0.2) = <strong>8.54 × 10<sup>−5</sup> m</strong> (about 0.09 mm)' },
      tags: 'radius circular path electron qB = mv/r',
    },
    {
      id: 'flux',
      name: 'Magnetic flux (coil at right angles to the field)',
      display: '<var>Φ</var> = <var>B</var> × <var>A</var>',
      vars: [
        { sym: 'Phi', label: 'Φ', name: 'Magnetic flux (“number of lines of flux”)', unit: 'Wb', value: 0.02 },
        { sym: 'B', name: 'Magnetic flux density', unit: 'T', value: 0.4 },
        { sym: 'A', name: 'Area of the coil', unit: 'm<sup>2</sup>', value: 0.05 },
      ],
      solve: {
        Phi: (v) => v.B * v.A,
        B: (v) => v.Phi / v.A,
        A: (v) => v.Phi / v.B,
      },
      notes: 'Only valid when the coil faces the field squarely — the coil is at 90° to the field lines (its normal is parallel to B). If the coil is at 0° to the field lines (edge-on), Φ = 0.',
      example: { q: 'A coil of area 0.05 m² is at right angles to a 0.4 T field. Find the flux through it.', a: 'Φ = BA = 0.4 × 0.05 = <strong>0.02 Wb</strong>' },
      tags: 'flux weber BA',
    },
    {
      id: 'flux-cos',
      name: 'Magnetic flux at any angle',
      display: '<var>Φ</var> = <var>B</var> × <var>A</var> cos <var>θ</var>',
      vars: [
        { sym: 'Phi', label: 'Φ', name: 'Magnetic flux', unit: 'Wb', value: 0.01 },
        { sym: 'B', name: 'Magnetic flux density', unit: 'T', value: 0.4 },
        { sym: 'A', name: 'Area of the coil', unit: 'm<sup>2</sup>', value: 0.05 },
        { sym: 'theta', label: 'θ', name: 'Angle between the normal A and the field B', unit: '°', value: 60 },
      ],
      solve: {
        Phi: (v) => v.B * v.A * Math.cos(v.theta * DEG),
        B: (v) => v.Phi / (v.A * Math.cos(v.theta * DEG)),
        A: (v) => v.Phi / (v.B * Math.cos(v.theta * DEG)),
        theta: (v) => Math.acos(v.Phi / (v.B * v.A)) / DEG,
      },
      notes: 'θ is measured between the <strong>normal</strong> to the coil (vector A, at 90° to the coil’s surface) and the field B. θ = 0° → cos θ = 1 → maximum flux (Φ = BA). θ = 90° → cos θ = 0 → minimum flux (Φ = 0).',
      derivation: [
        'Draw vector A, the normal: always at 90° to the surface of the coil.',
        'Vector B is the magnetic field, pointing from north to south.',
        'Only the part of B along the normal actually passes through the coil: B cos θ.',
        'So Φ = (B cos θ) × A = <strong>BA cos θ</strong>. Check: θ = 0 gives BA; θ = 90° gives 0.',
      ],
      example: { q: 'The same coil (A = 0.05 m², B = 0.4 T) is turned so that its normal makes 60° with the field. Find the flux.', a: 'Φ = BA cos θ = 0.4 × 0.05 × cos 60° = 0.02 × 0.5 = <strong>0.01 Wb</strong>' },
      tags: 'flux angle cos theta normal',
    },
  ];

  /* ================================================================== sims: magnets */

  /** DEMO: bar magnet under paper with iron filings, field lines, plotting compasses. */
  function simBarMagnet(el) {
    const W = 680,
      H = 400,
      L = 170,
      T = 42;
    const st = { mx: 330, my: 205, a: 0, filings: true, lines: false, ring: false, t: 0, drag: null, off: [0, 0] };
    const probe = { x: 575, y: 92, a: -Math.PI / 2, w: 0 };
    // Everything is computed once in the magnet's own frame (N on the right) and then moved/rotated with it.
    const poles = EM.physics.magnetPoles(0, 0, L, 0, 1, 5, T);
    const Bloc = (x, y) => EM.physics.E(poles, x, y, 20);
    const inMag = (x, y, m = 0) => Math.abs(x) < L / 2 + m && Math.abs(y) < T / 2 + m;
    const R = rng(7);
    const ref = Math.hypot(...Bloc(L / 2 + 60, 0));
    const fil = [];
    for (let i = 0; i < 14000 && fil.length < 2700; i++) {
      const x = (R() * 2 - 1) * 560,
        y = (R() * 2 - 1) * 400;
      if (inMag(x, y, 3)) continue;
      const [bx, by] = Bloc(x, y);
      const p = Math.min(1, 0.07 + 0.93 * Math.pow(Math.hypot(bx, by) / ref, 0.55));
      if (R() > p) continue;
      fil.push({ x, y, t: Math.atan2(by, bx), r: R() * TAU, d: R() * 0.9, len: 4 + R() * 4 });
    }
    const bounds = { x0: -620, y0: -440, x1: 620, y1: 440 };
    const lines = [];
    for (let k = -8; k <= 8; k++) {
      const an = k * 15 * DEG;
      const tr = traceLine(Bloc, L / 2 + 26 * Math.cos(an), 26 * Math.sin(an), { step: 3, maxSteps: 1400, bounds, stop: (x, y) => inMag(x, y) });
      lines.push({ points: tr.points, dir: 1 });
      if (Math.abs(k) <= 3) {
        const tb = traceLine(Bloc, -L / 2 - 26 * Math.cos(an), 26 * Math.sin(an), { step: 3, maxSteps: 1400, bounds, sign: -1, stop: (x, y) => inMag(x, y) });
        if (tb.exit) lines.push({ points: tb.points, dir: -1 });
      }
    }
    const ring = [];
    for (let i = 0; i < 14; i++) {
      const an = (i / 14) * TAU + 0.11;
      ring.push({ lx: (L / 2 + 70) * Math.cos(an), ly: 92 * Math.sin(an), a: -Math.PI / 2, w: 0 });
    }
    const toLocal = (x, y) => {
      const dx = x - st.mx,
        dy = y - st.my,
        c = Math.cos(-st.a),
        s = Math.sin(-st.a);
      return [dx * c - dy * s, dx * s + dy * c];
    };
    const toWorld = (lx, ly) => [st.mx + lx * Math.cos(st.a) - ly * Math.sin(st.a), st.my + lx * Math.sin(st.a) + ly * Math.cos(st.a)];
    const fieldAngleAt = (x, y) => {
      const [lx, ly] = toLocal(x, y);
      const [bx, by] = Bloc(lx, ly);
      return Math.atan2(by, bx) + st.a;
    };

    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Bar magnet under a sheet of paper with iron filings and plotting compasses',
      draw(ctx, s, dt) {
        st.t += dt;
        // paper
        rect(ctx, 14, 12, W - 28, H - 24, '#141d31', 'rgba(148,163,184,0.25)', 8);
        ctx.save();
        draw.roundRect(ctx, 14, 12, W - 28, H - 24, 8);
        ctx.clip();
        ctx.translate(st.mx, st.my);
        ctx.rotate(st.a);
        if (st.lines) draw.fieldLines(ctx, lines, { color: colors.bfield, width: 1.6, arrowEvery: 80, alpha: 0.95 });
        if (st.filings) {
          ctx.strokeStyle = 'rgba(203,213,225,0.82)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (const f of fil) {
            if (st.t < f.d) continue;
            let ang = f.t;
            if (st.t < 1.4) ang = f.r;
            else if (st.t < 2.1) ang = f.r + angDiff(f.r * 2, f.t * 2) / 2 * ((st.t - 1.4) / 0.7);
            const c = (Math.cos(ang) * f.len) / 2,
              sn = (Math.sin(ang) * f.len) / 2;
            ctx.moveTo(f.x - c, f.y - sn);
            ctx.lineTo(f.x + c, f.y + sn);
          }
          ctx.stroke();
        }
        ctx.restore();
        draw.magnet(ctx, st.mx, st.my, L, T, st.a);
        if (st.ring) {
          for (const c of ring) {
            const [x, y] = toWorld(c.lx, c.ly);
            needleStep(c, fieldAngleAt(x, y), dt);
            draw.compass(ctx, x, y, c.a, 13);
          }
        }
        needleStep(probe, fieldAngleAt(probe.x, probe.y), dt);
        draw.compass(ctx, probe.x, probe.y, probe.a, 20);
        draw.text(ctx, 'drag me', probe.x, probe.y + 31, { size: 11, color: colors.muted });
        if (st.t < 2.1 && st.filings) draw.text(ctx, st.t < 1.4 ? 'Sprinkling iron filings…' : 'Tap the paper gently…', W / 2, 32, { size: 13, weight: 700, color: colors.current, bg: 'rgba(11,18,32,0.85)' });
      },
      onDown(p) {
        if (Math.hypot(p.x - probe.x, p.y - probe.y) < 24) {
          st.drag = 'probe';
          return;
        }
        const [lx, ly] = toLocal(p.x, p.y);
        if (inMag(lx, ly, 8)) {
          st.drag = 'magnet';
          st.off = [p.x - st.mx, p.y - st.my];
        }
      },
      onMove(p, s) {
        if (!s.pointer.down || !st.drag) return;
        if (st.drag === 'probe') {
          probe.x = EM.clamp(p.x, 24, W - 24);
          probe.y = EM.clamp(p.y, 24, H - 24);
        } else {
          st.mx = EM.clamp(p.x - st.off[0], 110, W - 110);
          st.my = EM.clamp(p.y - st.off[1], 60, H - 60);
        }
      },
      onUp() {
        st.drag = null;
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Iron filings', value: true, onChange: (v) => (st.filings = v) });
    EM.toggle(c, { label: 'Field lines', value: false, onChange: (v) => (st.lines = v) });
    EM.toggle(c, { label: 'Ring of plotting compasses', value: false, onChange: (v) => (st.ring = v) });
    EM.slider(c, { label: 'Rotate magnet', min: 0, max: 360, step: 1, value: 0, unit: '°', fmt: (v) => v.toFixed(0), onInput: (v) => (st.a = v * DEG) });
    EM.button(c, 'Sprinkle again', () => (st.t = 0));
    const stt = EM.status(el);
    EM.every(250, () => {
      if (st.ring && !st.lines) stt.set('Each compass needle’s <strong>N end (red)</strong> points along the field: <strong>out of the N pole</strong> and round <strong>into the S pole</strong>. Compasses show the <em>direction</em>.', 'good');
      else if (st.lines) stt.set('Field lines (violet) follow the filings’ pattern. Arrows show the path a free north pole would take — out of N, into S. Lines are most crowded at the poles, where the magnet is strongest.', 'good');
      else stt.set('The filings line up along the field and show its <em>shape</em> — notice they crowd around the poles. Drag the magnet or the compass, or switch on the plotting compasses to see the <em>direction</em>.');
    });
  }

  /** Two bar magnets on a track: attract or repel, with combined field lines. */
  function simTwoMagnets(el) {
    const W = 680,
      H = 300,
      L = 150,
      T = 40,
      Y = 150;
    const st = { ax: 170, aFlip: false, bx: 480, bFlip: true, v: 0, drag: false, off: 0, lines: [], key: '', bump: 0 };
    const charges = (n) => [...EM.physics.magnetPoles(st.ax, Y, L, st.aFlip ? Math.PI : 0, 1, n, T), ...EM.physics.magnetPoles(st.bx, Y, L, st.bFlip ? Math.PI : 0, 1, n, T)];
    function relines() {
      const key = st.bx.toFixed(0) + st.aFlip + st.bFlip;
      if (key === st.key) return;
      st.key = key;
      st.lines = EM.physics.fieldLines(charges(3), { perUnit: 27, step: 4, maxSteps: 500, r0: 8, bounds: { x0: -30, y0: -30, x1: W + 30, y1: H + 30 } });
    }
    function force() {
      const A = EM.physics.magnetPoles(st.ax, Y, L, st.aFlip ? Math.PI : 0, 1, 1, T);
      const B = EM.physics.magnetPoles(st.bx, Y, L, st.bFlip ? Math.PI : 0, 1, 1, T);
      let f = 0;
      for (const b of B)
        for (const a of A) {
          const dx = b.x - a.x;
          f += (b.q * a.q * Math.sign(dx)) / Math.max(400, dx * dx);
        }
      return f;
    }
    const facing = () => ({ a: st.aFlip ? 'S' : 'N', b: st.bFlip ? 'N' : 'S' });
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Two bar magnets that attract or repel',
      draw(ctx, s, dt) {
        if (!st.drag) {
          st.v += force() * 8e6 * dt - st.v * 1.5 * dt;
          st.v = EM.clamp(st.v, -900, 900);
          st.bx += st.v * dt;
          if (st.bx < st.ax + L + 2) {
            if (st.v < -40) st.bump = 0.35;
            st.bx = st.ax + L + 2;
            st.v = 0;
          }
          if (st.bx > W - L / 2 - 12) {
            st.bx = W - L / 2 - 12;
            st.v = 0;
          }
        }
        relines();
        draw.fieldLines(ctx, st.lines, { color: colors.bfield, width: 1.4, arrowEvery: 70, alpha: 0.75 });
        rect(ctx, 20, Y + T / 2 + 4, W - 40, 6, 'rgba(148,163,184,0.25)', null, 3);
        draw.magnet(ctx, st.ax, Y, L, T, st.aFlip ? Math.PI : 0);
        draw.magnet(ctx, st.bx, Y, L, T, st.bFlip ? Math.PI : 0);
        draw.text(ctx, 'fixed', st.ax, Y + T / 2 + 24, { size: 11, color: colors.muted });
        draw.text(ctx, 'free to slide — drag it', st.bx, Y + T / 2 + 24, { size: 11, color: colors.muted });
        const f = facing();
        const attract = f.a !== f.b;
        const gx = (st.ax + L / 2 + st.bx - L / 2) / 2;
        draw.text(ctx, `${f.a} faces ${f.b} → ${attract ? 'ATTRACT' : 'REPEL'}`, W / 2, 28, { size: 15, weight: 700, color: attract ? colors.good : colors.warn, bg: 'rgba(11,18,32,0.85)' });
        if (st.bump > 0) {
          st.bump -= dt;
          draw.text(ctx, 'click!', gx, Y - T / 2 - 16, { size: 13, weight: 700, color: colors.current });
        }
      },
      onDown(p) {
        if (Math.abs(p.x - st.bx) < L / 2 + 6 && Math.abs(p.y - Y) < T / 2 + 10) {
          st.drag = true;
          st.off = p.x - st.bx;
          st.v = 0;
        }
      },
      onMove(p, s) {
        if (st.drag && s.pointer.down) st.bx = EM.clamp(p.x - st.off, st.ax + L + 2, W - L / 2 - 12);
      },
      onUp() {
        st.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.button(c, '⇄ Flip left magnet', () => (st.aFlip = !st.aFlip));
    EM.button(c, '⇄ Flip right magnet', () => (st.bFlip = !st.bFlip));
    EM.button(c, 'Reset position', () => {
      st.bx = 480;
      st.v = 0;
    });
    const stt = EM.status(el);
    EM.every(250, () => {
      const f = facing();
      if (f.a === f.b) stt.set(`Like poles (${f.a} and ${f.b}) <strong>repel</strong>: the field lines from the two poles push away from each other and do not join up.`, 'warn');
      else stt.set(`Unlike poles (${f.a} and ${f.b}) <strong>attract</strong>: field lines run straight from the N pole of one magnet into the S pole of the other.`, 'good');
    });
  }

  /** A freely suspended magnet settles N–S. */
  function simSuspended(el) {
    const W = 640,
      H = 260,
      cx = 320,
      cy = 135;
    const st = { a: 0.9, w: 0, drag: false };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'A freely suspended bar magnet seen from above',
      draw(ctx, s, dt) {
        if (!st.drag) {
          st.w += (-Math.sin(angDiff(-Math.PI / 2, st.a)) * 9 - st.w * 0.7) * dt;
          st.a += st.w * dt;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(cx, cy, 96, 0, TAU);
        ctx.stroke();
        ctx.restore();
        [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]].forEach(([t, x, y]) => draw.text(ctx, t, cx + x * 112, cy + y * 112, { size: 14, weight: 700, color: t === 'N' ? colors.north : colors.muted }));
        draw.text(ctx, 'geographic directions', 92, 24, { size: 11, color: colors.muted });
        draw.magnet(ctx, cx, cy, 170, 30, st.a);
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, TAU);
        ctx.fill();
        draw.text(ctx, 'thread', cx + 26, cy - 22, { size: 11, color: colors.muted, align: 'left' });
        draw.text(ctx, 'Drag to twist it, then let go', 530, 236, { size: 12, color: colors.muted });
      },
      onDown(p) {
        if (Math.hypot(p.x - cx, p.y - cy) < 100) st.drag = true;
      },
      onMove(p, s) {
        if (st.drag && s.pointer.down) {
          st.a = Math.atan2(p.y - cy, p.x - cx);
          st.w = 0;
        }
      },
      onUp() {
        st.drag = false;
      },
    });
    const stt = EM.status(el);
    EM.every(250, () => {
      const off = Math.abs(angDiff(st.a, -Math.PI / 2)) / DEG;
      stt.set(st.drag ? 'Let go and watch…' : off < 3 && Math.abs(st.w) < 0.05 ? 'Settled: the magnet lies <strong>north–south</strong>, with its N (north-seeking) pole pointing north. This is exactly how a compass works.' : 'Swinging back towards north–south…', off < 3 ? 'good' : '');
    });
  }

  /* ================================================================== sims: magnetic effect of a current */

  function cellV(ctx, x, y, plusTop) {
    const plates = plusTop ? [[-5, 15, 3], [5, 8, 5]] : [[-5, 8, 5], [5, 15, 3]];
    ctx.save();
    ctx.strokeStyle = colors.wire;
    for (const [off, hw, w] of plates) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x - hw, y + off);
      ctx.lineTo(x + hw, y + off);
      ctx.stroke();
    }
    ctx.restore();
    draw.text(ctx, '+', x + 24, y + (plusTop ? -9 : 9), { size: 14, weight: 700, color: colors.pos });
    draw.text(ctx, '−', x + 24, y + (plusTop ? 9 : -9), { size: 14, weight: 700, color: colors.neg });
  }

  /** Oersted's observation: a compass under a wire deflects when the current is switched on. */
  function simOersted(el) {
    const W = 640,
      H = 300,
      cx = 230,
      cy = 150;
    const st = { on: false, dir: 1, above: true, I: 5 };
    const needle = { a: -Math.PI / 2, w: 0 };
    const Be = 1.8e-5;
    const Bw = () => (st.on ? 1e-5 * st.I : 0);
    const loop = [[cx, 270], [cx, 30], [560, 30], [560, 270], [cx, 270]];
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Oersted’s experiment: compass under a current-carrying wire',
      draw(ctx, s, dt) {
        const sW = st.dir * (st.above ? 1 : -1);
        needleStep(needle, Math.atan2(-Be, -sW * Bw()), dt, 40, 6);
        const wirePath = () => {
          draw.wire(ctx, [[560, 165], [560, 270], [cx, 270], [cx, 30], [560, 30], [560, 135]], colors.copper, 4);
        };
        if (!st.above) wirePath();
        draw.compass(ctx, cx, cy, needle.a, 62);
        if (st.above) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          wirePath();
          ctx.restore();
        } else {
          ctx.save();
          ctx.setLineDash([5, 5]);
          draw.line(ctx, cx, cy - 62, cx, cy + 62, colors.copper, 3);
          ctx.restore();
        }
        if (st.on) draw.flowDots(ctx, loop, s.t, { speed: 70 * st.dir, spacing: 24, r: 3 });
        cellV(ctx, 560, 150, st.dir < 0);
        draw.switch(ctx, 380, 30, 420, st.on, { label: 'switch' });
        draw.text(ctx, 'N ↑', 40, 26, { size: 14, weight: 700, color: colors.north });
        draw.text(ctx, 'W', 40, cy, { size: 13, color: colors.muted });
        draw.text(ctx, 'E', 340, cy, { size: 13, color: colors.muted });
        draw.text(ctx, st.above ? 'wire passes OVER the compass' : 'wire passes UNDER the compass', cx, 290, { size: 11, color: colors.muted });
        if (st.on) draw.arrow(ctx, cx - 22, st.dir > 0 ? 250 : 210, cx - 22, st.dir > 0 ? 210 : 250, { color: colors.current, width: 2.5, label: '' });
        if (st.on) draw.text(ctx, 'I', cx - 36, 230, { size: 14, weight: 700, color: colors.current });
        const defl = Math.atan2(Bw(), Be) / DEG;
        draw.text(ctx, st.on ? `needle deflected ${defl.toFixed(0)}° ${sW > 0 ? 'west' : 'east'}` : 'no current: needle points north', 450, 112, { size: 13, weight: 700, color: st.on ? colors.current : colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Switch on the current', value: false, onChange: (v) => (st.on = v) });
    EM.segmented(c, { label: 'Current in the wire flows', options: [{ value: 1, label: 'North ↑' }, { value: -1, label: 'South ↓' }], value: 1, onChange: (v) => (st.dir = v) });
    EM.segmented(c, { label: 'Wire', options: [{ value: true, label: 'Over compass' }, { value: false, label: 'Under compass' }], value: true, onChange: (v) => (st.above = v) });
    EM.slider(c, { label: 'Current', min: 0.5, max: 10, step: 0.5, value: 5, unit: 'A', onInput: (v) => (st.I = v) });
    const stt = EM.status(el);
    EM.every(250, () => {
      if (!st.on) stt.set('Only Earth’s magnetic field acts: the needle points to magnetic north. Switch the current on…');
      else stt.set('The current makes its own magnetic field, which pushes the needle towards a direction <strong>perpendicular to the wire</strong>. Bigger current → bigger deflection. Reverse the current → it swings the other way.', 'good');
    });
  }

  /** DEMO: compasses around a straight current-carrying wire (side view + top view). */
  function simWireField(el) {
    const W = 700,
      H = 380,
      cx = 465,
      cy = 190;
    const st = { dir: 1, I: 8, earth: true, lines: true };
    const Be = 1,
      K = 60;
    const comps = [];
    for (let i = 0; i < 8; i++) comps.push({ r: 80, an: (i / 8) * TAU + Math.PI / 8 });
    for (let i = 0; i < 12; i++) comps.push({ r: 150, an: (i / 12) * TAU });
    comps.forEach((c) => {
      c.x = cx + c.r * Math.cos(c.an);
      c.y = cy + c.r * Math.sin(c.an);
      c.a = -Math.PI / 2;
      c.w = 0;
    });
    const probe = { x: 640, y: 330, a: -Math.PI / 2, w: 0, drag: false };
    const field = (x, y) => {
      let bx = 0,
        by = st.earth ? -Be : 0;
      if (st.dir) {
        const [wx, wy] = wireField([{ x: cx, y: cy, I: st.dir * K * st.I }], x, y, 1);
        bx += wx;
        by += wy;
      }
      return [bx, by];
    };
    const target = (x, y) => {
      const [bx, by] = field(x, y);
      return Math.hypot(bx, by) < 1e-6 ? null : Math.atan2(by, bx);
    };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Plotting compasses around a straight wire carrying a current',
      draw(ctx, s, dt) {
        // side view
        rect(ctx, 8, 8, 212, H - 16, '#0f172a', 'rgba(148,163,184,0.2)', 10);
        draw.text(ctx, 'Side view', 114, 26, { size: 12, weight: 700, color: colors.muted });
        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.16)';
        ctx.strokeStyle = 'rgba(148,163,184,0.45)';
        ctx.beginPath();
        ctx.ellipse(110, 215, 86, 24, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        draw.text(ctx, 'card', 182, 246, { size: 11, color: colors.muted });
        draw.wire(ctx, [[110, 44], [110, 300]], '#92400e', 6);
        if (st.dir) draw.flowDots(ctx, [[110, 300], [110, 44]], s.t, { speed: 60 * st.dir, spacing: 20, r: 2.5 });
        if (st.dir) {
          const up = st.dir > 0;
          draw.arrow(ctx, 158, up ? 175 : 95, 158, up ? 95 : 175, { color: colors.current, width: 4 });
          draw.text(ctx, 'I', 174, 135, { size: 15, weight: 700, color: colors.current });
          ctx.save();
          ctx.strokeStyle = colors.bfield;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(110, 120, 40, 12, 0, 0, TAU);
          ctx.stroke();
          ctx.restore();
          ellipseArrow(ctx, 110, 120, 40, 12, Math.PI / 2, !up, colors.bfield);
          ellipseArrow(ctx, 110, 120, 40, 12, -Math.PI / 2, !up, colors.bfield);
          draw.text(ctx, 'B', 58, 102, { size: 14, weight: 700, color: colors.bfield });
        }
        draw.text(ctx, 'Right-hand grip rule:', 20, 318, { size: 12, weight: 700, align: 'left' });
        draw.text(ctx, 'thumb → current', 20, 336, { size: 12, align: 'left', color: colors.current });
        draw.text(ctx, 'fingers curl → field', 20, 354, { size: 12, align: 'left', color: colors.bfield });
        // top view
        rect(ctx, 230, 8, W - 238, H - 16, '#121a2d', 'rgba(148,163,184,0.2)', 10);
        ctx.save();
        draw.roundRect(ctx, 230, 8, W - 238, H - 16, 10);
        ctx.clip();
        if (st.lines && st.dir) {
          for (const r of [42, 80, 125, 185]) {
            ctx.save();
            ctx.strokeStyle = 'rgba(167,139,250,0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, TAU);
            ctx.stroke();
            ctx.restore();
            for (const a0 of [0.35, 0.35 + Math.PI]) ellipseArrow(ctx, cx, cy, r, r, a0 + r / 60, st.dir < 0, 'rgba(167,139,250,0.9)');
          }
        }
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#92400e';
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, TAU);
        ctx.fill();
        ctx.restore();
        curSym(ctx, cx, cy, st.dir, 10, st.dir ? colors.current : '#475569');
        for (const c of comps) {
          needleStep(c, target(c.x, c.y), dt);
          draw.compass(ctx, c.x, c.y, c.a, 14);
        }
        needleStep(probe, target(probe.x, probe.y), dt);
        draw.compass(ctx, probe.x, probe.y, probe.a, 18);
        draw.text(ctx, 'drag', probe.x, probe.y + 27, { size: 10, color: colors.muted });
        draw.text(ctx, 'Top view (looking down on the card)', 240, 360, { size: 11, color: colors.muted, align: 'left' });
        draw.text(ctx, 'N ↑', 676, 24, { size: 13, weight: 700, color: colors.north });
      },
      onDown(p) {
        if (Math.hypot(p.x - probe.x, p.y - probe.y) < 22) probe.drag = true;
      },
      onMove(p, s) {
        if (!probe.drag || !s.pointer.down) return;
        let x = EM.clamp(p.x, 252, W - 24),
          y = EM.clamp(p.y, 30, H - 30);
        const d = Math.hypot(x - cx, y - cy);
        if (d < 34) {
          x = cx + ((x - cx) / (d || 1)) * 34;
          y = cy + ((y - cy) / (d || 1)) * 34;
        }
        probe.x = x;
        probe.y = y;
      },
      onUp() {
        probe.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, { label: 'Current', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'Up ⊙ (out of card)' }, { value: -1, label: 'Down ⊗ (into card)' }], value: 1, onChange: (v) => (st.dir = v) });
    EM.slider(c, { label: 'Size of current', min: 1, max: 10, step: 0.5, value: 8, unit: 'A', onInput: (v) => (st.I = v) });
    EM.toggle(c, { label: 'Include Earth’s field', value: true, onChange: (v) => (st.earth = v) });
    EM.toggle(c, { label: 'Field lines', value: true, onChange: (v) => (st.lines = v) });
    const stt = EM.status(el);
    EM.every(250, () => {
      if (!st.dir) stt.set(st.earth ? 'No current: every compass simply points north (Earth’s field).' : 'No current and no Earth field: there is no magnetic field to line the needles up.');
      else
        stt.set(
          `Current ${st.dir > 0 ? 'up (towards you in the top view)' : 'down (away from you in the top view)'} → field lines are <strong>circles around the wire</strong>, ${st.dir > 0 ? 'anticlockwise' : 'clockwise'} seen from above. The compasses line up along these circles${st.earth ? ' — far from the wire the field is weaker, so Earth’s field bends the outer needles towards north' : ''}.`,
          'good'
        );
    });
  }

  /** DEMO: compasses around a solenoid; field lines; iron core. */
  function simSolenoid(el) {
    const W = 700,
      H = 400,
      x0 = 200,
      x1 = 500,
      yT = 135,
      yB = 245,
      cy = 190;
    const st = { dir: 1, core: false, lines: true };
    const unit = [];
    for (let i = 0; i < 20; i++) {
      const x = x0 + (i + 0.5) * 15;
      unit.push({ x, y: yT, I: -1 }, { x, y: yB, I: 1 });
    }
    const uField = (x, y) => wireField(unit, x, y, 40);
    const Be = Math.hypot(...uField(560, cy)) / 7;
    const field = (x, y) => {
      const k = st.dir * (st.core ? 4 : 1);
      const [bx, by] = uField(x, y);
      return [bx * k, by * k - Be];
    };
    const lines = [];
    for (const y of [150, 162, 176, 190, 204, 218, 230]) lines.push(traceLoop(uField, 350, y, { step: 3, maxSteps: 2600, bounds: { x0: -20, y0: -20, x1: W + 20, y1: H + 20 } }));
    const comps = [[135, 190], [565, 190], [250, 78], [350, 78], [450, 78], [250, 300], [350, 300], [450, 300], [160, 104], [540, 104], [160, 276], [540, 276]].map(([x, y]) => ({ x, y, a: -Math.PI / 2, w: 0 }));
    const probe = { x: 630, y: 350, a: -Math.PI / 2, w: 0, drag: false };
    const tgt = (x, y) => {
      const [bx, by] = field(x, y);
      return Math.atan2(by, bx);
    };
    const leadL = [[275, 352], [x0, 352], [x0, yB]];
    const leadR = [[x1, yB], [x1, 352], [425, 352]];
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Plotting compasses around a solenoid',
      draw(ctx, s, dt) {
        if (st.lines && st.dir) draw.fieldLines(ctx, lines.map((l) => ({ points: l.points, dir: st.dir })), { color: colors.bfield, width: 1.5, arrowEvery: 85, alpha: 0.7 });
        if (st.core) {
          rect(ctx, x0 - 18, cy - 34, x1 - x0 + 36, 68, '#475569', '#94a3b8', 6);
          draw.text(ctx, 'iron core', x1 + 2, cy + 46, { size: 11, color: colors.muted, align: 'left' });
        }
        for (let j = 0; j < 10; j++) {
          const xa = x0 + j * 30;
          draw.line(ctx, xa + 15, yT, xa + 30, yB, 'rgba(217,119,6,0.45)', 3);
        }
        for (let j = 0; j < 10; j++) {
          const xa = x0 + j * 30;
          draw.line(ctx, xa, yB, xa + 15, yT, colors.copper, 4);
          if (st.dir) draw.flowDots(ctx, [[xa, yB], [xa + 15, yT]], s.t, { speed: 45 * st.dir, spacing: 26, r: 2.5 });
        }
        draw.wire(ctx, leadL, colors.copper, 3);
        draw.wire(ctx, leadR, colors.copper, 3);
        if (st.dir) {
          draw.flowDots(ctx, leadL, s.t, { speed: 50 * st.dir, spacing: 24, r: 2.5 });
          draw.flowDots(ctx, leadR, s.t, { speed: 50 * st.dir, spacing: 24, r: 2.5 });
        }
        rect(ctx, 275, 336, 150, 32, '#1e293b', '#64748b', 6);
        draw.text(ctx, 'Power supply', 350, 352, { size: 12, weight: 600 });
        draw.text(ctx, st.dir >= 0 ? '+' : '−', 262, 340, { size: 15, weight: 700, color: st.dir >= 0 ? colors.pos : colors.neg });
        draw.text(ctx, st.dir >= 0 ? '−' : '+', 438, 340, { size: 15, weight: 700, color: st.dir >= 0 ? colors.neg : colors.pos });
        if (st.dir) {
          const leftN = st.dir > 0;
          draw.text(ctx, leftN ? 'N' : 'S', x0, 114, { size: 18, weight: 800, color: '#fff', bg: leftN ? colors.north : colors.south });
          draw.text(ctx, leftN ? 'S' : 'N', x1, 114, { size: 18, weight: 800, color: '#fff', bg: leftN ? colors.south : colors.north });
        }
        for (const c of comps) {
          needleStep(c, tgt(c.x, c.y), dt);
          draw.compass(ctx, c.x, c.y, c.a, 14);
        }
        needleStep(probe, tgt(probe.x, probe.y), dt);
        draw.compass(ctx, probe.x, probe.y, probe.a, 18);
        draw.text(ctx, 'drag', probe.x, probe.y + 27, { size: 10, color: colors.muted });
        draw.text(ctx, 'N ↑', 676, 22, { size: 13, weight: 700, color: colors.north });
      },
      onDown(p) {
        if (Math.hypot(p.x - probe.x, p.y - probe.y) < 22) probe.drag = true;
      },
      onMove(p, s) {
        if (probe.drag && s.pointer.down) {
          probe.x = EM.clamp(p.x, 20, W - 20);
          probe.y = EM.clamp(p.y, 20, H - 20);
        }
      },
      onUp() {
        probe.drag = false;
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, { label: 'Current', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On (as in the notes)' }, { value: -1, label: 'On, reversed' }], value: 1, onChange: (v) => (st.dir = v) });
    EM.toggle(c, { label: 'Iron rod inside', value: false, onChange: (v) => (st.core = v) });
    EM.toggle(c, { label: 'Field lines', value: true, onChange: (v) => (st.lines = v) });
    const ro = EM.readout(el, [
      { key: 'l', label: 'Left end' },
      { key: 'r', label: 'Right end' },
      { key: 'b', label: 'Field strength inside' },
    ]);
    const stt = EM.status(el);
    EM.every(200, () => {
      ro.set('l', st.dir ? (st.dir > 0 ? 'North pole' : 'South pole') : '–');
      ro.set('r', st.dir ? (st.dir > 0 ? 'South pole' : 'North pole') : '–');
      ro.set('b', st.dir ? (st.core ? 'strong (iron core)' : 'uniform') : 'zero');
      if (!st.dir) stt.set('No current: the compasses point north (Earth’s field). Switch the current on.');
      else
        stt.set(
          `Grip the coil with your right hand, fingers curling the way the current goes round the turns: your thumb points ${st.dir > 0 ? 'left' : 'right'} → the <strong>${st.dir > 0 ? 'left' : 'right'}-hand end is a north pole</strong>. Outside, the field looks just like a bar magnet’s; inside it is straight and uniform.${st.core ? ' The iron rod makes it a much stronger electromagnet.' : ''}`,
          'good'
        );
    });
  }

  /** Virtual investigation: nail electromagnet picking up paperclips. */
  function simElectromagnet(el) {
    const W = 680,
      H = 380,
      nx = 440;
    const mats = {
      steel: { label: 'Steel', ferro: true, color: '#cbd5e1' },
      iron: { label: 'Iron', ferro: true, color: '#a8a29e' },
      nickel: { label: 'Nickel', ferro: true, color: '#d6d3d1' },
      cobalt: { label: 'Cobalt', ferro: true, color: '#93c5fd' },
      aluminium: { label: 'Aluminium', ferro: false, color: '#e5e7eb' },
      copper: { label: 'Copper', ferro: false, color: '#f59e0b' },
      plastic: { label: 'Plastic', ferro: false, color: '#f472b6' },
    };
    const st = { N: 50, I: 1.5, core: 'iron', mat: 'steel', on: true };
    const R = rng(3);
    const clips = [];
    for (let i = 0; i < 15; i++) {
      const rx = nx + (R() * 2 - 1) * 90,
        ry = 344 + R() * 8;
      clips.push({ rx, ry, ra: (R() - 0.5) * 2.6, x: rx, y: ry, a: 0, vy: 0, held: false });
    }
    clips.sort((a, b) => Math.abs(a.rx - nx) - Math.abs(b.rx - nx));
    clips.forEach((c) => (c.a = c.ra));
    const lifted = () => {
      if (!st.on || !mats[st.mat].ferro) return 0;
      return Math.min(12, Math.floor((st.N * st.I * (st.core === 'iron' ? 1 : 0.08)) / 25));
    };
    function slot(k) {
      const strand = k % 3,
        j = Math.floor(k / 3);
      const off = [0, -1, 1][strand];
      return { x: nx + off * (8 + j * 7), y: 262 + j * 20, a: off * (0.12 + j * 0.05) };
    }
    function clipShape(ctx, x, y, a, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      draw.roundRect(ctx, -4.5, -9, 9, 18, 4.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-1.5, 6);
      ctx.lineTo(-1.5, -5);
      ctx.arc(0.5, -5, 2, Math.PI, 0);
      ctx.lineTo(2.5, 3);
      ctx.stroke();
      ctx.restore();
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Electromagnet made from an iron nail, a coil and a battery, picking up paperclips',
      draw(ctx, s, dt) {
        const n = lifted();
        const strength = st.on ? st.N * st.I * (st.core === 'iron' ? 1 : 0.08) : 0;
        // battery
        rect(ctx, 200, 150, 60, 100, '#2563eb', '#93c5fd', 8);
        rect(ctx, 212, 140, 14, 10, '#cbd5e1', null, 2);
        rect(ctx, 236, 140, 14, 10, '#cbd5e1', null, 2);
        draw.text(ctx, '+', 219, 162, { size: 14, weight: 700 });
        draw.text(ctx, '−', 243, 162, { size: 14, weight: 700 });
        draw.text(ctx, 'Battery', 230, 205, { size: 12, weight: 700 });
        // wires
        const top = [[219, 140], [219, 66], [nx - 18, 66]];
        const bot = [[nx - 18, 220], [330, 220], [330, 120], [310, 120]];
        const bot2 = [[280, 120], [243, 120], [243, 140]];
        draw.wire(ctx, top, colors.copper, 3);
        draw.wire(ctx, bot, colors.copper, 3);
        draw.wire(ctx, bot2, colors.copper, 3);
        draw.switch(ctx, 280, 120, 310, st.on, { label: 'switch' });
        if (st.on && st.I > 0) for (const pth of [top, bot, bot2]) draw.flowDots(ctx, pth, s.t, { speed: 30 + 20 * st.I, spacing: 22, r: 2.5 });
        // field glow
        if (strength > 0) {
          const g = ctx.createRadialGradient(nx, 250, 4, nx, 250, 40 + strength / 3);
          g.addColorStop(0, `rgba(167,139,250,${Math.min(0.55, strength / 300)})`);
          g.addColorStop(1, 'rgba(167,139,250,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(nx, 250, 40 + strength / 3, 0, TAU);
          ctx.fill();
        }
        // nail / core
        if (st.core === 'iron') {
          ctx.save();
          ctx.fillStyle = '#9ca3af';
          ctx.beginPath();
          ctx.ellipse(nx, 44, 26, 6, 0, 0, TAU);
          ctx.fill();
          ctx.fillRect(nx - 7, 44, 14, 196);
          ctx.beginPath();
          ctx.moveTo(nx - 7, 240);
          ctx.lineTo(nx, 256);
          ctx.lineTo(nx + 7, 240);
          ctx.fill();
          ctx.restore();
          draw.text(ctx, 'iron nail (core)', nx + 32, 44, { size: 12, align: 'left', color: colors.muted });
        } else {
          rect(ctx, nx - 8, 50, 16, 190, null, 'rgba(148,163,184,0.5)', 3);
          draw.text(ctx, 'no core (air)', nx + 32, 44, { size: 12, align: 'left', color: colors.muted });
        }
        // coil
        const nv = Math.max(2, Math.round(st.N / 5));
        ctx.save();
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 2.5;
        for (let i = 0; i < nv; i++) {
          const y = 68 + ((i + 0.5) * 150) / nv;
          ctx.beginPath();
          ctx.ellipse(nx, y, 15, 3.5, 0, 0, Math.PI);
          ctx.stroke();
        }
        ctx.restore();
        draw.text(ctx, `coil: ${st.N} turns`, nx + 32, 140, { size: 12, align: 'left', color: colors.copper });
        // table
        draw.line(ctx, 320, 360, 600, 360, '#64748b', 3);
        // clips
        clips.forEach((c, k) => {
          if (k < n) {
            const sl = slot(k);
            c.x += (sl.x - c.x) * Math.min(1, 7 * dt);
            c.y += (sl.y - c.y) * Math.min(1, 7 * dt);
            c.a += (sl.a - c.a) * Math.min(1, 7 * dt);
            c.vy = 0;
            c.held = true;
          } else if (c.y < c.ry - 0.5) {
            c.vy += 1100 * dt;
            c.y = Math.min(c.ry, c.y + c.vy * dt);
            c.x += (c.rx - c.x) * Math.min(1, 3 * dt);
            c.a += (c.ra - c.a) * Math.min(1, 5 * dt);
          } else {
            c.y = c.ry;
            c.vy = 0;
            c.held = false;
          }
          clipShape(ctx, c.x, c.y, c.a, mats[st.mat].color);
        });
        draw.text(ctx, `${mats[st.mat].label} paperclips`, 600, 340, { size: 12, align: 'right', color: colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Switch closed', value: true, onChange: (v) => (st.on = v) });
    EM.slider(c, { label: 'Turns of wire', min: 10, max: 100, step: 10, value: 50, onInput: (v) => (st.N = v) });
    EM.slider(c, { label: 'Current', min: 0, max: 3, step: 0.1, value: 1.5, unit: 'A', fmt: (v) => v.toFixed(1), onInput: (v) => (st.I = v) });
    EM.segmented(c, { label: 'Core', options: [{ value: 'iron', label: 'Iron nail' }, { value: 'air', label: 'No core' }], value: 'iron', onChange: (v) => (st.core = v) });
    EM.select(c, { label: 'Paperclips made of', options: Object.entries(mats).map(([value, m]) => ({ value, label: m.label + (m.ferro ? ' (ferromagnetic)' : '') })), value: 'steel', onChange: (v) => (st.mat = v) });
    const ro = EM.readout(el, [
      { key: 'ni', label: 'Turns × current' },
      { key: 'n', label: 'Paperclips lifted' },
    ]);
    const stt = EM.status(el);
    EM.every(200, () => {
      const n = lifted();
      ro.set('ni', st.on ? (st.N * st.I).toFixed(0) + ' A-turns' : '0 (switched off)');
      ro.set('n', String(n));
      if (!st.on) stt.set('Switched off: the magnetic field <strong>disappears instantly</strong> and the paperclips drop.');
      else if (!mats[st.mat].ferro) stt.set(`${mats[st.mat].label} is <strong>not ferromagnetic</strong> — an electromagnet only attracts iron, nickel, cobalt and steel, no matter how strong it is.`, 'warn');
      else if (st.core !== 'iron') stt.set('Without the iron core the coil is only a weak magnet. Put the iron nail back in to make it far stronger.', 'warn');
      else stt.set(`More turns or more current → stronger electromagnet → more paperclips. Now lifting <strong>${n}</strong>.`, 'good');
    });
  }

  /* ================================================================== sims: electromagnet devices */

  /** Electric (school) bell with armature, striker, gong and interrupter. */
  function simBell(el) {
    const W = 680,
      H = 350,
      P = { x: 480, y: 150 },
      DMAX = 0.18,
      RB = 11,
      RG = 72;
    const st = { push: true, slow: true, p: 0, v: 0, rings: 0, ding: 0, contact: true, mag: false };
    const rot = (x, y, p) => {
      const ph = -p * DMAX;
      return [P.x + x * Math.cos(ph) - y * Math.sin(ph), P.y + x * Math.sin(ph) + y * Math.cos(ph)];
    };
    const ball1 = rot(-265, -62, 1);
    const vx = 265 * Math.sin(DMAX) - 62 * Math.cos(DMAX),
      vy = 265 * Math.cos(DMAX) + 62 * Math.sin(DMAX);
    const vm = Math.hypot(vx, vy);
    const G = { x: ball1[0] + ((RG + RB) * vx) / vm, y: ball1[1] + ((RG + RB) * vy) / vm };
    const pathA = [[440, 326], [600, 326], [600, 90], [400, 90], [400, 134]];
    const pathB = [[494, 150], [520, 150], [520, 296], [412, 296], [412, 252], [401, 252]];
    const pathC = [[299, 252], [288, 252], [288, 326], [300, 326]];
    const pathD = [[330, 326], [350, 326]];
    function step(dt) {
      st.contact = st.p < 0.1;
      st.mag = st.push && st.contact;
      const a = (st.mag ? 150 : 0) - 25 * st.p - 1.5 * st.v;
      st.v += a * dt;
      st.p += st.v * dt;
      if (st.p >= 1) {
        st.p = 1;
        if (st.v > 0.5) {
          st.rings++;
          st.ding = 0.25;
        }
        st.v = -0.35 * Math.abs(st.v);
      }
      if (st.p <= 0) {
        st.p = 0;
        if (st.v < 0) st.v = 0;
      }
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Animated electric bell',
      draw(ctx, s, dt) {
        const T = dt * (st.slow ? 1 : 9);
        const n = 30;
        for (let i = 0; i < n; i++) step(T / n);
        st.ding = Math.max(0, st.ding - dt * (st.slow ? 1 : 3));
        const on = st.mag;
        // circuit
        for (const pth of [pathA, pathB, pathC, pathD]) draw.wire(ctx, pth, colors.wire, 2.5);
        if (on) for (const pth of [pathA, pathB, pathC, pathD]) draw.flowDots(ctx, pth, s.t, { speed: 60, spacing: 22, r: 2.5 });
        rect(ctx, 350, 312, 90, 28, '#1e293b', '#64748b', 6);
        draw.text(ctx, 'Power supply', 395, 326, { size: 11, weight: 600 });
        draw.text(ctx, '−', 357, 304, { size: 14, weight: 700, color: colors.neg });
        draw.text(ctx, '+', 433, 304, { size: 14, weight: 700, color: colors.pos });
        draw.switch(ctx, 300, 326, 330, st.push, { label: 'bell push (switch)' });
        // gong
        const sh = st.ding > 0 ? Math.sin(s.t * 120) * 2 * st.ding * 4 : 0;
        ctx.save();
        const g = ctx.createRadialGradient(G.x - 20, G.y - 20, 5, G.x, G.y, RG);
        g.addColorStop(0, '#fde68a');
        g.addColorStop(1, '#a16207');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(G.x + sh, G.y, RG, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#713f12';
        ctx.beginPath();
        ctx.arc(G.x + sh, G.y, 6, 0, TAU);
        ctx.fill();
        ctx.restore();
        draw.text(ctx, 'Gong', G.x, G.y + 26, { size: 13, weight: 700, color: '#422006' });
        if (st.ding > 0) {
          ctx.save();
          ctx.strokeStyle = `rgba(253,224,71,${st.ding * 3})`;
          ctx.lineWidth = 2;
          for (const r of [RG + 10, RG + 22]) {
            ctx.beginPath();
            ctx.arc(G.x, G.y, r, Math.PI * 0.9, Math.PI * 1.45);
            ctx.stroke();
          }
          ctx.restore();
          draw.text(ctx, 'DING!', G.x - 70, G.y - RG - 4, { size: 16, weight: 800, color: colors.current });
        }
        // electromagnet (U core, poles up)
        for (const x of [299, 379]) {
          rect(ctx, x, 196, 22, 66, on ? '#64748b' : '#475569', null, 3);
          ctx.save();
          ctx.strokeStyle = colors.copper;
          ctx.lineWidth = 3;
          for (let y = 206; y <= 252; y += 6) {
            ctx.beginPath();
            ctx.moveTo(x - 5, y);
            ctx.lineTo(x + 27, y + 3);
            ctx.stroke();
          }
          ctx.restore();
          if (on) {
            ctx.save();
            ctx.shadowColor = colors.bfield;
            ctx.shadowBlur = 14;
            rect(ctx, x + 2, 194, 18, 5, colors.bfield, null, 2);
            ctx.restore();
          }
        }
        rect(ctx, 299, 262, 102, 14, on ? '#64748b' : '#475569', null, 3);
        draw.text(ctx, 'Electromagnet', 350, 288, { size: 12, weight: 600, color: colors.muted });
        // armature + striker (rotate about the spring mount)
        ctx.save();
        ctx.translate(P.x, P.y);
        ctx.rotate(-st.p * DMAX);
        rect(ctx, -205, -6, 165, 12, '#94a3b8', '#e2e8f0', 3);
        draw.line(ctx, -40, 0, 0, 0, '#cbd5e1', 2);
        draw.line(ctx, -205, 0, -265, -62, '#cbd5e1', 4);
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(-265, -62, RB, 0, TAU);
        ctx.fill();
        rect(ctx, -86, -9, 12, 4, '#fbbf24', null, 1);
        ctx.restore();
        rect(ctx, 486, 138, 14, 26, '#334155', '#64748b', 2);
        // interrupter screw
        rect(ctx, 395, 92, 10, 42, '#cbd5e1', null, 2);
        if (st.contact) draw.text(ctx, '●', 400, 138, { size: 8, color: colors.current });
        // labels
        draw.text(ctx, 'Striker', ball1[0] - 4, 62, { size: 12, color: colors.muted });
        draw.text(ctx, 'Armature (soft iron)', 330, 128, { size: 12, color: colors.muted });
        draw.text(ctx, 'Interrupter (contact)', 500, 76, { size: 12, color: colors.muted });
        draw.text(ctx, `Rings: ${st.rings}`, 620, 30, { size: 13, weight: 700, color: colors.current });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Hold the bell push', value: true, onChange: (v) => (st.push = v) });
    EM.segmented(c, { label: 'Speed', options: [{ value: true, label: 'Slow motion' }, { value: false, label: 'Real speed' }], value: true, onChange: (v) => (st.slow = v) });
    const stt = EM.status(el);
    EM.every(120, () => {
      if (!st.push) stt.set('Bell push released: no current, the spring holds the armature against the interrupter. Silence.');
      else if (st.mag) stt.set('<strong>1.</strong> Circuit complete → current flows → the iron core becomes an <strong>electromagnet</strong> and attracts the armature, swinging the striker towards the gong.', 'good');
      else if (st.v > 0) stt.set('<strong>2.</strong> The armature has moved off the interrupter → <strong>circuit broken</strong>, but its momentum carries the striker into the gong…', 'warn');
      else stt.set('<strong>3.</strong> No current → the iron <strong>loses its magnetism</strong> → the springy strip pulls the armature back until it touches the interrupter again → the cycle repeats.');
    });
  }

  /** Miniature circuit breaker: normal vs fault current. */
  function simMCB(el) {
    const W = 680,
      H = 330,
      PV = { x: 430, y: 190 },
      ARM = [82, 54],
      TB = { x: 348, y: 120 },
      ITRIP = 30;
    const st = { demand: 6, trip: 0, tripped: false, slow: true, spark: 0, tilt: 0 };
    const flowing = () => (st.tripped && st.trip >= 0.6 ? 0 : st.demand);
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Miniature circuit breaker',
      draw(ctx, s, dt) {
        const T = dt * (st.slow ? 1 : 4);
        if (!st.tripped && st.demand >= ITRIP) st.tripped = true;
        if (st.tripped && st.trip < 1) {
          const before = st.trip;
          st.trip = Math.min(1, st.trip + T * 0.9);
          if (before < 0.6 && st.trip >= 0.6) st.spark = 0.35;
        }
        st.spark = Math.max(0, st.spark - dt);
        const I = flowing();
        const pull = I / ITRIP;
        const tiltTarget = st.tripped && st.trip < 0.6 ? 0.17 : 0.17 * Math.min(0.85, pull);
        st.tilt += (tiltTarget - st.tilt) * Math.min(1, 10 * T);
        const latch = st.tripped ? EM.clamp((st.trip - 0.3) / 0.3, 0, 1) : 0;
        const open = st.tripped ? EM.clamp((st.trip - 0.6) / 0.25, 0, 1) : 0;
        const armAng = -0.55 * open;
        const ca = Math.cos(armAng),
          sa = Math.sin(armAng);
        const tip = [PV.x + ARM[0] * ca - ARM[1] * sa, PV.y + ARM[0] * sa + ARM[1] * ca];
        const tail = [PV.x - 0.35 * (ARM[0] * ca - ARM[1] * sa), PV.y - 0.35 * (ARM[0] * sa + ARM[1] * ca)];
        // casing
        rect(ctx, 150, 14, 410, 300, 'rgba(30,41,59,0.55)', 'rgba(148,163,184,0.3)', 12);
        draw.text(ctx, 'Inside the MCB', 205, 300, { size: 11, color: colors.muted });
        // wires
        const wLine = [[620, 250], [522, 250]];
        const wBraid = [[PV.x, PV.y], [455, 150], [455, 30], [322, 30], [322, 62]];
        const wLoad = [[225, 98], [225, 250], [110, 250]];
        const wLamp = [[110, 250], [110, 196]];
        for (const w of [wLine, wBraid, wLoad, wLamp]) draw.wire(ctx, w, colors.wire, 2.5);
        if (I > 0) {
          const sp = 30 + Math.min(80, I);
          draw.flowDots(ctx, [[620, 250], [522, 250]], s.t, { speed: sp, spacing: 20 });
          draw.flowDots(ctx, wBraid, s.t, { speed: sp, spacing: 20 });
          draw.flowDots(ctx, wLoad, s.t, { speed: sp, spacing: 20 });
          draw.flowDots(ctx, wLamp, s.t, { speed: sp, spacing: 20 });
        }
        draw.bulb(ctx, 110, 175, I > 0 ? Math.min(1, 0.35 + I / 20) : 0, { r: 20 });
        draw.text(ctx, 'appliance', 110, 140, { size: 11, color: colors.muted });
        draw.line(ctx, 110, 155, 110, 120, colors.wire, 2.5);
        for (const [x, lab] of [[110, 'Load'], [620, 'Line (supply)']]) {
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.arc(x, 250, 7, 0, TAU);
          ctx.fill();
          draw.text(ctx, lab, x, 274, { size: 12, weight: 700 });
        }
        // coil (magnetic element)
        const glow = Math.min(1, pull);
        if (glow > 0.05) {
          ctx.save();
          ctx.shadowColor = colors.bfield;
          ctx.shadowBlur = 25 * glow;
          rect(ctx, 214, 58, 120, 44, `rgba(167,139,250,${0.25 + 0.5 * glow})`, null, 8);
          ctx.restore();
        }
        rect(ctx, 214, 72, 120, 16, '#64748b', null, 3);
        ctx.save();
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 3;
        for (let x = 222; x <= 326; x += 8) {
          ctx.beginPath();
          ctx.ellipse(x, 80, 3, 17, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
        draw.text(ctx, 'Coil (electromagnet)', 274, 48, { size: 12, color: colors.muted });
        // trip bar
        ctx.save();
        ctx.translate(TB.x, TB.y);
        ctx.rotate(-st.tilt);
        rect(ctx, -5, -70, 10, 135, '#94a3b8', '#e2e8f0', 3);
        ctx.restore();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(TB.x, TB.y, 3, 0, TAU);
        ctx.fill();
        draw.text(ctx, 'Trip bar', 300, 136, { size: 12, color: colors.muted });
        draw.text(ctx, '(iron armature)', 300, 151, { size: 10, color: colors.muted });
        // latch
        ctx.save();
        ctx.translate(TB.x + 6, 186);
        ctx.rotate(0.7 * latch);
        rect(ctx, 0, -3, 46, 7, colors.gold, null, 2);
        ctx.restore();
        draw.text(ctx, 'Latch', 372, 208, { size: 12, color: colors.gold });
        // moving contact arm
        draw.line(ctx, tail[0], tail[1], tip[0], tip[1], '#cbd5e1', 7);
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(PV.x, PV.y, 5, 0, TAU);
        ctx.fill();
        rect(ctx, 516, 240, 10, 20, '#e2e8f0', null, 2);
        rect(ctx, tip[0] - 5, tip[1] - 5, 10, 10, '#f8fafc', null, 2);
        // opening spring
        const sp0 = [500, 40],
          sp1 = [PV.x + 0.6 * (ARM[0] * ca - ARM[1] * sa), PV.y + 0.6 * (ARM[0] * sa + ARM[1] * ca)];
        const zz = [];
        for (let i = 0; i <= 12; i++) {
          const f = i / 12;
          const x = sp0[0] + (sp1[0] - sp0[0]) * f,
            y = sp0[1] + (sp1[1] - sp0[1]) * f;
          const off = i === 0 || i === 12 ? 0 : i % 2 ? 6 : -6;
          zz.push([x + off, y]);
        }
        poly(ctx, zz, '#64748b', 1.5);
        draw.text(ctx, 'spring', 520, 70, { size: 11, color: colors.muted, align: 'left' });
        draw.text(ctx, open > 0.5 ? 'Open contacts' : 'Closed contacts', 535, 222, { size: 12, weight: 700, color: open > 0.5 ? colors.bad : colors.good, align: 'left' });
        if (st.spark > 0) draw.text(ctx, '⚡', 520, 236, { size: 22, color: colors.current });
        draw.text(ctx, `Current: ${I.toFixed(0)} A`, 620, 30, { size: 13, weight: 700, color: I > 0 ? colors.current : colors.muted });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, {
      label: 'Situation',
      options: [{ value: 6, label: 'Normal (6 A)' }, { value: 15, label: 'Heavy load (15 A)' }, { value: 300, label: 'Fault: short circuit' }],
      value: 6,
      onChange: (v) => (st.demand = v),
    });
    EM.button(c, '↺ Reset the breaker', () => {
      st.tripped = false;
      st.trip = 0;
    });
    EM.toggle(c, { label: 'Slow motion', value: true, onChange: (v) => (st.slow = v) });
    const stt = EM.status(el);
    EM.every(150, () => {
      if (!st.tripped) stt.set(`Normal operation: current flows from line to load through the coil. The coil’s field is <strong>too weak</strong> to pull the trip bar, the latch holds the moving contact, the contacts stay closed.${st.demand > 6 ? ' (More current → the trip bar is pulled a little more, but not enough.)' : ''}`, 'good');
      else if (st.trip < 0.3) stt.set('<strong>Fault!</strong> A much larger current flows through the coil → the electromagnet becomes much stronger and attracts the trip bar…', 'warn');
      else if (st.trip < 0.6) stt.set('…the trip bar releases the latch…', 'warn');
      else if (st.demand >= ITRIP) stt.set('…the latch snaps open and the contacts separate, <strong>breaking the circuit</strong>. Current = 0. (Resetting while the fault is still there trips it again.)', 'warn');
      else stt.set('Tripped: the contacts are open. The fault is cleared, so press <em>Reset the breaker</em> to close the contacts again.');
    });
  }

  /* ================================================================== sims: the motor effect */

  /** DEMO: aluminium foil between the poles of a U-shaped magnet. */
  function simFoil(el) {
    const W = 700,
      H = 380,
      fx = 470,
      fy0 = 210;
    const st = { on: true, rev: false, nLeft: true, I: 3, y: fy0, v: 0 };
    const Bt = 0.2,
      Lm = 0.05;
    const cur = () => (st.on ? (st.rev ? -1 : 1) : 0); // +1 = towards the viewer of the front view
    const bdir = () => (st.nLeft ? 1 : -1);
    const fdir = () => cur() * bdir(); // +1 = up (z × x = y)
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Aluminium foil carrying a current between the poles of a U-shaped magnet',
      draw(ctx, s, dt) {
        const target = fy0 - fdir() * (st.I / 5) * (fdir() > 0 ? 125 : 72);
        st.v += ((target - st.y) * 60 - st.v * 9) * dt;
        st.y += st.v * dt;
        // ---- top view
        rect(ctx, 8, 8, 262, H - 16, '#0f172a', 'rgba(148,163,184,0.2)', 10);
        const nl = st.nLeft;
        rect(ctx, 34, 110, 72, 140, nl ? colors.north : colors.south, null, 6);
        rect(ctx, 164, 110, 72, 140, nl ? colors.south : colors.north, null, 6);
        draw.text(ctx, nl ? 'N' : 'S', 70, 180, { size: 20, weight: 800, color: '#fff' });
        draw.text(ctx, nl ? 'S' : 'N', 200, 180, { size: 20, weight: 800, color: '#fff' });
        for (let y = 126; y <= 236; y += 22) {
          const a = nl ? [110, 160] : [160, 110];
          draw.arrow(ctx, a[0], y, a[1], y, { color: colors.bfield, width: 1.5, head: 7 });
        }
        rect(ctx, 129, 40, 12, 262, '#cbd5e1', null, 2);
        const wTop = [[135, 40], [135, 22], [256, 22], [256, 318], [246, 318]];
        const wBot = [[135, 302], [135, 318], [166, 318]];
        draw.wire(ctx, wTop, colors.wire, 2.5);
        draw.wire(ctx, wBot, colors.wire, 2.5);
        rect(ctx, 166, 304, 80, 28, '#1e293b', '#64748b', 6);
        draw.text(ctx, 'DC supply', 206, 318, { size: 11, weight: 600 });
        draw.text(ctx, st.rev ? '+' : '−', 176, 344, { size: 14, weight: 700, color: st.rev ? colors.pos : colors.neg });
        draw.text(ctx, st.rev ? '−' : '+', 236, 344, { size: 14, weight: 700, color: st.rev ? colors.neg : colors.pos });
        if (cur()) {
          const path = [[246, 318], [256, 318], [256, 22], [135, 22], [135, 302], [135, 318], [166, 318]];
          draw.flowDots(ctx, path, s.t, { speed: (cur() > 0 ? 1 : -1) * (30 + st.I * 12), spacing: 22, r: 2.5 });
        }
        draw.text(ctx, 'Seen from above', 20, 356, { size: 11, color: colors.muted, align: 'left' });
        draw.text(ctx, 'foil', 116, 70, { size: 11, color: colors.muted });
        draw.text(ctx, '👁 front', 135, 344, { size: 11, color: colors.muted });
        // ---- front view
        rect(ctx, 280, 8, 412, H - 16, '#0f172a', 'rgba(148,163,184,0.2)', 10);
        const cN = nl ? colors.north : colors.south,
          cS = nl ? colors.south : colors.north;
        rect(ctx, 330, 300, 280, 50, '#475569', null, 8);
        rect(ctx, 330, 110, 90, 210, cN, null, 8);
        rect(ctx, 520, 110, 90, 210, cS, null, 8);
        draw.text(ctx, nl ? 'N' : 'S', 375, 140, { size: 22, weight: 800, color: '#fff' });
        draw.text(ctx, nl ? 'S' : 'N', 565, 140, { size: 22, weight: 800, color: '#fff' });
        draw.text(ctx, 'U-shaped magnet', 470, 330, { size: 12, weight: 600, color: '#e2e8f0' });
        for (let y = 130; y <= 290; y += 26) {
          const a = nl ? [424, 516] : [516, 424];
          draw.arrow(ctx, a[0], y, a[1], y, { color: 'rgba(167,139,250,0.75)', width: 1.5, head: 7 });
        }
        draw.text(ctx, 'B', nl ? 506 : 434, 302, { size: 14, weight: 700, color: colors.bfield });
        rect(ctx, fx - 24, st.y - 4, 48, 8, '#e2e8f0', null, 2);
        curSym(ctx, fx, st.y - 18, cur(), 9, cur() ? colors.current : '#64748b');
        if (cur()) {
          const F = fdir();
          const len = 30 + st.I * 10;
          draw.arrow(ctx, fx + 40, st.y, fx + 40, st.y - F * len, { color: colors.force, width: 4, label: 'F' });
          draw.text(ctx, cur() > 0 ? 'I towards you' : 'I away from you', fx - 40, st.y - 18, { size: 11, color: colors.current, align: 'right' });
        }
        draw.text(ctx, 'Seen from the front (looking along the foil)', 292, 26, { size: 11, color: colors.muted, align: 'left' });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Power supply on', value: true, onChange: (v) => (st.on = v) });
    EM.segmented(c, { label: 'Supply connections', options: [{ value: false, label: 'Normal' }, { value: true, label: 'Reversed' }], value: false, onChange: (v) => (st.rev = v) });
    EM.segmented(c, { label: 'Magnet', options: [{ value: true, label: 'N on left' }, { value: false, label: 'Turned round' }], value: true, onChange: (v) => (st.nLeft = v) });
    EM.slider(c, { label: 'Current', min: 0.5, max: 5, step: 0.5, value: 3, unit: 'A', onInput: (v) => (st.I = v) });
    const ro = EM.readout(el, [
      { key: 'F', label: 'F = BIL (B = 0.2 T, L = 5 cm)' },
      { key: 'd', label: 'Foil moves' },
    ]);
    const stt = EM.status(el);
    EM.every(200, () => {
      const F = st.on ? Bt * st.I * Lm : 0;
      ro.set('F', EM.fmt(F, 3) + ' N');
      ro.set('d', !st.on ? 'stays still' : fdir() > 0 ? '⬆ up, out of the magnet' : '⬇ down, into the magnet');
      if (!st.on) stt.set('No current → no force on the foil.');
      else stt.set(`Field ${nl()} and current ${cur() > 0 ? 'towards you' : 'away from you'} → by Fleming’s left-hand rule the force is <strong>${fdir() > 0 ? 'upwards' : 'downwards'}</strong>. Reverse either the current or the field and the force reverses.`, fdir() > 0 ? 'good' : 'warn');
    });
    const nl = () => (st.nLeft ? 'left → right (N to S)' : 'right → left (N to S)');
  }

  /** Interactive Fleming's left-hand rule in 3D. */
  function simFLHR(el) {
    const W = 640,
      H = 330,
      O = { x: 230, y: 175 },
      S = 105;
    const DIRS = {
      right: { v: [1, 0, 0], label: 'Right →' },
      left: { v: [-1, 0, 0], label: 'Left ←' },
      up: { v: [0, 1, 0], label: 'Up ↑' },
      down: { v: [0, -1, 0], label: 'Down ↓' },
      out: { v: [0, 0, 1], label: 'Out of page ⊙' },
      in: { v: [0, 0, -1], label: 'Into page ⊗' },
    };
    const st = { B: 'right', I: 'out', quiz: false, answered: null };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const proj = (v, k = 1) => [O.x + k * S * (v[0] - 0.5 * v[2]), O.y + k * S * (-v[1] + 0.38 * v[2])];
    const nameOf = (v) => Object.keys(DIRS).find((k) => DIRS[k].v.every((x, i) => x === v[i]));
    const force = () => cross(DIRS[st.I].v, DIRS[st.B].v);
    function arrow3(ctx, v, color, label, idx) {
      const [x, y] = proj(v);
      draw.arrow(ctx, O.x, O.y, x, y, { color, width: 5, head: 15 });
      if (v[2]) curSym(ctx, x + (v[2] > 0 ? -14 : 14), y + 4, v[2], 8, color);
      const [lx, ly] = proj(v, 1.32);
      const al = v[0] > 0 || v[2] < 0 ? 'left' : v[0] < 0 || v[2] > 0 ? 'right' : 'center';
      draw.text(ctx, label, lx + (al === 'left' ? -14 : al === 'right' ? 14 : 0), ly + idx * 2, { size: 13, weight: 700, color, align: al, bg: 'rgba(11,18,32,0.8)' });
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Fleming’s left-hand rule in three dimensions',
      draw(ctx) {
        for (const k of ['right', 'up', 'out']) {
          const a = proj(DIRS[k].v, 1.15),
            b = proj(DIRS[k].v.map((x) => -x), 1.15);
          draw.line(ctx, a[0], a[1], b[0], b[1], 'rgba(148,163,184,0.25)', 1, [4, 5]);
        }
        const pIn = proj([0, 0, -1], 1.15),
          pOut = proj([0, 0, 1], 1.15);
        draw.text(ctx, 'into page', pIn[0] + 6, pIn[1] - 10, { size: 10, color: colors.muted, align: 'left' });
        draw.text(ctx, 'out of page', pOut[0] - 4, pOut[1] + 12, { size: 10, color: colors.muted, align: 'right' });
        const F = force();
        arrow3(ctx, DIRS[st.B].v, colors.bfield, 'Field (First finger)', 0);
        arrow3(ctx, DIRS[st.I].v, colors.current, 'Current (seCond finger)', 1);
        const zero = F.every((x) => x === 0);
        if (!zero && (!st.quiz || st.answered)) arrow3(ctx, F, colors.force, 'Motion (thuMb)', 2);
        if (st.quiz && !st.answered) draw.text(ctx, '?', ...proj([0, 0, 0]).map((x, i) => x + (i ? -24 : 24)), { size: 22, weight: 800, color: colors.force });
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(O.x, O.y, 4, 0, TAU);
        ctx.fill();
        const x0 = 440;
        draw.text(ctx, 'LEFT hand, fingers at 90°:', x0, 40, { size: 13, weight: 700, align: 'left' });
        draw.text(ctx, 'First finger → Field', x0, 66, { size: 13, align: 'left', color: colors.bfield });
        draw.text(ctx, 'seCond finger → Current', x0, 88, { size: 13, align: 'left', color: colors.current });
        draw.text(ctx, 'thuMb → Motion (force)', x0, 110, { size: 13, align: 'left', color: colors.force });
        draw.text(ctx, 'Field: N → S', x0, 146, { size: 12, align: 'left', color: colors.muted });
        draw.text(ctx, 'Current: + → − (conventional)', x0, 166, { size: 12, align: 'left', color: colors.muted });
        if (zero) draw.text(ctx, 'Current parallel to field → NO force', x0, 210, { size: 13, weight: 700, align: 'left', color: colors.warn });
        else if (!st.quiz || st.answered) draw.text(ctx, 'Force: ' + DIRS[nameOf(F)].label, x0, 210, { size: 15, weight: 700, align: 'left', color: colors.force });
      },
    });
    const c = EM.controls(el);
    const opts = Object.entries(DIRS).map(([value, d]) => ({ value, label: d.label }));
    const selB = EM.select(c, { label: 'Field B points', options: opts, value: 'right', onChange: (v) => ((st.B = v), (st.quiz = false)) });
    const selI = EM.select(c, { label: 'Current I flows', options: opts, value: 'out', onChange: (v) => ((st.I = v), (st.quiz = false)) });
    EM.button(c, '🎲 Test me', () => {
      const keys = Object.keys(DIRS);
      do {
        st.B = keys[Math.floor(Math.random() * 6)];
        st.I = keys[Math.floor(Math.random() * 6)];
      } while (force().every((x) => x === 0));
      selB.set(st.B);
      selI.set(st.I);
      st.quiz = true;
      st.answered = null;
      ans.hidden = false;
    }, 'primary');
    const ans = EM.controls(el);
    ans.hidden = true;
    ans.append(h('span', { class: 'ctl-label', text: 'Which way is the force?' }));
    for (const [k, d] of Object.entries(DIRS))
      EM.button(ans, d.label, () => {
        if (!st.quiz) return;
        st.answered = k;
        const right = nameOf(force()) === k;
        stt.set(right ? '✓ Correct! Press <em>Test me</em> for another.' : `✗ Not quite — the force is <strong>${DIRS[nameOf(force())].label}</strong>. Line up your first finger with the field and second finger with the current; your thumb gives the force.`, right ? 'good' : 'bad');
      });
    const stt = EM.status(el, 'Choose the field and current directions — the thumb (force) follows. Or press <em>Test me</em> to practise.');
  }

  /** Virtual investigation: two parallel current-carrying wires. */
  function simParallel(el) {
    const W = 680,
      H = 360,
      yT = 40,
      yB = 310,
      yM = 175;
    const st = { I1: 10, I2: 10, same: true, d: 8, b1: 0, b2: 0 };
    const curve = (x, b) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push([x + 4 * b * t * (1 - t), yT + (yB - yT) * t]);
      }
      return pts;
    };
    const FperL = () => (2e-7 * st.I1 * st.I2) / (st.d / 100);
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Two parallel wires carrying currents',
      draw(ctx, s, dt) {
        const dpx = 40 + st.d * 12;
        const x1 = W / 2 - dpx / 2,
          x2 = W / 2 + dpx / 2;
        const sgn = st.same ? 1 : -1; // +1 attract
        const mag = Math.min(22, FperL() * 6000);
        st.b1 += (sgn * mag - st.b1) * Math.min(1, 6 * dt);
        st.b2 += (-sgn * mag - st.b2) * Math.min(1, 6 * dt);
        const w1 = curve(x1, st.b1),
          w2 = curve(x2, st.b2);
        const d2 = st.same ? 1 : -1;
        // field rings (behind)
        const ring = (x, y, up, label) => {
          for (const [rx, ry] of [[22, 6], [44, 12], [66, 18]]) {
            ctx.save();
            ctx.strokeStyle = 'rgba(167,139,250,0.75)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
            ellipseArrow(ctx, x, y, rx, ry, Math.PI / 2, !up, colors.bfield);
          }
          draw.text(ctx, label, x - 84, y - 6, { size: 13, weight: 700, color: colors.bfield });
        };
        ring(x1, 105, true, 'B₁');
        ring(x2, 245, d2 > 0, 'B₂');
        draw.wire(ctx, w1, '#3b82f6', 7);
        draw.wire(ctx, w2, '#3b82f6', 7);
        draw.flowDots(ctx, w1.slice().reverse(), s.t, { speed: 20 + st.I1 * 4, spacing: 22 });
        draw.flowDots(ctx, d2 > 0 ? w2.slice().reverse() : w2, s.t, { speed: 20 + st.I2 * 4, spacing: 22 });
        draw.arrow(ctx, x1, yT, x1, yT - 26, { color: colors.current, width: 2.5 });
        draw.text(ctx, 'I₁', x1 + 16, yT - 18, { size: 13, weight: 700, color: colors.current });
        if (d2 > 0) {
          draw.arrow(ctx, x2, yT, x2, yT - 26, { color: colors.current, width: 2.5 });
          draw.text(ctx, 'I₂', x2 + 16, yT - 18, { size: 13, weight: 700, color: colors.current });
        } else {
          draw.arrow(ctx, x2, yB, x2, yB + 26, { color: colors.current, width: 2.5 });
          draw.text(ctx, 'I₂', x2 + 16, yB + 18, { size: 13, weight: 700, color: colors.current });
        }
        const len = 18 + 34 * Math.min(1, mag / 22);
        const m1 = x1 + st.b1,
          m2 = x2 + st.b2;
        draw.arrow(ctx, m1 + (st.same ? 10 : -10), yM, m1 + (st.same ? 10 + len : -10 - len), yM, { color: colors.force, width: 4 });
        draw.arrow(ctx, m2 + (st.same ? -10 : 10), yM, m2 + (st.same ? -10 - len : 10 + len), yM, { color: colors.force, width: 4 });
        draw.text(ctx, 'F₁', m1 + (st.same ? 24 : -24), yM + 20, { size: 13, weight: 700, color: colors.force });
        draw.text(ctx, 'F₂', m2 + (st.same ? -24 : 24), yM + 20, { size: 13, weight: 700, color: colors.force });
        draw.line(ctx, x1, 336, x2, 336, colors.muted, 1.2);
        draw.arrow(ctx, W / 2, 336, x1 + 1, 336, { color: colors.muted, width: 1.2, head: 7 });
        draw.arrow(ctx, W / 2, 336, x2 - 1, 336, { color: colors.muted, width: 1.2, head: 7 });
        draw.text(ctx, `d = ${st.d} cm`, W / 2, 348, { size: 12, color: colors.muted, bg: 'rgba(11,18,32,0.9)' });
        draw.text(ctx, st.same ? 'Same direction → ATTRACT' : 'Opposite directions → REPEL', W / 2, 18, { size: 14, weight: 700, color: st.same ? colors.good : colors.warn, bg: 'rgba(11,18,32,0.85)' });
      },
    });
    const c = EM.controls(el);
    EM.segmented(c, { label: 'Currents flow in', options: [{ value: true, label: 'Same direction' }, { value: false, label: 'Opposite directions' }], value: true, onChange: (v) => (st.same = v) });
    EM.slider(c, { label: 'I₁', min: 1, max: 20, step: 1, value: 10, unit: 'A', onInput: (v) => (st.I1 = v) });
    EM.slider(c, { label: 'I₂', min: 1, max: 20, step: 1, value: 10, unit: 'A', onInput: (v) => (st.I2 = v) });
    EM.slider(c, { label: 'Separation d', min: 2, max: 20, step: 1, value: 8, unit: 'cm', onInput: (v) => (st.d = v) });
    const ro = EM.readout(el, [
      { key: 'B', label: 'B from wire 1 at wire 2' },
      { key: 'F', label: 'Force on each metre of wire' },
    ]);
    const stt = EM.status(el);
    EM.every(200, () => {
      ro.set('B', EM.fmt((2e-7 * st.I1) / (st.d / 100), 3) + ' T');
      ro.set('F', EM.fmt(FperL(), 3) + ' N');
      stt.set(`Each wire sits in the magnetic field of the other, so each feels a force (F = BIL). ${st.same ? 'Currents in the <strong>same direction attract</strong>.' : 'Currents in <strong>opposite directions repel</strong>.'} The forces are equal and opposite. Bigger currents or a smaller gap → bigger force.`, st.same ? 'good' : 'warn');
    });
  }

  /** Virtual investigation: path of a charged particle in a uniform magnetic field. */
  function simParticle(el) {
    const W = 700,
      H = 400,
      X0 = 140,
      e = 1.6e-19;
    const TYPES = {
      proton: { q: e, m: 1.67e-27, name: 'Proton (+)', bu: 'T' },
      alpha: { q: 2 * e, m: 6.64e-27, name: 'Alpha particle (2+)', bu: 'T' },
      electron: { q: -e, m: 9.11e-31, name: 'Electron (−)', bu: 'mT' },
    };
    const st = { type: 'proton', v: 2, B: 0.2, into: true, x: 30, y: 200, vx: 1, vy: 0, trail: [], wait: 0 };
    const P = () => TYPES[st.type];
    const Btesla = () => st.B * (P().bu === 'mT' ? 1e-3 : 1);
    const rReal = () => (P().m * st.v * 1e6) / (Math.abs(P().q) * Btesla());
    const reset = () => {
      Object.assign(st, { x: 30, y: 200, vx: 1, vy: 0, trail: [], wait: 0 });
    };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Charged particle moving in a magnetic field',
      draw(ctx, s, dt) {
        ctx.fillStyle = 'rgba(167,139,250,0.06)';
        ctx.fillRect(X0, 0, W - X0, H);
        draw.bGrid(ctx, X0, 0, W - X0, H, st.into ? 'in' : 'out', 40);
        draw.line(ctx, X0, 0, X0, H, 'rgba(167,139,250,0.6)', 1.5, [6, 5]);
        draw.text(ctx, `B ${st.into ? 'into' : 'out of'} the page`, X0 + 8, 18, { size: 12, color: colors.bfield, align: 'left', bg: 'rgba(11,18,32,0.85)' });
        const rpx = rReal() * 1000;
        const vpx = 45 + 25 * st.v;
        const sq = Math.sign(P().q);
        const omega = (-sq * (st.into ? 1 : -1) * vpx) / rpx;
        if (st.wait > 0) {
          st.wait -= dt;
          if (st.wait <= 0) reset();
        } else {
          const n = 8;
          for (let i = 0; i < n; i++) {
            const h = dt / n;
            if (st.x >= X0) {
              const a = omega * h,
                c = Math.cos(a),
                sn = Math.sin(a);
              [st.vx, st.vy] = [st.vx * c - st.vy * sn, st.vx * sn + st.vy * c];
            }
            st.x += st.vx * vpx * h;
            st.y += st.vy * vpx * h;
          }
          st.trail.push([st.x, st.y]);
          if (st.trail.length > 900) st.trail.shift();
          if (st.x < -20 || st.x > W + 20 || st.y < -20 || st.y > H + 20) st.wait = 0.6;
        }
        poly(ctx, st.trail, sq > 0 ? 'rgba(248,113,113,0.8)' : 'rgba(96,165,250,0.8)', 2, [6, 4]);
        const inF = st.x >= X0;
        if (inF) {
          const cxp = st.x + (-st.vy * vpx) / omega,
            cyp = st.y + (st.vx * vpx) / omega;
          if (rpx < 900) {
            draw.line(ctx, st.x, st.y, cxp, cyp, 'rgba(226,232,240,0.35)', 1, [3, 4]);
            ctx.fillStyle = 'rgba(226,232,240,0.6)';
            ctx.beginPath();
            ctx.arc(cxp, cyp, 3, 0, TAU);
            ctx.fill();
          }
          const fx = -st.vy * Math.sign(omega),
            fy = st.vx * Math.sign(omega);
          draw.arrow(ctx, st.x, st.y, st.x + fx * 44, st.y + fy * 44, { color: colors.force, width: 3, label: 'F' });
        }
        draw.arrow(ctx, st.x, st.y, st.x + st.vx * 48, st.y + st.vy * 48, { color: colors.velocity, width: 3, label: 'v' });
        draw.charge(ctx, st.x, st.y, sq, { r: 10 });
        draw.line(ctx, 20, 380, 120, 380, colors.text, 2);
        draw.line(ctx, 20, 374, 20, 386, colors.text, 2);
        draw.line(ctx, 120, 374, 120, 386, colors.text, 2);
        draw.text(ctx, '10 cm', 70, 366, { size: 11, color: colors.muted });
      },
    });
    const c = EM.controls(el);
    let bSl;
    EM.select(c, {
      label: 'Particle',
      options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.name })),
      value: 'proton',
      onChange: (v) => {
        st.type = v;
        bSl.el.querySelector('.ctl-value').innerHTML = EM.fmt(st.B) + ' ' + P().bu;
        reset();
      },
    });
    EM.slider(c, { label: 'Speed v', min: 0.5, max: 5, step: 0.1, value: 2, fmt: (v) => v.toFixed(1) + ' × 10<sup>6</sup>', unit: 'm/s', onInput: (v) => ((st.v = v), reset()) });
    bSl = EM.slider(c, { label: 'Flux density B', min: 0.05, max: 0.5, step: 0.01, value: 0.2, fmt: (v) => v.toFixed(2) + ' ' + (P ? P().bu : 'T'), onInput: (v) => ((st.B = v), reset()) });
    EM.segmented(c, { label: 'Field', options: [{ value: true, label: 'Into page ⊗' }, { value: false, label: 'Out of page ⊙' }], value: true, onChange: (v) => ((st.into = v), reset()) });
    EM.button(c, '↺ Fire again', reset);
    const ro = EM.readout(el, [
      { key: 'F', label: 'F = qvB' },
      { key: 'r', label: 'r = mv / qB' },
      { key: 'v', label: 'Speed in the field' },
    ]);
    const stt = EM.status(el);
    EM.every(200, () => {
      const t = P();
      const F = Math.abs(t.q) * st.v * 1e6 * Btesla();
      ro.set('F', EM.fmt(F, 3) + ' N');
      ro.set('r', EM.fmt(rReal(), 3) + ' m');
      ro.set('v', EM.fmt(st.v * 1e6, 2) + ' m/s (constant)');
      const up = Math.sign(t.q) * (st.into ? 1 : -1) > 0;
      stt.set(`${t.name}: on entering the field the force is <strong>${up ? 'upwards' : 'downwards'}</strong>, at 90° to v. It only changes the direction of motion, never the speed, so the particle moves in a circle of radius r = mv/qB.`, 'good');
    });
  }

  /* ================================================================== sims: Earth's field */

  function simEarth(el) {
    const W = 700,
      H = 400,
      E = { x: 440, y: 205 },
      Re = 40,
      TILT = 11 * DEG,
      NOSE = 312;
    const st = { field: true, inside: false, magnet: false, parts: [], auroraN: 0, auroraS: 0, atm: 1, hits: [], acc: 0 };
    const R = Math.random;
    const rotP = (x, y) => {
      const dx = x - E.x,
        dy = y - E.y;
      return [E.x + dx * Math.cos(TILT) - dy * Math.sin(TILT), E.y + dx * Math.sin(TILT) + dy * Math.cos(TILT)];
    };
    const boundX = (y) => NOSE + ((y - E.y) * (y - E.y)) / 80;
    // dipole field lines (out of the southern hemisphere, into the northern one)
    const lines = [];
    for (const L of [1.5, 2.1, 2.9]) {
      const lm = Math.acos(Math.sqrt(1 / L));
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 60; i++) {
          const lam = -lm + (2 * lm * i) / 60;
          const r = L * Re * Math.cos(lam) * Math.cos(lam);
          const k = side < 0 ? 0.88 : 1 + 0.18 * L;
          pts.push(rotP(E.x + side * r * Math.cos(lam) * k, E.y - r * Math.sin(lam)));
        }
        lines.push({ points: pts, dir: 1 });
      }
    }
    for (const [lat, off] of [[62, 34], [68, 62], [73, 92]]) {
      for (const hemi of [-1, 1]) {
        const a = lat * DEG;
        const p0 = rotP(E.x + Re * Math.cos(a) * 0.4, E.y + hemi * Re * Math.sin(a));
        const pts = [];
        for (let i = 0; i <= 30; i++) {
          const t = i / 30;
          const x = p0[0] + (W + 10 - p0[0]) * t;
          const y = p0[1] + (E.y + hemi * off - p0[1]) * (1 - Math.pow(1 - t, 3));
          pts.push([x, y]);
        }
        lines.push({ points: pts, dir: hemi < 0 ? -1 : 1 });
      }
    }
    const poleN = rotP(E.x, E.y - Re - 5),
      poleS = rotP(E.x, E.y + Re + 5);
    function spawn() {
      st.parts.push({ x: 70 + R() * 10, y: 15 + R() * (H - 30), mode: 'wind', sign: R() < 0.5 ? 1 : -1, t: 0 });
    }
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Earth’s magnetic field shielding it from the solar wind',
      draw(ctx, s, dt) {
        // sun
        const g = ctx.createRadialGradient(-70, 200, 20, -70, 200, 150);
        g.addColorStop(0, '#fff7ed');
        g.addColorStop(0.6, '#f59e0b');
        g.addColorStop(1, 'rgba(245,158,11,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(-70, 200, 150, 0, TAU);
        ctx.fill();
        draw.text(ctx, 'Sun', 28, 200, { size: 14, weight: 800, color: '#7c2d12' });
        draw.text(ctx, 'solar wind →', 130, 22, { size: 12, color: colors.current });
        if (st.field) {
          ctx.save();
          ctx.beginPath();
          for (let y = -10; y <= H + 10; y += 5) (y === -10 ? ctx.moveTo : ctx.lineTo).call(ctx, boundX(y), y);
          ctx.lineTo(W + 20, H + 10);
          ctx.lineTo(W + 20, -10);
          ctx.closePath();
          ctx.fillStyle = 'rgba(167,139,250,0.07)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(167,139,250,0.6)';
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
          draw.text(ctx, 'magnetosphere', 560, 40, { size: 12, color: colors.bfield, bg: 'rgba(11,18,32,0.8)' });
          draw.fieldLines(ctx, lines, { color: colors.bfield, width: 1.4, arrowEvery: 70, alpha: 0.75 });
        }
        // particles
        st.acc += dt * 32;
        while (st.acc > 1) {
          st.acc--;
          if (st.parts.length < 140) spawn();
        }
        for (const p of st.parts) {
          p.t += dt;
          if (p.mode === 'wind') {
            p.x += 130 * dt;
            if (st.field && p.x >= boundX(p.y)) {
              if (R() < 0.2) {
                p.mode = 'funnel';
                p.north = p.y < E.y || (p.y === E.y && R() < 0.5);
                p.ax = p.x;
                p.ay = p.y;
                p.u = 0;
              } else {
                p.mode = 'flow';
                p.side = p.y < E.y ? -1 : 1;
              }
            } else if (!st.field && Math.hypot(p.x - E.x, p.y - E.y) < Re + 9) {
              p.dead = true;
              st.hits.push({ x: p.x, y: p.y, t: 0.4 });
              st.atm = Math.max(0.12, st.atm - 0.004);
            }
          } else if (p.mode === 'flow') {
            p.x += 130 * dt;
            const yy = E.y + p.side * Math.sqrt(Math.max(0, (p.x - NOSE) * 80)) * 1.06 + p.side * 4;
            p.y += (yy - p.y) * Math.min(1, 8 * dt);
          } else if (p.mode === 'funnel') {
            p.u += dt / 1.8;
            const Q = p.north ? poleN : poleS;
            const C = [E.x - 40, p.north ? E.y - 140 : E.y + 140];
            const u = Math.min(1, p.u),
              v = 1 - u;
            const bx = v * v * p.ax + 2 * v * u * C[0] + u * u * Q[0],
              by = v * v * p.ay + 2 * v * u * C[1] + u * u * Q[1];
            p.x = bx + Math.cos(p.t * 30) * 5 * v;
            p.y = by + Math.sin(p.t * 30) * 5 * v;
            if (u >= 1) {
              p.dead = true;
              if (p.north) st.auroraN = Math.min(1, st.auroraN + 0.2);
              else st.auroraS = Math.min(1, st.auroraS + 0.2);
            }
          }
          if (p.x > W + 10 || p.y < -20 || p.y > H + 20) p.dead = true;
        }
        st.parts = st.parts.filter((p) => !p.dead);
        for (const p of st.parts) {
          ctx.fillStyle = p.sign > 0 ? 'rgba(248,113,113,0.9)' : 'rgba(96,165,250,0.9)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.2, 0, TAU);
          ctx.fill();
        }
        if (st.field) st.atm = Math.min(1, st.atm + dt * 0.05);
        st.auroraN = Math.max(0, st.auroraN - dt * 0.25);
        st.auroraS = Math.max(0, st.auroraS - dt * 0.25);
        // atmosphere + Earth
        ctx.save();
        ctx.fillStyle = `rgba(56,189,248,${0.28 * st.atm})`;
        ctx.beginPath();
        ctx.arc(E.x, E.y, Re + 9 * st.atm + 2, 0, TAU);
        ctx.fill();
        ctx.restore();
        if (st.inside) {
          for (const [r, c] of [[Re, '#92400e'], [Re * 0.55, '#f97316'], [Re * 0.2, '#fde047']]) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(E.x, E.y, r, 0, TAU);
            ctx.fill();
          }
        } else {
          const eg = ctx.createRadialGradient(E.x - 12, E.y - 12, 4, E.x, E.y, Re);
          eg.addColorStop(0, '#60a5fa');
          eg.addColorStop(1, '#1d4ed8');
          ctx.fillStyle = eg;
          ctx.beginPath();
          ctx.arc(E.x, E.y, Re, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#16a34a';
          for (const [dx, dy, rx, ry] of [[-12, -14, 12, 8], [10, 4, 9, 14], [-8, 16, 7, 6]]) {
            ctx.beginPath();
            ctx.ellipse(E.x + dx, E.y + dy, rx, ry, 0.3, 0, TAU);
            ctx.fill();
          }
        }
        if (st.magnet) draw.magnet(ctx, E.x, E.y, Re * 1.7, 12, Math.PI / 2 + TILT);
        // aurora
        for (const [a, pole, hemi] of [[st.auroraN, poleN, -1], [st.auroraS, poleS, 1]]) {
          if (a < 0.02) continue;
          ctx.save();
          ctx.shadowColor = '#4ade80';
          ctx.shadowBlur = 16;
          ctx.strokeStyle = `rgba(74,222,128,${0.3 + 0.7 * a})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          const ca = hemi * (Math.PI / 2) + TILT;
          ctx.arc(E.x, E.y, Re + 7, ca - 0.55, ca + 0.55);
          ctx.stroke();
          ctx.restore();
        }
        for (const ht of st.hits) {
          ht.t -= dt;
          ctx.fillStyle = `rgba(253,224,71,${Math.max(0, ht.t * 2)})`;
          ctx.beginPath();
          ctx.arc(ht.x, ht.y, 5, 0, TAU);
          ctx.fill();
        }
        st.hits = st.hits.filter((x) => x.t > 0);
        draw.text(ctx, 'Geographic N', E.x - 70, E.y - Re - 22, { size: 11, color: colors.muted });
        if (st.auroraN > 0.15) draw.text(ctx, 'aurora borealis', E.x + 60, E.y - Re - 18, { size: 11, weight: 700, color: '#4ade80', align: 'left' });
        if (st.auroraS > 0.15) draw.text(ctx, 'aurora australis', E.x + 60, E.y + Re + 18, { size: 11, weight: 700, color: '#4ade80', align: 'left' });
        if (st.inside) {
          draw.line(ctx, E.x + 4, E.y + 4, 520, 330, 'rgba(226,232,240,0.6)', 1);
          draw.text(ctx, 'inner core: iron, ≈ 20% of Earth’s radius', 524, 330, { size: 11, align: 'left', color: '#fde047', bg: 'rgba(11,18,32,0.85)' });
          draw.line(ctx, E.x + 16, E.y + 10, 540, 352, 'rgba(226,232,240,0.6)', 1);
          draw.text(ctx, 'outer core: fluid iron + nickel', 544, 352, { size: 11, align: 'left', color: '#fb923c', bg: 'rgba(11,18,32,0.85)' });
        }
        draw.text(ctx, 'sunlit side: field reaches ≈ 60 000–65 000 km', 150, 386, { size: 11, align: 'left', color: colors.muted, bg: 'rgba(11,18,32,0.85)' });
        draw.text(ctx, 'magnetotail: > 6 million km →', 690, 386, { size: 11, align: 'right', color: colors.muted, bg: 'rgba(11,18,32,0.85)' });
        draw.text(ctx, 'not to scale', 690, 16, { size: 10, align: 'right', color: colors.muted });
        if (!st.field) draw.text(ctx, 'NO MAGNETIC FIELD: particles hit the atmosphere directly', 420, 52, { size: 13, weight: 700, color: colors.bad, bg: 'rgba(11,18,32,0.9)' });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Earth’s magnetic field', value: true, onChange: (v) => (st.field = v) });
    EM.toggle(c, { label: 'Show the core', value: false, onChange: (v) => (st.inside = v) });
    EM.toggle(c, { label: 'Show the “bar magnet”', value: false, onChange: (v) => (st.magnet = v) });
    const stt = EM.status(el);
    EM.every(300, () => {
      if (!st.field) stt.set('Without the field, high-energy particles would strip away the ozone layer, fry power grids and knock out satellites. Over time the solar wind would strip the atmosphere away, leaving a cold, barren rock like Mars.', 'bad');
      else if (st.magnet) stt.set('Earth behaves as if it had a giant bar magnet inside, tilted slightly. Field lines come <em>out</em> near the geographic south and go <em>in</em> near the geographic north — so the magnetic pole in the Arctic is actually a magnetic <strong>south</strong> pole (that is why it attracts the N end of a compass).', 'good');
      else if (st.inside) stt.set('Inner core: a ball of iron about 20% of Earth’s radius. Outer core: fluid iron and nickel. The flow of this material generates electric currents, which in turn produce Earth’s magnetic field.', 'good');
      else stt.set('The magnetosphere deflects most of the solar wind around the Earth. Some particles are steered along the field lines to the polar regions, where they light up the aurora.', 'good');
    });
  }

  /** Aurora mechanism: step-by-step atom picture. */
  function simAurora(el) {
    const W = 640,
      H = 220,
      A = { x: 430, y: 110 };
    const st = { step: 0, t: 0 };
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'How an aurora produces light',
      draw(ctx, s, dt) {
        st.t += dt;
        const t = st.t;
        if (st.step === 4) {
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W, H);
          for (let i = 0; i < 70; i++) {
            const x = 20 + i * 8.6;
            const top = 30 + 22 * Math.sin(i * 0.25 + t * 0.8) + 10 * Math.sin(i * 0.7 - t * 1.3);
            const gr = ctx.createLinearGradient(0, top, 0, top + 120);
            gr.addColorStop(0, 'rgba(244,63,94,0.0)');
            gr.addColorStop(0.15, 'rgba(244,63,94,0.35)');
            gr.addColorStop(0.35, 'rgba(74,222,128,0.75)');
            gr.addColorStop(1, 'rgba(74,222,128,0)');
            ctx.fillStyle = gr;
            ctx.fillRect(x, top, 7, 120);
          }
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.moveTo(0, H);
          for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 190 - 12 * Math.sin(x * 0.02) - 8 * Math.sin(x * 0.07));
          ctx.lineTo(W, H);
          ctx.fill();
          return;
        }
        if (st.step === 0) {
          const ex = 320,
            ey = 110;
          ctx.fillStyle = '#2563eb';
          ctx.beginPath();
          ctx.arc(ex, ey, 34, 0, TAU);
          ctx.fill();
          for (const k of [1.8, 2.6]) {
            ctx.save();
            ctx.strokeStyle = 'rgba(167,139,250,0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(ex, ey, 34 * k, 34 * k * 0.75, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
          }
          for (let i = 0; i < 10; i++) {
            const u = (t * 0.35 + i / 10) % 1;
            const north = i % 2 === 0;
            const x = 40 + (ex - 40) * u;
            const y = 110 + (north ? -1 : 1) * (60 * Math.sin(Math.PI * u * 0.9)) * (u > 0.6 ? (1 - u) / 0.4 + 0.35 : 1) + Math.sin(u * 60) * 4;
            ctx.fillStyle = i % 3 ? 'rgba(248,113,113,0.9)' : 'rgba(96,165,250,0.9)';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, TAU);
            ctx.fill();
          }
          draw.text(ctx, 'Earth', ex, ey, { size: 12, weight: 700 });
          draw.text(ctx, 'particles from the Sun → steered towards the poles', W / 2, 205, { size: 12, color: colors.muted });
          return;
        }
        // atom
        ctx.save();
        ctx.strokeStyle = 'rgba(148,163,184,0.5)';
        ctx.setLineDash([4, 5]);
        for (const r of [36, 72]) {
          ctx.beginPath();
          ctx.arc(A.x, A.y, r, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
        draw.charge(ctx, A.x, A.y, 1, { r: 12 });
        draw.text(ctx, 'atom in the upper atmosphere (e.g. oxygen)', A.x, 205, { size: 11, color: colors.muted });
        draw.text(ctx, 'higher energy level', A.x + 80, A.y - 64, { size: 10, color: colors.muted, align: 'left' });
        draw.text(ctx, 'lower level', A.x + 44, A.y + 34, { size: 10, color: colors.muted, align: 'left' });
        let r = 36;
        if (st.step === 1) {
          const u = Math.min(1, t / 1.6);
          draw.electron(ctx, 40 + (A.x - 110 - 40) * u, A.y + 10 - 10 * u, 5, '#f87171');
          draw.text(ctx, 'fast charged particle', 90, 70, { size: 11, color: '#f87171' });
        }
        if (st.step === 2) r = 36 + 36 * Math.min(1, t / 0.8);
        if (st.step === 3) {
          r = 72 - 36 * Math.min(1, t / 0.5);
          const u = Math.max(0, t - 0.4);
          if (u > 0) {
            ctx.save();
            ctx.strokeStyle = '#4ade80';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            const x0 = A.x - 80 - u * 140;
            for (let i = 0; i <= 60; i++) {
              const x = x0 + i * 1.5;
              const y = A.y - 30 + 8 * Math.sin(i * 0.6);
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
            draw.text(ctx, 'light (photon)', Math.max(70, A.x - 80 - u * 140), A.y - 52, { size: 12, weight: 700, color: '#4ade80' });
          }
        }
        const ang = t * 2.2;
        draw.electron(ctx, A.x + r * Math.cos(ang), A.y + r * Math.sin(ang), 5);
      },
    });
    EM.stepper(
      el,
      [
        { title: 'Deflected to the poles', html: 'Charged particles from the Sun (the solar wind) meet Earth’s magnetic field and are deflected towards the poles.' },
        { title: 'Collision', html: 'Near the poles they crash into atoms in Earth’s upper atmosphere.' },
        { title: 'Excitation', html: 'The energy <strong>excites</strong> electrons in these atoms: they jump to <strong>higher energy states</strong>.' },
        { title: 'Emission', html: 'When the electrons return to their lower energy states they release the energy as <strong>electromagnetic radiation</strong> — light we can see.' },
        { title: 'Aurora', html: 'Countless atoms doing this make shimmering curtains of light: the <strong>aurora borealis</strong> (northern hemisphere) and the <strong>aurora australis</strong> (southern hemisphere).' },
      ],
      (i) => {
        st.step = i;
        st.t = 0;
      }
    );
  }

  /* ================================================================== sims: DC motor */

  function simMotor(el) {
    const W = 700,
      H = 380,
      C = { x: 225, y: 190 },
      R = 100,
      K = { x: 575, y: 150 },
      GAP = 10 * DEG;
    const st = { on: true, split: true, rev: false, I: 2, slow: true, a: Math.PI - 0.35, w: 0, frozen: false };
    const s1 = () => {
      if (!st.on) return 0;
      const sign = st.rev ? -1 : 1;
      if (!st.split) return sign;
      if (Math.abs(Math.cos(st.a)) < Math.sin(GAP)) return 0;
      return (Math.cos(st.a) < 0 ? 1 : -1) * sign;
    };
    const pos = (a) => [C.x + R * Math.cos(a), C.y - R * Math.sin(a)];
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Simple DC motor with a split-ring commutator',
      draw(ctx, s, dt) {
        if (!st.frozen) {
          const T = dt * (st.slow ? 0.35 : 1);
          const n = 10;
          for (let i = 0; i < n; i++) {
            const h = T / n;
            const tq = 12 * st.I * Math.cos(st.a) * s1();
            st.w += (tq - 1.5 * st.w - 0.4 * Math.sign(st.w)) * h;
            if (Math.abs(st.w) < 0.02 && Math.abs(tq) < 0.4) st.w = 0;
            st.a += st.w * h;
          }
          st.a = ((st.a % TAU) + TAU) % TAU;
        }
        const cur = s1();
        // magnets + field
        rect(ctx, 18, 80, 56, 220, colors.south, null, 6);
        rect(ctx, 376, 80, 56, 220, colors.north, null, 6);
        draw.text(ctx, 'S', 46, 190, { size: 24, weight: 800, color: '#fff' });
        draw.text(ctx, 'N', 404, 190, { size: 24, weight: 800, color: '#fff' });
        for (let y = 96; y <= 286; y += 27) draw.arrow(ctx, 372, y, 80, y, { color: 'rgba(167,139,250,0.4)', width: 1.3, head: 8 });
        // coil
        const p1 = pos(st.a),
          p2 = pos(st.a + Math.PI);
        draw.line(ctx, p1[0], p1[1], p2[0], p2[1], colors.copper, 6);
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(C.x, C.y, 5, 0, TAU);
        ctx.fill();
        for (const [p, side] of [[p1, 1], [p2, -1]]) {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = side > 0 ? '#f87171' : '#60a5fa';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 14, 0, TAU);
          ctx.fill();
          ctx.stroke();
          const sd = cur * side; // +1 = current into the page (away from you)
          if (sd) {
            curSym(ctx, p[0], p[1], -sd, 8);
            const len = 22 + 14 * st.I;
            draw.arrow(ctx, p[0] + 20, p[1], p[0] + 20, p[1] - sd * len, { color: colors.force, width: 3.5 });
          }
        }
        draw.text(ctx, 'side 1', p1[0], p1[1] + (p1[1] > C.y ? 26 : -26), { size: 11, color: '#f87171' });
        if (Math.abs(st.w) > 0.3) {
          const cw = st.w < 0;
          ctx.save();
          ctx.strokeStyle = 'rgba(226,232,240,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(C.x, C.y, 128, -2.3, -0.85);
          ctx.stroke();
          ctx.restore();
          const ea = cw ? -0.85 : -2.3;
          const ex = C.x + 128 * Math.cos(ea),
            ey = C.y + 128 * Math.sin(ea);
          const k = cw ? 1 : -1;
          const tx = -k * Math.sin(ea),
            ty = k * Math.cos(ea);
          draw.arrow(ctx, ex - tx * 10, ey - ty * 10, ex + tx * 4, ey + ty * 4, { color: 'rgba(226,232,240,0.85)', width: 2, head: 11 });
          draw.text(ctx, cw ? 'clockwise' : 'anticlockwise', C.x, 48, { size: 12, weight: 700, color: colors.text, bg: 'rgba(11,18,32,0.85)' });
        }
        draw.text(ctx, 'B (N → S)', 225, 318, { size: 12, color: colors.bfield });
        draw.text(ctx, 'End view of the coil (armature)', 225, 345, { size: 11, color: colors.muted });
        // commutator panel
        rect(ctx, 450, 10, 242, H - 20, '#0f172a', 'rgba(148,163,184,0.2)', 10);
        draw.text(ctx, st.split ? 'Split-ring commutator' : 'Continuous (slip) rings', K.x, 30, { size: 12, weight: 700 });
        const ang = -st.a; // screen angle of side 1
        const ringArc = (r0, a0, a1, col) => {
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.arc(K.x, K.y, r0, a0, a1);
          ctx.stroke();
          ctx.restore();
        };
        const plus = st.rev ? '−' : '+',
          minus = st.rev ? '+' : '−';
        if (st.split) {
          const hw = Math.PI / 2 - GAP * 0.9;
          ringArc(44, ang - hw, ang + hw, '#f87171');
          ringArc(44, ang + Math.PI - hw, ang + Math.PI + hw, '#60a5fa');
          rect(ctx, K.x - 44 - 32, K.y - 9, 26, 18, '#334155', '#94a3b8', 3);
          rect(ctx, K.x + 44 + 6, K.y - 9, 26, 18, '#334155', '#94a3b8', 3);
        } else {
          ringArc(46, 0, TAU, '#f87171');
          ringArc(24, 0, TAU, '#60a5fa');
          rect(ctx, K.x - 46 - 32, K.y - 9, 26, 18, '#334155', '#94a3b8', 3);
          ctx.save();
          ctx.globalAlpha = 0.55;
          rect(ctx, K.x + 18, K.y - 5, 66, 10, '#334155', '#94a3b8', 3);
          ctx.restore();
        }
        draw.text(ctx, 'carbon brushes', K.x, K.y + 72, { size: 11, color: colors.muted });
        draw.text(ctx, plus, K.x - 63, K.y - 22, { size: 15, weight: 800, color: st.rev ? colors.neg : colors.pos });
        draw.text(ctx, minus, K.x + 63, K.y - 22, { size: 15, weight: 800, color: st.rev ? colors.pos : colors.neg });
        draw.wire(ctx, [[K.x - 63, K.y + 9], [K.x - 63, 300], [K.x - 8, 300]], colors.wire, 2.5);
        draw.wire(ctx, [[K.x + 8, 300], [K.x + 63, 300], [K.x + 63, K.y + 9]], colors.wire, 2.5);
        ctx.save();
        ctx.translate(K.x, 300);
        if (st.rev) ctx.rotate(Math.PI);
        draw.cell(ctx, 0, 0, {});
        ctx.restore();
        draw.text(ctx, st.on ? 'battery' : 'battery (off)', K.x, 330, { size: 11, color: colors.muted });
        const msg = !st.on ? 'power off' : cur === 0 ? 'GAP: no current!' : `side 1: current ${cur > 0 ? 'AWAY from you ⊗' : 'TOWARDS you ⊙'}`;
        draw.text(ctx, msg, K.x, 250, { size: 12, weight: 700, color: cur === 0 && st.on ? colors.warn : cur > 0 ? '#f87171' : '#60a5fa', bg: 'rgba(15,23,42,0.95)' });
      },
    });
    const c = EM.controls(el);
    EM.toggle(c, { label: 'Power on', value: true, onChange: (v) => ((st.on = v), (st.frozen = false)) });
    EM.segmented(c, { label: 'Commutator', options: [{ value: true, label: 'Split ring' }, { value: false, label: 'Continuous ring' }], value: true, onChange: (v) => ((st.split = v), (st.frozen = false)) });
    EM.toggle(c, { label: 'Reverse the battery', value: false, onChange: (v) => (st.rev = v) });
    EM.slider(c, { label: 'Current', min: 0.5, max: 3, step: 0.1, value: 2, unit: 'A', fmt: (v) => v.toFixed(1), onInput: (v) => (st.I = v) });
    EM.toggle(c, { label: 'Slow motion', value: true, onChange: (v) => (st.slow = v) });
    EM.button(c, '👋 Give it a push', () => {
      st.frozen = false;
      st.w += st.rev ? 4 : -4;
    });
    const ro = EM.readout(el, [
      { key: 'ang', label: 'Coil plane vs field' },
      { key: 'cur', label: 'Current in coil' },
      { key: 'rpm', label: 'Turning speed' },
    ]);
    const stt = EM.status(el);
    EM.every(150, () => {
      const a = st.a;
      let planeAng = Math.abs(((a % Math.PI) + Math.PI) % Math.PI);
      if (planeAng > Math.PI / 2) planeAng = Math.PI - planeAng;
      ro.set('ang', (planeAng / DEG).toFixed(0) + '°');
      const cur = s1();
      ro.set('cur', !st.on ? 'off' : cur === 0 ? 'none (brushes at the gaps)' : 'flowing');
      ro.set('rpm', st.frozen ? 'paused' : Math.abs((st.w * 60) / TAU).toFixed(0) + ' rev/min (sim)');
      if (st.frozen) return;
      if (!st.on) stt.set('No current → no forces. The coil coasts to a stop.');
      else if (!st.split) stt.set('Continuous ring: side 1 <em>always</em> gets current in the same direction, so its force is always the same way. The coil just rocks and then settles <strong>perpendicular to the field</strong> — it cannot spin round.', 'warn');
      else if (cur === 0) stt.set('Coil at 90° to the field: the brushes are at the gaps in the split ring → current stops for a moment, but the coil’s momentum carries it on.', 'warn');
      else stt.set(`Whichever side is on the left has current flowing <strong>away</strong> from you (force UP); the side on the right has current <strong>towards</strong> you (force DOWN). The commutator swaps the current every half turn, so the coil keeps turning ${st.rev ? 'anticlockwise' : 'clockwise'}.`, 'good');
    });
    let first = true;
    const stepAngles = [Math.PI, Math.PI, Math.PI / 2, Math.PI / 2 - 0.55, 0];
    EM.stepper(
      el,
      [
        { title: 'Brushes touch the split ring', html: 'The carbon brushes press on the split-ring commutator, so a current flows through the commutator and into the coil (armature). The coil and the commutator rotate together.' },
        { title: 'Forces turn the coil', html: 'By Fleming’s left-hand rule, the side near the S pole (current away from you) is pushed <strong>up</strong> and the side near the N pole (current towards you) is pushed <strong>down</strong> → the coil turns <strong>clockwise</strong>.' },
        { title: 'Coil at 90° to the field', html: 'The brushes lose contact with the split ring (they are at the gaps). The current stops momentarily, but the coil keeps rotating clockwise because of its <strong>momentum</strong>.' },
        { title: 'Contact again — current reversed', html: 'The brushes touch the split ring again, but each brush now touches the <em>other</em> half. The side that was at the S pole with current away from you is now at the N side, with current <strong>towards</strong> you.' },
        { title: 'One direction only', html: 'This switch of current every half turn means the force on the left side is always up and on the right side always down — so the coil rotates in <strong>one direction only</strong>. Press <em>Give it a push</em> or toggle a control to run the motor again.' },
      ],
      (i) => {
        if (first) {
          first = false;
          return;
        }
        st.frozen = true;
        st.on = true;
        st.split = true;
        st.rev = false;
        st.w = 0;
        st.a = stepAngles[i];
      }
    );
  }

  /* ================================================================== sims: magnetic flux */

  function simFlux(el) {
    const W = 700,
      H = 360,
      C = { x: 225, y: 180 },
      HL = 110;
    const st = { th: 40, B: 0.4, A: 0.05, spin: false };
    const ys = [];
    for (let y = 50; y <= 310; y += 20) ys.push(y);
    let thSl;
    EM.canvas(el, {
      width: W,
      height: H,
      label: 'Magnetic flux through a coil that can be rotated',
      draw(ctx, s, dt) {
        if (st.spin) {
          st.th = (st.th + 40 * dt) % 360;
          thSl.set(Math.round(st.th));
        }
        const th = st.th * DEG;
        const n = [Math.cos(th), -Math.sin(th)],
          d = [Math.sin(th), Math.cos(th)];
        const ext = HL * Math.abs(Math.cos(th));
        rect(ctx, 10, 36, 46, 288, colors.north, null, 6);
        rect(ctx, 394, 36, 46, 288, colors.south, null, 6);
        draw.text(ctx, 'N', 33, 180, { size: 20, weight: 800, color: '#fff' });
        draw.text(ctx, 'S', 417, 180, { size: 20, weight: 800, color: '#fff' });
        let count = 0;
        for (const y of ys) {
          const thru = Math.abs(y - C.y) <= ext + 0.01 && ext > 0.5;
          if (thru) count++;
          draw.arrow(ctx, 60, y, 390, y, { color: thru ? colors.bfield : 'rgba(167,139,250,0.3)', width: thru ? 2.2 : 1.2, head: 8 });
          if (thru && Math.abs(d[1]) > 1e-6) {
            const x = C.x + ((y - C.y) * d[0]) / d[1];
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, TAU);
            ctx.fill();
          }
        }
        // coil edge-on
        ctx.save();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(C.x - HL * d[0], C.y - HL * d[1]);
        ctx.lineTo(C.x + HL * d[0], C.y + HL * d[1]);
        ctx.stroke();
        ctx.restore();
        const lp = [C.x + (HL + 4) * d[0], C.y + (HL + 4) * d[1]];
        draw.text(ctx, 'coil (edge-on)', lp[0] + (d[0] >= 0 ? 8 : -8), lp[1] + 14, { size: 11, color: colors.muted, align: d[0] >= 0 ? 'left' : 'right', bg: 'rgba(11,18,32,0.8)' });
        // B reference + normal A + angle
        draw.arrow(ctx, C.x, C.y, C.x + 70, C.y, { color: '#e2e8f0', width: 2, dash: [4, 4] });
        draw.text(ctx, 'B', C.x + 82, C.y + 12, { size: 13, weight: 700 });
        draw.arrow(ctx, C.x, C.y, C.x + 85 * n[0], C.y + 85 * n[1], { color: '#38bdf8', width: 3.5 });
        draw.text(ctx, 'A (normal)', C.x + 105 * n[0], C.y + 105 * n[1] - 4, { size: 12, weight: 700, color: '#38bdf8', bg: 'rgba(11,18,32,0.8)' });
        if (st.th > 0.5 && st.th < 359.5) {
          ctx.save();
          ctx.strokeStyle = colors.current;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(C.x, C.y, 32, -th, 0);
          ctx.stroke();
          ctx.restore();
          const mid = -th / 2;
          draw.text(ctx, 'θ', C.x + 44 * Math.cos(mid), C.y + 44 * Math.sin(mid), { size: 14, weight: 700, color: colors.current });
        }
        // graph
        const P = st.B * st.A;
        draw.plot(ctx, { x: 510, y: 46, w: 175, h: 230 }, {
          xMin: 0,
          xMax: 360,
          yMin: -P * 1.15,
          yMax: P * 1.15,
          xTicks: 4,
          yTicks: 4,
          xLabel: 'θ (°)',
          yLabel: 'Φ (Wb)',
          title: 'Φ = BA cos θ',
          series: [{ fn: (x) => P * Math.cos(x * DEG), color: colors.bfield }],
          markers: [{ x: st.th, y: P * Math.cos(th), color: colors.current }],
        });
        draw.text(ctx, `${count} field lines pass through the coil`, 225, 20, { size: 13, weight: 700, color: count ? colors.bfield : colors.warn });
      },
    });
    const c = EM.controls(el);
    thSl = EM.slider(c, { label: 'Angle θ between A and B', min: 0, max: 360, step: 1, value: 40, unit: '°', fmt: (v) => v.toFixed(0), onInput: (v) => (st.th = v) });
    EM.slider(c, { label: 'B', min: 0.1, max: 1, step: 0.05, value: 0.4, unit: 'T', fmt: (v) => v.toFixed(2), onInput: (v) => (st.B = v) });
    EM.slider(c, { label: 'Area A', min: 0.01, max: 0.1, step: 0.01, value: 0.05, unit: 'm²', fmt: (v) => v.toFixed(2), onInput: (v) => (st.A = v) });
    const c2 = EM.controls(el);
    for (const [lab, v] of [['Maximum flux (θ = 0°)', 0], ['Minimum flux (θ = 90°)', 90], ['In between (θ = 40°)', 40]])
      EM.button(c2, lab, () => {
        st.spin = false;
        spinT.set(false);
        st.th = v;
        thSl.set(v);
      });
    const spinT = EM.toggle(c2, { label: 'Spin the coil', value: false, onChange: (v) => (st.spin = v) });
    const ro = EM.readout(el, [
      { key: 't', label: 'θ' },
      { key: 'c', label: 'cos θ' },
      { key: 'p', label: 'Φ = BA cos θ' },
    ]);
    const stt = EM.status(el);
    EM.every(150, () => {
      const cth = Math.cos(st.th * DEG);
      const P = st.B * st.A * cth;
      ro.set('t', st.th.toFixed(0) + '°');
      ro.set('c', Math.abs(cth) < 5e-4 ? '0' : cth.toFixed(3));
      ro.set('p', (Math.abs(P) < 1e-9 ? '0' : EM.fmt(P, 3)) + ' Wb');
      const t = Math.round(st.th) % 180;
      if (t === 0) stt.set('θ = 0°: the normal A is parallel to B, the coil is at 90° to the field lines and faces them squarely → <strong>maximum flux, Φ = BA</strong>.', 'good');
      else if (t === 90) stt.set('θ = 90°: the coil lies along the field lines (edge-on) → no lines pass through it → <strong>minimum flux, Φ = 0</strong>.', 'warn');
      else stt.set(`In between: use <strong>Φ = BA cos θ</strong> = ${EM.fmt(st.B, 3)} × ${EM.fmt(st.A, 3)} × cos ${st.th.toFixed(0)}° = ${Math.abs(P) < 1e-9 ? '0' : EM.fmt(P, 3)} Wb.${cth < 0 ? ' (Negative: the field now passes through the coil from the other side.)' : ''}`);
    });
  }

  /* ================================================================== experiments */

  const experiments = [
    {
      id: 'bar-magnet-field',
      title: 'To show the magnetic field around a bar magnet',
      aim: 'To show the shape and direction of the magnetic field around a bar magnet.',
      apparatus: ['Bar magnet', 'Sheet of paper', 'Iron filings', 'Plotting compasses'],
      steps: ['Place a bar magnet under a sheet of paper.', 'Slowly sprinkle iron filings on top of the paper.', 'Tap the paper gently so that the filings can line up.', 'Place plotting compasses around the magnet to find the direction of the field.'],
      result: 'The iron filings align with and show the <strong>shape</strong> of the magnetic field — curved lines running from pole to pole, most crowded at the poles. The compass needles show the <strong>direction</strong>: out from the north pole and in to the south pole.',
      conclusion: 'There is a magnetic field around a bar magnet. Its field lines travel out from the north pole of the magnet and in to the south pole.',
      sim: simBarMagnet,
    },
    {
      id: 'wire-field',
      title: 'To show the magnetic field around a current-carrying conductor',
      aim: 'To show that there is a magnetic field around a straight wire carrying a current, and to find its shape and direction.',
      apparatus: ['Straight wire passing vertically through a horizontal card', 'Several plotting compasses', 'Low-voltage DC power supply', 'Connecting leads and switch'],
      steps: ['Place several plotting compasses around the wire on the card.', 'Note that with no current they all point north.', 'Connect the wire to a power supply and turn it on.', 'Observe the compasses. Then reverse the current and observe again.'],
      result: 'When a current flows, the compasses align in the direction of the magnetic field around the conductor — they form <strong>circles centred on the wire</strong>. Reversing the current reverses every needle. They follow the right-hand grip rule.',
      conclusion: 'A current-carrying conductor is surrounded by a magnetic field made of concentric circles. Its direction is given by the right-hand grip rule.',
      sim: simWireField,
    },
    {
      id: 'solenoid-field',
      title: 'To show the magnetic field around a solenoid',
      aim: 'To show the shape and direction of the magnetic field of a solenoid (a long coil).',
      apparatus: ['Solenoid passing through a cardboard sheet', 'Several plotting compasses', 'Low-voltage DC power supply', 'Connecting leads', 'Iron rod (optional)'],
      steps: ['Place several compasses around the solenoid.', 'Connect the solenoid to a power supply and turn it on.', 'When a current flows, note the direction of each compass needle.', 'Reverse the current and observe again.'],
      result: 'The compasses align in the direction of the magnetic field. Outside, the pattern is the same as a bar magnet’s, with a north pole at one end and a south pole at the other; inside, the field is uniform. The poles swap when the current is reversed. The compasses follow the right-hand grip rule for solenoids.',
      conclusion: 'A solenoid carrying a current behaves like a bar magnet. Which end is north is given by the right-hand grip rule for solenoids. Putting an iron rod inside turns it into a stronger electromagnet.',
      sim: simSolenoid,
    },
    {
      id: 'foil-force',
      title: 'To show that a current-carrying conductor in a magnetic field experiences a force',
      aim: 'To show that a conductor carrying a current in a magnetic field feels a force, and that the force reverses when the current reverses.',
      apparatus: ['Long thin strip of aluminium foil', 'U-shaped magnet', 'Low-voltage DC power supply', 'Connecting leads'],
      steps: ['Connect a long thin piece of aluminium foil to a low-voltage DC power supply.', 'Place the aluminium foil between the ends of the U-shaped magnet.', 'Turn on the power supply and observe the motion of the aluminium foil.', 'Reverse the direction of the power supply and observe the foil again.'],
      result: 'The aluminium foil moves <strong>up and out</strong> of the U-shaped magnet. When the supply is reversed, the foil is pulled <strong>downwards into</strong> the U-shaped magnet.',
      conclusion: 'A current-carrying conductor in a magnetic field experiences a force. The direction of the force reverses when the current reverses, and is given by Fleming’s left-hand rule.',
      sim: simFoil,
    },
    {
      id: 'electromagnet-strength',
      title: 'Virtual investigation: making an electromagnet stronger',
      aim: 'To find how the number of turns, the current and the core affect how many paperclips an electromagnet can lift — and which materials it can pick up.',
      apparatus: ['Iron nail', 'Insulated wire wound into a coil around the nail', 'Battery and switch', 'Paperclips of different metals'],
      steps: ['Wrap a coil of wire around an iron nail and connect it to a battery through a switch.', 'Close the switch and see how many paperclips the nail picks up.', 'Change the number of turns, then the current, and count the paperclips each time.', 'Remove the nail (no core) and try again.', 'Try paperclips made of other materials. Finally open the switch.'],
      result: 'More turns or more current → more paperclips lifted. Without the iron core the coil is very weak. Only ferromagnetic paperclips (iron, nickel, cobalt, steel) are picked up. When the switch is opened the paperclips drop immediately.',
      conclusion: 'An electromagnet’s field is made by the current and disappears when the current stops. It is strengthened by more turns, more current and an iron core, and it only attracts ferromagnetic metals.',
      sim: simElectromagnet,
    },
    {
      id: 'parallel-wires',
      title: 'Virtual investigation: the force between two current-carrying conductors',
      aim: 'To see how two parallel wires carrying currents affect each other.',
      apparatus: ['Two long parallel conductors (e.g. strips of foil)', 'Two power supplies or one supply in series', 'Connecting leads'],
      steps: ['Pass currents through two parallel conductors in the same direction and watch them.', 'Reverse one of the currents so they flow in opposite directions.', 'Change the size of the currents and the gap between the wires.'],
      result: 'Currents in the same direction → the conductors attract each other. Currents in opposite directions → the conductors repel. Bigger currents or a smaller gap → a bigger force.',
      conclusion: 'There is a force between current-carrying conductors due to their magnetic fields.',
      sim: simParallel,
    },
    {
      id: 'charge-path',
      title: 'Virtual investigation: charged particles in a magnetic field',
      aim: 'To see how charged particles move when they enter a magnetic field at right angles, and to test r = mv/qB.',
      apparatus: ['Beam of charged particles (proton, alpha particle or electron)', 'Uniform magnetic field into or out of the page'],
      steps: ['Fire a proton into the field (into the page) and note which way it curves.', 'Switch to an electron and compare.', 'Change the speed, then the flux density, and watch the radius of the circle.', 'Reverse the field.'],
      result: 'A positive charge curves upwards (field into the page, moving right) and a negative charge curves downwards. The path is a circle: faster → bigger circle; stronger field → smaller circle. The speed never changes.',
      conclusion: 'The magnetic force F = qvB is always perpendicular to the velocity, so it acts as a centripetal force: qvB = mv²/r, giving r = mv/qB.',
      sim: simParticle,
    },
  ];

  /* ================================================================== topics */

  const topics = [
    {
      id: 'magnets',
      title: 'Permanent magnets & magnetic fields',
      summary: 'Magnets, lodestone, the rules of poles, magnetic fields and field lines.',
      keywords: 'permanent magnet iron nickel cobalt lodestone magnetite poles attract repel suspended compass north south field lines iron filings plotting compass loudspeaker MRI fridge',
      render(el, ui) {
        const s1 = EM.section(el, 'Permanent magnets');
        ui.term('permanent-magnet', s1);
        EM.p(s1, 'All the magnets used today are <strong>manmade</strong> — for example in:');
        EM.cards(
          s1,
          [
            { icon: '🔊', title: 'Loudspeakers', html: 'A magnet pushes on the current-carrying voice coil.' },
            { icon: '🧲', title: 'Fridge magnets', html: 'Stick to the steel door.' },
            { icon: '🚪', title: 'Fridge & freezer door seals', html: 'A magnetic strip pulls the door shut and airtight.' },
            { icon: '💾', title: 'Computer data storage', html: 'Data stored as tiny magnetised regions (e.g. hard drives).' },
            { icon: '🏥', title: 'MRI scanners', html: 'Magnetic resonance imagers.' },
            { icon: '🧭', title: 'Compasses', html: 'A small magnetised needle free to turn.' },
          ],
          { cols: 3 }
        );
        ui.term('lodestone', s1);

        const s2 = EM.section(el, 'The rules of magnetism');
        EM.list(s2, ['Magnets are <strong>strongest at their poles</strong>.', '<strong>Like</strong> magnetic poles <strong>repel</strong>; <strong>unlike</strong> magnetic poles <strong>attract</strong>. A north pole repels a north pole but attracts a south pole.', 'When a magnet is <strong>suspended freely</strong>, it always settles in a <strong>north–south</strong> direction.']);
        simTwoMagnets(EM.simPanel(s2, 'Attract or repel?', 'Flip either magnet, or drag the right-hand one and let go. The violet lines are the combined magnetic field.'));
        simSuspended(EM.simPanel(s2, 'A freely suspended magnet', 'A bar magnet hanging from a thread, seen from above.'));

        const s3 = EM.section(el, 'Magnetic fields');
        ui.term('magnetic-field', s3);
        EM.callout(s3, 'key', '<strong>Iron filings</strong> show the <strong>shape</strong> of a magnetic field. <strong>Plotting compasses</strong> show its <strong>direction</strong>.');
        ui.term('field-line', s3);
        EM.p(s3, 'So field lines always point <strong>away from a north pole</strong> and <strong>towards a south pole</strong>. Where the lines are close together the field is strong.');
        ui.experiment('bar-magnet-field', el);
      },
    },
    {
      id: 'current-field',
      title: 'The magnetic effect of an electric current',
      summary: 'Oersted’s discovery and the circular field around a straight current-carrying wire.',
      keywords: 'Oersted 1820 Denmark compass deflect magnetic effect current wire conductor right-hand grip rule circles perpendicular',
      render(el, ui) {
        const s1 = EM.section(el, 'Oersted’s discovery');
        EM.callout(s1, 'history', 'The magnetic effect of an electric current was discovered in <strong>1820</strong> by <strong>Hans Christian Oersted</strong> (Denmark, 1777–1851). He noticed that a compass needle was deflected from magnetic north when an electric current from a battery was switched on and off — confirming a direct relationship between electricity and magnetism.', 'History: Oersted, 1820');
        EM.p(s1, 'Oersted discovered that a magnetic needle always aligns itself <strong>perpendicular</strong> to a current-carrying wire. This demonstration proved the relationship between electricity and magnetism: <em>an electric current produces a magnetic field</em>.');
        simOersted(EM.simPanel(s1, 'Recreate Oersted’s observation', 'A wire runs north–south over a compass. Switch the current on and off, reverse it, or move the wire under the compass.'));

        const s2 = EM.section(el, 'The field around a straight wire');
        EM.p(s2, 'The field lines around a long straight wire are <strong>circles</strong> centred on the wire. They get further apart as you move away, because the field gets weaker.');
        ui.term('rh-grip-wire', s2);
        EM.callout(s2, 'note', 'Use the right-hand grip rule when drawing the direction of the magnetic field around a straight current-carrying conductor. Current coming <strong>out of</strong> the page (⊙) → field <strong>anticlockwise</strong>; current going <strong>into</strong> the page (⊗) → field <strong>clockwise</strong>.');
        ui.experiment('wire-field', el);
      },
    },
    {
      id: 'solenoids',
      title: 'Solenoids & electromagnets',
      summary: 'The field of a solenoid, the right-hand grip rule for solenoids, electromagnets and their uses.',
      keywords: 'solenoid coil uniform field right-hand grip rule iron core electromagnet relay switch uses scrap yard crane MRI transformer particle accelerator headphones nail paperclips ferromagnetic iron nickel cobalt steel',
      render(el, ui) {
        const s1 = EM.section(el, 'The solenoid');
        ui.term('solenoid', s1);
        ui.experiment('solenoid-field', s1);
        ui.term('rh-grip-solenoid', s1);
        EM.callout(s1, 'tip', 'Another way to remember it: look at one end of the solenoid. If the current goes round <strong>anticlockwise</strong>, that end is a <strong>N</strong> pole; if it goes <strong>clockwise</strong>, it is a <strong>S</strong> pole.', 'Memory trick');
        EM.list(s1, ['Inside a solenoid the field is <strong>uniform</strong> (straight, evenly spaced lines).', 'Solenoids can convert electric current into mechanical action, so they are very commonly used as <strong>switches/relays</strong> and <strong>electromagnets</strong>.', 'Placing an <strong>iron rod</strong> through the solenoid makes it an <strong>electromagnet</strong> — this strengthens it a lot.']);

        const s2 = EM.section(el, 'Electromagnets');
        ui.term('electromagnet', s2);
        EM.p(s2, 'When electricity flows through the wire the core becomes magnetised, but the magnetic field <strong>instantly disappears</strong> when the power is turned off. That on/off control is what makes electromagnets so useful.');
        EM.cards(
          s2,
          [
            { icon: '🎧', title: '1. Smartphones', html: 'Every time you listen to music, electromagnets drive the voice coils in your headphones and loudspeakers to vibrate and produce sound.' },
            { icon: '🔁', title: '2. Home relays & timers', html: 'Act as switches that turn high-current circuits on and off automatically — washing machines, ovens, heat pumps.' },
            { icon: '🏗️', title: '3. Scrap yards', html: 'Giant magnets on cranes lift heavy scrap iron and steel: switch on to pick it up, switch off to drop it.' },
            { icon: '⚡', title: '4. Power grids', html: 'Transformers use electromagnetism to change voltage levels across the electrical grid.' },
            { icon: '🏥', title: '5. Medical imaging', html: 'MRI machines use massive superconducting electromagnets to make the detailed magnetic fields needed to scan the body.' },
            { icon: '⚛️', title: '6. Particle accelerators', html: 'Strong electromagnets guide and focus beams of charged particles moving at nearly the speed of light.' },
          ],
          { cols: 3 }
        );
        EM.p(s2, 'A simple electromagnet: an <strong>iron nail with a coil of wire wrapped around it</strong>, connected to a <strong>battery</strong>, picks up <strong>paperclips</strong>.');
        ui.experiment('electromagnet-strength', s2);
        ui.term('ferromagnetic', s2);
        EM.callout(s2, 'note', 'An electromagnet will only attract <strong>ferromagnetic metals</strong> like iron, nickel, cobalt and steel. Aluminium, copper and plastic are not attracted.');
      },
    },
    {
      id: 'devices',
      title: 'The electric bell & the circuit breaker',
      summary: 'How an electromagnet makes a bell ring and how a miniature circuit breaker cuts off a fault current.',
      keywords: 'electric bell school bell armature striker gong interrupter miniature circuit breaker MCB trip bar latch contacts fault current line load',
      render(el, ui) {
        const s1 = EM.section(el, 'The electric (school) bell');
        simBell(EM.simPanel(s1, 'Electric bell', 'Hold the bell push and watch one cycle in slow motion — then switch to real speed.'));
        EM.list(
          s1,
          [
            'When a current flows, the iron core becomes an <strong>electromagnet</strong>.',
            'This attracts the <strong>armature</strong>, which in turn causes the <strong>striker</strong> to hit the <strong>gong</strong>. (In general an armature is a part that carries a current and interacts with a magnetic field; here it is a soft-iron strip that is part of the circuit.)',
            'As the armature moves, it disconnects the circuit at the <strong>interrupter</strong>.',
            'The iron loses its magnetism, which lets the springy armature move the striker away from the gong — back onto the interrupter, completing the circuit again.',
            'This cycle repeats at <strong>high frequency</strong>, so the bell rings continuously.',
          ],
          { ordered: true }
        );

        const s2 = EM.section(el, 'The miniature circuit breaker (MCB)');
        EM.p(s2, 'An MCB is an automatic switch in the fuse board. It uses an electromagnet to cut off the supply when a dangerously large current flows.');
        simMCB(EM.simPanel(s2, 'Miniature circuit breaker', 'Choose normal operation or a fault. After a trip, press Reset.'));
        EM.tabs(s2, [
          {
            label: 'Normal operation',
            render: (p) =>
              EM.list(p, ['Current flows from the <strong>line</strong> to the <strong>load</strong>, passing through the electromagnet (coil).', 'The magnetic field produced by the coil is <strong>too weak</strong> to pull the <strong>trip bar</strong> (iron armature).', 'The <strong>latch</strong> holds the moving contact in place.', 'The <strong>contacts remain closed</strong>, so electricity continues flowing to the load.'], { ordered: true }),
          },
          {
            label: 'Fault condition',
            render: (p) =>
              EM.list(p, ['A <strong>much larger current</strong> flows through the coil.', 'The electromagnet becomes <strong>much stronger</strong>.', 'The strong magnetic field attracts the <strong>trip bar</strong> (iron armature).', 'The trip bar <strong>releases the latch</strong>. The latch snaps open.', 'The <strong>contacts separate</strong>, breaking the circuit.'], { ordered: true }),
          },
        ]);
      },
    },
    {
      id: 'motor-effect',
      title: 'The force on a current-carrying conductor',
      summary: 'Magnetic flux density, the foil demo, Fleming’s left-hand rule, F = BIL and the force between two wires.',
      keywords: 'motor effect force conductor magnetic field flux density tesla aluminium foil U-shaped magnet Fleming left hand rule F=BIL factors parallel wires attract repel loudspeaker moving coil meter',
      render(el, ui) {
        const s1 = EM.section(el, 'Magnetic flux density');
        EM.p(s1, 'Imagine a magnetic field as a stream of invisible lines flowing around a magnet, or around a current-carrying conductor. The <strong>magnetic flux density</strong> tells you how <strong>concentrated</strong> those lines are in a given space. (<em>Flux</em> means <em>flow</em>.)');
        ui.term('flux-density', s1);
        ui.term('tesla', s1);
        ui.experiment('foil-force', el);

        const s2 = EM.section(el, 'Fleming’s left-hand rule');
        EM.p(s2, 'The foil demo can be explained using <strong>Fleming’s left-hand rule</strong>.');
        ui.term('flhr', s2);
        simFLHR(EM.simPanel(s2, 'Fleming’s left-hand rule in 3D', 'Set the field and the current; the thumb shows the force. Use <em>Test me</em> to practise.'));
        EM.callout(s2, 'note', 'The magnetic force direction you get from the left-hand rule is for a <strong>positive charge</strong> moving in the direction of the current (i.e. conventional current, + to −).');

        const s3 = EM.section(el, 'How big is the force? F = BIL');
        EM.p(s3, 'The factors affecting the force experienced by a conductor in a magnetic field:');
        EM.list(s3, ['The magnetic flux density (<var>B</var>)', 'The current (<var>I</var>)', 'The length of conductor in the field (<var>L</var>)'], { ordered: true });
        ui.formula('bil', s3);

        const s4 = EM.section(el, 'The force between two current-carrying conductors');
        EM.list(s4, ['When the currents flow in the <strong>same direction</strong>, the conductors <strong>attract</strong> each other.', 'When the currents flow in <strong>opposite directions</strong>, the conductors <strong>repel</strong> each other.']);
        EM.callout(s4, 'key', '<strong>Conclusion:</strong> there is a force between current-carrying conductors due to their magnetic fields.');
        ui.experiment('parallel-wires', s4);
        EM.callout(s4, 'real', '<strong>Loudspeakers</strong>, <strong>electric motors</strong> and <strong>moving-coil meters</strong> all work on the principle that there is a force on a current-carrying conductor in a magnetic field.');
      },
    },
    {
      id: 'charges',
      title: 'Charged particles in a magnetic field',
      summary: 'F = qvB, why moving charges travel in circles, and qB = mv/r.',
      keywords: 'charged particle electron proton positive negative circular path centripetal force qvB mv2/r qB = mv/r radius velocity perpendicular',
      render(el, ui) {
        const s1 = EM.section(el, 'Positive and negative charges');
        EM.p(s1, 'Take a magnetic field <strong>into the page</strong> (shown as ×). A <strong>positive</strong> charge moving to the right with velocity <var>v</var> enters the field at right angles. By Fleming’s left-hand rule the force on it is <strong>upwards</strong>, so it moves upwards in a circular path.');
        EM.p(s1, 'But if the moving charge is <strong>negative</strong> (e.g. an electron), the force is the other way: the electron moves <strong>downwards</strong> in a circular path.');
        EM.callout(s1, 'note', 'When a charged particle enters a magnetic field at an angle perpendicular to the field, the magnetic force acts <strong>perpendicular to both</strong> the velocity of the charge and the magnetic field.');
        EM.p(s1, 'As a result, the magnetic force does not change the particle’s speed but constantly changes its <strong>direction</strong>. This continuous redirection makes the charge <strong>move in a circular path</strong> — the magnetic force is acting as a <strong>centripetal force</strong>.');
        EM.callout(s1, 'tip', 'The notes say the force “does not change the particle’s velocity”. Strictly, velocity includes direction, so the velocity <em>does</em> change — it is the <strong>speed</strong> (the size of the velocity) that stays the same. The force is always at 90° to the motion, so it does no work on the particle.', 'Going further');
        ui.experiment('charge-path', el);

        const s2 = EM.section(el, 'The formulas');
        EM.p(s2, 'If you are asked to find the force on a <strong>single moving charge</strong> (in a conductor or in a beam) in a magnetic field, use:');
        ui.formula('qvb', s2);
        EM.p(s2, 'When a charged particle in a magnetic field experiences a force F = qvB, it also experiences a centripetal force:');
        ui.formula('centripetal', s2);
        EM.p(s2, 'They are both equal to F, so <strong>qvB = mv²/r</strong>. Cancel a <var>v</var> on both sides to get <strong>qB = mv/r</strong>:');
        ui.formula('qbmvr', s2);
      },
    },
    {
      id: 'earth',
      title: 'The Earth’s magnetic field',
      summary: 'Where Earth’s field comes from, the magnetosphere, why it protects us, and how auroras form.',
      keywords: 'Earth magnetic field inner core outer core iron nickel magnetosphere magnetotail solar wind ozone satellites Mars aurora borealis australis northern lights',
      render(el, ui) {
        const s1 = EM.section(el, 'Earth is a giant magnet');
        EM.p(s1, 'The Earth’s <strong>inner core</strong> is believed to be a ball of <strong>iron</strong> about <strong>20% of the Earth’s radius</strong>. The <strong>outer core</strong> is believed to be fluid-like and contains <strong>iron and nickel</strong>. The flow of these materials generates electric currents, which in turn produce a magnetic field.');
        EM.callout(s1, 'tip', 'The outer core is far too hot to be a permanent magnet. It is the <em>movement</em> of this electrically conducting liquid metal that produces the currents — and currents make magnetic fields, just like Oersted showed.', 'Going further');
        simEarth(EM.simPanel(s1, 'Earth’s magnetic shield', 'Particles from the Sun (red +, blue −) meet the magnetosphere. Switch the field off to see what would happen. Show the core or the equivalent bar magnet.'));
        EM.cards(s1, [
          { icon: '🌍', title: 'How far does it reach?', html: 'About <strong>60 000–65 000 km</strong> into space on the sunlit side. On the night side the solar wind stretches it into a long, comet-like <strong>magnetotail</strong> over <strong>6 million km</strong> long. The exact reach (the <strong>magnetosphere</strong>) fluctuates.' },
          { icon: '🛡️', title: 'A protective shield', html: 'It safeguards the planet from harmful cosmic radiation and the highly charged particles of the <strong>solar wind</strong>. Without it, they would strip away the ozone layer, fry power grids and knock out satellites; over time the atmosphere would be stripped away and deadly radiation would reach the surface, turning Earth into a cold, barren rock like <strong>Mars</strong>.' },
        ]);
        ui.term('magnetosphere', s1);
        EM.callout(s1, 'note', 'Compasses point to the magnetic pole in the Arctic, so that pole must actually be a magnetic <strong>south</strong> pole (unlike poles attract). Earth’s field lines come out near the geographic south and go in near the geographic north.');

        const s2 = EM.section(el, 'Auroras');
        EM.p(s2, 'When charged particles from the Sun interact with Earth’s magnetic field they are deflected towards the poles, where they interact with atoms in the upper atmosphere:');
        simAurora(EM.simPanel(s2, 'How an aurora makes light', 'Step through the process.'));
        ui.term('aurora', s2);
      },
    },
    {
      id: 'dc-motor',
      title: 'The simple DC motor',
      summary: 'How the coil, magnets, carbon brushes and split-ring commutator keep a motor turning one way.',
      keywords: 'DC motor armature coil split-ring commutator carbon brushes Fleming left hand rule clockwise momentum continuous ring slip ring',
      render(el, ui) {
        const s1 = EM.section(el, 'Parts of the motor');
        EM.cards(
          s1,
          [
            { icon: '🧲', title: 'Magnets', html: 'Give a magnetic field from N to S across the coil.' },
            { icon: '🌀', title: 'Coil (armature)', html: 'A loop of wire that can rotate on an axle. Current in it feels a force (motor effect).' },
            { icon: '⭕', title: 'Split-ring commutator', html: 'Connected to the coil — when the coil rotates, the commutator rotates. It reverses the current every half turn.' },
            { icon: '▮', title: 'Carbon brushes', html: 'Press against the commutator to bring the current in and out while it spins.' },
          ],
          { cols: 2 }
        );
        const sp = EM.simPanel(s1, 'Simple DC motor', 'Left: the coil seen end-on between the poles (side 1 has a red rim). Right: the commutator and brushes. Try the continuous ring, reverse the battery, or step through below.');
        simMotor(sp);

        const s2 = EM.section(el, 'Why does it keep turning?');
        EM.list(
          s2,
          [
            'The brushes are in contact with the split-ring commutator.',
            'A current flows through the commutator and into the coil of wire.',
            'According to Fleming’s left-hand motor rule, the forces cause the coil to move in a <strong>clockwise</strong> direction.',
            'When the coil is at <strong>90° to the magnetic field</strong>, the brushes lose contact with the split-ring commutator.',
            'Current stops flowing momentarily, but the coil continues to rotate clockwise due to its <strong>momentum</strong>.',
            'The brushes regain contact and current flows in the coil again — but now the length of coil that was at the south pole (current flowing away from you) is on the north side, with the current flowing <strong>towards</strong> you.',
            'This switch of current allows the coil to rotate in <strong>one direction only</strong>.',
          ],
          { ordered: true }
        );
        ui.term('commutator', s2);
        EM.callout(s2, 'key', 'Using Fleming’s left-hand rule, the commutator ensures that <strong>whichever length of wire is on the left side always has current flowing away from you (force UP)</strong>, and whichever length is on the right side always has current flowing <strong>towards you (force DOWN)</strong>.');
        EM.callout(s2, 'note', 'If you used a standard <strong>continuous metal ring</strong> instead of a split ring, the current would flow in the same direction in the same length of coil the whole time, whether it was near the north or the south pole. The force on that length of coil would always pull it the same way, so the coil would end up <strong>perpendicular to the field</strong> and could not spin in a continuous circle. Try it in the simulation!');
      },
    },
    {
      id: 'flux',
      title: 'Magnetic flux',
      summary: 'Flux Φ = BA, the weber, and Φ = BA cos θ for a coil at an angle.',
      keywords: 'magnetic flux weber Wb phi BA cos theta normal vector coil area angle maximum minimum flux',
      render(el, ui) {
        const s1 = EM.section(el, 'What is magnetic flux?');
        ui.term('magnetic-flux', s1);
        ui.term('weber', s1);
        EM.p(s1, 'Think of flux as the <strong>number of field lines</strong> passing through a coil. Flux density B tells you how crowded the lines are; multiply by the area A to get the total.');
        ui.formula('flux', s1);
        EM.p(s1, 'Φ = BA can only be used if the coil of wire is at <strong>90° to the magnetic field lines</strong> (facing them squarely). If the coil is at <strong>0°</strong> to the lines (lying along them) the flux is <strong>zero</strong>. At any other angle we must use <strong>Φ = BA cos θ</strong>.');

        const s2 = EM.section(el, 'Why cos θ?');
        EM.p(s2, 'We look at two separate vectors:');
        EM.list(s2, ['Vector <strong>A</strong> is called the <strong>normal</strong>. It is always at 90° to the surface area of the coil.', 'Vector <strong>B</strong> is the magnetic field vector, always pointing from north to south.', '<strong>θ is the angle between vector A and vector B.</strong>'], { ordered: true });
        EM.cards(
          s2,
          [
            { title: 'Maximum flux', html: 'A parallel to B: θ = 0°, cos 0° = 1 → <strong>Φ = BA</strong>.' },
            { title: 'Minimum flux', html: 'A at 90° to B: θ = 90°, cos 90° = 0 → <strong>Φ = 0</strong>.' },
            { title: 'In between', html: 'Any other angle → <strong>Φ = BA cos θ</strong>.' },
          ],
          { cols: 3 }
        );
        simFlux(EM.simPanel(s2, 'Turn the coil', 'Rotate the coil (seen edge-on) and count the field lines passing through it. The graph shows Φ = BA cos θ.'));
        EM.callout(s2, 'warn', 'Two different angles appear here — don’t mix them up! “The coil is at 90° to the field lines” means its <em>normal</em> is parallel to B, so <strong>θ = 0°</strong> and the flux is a maximum. θ in the formula is always measured from the <strong>normal</strong>, not from the coil’s surface.', 'Careful');
        ui.formula('flux-cos', s2);
      },
    },
  ];

  /* ================================================================== quiz */

  const quiz = [
    { q: 'Which of these metals can be made into a permanent magnet?', options: ['Cobalt', 'Copper', 'Aluminium', 'Zinc'], answer: 0, explain: 'A permanent magnet is a magnetised piece of iron, nickel or cobalt.' },
    { q: 'What is lodestone?', options: ['A naturally magnetised piece of the mineral magnetite', 'A manmade steel magnet', 'A type of electromagnet', 'The iron core of the Earth'], answer: 0, explain: 'Lodestone is a naturally-occurring magnet; all other magnets in everyday use are manmade.' },
    { q: 'In the bar magnet demo, what do the iron filings show?', options: ['The shape of the magnetic field', 'The direction of the magnetic field', 'The strength in teslas', 'Which end is north'], answer: 0, explain: 'Iron filings show the shape; plotting compasses show the direction.' },
    { q: 'A magnetic field line is…', options: ['the path along which a north pole would move if it were free to do so', 'the path along which a south pole would move', 'a line joining points of equal field strength', 'the path a positive charge follows in the field'], answer: 0, explain: 'That is the definition — which is why field lines leave N poles and enter S poles.' },
    { q: 'Who discovered the magnetic effect of an electric current, and when?', options: ['Oersted, 1820', 'Faraday, 1831', 'Fleming, 1880', 'Ampère, 1750'], answer: 0, explain: 'Hans Christian Oersted (Denmark) saw a compass needle deflect when a current was switched on in 1820.' },
    { q: 'What happens to an electromagnet’s magnetic field when the current is switched off?', options: ['It disappears instantly', 'It stays at full strength', 'It slowly reverses', 'It doubles'], answer: 0, explain: 'An electromagnet’s field is generated and sustained by the current, so it vanishes when the power is turned off.' },
    { q: 'Plotting compasses are placed around a vertical wire. When a current flows, they…', options: ['form circles around the wire', 'all point towards the wire', 'all point away from the wire', 'all point north'], answer: 0, explain: 'The field of a straight wire is concentric circles; the direction is given by the right-hand grip rule.' },
    { q: 'Using the right-hand grip rule for a solenoid, what does your thumb point to?', options: ['The north pole of the solenoid', 'The direction of the current', 'The south pole of the solenoid', 'The force on the solenoid'], answer: 0, explain: 'Fingers curl the way the current flows round the turns; the thumb points to the N pole.' },
    { q: 'An electromagnet is switched on near a pile of objects. Which will it NOT pick up?', options: ['An aluminium can', 'A steel paperclip', 'A nickel coin', 'An iron nail'], answer: 0, explain: 'Electromagnets only attract ferromagnetic metals: iron, nickel, cobalt and steel.' },
    { q: 'In an electric bell, what breaks the circuit each time the striker hits the gong?', options: ['The armature moving away from the interrupter', 'The gong', 'The power supply switching off', 'The coil melting'], answer: 0, explain: 'The armature leaves the interrupter contact, the circuit is broken, the iron loses its magnetism and the armature springs back.' },
    { q: 'In a miniature circuit breaker, what happens first during a fault?', options: ['A large current makes the electromagnet strong enough to pull the trip bar', 'The latch melts', 'The contacts weld together', 'The current falls to zero on its own'], answer: 0, explain: 'The strong field attracts the trip bar, which releases the latch; the contacts then separate.' },
    { q: 'What are the units of magnetic flux density B and magnetic flux Φ?', options: ['B: tesla; Φ: weber', 'B: weber; Φ: tesla', 'Both in tesla', 'B: newton; Φ: weber'], answer: 0, explain: 'Flux density B is measured in tesla (T); flux Φ = BA is measured in webers (Wb).' },
    { q: 'In the aluminium-foil demo, the foil jumps up out of the magnet. What happens when the supply is reversed?', options: ['The foil is pulled down into the magnet', 'The foil jumps up even higher', 'Nothing happens', 'The foil vibrates side to side'], answer: 0, explain: 'Reversing the current reverses the force (Fleming’s left-hand rule).' },
    { q: 'In Fleming’s left-hand rule, what does the second finger represent?', options: ['Current', 'Field', 'Motion (force)', 'Voltage'], answer: 0, explain: 'First finger = Field, seCond finger = Current, thuMb = Motion.' },
    { q: 'A 25 cm wire carrying 3 A is at right angles to a 0.4 T field. What force acts on it?', options: ['0.3 N', '3.0 N', '0.03 N', '30 N'], answer: 0, explain: 'F = BIL = 0.4 × 3 × 0.25 = 0.3 N.' },
    { q: 'A proton (q = 1.6 × 10⁻¹⁹ C) moves at 2 × 10⁶ m/s at right angles to a 0.5 T field. What is the force on it?', options: ['1.6 × 10⁻¹³ N', '6.4 × 10⁻¹³ N', '1.6 × 10⁻¹⁹ N', '3.2 × 10⁻¹⁴ N'], answer: 0, explain: 'F = qvB = 1.6 × 10⁻¹⁹ × 2 × 10⁶ × 0.5 = 1.6 × 10⁻¹³ N.' },
    { q: 'Why does a charged particle entering a magnetic field at right angles move in a circle?', options: ['The force is always perpendicular to its velocity, so it changes direction but not speed', 'The field slows it down', 'The field speeds it up', 'The force is always parallel to its velocity'], answer: 0, explain: 'A force at 90° to the motion acts as a centripetal force: qvB = mv²/r.' },
    { q: 'Using qB = mv/r, what happens to the radius if the particle’s speed is doubled (q, B, m unchanged)?', options: ['The radius doubles', 'The radius halves', 'The radius stays the same', 'The radius is four times bigger'], answer: 0, explain: 'r = mv/qB, so r is directly proportional to v.' },
    { q: 'Two parallel wires carry currents in the same direction. They…', options: ['attract each other', 'repel each other', 'feel no force', 'rotate'], answer: 0, explain: 'Same direction → attract; opposite directions → repel.' },
    { q: 'What is the job of the split-ring commutator in a DC motor?', options: ['To reverse the current in the coil every half turn', 'To make the magnetic field stronger', 'To stop the motor overheating', 'To change AC to a higher voltage'], answer: 0, explain: 'Reversing the current every half turn keeps the force on the left side up and on the right side down, so the coil turns one way.' },
    { q: 'A coil of area 0.2 m² is in a 0.5 T field with its normal at 60° to the field. What is the flux through it?', options: ['0.05 Wb', '0.1 Wb', '0.087 Wb', '0 Wb'], answer: 0, explain: 'Φ = BA cos θ = 0.5 × 0.2 × cos 60° = 0.05 Wb.' },
    { q: 'What causes the aurora borealis?', options: ['Charged particles from the Sun excite atoms in the upper atmosphere near the poles, which then emit light', 'Sunlight reflecting off polar ice', 'Lightning in the upper atmosphere', 'The Moon’s magnetic field'], answer: 0, explain: 'Electrons in the excited atoms drop back to lower energy states and release light.' },
  ];

  EM.chapter({
    id: 'c5',
    code: 'C.5',
    title: 'Electromagnetism',
    color: '#7c3aed',
    blurb: 'Magnets and magnetic fields, the field of a current, electromagnets, the motor effect and F = BIL, charged particles in fields, Earth’s magnetism, the DC motor and magnetic flux.',
    terms,
    formulas,
    experiments,
    topics,
    quiz,
  });
})();
