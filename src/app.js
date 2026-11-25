import { focusColumns, layout, makeGraph, questPath, reach } from './graph.js';
import { friendship, levelNeeds, parseSave, serialize, statuses, topLevel, unownedBy } from './progress.js';

const data = JSON.parse(document.getElementById('data').textContent);
const graph = makeGraph(data);
const regions = new Map(data.regions.map((r) => [r.id, r]));
const TYPES = { story: 'Story', friendship: 'Friendship', realm: 'Realm', event: 'Event', hidden: 'Hidden', other: 'Other' };
const GLYPHS = { story: '✦', friendship: '♥︎', realm: '◈', event: '✺', hidden: '◐', other: '•' };
const KINDS = { base: 'Base game', expansion: 'Expansion', 'adventure-pack': 'Adventure pack' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const STORE = 'questlight:progress';
const NEAR = 2; // steps shown each way before "show the whole chain"
const wide = window.matchMedia('(min-width: 60rem)');
const state = { focus: null, query: '', type: '', region: '', status: '', tab: null, full: false, open: new Set() };
// What the player has told us. `revealed` is spoilers they chose to see; it is not saved.
// `levels` is friendship levels they entered; `friends` is those combined with what finished quests prove.
const game = { done: new Set(), unowned: new Set(), spoilers: false, levels: new Map(), revealed: new Set(), status: new Map(), friends: null, stored: true };
const TOP = topLevel(graph);
const $ = (id) => document.getElementById(id);

// Everything is built with DOM calls, never innerHTML, so data can't inject markup.
function build(node, props, children) {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}
const el = (tag, props = {}, ...children) => build(document.createElement(tag), props, children);
const svg = (tag, props = {}, ...children) => build(document.createElementNS(SVG_NS, tag), props, children);

function tint(node, regionId) {
  const color = regions.get(regionId)?.color ?? '';
  if (/^#[0-9a-f]{6}$/i.test(color)) node.style.setProperty('--accent', color);
  return node;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const label = (n) => (n.kind === 'character' ? 'Villager' : `${TYPES[n.type] ?? 'Other'} quest`);
const giverOf = (n) => graph.nodes.get(`character:${n.giver}`);
const statusOf = (key) => game.status.get(key);
// Each villager's own quests, lowest friendship level first.
const givenBy = new Map();
for (const q of data.quests) if (giverOf(q)) givenBy.set(q.giver, [...(givenBy.get(q.giver) ?? []), q]);
for (const list of givenBy.values()) list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
/** A villager's quests the player can see, and how many are done. */
function questsOf(n) {
  const keys = (givenBy.get(n.id) ?? []).filter((q) => !unownedBy(q, game.unowned)).map((q) => `quest:${q.id}`);
  const done = keys.filter((k) => game.done.has(k)).length;
  return { keys, done, text: keys.length ? `${done} of ${plural(keys.length, 'quest')} done` : null };
}
// With spoiler mode on, anything the player cannot reach yet keeps its name to itself.
// A quest held back only by a friendship level is within reach, so it keeps its name.
const levelOnly = (key) => {
  const n = graph.nodes.get(key);
  return n.kind === 'quest' && !unownedBy(n, game.unowned) && levelNeeds(n).size > 0 && [...graph.before.get(key)].every((k) => statusOf(k) === 'done');
};
const masked = (key) => game.spoilers && statusOf(key) === 'locked' && !game.revealed.has(key) && !levelOnly(key);
const nameOf = (n) => (masked(n.key) ? 'Not reached yet' : n.name);
const monogram = (n) => {
  if (masked(n.key)) return '?';
  return n.kind === 'character'
    ? n.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : GLYPHS[n.type] ?? GLYPHS.other;
};
const inValley = (id) => statusOf(`character:${id}`) === 'done';
/** Friendship levels an unfinished quest asks for: who, how high, where the player is, and whether that is enough. */
function levelsFor(n) {
  if (n.kind !== 'quest' || game.done.has(n.key)) return [];
  return [...levelNeeds(n)].map(([id, need]) => ({ id, need, who: graph.nodes.get(`character:${id}`), have: game.friends.level(id) }))
    .filter((l) => l.who)
    .map((l) => ({ ...l, met: l.have >= l.need }));
}
function progressWord(n) {
  const status = statusOf(n.key);
  if (n.kind === 'quest') return { done: 'Done', ready: 'Available now' }[status];
  if (!graph.before.get(n.key).size) return null; // starting villager, or no unlock quest recorded
  return { done: 'Unlocked', ready: 'Unlock quest available' }[status];
}
const meta = (n) => {
  if (masked(n.key)) return label(n);
  if (n.kind === 'character') {
    const level = inValley(n.id) && game.friends.level(n.id);
    return [label(n), n.film, level > 1 && `Level ${level}`, questsOf(n).text, progressWord(n)].filter(Boolean).join(' · ');
  }
  // Say which friendship level is still short, so a locked quest explains itself.
  const short = levelsFor(n).filter((l) => !l.met && inValley(l.id)).map((l) => `Needs level ${l.need} with ${l.who.name}`);
  const level = n.level && !short.length && `Friendship level ${n.level}`;
  return [label(n), giverOf(n)?.name, level, ...short, progressWord(n)].filter(Boolean).join(' · ');
};

function wikiLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'dreamlightvalleywiki.com' ? url.href : null;
  } catch {
    return null;
  }
}

function select(key) {
  location.hash = key ? key.replace(':', '-') : '';
}

// --- Progress: kept only in this browser, with a file for backup or moving devices. ---

function load() {
  try {
    const text = localStorage.getItem(STORE);
    if (text) Object.assign(game, parseSave(text, graph, data.regions));
  } catch {
    // Storage is blocked or the saved text is damaged: start fresh and carry on.
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(serialize(game)));
    game.stored = true;
  } catch {
    game.stored = false;
  }
}

function recount() {
  game.friends = friendship(graph, game.done, game.levels);
  game.status = statuses(graph, game.done, game.unowned, game.levels);
}

/** Apply a change to progress, save it, redraw, and put keyboard focus back where it was. */
function update(change, refocus) {
  change();
  recount();
  save();
  renderGame();
  renderBrowse();
  renderFocus();
  if (refocus) document.querySelector(refocus)?.focus();
}
const say = (message) => { $('saved').textContent = message; };

/** Quests still to do before this entry, in order. For a villager, the shortest way to unlock them. */
const pathTo = (key) => questPath(graph, key).filter((k) => k !== key && graph.nodes.get(k).kind === 'quest');
const attr = (value) => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** Show a short message at the bottom of the screen; `undo` puts progress back as it was. */
function toast(message, undo) {
  $('toast-text').textContent = message;
  $('undo').hidden = !undo;
  $('undo').onclick = () => { update(undo); toast('Undone.'); };
  $('toast').hidden = false;
}

/**
 * Mark an entry done together with every quest that has to come first, since the game would
 * not have allowed it otherwise. For a villager this is the shortest way to unlock them.
 */
function complete(n, refocus) {
  const before = new Set(game.done);
  const earlier = pathTo(n.key).filter((k) => !game.done.has(k));
  update(() => { for (const k of [...earlier, ...(n.kind === 'quest' ? [n.key] : [])]) game.done.add(k); }, refocus);
  const name = masked(n.key) ? 'That quest' : n.name;
  const undo = () => { game.done = before; };
  if (n.kind === 'character') toast(`Marked ${plural(earlier.length, 'quest')} done to unlock ${n.name}.`, undo);
  else if (earlier.length) toast(`${name} is done, and so are the ${plural(earlier.length, 'quest')} that come before it.`, undo);
  else $('toast').hidden = true;
}

function tick(n, where) {
  const box = el('input', {
    type: 'checkbox',
    'data-tick': `${where}:${n.key}`,
    'aria-label': masked(n.key) ? 'Mark this quest as done' : `Mark ${n.name} as done`,
    onchange: (e) => {
      const refocus = `[data-tick=${attr(`${where}:${n.key}`)}]`;
      if (e.target.checked) return complete(n, refocus);
      $('toast').hidden = true;
      update(() => game.done.delete(n.key), refocus);
    },
  });
  box.checked = game.done.has(n.key);
  return el('label', { class: 'tick' }, box);
}

/** One quest or villager row: a button that opens it, and for quests a box to tick it off. */
function item(key, where) {
  const n = graph.nodes.get(key);
  const classes = ['item', n.kind, statusOf(key), masked(key) && 'spoiler'].filter(Boolean).join(' ');
  const button = el('button', { class: classes, type: 'button', onclick: () => select(key) },
    el('span', { class: 'badge', 'aria-hidden': 'true', text: monogram(n) }),
    el('span', { class: 'item-text' },
      el('span', { class: 'item-name', text: nameOf(n) }),
      el('span', { class: 'item-meta', text: meta(n) })));
  if (key === state.focus) button.setAttribute('aria-current', 'true');
  return tint(el('div', { class: 'row' }, button, n.kind === 'quest' && tick(n, where)), n.region);
}
const items = (tag, keys, where) => el(tag, { class: 'items' }, ...keys.map((k) => el('li', {}, item(k, where))));

function matches(n) {
  if (unownedBy(n, game.unowned)) return false;
  if (state.region && n.region !== state.region) return false;
  if (state.type && (state.type === 'character' ? n.kind !== 'character' : n.type !== state.type)) return false;
  const status = statusOf(n.key);
  if (state.status && (state.status === 'todo' ? status === 'done' : status !== state.status)) return false;
  if (!state.query) return true;
  // Searching must not reveal the names spoiler mode is hiding.
  if (masked(n.key)) return false;
  return [n.name, n.film, giverOf(n)?.name].some((t) => t?.toLowerCase().includes(state.query));
}

/** A lane's entries under short headings, so a region with hundreds of quests stays readable. */
function grouped(nodes) {
  const byGiver = (a, b) => (giverOf(a)?.name ?? '').localeCompare(giverOf(b)?.name ?? '') || (a.level ?? 99) - (b.level ?? 99);
  const groups = [['Villagers', nodes.filter((n) => n.kind === 'character')]];
  for (const [type, name] of Object.entries(TYPES)) {
    const quests = nodes.filter((n) => n.kind === 'quest' && (TYPES[n.type] ? n.type : 'other') === type);
    groups.push([`${name} quests`, type === 'friendship' ? quests.sort(byGiver) : quests]);
  }
  return groups.filter(([, list]) => list.length).flatMap(([title, list]) => [
    el('h3', { class: 'group-title', text: `${title} (${list.length})` }),
    items('ul', list.map((n) => n.key), 'browse'),
  ]);
}

function renderBrowse() {
  const filtering = Boolean(state.query || state.type || state.region || state.status);
  const lanes = [];
  let total = 0;
  for (const region of data.regions) {
    if (game.unowned.has(region.id)) continue;
    const nodes = [...graph.nodes.values()].filter((n) => n.region === region.id && matches(n));
    if (filtering && !nodes.length) continue;
    total += nodes.length;
    const quests = nodes.filter((n) => n.kind === 'quest');
    const finished = quests.filter((n) => statusOf(n.key) === 'done').length;
    const count = !nodes.length ? KINDS[region.kind] ?? ''
      : finished && !filtering ? `${finished} of ${plural(quests.length, 'quest')} done`
        : plural(nodes.length, 'entry', 'entries');
    const body = el('div', { class: 'lane-body' });
    const lane = tint(el('details', { class: 'lane' },
      el('summary', {},
        el('span', { class: 'lane-name', text: region.name }),
        el('span', { class: 'lane-count', text: count })),
      body), region.id);
    // Rows are only built for lanes that are open, which keeps typing in the search box quick.
    const fill = () => {
      if (!lane.open || body.childNodes.length) return;
      body.append(...(nodes.length ? grouped(nodes) : [el('p', { class: 'empty', text: 'Nothing recorded here yet.' })]));
    };
    lane.open = filtering || state.open.has(region.id);
    fill();
    lane.addEventListener('toggle', () => {
      fill();
      if (!state.query && !state.type && !state.region && !state.status) state.open[lane.open ? 'add' : 'delete'](region.id);
    });
    lanes.push(lane);
  }
  if (filtering && !total) lanes.push(el('p', { class: 'empty', text: 'Nothing matches. Try a shorter search or clear the filters.' }));
  $('lanes').replaceChildren(...lanes);
  $('count').textContent = filtering ? plural(total, 'match', 'matches') : '';
}

/** The "Your game" panel: totals, and the switches that mirror what is saved. */
function renderGame() {
  const quests = data.quests.filter((q) => !unownedBy(q, game.unowned));
  const finished = quests.filter((q) => game.done.has(`quest:${q.id}`)).length;
  const ready = quests.filter((q) => statusOf(`quest:${q.id}`) === 'ready').length;
  $('tally').textContent = quests.length ? `${finished} of ${quests.length} done` : '';
  $('summary').textContent = quests.length
    ? `${plural(finished, 'quest')} done and ${ready} available now, out of ${quests.length}.`
    : 'There are no quests to track yet.';
  $('spoilers').checked = game.spoilers;
  for (const box of $('owned').querySelectorAll('input')) box.checked = !game.unowned.has(box.value);
  if (!game.stored) say('This browser is not letting the page save, so progress will be lost when you close it. Save it to a file to keep it.');
}

function exportFile() {
  const blob = new Blob([`${JSON.stringify(serialize(game), null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'questlight-progress.json' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Progress saved to a file named questlight-progress.json.');
}

async function importFile(file) {
  if (!file) return;
  try {
    const next = parseSave(await file.text(), graph, data.regions);
    if (game.done.size && !window.confirm(`Replace your current progress (${plural(game.done.size, 'quest')} done) with the file's (${next.done.size} done)?`)) return;
    const { skipped, ...loaded } = next;
    update(() => Object.assign(game, loaded, { revealed: new Set() }));
    say(`Loaded ${plural(loaded.done.size, 'finished quest')}.${skipped ? ` ${plural(skipped, 'entry', 'entries')} in the file did not match a known quest and ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`);
  } catch (error) {
    say(error.message || 'That file could not be read.');
  }
}

/** Nothing is shown until something is picked, unless there is no data at all to pick from. */
function intro() {
  if (data.quests.length || data.characters.length) return [];
  return [el('div', { class: 'card' },
    el('h2', { text: 'The map is waiting for its first quests' }),
    el('p', { class: 'lede', text: `Quest data is still being gathered and checked against the wiki. ${plural(data.regions.length, 'region')} are set up and ready to fill.` }))];
}

function steps(n) {
  const path = questPath(graph, n.key).filter((k) => k !== n.key);
  const own = n.kind === 'character' ? questsOf(n) : { keys: [] };
  const next = [...graph.after.get(n.key)].filter((k) => !own.keys.includes(k) && !unownedBy(graph.nodes.get(k), game.unowned));
  const later = reach(n.key, graph.after).size - graph.after.get(n.key).size;
  const nothingFirst = n.kind === 'character' ? 'No unlock quest is recorded for this villager yet.' : 'Nothing is needed first. You can start here.';
  return el('div', { class: 'block' },
    el('h3', { text: n.kind === 'character' ? `How to unlock ${n.name}` : 'Do these first' }),
    path.length ? items('ol', path, 'first') : el('p', { class: 'empty', text: nothingFirst }),
    own.keys.length > 0 && el('h3', { text: `${n.name}'s quests (${own.done} of ${own.keys.length} done)` }),
    own.keys.length > 0 && items('ul', own.keys, 'own'),
    el('h3', { text: own.keys.length ? 'Also needed for' : 'Opens up next' }),
    next.length ? items('ul', next, 'next') : el('p', { class: 'empty', text: own.keys.length ? 'No other quests are recorded as needing this villager.' : 'Nothing is recorded after this yet.' }),
    later > 0 && el('p', { class: 'empty', text: `${later} more further along. Open the map to follow the whole chain.` }));
}

function map(n) {
  const W = 180, H = 46, GAP_X = 64, GAP_Y = 14, PAD = 16, HEAD = 30;
  const shown = (columns) => new Map([...columns].filter(([k]) => k === n.key || !unownedBy(graph.nodes.get(k), game.unowned)));
  const columns = shown(focusColumns(graph, n.key, state.full ? Infinity : NEAR));
  const total = shown(new Map([...reach(n.key, graph.before), ...reach(n.key, graph.after)])).size + 1;
  const { lanes, position } = layout(graph, columns, data.regions.map((r) => r.id));
  const cols = [...columns.values()];
  const first = Math.min(...cols), span = Math.max(...cols) - first;
  const width = PAD * 2 + (span + 1) * W + span * GAP_X;

  const bands = [], top = new Map();
  let y = PAD;
  for (const lane of lanes) {
    const height = HEAD + lane.rows * (H + GAP_Y);
    top.set(lane.region, y + HEAD - lane.row * (H + GAP_Y));
    bands.push(tint(svg('g', {},
      svg('rect', { class: 'band', x: 4, y, width: width - 8, height, rx: 12 }),
      svg('text', { class: 'band-label', x: 16, y: y + 19, text: regions.get(lane.region).name })), lane.region));
    y += height + 10;
  }
  const at = (key) => {
    const p = position.get(key);
    return p && { x: PAD + (p.col - first) * (W + GAP_X), y: top.get(graph.nodes.get(key).region) + p.row * (H + GAP_Y) };
  };

  const edges = [], nodes = [];
  for (const key of position.keys()) {
    const node = graph.nodes.get(key), a = at(key);
    for (const next of graph.after.get(key)) {
      const b = at(next);
      if (!b) continue;
      const x1 = a.x + W, y1 = a.y + H / 2, y2 = b.y + H / 2;
      edges.push(svg('path', {
        class: key === n.key || next === n.key ? 'edge lit' : 'edge',
        d: `M${x1} ${y1} C${x1 + GAP_X / 2} ${y1} ${b.x - GAP_X / 2} ${y2} ${b.x} ${y2}`,
      }));
    }
    const full = nameOf(node), word = progressWord(node);
    const name = full.length > 23 ? `${full.slice(0, 22)}…` : full;
    const status = masked(key) ? 'spoiler' : statusOf(key);
    const g = svg('g', {
      class: `node ${node.kind} ${status}${key === n.key ? ' focus' : ''}`,
      transform: `translate(${a.x} ${a.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': [full, label(node), !masked(key) && word, key === n.key && 'selected'].filter(Boolean).join(', '),
      onclick: () => select(key),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key); } },
    },
      svg('title', { text: full }),
      svg('rect', { width: W, height: H, rx: node.kind === 'character' ? H / 2 : 9 }),
      svg('text', { class: 'node-name', x: 14, y: 20, text: name }),
      svg('text', { class: 'node-meta', x: 14, y: 36, text: !masked(key) && word ? `${statusOf(key) === 'done' ? '✓ ' : ''}${word}` : label(node) }));
    nodes.push(tint(g, node.region));
  }

  const scroller = el('div', { class: 'map-scroll', tabindex: 0, role: 'group', 'aria-label': `Map of quests around ${nameOf(n)}. Scroll sideways to see more.` },
    svg('svg', { width, height: y + PAD - 10, viewBox: `0 0 ${width} ${y + PAD - 10}` }, ...bands, ...edges, ...nodes));
  requestAnimationFrame(() => { scroller.scrollLeft = at(n.key).x + W / 2 - scroller.clientWidth / 2; });

  return el('div', { class: 'block' },
    el('p', { class: 'empty', text: 'Left is what leads here, right is what it opens. Select any box to move there, and scroll sideways for more.' }),
    scroller,
    (state.full || total > columns.size) && el('button', {
      class: 'more',
      type: 'button',
      'data-act': 'chain',
      text: state.full ? 'Show only nearby steps' : `Show the whole chain (${total - columns.size} more)`,
      onclick: () => { state.full = !state.full; renderFocus(); document.querySelector('[data-act="chain"]')?.focus(); },
    }));
}

/** Record the player's own friendship level; one no higher than their quests already prove needs no record. */
function setLevel(id, level, refocus) {
  const who = graph.nodes.get(`character:${id}`), before = new Map(game.levels);
  update(() => { if (level > game.friends.shown(id)) game.levels.set(id, level); else game.levels.delete(id); }, refocus);
  toast(`Friendship with ${who.name} is now level ${game.friends.level(id)}.`, () => { game.levels = before; });
}

/** On a villager's card: their friendship level, and a way to raise it past what finished quests prove. */
function levelBlock(n) {
  if (!inValley(n.id)) return null;
  const shown = game.friends.shown(n.id), level = game.friends.level(n.id);
  const why = level > shown ? `You set this yourself. Your finished quests show level ${shown} or higher.`
    : shown > 1 ? 'Worked out from your finished quests, so it may really be higher.'
      : 'No finished quest shows a higher level yet.';
  const picker = el('select', { id: 'level', onchange: (e) => setLevel(n.id, Number(e.target.value), '#level') });
  for (let i = shown; i <= TOP; i++) picker.append(el('option', { value: i, text: i === shown && TOP > shown ? `${i} (from your quests)` : String(i) }));
  picker.value = String(level);
  return el('div', { class: 'block' },
    el('h3', { text: 'Friendship level' }),
    el('p', { text: `Level ${level}. ${why}` }),
    TOP > shown && el('label', { class: 'field level', for: 'level' }, el('span', { text: `My level with ${n.name}` }), picker),
    TOP > shown && el('p', { class: 'empty', text: 'Quests that need a higher level stay locked until you raise this or tick them off. It cannot go below what your finished quests show.' }));
}

/** On a quest's card: each friendship level it asks for, and a one-step way to say you are there. */
function needsBlock(n) {
  const needs = levelsFor(n);
  if (!needs.length) return null;
  return el('div', { class: 'block' },
    el('h3', { text: 'Friendship needed' }),
    el('ul', { class: 'needs' }, ...needs.map((l) => el('li', { class: l.met ? 'met' : '' },
      el('span', { text: `Level ${l.need} with ${l.who.name}. ${!inValley(l.id) ? `${l.who.name} is not in your Valley yet.` : l.met ? `✓ You are at level ${l.have}.` : `You are at level ${l.have}.`}` }),
      !l.met && inValley(l.id) && el('button', {
        class: 'link', type: 'button', 'data-act': `level-${l.id}`, text: `I have reached level ${l.need} with ${l.who.name}`,
        onclick: () => setLevel(l.id, l.need, '#focus-title'),
      })))));
}

/** Buttons for ticking off the selected quest, or everything needed for the selected villager. */
function actions(n) {
  const todo = pathTo(n.key).filter((k) => !game.done.has(k));
  if (n.kind === 'character') {
    if (statusOf(n.key) === 'done' || !todo.length) return null;
    return el('div', { class: 'actions' }, el('button', {
      class: 'link', type: 'button', text: `I already have ${n.name} (marks ${plural(todo.length, 'quest')} done)`,
      onclick: () => complete(n, '#focus-title'),
    }));
  }
  const isDone = game.done.has(n.key);
  return el('div', { class: 'actions' },
    el('button', {
      class: isDone ? 'link on' : 'link', type: 'button', 'data-act': 'done', 'aria-pressed': String(isDone),
      text: isDone ? '✓ Done (select to undo)' : todo.length ? `Mark as done, with the ${plural(todo.length, 'quest')} before it` : 'Mark as done',
      onclick: () => {
        if (!isDone) return complete(n, '[data-act="done"]');
        $('toast').hidden = true;
        update(() => game.done.delete(n.key), '[data-act="done"]');
      },
    }));
}

function renderFocus() {
  const n = graph.nodes.get(state.focus);
  if (!n) return $('focus').replaceChildren(...intro());
  const back = el('button', { class: 'back', type: 'button', text: '← All quests', onclick: () => select(null) });
  if (masked(n.key)) {
    return $('focus').replaceChildren(tint(el('article', { class: 'card' },
      back,
      el('h2', { id: 'focus-title', tabindex: -1, text: 'Not reached yet' }),
      el('p', { class: 'lede', text: `This ${n.kind === 'character' ? 'villager' : 'quest'} is further along than your progress, so it is hidden to avoid spoilers.` }),
      el('div', { class: 'actions' }, el('button', {
        class: 'link', type: 'button', text: 'Show it anyway',
        onclick: () => update(() => game.revealed.add(n.key), '#focus-title'),
      }))), n.region));
  }
  const tab = state.tab ?? (wide.matches ? 'map' : 'steps');
  const giver = n.kind === 'quest' && giverOf(n);
  const owned = (n.requires?.regions ?? []).map((id) => regions.get(id)?.name).filter(Boolean);
  const wiki = wikiLink(n.wiki);
  const word = progressWord(n);
  const tabButton = (id, text) => el('button', {
    class: 'tab', type: 'button', 'aria-pressed': String(tab === id), 'data-act': `tab-${id}`, text,
    onclick: () => { state.tab = id; renderFocus(); document.querySelector(`[data-act="tab-${id}"]`)?.focus(); },
  });
  $('focus').replaceChildren(tint(el('article', { class: 'card' },
    back,
    el('div', { class: 'block' },
      el('h2', { id: 'focus-title', tabindex: -1, text: n.name }),
      el('div', { class: 'chips' },
        el('span', { class: 'chip', text: label(n) }),
        el('span', { class: 'chip region', text: regions.get(n.region)?.name ?? n.region }),
        n.film && el('span', { class: 'chip', text: n.film }),
        n.level && el('span', { class: 'chip', text: `Friendship level ${n.level}` }),
        word && el('span', { class: `chip ${statusOf(n.key)}`, text: word }),
        n.kind === 'character' && questsOf(n).text && el('span', { class: 'chip', text: questsOf(n).text }),
        unownedBy(n, game.unowned) && el('span', { class: 'chip warn', text: 'In an expansion you do not own' }),
        n.verified === false && el('span', { class: 'chip warn', text: 'Not yet verified' }))),
    owned.length > 0 && el('p', { text: `Needs ${owned.join(' and ')}.` }),
    n.notes && el('p', { text: n.notes }),
    n.kind === 'character' ? levelBlock(n) : needsBlock(n),
    actions(n),
    giver && el('div', { class: 'block' }, el('h3', { text: 'Given by' }), item(giver.key, 'giver')),
    el('div', { class: 'tabs' }, tabButton('steps', 'Steps'), tabButton('map', 'Map')),
    tab === 'map' ? map(n) : steps(n),
    wiki && el('p', {}, el('a', { href: wiki, rel: 'noopener noreferrer', target: '_blank', text: 'Read about this on the Dreamlight Valley Wiki' }))), n.region));
}

function route(moveFocus) {
  let key = null;
  try { key = decodeURIComponent(location.hash.slice(1)).replace('-', ':'); } catch { /* malformed link: show the start view */ }
  if (!graph.nodes.has(key)) key = null;
  if (key !== state.focus) state.full = false;
  state.focus = key;
  document.body.classList.toggle('has-focus', Boolean(key));
  renderBrowse();
  renderFocus();
  if (moveFocus && key) $('focus-title').focus();
  if (moveFocus && !wide.matches) window.scrollTo(0, 0);
}

for (const [id, name] of Object.entries(TYPES)) $('type').append(el('option', { value: id, text: `${name} quests` }));
for (const r of data.regions) {
  $('region').append(el('option', { value: r.id, text: r.name }));
  if (r.kind === 'base') continue;
  $('owned').append(el('label', { class: 'check' },
    el('input', {
      type: 'checkbox', value: r.id,
      onchange: (e) => update(() => game.unowned[e.target.checked ? 'delete' : 'add'](r.id), `#owned input[value=${attr(r.id)}]`),
    }),
    el('span', { text: r.name })));
}
$('sample').hidden = !data.sample;
$('tools').addEventListener('submit', (e) => e.preventDefault());
$('search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); $('clear').hidden = !e.target.value; renderBrowse(); });
$('clear').addEventListener('click', () => {
  $('search').value = '';
  $('search').dispatchEvent(new Event('input'));
  $('search').focus();
});
$('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
$('type').addEventListener('change', (e) => { state.type = e.target.value; renderBrowse(); });
$('region').addEventListener('change', (e) => { state.region = e.target.value; renderBrowse(); });
$('status').addEventListener('change', (e) => { state.status = e.target.value; renderBrowse(); });
$('spoilers').addEventListener('change', (e) => update(() => { game.spoilers = e.target.checked; game.revealed.clear(); }, '#spoilers'));
$('export').addEventListener('click', exportFile);
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { importFile(e.target.files[0]); e.target.value = ''; });
$('reset').addEventListener('click', () => {
  if (!game.done.size && !game.levels.size) return say('There is no progress to clear.');
  if (!window.confirm(`Clear all progress (${plural(game.done.size, 'quest')} done)? This cannot be undone unless you saved it to a file.`)) return;
  update(() => { game.done.clear(); game.levels.clear(); game.revealed.clear(); }, '#reset');
  say('Progress cleared.');
});
wide.addEventListener('change', () => { if (!state.tab) renderFocus(); });
window.addEventListener('hashchange', () => route(true));
load();
recount();
renderGame();
route(false);
