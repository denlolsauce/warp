/* E&M Explorer core: data registry, DOM/UI helpers, canvas + drawing helpers, physics helpers.
   Loaded as a classic script (no modules) so index.html also works when opened from disk. */
(function () {
  'use strict';

  const EM = (window.EM = {
    chapters: [],
    byId: {},
    _cleanups: [],
  });

  /* ------------------------------------------------------------------ registry */

  /**
   * Register a chapter. Shape:
   * { id:'c1', code:'C.1', title, color, blurb,
   *   topics:[{id,title,summary,keywords,render(el, ui)}],
   *   formulas:[formula], experiments:[experiment], terms:[{id,term,def}], quiz:[{q,options,answer,explain}] }
   */
  EM.chapter = function (ch) {
    ch.topics = ch.topics || [];
    ch.formulas = ch.formulas || [];
    ch.experiments = ch.experiments || [];
    ch.terms = ch.terms || [];
    ch.quiz = ch.quiz || [];
    EM.chapters.push(ch);
    EM.chapters.sort((a, b) => a.id.localeCompare(b.id));
    EM.byId[ch.id] = ch;
    return ch;
  };

  EM.find = function (chId, kind, id) {
    const ch = EM.byId[chId];
    if (!ch) return null;
    return (ch[kind] || []).find((x) => x.id === id) || null;
  };

  /* ------------------------------------------------------------------ lifecycle */

  EM.onCleanup = function (fn) {
    EM._cleanups.push(fn);
  };
  EM._runCleanups = function () {
    const fns = EM._cleanups.splice(0);
    for (const fn of fns) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  };
  /** setInterval that is cleared automatically when the page changes. */
  EM.every = function (ms, fn) {
    const id = setInterval(fn, ms);
    EM.onCleanup(() => clearInterval(id));
    return id;
  };

  /* ------------------------------------------------------------------ DOM */

  EM.h = function (tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  const h = EM.h;

  /** Append an element built with EM.h to parent and return it. */
  EM.add = function (parent, tag, props, ...children) {
    const el = h(tag, props, ...children);
    parent.append(el);
    return el;
  };

  /** Section with heading. Returns the body element to append into. */
  EM.section = function (parent, title, opts = {}) {
    const sec = EM.add(parent, 'section', { class: 'topic-section' + (opts.class ? ' ' + opts.class : ''), id: opts.id });
    if (title) sec.append(h('h2', { html: title }));
    return sec;
  };

  /** Paragraph(s) of trusted HTML. */
  EM.p = function (parent, html) {
    return EM.add(parent, 'p', { html });
  };

  EM.list = function (parent, items, opts = {}) {
    const el = EM.add(parent, opts.ordered ? 'ol' : 'ul', { class: opts.class || 'nice-list' });
    for (const it of items) el.append(h('li', { html: it }));
    return el;
  };

  /** Callout box. type: note | tip | warn | example | history | key */
  EM.callout = function (parent, type, html, title) {
    const titles = { note: 'N.B.', tip: 'Tip', warn: 'Careful', example: 'Example', history: 'History', key: 'Key idea', real: 'In the real world' };
    const el = EM.add(parent, 'div', { class: 'callout callout-' + type });
    el.append(h('div', { class: 'callout-title', html: title || titles[type] || type }));
    el.append(h('div', { class: 'callout-body', html }));
    return el;
  };

  /** Two-column responsive grid of cards: items = [{title, html, icon?}] */
  EM.cards = function (parent, items, opts = {}) {
    const grid = EM.add(parent, 'div', { class: 'card-grid' + (opts.cols ? ' cols-' + opts.cols : '') });
    for (const it of items) {
      grid.append(
        h('div', { class: 'mini-card' }, it.icon ? h('div', { class: 'mini-card-icon', html: it.icon }) : null, h('h4', { html: it.title }), h('div', { html: it.html }))
      );
    }
    return grid;
  };

  /** Tabs: [{label, render(el)}]; panels render lazily on first open. */
  EM.tabs = function (parent, tabs) {
    const wrap = EM.add(parent, 'div', { class: 'tabs' });
    const bar = EM.add(wrap, 'div', { class: 'tab-bar', role: 'tablist' });
    const body = EM.add(wrap, 'div', { class: 'tab-body' });
    const panels = [];
    tabs.forEach((t, i) => {
      const btn = EM.add(bar, 'button', { class: 'tab-btn', role: 'tab', type: 'button', html: t.label });
      const panel = EM.add(body, 'div', { class: 'tab-panel', role: 'tabpanel', hidden: true });
      panels.push({ btn, panel, rendered: false, t });
      btn.addEventListener('click', () => select(i));
    });
    function select(i) {
      panels.forEach((p, j) => {
        p.btn.classList.toggle('active', i === j);
        p.btn.setAttribute('aria-selected', i === j);
        p.panel.hidden = i !== j;
        if (i === j && !p.rendered) {
          p.rendered = true;
          p.t.render(p.panel);
        }
      });
    }
    select(0);
    return { el: wrap, select };
  };

  /**
   * Step-through explainer: steps = [{title, html}], onStep(i) called on every change.
   * Returns {el, go(i), index()}
   */
  EM.stepper = function (parent, steps, onStep) {
    const wrap = EM.add(parent, 'div', { class: 'stepper' });
    const head = EM.add(wrap, 'div', { class: 'stepper-head' });
    const dots = steps.map((s, i) => EM.add(head, 'button', { class: 'stepper-dot', type: 'button', title: s.title, text: i + 1, onclick: () => go(i) }));
    const text = EM.add(wrap, 'div', { class: 'stepper-text' });
    const nav = EM.add(wrap, 'div', { class: 'stepper-nav' });
    const prev = EM.add(nav, 'button', { class: 'btn', type: 'button', text: '← Back', onclick: () => go(idx - 1) });
    const next = EM.add(nav, 'button', { class: 'btn btn-primary', type: 'button', text: 'Next step →', onclick: () => go(idx + 1) });
    let idx = 0;
    function go(i) {
      idx = Math.max(0, Math.min(steps.length - 1, i));
      dots.forEach((d, j) => {
        d.classList.toggle('active', j === idx);
        d.classList.toggle('done', j < idx);
      });
      text.innerHTML = `<strong>Step ${idx + 1} of ${steps.length}: ${steps[idx].title}</strong><div>${steps[idx].html || ''}</div>`;
      prev.disabled = idx === 0;
      next.disabled = idx === steps.length - 1;
      if (onStep) onStep(idx);
    }
    go(0);
    return { el: wrap, go, index: () => idx };
  };

  /** Collapsible <details>. render(el) or html. */
  EM.details = function (parent, summary, content, open) {
    const d = EM.add(parent, 'details', { class: 'more', open: !!open });
    d.append(h('summary', { html: summary }));
    const body = EM.add(d, 'div', { class: 'more-body' });
    if (typeof content === 'function') content(body);
    else body.innerHTML = content;
    return d;
  };

  /* ------------------------------------------------------------------ controls */

  EM.controls = function (parent) {
    return EM.add(parent, 'div', { class: 'controls' });
  };

  /** Slider. opts: {label, min, max, step, value, unit, fmt(v)->string, onInput(v)} */
  EM.slider = function (parent, opts) {
    const id = 'sl-' + Math.random().toString(36).slice(2, 8);
    const wrap = EM.add(parent, 'div', { class: 'ctl ctl-slider' });
    const lab = EM.add(wrap, 'label', { for: id });
    lab.append(h('span', { class: 'ctl-label', html: opts.label }));
    const val = EM.add(lab, 'span', { class: 'ctl-value' });
    const input = EM.add(wrap, 'input', { id, type: 'range', min: opts.min, max: opts.max, step: opts.step ?? 'any', value: opts.value });
    const show = () => {
      const v = parseFloat(input.value);
      val.innerHTML = (opts.fmt ? opts.fmt(v) : EM.fmt(v)) + (opts.unit ? ' ' + opts.unit : '');
    };
    input.addEventListener('input', () => {
      show();
      opts.onInput && opts.onInput(parseFloat(input.value));
    });
    show();
    return {
      el: wrap,
      input,
      get value() {
        return parseFloat(input.value);
      },
      set(v, fire) {
        input.value = v;
        show();
        if (fire && opts.onInput) opts.onInput(parseFloat(input.value));
      },
    };
  };

  /** Select. opts: {label, options:[{value,label}] | [string], value, onChange(v)} */
  EM.select = function (parent, opts) {
    const wrap = EM.add(parent, 'div', { class: 'ctl ctl-select' });
    if (opts.label) wrap.append(h('span', { class: 'ctl-label', html: opts.label }));
    const sel = EM.add(wrap, 'select', {});
    for (const o of opts.options) {
      const oo = typeof o === 'string' ? { value: o, label: o } : o;
      sel.append(h('option', { value: oo.value, text: oo.label }));
    }
    if (opts.value != null) sel.value = opts.value;
    sel.addEventListener('change', () => opts.onChange && opts.onChange(sel.value));
    return {
      el: wrap,
      input: sel,
      get value() {
        return sel.value;
      },
      set(v) {
        sel.value = v;
      },
    };
  };

  /** Segmented buttons. opts: {label, options:[{value,label}], value, onChange(v)} */
  EM.segmented = function (parent, opts) {
    const wrap = EM.add(parent, 'div', { class: 'ctl ctl-seg' });
    if (opts.label) wrap.append(h('span', { class: 'ctl-label', html: opts.label }));
    const row = EM.add(wrap, 'div', { class: 'seg' });
    let value = opts.value ?? (typeof opts.options[0] === 'string' ? opts.options[0] : opts.options[0].value);
    const btns = opts.options.map((o) => {
      const oo = typeof o === 'string' ? { value: o, label: o } : o;
      const b = EM.add(row, 'button', { type: 'button', class: 'seg-btn', html: oo.label });
      b.addEventListener('click', () => {
        set(oo.value);
        opts.onChange && opts.onChange(oo.value);
      });
      return { b, v: oo.value };
    });
    function set(v) {
      value = v;
      btns.forEach((x) => x.b.classList.toggle('active', x.v === v));
    }
    set(value);
    return {
      el: wrap,
      get value() {
        return value;
      },
      set,
    };
  };

  /** Toggle switch. opts: {label, value, onChange(bool)} */
  EM.toggle = function (parent, opts) {
    const wrap = EM.add(parent, 'label', { class: 'ctl ctl-toggle' });
    const input = EM.add(wrap, 'input', { type: 'checkbox' });
    input.checked = !!opts.value;
    wrap.append(h('span', { class: 'switch' }), h('span', { class: 'ctl-label', html: opts.label }));
    input.addEventListener('change', () => opts.onChange && opts.onChange(input.checked));
    return {
      el: wrap,
      input,
      get value() {
        return input.checked;
      },
      set(v) {
        input.checked = !!v;
      },
    };
  };

  EM.button = function (parent, label, onClick, variant) {
    return EM.add(parent, 'button', { type: 'button', class: 'btn' + (variant ? ' btn-' + variant : ''), html: label, onclick: onClick });
  };

  /**
   * Live readouts. items: [{key, label}] -> returns {el, set(key, html)}
   */
  EM.readout = function (parent, items) {
    const wrap = EM.add(parent, 'div', { class: 'readout' });
    const map = {};
    for (const it of items) {
      const box = EM.add(wrap, 'div', { class: 'readout-item' });
      box.append(h('div', { class: 'readout-label', html: it.label }));
      map[it.key] = EM.add(box, 'div', { class: 'readout-value', html: it.value || '–' });
    }
    return {
      el: wrap,
      set(key, html) {
        if (map[key] && map[key].innerHTML !== String(html)) map[key].innerHTML = html;
      },
    };
  };

  /** Simple status/message line under a sim. Returns {el, set(html, type)} */
  EM.status = function (parent, html) {
    const el = EM.add(parent, 'div', { class: 'sim-status', html: html || '' });
    return {
      el,
      set(html, type) {
        if (el.innerHTML !== html) el.innerHTML = html;
        el.dataset.type = type || '';
      },
    };
  };

  /* ------------------------------------------------------------------ math formatting */

  EM.frac = (n, d) => `<span class="frac"><span class="num">${n}</span><span class="den">${d}</span></span>`;
  EM.sqrt = (x) => `<span class="sqrt"><span class="sqrt-sign">√</span><span class="radicand">${x}</span></span>`;
  EM.math = (html) => `<span class="math">${html}</span>`;

  /** Format a number for display (HTML). Uses ×10ⁿ for very large/small values. */
  EM.fmt = function (x, sig = 3) {
    if (x == null || Number.isNaN(x)) return '–';
    if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
    if (x === 0) return '0';
    const ax = Math.abs(x);
    if (ax >= 1e-3 && ax < 1e6) {
      let s = Number(x.toPrecision(sig)).toString();
      if (ax >= 1000) s = Number(s).toLocaleString('en-IE', { maximumFractionDigits: 3 });
      return s.replace('-', '−');
    }
    const e = Math.floor(Math.log10(ax));
    let m = x / Math.pow(10, e);
    m = Number(m.toPrecision(sig));
    if (Math.abs(m) >= 10) return EM.fmt(x * 1.0000001, sig);
    return `${String(m).replace('-', '−')} × 10<sup>${String(e).replace('-', '−')}</sup>`;
  };
  /** Plain-text version of EM.fmt (for canvas text). */
  EM.fmtText = function (x, sig = 3) {
    return EM.fmt(x, sig)
      .replace(/<sup>(.*?)<\/sup>/g, (_, p) => '^' + p)
      .replace(/<[^>]+>/g, '');
  };

  /** Parse user input like "8.854e-12", "1.6x10^-19", "1.6 × 10-19", "-3". */
  EM.parseNum = function (s) {
    if (typeof s === 'number') return s;
    s = String(s).trim().replace(/−/g, '-').replace(/,/g, '');
    if (!s) return NaN;
    const m = s.match(/^([-+]?\d*\.?\d+)\s*(?:[x×*]\s*10\s*\^?\s*([-+]?\d+))$/i);
    if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
    const n = Number(s);
    return n;
  };

  EM.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  EM.lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------------ colours */

  EM.colors = {
    bg: '#0b1220',
    panel: '#131c31',
    grid: 'rgba(148,163,184,0.10)',
    text: '#e2e8f0',
    muted: '#94a3b8',
    pos: '#ef4444',
    neg: '#3b82f6',
    efield: '#fbbf24',
    bfield: '#a78bfa',
    current: '#facc15',
    electron: '#60a5fa',
    hole: '#f87171',
    wire: '#cbd5e1',
    copper: '#d97706',
    north: '#dc2626',
    south: '#2563eb',
    good: '#22c55e',
    bad: '#ef4444',
    warn: '#f97316',
    force: '#34d399',
    velocity: '#f472b6',
    metal: '#94a3b8',
    gold: '#eab308',
  };

  /* ------------------------------------------------------------------ canvas */

  /**
   * Animated, responsive canvas in logical coordinates.
   * opts: {width=720, height=400, label, draw(ctx, sim, dt), onDown(p,sim,e), onMove(p,sim,e), onUp(p,sim,e),
   *        state:{}, background=true, cursor}
   * sim: {canvas, ctx, W, H, t, state, pointer:{x,y,down,inside}}
   * Drawing is paused while the canvas is off-screen and stops when the page changes.
   */
  EM.canvas = function (parent, opts) {
    const W = opts.width || 720;
    const H = opts.height || 400;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = EM.add(parent, 'div', { class: 'sim-canvas-wrap' });
    const cv = EM.add(wrap, 'canvas', { width: Math.round(W * dpr), height: Math.round(H * dpr), role: 'img', 'aria-label': opts.label || 'Interactive simulation' });
    cv.style.aspectRatio = W + ' / ' + H;
    if (opts.cursor) cv.style.cursor = opts.cursor;
    const ctx = cv.getContext('2d');
    const sim = { canvas: cv, wrap, ctx, W, H, t: 0, state: opts.state || {}, pointer: { x: -1, y: -1, down: false, inside: false } };

    const interactive = opts.onDown || opts.onMove || opts.onUp;
    if (interactive) cv.style.touchAction = 'none';
    const toLocal = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      Object.assign(sim.pointer, p, { down: true, inside: true });
      if (interactive) cv.setPointerCapture(e.pointerId);
      opts.onDown && opts.onDown(p, sim, e);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      Object.assign(sim.pointer, p, { inside: true });
      opts.onMove && opts.onMove(p, sim, e);
    });
    const up = (e) => {
      const p = toLocal(e);
      const wasDown = sim.pointer.down;
      Object.assign(sim.pointer, p, { down: false });
      if (wasDown) opts.onUp && opts.onUp(p, sim, e);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => {
      sim.pointer.inside = false;
    });

    let visible = true;
    let raf = 0;
    let last = performance.now();
    let stopped = false;
    function frame(now) {
      if (stopped) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (visible) {
        sim.t += dt;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (opts.background !== false) {
          ctx.fillStyle = EM.colors.bg;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.save();
        try {
          opts.draw && opts.draw(ctx, sim, dt);
        } catch (err) {
          console.error(err);
          stopped = true;
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((ents) => {
        visible = ents[0].isIntersecting;
      });
      io.observe(cv);
    }
    sim.stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      io && io.disconnect();
    };
    EM.onCleanup(sim.stop);
    return sim;
  };

  /* ------------------------------------------------------------------ drawing */

  const D = (EM.draw = {});

  D.text = function (ctx, str, x, y, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 500} ${o.size || 13}px ${o.font || 'Inter, system-ui, sans-serif'}`;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    if (o.bg) {
      const w = ctx.measureText(str).width;
      const pad = 4;
      const hgt = (o.size || 13) + 6;
      let bx = x - (ctx.textAlign === 'center' ? w / 2 : ctx.textAlign === 'right' ? w : 0) - pad;
      ctx.fillStyle = o.bg;
      D.roundRect(ctx, bx, y - hgt / 2, w + pad * 2, hgt, 4);
      ctx.fill();
    }
    ctx.fillStyle = o.color || EM.colors.text;
    ctx.fillText(str, x, y);
    ctx.restore();
  };

  D.roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  D.line = function (ctx, x1, y1, x2, y2, color, width = 2, dash) {
    ctx.save();
    ctx.strokeStyle = color || EM.colors.wire;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  /** Arrow from (x1,y1) to (x2,y2). o: {color, width, head, dash, label} */
  D.arrow = function (ctx, x1, y1, x2, y2, o = {}) {
    const color = o.color || EM.colors.force;
    const width = o.width || 2.5;
    const head = o.head || 8 + width * 1.5;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(ang) * Math.min(head * 0.8, len), y2 - Math.sin(ang) * Math.min(head * 0.8, len));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - 0.42), y2 - head * Math.sin(ang - 0.42));
    ctx.lineTo(x2 - head * Math.cos(ang + 0.42), y2 - head * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (o.label) D.text(ctx, o.label, x2 + Math.cos(ang) * 14, y2 + Math.sin(ang) * 14, { color, size: o.labelSize || 13, weight: 700 });
  };

  /** Point charge. sign: +1 / -1 / 0. o: {r, label} */
  D.charge = function (ctx, x, y, sign, o = {}) {
    const r = o.r || 16;
    const base = sign > 0 ? EM.colors.pos : sign < 0 ? EM.colors.neg : '#64748b';
    ctx.save();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, base);
    g.addColorStop(1, shade(base, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1.5, r / 9);
    ctx.beginPath();
    const s = r * 0.45;
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    if (sign > 0) {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
    }
    if (sign !== 0) ctx.stroke();
    ctx.restore();
    if (o.label) D.text(ctx, o.label, x, y + r + 12, { size: 12, color: EM.colors.muted });
  };

  /** Small sign marker (for charges spread over a surface). */
  D.sign = function (ctx, x, y, sign, size = 5) {
    ctx.save();
    ctx.strokeStyle = sign > 0 ? EM.colors.pos : EM.colors.neg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    if (sign > 0) {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
    }
    ctx.stroke();
    ctx.restore();
  };

  D.electron = function (ctx, x, y, r = 4, color) {
    ctx.save();
    ctx.fillStyle = color || EM.colors.electron;
    ctx.shadowColor = color || EM.colors.electron;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** Positive hole: hollow red circle. */
  D.hole = function (ctx, x, y, r = 4) {
    ctx.save();
    ctx.strokeStyle = EM.colors.hole;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /** Bar magnet centred at (x,y), length L, thickness T, angle a (radians). Angle 0 puts N on the RIGHT. */
  D.magnet = function (ctx, x, y, L, T, a = 0, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = EM.colors.south;
    D.roundRect(ctx, -L / 2, -T / 2, L / 2, T, 4);
    ctx.fill();
    ctx.fillStyle = EM.colors.north;
    D.roundRect(ctx, 0, -T / 2, L / 2, T, 4);
    ctx.fill();
    ctx.fillRect(0, -T / 2, 6, T);
    ctx.fillStyle = EM.colors.south;
    ctx.fillRect(-6, -T / 2, 6, T);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    D.roundRect(ctx, -L / 2, -T / 2, L, T, 4);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.min(22, T * 0.6)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(L / 4, 0);
    ctx.rotate(-a);
    ctx.fillText(o.nLabel || 'N', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(-L / 4, 0);
    ctx.rotate(-a);
    ctx.fillText(o.sLabel || 'S', 0, 0);
    ctx.restore();
    ctx.restore();
  };

  /** Plotting compass. angle = direction the north (red) end points. */
  D.compass = function (ctx, x, y, angle, r = 14) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.strokeStyle = 'rgba(203,213,225,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(angle);
    ctx.fillStyle = EM.colors.north;
    ctx.beginPath();
    ctx.moveTo(r * 0.85, 0);
    ctx.lineTo(0, -r * 0.22);
    ctx.lineTo(0, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, 0);
    ctx.lineTo(0, -r * 0.22);
    ctx.lineTo(0, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /** Light bulb. brightness 0..1. o: {r, broken, label} */
  D.bulb = function (ctx, x, y, brightness = 0, o = {}) {
    const r = o.r || 18;
    const b = EM.clamp(brightness, 0, 1);
    ctx.save();
    if (b > 0.02 && !o.broken) {
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * (2 + 2.5 * b));
      g.addColorStop(0, `rgba(253,224,71,${0.55 * b + 0.1})`);
      g.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * (2 + 2.5 * b), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = o.broken ? '#1f2937' : `rgb(${Math.round(60 + 193 * b)},${Math.round(65 + 159 * b)},${Math.round(80 - 10 * b)})`;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // filament / cross symbol
    ctx.strokeStyle = o.broken ? '#64748b' : b > 0.1 ? '#fff7ed' : '#94a3b8';
    ctx.beginPath();
    const s = r * 0.7;
    if (o.broken) {
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x - 2, y - 2);
      ctx.moveTo(x + s, y + s);
      ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
    } else {
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
    }
    ctx.stroke();
    ctx.restore();
    if (o.label) D.text(ctx, o.label, x, y + r + 13, { size: 12, color: EM.colors.muted });
  };

  /** Analogue meter (galvanometer/ammeter/voltmeter). value -1..1 (centre-zero) or 0..1. o: {r, label, centerZero=true, reading} */
  D.meter = function (ctx, x, y, value, o = {}) {
    const r = o.r || 40;
    const cz = o.centerZero !== false;
    const v = EM.clamp(value, cz ? -1 : 0, 1);
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.25);
    ctx.lineTo(x - r, y + r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI * 0.8 + Math.PI * 0.1;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
      ctx.lineTo(x + Math.cos(a) * r * (i % 5 === 0 ? 0.62 : 0.7), y + Math.sin(a) * r * (i % 5 === 0 ? 0.62 : 0.7));
      ctx.stroke();
    }
    const frac = cz ? (v + 1) / 2 : v;
    const a = Math.PI + Math.PI * 0.1 + frac * Math.PI * 0.8;
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.1);
    ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.1, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (o.label) D.text(ctx, o.label, x, y - r * 0.32, { size: Math.max(11, r * 0.28), weight: 700, color: '#0f172a' });
    if (o.reading) D.text(ctx, o.reading, x, y + r * 0.25 + 14, { size: 12, color: EM.colors.text, weight: 600 });
  };

  /** Polyline wire. pts = [[x,y],...] */
  D.wire = function (ctx, pts, color, width = 3) {
    ctx.save();
    ctx.strokeStyle = color || EM.colors.wire;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.restore();
  };

  /** Dots flowing along a polyline to show current. t = time (s), speed in px/s (negative reverses). */
  D.flowDots = function (ctx, pts, t, o = {}) {
    const spacing = o.spacing || 22;
    const speed = o.speed ?? 60;
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(l);
      total += l;
    }
    if (total <= 0 || speed === 0) {
      if (speed === 0 && o.showStatic !== false && o.staticDots) {
        // nothing
      }
    }
    let off = (((t * speed) % spacing) + spacing) % spacing;
    ctx.save();
    ctx.fillStyle = o.color || EM.colors.current;
    for (let d = off; d < total; d += spacing) {
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        if (d <= acc + segs[i]) {
          const f = (d - acc) / segs[i];
          const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
          const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
          ctx.beginPath();
          ctx.arc(x, y, o.r || 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        acc += segs[i];
      }
    }
    ctx.restore();
  };

  /** Cell symbol (long + short plate) centred at x,y. o: {vertical, label, gap=8, color} Long plate (+) is on the left (or top when vertical). */
  D.cell = function (ctx, x, y, o = {}) {
    ctx.save();
    ctx.strokeStyle = o.color || EM.colors.wire;
    ctx.lineCap = 'butt';
    const g = o.gap || 8;
    const plates = [
      [-g / 2, 15, 3],
      [g / 2, 8, 5],
    ];
    for (const [off, half, w] of plates) {
      ctx.lineWidth = w;
      ctx.beginPath();
      if (o.vertical) {
        ctx.moveTo(x - half, y + off);
        ctx.lineTo(x + half, y + off);
      } else {
        ctx.moveTo(x + off, y - half);
        ctx.lineTo(x + off, y + half);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (o.label) {
      if (o.vertical) D.text(ctx, o.label, x + 22, y, { size: 12, align: 'left', color: EM.colors.muted });
      else D.text(ctx, o.label, x, y - 24, { size: 12, color: EM.colors.muted });
    }
  };

  /** Resistor box centred at x,y. o: {vertical, w=46, h=16, label, fill} */
  D.resistor = function (ctx, x, y, o = {}) {
    const w = o.vertical ? o.h || 16 : o.w || 46;
    const hh = o.vertical ? o.w || 46 : o.h || 16;
    ctx.save();
    ctx.fillStyle = o.fill || EM.colors.bg;
    ctx.strokeStyle = o.color || EM.colors.wire;
    ctx.lineWidth = 2.5;
    ctx.fillRect(x - w / 2, y - hh / 2, w, hh);
    ctx.strokeRect(x - w / 2, y - hh / 2, w, hh);
    ctx.restore();
    if (o.label) {
      if (o.vertical) D.text(ctx, o.label, x + w / 2 + 8, y, { size: 12, align: 'left', color: EM.colors.muted });
      else D.text(ctx, o.label, x, y - hh / 2 - 11, { size: 12, color: EM.colors.muted });
    }
  };

  /** Switch symbol between (x1,y) and (x2,y). */
  D.switch = function (ctx, x1, y, x2, closed, o = {}) {
    ctx.save();
    ctx.strokeStyle = o.color || EM.colors.wire;
    ctx.fillStyle = o.color || EM.colors.wire;
    ctx.lineWidth = 2.5;
    [x1, x2].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(x1, y);
    if (closed) ctx.lineTo(x2, y);
    else ctx.lineTo(x2 - 4, y - (x2 - x1) * 0.5);
    ctx.stroke();
    ctx.restore();
    if (o.label) D.text(ctx, o.label, (x1 + x2) / 2, y + 16, { size: 12, color: EM.colors.muted });
  };

  /** Grid background. */
  D.grid = function (ctx, W, H, step = 40) {
    ctx.save();
    ctx.strokeStyle = EM.colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  };

  /** B field into (x) or out of (•) the page symbols over a rect. dir: 'in' | 'out' */
  D.bGrid = function (ctx, x, y, w, h, dir = 'in', step = 34, color) {
    ctx.save();
    ctx.strokeStyle = color || 'rgba(167,139,250,0.55)';
    ctx.fillStyle = color || 'rgba(167,139,250,0.55)';
    ctx.lineWidth = 1.5;
    for (let yy = y + step / 2; yy < y + h; yy += step) {
      for (let xx = x + step / 2; xx < x + w; xx += step) {
        ctx.beginPath();
        if (dir === 'in') {
          ctx.moveTo(xx - 4, yy - 4);
          ctx.lineTo(xx + 4, yy + 4);
          ctx.moveTo(xx + 4, yy - 4);
          ctx.lineTo(xx - 4, yy + 4);
          ctx.stroke();
        } else {
          ctx.arc(xx, yy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  };

  /** Nice tick step for an axis range. */
  function niceStep(range, target = 6) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  /**
   * Draw a graph inside rect r = {x,y,w,h}.
   * o: {xMin,xMax,yMin,yMax,xLabel,yLabel, title, series:[{fn(x) | points:[[x,y]], color, width, dash, label}],
   *     markers:[{x,y,color,label}], hLines:[{y,color,label,dash}], vLines:[{x,color,label,dash}], ticks=true}
   * Returns {sx, sy} mapping functions.
   */
  D.plot = function (ctx, r, o) {
    const { xMin, xMax, yMin, yMax } = o;
    const sx = (x) => r.x + ((x - xMin) / (xMax - xMin)) * r.w;
    const sy = (y) => r.y + r.h - ((y - yMin) / (yMax - yMin)) * r.h;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.6)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // grid + ticks
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = EM.colors.muted;
    ctx.strokeStyle = EM.colors.grid;
    ctx.lineWidth = 1;
    if (o.ticks !== false) {
      const xs = niceStep(xMax - xMin, o.xTicks || 6);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let v = Math.ceil(xMin / xs) * xs; v <= xMax + 1e-9; v += xs) {
        const px = sx(v);
        ctx.beginPath();
        ctx.moveTo(px, r.y);
        ctx.lineTo(px, r.y + r.h);
        ctx.stroke();
        ctx.fillText(EM.fmtText(Math.abs(v) < xs * 1e-6 ? 0 : v, 3), px, r.y + r.h + 4);
      }
      const ys = niceStep(yMax - yMin, o.yTicks || 5);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = Math.ceil(yMin / ys) * ys; v <= yMax + 1e-9; v += ys) {
        const py = sy(v);
        ctx.beginPath();
        ctx.moveTo(r.x, py);
        ctx.lineTo(r.x + r.w, py);
        ctx.stroke();
        ctx.fillText(EM.fmtText(Math.abs(v) < ys * 1e-6 ? 0 : v, 3), r.x - 5, py);
      }
    }
    // axes
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    const ax0 = yMin <= 0 && yMax >= 0 ? sy(0) : r.y + r.h;
    const ay0 = xMin <= 0 && xMax >= 0 ? sx(0) : r.x;
    ctx.beginPath();
    ctx.moveTo(r.x, ax0);
    ctx.lineTo(r.x + r.w, ax0);
    ctx.moveTo(ay0, r.y);
    ctx.lineTo(ay0, r.y + r.h);
    ctx.stroke();
    // clip series to rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    for (const hl of o.hLines || []) D.line(ctx, r.x, sy(hl.y), r.x + r.w, sy(hl.y), hl.color || EM.colors.muted, 1.5, hl.dash || [5, 4]);
    for (const vl of o.vLines || []) D.line(ctx, sx(vl.x), r.y, sx(vl.x), r.y + r.h, vl.color || EM.colors.muted, 1.5, vl.dash || [5, 4]);
    for (const s of o.series || []) {
      ctx.strokeStyle = s.color || EM.colors.efield;
      ctx.lineWidth = s.width || 2.5;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      if (s.fn) {
        const n = s.samples || Math.max(100, Math.round(r.w));
        let started = false;
        for (let i = 0; i <= n; i++) {
          const x = xMin + ((xMax - xMin) * i) / n;
          const y = s.fn(x);
          if (!Number.isFinite(y)) {
            started = false;
            continue;
          }
          const py = EM.clamp(sy(y), r.y - 1000, r.y + r.h + 1000);
          if (!started) {
            ctx.moveTo(sx(x), py);
            started = true;
          } else ctx.lineTo(sx(x), py);
        }
      } else if (s.points) {
        s.points.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const m of o.markers || []) {
      ctx.fillStyle = m.color || '#fff';
      ctx.beginPath();
      ctx.arc(sx(m.x), sy(m.y), m.r || 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    for (const m of o.markers || []) if (m.label) D.text(ctx, m.label, sx(m.x) + 8, sy(m.y) - 12, { align: 'left', size: 12, color: m.color || '#fff', bg: 'rgba(11,18,32,0.8)' });
    for (const hl of o.hLines || []) if (hl.label) D.text(ctx, hl.label, r.x + r.w - 4, sy(hl.y) - 9, { align: 'right', size: 11, color: hl.color || EM.colors.muted });
    for (const vl of o.vLines || []) if (vl.label) D.text(ctx, vl.label, sx(vl.x) + 4, r.y + 10, { align: 'left', size: 11, color: vl.color || EM.colors.muted });
    // legend
    let ly = r.y + 12;
    for (const s of o.series || []) {
      if (!s.label) continue;
      D.line(ctx, r.x + 10, ly, r.x + 28, ly, s.color, 3, s.dash);
      D.text(ctx, s.label, r.x + 34, ly, { align: 'left', size: 11, color: EM.colors.text });
      ly += 16;
    }
    if (o.xLabel) D.text(ctx, o.xLabel, r.x + r.w / 2, r.y + r.h + 24, { size: 12, color: EM.colors.text });
    if (o.yLabel) {
      ctx.save();
      ctx.translate(r.x - 38, r.y + r.h / 2);
      ctx.rotate(-Math.PI / 2);
      D.text(ctx, o.yLabel, 0, 0, { size: 12, color: EM.colors.text });
      ctx.restore();
    }
    if (o.title) D.text(ctx, o.title, r.x + r.w / 2, r.y - 12, { size: 13, weight: 700 });
    ctx.restore();
    return { sx, sy };
  };

  /** Draw traced field lines (from EM.physics.fieldLines) with arrowheads. */
  D.fieldLines = function (ctx, lines, o = {}) {
    ctx.save();
    ctx.strokeStyle = o.color || EM.colors.efield;
    ctx.fillStyle = o.color || EM.colors.efield;
    ctx.lineWidth = o.width || 1.6;
    ctx.globalAlpha = o.alpha ?? 0.9;
    for (const ln of lines) {
      const pts = ln.points;
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      if (o.arrows !== false) {
        const every = o.arrowEvery || 90;
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (acc >= every) {
            acc = 0;
            let [a, b] = [pts[i - 1], pts[i]];
            if (ln.dir < 0) [a, b] = [b, a];
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const s = 6;
            ctx.beginPath();
            ctx.moveTo(b[0] + Math.cos(ang) * s, b[1] + Math.sin(ang) * s);
            ctx.lineTo(b[0] - Math.cos(ang - 0.5) * s, b[1] - Math.sin(ang - 0.5) * s);
            ctx.lineTo(b[0] - Math.cos(ang + 0.5) * s, b[1] - Math.sin(ang + 0.5) * s);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    const f = (c) => Math.round(EM.clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  D.shade = shade;

  /* ------------------------------------------------------------------ physics helpers */

  const P = (EM.physics = {
    k: 8.99e9,
    eps0: 8.854e-12,
    e: 1.6e-19,
    me: 9.11e-31,
    mp: 1.67e-27,
  });

  /** 2D inverse-square field (screen units) from charges [{x,y,q}]. soft avoids singularities. */
  P.E = function (charges, x, y, soft = 25) {
    let ex = 0,
      ey = 0;
    for (const c of charges) {
      const dx = x - c.x,
        dy = y - c.y;
      const r2 = dx * dx + dy * dy + soft;
      const k = c.q / (r2 * Math.sqrt(r2));
      ex += k * dx;
      ey += k * dy;
    }
    return [ex, ey];
  };

  /**
   * Trace field lines from charges [{x,y,q}] (screen coordinates).
   * o: {perUnit=8 lines per unit |q|, step=4, maxSteps=1500, r0=14, bounds:{x0,y0,x1,y1}, startAngle=0}
   * Lines start on positive charges (or on negative charges, traced backwards, when there are no positives).
   * Each line: {points:[[x,y]], dir:+1 if points follow the field direction, -1 otherwise}.
   */
  P.fieldLines = function (charges, o = {}) {
    const step = o.step || 4;
    const maxSteps = o.maxSteps || 1500;
    const r0 = o.r0 || 14;
    const perUnit = o.perUnit || 8;
    const b = o.bounds || { x0: -200, y0: -200, x1: 2000, y1: 2000 };
    const pos = charges.filter((c) => c.q > 0);
    const neg = charges.filter((c) => c.q < 0);
    const seeds = [];
    const useNeg = o.from === 'neg' || (pos.length === 0 && neg.length > 0);
    const sources = useNeg ? neg : pos;
    for (const c of sources) {
      const n = Math.max(1, Math.round(perUnit * Math.abs(c.q)));
      for (let i = 0; i < n; i++) {
        const a = (o.startAngle || 0) + (2 * Math.PI * (i + 0.5)) / n;
        seeds.push({ x: c.x + r0 * Math.cos(a), y: c.y + r0 * Math.sin(a), sign: useNeg ? -1 : 1, src: c });
      }
    }
    const lines = [];
    for (const s of seeds) {
      const pts = [[s.x, s.y]];
      let x = s.x,
        y = s.y;
      for (let i = 0; i < maxSteps; i++) {
        let [ex, ey] = P.E(charges, x, y, 1);
        let m = Math.hypot(ex, ey) || 1;
        const mx = x + (s.sign * step * ex) / m / 2,
          my = y + (s.sign * step * ey) / m / 2;
        [ex, ey] = P.E(charges, mx, my, 1);
        m = Math.hypot(ex, ey) || 1;
        x += (s.sign * step * ex) / m;
        y += (s.sign * step * ey) / m;
        pts.push([x, y]);
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) break;
        let hit = false;
        for (const c of charges) if (c !== s.src && Math.hypot(x - c.x, y - c.y) < r0 * 0.8) hit = true;
        if (hit) break;
      }
      lines.push({ points: pts, dir: s.sign });
    }
    return lines;
  };

  /** Bar magnet as a set of pseudo-charges (N = +, S = −) for field-line tracing. Angle 0 → N on the right. */
  P.magnetPoles = function (x, y, L, a = 0, strength = 1, n = 5, T = 20) {
    const out = [];
    const ux = Math.cos(a),
      uy = Math.sin(a),
      vx = -uy,
      vy = ux;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * T * 0.8;
      out.push({ x: x + (ux * L) / 2.3 + vx * off, y: y + (uy * L) / 2.3 + vy * off, q: strength / n });
      out.push({ x: x - (ux * L) / 2.3 + vx * off, y: y - (uy * L) / 2.3 + vy * off, q: -strength / n });
    }
    return out;
  };

  /* ------------------------------------------------------------------ progress (localStorage) */

  const KEY = 'em-explorer-progress-v1';
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }
  EM.progress = {
    data: loadProgress(),
    get(key) {
      return !!this.data[key];
    },
    set(key, v) {
      if (v) this.data[key] = Date.now();
      else delete this.data[key];
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {}
      document.dispatchEvent(new CustomEvent('em-progress'));
    },
  };
})();
