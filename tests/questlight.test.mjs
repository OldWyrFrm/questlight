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

// Wiki importer: facts come out, wiki wording does not.
{
  const { convert, parsePages, slug, wikiUrl } = await import('../scripts/import-wiki.mjs');
  const page = (title, text) => `<page><title>${title}</title><ns>0</ns><revision><text xml:space="preserve">${text}</text></revision></page>`;
  const xml = [
    page('Fern', '{{infobox\n|type=Characters\n|collection=Sample Glade\n|universe=Sample Film\n|house=x\n|unlockquest={{quest|First Steps}}\n}}\nSome prose that must never be copied.'),
    page('First Steps', '{{infobox\n|character=Fern\n|category=Story Quest\n|prerequisites=\n|rewards=x\n}}'),
    page('Second &amp; Third?', '{{infobox\n|character=Fern\n|category=Friendship Quest\n|prerequisites={{Friendship|Fern|4}}&lt;br&gt;\nComplete quest {{quest|First Steps|realm=Story}}&lt;br&gt;\nUnlock Biomes&lt;br&gt;\n:{{name|Misty Hollow}}&lt;br&gt;\nSomething nobody expected\n|rewards=x\n}}'),
  ].join('');
  const regions = [{ id: 'sample-glade', name: 'Sample Glade', kind: 'base', color: '#b48cff' }];

  test('importer turns wiki pages into villagers and quests', () => {
    const { characters, quests, report } = convert(parsePages(`<mediawiki>${xml}</mediawiki>`), regions);
    assert.deepEqual(characters, [{ id: 'fern', name: 'Fern', region: 'sample-glade', film: 'Sample Film', wiki: 'https://dreamlightvalleywiki.com/Fern' }]);
    const [first, second] = quests.get('sample-glade');
    assert.deepEqual(first.unlocks, { characters: ['fern'] });
    assert.equal(first.verified, true);
    assert.equal(second.id, 'second-and-third');
    assert.equal(second.level, 4);
    assert.deepEqual(second.requires, { quests: ['first-steps'], characters: ['fern'] });
    assert.equal(second.notes, 'Needs Misty Hollow unlocked.');
    assert.equal(second.verified, false, 'an unreadable line leaves the quest unverified');
    assert.equal(report.length, 1);
    assert.deepEqual(validate({ regions, characters, questFiles: [{ file: 'quests/sample-glade.json', region: 'sample-glade', quests: quests.get('sample-glade') }] }), []);
  });

  test('importer builds safe ids and wiki links', () => {
    assert.equal(slug("Bon Appétit! It's Remy & Co."), 'bon-appetit-its-remy-and-co');
    assert.equal(wikiUrl('Continue?'), 'https://dreamlightvalleywiki.com/Continue%3F');
    assert.equal(wikiUrl('Forgotten Relics: The Storybook'), 'https://dreamlightvalleywiki.com/Forgotten_Relics:_The_Storybook');
  });
}

// Progress: what is done, what is available now, and reading saved files safely.
{
  const { parseSave, serialize, statuses } = await import('../src/progress.js');
  const regions = [{ id: 'home', kind: 'base' }, { id: 'isle', kind: 'expansion' }];
  const graph = makeGraph({
    characters: [{ id: 'starter', region: 'home' }, { id: 'fern', region: 'home' }],
    quests: [
      { id: 'one', region: 'home', unlocks: { characters: ['fern'] } },
      { id: 'two', region: 'home', requires: { quests: ['one'], characters: ['fern'] } },
      { id: 'far', region: 'isle', requires: { characters: ['starter'] } },
      { id: 'needs-isle', region: 'home', requires: { regions: ['isle'] } },
    ],
  });
  const at = (done, unowned = []) => Object.fromEntries(statuses(graph, new Set(done), new Set(unowned)));

  test('progress works out what is done, available and locked', () => {
    assert.deepEqual(at([]), {
      'quest:one': 'ready', 'quest:two': 'locked', 'quest:far': 'ready', 'quest:needs-isle': 'ready',
      'character:starter': 'done', 'character:fern': 'ready',
    });
    const next = at(['quest:one']);
    assert.equal(next['quest:one'], 'done');
    assert.equal(next['character:fern'], 'done');
    assert.equal(next['quest:two'], 'ready');
  });

  test('quests in or needing an unowned expansion are not available', () => {
    const s = at([], ['isle']);
    assert.equal(s['quest:far'], 'locked');
    assert.equal(s['quest:needs-isle'], 'locked');
  });

  test('a save file round-trips and ignores what it does not recognise', () => {
    const saved = JSON.stringify(serialize({ done: new Set(['quest:one']), unowned: new Set(['isle']), spoilers: true }));
    const back = parseSave(saved, graph, regions);
    assert.deepEqual([[...back.done], [...back.unowned], back.spoilers, back.skipped], [['quest:one'], ['isle'], true, 0]);
    const odd = parseSave(JSON.stringify({ app: 'questlight', version: 1, done: ['one', 'gone', 7, 'fern'], unowned: ['home', 'nowhere'], spoilers: 'yes' }), graph, regions);
    assert.deepEqual([[...odd.done], [...odd.unowned], odd.spoilers, odd.skipped], [['quest:one'], [], false, 2]);
  });

  test('files that are not Questlight saves are refused in plain language', () => {
    for (const text of ['not json', '[]', '{"app":"other"}', '{"app":"questlight","version":99}', 5]) {
      assert.throws(() => parseSave(text, graph, regions), /Questlight save|newer version/);
    }
  });
}
