# E&M Explorer

Interactive study site for the *Strand 3: Electricity + Magnetism* notes (C.1–C.6). It covers every concept,
demo experiment and formula, with simulations, solve-for-any-variable calculators, a quiz and flashcards.

Plain HTML/CSS/JS with no build step and no dependencies.

- **Open directly:** double-click `index.html` (works from `file://`).
- **Or serve it:** `python3 -m http.server 4173 --directory em-explorer`, then visit http://localhost:4173.

Layout:

- `js/core.js`: registry, DOM/controls helpers, canvas, drawing and physics helpers
- `js/components.js`: formula cards (calculators), experiment cards, definition boxes
- `js/chapters/c1.js … c6.js`: one file per chapter (topics, experiments, formulas, definitions, quiz)
- `js/app.js`: navigation, routing, formula sheet, experiments lab, quiz, glossary, search

Progress ("I understand this" / "Tried it") is stored in the browser's `localStorage`.
