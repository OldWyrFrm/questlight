# Questlight — project guide for Claude

Questlight is an unofficial, open-source, interactive quest and villager dependency map
for Disney Dreamlight Valley, covering the base game and every expansion
(A Rift in Time / Eternity Isle, The Storybook Vale, Wishblossom Ranch,
Honeyglow Woods adventure pack, The Keepsake Sea). Repo: OldWyrFrm/questlight.

Data format and the wiki import are in docs/DATA_FORMAT.md. Contributor rules are in CONTRIBUTING.md.

## Hard rules

- **Static site only.** No backend, accounts, analytics, cookies, or server code.
- **No third-party requests at runtime.** No CDNs, web fonts, or external scripts. Everything
  is bundled so the site works offline and never contacts anyone.
- **Must work two ways:** hosted on GitHub Pages at `oldwyrfrm.github.io/questlight/` (a
  subfolder, so always use relative paths like `./`), and as a single downloadable
  `questlight.html` that works when opened from disk (`file://`, so no `fetch()` of data files
  in the built output; data is inlined at build time).
- **Data-driven.** All game content lives in `data/` JSON. Adding an expansion or character
  must never require code changes.
- **No npm runtime dependencies.** Prefer zero dependencies overall; build and validation
  scripts use plain Node.js (20+).
- **No secrets, PII, or payment anything.** Nothing in this project needs credentials.
- **Progress is stored only in the visitor's browser** (localStorage, wrapped in try/catch),
  with export/import to a JSON file.

## Legal and content rules

- Code is MIT (`LICENSE`). Everything in `data/` is CC BY-NC-SA 4.0 (`data/LICENSE.md`)
  because it is adapted from the Dreamlight Valley Wiki (dreamlightvalleywiki.com).
- Never copy wiki prose. Store facts (names, prerequisites, unlocks) and write any `notes`
  in original wording. Every quest links to its wiki page via `wiki`.
- No Disney/Gameloft artwork, logos, screenshots, or character likenesses. Use original
  icons, monograms, and shapes. Do not put "Disney" in the app name.
- Always show the disclaimer: fan-made, not affiliated with Disney or Gameloft.
- Must stay noncommercial: no ads, paid features, or sponsorship links.

## Design direction

- Themed to feel like the game, not a generic web app: Dreamlight night sky, drifting stars,
  purple and gold, soft glowing connection lines, storybook-style cards.
- Each region has its own accent color (from `data/regions.json`).
- Mobile-first and responsive. On phones, default to a list/tree view; the graph is a tap away.
- Must not become a "spaghetti chart": never render the whole graph at once by default.
- Accessible: keyboard navigable, readable contrast, respects `prefers-reduced-motion`.

## Workflow

- GitHub flow: branch off `main` with `feature/`, `fix/`, or `data/` prefixes, open a PR,
  squash-merge into `main`. `main` is protected; never push to it directly.
- `npm run validate` must pass before any PR. CI runs it on every PR.
- Merges to `main` deploy to GitHub Pages via a custom Actions workflow (not the Jekyll or
  Static HTML templates). Pushing a `v*` tag runs the release workflow, which attaches the
  single-file `questlight.html` to a GitHub release.
- Keep the owner informed in plain language; they are comfortable with Git and PRs.
