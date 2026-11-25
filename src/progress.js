// Pure progress logic: no DOM or storage, so it can be unit tested.
// `done` holds graph keys of finished quests ("quest:<id>"); `unowned` holds region ids;
// `levels` holds friendship levels the player entered themselves, as Map(villager id -> level).
export const SAVE_VERSION = 1;
const MAX_SAVE = 2_000_000; // characters; a real save is a few kilobytes

/** True when the player says they do not own the expansion this entry belongs to or needs. */
export const unownedBy = (node, unowned) => unowned.has(node.region) || (node.requires?.regions ?? []).some((r) => unowned.has(r));

/** Friendship levels a quest asks for, as Map(villager id -> level): the giver's and anyone else's. */
export function levelNeeds(node) {
  const needs = new Map(Object.entries(node.requires?.levels ?? {}));
  if (node.level && node.giver) needs.set(node.giver, Math.max(node.level, needs.get(node.giver) ?? 0));
  return needs;
}

/** The highest friendship level any quest asks for, which is as far as it is useful to count. */
export function topLevel(graph) {
  let top = 1;
  for (const node of graph.nodes.values()) if (node.kind === 'quest') top = Math.max(top, ...levelNeeds(node).values());
  return top;
}

/**
 * Friendship level with each villager. A finished quest proves the levels it asked for, so the
 * level is at least the highest of those; the player can say it is higher, never lower.
 * Returns { shown(id), level(id) }: what finished quests prove, and the level to go by.
 */
export function friendship(graph, done, levels = new Map()) {
  const proven = new Map();
  for (const key of done) {
    for (const [id, level] of levelNeeds(graph.nodes.get(key) ?? {})) if (level > (proven.get(id) ?? 1)) proven.set(id, level);
  }
  const shown = (id) => proven.get(id) ?? 1;
  return { shown, level: (id) => Math.max(shown(id), levels.get(id) ?? 1) };
}

/**
 * Where every quest and villager stands, as Map(key -> 'done' | 'ready' | 'locked').
 * A villager is 'done' once any quest that unlocks them is finished, or when no unlock quest
 * is recorded (the starting villagers). A quest is 'ready' when everything before it is met,
 * including any friendship level it asks for.
 */
export function statuses(graph, done, unowned = new Set(), levels = new Map()) {
  const out = new Map();
  const friends = friendship(graph, done, levels);
  const close = (node) => [...levelNeeds(node)].every(([id, level]) => friends.level(id) >= level);
  const unlocked = (key) => {
    const unlockers = [...graph.before.get(key)];
    return !unlockers.length || unlockers.some((q) => done.has(q));
  };
  const met = (key) => (graph.nodes.get(key).kind === 'character' ? unlocked(key) : done.has(key));
  for (const [key, node] of graph.nodes) {
    if (node.kind !== 'quest') continue;
    const open = !unownedBy(node, unowned) && [...graph.before.get(key)].every(met) && close(node);
    out.set(key, done.has(key) ? 'done' : open ? 'ready' : 'locked');
  }
  for (const [key, node] of graph.nodes) {
    if (node.kind !== 'character') continue;
    const near = [...graph.before.get(key)].some((q) => out.get(q) === 'ready');
    out.set(key, unlocked(key) ? 'done' : near ? 'ready' : 'locked');
  }
  return out;
}

/** The plain object written to localStorage and to an exported file. */
export function serialize({ done, unowned, spoilers, levels = new Map() }) {
  return {
    app: 'questlight',
    version: SAVE_VERSION,
    done: [...done].map((key) => key.slice('quest:'.length)).sort(),
    unowned: [...unowned].sort(),
    spoilers: Boolean(spoilers),
    levels: Object.fromEntries([...levels].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Read a saved or imported file. Anything that is not a known quest or expansion is dropped,
 * so an old or hand-edited file can never put the app in a broken state. Throws an Error with
 * a plain-language message when the text is not a Questlight save at all.
 */
export function parseSave(text, graph, regions) {
  if (typeof text !== 'string' || text.length > MAX_SAVE) throw new Error('That file is too large to be a Questlight save.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not valid JSON, so it cannot be a Questlight save.'); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.app !== 'questlight') throw new Error('That file is not a Questlight save.');
  if (!Number.isInteger(raw.version) || raw.version > SAVE_VERSION) throw new Error('That save was made by a newer version of Questlight.');
  const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  const optional = new Set(regions.filter((r) => r.kind !== 'base').map((r) => r.id));
  const top = topLevel(graph);
  const entered = raw.levels !== null && typeof raw.levels === 'object' && !Array.isArray(raw.levels) ? Object.entries(raw.levels) : [];
  const listed = strings(raw.done);
  const done = new Set(listed.map((id) => `quest:${id}`).filter((key) => graph.nodes.get(key)?.kind === 'quest'));
  return {
    done,
    unowned: new Set(strings(raw.unowned).filter((id) => optional.has(id))),
    spoilers: raw.spoilers === true,
    levels: new Map(entered.filter(([id, level]) => graph.nodes.get(`character:${id}`)?.kind === 'character' && Number.isInteger(level) && level > 1 && level <= top)),
    skipped: new Set(listed).size - done.size,
  };
}
