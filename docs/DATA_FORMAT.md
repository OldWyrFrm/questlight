# Data format

All game data lives in `data/` as plain JSON. The app reads nothing else, so adding a
new expansion or character means adding entries here and no code changes.

```
data/
├── regions.json          # the Valley and each expansion / adventure pack
├── characters.json       # every villager
└── quests/
    ├── valley.json       # one file per region, named after the region id
    ├── keepsake-sea.json
    └── ...
```

## IDs

Every region, character and quest has an `id`: lowercase letters, numbers and hyphens
(`the-dream-castle`, `jack-sparrow`). IDs must be unique within their type and should
never change once published, because players' saved progress refers to them.

## regions.json

| Field   | Required | Description |
|---------|----------|-------------|
| `id`    | yes | e.g. `keepsake-sea` |
| `name`  | yes | Display name |
| `kind`  | yes | `base`, `expansion`, or `adventure-pack` |
| `color` | yes | Accent color for this region, as `#rrggbb` |

## characters.json

| Field    | Required | Description |
|----------|----------|-------------|
| `id`     | yes | e.g. `merlin` |
| `name`   | yes | Display name |
| `region` | yes | Region id where they are unlocked |
| `film`   | no  | Franchise or film they come from |
| `wiki`   | no  | Link to their Dreamlight Valley Wiki page |

## quests/&lt;region&gt;.json

| Field      | Required | Description |
|------------|----------|-------------|
| `id`       | yes | e.g. `the-dream-castle` |
| `name`     | yes | Quest name exactly as shown in game |
| `region`   | yes | Must match the file's region id |
| `type`     | yes | `story`, `friendship`, `realm`, `event`, `hidden`, or `other` |
| `giver`    | no  | Character id who gives the quest |
| `requires` | no  | What must be done first (see below) |
| `unlocks`  | no  | What finishing it unlocks (see below) |
| `level`    | no  | Friendship level needed, for friendship quests |
| `wiki`     | yes | Link to the quest's wiki page (used for attribution) |
| `verified` | yes | `true` once someone has checked it against the game or wiki |
| `notes`    | no  | Short tip in your **own words** (do not copy wiki text) |

`requires` and `unlocks` are objects with optional lists:

```json
"requires": {
  "quests": ["the-dream-castle"],
  "characters": ["ursula"],
  "regions": ["keepsake-sea"]
},
"unlocks": {
  "characters": ["jack-sparrow"],
  "quests": ["some-next-quest"]
}
```

`requires.regions` means "you must own this expansion". Use `unlocks.quests` only when
a quest unlocks another without the second one listing it in `requires`; the app combines
both directions.

## Example

```json
{
  "id": "example-quest",
  "name": "Example Quest",
  "region": "valley",
  "type": "friendship",
  "giver": "merlin",
  "level": 2,
  "requires": { "quests": ["another-quest"] },
  "unlocks": { "characters": ["someone"] },
  "wiki": "https://dreamlightvalleywiki.com/Example_Quest",
  "verified": false,
  "notes": "Bring a pickaxe."
}
```

Run `npm run validate` after editing. It checks required fields, unique IDs, that every
reference points to something that exists, and that no quests require each other in a loop.

## Refreshing from the wiki

The quest and villager files are generated from Dreamlight Valley Wiki exports, so they can
be refreshed after a game update without retyping anything:

1. Open `https://dreamlightvalleywiki.com/Special:Export`.
2. In **Add pages from category**, add `Characters`, export, and save the file.
3. Do the same for the quest categories (`Story Quests`, `Friendship Quests`, `Realm Quests`,
   `Hidden Quests`, `Character Quests`, `Dream Bundle Quests`, `Repeatable Quests`,
   `Time-Restricted Quests`) and save that file too.
4. Run `node scripts/import-wiki.mjs <characters.xml> <quests.xml>`, then `npm run validate`.

Keep the export files outside the repo: they contain wiki prose, and only facts belong in
`data/`. The importer rewrites `characters.json` and every `quests/*.json`, so hand edits to
those files are lost on the next import. It lists every prerequisite line it could not read
and marks those quests `"verified": false`; `regions.json` is never touched.
