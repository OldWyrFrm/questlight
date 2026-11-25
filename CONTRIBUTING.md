# Contributing to Questlight

Thank you for helping. Questlight is a fan-made, noncommercial quest and villager map for
Dreamlight Valley, and most contributions are small corrections to quest facts. You do not
need to write code to help.

Everyone taking part is asked to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Tell us something is wrong.** [Open an issue](https://github.com/OldWyrFrm/questlight/issues/new/choose)
  naming the quest or villager, what Questlight shows, and what the game actually does. A
  link to the wiki page helps.
- **Ask or suggest.** Use [Discussions](https://github.com/OldWyrFrm/questlight/discussions)
  for questions and ideas that are not yet a concrete problem.
- **Fix it yourself.** Send a pull request, following the steps below.

## Fixing quest data

The files in `data/` are generated from Dreamlight Valley Wiki exports by
`scripts/import-wiki.mjs`, so a change made only in `data/` is lost at the next import.
[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) explains the format and the import.

To correct a quest:

1. Add or edit its entry in `scripts/wiki-overrides.json`. Give a `why` that says where the
   fact comes from (a wiki page, the game itself, or a guide you can link).
2. Make the same change to the quest in `data/quests/<region>.json`, so the site is right
   straight away. If you have the wiki exports, re-run the importer instead.
3. Run `npm run validate`.

If the wiki itself is wrong or incomplete, please consider fixing it there too. Questlight
picks the change up at the next import.

### Rules for data

- **Facts only, in your own words.** Do not copy sentences from the wiki or from guides.
  Names, requirements and unlocks are facts; any `notes` must be your own wording.
- **Say where it came from.** Every quest keeps its `wiki` link, and every correction keeps
  its `why`.
- **Do not guess.** If a requirement is unknown, leave the quest `"verified": false` and say
  what is unclear in a note.
- **No game artwork.** No Disney or Gameloft images, logos, screenshots or character
  likenesses, anywhere in the project.

## Changing the app

Questlight has a few fixed rules, and pull requests that break them cannot be merged:

- It is a static site: no server code, accounts, analytics or cookies.
- It makes no third-party requests when it runs: no CDNs, web fonts or external scripts.
- It has no npm dependencies. Scripts use plain Node.js 20 or newer.
- It must work from GitHub Pages and as a single `questlight.html` opened from disk.
- All game content lives in `data/`. Adding a villager or an expansion must not need code
  changes.
- A visitor's progress stays in their own browser.
- It stays noncommercial: no ads, paid features or sponsorship links.
- It must stay usable with a keyboard, readable, and usable on a phone.

## Working on it

You need [Node.js](https://nodejs.org/) 20 or newer. There is nothing to install.

```sh
npm test           # unit tests
npm run validate   # check all quest data
npm run build      # build dist/index.html and dist/questlight.html
npm run sample     # the same, with made-up sample quests
```

Open `dist/index.html` in a browser after building.

## Pull requests

1. Branch from `main`. Name the branch `data/…` for data changes, `fix/…` for bug fixes or
   `feature/…` for new behaviour.
2. Keep the change to one thing, and say in the description what you changed and how you
   checked it.
3. Make sure `npm test` and `npm run validate` pass. They also run automatically on every
   pull request.
4. Pull requests are squash-merged, so the title becomes the commit message. Merging to
   `main` publishes the site.

## Security

Questlight handles no accounts or personal data, but if you find a way the page could be
made to run someone else's code or leak a visitor's saved progress, please report it
privately through the repository's **Security** tab ("Report a vulnerability"), not in a
public issue.

## Licences

By contributing you agree that your work is shared under the project's licences:

- code and documentation outside `data/`: [MIT](LICENSE)
- everything in `data/`: [CC BY-NC-SA 4.0](data/LICENSE.md), because it is adapted from the
  Dreamlight Valley Wiki
