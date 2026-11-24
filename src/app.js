import { focusColumns, layout, makeGraph, questPath, reach } from './graph.js';

const data = JSON.parse(document.getElementById('data').textContent);
const graph = makeGraph(data);
const regions = new Map(data.regions.map((r) => [r.id, r]));
const TYPES = { story: 'Story', friendship: 'Friendship', realm: 'Realm', event: 'Event', hidden: 'Hidden', other: 'Other' };
const GLYPHS = { story: '✦', friendship: '♥︎', realm: '◈', event: '✺', hidden: '◐', other: '•' };
const KINDS = { base: 'Base game', expansion: 'Expansion', 'adventure-pack': 'Adventure pack' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const NEAR = 2; // steps shown each way before "show the whole chain"
const wide = window.matchMedia('(min-width: 60rem)');
const state = { focus: null, query: '', type: '', region: '', tab: null, full: false, open: new Set() };
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
const monogram = (n) => (n.kind === 'character'
  ? n.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  : GLYPHS[n.type] ?? GLYPHS.other);
const meta = (n) => (n.kind === 'character'
  ? [label(n), n.film].filter(Boolean).join(' · ')
  : [label(n), giverOf(n)?.name, n.level && `Friendship level ${n.level}`].filter(Boolean).join(' · '));

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

function item(key) {
  const n = graph.nodes.get(key);
  const button = el('button', { class: `item ${n.kind}`, type: 'button', onclick: () => select(key) },
    el('span', { class: 'badge', 'aria-hidden': 'true', text: monogram(n) }),
    el('span', { class: 'item-text' },
      el('span', { class: 'item-name', text: n.name }),
      el('span', { class: 'item-meta', text: meta(n) })));
  if (key === state.focus) button.setAttribute('aria-current', 'true');
  return tint(button, n.region);
}
const items = (tag, keys) => el(tag, { class: 'items' }, ...keys.map((k) => el('li', {}, item(k))));

function matches(n) {
  if (state.region && n.region !== state.region) return false;
  if (state.type && (state.type === 'character' ? n.kind !== 'character' : n.type !== state.type)) return false;
  if (!state.query) return true;
  return [n.name, n.film, giverOf(n)?.name].some((t) => t?.toLowerCase().includes(state.query));
}

function renderBrowse() {
  const filtering = Boolean(state.query || state.type || state.region);
  const lanes = [];
  let total = 0;
  for (const region of data.regions) {
    const keys = [...graph.nodes.values()].filter((n) => n.region === region.id && matches(n)).map((n) => n.key);
    if (filtering && !keys.length) continue;
    total += keys.length;
    const lane = tint(el('details', { class: 'lane' },
      el('summary', {},
        el('span', { class: 'lane-name', text: region.name }),
        el('span', { class: 'lane-count', text: keys.length ? plural(keys.length, 'entry', 'entries') : KINDS[region.kind] ?? '' })),
      el('div', { class: 'lane-body' },
        keys.length ? items('ul', keys) : el('p', { class: 'empty', text: 'Nothing recorded here yet.' }))), region.id);
    lane.open = filtering || state.open.has(region.id);
    lane.addEventListener('toggle', () => {
      if (!state.query && !state.type && !state.region) state.open[lane.open ? 'add' : 'delete'](region.id);
    });
    lanes.push(lane);
  }
  if (filtering && !total) lanes.push(el('p', { class: 'empty', text: 'Nothing matches. Try a shorter search or clear the filters.' }));
  $('lanes').replaceChildren(...lanes);
  $('count').textContent = filtering ? plural(total, 'match', 'matches') : '';
}

function intro() {
  const quests = data.quests.length, villagers = data.characters.length;
  if (!quests && !villagers) {
    return el('div', { class: 'card' },
      el('h2', { text: 'The map is waiting for its first quests' }),
      el('p', { class: 'lede', text: `Quest data is still being gathered and checked against the wiki. ${plural(data.regions.length, 'region')} are set up and ready to fill.` }));
  }
  return el('div', { class: 'card' },
    el('h2', { text: 'Pick a quest or villager' }),
    el('p', { class: 'lede', text: 'You will see only what leads to it and what it opens up. Everything else stays out of the way.' }),
    el('p', { class: 'lede', text: `${plural(quests, 'quest')} and ${plural(villagers, 'villager')} across ${plural(data.regions.length, 'region')}.` }));
}

function steps(n) {
  const path = questPath(graph, n.key).filter((k) => k !== n.key);
  const next = [...graph.after.get(n.key)];
  const later = reach(n.key, graph.after).size - next.length;
  const nothingFirst = n.kind === 'character' ? 'No unlock quest is recorded for this villager yet.' : 'Nothing is needed first. You can start here.';
  return el('div', { class: 'block' },
    el('h3', { text: n.kind === 'character' ? `How to unlock ${n.name}` : 'Do these first' }),
    path.length ? items('ol', path) : el('p', { class: 'empty', text: nothingFirst }),
    el('h3', { text: 'Opens up next' }),
    next.length ? items('ul', next) : el('p', { class: 'empty', text: 'Nothing is recorded after this yet.' }),
    later > 0 && el('p', { class: 'empty', text: `${later} more further along. Open the map to follow the whole chain.` }));
}

function map(n) {
  const W = 180, H = 46, GAP_X = 64, GAP_Y = 14, PAD = 16, HEAD = 30;
  const columns = focusColumns(graph, n.key, state.full ? Infinity : NEAR);
  const total = reach(n.key, graph.before).size + reach(n.key, graph.after).size + 1;
  const nearCount = state.full ? focusColumns(graph, n.key, NEAR).size : columns.size;
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
    const name = node.name.length > 23 ? `${node.name.slice(0, 22)}…` : node.name;
    const g = svg('g', {
      class: `node ${node.kind}${key === n.key ? ' focus' : ''}`,
      transform: `translate(${a.x} ${a.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${node.name}, ${label(node)}${key === n.key ? ', selected' : ''}`,
      onclick: () => select(key),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key); } },
    },
      svg('title', { text: node.name }),
      svg('rect', { width: W, height: H, rx: node.kind === 'character' ? H / 2 : 9 }),
      svg('text', { class: 'node-name', x: 14, y: 20, text: name }),
      svg('text', { class: 'node-meta', x: 14, y: 36, text: label(node) }));
    nodes.push(tint(g, node.region));
  }

  const scroller = el('div', { class: 'map-scroll', tabindex: 0, role: 'group', 'aria-label': `Map of quests around ${n.name}. Scroll sideways to see more.` },
    svg('svg', { width, height: y + PAD - 10, viewBox: `0 0 ${width} ${y + PAD - 10}` }, ...bands, ...edges, ...nodes));
  requestAnimationFrame(() => { scroller.scrollLeft = at(n.key).x + W / 2 - scroller.clientWidth / 2; });

  return el('div', { class: 'block' },
    el('p', { class: 'empty', text: 'Left is what leads here, right is what it opens. Select any box to move there, and scroll sideways for more.' }),
    scroller,
    total > nearCount && el('button', {
      class: 'more',
      type: 'button',
      text: state.full ? 'Show only nearby steps' : `Show the whole chain (${total - columns.size} more)`,
      onclick: () => { state.full = !state.full; renderFocus(); },
    }));
}

function renderFocus() {
  const n = graph.nodes.get(state.focus);
  if (!n) return $('focus').replaceChildren(intro());
  const tab = state.tab ?? (wide.matches ? 'map' : 'steps');
  const giver = n.kind === 'quest' && giverOf(n);
  const owned = (n.requires?.regions ?? []).map((id) => regions.get(id)?.name).filter(Boolean);
  const wiki = wikiLink(n.wiki);
  const tabButton = (id, text) => el('button', {
    class: 'tab', type: 'button', 'aria-pressed': String(tab === id), text,
    onclick: () => { state.tab = id; renderFocus(); },
  });
  $('focus').replaceChildren(tint(el('article', { class: 'card' },
    el('button', { class: 'back', type: 'button', text: '← All quests', onclick: () => select(null) }),
    el('div', { class: 'block' },
      el('h2', { id: 'focus-title', tabindex: -1, text: n.name }),
      el('div', { class: 'chips' },
        el('span', { class: 'chip', text: label(n) }),
        el('span', { class: 'chip region', text: regions.get(n.region)?.name ?? n.region }),
        n.film && el('span', { class: 'chip', text: n.film }),
        n.level && el('span', { class: 'chip', text: `Friendship level ${n.level}` }),
        n.verified === false && el('span', { class: 'chip warn', text: 'Not yet verified' }))),
    owned.length > 0 && el('p', { text: `Needs ${owned.join(' and ')}.` }),
    n.notes && el('p', { text: n.notes }),
    giver && el('div', { class: 'block' }, el('h3', { text: 'Given by' }), item(giver.key)),
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
for (const r of data.regions) $('region').append(el('option', { value: r.id, text: r.name }));
$('sample').hidden = !data.sample;
$('tools').addEventListener('submit', (e) => e.preventDefault());
$('search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); renderBrowse(); });
$('type').addEventListener('change', (e) => { state.type = e.target.value; renderBrowse(); });
$('region').addEventListener('change', (e) => { state.region = e.target.value; renderBrowse(); });
wide.addEventListener('change', () => { if (!state.tab) renderFocus(); });
window.addEventListener('hashchange', () => route(true));
route(false);
