/* Shared content components: formula cards with calculators, experiment cards, definition boxes. */
(function () {
  'use strict';
  const { h, add } = { h: EM.h, add: EM.add };

  /* ------------------------------------------------------------------ formulas */

  /**
   * Formula shape:
   * { id, name, display: html, vars:[{sym, label(html), name, unit(html), value, constant?}],
   *   solve:{ sym: (v)=>number }, notes?: html, derivation?: html | [html], example?: {q, a}, tags? }
   * `v` passed to solve contains every var's numeric value keyed by sym.
   */
  EM.formulaCard = function (f, ch, opts = {}) {
    const card = h('div', { class: 'formula-card', id: 'f-' + f.id, style: ch ? { '--accent': ch.color } : null });
    const head = add(card, 'div', { class: 'formula-head' });
    head.append(h('div', { class: 'formula-kicker', text: 'Formula' + (ch ? ' · ' + ch.code : '') }), h('h3', { html: f.name }));
    add(card, 'div', { class: 'formula-display', html: f.display });

    if (f.vars && f.vars.length) {
      const tbl = add(card, 'table', { class: 'var-table' });
      for (const v of f.vars) {
        tbl.append(
          h('tr', {}, h('td', { class: 'var-sym', html: v.label || v.sym }), h('td', { html: v.name + (v.constant ? ' <span class="tag">constant</span>' : '') }), h('td', { class: 'var-unit', html: v.unit || '' }))
        );
      }
    }
    if (f.notes) add(card, 'div', { class: 'formula-notes', html: f.notes });

    const solvable = Object.keys(f.solve || {});
    if (solvable.length && !opts.noCalc) {
      const calc = add(card, 'div', { class: 'calc' });
      const top = add(calc, 'div', { class: 'calc-top' });
      top.append(h('span', { class: 'calc-title', text: 'Calculator' }));
      const sel = add(top, 'select', { 'aria-label': 'Solve for' });
      for (const s of solvable) {
        const v = f.vars.find((x) => x.sym === s);
        sel.append(h('option', { value: s, text: 'Solve for ' + stripTags(v ? v.label || v.sym : s) + (v ? ' (' + v.name + ')' : '') }));
      }
      const inputs = add(calc, 'div', { class: 'calc-inputs' });
      const out = add(calc, 'div', { class: 'calc-out' });
      const fields = {};
      for (const v of f.vars) {
        const row = add(inputs, 'label', { class: 'calc-field' });
        row.append(h('span', { class: 'calc-sym', html: v.label || v.sym }));
        const inp = add(row, 'input', { type: 'text', inputmode: 'decimal', value: fmtInput(v.value), 'aria-label': v.name });
        row.append(h('span', { class: 'calc-unit', html: v.unit || '' }));
        inp.addEventListener('input', compute);
        fields[v.sym] = { row, inp, v };
      }
      sel.addEventListener('change', () => {
        layout();
        compute();
      });
      function layout() {
        for (const [s, fd] of Object.entries(fields)) fd.row.hidden = s === sel.value;
      }
      function compute() {
        const target = sel.value;
        const vals = {};
        let bad = null;
        for (const [s, fd] of Object.entries(fields)) {
          if (s === target) continue;
          const n = EM.parseNum(fd.inp.value);
          fd.inp.classList.toggle('invalid', !Number.isFinite(n));
          if (!Number.isFinite(n)) bad = fd.v;
          vals[s] = n;
        }
        const tv = f.vars.find((x) => x.sym === target);
        if (bad) {
          out.innerHTML = `<span class="calc-err">Enter a number for ${bad.label || bad.sym} (e.g. 3.2 or 1.6e-19 or 1.6x10^-19)</span>`;
          return;
        }
        let r;
        try {
          r = f.solve[target](vals);
        } catch (e) {
          r = NaN;
        }
        if (!Number.isFinite(r)) {
          out.innerHTML = `<span class="calc-err">No valid answer for these values — check for zeros or impossible inputs.</span>`;
          return;
        }
        out.innerHTML = `<span class="calc-sym">${tv ? tv.label || tv.sym : target}</span> = <strong>${EM.fmt(r, 4)}</strong> ${tv && tv.unit ? '<span class="calc-unit">' + tv.unit + '</span>' : ''}`;
      }
      layout();
      compute();
    }

    if (f.derivation) {
      const body = Array.isArray(f.derivation) ? '<ol class="deriv">' + f.derivation.map((s) => `<li>${s}</li>`).join('') + '</ol>' : f.derivation;
      EM.details(card, 'Show derivation', body);
    }
    if (f.example) {
      EM.details(card, 'Worked example', `<div class="ex-q">${f.example.q}</div><div class="ex-a">${f.example.a}</div>`);
    }
    return card;
  };

  function fmtInput(v) {
    if (v == null) return '';
    if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)) return v.toExponential(3).replace(/\.?0+e/, 'e');
    return String(v);
  }
  function stripTags(s) {
    const d = document.createElement('div');
    d.innerHTML = s;
    return d.textContent;
  }
  EM.stripTags = stripTags;

  /* ------------------------------------------------------------------ experiments */

  /**
   * Experiment shape:
   * { id, title, aim?, apparatus?:[string], steps:[html], result?: html, conclusion?: html, sim?(el) }
   */
  EM.experimentCard = function (x, ch) {
    const card = h('div', { class: 'exp-card', id: 'x-' + x.id, style: ch ? { '--accent': ch.color } : null });
    const head = add(card, 'div', { class: 'exp-head' });
    head.append(h('div', { class: 'exp-kicker', html: '🧪 Demo / Experiment' + (ch ? ' · ' + ch.code : '') }), h('h3', { html: x.title }));
    const key = 'exp:' + (ch ? ch.id : '') + ':' + x.id;
    const done = add(head, 'button', { type: 'button', class: 'btn btn-small exp-done' });
    const paint = () => {
      const on = EM.progress.get(key);
      done.classList.toggle('on', on);
      done.textContent = on ? '✓ Tried it' : 'Mark as tried';
    };
    done.addEventListener('click', () => {
      EM.progress.set(key, !EM.progress.get(key));
      paint();
    });
    paint();

    const body = add(card, 'div', { class: 'exp-body' + (x.sim ? '' : ' no-sim') });
    const info = add(body, 'div', { class: 'exp-info' });
    if (x.aim) info.append(h('p', { class: 'exp-aim', html: '<strong>Aim:</strong> ' + x.aim }));
    if (x.apparatus && x.apparatus.length) {
      info.append(h('h4', { text: 'Apparatus' }));
      const chips = add(info, 'div', { class: 'chips' });
      x.apparatus.forEach((a) => chips.append(h('span', { class: 'chip', html: a })));
    }
    if (x.steps && x.steps.length) {
      info.append(h('h4', { text: 'Method' }));
      EM.list(info, x.steps, { ordered: true, class: 'method' });
    }
    if (x.result) info.append(h('div', { class: 'exp-result', html: '<strong>Result:</strong> ' + x.result }));
    if (x.conclusion) info.append(h('div', { class: 'exp-conclusion', html: '<strong>Conclusion:</strong> ' + x.conclusion }));
    if (x.sim) {
      const simWrap = add(body, 'div', { class: 'exp-sim' });
      simWrap.append(h('div', { class: 'exp-sim-label', text: 'Try it yourself' }));
      const simEl = add(simWrap, 'div', { class: 'sim' });
      try {
        x.sim(simEl);
      } catch (e) {
        console.error(e);
        simEl.append(h('p', { class: 'calc-err', text: 'This simulation failed to load.' }));
      }
    }
    return card;
  };

  /* ------------------------------------------------------------------ definitions */

  EM.termBox = function (t) {
    return h('div', { class: 'def-box', id: 't-' + t.id }, h('div', { class: 'def-term', html: t.term }), h('div', { class: 'def-text', html: t.def }));
  };

  /** Free-standing sim panel (for interactives that aren't a formal experiment). Returns the inner element. */
  EM.simPanel = function (parent, title, caption) {
    const p = add(parent, 'div', { class: 'sim-panel' });
    if (title) p.append(h('div', { class: 'sim-panel-title', html: '⚡ ' + title }));
    if (caption) p.append(h('p', { class: 'sim-panel-caption', html: caption }));
    return add(p, 'div', { class: 'sim' });
  };

  /** UI object passed to topic.render(el, ui). */
  EM.makeUI = function (ch) {
    return {
      chapter: ch,
      formula(id, parent) {
        const f = EM.find(ch.id, 'formulas', id);
        if (!f) {
          console.warn('Missing formula', ch.id, id);
          return null;
        }
        const el = EM.formulaCard(f, ch);
        if (parent) parent.append(el);
        return el;
      },
      experiment(id, parent) {
        const x = EM.find(ch.id, 'experiments', id);
        if (!x) {
          console.warn('Missing experiment', ch.id, id);
          return null;
        }
        const el = EM.experimentCard(x, ch);
        if (parent) parent.append(el);
        return el;
      },
      term(id, parent) {
        const t = EM.find(ch.id, 'terms', id);
        if (!t) {
          console.warn('Missing term', ch.id, id);
          return null;
        }
        const el = EM.termBox(t);
        if (parent) parent.append(el);
        return el;
      },
    };
  };
})();
