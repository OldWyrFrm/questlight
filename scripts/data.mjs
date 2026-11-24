import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const QUEST_TYPES = ['story', 'friendship', 'realm', 'event', 'hidden', 'other'];
const KINDS = ['base', 'expansion', 'adventure-pack'];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FIELDS = {
  region: ['id', 'name', 'kind', 'color'],
  character: ['id', 'name', 'region', 'film', 'wiki'],
  quest: ['id', 'name', 'region', 'type', 'giver', 'requires', 'unlocks', 'level', 'wiki', 'verified', 'notes'],
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Read a data folder. Unreadable files are collected as errors instead of throwing. */
export function loadData(dir) {
  const errors = [];
  const read = (rel) => {
    try {
      const value = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
      if (Array.isArray(value)) return value;
      errors.push(`${rel}: must contain a JSON list`);
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
    return [];
  };
  let files = [];
  try {
    files = readdirSync(join(dir, 'quests')).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    errors.push(`quests/: ${e.message}`);
  }
  const questFiles = files.map((f) => ({ file: `quests/${f}`, region: basename(f, '.json'), quests: read(`quests/${f}`) }));
  return { regions: read('regions.json'), characters: read('characters.json'), questFiles, errors };
}

/** Return a list of plain-language problems; an empty list means the data is valid. */
export function validate({ regions, characters, questFiles, errors: loadErrors = [] }) {
  const errors = [...loadErrors];
  const ids = { region: new Set(), character: new Set(), quest: new Set() };

  const base = (kind, item, where) => {
    if (!isObject(item)) { errors.push(`${where}: every entry must be an object`); return false; }
    const at = `${where} "${item.id ?? '(no id)'}"`;
    if (typeof item.id !== 'string' || !ID.test(item.id)) errors.push(`${at}: id must use lowercase letters, numbers and hyphens`);
    else if (ids[kind].has(item.id)) errors.push(`${at}: duplicate ${kind} id`);
    else ids[kind].add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`${at}: name is required`);
    for (const key of Object.keys(item)) if (!FIELDS[kind].includes(key)) errors.push(`${at}: unknown field "${key}"`);
    return at;
  };
  const wiki = (value, at) => {
    let url;
    try { url = new URL(value); } catch { /* reported below */ }
    if (url?.protocol !== 'https:' || url.hostname !== 'dreamlightvalleywiki.com') errors.push(`${at}: wiki must be an https://dreamlightvalleywiki.com/ link`);
  };
  const text = (value, field, at) => {
    if (value !== undefined && typeof value !== 'string') errors.push(`${at}: ${field} must be text`);
  };

  // Collect every id first, so references may point forward or to another file.
  for (const r of regions) {
    const at = base('region', r, 'regions.json');
    if (!at) continue;
    if (!KINDS.includes(r.kind)) errors.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (!/^#[0-9a-f]{6}$/i.test(r.color ?? '')) errors.push(`${at}: color must look like #rrggbb`);
  }
  const checked = [];
  for (const c of characters) {
    const at = base('character', c, 'characters.json');
    if (!at) continue;
    if (!ids.region.has(c.region)) errors.push(`${at}: unknown region "${c.region}"`);
    text(c.film, 'film', at);
    if (c.wiki !== undefined) wiki(c.wiki, at);
  }
  for (const { file, region, quests } of questFiles) {
    if (!ids.region.has(region)) errors.push(`${file}: file name is not a known region id`);
    for (const q of quests) {
      const at = base('quest', q, file);
      if (!at) continue;
      checked.push({ q, at });
      if (q.region !== region) errors.push(`${at}: region "${q.region}" does not match the file name`);
      if (!QUEST_TYPES.includes(q.type)) errors.push(`${at}: type must be one of ${QUEST_TYPES.join(', ')}`);
      if (typeof q.verified !== 'boolean') errors.push(`${at}: verified must be true or false`);
      if (q.level !== undefined && (!Number.isInteger(q.level) || q.level < 1)) errors.push(`${at}: level must be a whole number of 1 or more`);
      text(q.notes, 'notes', at);
      wiki(q.wiki, at);
    }
  }

  const edges = new Map();
  const link = (from, to) => { if (!edges.has(from)) edges.set(from, new Set()); edges.get(from).add(to); };
  for (const { q, at } of checked) {
    if (q.giver !== undefined && !ids.character.has(q.giver)) errors.push(`${at}: unknown giver "${q.giver}"`);
    for (const [field, lists] of [['requires', ['quests', 'characters', 'regions']], ['unlocks', ['quests', 'characters']]]) {
      if (q[field] === undefined) continue;
      if (!isObject(q[field])) { errors.push(`${at}: ${field} must be an object`); continue; }
      for (const [key, list] of Object.entries(q[field])) {
        if (!lists.includes(key)) { errors.push(`${at}: unknown field "${field}.${key}"`); continue; }
        if (!Array.isArray(list)) { errors.push(`${at}: ${field}.${key} must be a list`); continue; }
        const kind = key.slice(0, -1);
        for (const id of list) {
          if (!ids[kind].has(id)) { errors.push(`${at}: ${field}.${key} refers to unknown ${kind} "${id}"`); continue; }
          if (kind === 'region') continue;
          const me = `quest:${q.id}`, other = `${kind}:${id}`;
          if (field === 'requires') link(other, me); else link(me, other);
        }
      }
    }
  }

  const state = new Map();
  for (const start of edges.keys()) {
    if (state.has(start)) continue;
    const stack = [[start, [...(edges.get(start) ?? [])]]];
    state.set(start, 'open');
    while (stack.length) {
      const [node, todo] = stack.at(-1);
      const next = todo.pop();
      if (next === undefined) { state.set(node, 'done'); stack.pop(); continue; }
      if (state.get(next) === 'open') {
        const path = stack.map(([n]) => n);
        errors.push(`prerequisite loop: ${[...path.slice(path.indexOf(next)), next].join(' → ')}`);
      } else if (!state.has(next)) {
        state.set(next, 'open');
        stack.push([next, [...(edges.get(next) ?? [])]]);
      }
    }
  }
  return errors;
}

export const bundle = (d, sample = false) => ({ sample, regions: d.regions, characters: d.characters, quests: d.questFiles.flatMap((f) => f.quests) });
