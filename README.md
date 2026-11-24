# ✨ Questlight

An unofficial, interactive quest and villager map for **Disney Dreamlight Valley**.
Trace quest chains, see what unlocks each character, and track your progress across
the Valley and every expansion.

> **Fan-made project.** Questlight is not affiliated with, endorsed by, or sponsored by
> Disney or Gameloft. Disney Dreamlight Valley and all related names are trademarks of
> their respective owners. No official artwork or game assets are used.

## Status

The app is live with quest and villager data for the base game and every expansion,
imported from the Dreamlight Valley Wiki. A handful of quests are still marked "not yet
verified" where the wiki itself does not know a requirement.

## Features

- **Focus mode** — pick a character or quest and see only what leads to it and what it unlocks
- **"How do I get…?"** — the shortest ordered quest path to unlock any villager
- **Progress tracking** — check off quests and see what's available now (saved only in your browser)
- **Expansion toggles** — hide content from expansions you don't own
- **Spoiler mode** — hide the names of quests and characters you can't reach yet
- **Backup** — save your progress to a file and load it on another device
- **Mobile-first** — list/tree view on phones, full map on larger screens

## Running it

Questlight is a static site with no server, accounts, analytics, or third-party requests.

- **Online:** <https://oldwyrfrm.github.io/questlight/>
- **Offline:** open <https://oldwyrfrm.github.io/questlight/questlight.html> and save the page; that one file
  works from disk in any browser. It will also be attached to each [Release](../../releases).
- **Self-host:** serve the built `dist/` folder from any static web server.

## Development

Requires [Node.js](https://nodejs.org/) 20 or newer. There are no npm dependencies.

```sh
npm run validate   # check all quest data for errors
npm test           # run the unit tests
npm run build      # build dist/index.html and dist/questlight.html
npm run sample     # same, but with made-up sample quests for trying the app
```

Open `dist/index.html` in a browser after building. No server is needed.

## Contributing

Quest data is the heart of this project, and corrections or new quests are very welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) and the [data format guide](docs/DATA_FORMAT.md).

## Licenses

- **Code** (everything outside `data/`): [MIT](LICENSE)
- **Quest data** (`data/`): [CC BY-NC-SA 4.0](data/LICENSE.md), because it is adapted from the
  [Dreamlight Valley Wiki](https://dreamlightvalleywiki.com), whose text uses that license.
  This means the data may not be used commercially.

## Credits

Quest information is adapted from the community-maintained
[Dreamlight Valley Wiki](https://dreamlightvalleywiki.com). Thank you to its volunteer editors.
