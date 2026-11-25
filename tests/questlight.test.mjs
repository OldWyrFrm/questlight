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
    page('Moss', '{{infobox\n|type=Characters\n|collection=Sample Glade\n|universe=Sample Film\n|house=x\n}}'),
    page('Old Friends', '{{infobox\n|character=Fern\n|category=Friendship Quest\n|prerequisites={{Friendship|Fern|7}}&lt;br&gt;{{Friendship|Moss|10}}\n}}'),
    page('Welcome to Dreamlight Valley', '{{infobox\n|category=Story Quest\n|prerequisites=\n}}'),
    page('Loose End', '{{infobox\n|category=Story Quest\n|prerequisites=\n}}'),
    page('The Dream Castle', '{{infobox\n|character=Moss\n|category=Story Quest\n|prerequisites=\n}}'),
    page('Through the Door', '{{infobox\n|character=Fern\n|category=Realm Quest\n|prerequisites=\n}}'),
    page('Second &amp; Third?', '{{infobox\n|character=Fern\n|category=Friendship Quest\n|prerequisites={{Friendship|Fern|4}}&lt;br&gt;\nComplete quest {{quest|First Steps|realm=Story}}&lt;br&gt;\nUnlock Biomes&lt;br&gt;\n:{{name|Misty Hollow}}&lt;br&gt;\nSomething nobody expected\n|rewards=x\n}}'),
  ].join('');
  const regions = [{ id: 'sample-glade', name: 'Sample Glade', kind: 'base', color: '#b48cff' }];

  test('importer turns wiki pages into villagers and quests', () => {
    const { characters, quests, report } = convert(parsePages(`<mediawiki>${xml}</mediawiki>`), regions, { 'first-steps': { level: 2 } });
    assert.deepEqual(characters.filter((c) => c.id === 'fern'), [{ id: 'fern', name: 'Fern', region: 'sample-glade', film: 'Sample Film', wiki: 'https://dreamlightvalleywiki.com/Fern' }]);
    const [first, old, second] = ['first-steps', 'old-friends', 'second-and-third'].map((id) => quests.get('sample-glade').find((q) => q.id === id));
    assert.deepEqual(first.unlocks, { characters: ['fern'] });
    assert.equal(first.level, 2, 'a level from the corrections file');
    assert.deepEqual(first.requires, { quests: ['welcome-to-dreamlight-valley'] }, 'a quest cannot need the villager it unlocks');
    assert.equal(old.level, 7);
    assert.deepEqual(old.requires, { characters: ['fern', 'moss'], levels: { moss: 10 }, quests: ['second-and-third'] }, 'a level 7 friendship quest follows the same villager\'s level 4 one');
    assert.equal(old.notes, undefined);
    const find = (id) => quests.get('sample-glade').find((q) => q.id === id);
    assert.equal(find('welcome-to-dreamlight-valley').requires, undefined);
    assert.deepEqual(find('loose-end').requires, { quests: ['welcome-to-dreamlight-valley'] }, 'everything follows the opening quest');
    assert.deepEqual(find('the-dream-castle').requires, { characters: ['moss'], quests: ['welcome-to-dreamlight-valley'] }, 'whoever gives a quest has to be in the Valley');
    assert.deepEqual(find('through-the-door').requires, { quests: ['the-dream-castle'] }, 'a realm opens from the Dream Castle, and its giver need not have moved in');
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
  const { friendship, parseSave, serialize, statuses } = await import('../src/progress.js');
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

  test('friendship levels follow finished quests and can only be raised by the player', () => {
    const g = makeGraph({
      characters: [{ id: 'starter', region: 'home' }, { id: 'pal', region: 'home' }],
      quests: [
        { id: 'early', region: 'home', giver: 'starter', level: 4 },
        { id: 'late', region: 'home', giver: 'starter', level: 10 },
        { id: 'both', region: 'home', giver: 'starter', level: 2, requires: { levels: { pal: 7 } } },
      ],
    });
    const run = (done, levels = {}) => Object.fromEntries(statuses(g, new Set(done), new Set(), new Map(Object.entries(levels))));
    assert.deepEqual([run([])['quest:early'], run([])['quest:late'], run([])['quest:both']], ['locked', 'locked', 'locked']);
    assert.equal(run([], { starter: 4 })['quest:early'], 'ready');
    assert.equal(run([], { starter: 4 })['quest:late'], 'locked');
    // Finishing the level 10 quest proves level 10, which opens the level 4 one.
    assert.equal(run(['quest:late'])['quest:early'], 'ready');
    assert.equal(run(['quest:late'])['quest:both'], 'locked', 'the other villager is still short');
    assert.equal(run(['quest:late'], { pal: 7 })['quest:both'], 'ready');
    const friends = friendship(g, new Set(['quest:early']), new Map([['starter', 2], ['pal', 9]]));
    assert.deepEqual([friends.shown('starter'), friends.level('starter'), friends.shown('pal'), friends.level('pal')], [4, 4, 1, 9]);
    const saved = JSON.stringify(serialize({ done: new Set(), unowned: new Set(), spoilers: false, levels: new Map([['pal', 7]]) }));
    assert.deepEqual([...parseSave(saved, g, regions).levels], [['pal', 7]]);
    const odd = JSON.stringify({ app: 'questlight', version: 1, levels: { pal: 99, starter: '5', nobody: 3, early: 4 } });
    assert.deepEqual([...parseSave(odd, g, regions).levels], []);
    assert.equal(parseSave('{"app":"questlight","version":1}', g, regions).levels.size, 0);
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
