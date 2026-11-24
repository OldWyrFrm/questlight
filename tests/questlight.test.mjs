import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundle, loadData, validate } from '../scripts/data.mjs';
import { focusColumns, layout, makeGraph, questPath, reach } from '../src/graph.js';

const sample = () => loadData(fileURLToPath(new URL('../fixtures/sample', import.meta.url)));
const graph = () => makeGraph(bundle(sample()));

test('sample data is valid', () => assert.deepEqual(validate(sample()), []));

const breakages = {
  'duplicate quest id': [(d) => d.questFiles[1].quests.push({ ...d.questFiles[0].quests[0], region: 'sample-harbor' }), /duplicate quest id/],
  'unknown reference': [(d) => { d.questFiles[0].quests[0].requires = { quests: ['nope'] }; }, /unknown quest "nope"/],
  'loop': [(d) => { d.questFiles[0].quests[0].requires = { quests: ['cast-off'] }; }, /prerequisite loop/],
  'wrong region': [(d) => { d.questFiles[0].quests[0].region = 'sample-harbor'; }, /does not match/],
  'lookalike wiki host': [(d) => { d.questFiles[0].quests[0].wiki = 'https://dreamlightvalleywiki.com.evil.test/'; }, /wiki must be/],
  'misspelled field': [(d) => { d.questFiles[0].quests[0].require = {}; }, /unknown field "require"/],
  'missing verified': [(d) => { delete d.questFiles[0].quests[0].verified; }, /verified must be/],
};
for (const [name, [change, expected]] of Object.entries(breakages)) {
  test(`validator catches: ${name}`, () => {
    const d = sample();
    change(d);
    assert.match(validate(d).join('\n'), expected);
  });
}

test('path lists prerequisites before the quests that need them', () => {
  const path = questPath(graph(), 'character:tide-captain');
  assert.equal(path.length, 7);
  assert.equal(path[0], 'quest:first-light');
  assert.equal(path.at(-1), 'quest:cast-off');
  assert.ok(path.indexOf('quest:the-hidden-bell') < path.indexOf('quest:map-of-the-shore'));
});

test('a character with several unlock quests takes the shorter one', () => {
  const d = bundle(sample());
  d.quests.find((q) => q.id === 'first-light').unlocks.characters.push('tide-captain');
  assert.deepEqual(questPath(makeGraph(d), 'character:tide-captain'), ['quest:first-light']);
});

test('focus map flows left to right, stays limited, and never overlaps', () => {
  const g = graph(), focus = 'quest:map-of-the-shore';
  const cols = focusColumns(g, focus, Infinity);
  for (const key of cols.keys()) for (const next of g.after.get(key)) if (cols.has(next)) assert.ok(cols.get(key) < cols.get(next), `${key} → ${next}`);
  const { position } = layout(g, cols, ['sample-glade', 'sample-harbor']);
  assert.equal(new Set([...position.values()].map((p) => `${p.col},${p.row}`)).size, cols.size);
  assert.ok([...reach(focus, g.before, 1).values()].every((d) => d === 1));
});
