# Questlight plan

## Goal

A beautiful, game-themed, interactive web app that shows how every quest and character in
Disney Dreamlight Valley connects: what each quest requires, what it unlocks, and the path
to any villager. It covers the base game and all expansions, and stays easy to extend.

## Features

### Core (v1)
1. **Focus mode** (headline feature). Select a character or quest; show only its
   prerequisite chain (ancestors) and what it leads to (descendants). Everything else fades.
2. **Region lanes.** One lane/cluster per region in its accent color, collapsed by default.
3. **"How do I get…?" path.** Choose a character; get the ordered list of quests needed.
4. **Search** across quests and characters, plus filters by quest type and region.
5. **Mobile list/tree view** as the default on small screens.
6. **Character cards**: their quests, what unlocks them, what they unlock.

### Next (v1.x)
7. **Progress tracking**: check off quests; highlight what's available now. localStorage +
   export/import JSON.
8. **"Expansions I own" toggles** to hide unowned content.
9. **Spoiler mode**: blur anything not yet reached.

## Architecture

- `data/`: JSON source of truth (see docs/DATA_FORMAT.md).
- `scripts/validate.mjs`: checks required fields, unique IDs, valid references, no
  prerequisite cycles, region matches file, wiki links point to dreamlightvalleywiki.com.
- `scripts/build.mjs`: inlines data, CSS and JS into `dist/index.html` (for Pages) and
  `dist/questlight.html` (single offline file). No dependencies.
- `src/`: app source (HTML, CSS, vanilla JS modules).
- `.github/workflows/`: `validate.yml` (PRs), `deploy.yml` (main → Pages),
  `release.yml` (tag → attach questlight.html).

## Build order

1. Validator + CI workflow, so data can be added safely.
2. Seed data: base Valley story quests and character unlocks, then each expansion.
   Done by importing wiki exports (see docs/DATA_FORMAT.md). Quests the importer or the wiki
   cannot fully account for are marked `verified: false`.
3. App shell, theme and mobile list view.
4. Focus mode and graph view.
5. Path finder, search, character cards.
6. Build script, deploy workflow, first release.
7. Progress tracking, ownership toggles, spoiler mode.

## Repo settings already done

Ruleset protecting `main` (PR required, linear history, squash only, no force push/delete,
admin bypass for PRs only); Advanced Security (private vulnerability reporting, Dependabot,
CodeQL default setup, secret scanning + push protection); Pages source = GitHub Actions;
github-pages environment limited to `main`. To do after first CI run: add the validate check
and code scanning results as required checks in the ruleset.
