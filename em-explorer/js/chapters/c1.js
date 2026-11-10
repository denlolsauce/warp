/* REFERENCE EXAMPLE — shows the chapter API. Not loaded by the site. */
(function () {
  const { h, add, draw, colors } = EM;

  EM.chapter({
    id: 'c1', // file js/chapters/c1.js registers id 'c1'
    code: 'C.1',
    title: 'Electric Charge & Electric Fields',
    color: '#f59e0b', // chapter accent colour
    blurb: 'Static electricity, charging, the electroscope, field lines and Coulomb’s law.',

    terms: [
      { id: 'electric-field', term: 'Electric field', def: 'A region where electric charges at rest experience a force.' },
    ],

    formulas: [
      {
        id: 'coulomb',
        name: "Coulomb's law",
        display: `<var>F</var> = ${EM.frac('1', '4π<var>ε</var>')} × ${EM.frac('<var>q</var><sub>1</sub><var>q</var><sub>2</sub>', '<var>d</var><sup>2</sup>')}`,
        vars: [
          { sym: 'F', label: 'F', name: 'Force between the charges', unit: 'N', value: 0.9 },
          { sym: 'q1', label: 'q<sub>1</sub>', name: 'First charge', unit: 'C', value: 1e-6 },
          { sym: 'q2', label: 'q<sub>2</sub>', name: 'Second charge', unit: 'C', value: 1e-6 },
          { sym: 'd', label: 'd', name: 'Distance between charges', unit: 'm', value: 0.1 },
          { sym: 'eps', label: 'ε', name: 'Permittivity (ε₀ in air/vacuum)', unit: 'F m<sup>−1</sup>', value: 8.854e-12, constant: true },
        ],
        solve: {
          F: (v) => (v.q1 * v.q2) / (4 * Math.PI * v.eps * v.d * v.d),
          q1: (v) => (v.F * 4 * Math.PI * v.eps * v.d * v.d) / v.q2,
          d: (v) => Math.sqrt((v.q1 * v.q2) / (4 * Math.PI * v.eps * v.F)),
        },
        notes: 'Inverse square law: double the distance → the force is ¼ as big.',
        derivation: ['Coulomb found F ∝ q₁q₂', '…and F ∝ 1/d²', 'The constant of proportionality is 1/4πε'],
        example: { q: 'Two 1 μC charges are 10 cm apart in air. Find F.', a: 'F = (1e-6 × 1e-6)/(4π × 8.854e-12 × 0.1²) = <strong>0.90 N</strong>' },
      },
    ],

    experiments: [
      {
        id: 'like-charges',
        title: 'To show forces between electric charges',
        aim: 'Show that like charges repel and unlike charges attract.',
        apparatus: ['2 polythene rods', 'Woollen cloth', 'Paper stirrup', 'Clamp'],
        steps: ['Rub two polythene rods with a wool cloth…', 'Hang one in a paper stirrup…', 'Bring the second rod near.'],
        result: 'The rods repel each other.',
        conclusion: 'Like charges repel; unlike charges attract.',
        sim(el) {
          const state = { sign: -1 };
          const sim = EM.canvas(el, {
            width: 640,
            height: 300,
            draw(ctx, s, dt) {
              draw.grid(ctx, s.W, s.H);
              draw.charge(ctx, 220, 150, -1, { r: 22, label: 'hanging rod' });
              draw.charge(ctx, 420, 150, state.sign, { r: 22, label: 'second rod' });
              const dir = state.sign < 0 ? -1 : 1; // repel → push left
              draw.arrow(ctx, 220, 110, 220 + dir * 70, 110, { color: colors.force, label: state.sign < 0 ? 'repel' : 'attract' });
            },
          });
          const c = EM.controls(el); // controls go BELOW the canvas
          EM.segmented(c, { label: 'Second rod', options: [{ value: -1, label: 'Polythene (−)' }, { value: 1, label: 'Perspex (+)' }], value: -1, onChange: (v) => (state.sign = v) });
          const st = EM.status(el, '');
          EM.every(200, () => st.set(state.sign < 0 ? 'Like charges → <strong>repel</strong>' : 'Unlike charges → <strong>attract</strong>', 'good'));
        },
      },
    ],

    topics: [
      {
        id: 'charge',
        title: 'Static electricity & charging by friction',
        summary: 'Rubbing insulators transfers electrons.',
        keywords: 'amber thales friction polythene perspex wool conservation of charge',
        render(el, ui) {
          const s1 = EM.section(el, 'Charging by friction');
          EM.p(s1, 'When two insulating materials are rubbed together…');
          ui.term('electric-field', s1);
          EM.callout(s1, 'note', 'Like charges repel and unlike charges attract.');
          const sp = EM.simPanel(s1, 'Rub the rod', 'Drag the cloth back and forth over the rod.');
          EM.canvas(sp, { width: 640, height: 260, draw(ctx, s) { draw.text(ctx, 'sim goes here', s.W / 2, s.H / 2); } });
          ui.experiment('like-charges', el);
          ui.formula('coulomb', el);
        },
      },
    ],

    quiz: [
      { q: 'A polythene rod is rubbed with wool. What charge does the rod get?', options: ['Negative', 'Positive', 'None'], answer: 0, explain: 'Electrons move from the wool to the polythene.' },
    ],
  });
})();
