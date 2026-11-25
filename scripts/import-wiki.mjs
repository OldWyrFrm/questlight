// Turns Dreamlight Valley Wiki exports (Special:Export XML) into data/ JSON.
//
//   node scripts/import-wiki.mjs <export.xml> [more.xml ...] [--out data]
//
// Only facts are taken (names, givers, prerequisites, unlocks). Wiki prose is never copied:
// every note is assembled from the fixed phrases in this file. The XML itself stays out of
// the repo. Anything the importer cannot read with confidence is left out, listed in the
// report, and the quest is marked "verified": false so a person can check it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIKI = 'https://dreamlightvalleywiki.com/';
const TYPES = { story: 'story', friendship: 'friendship', realm: 'realm', hidden: 'hidden' };
// Other names the wiki uses for a region, on top of the names in regions.json.
const REGION_ALIASES = {
  'eternity-isle': ['A Rift in Time', 'Eternity Isle', 'Version History/Expansion 1', 'EI'],
  'storybook-vale': ['Storybook Vale', 'Version History/Expansion 2'],
  'wishblossom-ranch': ['Wishblossom Ranch', 'Wishblossom Mountains', 'Version History/Expansion 3'],
  'honeyglow-woods': ['Honeyglow Woods'],
  'keepsake-sea': ['Keepsake Sea', 'Version History/Expansion 4'],
  valley: ['Dreamlight Valley'],
};

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
/** Comparable form of a page title: no invisible characters, underscores or case. */
const key = (s) => s.replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (s) => s.replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '').replace(/\s+/g, ' ').trim();
/**
 * Remove wiki comments and footnotes. Comments are removed until none are left, so taking one
 * out cannot expose another, and an unclosed comment runs to the end as it does on the wiki.
 */
const strip = (s) => {
  let text = (s ?? '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  let before;
  do {
    before = text;
    text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  } while (text !== before);
  return text;
};

export const slug = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const wikiUrl = (title) => WIKI + encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2C/g, ',');

/** Pages from one export file, as { title, ns, text, redirect }. */
export function parsePages(xml) {
  const pages = [];
  for (const [, page] of xml.matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    const title = /<title>([^<]*)<\/title>/.exec(page);
    if (!title) continue;
    const text = /<text[^>]*>([\s\S]*?)<\/text>/.exec(page);
    const redirect = /<redirect title="([^"]*)"/.exec(page);
    pages.push({
      title: clean(decode(title[1])),
      ns: Number(/<ns>(\d+)<\/ns>/.exec(page)?.[1] ?? 0),
      text: text ? decode(text[1]) : '',
      redirect: redirect ? clean(decode(redirect[1])) : null,
    });
  }
  return pages;
}

/** Fields of the page's {{infobox}}, keyed by lowercase name, or null when there is none. */
export function infobox(text) {
  const start = text.search(/\{\{\s*infobox/i);
  if (start < 0) return null;
  let depth = 0, end = start;
  for (; end < text.length; end++) {
    if (text.startsWith('{{', end)) { depth++; end++; } else if (text.startsWith('}}', end)) { depth--; end++; if (!depth) break; }
  }
  const fields = {};
  let name = null;
  for (const line of text.slice(start, end - 1).split('\n')) {
    const field = /^\s*\|\s*([a-z0-9_]+)\s*=(.*)$/i.exec(line);
    if (field) { name = field[1].toLowerCase(); fields[name] = field[2]; } else if (name) fields[name] += `\n${line}`;
  }
  return fields;
}

/** Every {{template|...}} and [[link]] in a piece of wikitext, plus the text left over. */
function refs(line) {
  const found = [];
  // {{!}} is the wiki's escaped pipe: "Page{{!}}Label". The label is the name players see.
  const rest = line.replace(/\{\{!\}\}/g, '\u00a6')
    .replace(/\{\{\s*([a-z ]+?)\s*\|([^{}]*)\}\}/gi, (_, name, args) => {
      const kind = name.toLowerCase();
      if (kind === 'price') return ' ';
      const parts = args.split('|').map(clean);
      const label = parts.find((p) => /^link\s*=.*\u00a6/.test(p))?.split('\u00a6')[1];
      found.push({ kind, target: clean(parts[0].split('\u00a6')[0]), label: clean(label ?? parts[0].split('\u00a6').at(-1)), args: parts.slice(1) });
      return ' ';
    })
    .replace(/\[\[:?([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, target) => {
      if (!/^(file|image|category):/i.test(target.trim())) found.push({ kind: 'link', target: clean(target), label: clean(target), args: [] });
      return ' ';
    });
  return { found, rest: clean(rest.replace(/'{2,}/g, '').replace(/[()]/g, ' ').replace(/^[*:#;\s]+/, '').replace(/[:.,;\s]+$/, '')) };
}

const HEADINGS = [
  [/^(un)?lock(ed|ing)?( the)? (char[a-z]*s?|villagers?)$/i, 'character'],
  [/^characters( unlocked)?$/i, 'character'],
  [/^not listed$/i, null],
  [/^progr[a-z]*( further)?( with| in)?$/i, 'progress'],
  [/^level up friendships?$/i, 'character'],
  [/^(un)?lock(ed|ing)?( the)?( biomes?| buildings?| realms?| areas?)?$/i, 'place'],
  [/^(complete|completed|finish)( the)?( quests?)?$/i, 'quest'],
  [/^(unlock quests?|hidden requirements?|additional unlock conditions)$/i, 'any'],
  [/^(started|starts?|starts? during|during( quest)?|progress in|in progress|unlocking stables during)$/i, 'started'],
  [/^((\d+|one) (days?|hours?|minutes?|mins)( passed)?( (after|since)( completing)?)?|day before)$/i, 'wait'],
  [/^(immediately |\d+ minutes )?after unlocking$/i, 'place'],
  [/^event$/i, 'any'],
  [/^(pick ?up|open|interact with|find|collect)( the| a)?$/i, 'item'],
  [/^location$/i, 'ignore'],
  [/^(expansion( pack)?|or|and|,)+$/i, null],
];

/**
 * Read a quest's "prerequisites" field into facts. `lookup` resolves a page title to
 * { quest }, { character } or { region }. Returns what was understood and what was not.
 */
export function parsePrerequisites(raw, lookup) {
  const out = { quests: [], started: [], characters: [], progress: [], regions: [], places: [], items: [], other: [], friendship: [], wait: false, unknown: [] };
  const add = (list, value) => { if (!list.includes(value)) list.push(value); };
  let mode = 'any';
  for (const line of strip(raw).split(/\n|<br\s*\/?>/i)) {
    const { found, rest } = refs(line);
    if (!found.length && !rest) continue;
    let lineMode = mode;
    if (rest) {
      const heading = HEADINGS.find(([pattern]) => pattern.test(rest));
      // A bare bullet under an "Unlock Biomes" heading is an area name the wiki has not linked.
      if (!heading && mode === 'place' && !found.length && /^\s*[*:]/.test(line)) { add(out.places, rest); continue; }
      if (!heading) { add(out.unknown, rest); lineMode = 'any'; }
      else if (heading[1]) lineMode = heading[1];
      // A heading on its own line also applies to the lines under it.
      if (!found.length) { mode = lineMode; continue; }
    }
    const regions = found.map((r) => lookup(r.target)?.region).filter(Boolean);
    for (const ref of found) {
      if (ref.kind === 'friendship') {
        const who = lookup(ref.target)?.character;
        const level = Number(ref.args[0]);
        if (who && Number.isInteger(level) && level > 0) out.friendship.push({ character: who, level });
        else add(out.unknown, `friendship ${ref.target} ${ref.args[0] ?? ''}`);
        continue;
      }
      const hit = lookup(ref.target) ?? {};
      if (ref.kind === 'quest' || (hit.quest && lineMode !== 'ignore')) {
        if (!hit.quest) add(out.unknown, `quest "${ref.target}" is not in the export`);
        else add(lineMode === 'started' ? out.started : out.quests, hit.quest);
        if (lineMode === 'wait') out.wait = true;
      } else if (lineMode === 'ignore') {
        continue;
      } else if (hit.character) {
        add(lineMode === 'progress' ? out.progress : out.characters, hit.character);
      } else if (hit.region) {
        // "Expansion A or Expansion B" cannot be stored as "you must own this expansion".
        if (new Set(regions).size === 1) add(out.regions, hit.region); else add(out.unknown, `one of several expansions (${ref.target})`);
      } else if (lineMode === 'place') {
        add(out.places, ref.label);
      } else if (lineMode === 'item') {
        add(out.items, ref.label);
      } else if ((lineMode === 'any' || lineMode === 'character') && !/^(version history|characters$)/i.test(ref.target)) {
        add(out.other, ref.label);
      } else {
        add(out.unknown, ref.target);
      }
    }
  }
  return out;
}

const list = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Convert parsed pages into { characters, quests: Map<region, quest[]>, report }.
 * `overrides` maps a quest id to hand-checked corrections; see scripts/wiki-overrides.json.
 */
export function convert(pages, regions, overrides = {}) {
  const report = [];
  const regionOf = new Map();
  for (const r of regions) for (const name of [r.name, r.id, ...(REGION_ALIASES[r.id] ?? [])]) regionOf.set(key(name), r.id);
  const region = (text) => regionOf.get(key(strip(text))) ?? regionOf.get(key(strip(text)).replace(/^the /, ''));

  const redirects = new Map(pages.filter((p) => p.redirect).map((p) => [key(p.title), key(p.redirect)]));
  const charPages = [], questPages = [];
  const seen = new Set();
  for (const page of pages) {
    if (page.ns !== 0 || page.redirect || seen.has(key(page.title))) continue;
    const box = infobox(page.text);
    if (!box) continue;
    if (/quest/i.test(strip(box.category))) questPages.push({ page, box });
    else if ('universe' in box && ('unlockquest' in box || 'house' in box)) charPages.push({ page, box });
    else continue;
    seen.add(key(page.title));
  }

  // Ids first, so prerequisites may point at any page in the export.
  const ids = { character: new Map(), quest: new Map() };
  const name = { character: new Map(), quest: new Map() };
  const claim = (kind, title, extra) => {
    let id = slug(title);
    const taken = new Set(ids[kind].values());
    if (taken.has(id) && extra) id = `${id}-${slug(extra)}`;
    for (let n = 2; taken.has(id); n++) id = `${slug(title)}-${n}`;
    ids[kind].set(key(title), id);
    name[kind].set(id, title);
    return id;
  };
  for (const { page } of charPages) claim('character', page.title);
  for (const { page, box } of questPages) claim('quest', page.title, clean(strip(box.character)));

  const lookup = (title) => {
    let k = key(title.split('#')[0]);
    k = redirects.get(k) ?? k;
    // A quest link wins over a same-named character or region.
    if (ids.quest.has(k)) return { quest: ids.quest.get(k) };
    if (ids.character.has(k)) return { character: ids.character.get(k) };
    const r = regionOf.get(k) ?? regionOf.get(k.replace(/^the /, ''));
    return r ? { region: r } : null;
  };

  const characters = charPages.map(({ page, box }) => {
    const film = clean(strip(box.universe));
    return {
      id: ids.character.get(key(page.title)),
      name: page.title,
      region: region(box.collection ?? ''),
      ...(film && !region(film) ? { film } : {}),
      wiki: wikiUrl(page.title),
    };
  });
  const charById = new Map(characters.map((c) => [c.id, c]));

  const quests = questPages.map(({ page, box }) => {
    const id = ids.quest.get(key(page.title));
    const category = key(strip(box.category)).replace(/ quests?$/, '');
    const giver = lookup(clean(strip(box.character)))?.character;
    const pre = parsePrerequisites(box.prerequisites ?? '', lookup);
    const q = { id, name: page.title, type: TYPES[category] ?? 'other' };
    const problems = pre.unknown.map((u) => `could not read "${u}"`);
    const notes = [];

    if (giver) q.giver = giver;
    else if (clean(strip(box.character))) problems.push(`giver "${clean(strip(box.character))}" is not a known villager`);

    // A friendship level with the giver means the giver has to be in the Valley already.
    const needChars = pre.friendship.some((f) => f.character === giver) ? [giver] : [];
    for (const c of pre.characters) if (!needChars.includes(c)) needChars.push(c);
    for (const c of pre.progress) if (!needChars.includes(c)) needChars.push(c);
    const levels = {};
    for (const f of pre.friendship) {
      if (f.character === giver) q.level = f.level;
      else {
        if (!needChars.includes(f.character)) needChars.push(f.character);
        levels[f.character] = Math.max(f.level, levels[f.character] ?? 0);
      }
    }
    const needQuests = [...pre.quests, ...pre.started.filter((s) => !pre.quests.includes(s))].filter((x) => x !== id);
    const requires = {};
    if (needQuests.length) requires.quests = needQuests;
    if (needChars.length) requires.characters = needChars;
    if (pre.regions.length) requires.regions = pre.regions;
    if (Object.keys(levels).length) requires.levels = levels;
    if (Object.keys(requires).length) q.requires = requires;

    if (pre.started.length) notes.push(`Opens while ${list(pre.started.map((s) => name.quest.get(s)))} is under way; that quest does not have to be finished first.`);
    if (pre.progress.length) notes.push(`Needs further quest progress with ${list(pre.progress.map((c) => name.character.get(c)))}.`);
    if (pre.places.length) notes.push(`Needs ${list(pre.places)} unlocked.`);
    if (pre.items.length) notes.push(`Starts from ${list(pre.items)}.`);
    if (pre.other.length) notes.push(`Also needs ${list(pre.other)}.`);
    if (pre.wait) notes.push('There is a waiting period after the earlier quest before this one appears.');
    if (!TYPES[category]) notes.push(`Listed on the wiki as a ${category} quest.`);

    // Region: the wiki's own label, else a single required expansion, else the giver's home.
    const labelled = region((box.expansion ?? '').replace(/^\s*none\s*/i, ''));
    q.region = labelled ?? (pre.regions.length === 1 ? pre.regions[0] : undefined) ?? charById.get(giver)?.region;

    q.wiki = wikiUrl(page.title);
    q.verified = problems.length === 0;
    if (notes.length) q.notes = notes.join(' ');
    return { q, problems };
  });
  const questById = new Map(quests.map(({ q }) => [q.id, q]));

  // Hand-checked corrections, kept in a file so a fresh import does not lose them.
  for (const [id, fix] of Object.entries(overrides)) {
    const item = quests.find(({ q }) => q.id === id);
    if (!item) { report.push(`overrides: no quest with id "${id}"`); continue; }
    const { q } = item;
    if (fix.type) q.type = fix.type;
    if (fix.region) q.region = fix.region;
    if (fix.level) {
      // A level with the giver; like the wiki's own, it means the giver has to be around.
      q.level = fix.level;
      q.requires ??= {};
      if (q.giver && !q.requires.characters?.includes(q.giver)) q.requires.characters = [q.giver, ...(q.requires.characters ?? [])];
    }
    for (const [field, extra] of Object.entries(fix.requires ?? {})) {
      q.requires ??= {};
      q.requires[field] = [...new Set([...(q.requires[field] ?? []), ...extra])];
    }
    if (fix.setNotes) q.notes = fix.setNotes;
    if (fix.notes) q.notes = [q.notes, fix.notes].filter(Boolean).join(' ');
    if (typeof fix.verified === 'boolean') {
      q.verified = fix.verified;
      if (fix.verified) item.problems.length = 0;
    }
  }

  // The quest named on a villager's page as their unlock.
  for (const { page, box } of charPages) {
    const who = ids.character.get(key(page.title));
    for (const ref of refs(strip(box.unlockquest)).found) {
      if (ref.kind !== 'quest') continue;
      const hit = lookup(ref.target);
      const quest = hit?.quest && questById.get(hit.quest);
      if (!quest) { report.push(`${page.title}: unlock quest "${ref.target}" is not in the export`); continue; }
      quest.unlocks ??= { characters: [] };
      if (!quest.unlocks.characters.includes(who)) quest.unlocks.characters.push(who);
      // A quest cannot need the villager it unlocks.
      const needs = quest.requires?.characters;
      if (needs?.includes(who)) {
        quest.requires.characters = needs.filter((c) => c !== who);
        if (!quest.requires.characters.length) delete quest.requires.characters;
        if (!Object.keys(quest.requires).length) delete quest.requires;
      }
      const c = charById.get(who);
      c.region ??= quest.region;
    }
  }

  // Quests with no region yet take it from the quests they follow, then default to the base game.
  const base = regions.find((r) => r.kind === 'base')?.id ?? regions[0].id;
  for (const c of characters) c.region ??= undefined;
  for (let changed = true; changed;) {
    changed = false;
    for (const { q } of quests) {
      if (q.region) continue;
      const from = (q.requires?.quests ?? []).map((r) => questById.get(r)?.region).filter(Boolean);
      const home = charById.get(q.giver)?.region ?? (from.length && from.every((r) => r === from[0]) ? from[0] : undefined);
      if (home) { q.region = home; changed = true; }
    }
    for (const c of characters) {
      if (c.region) continue;
      const unlock = quests.find(({ q }) => q.unlocks?.characters.includes(c.id))?.q.region;
      if (unlock) { c.region = unlock; changed = true; }
    }
  }
  for (const c of characters) if (!c.region) { c.region = base; report.push(`${c.name}: no region on the wiki; placed in ${base}`); }
  for (const item of quests) if (!item.q.region) { item.q.region = base; item.problems.push(`no region found; placed in ${base}`); item.q.verified = false; }

  // Drop any prerequisite that would close a loop, so the result always validates.
  const before = (q) => [
    ...(q.requires?.quests ?? []).map((r) => `quest:${r}`),
    ...(q.requires?.characters ?? []).map((c) => `character:${c}`),
  ];
  const unlockers = new Map();
  for (const { q } of quests) for (const c of q.unlocks?.characters ?? []) unlockers.set(c, [...(unlockers.get(c) ?? []), q.id]);
  const reaches = (from, target, visited = new Set()) => {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    const [kind, id] = [from.slice(0, from.indexOf(':')), from.slice(from.indexOf(':') + 1)];
    const next = kind === 'quest' ? before(questById.get(id) ?? {}) : (unlockers.get(id) ?? []).map((u) => `quest:${u}`);
    return next.some((n) => reaches(n, target, visited));
  };
  // A game rule the wiki does not spell out quest by quest: a villager's friendship quests come
  // in level order, so each one needs their friendship quests at the next level down. Quests
  // with no level, and quests sharing a level, are left unordered.
  const ladders = new Map();
  for (const { q } of quests) {
    if (q.type !== 'friendship' || !q.giver || !q.level) continue;
    ladders.set(q.giver, [...(ladders.get(q.giver) ?? []), q]);
  }
  for (const ladder of ladders.values()) {
    for (const q of ladder) {
      const below = Math.max(0, ...ladder.filter((o) => o.level < q.level).map((o) => o.level));
      for (const earlier of ladder.filter((o) => o.level === below)) {
        if (q.requires?.quests?.includes(earlier.id)) continue;
        if (reaches(`quest:${earlier.id}`, `quest:${q.id}`)) { report.push(`${q.name}: not placed after ${earlier.name} by level, because the wiki has them the other way round`); continue; }
        q.requires ??= {};
        q.requires.quests = [...(q.requires.quests ?? []), earlier.id];
      }
    }
  }

  for (const item of quests) {
    const { q } = item;
    for (const field of ['quests', 'characters']) {
      for (const dep of [...(q.requires?.[field] ?? [])]) {
        const node = `${field === 'quests' ? 'quest' : 'character'}:${dep}`;
        q.requires[field] = q.requires[field].filter((d) => d !== dep);
        if (reaches(node, `quest:${q.id}`)) {
          item.problems.push(`left out "${dep}" as a prerequisite because it would form a loop`);
          q.verified = false;
        } else q.requires[field].push(dep);
      }
      if (q.requires && !q.requires[field]?.length) delete q.requires[field];
    }
    if (q.requires && !Object.keys(q.requires).length) delete q.requires;
  }

  const order = ['id', 'name', 'region', 'type', 'giver', 'level', 'requires', 'unlocks', 'wiki', 'verified', 'notes'];
  const byRegion = new Map(regions.map((r) => [r.id, []]));
  for (const { q, problems } of quests) {
    byRegion.get(q.region).push(Object.fromEntries(order.filter((f) => q[f] !== undefined).map((f) => [f, q[f]])));
    for (const p of problems) report.push(`${q.name}: ${p}`);
  }
  return { characters, quests: byRegion, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const out = at >= 0 ? args.splice(at, 2)[1] : fileURLToPath(new URL('../data', import.meta.url));
  if (!args.length || !out) { console.error('Usage: node scripts/import-wiki.mjs <export.xml> [more.xml ...] [--out data]'); process.exit(1); }
  const regions = JSON.parse(readFileSync(join(out, 'regions.json'), 'utf8'));
  const overrides = JSON.parse(readFileSync(new URL('./wiki-overrides.json', import.meta.url), 'utf8'));
  delete overrides['//'];
  const { characters, quests, report } = convert(args.flatMap((file) => parsePages(readFileSync(file, 'utf8'))), regions, overrides);
  const write = (rel, value) => writeFileSync(join(out, rel), `${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(join(out, 'quests'), { recursive: true });
  write('characters.json', characters);
  for (const [id, items] of quests) write(`quests/${id}.json`, items);
  const all = [...quests.values()].flat();
  for (const line of report) console.log(`  ? ${line}`);
  console.log(`✓ Wrote ${characters.length} villagers and ${all.length} quests (${all.filter((q) => !q.verified).length} marked unverified) to ${out}`);
  for (const [id, items] of quests) console.log(`  ${id}: ${items.length} quests`);
}
