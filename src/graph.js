// Pure dependency logic: no DOM, so it can be unit tested.
export function makeGraph(data) {
  const nodes = new Map(), before = new Map(), after = new Map();
  const add = (kind, item) => {
    const key = `${kind}:${item.id}`;
    nodes.set(key, { key, kind, ...item });
    before.set(key, new Set());
    after.set(key, new Set());
  };
  data.characters.forEach((c) => add('character', c));
  data.quests.forEach((q) => add('quest', q));
  const link = (from, to) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    before.get(to).add(from);
    after.get(from).add(to);
  };
  for (const q of data.quests) {
    const me = `quest:${q.id}`;
    for (const id of q.requires?.quests ?? []) link(`quest:${id}`, me);
    for (const id of q.requires?.characters ?? []) link(`character:${id}`, me);
    for (const id of q.unlocks?.quests ?? []) link(me, `quest:${id}`);
    for (const id of q.unlocks?.characters ?? []) link(me, `character:${id}`);
  }
  return { nodes, before, after };
}

/** Nodes reachable in one direction, as Map(key -> fewest steps). */
export function reach(start, edges, limit = Infinity) {
  const found = new Map();
  let edge = [start];
  for (let depth = 1; edge.length && depth <= limit; depth++) {
    const next = [];
    for (const key of edge) for (const n of edges.get(key)) {
      if (n === start || found.has(n)) continue;
      found.set(n, depth);
      next.push(n);
    }
    edge = next;
  }
  return found;
}

/**
 * Ordered quests needed for a target. Everything a quest requires is needed, but a
 * character unlocked by several quests only needs one, so the shortest is chosen.
 */
export function questPath(graph, target) {
  const memo = new Map();
  const solve = (key, open) => {
    if (memo.has(key)) return memo.get(key);
    if (open.has(key)) return null;
    const inner = new Set(open).add(key);
    const parts = [...graph.before.get(key)].map((k) => solve(k, inner));
    let result;
    if (graph.nodes.get(key).kind === 'character') {
      const options = parts.filter(Boolean).sort((a, b) => a.length - b.length);
      result = parts.length ? options[0] ?? null : [];
    } else {
      result = parts.includes(null) ? null : [...new Set([...parts.flat(), key])];
    }
    if (result) memo.set(key, result);
    return result;
  };
  return solve(target, new Set()) ?? [];
}

/** Columns for the focus map: negative leads here, 0 is the focus, positive comes after. */
export function focusColumns(graph, focus, limit) {
  const columns = new Map([[focus, 0]]);
  for (const [edges, back, sign] of [[graph.before, graph.after, -1], [graph.after, graph.before, 1]]) {
    const included = reach(focus, edges, limit);
    const memo = new Map([[focus, 0]]);
    // Longest route to the focus, so every line runs left to right.
    const depth = (key) => {
      if (memo.has(key)) return memo.get(key);
      memo.set(key, included.get(key));
      const steps = [...back.get(key)].filter((k) => k === focus || included.has(k)).map((k) => depth(k) + 1);
      memo.set(key, Math.max(...steps));
      return memo.get(key);
    };
    for (const key of included.keys()) columns.set(key, sign * depth(key));
  }
  return columns;
}

/** Rows grouped into one lane per region. */
export function layout(graph, columns, regionIds) {
  const lanes = [], position = new Map();
  let row = 0;
  for (const region of regionIds) {
    const keys = [...columns.keys()].filter((k) => graph.nodes.get(k).region === region);
    if (!keys.length) continue;
    const used = new Map();
    for (const key of keys) {
      const col = columns.get(key), n = used.get(col) ?? 0;
      position.set(key, { col, row: row + n });
      used.set(col, n + 1);
    }
    const rows = Math.max(...used.values());
    lanes.push({ region, row, rows });
    row += rows;
  }
  return { lanes, position, rows: row };
}
