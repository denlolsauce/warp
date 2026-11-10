/* App shell: navigation, routing and the cross-chapter pages (home, formula sheet, lab, quiz, glossary, search). */
(function () {
  'use strict';
  const { h, add } = EM;
  const main = document.getElementById('main');
  const nav = document.getElementById('nav');

  const topicKey = (ch, t) => 'topic:' + ch.id + ':' + t.id;
  const chapterProgress = (ch) => {
    const n = ch.topics.length;
    const d = ch.topics.filter((t) => EM.progress.get(topicKey(ch, t))).length;
    return { n, d, pct: n ? Math.round((100 * d) / n) : 0 };
  };

  /* ------------------------------------------------------------------ sidebar */

  function buildNav() {
    nav.innerHTML = '';
    const tools = add(nav, 'div', { class: 'nav-group' });
    tools.append(
      navLink('#/', '🏠', 'Home'),
      navLink('#/formulas', '∑', 'Formula sheet'),
      navLink('#/lab', '🧪', 'Experiments lab'),
      navLink('#/quiz', '❓', 'Quiz yourself'),
      navLink('#/glossary', '📖', 'Definitions & flashcards')
    );
    for (const ch of EM.chapters) {
      const g = add(nav, 'div', { class: 'nav-group nav-chapter', style: { '--accent': ch.color }, dataset: { ch: ch.id } });
      const pr = chapterProgress(ch);
      const head = add(g, 'a', { class: 'nav-ch-head', href: '#/' + ch.id });
      head.append(h('span', { class: 'nav-code', text: ch.code }), h('span', { class: 'nav-ch-title', text: ch.title }), h('span', { class: 'nav-pct', text: pr.d ? pr.pct + '%' : '' }));
      const list = add(g, 'div', { class: 'nav-topics' });
      for (const t of ch.topics) {
        const a = add(list, 'a', { class: 'nav-topic', href: `#/${ch.id}/${t.id}`, dataset: { key: topicKey(ch, t) } });
        a.append(h('span', { class: 'nav-tick', text: EM.progress.get(topicKey(ch, t)) ? '✓' : '' }), h('span', { text: t.title }));
      }
    }
    highlightNav();
  }
  function navLink(href, icon, label) {
    return h('a', { class: 'nav-link', href }, h('span', { class: 'nav-icon', text: icon }), h('span', { text: label }));
  }
  function highlightNav() {
    const hash = location.hash || '#/';
    const chId = (hash.split('/')[1] || '').split('?')[0];
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash.split('?')[0]));
    nav.querySelectorAll('.nav-chapter').forEach((g) => g.classList.toggle('open', g.dataset.ch === chId));
  }
  document.addEventListener('em-progress', () => {
    nav.querySelectorAll('.nav-topic').forEach((a) => (a.querySelector('.nav-tick').textContent = EM.progress.get(a.dataset.key) ? '✓' : ''));
    nav.querySelectorAll('.nav-chapter').forEach((g) => {
      const ch = EM.byId[g.dataset.ch];
      const pr = chapterProgress(ch);
      g.querySelector('.nav-pct').textContent = pr.d ? pr.pct + '%' : '';
    });
  });

  /* ------------------------------------------------------------------ router */

  function route() {
    EM._runCleanups();
    main.innerHTML = '';
    document.body.classList.remove('nav-open');
    const raw = (location.hash || '#/').replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(query || '');
    let title = 'E&M Explorer';
    try {
      if (!parts.length) title = pageHome();
      else if (parts[0] === 'formulas') title = pageFormulas(params);
      else if (parts[0] === 'lab') title = pageLab();
      else if (parts[0] === 'exp') title = pageExperiment(parts[1], parts[2]);
      else if (parts[0] === 'quiz') title = pageQuiz(parts[1]);
      else if (parts[0] === 'glossary') title = pageGlossary();
      else if (parts[0] === 'search') title = pageSearch(params.get('q') || '');
      else if (EM.byId[parts[0]] && !parts[1]) title = pageChapter(EM.byId[parts[0]]);
      else if (EM.byId[parts[0]]) title = pageTopic(EM.byId[parts[0]], parts[1]);
      else title = pageNotFound();
    } catch (e) {
      console.error(e);
      main.append(h('div', { class: 'page' }, h('h1', { text: 'Something went wrong' }), h('p', { text: String(e) })));
    }
    document.title = title === 'E&M Explorer' ? title : title + ' · E&M Explorer';
    highlightNav();
    const anchor = params.get('at');
    if (anchor) {
      requestAnimationFrame(() => {
        const el = document.getElementById(anchor);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          el.classList.add('flash');
        }
      });
    } else window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ pages */

  function page(cls) {
    return add(main, 'div', { class: 'page ' + (cls || '') });
  }

  function pageHome() {
    const pg = page('home');
    const hero = add(pg, 'div', { class: 'hero' });
    hero.append(
      h('div', { class: 'hero-kicker', text: 'Strand 3 · Electric + Magnetic fields and their interactions' }),
      h('h1', { html: 'Electricity &amp; Magnetism <span>Explorer</span>' }),
      h('p', {
        class: 'hero-lead',
        html: 'Every concept, demo experiment and formula from your notes, with simulations you can play with, calculators for each equation, and quizzes to check yourself.',
      })
    );
    const heroCanvas = add(hero, 'div', { class: 'hero-sim' });
    heroSim(heroCanvas);

    const totals = EM.chapters.reduce((a, c) => ({ t: a.t + c.topics.length, f: a.f + c.formulas.length, x: a.x + c.experiments.length, q: a.q + c.quiz.length, d: a.d + c.terms.length }), { t: 0, f: 0, x: 0, q: 0, d: 0 });
    const stats = add(pg, 'div', { class: 'stats' });
    [
      [totals.t, 'topics', '#/c1'],
      [totals.x, 'experiments', '#/lab'],
      [totals.f, 'formulas', '#/formulas'],
      [totals.d, 'definitions', '#/glossary'],
      [totals.q, 'quiz questions', '#/quiz'],
    ].forEach(([n, l, href]) => stats.append(h('a', { class: 'stat', href }, h('strong', { text: n }), h('span', { text: l }))));

    add(pg, 'h2', { text: 'Chapters' });
    const grid = add(pg, 'div', { class: 'chapter-grid' });
    for (const ch of EM.chapters) {
      const pr = chapterProgress(ch);
      grid.append(
        h(
          'a',
          { class: 'chapter-card', href: '#/' + ch.id, style: { '--accent': ch.color } },
          h('div', { class: 'cc-code', text: ch.code }),
          h('h3', { text: ch.title }),
          h('p', { html: ch.blurb || '' }),
          h('div', { class: 'cc-meta', text: `${ch.topics.length} topics · ${ch.experiments.length} experiments · ${ch.formulas.length} formulas` }),
          h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: pr.pct + '%' } })),
          h('div', { class: 'cc-progress', text: pr.d ? `${pr.d}/${pr.n} topics understood` : 'Not started' })
        )
      );
    }
    add(pg, 'h2', { text: 'How to use this' });
    EM.cards(pg, [
      { icon: '📚', title: 'Learn', html: 'Work through each chapter topic by topic. Each page explains the idea, shows the formula and has a simulation to play with.' },
      { icon: '🧪', title: 'Experiment', html: 'Every DEMO from the notes is in the <a href="#/lab">Experiments lab</a>, with the method, the result, the conclusion and a virtual version to try.' },
      { icon: '∑', title: 'Calculate', html: 'The <a href="#/formulas">Formula sheet</a> lists every equation. Each one has a calculator that can solve for any of its variables.' },
      { icon: '✅', title: 'Check', html: 'Tick <em>“I understand this”</em> at the end of each topic, then test yourself with the <a href="#/quiz">quiz</a> and <a href="#/glossary">flashcards</a>.' },
    ]);
    return 'E&M Explorer';
  }

  /** Small decorative-but-interactive field-line sim on the home page: drag the charges. */
  function heroSim(el) {
    const charges = [
      { x: 230, y: 150, q: 1 },
      { x: 450, y: 150, q: -1 },
    ];
    let drag = null;
    let lines = null;
    const recompute = () => (lines = EM.physics.fieldLines(charges, { perUnit: 14, bounds: { x0: -40, y0: -40, x1: 720, y1: 340 } }));
    recompute();
    EM.canvas(el, {
      width: 680,
      height: 300,
      label: 'Electric field lines between two charges. Drag the charges.',
      cursor: 'grab',
      onDown(p) {
        drag = charges.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 26) || null;
      },
      onMove(p, sim) {
        sim.canvas.style.cursor = charges.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 26) ? 'grab' : 'default';
        if (drag) {
          drag.x = EM.clamp(p.x, 20, 660);
          drag.y = EM.clamp(p.y, 20, 280);
          recompute();
        }
      },
      onUp() {
        drag = null;
      },
      draw(ctx, sim) {
        EM.draw.grid(ctx, sim.W, sim.H, 34);
        EM.draw.fieldLines(ctx, lines, { arrowEvery: 70 });
        charges.forEach((c) => EM.draw.charge(ctx, c.x, c.y, c.q, { r: 18 }));
        EM.draw.text(ctx, 'Drag the charges', sim.W - 12, sim.H - 14, { align: 'right', size: 12, color: EM.colors.muted });
      },
    });
  }

  function pageChapter(ch) {
    const pg = page('chapter');
    pg.style.setProperty('--accent', ch.color);
    add(pg, 'div', { class: 'kicker', text: ch.code });
    add(pg, 'h1', { text: ch.title });
    if (ch.blurb) add(pg, 'p', { class: 'lead', html: ch.blurb });
    const pr = chapterProgress(ch);
    add(pg, 'div', { class: 'progress big' }, h('div', { class: 'progress-bar', style: { width: pr.pct + '%' } }));
    add(pg, 'h2', { text: 'Topics' });
    const list = add(pg, 'ol', { class: 'topic-list' });
    ch.topics.forEach((t) => {
      const done = EM.progress.get(topicKey(ch, t));
      list.append(h('li', { class: done ? 'done' : '' }, h('a', { href: `#/${ch.id}/${t.id}` }, h('strong', { text: t.title }), t.summary ? h('span', { html: t.summary }) : null, done ? h('em', { text: '✓ understood' }) : null)));
    });
    if (ch.experiments.length) {
      add(pg, 'h2', { text: 'Experiments in this chapter' });
      const xl = add(pg, 'div', { class: 'link-grid' });
      ch.experiments.forEach((x) => xl.append(h('a', { href: `#/exp/${ch.id}/${x.id}`, class: 'link-chip' }, '🧪 ', h('span', { html: x.title }))));
    }
    if (ch.formulas.length) {
      add(pg, 'h2', { text: 'Formulas in this chapter' });
      const fl = add(pg, 'div', { class: 'link-grid' });
      ch.formulas.forEach((f) => fl.append(h('a', { href: `#/formulas?at=f-${f.id}`, class: 'link-chip' }, '∑ ', h('span', { html: f.name }))));
    }
    const actions = add(pg, 'div', { class: 'page-actions' });
    if (ch.topics[0]) actions.append(h('a', { class: 'btn btn-primary', href: `#/${ch.id}/${ch.topics[0].id}`, text: 'Start chapter →' }));
    if (ch.quiz.length) actions.append(h('a', { class: 'btn', href: `#/quiz/${ch.id}`, text: `Quiz: ${ch.quiz.length} questions` }));
    return ch.code + ' ' + ch.title;
  }

  function pageTopic(ch, topicId) {
    const idx = ch.topics.findIndex((t) => t.id === topicId);
    if (idx < 0) return pageNotFound();
    const t = ch.topics[idx];
    const pg = page('topic');
    pg.style.setProperty('--accent', ch.color);
    add(pg, 'div', { class: 'crumbs' }, h('a', { href: '#/' + ch.id, text: ch.code + ' ' + ch.title }), h('span', { text: ` · Topic ${idx + 1} of ${ch.topics.length}` }));
    add(pg, 'h1', { html: t.title });
    if (t.summary) add(pg, 'p', { class: 'lead', html: t.summary });
    const body = add(pg, 'div', { class: 'topic-body' });
    try {
      t.render(body, EM.makeUI(ch));
    } catch (e) {
      console.error(e);
      body.append(h('p', { class: 'calc-err', text: 'This topic failed to render: ' + e.message }));
    }
    const foot = add(pg, 'div', { class: 'topic-foot' });
    const key = topicKey(ch, t);
    const btn = add(foot, 'button', { type: 'button', class: 'btn understood' });
    const paint = () => {
      const on = EM.progress.get(key);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '✓ I understand this' : 'I understand this';
    };
    btn.addEventListener('click', () => {
      EM.progress.set(key, !EM.progress.get(key));
      paint();
    });
    paint();
    const pn = add(foot, 'div', { class: 'prev-next' });
    const prev = ch.topics[idx - 1];
    const next = ch.topics[idx + 1];
    const chIdx = EM.chapters.indexOf(ch);
    const nextCh = EM.chapters[chIdx + 1];
    if (prev) pn.append(h('a', { class: 'btn', href: `#/${ch.id}/${prev.id}`, html: '← ' + prev.title }));
    else pn.append(h('span'));
    if (next) pn.append(h('a', { class: 'btn btn-primary', href: `#/${ch.id}/${next.id}`, html: next.title + ' →' }));
    else if (ch.quiz.length) pn.append(h('a', { class: 'btn btn-primary', href: `#/quiz/${ch.id}`, text: `Quiz yourself on ${ch.code} →` }));
    else if (nextCh) pn.append(h('a', { class: 'btn btn-primary', href: `#/${nextCh.id}`, text: `Next: ${nextCh.code} →` }));
    return t.title;
  }

  function pageFormulas() {
    const pg = page('formulas');
    add(pg, 'h1', { text: 'Formula sheet' });
    add(pg, 'p', { class: 'lead', html: 'Every equation in the notes, grouped by chapter. Each calculator can solve for any variable: pick what you want to find and type in the rest. Big and small numbers can be entered as <code>1.6e-19</code> or <code>1.6x10^-19</code>.' });
    const filter = add(pg, 'input', { class: 'filter', type: 'search', placeholder: 'Filter formulas… (e.g. power, flux, transformer)' });
    const quick = add(pg, 'div', { class: 'quick-sheet' });
    const wrap = add(pg, 'div', {});
    const cards = [];
    for (const ch of EM.chapters) {
      if (!ch.formulas.length) continue;
      const qs = add(quick, 'div', { class: 'qs-group', style: { '--accent': ch.color } });
      qs.append(h('div', { class: 'qs-head', text: ch.code + ' ' + ch.title }));
      const sec = add(wrap, 'section', { class: 'formula-section', style: { '--accent': ch.color } });
      sec.append(h('h2', { text: ch.code + ' ' + ch.title }));
      const grid = add(sec, 'div', { class: 'formula-grid' });
      for (const f of ch.formulas) {
        qs.append(h('a', { class: 'qs-item', href: `#/formulas?at=f-${f.id}` }, h('span', { class: 'qs-name', html: f.name }), h('span', { class: 'qs-eq', html: f.display })));
        const c = EM.formulaCard(f, ch);
        grid.append(c);
        cards.push({ c, sec, text: (f.name + ' ' + EM.stripTags(f.display) + ' ' + (f.vars || []).map((v) => v.name).join(' ') + ' ' + (f.tags || '')).toLowerCase() });
      }
    }
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      quick.hidden = !!q;
      cards.forEach((x) => (x.c.hidden = q && !x.text.includes(q)));
      wrap.querySelectorAll('.formula-section').forEach((s) => (s.hidden = ![...s.querySelectorAll('.formula-card')].some((c) => !c.hidden)));
    });
    return 'Formula sheet';
  }

  function pageLab() {
    const pg = page('lab');
    add(pg, 'h1', { text: 'Experiments lab' });
    add(pg, 'p', { class: 'lead', text: 'Every demonstration from the notes, each with the method, what you should observe, the conclusion and a simulation you can run.' });
    for (const ch of EM.chapters) {
      if (!ch.experiments.length) continue;
      const sec = add(pg, 'section', { class: 'lab-section', style: { '--accent': ch.color } });
      sec.append(h('h2', { text: ch.code + ' ' + ch.title }));
      const grid = add(sec, 'div', { class: 'lab-grid' });
      for (const x of ch.experiments) {
        const done = EM.progress.get('exp:' + ch.id + ':' + x.id);
        grid.append(h('a', { class: 'lab-card' + (done ? ' done' : ''), href: `#/exp/${ch.id}/${x.id}` }, h('h3', { html: x.title }), x.aim ? h('p', { html: x.aim }) : null, h('span', { class: 'lab-go', text: done ? '✓ Tried · open again' : 'Open experiment →' })));
      }
    }
    return 'Experiments lab';
  }

  function pageExperiment(chId, xId) {
    const ch = EM.byId[chId];
    const x = ch && EM.find(chId, 'experiments', xId);
    if (!x) return pageNotFound();
    const pg = page('experiment');
    pg.style.setProperty('--accent', ch.color);
    add(pg, 'div', { class: 'crumbs' }, h('a', { href: '#/lab', text: 'Experiments lab' }), h('span', { text: ' · ' }), h('a', { href: '#/' + ch.id, text: ch.code + ' ' + ch.title }));
    pg.append(EM.experimentCard(x, ch));
    const i = ch.experiments.indexOf(x);
    const pn = add(pg, 'div', { class: 'prev-next' });
    const prev = ch.experiments[i - 1];
    const next = ch.experiments[i + 1];
    pn.append(prev ? h('a', { class: 'btn', href: `#/exp/${ch.id}/${prev.id}`, html: '← ' + prev.title }) : h('span'));
    if (next) pn.append(h('a', { class: 'btn btn-primary', href: `#/exp/${ch.id}/${next.id}`, html: next.title + ' →' }));
    return EM.stripTags(x.title);
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pageQuiz(chId) {
    const pg = page('quiz');
    add(pg, 'h1', { text: 'Quiz yourself' });
    const pick = add(pg, 'div', { class: 'quiz-pick' });
    pick.append(h('a', { class: 'btn' + (!chId ? ' btn-primary' : ''), href: '#/quiz', text: 'All chapters' }));
    for (const ch of EM.chapters) if (ch.quiz.length) pick.append(h('a', { class: 'btn' + (chId === ch.id ? ' btn-primary' : ''), href: '#/quiz/' + ch.id, text: ch.code }));
    let pool = [];
    for (const ch of EM.chapters) if (!chId || ch.id === chId) ch.quiz.forEach((q) => pool.push({ ...q, ch }));
    if (!pool.length) {
      add(pg, 'p', { text: 'No questions yet.' });
      return 'Quiz';
    }
    const qs = shuffle(pool).slice(0, chId ? pool.length : 20);
    const scoreEl = add(pg, 'div', { class: 'quiz-score' });
    let answered = 0,
      correct = 0;
    const paintScore = () => (scoreEl.innerHTML = `Score: <strong>${correct}</strong> / ${answered} answered · ${qs.length} questions${!chId ? ' (random 20 from all chapters)' : ''}`);
    paintScore();
    qs.forEach((q, n) => {
      const card = add(pg, 'div', { class: 'quiz-card', style: { '--accent': q.ch.color } });
      card.append(h('div', { class: 'quiz-meta', text: `Q${n + 1} · ${q.ch.code}` }), h('div', { class: 'quiz-q', html: q.q }));
      const opts = add(card, 'div', { class: 'quiz-opts' });
      const fb = add(card, 'div', { class: 'quiz-fb', hidden: true });
      const order = shuffle(q.options.map((o, i) => ({ o, i })));
      let done = false;
      order.forEach(({ o, i }) => {
        const b = add(opts, 'button', { type: 'button', class: 'quiz-opt', html: o });
        b.addEventListener('click', () => {
          if (done) return;
          done = true;
          answered++;
          const ok = i === q.answer;
          if (ok) correct++;
          b.classList.add(ok ? 'right' : 'wrong');
          [...opts.children].forEach((c, k) => {
            if (order[k].i === q.answer) c.classList.add('right');
            c.disabled = true;
          });
          fb.hidden = false;
          fb.innerHTML = (ok ? '<strong>Correct!</strong> ' : '<strong>Not quite.</strong> ') + (q.explain || '');
          paintScore();
        });
      });
    });
    add(pg, 'div', { class: 'page-actions' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'New shuffle', onclick: () => route() }));
    return 'Quiz';
  }

  function pageGlossary() {
    const pg = page('glossary');
    add(pg, 'h1', { text: 'Definitions & flashcards' });
    add(pg, 'p', { class: 'lead', text: 'Exam definitions from the notes. Browse the list, or switch to flashcards and test your recall.' });
    const all = [];
    for (const ch of EM.chapters) ch.terms.forEach((t) => all.push({ ...t, ch }));
    const bar = add(pg, 'div', { class: 'gloss-bar' });
    const filter = add(bar, 'input', { class: 'filter', type: 'search', placeholder: 'Filter definitions…' });
    let chFilter = '';
    const chSel = EM.select(bar, { options: [{ value: '', label: 'All chapters' }, ...EM.chapters.map((c) => ({ value: c.id, label: c.code + ' ' + c.title }))], onChange: (v) => ((chFilter = v), paint()) });
    chSel.el.classList.add('inline');
    const mode = EM.segmented(bar, { options: [{ value: 'list', label: 'List' }, { value: 'cards', label: 'Flashcards' }], value: 'list', onChange: () => paint() });
    const out = add(pg, 'div', {});
    filter.addEventListener('input', () => paint());
    function paint() {
      out.innerHTML = '';
      const q = filter.value.trim().toLowerCase();
      const items = all.filter((t) => (!chFilter || t.ch.id === chFilter) && (!q || (t.term + ' ' + EM.stripTags(t.def)).toLowerCase().includes(q)));
      if (mode.value === 'list') {
        const grid = add(out, 'div', { class: 'gloss-grid' });
        items.forEach((t) => {
          const b = EM.termBox(t);
          b.style.setProperty('--accent', t.ch.color);
          b.prepend(h('div', { class: 'def-ch', text: t.ch.code }));
          grid.append(b);
        });
        if (!items.length) add(out, 'p', { text: 'No matches.' });
      } else {
        flashcards(out, shuffle(items));
      }
    }
    paint();
    return 'Definitions';
  }

  function flashcards(out, items) {
    if (!items.length) return add(out, 'p', { text: 'No cards.' });
    let i = 0,
      flipped = false,
      known = 0;
    const box = add(out, 'div', { class: 'flash-wrap' });
    const card = add(box, 'button', { type: 'button', class: 'flashcard' });
    const meta = add(box, 'div', { class: 'flash-meta' });
    const nav2 = add(box, 'div', { class: 'flash-nav' });
    EM.button(nav2, '← Prev', () => go(i - 1));
    EM.button(nav2, 'Flip', () => ((flipped = !flipped), paint()));
    EM.button(nav2, 'Got it ✓', () => (known++, go(i + 1)), 'primary');
    EM.button(nav2, 'Next →', () => go(i + 1));
    card.addEventListener('click', () => ((flipped = !flipped), paint()));
    function go(n) {
      i = (n + items.length) % items.length;
      flipped = false;
      paint();
    }
    function paint() {
      const t = items[i];
      card.style.setProperty('--accent', t.ch.color);
      card.classList.toggle('flipped', flipped);
      card.innerHTML = flipped ? `<div class="fc-label">Definition</div><div class="fc-def">${t.def}</div>` : `<div class="fc-label">${t.ch.code} · What is…</div><div class="fc-term">${t.term}</div><div class="fc-hint">click to flip</div>`;
      meta.textContent = `Card ${i + 1} of ${items.length} · ${known} marked as known`;
    }
    paint();
  }

  /* ------------------------------------------------------------------ search */

  function searchIndex() {
    const idx = [];
    for (const ch of EM.chapters) {
      ch.topics.forEach((t) => idx.push({ kind: 'Topic', ch, title: t.title, href: `#/${ch.id}/${t.id}`, text: [t.title, t.summary, t.keywords].join(' ') }));
      ch.experiments.forEach((x) => idx.push({ kind: 'Experiment', ch, title: x.title, href: `#/exp/${ch.id}/${x.id}`, text: [x.title, x.aim, (x.apparatus || []).join(' ')].join(' ') }));
      ch.formulas.forEach((f) => idx.push({ kind: 'Formula', ch, title: f.name, href: `#/formulas?at=f-${f.id}`, text: [f.name, EM.stripTags(f.display), (f.vars || []).map((v) => v.name).join(' '), f.tags].join(' ') }));
      ch.terms.forEach((t) => idx.push({ kind: 'Definition', ch, title: t.term, href: `#/glossary`, text: [t.term, EM.stripTags(t.def)].join(' ') }));
    }
    idx.forEach((x) => (x.text = EM.stripTags(x.text || '').toLowerCase()));
    return idx;
  }
  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return searchIndex()
      .map((x) => {
        const t = EM.stripTags(x.title).toLowerCase();
        let score = 0;
        for (const w of words) {
          if (!x.text.includes(w)) return null;
          score += t.includes(w) ? 3 : 1;
        }
        if (t.startsWith(q)) score += 3;
        return { ...x, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }
  function pageSearch(q) {
    const pg = page('search');
    add(pg, 'h1', { text: `Search: “${q}”` });
    const res = runSearch(q);
    if (!res.length) add(pg, 'p', { text: 'No results. Try a different word, e.g. “resistance”, “Lenz”, “diode”.' });
    const list = add(pg, 'div', { class: 'search-results' });
    res.forEach((r) => list.append(h('a', { class: 'search-hit', href: r.href, style: { '--accent': r.ch.color } }, h('span', { class: 'hit-kind', text: r.kind + ' · ' + r.ch.code }), h('span', { class: 'hit-title', html: r.title }))));
    return 'Search';
  }
  function setupSearch() {
    const input = document.getElementById('search');
    const drop = document.getElementById('search-drop');
    let hits = [];
    let sel = -1;
    const paint = () => {
      drop.innerHTML = '';
      hits.slice(0, 8).forEach((r, i) => drop.append(h('a', { class: 'search-hit' + (i === sel ? ' sel' : ''), href: r.href, style: { '--accent': r.ch.color } }, h('span', { class: 'hit-kind', text: r.kind + ' · ' + r.ch.code }), h('span', { class: 'hit-title', html: r.title }))));
      if (hits.length > 8) drop.append(h('a', { class: 'search-more', href: '#/search?q=' + encodeURIComponent(input.value), text: `See all ${hits.length} results →` }));
      drop.hidden = !hits.length;
    };
    input.addEventListener('input', () => {
      hits = runSearch(input.value);
      sel = -1;
      paint();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        sel = Math.min(sel + 1, Math.min(hits.length, 8) - 1);
        paint();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        sel = Math.max(sel - 1, -1);
        paint();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        location.hash = sel >= 0 ? hits[sel].href : '#/search?q=' + encodeURIComponent(input.value);
        drop.hidden = true;
        input.blur();
      } else if (e.key === 'Escape') {
        drop.hidden = true;
      }
    });
    drop.addEventListener('click', () => {
      drop.hidden = true;
      input.value = '';
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) drop.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        input.focus();
      }
    });
  }

  function pageNotFound() {
    const pg = page();
    add(pg, 'h1', { text: 'Page not found' });
    add(pg, 'p', {}, h('a', { href: '#/', text: 'Go home' }));
    return 'Not found';
  }

  /* ------------------------------------------------------------------ boot */

  document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  buildNav();
  setupSearch();
  window.addEventListener('hashchange', route);
  route();
})();
