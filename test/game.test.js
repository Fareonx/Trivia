import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../server/config.js';
import { key } from '../shared/hex.js';
import { MOVE, makeGame, run, answer } from './helpers.js';

test('players start with a Town Hall, its neighbours and a knight', () => {
  const g = makeGame(14, [1, 12]);
  assert.equal(g.cells.get('1,0').townHallOf, 'p0');
  assert.equal(g.cells.get('2,0').owner, 'p0');
  assert.equal(g.cells.get('1,1').owner, 'p0');
  assert.equal(g.cells.get('5,0').owner, null);
  assert.equal(g.players.get('p0').knight.at, '1,0');
});

test('only hexes adjacent to own territory can be attacked', () => {
  const g = makeGame(14, [1, 12]);
  assert.equal(g.moveKnight('p0', '5,0', 0).error, 'not_adjacent');
  assert.equal(g.moveKnight('p0', '2,0', 0).error, 'own_cell');
  assert.ok(g.moveKnight('p0', '3,0', 0).ok);
  assert.equal(g.moveKnight('p0', '3,1', 0).error, 'knight_busy');
});

test('knight walks 2 seconds per hex and gets the question on arrival', () => {
  const g = makeGame(14, [1, 12]);
  const res = g.moveKnight('p0', '3,0', 0);
  assert.deepEqual(res.path, ['1,0', '2,0', '3,0']);
  assert.equal(res.arriveAt, 2 * MOVE);
  g.drainEvents();
  run(g, 0, 2 * MOVE - 100);
  assert.equal(g.players.get('p0').knight.state, 'moving');
  g.update(2 * MOVE);
  assert.equal(g.players.get('p0').knight.state, 'answering');
  const q = g.drainEvents().find((e) => e.type === 'question');
  assert.equal(q.to, 'p0');
  assert.equal(q.data.options.length, 4);
  assert.equal(q.data.correctIndex, undefined);
  assert.equal(q.data.deadline, 2 * MOVE + 40000);
});

test('correct answer captures the hex and replaces its question', () => {
  const g = makeGame(14, [1, 12]);
  g.moveKnight('p0', '3,0', 0);
  g.update(2 * MOVE);
  const oldQuestion = g.cells.get('3,0').questionId;
  assert.ok(answer(g, 'p0', '3,0', true, 5000).ok);
  assert.equal(g.cells.get('3,0').owner, 'p0');
  assert.notEqual(g.cells.get('3,0').questionId, oldQuestion);
  assert.equal(g.players.get('p0').knight.at, '3,0');
  assert.equal(g.players.get('p0').knight.state, 'idle');
});

test('wrong answer: hex locked for that player only, question kept, knight steps back', () => {
  const g = makeGame(8, [1, 5]);
  g.moveKnight('p0', '3,0', 0);
  g.update(2 * MOVE);
  const q = g.cells.get('3,0').questionId;
  const events = g.drainEvents();
  answer(g, 'p0', '3,0', false, 5000);
  const result = g.drainEvents().find((e) => e.type === 'answerResult');
  assert.deepEqual(result.data, { target: '3,0', correct: false, timedOut: false, duel: false });
  assert.ok(events.length);
  assert.equal(g.cells.get('3,0').owner, null);
  assert.equal(g.cells.get('3,0').questionId, q);
  assert.equal(g.players.get('p0').knight.at, '2,0');
  assert.equal(g.moveKnight('p0', '3,0', 6000).error, 'locked');
  // The other player is not affected by p0's lock.
  assert.ok(g.moveKnight('p1', '3,0', 6000).ok);
  // The lock expires after a minute.
  assert.ok(g.isLocked('p0', '3,0', 5000 + CONFIG.LOCK_MS - 1));
  assert.ok(!g.isLocked('p0', '3,0', 5000 + CONFIG.LOCK_MS));
});

test('timeout counts as a wrong answer', () => {
  const g = makeGame(14, [1, 12], { difficulty: 5 });
  g.moveKnight('p0', '3,0', 0);
  g.update(2 * MOVE);
  run(g, 2 * MOVE, 2 * MOVE + 30000);
  assert.equal(g.cells.get('3,0').owner, null);
  assert.ok(g.isLocked('p0', '3,0', 2 * MOVE + 30001));
  assert.equal(g.players.get('p0').knight.at, '2,0');
});

test('a hex is busy while someone answers on it', () => {
  const g = makeGame(8, [1, 5]);
  g.moveKnight('p0', '3,0', 0);
  g.update(2 * MOVE);
  assert.equal(g.moveKnight('p1', '3,0', 2 * MOVE).error, 'cell_busy');
});

test('duel: first knight waits, both right → next question, one wrong → other captures', () => {
  const g = makeGame(8, [1, 5]);
  g.moveKnight('p0', '3,0', 0);
  g.moveKnight('p1', '3,0', 1000);
  run(g, 0, 2 * MOVE);
  assert.equal(g.players.get('p0').knight.state, 'arrived');
  assert.equal(g.engagements.get('3,0').phase, 'waiting');
  const t = run(g, 2 * MOVE, 2 * MOVE + 1000);
  const eng = g.engagements.get('3,0');
  assert.equal(eng.phase, 'question');
  assert.ok(eng.duel);
  answer(g, 'p0', '3,0', true, t);
  answer(g, 'p1', '3,0', true, t);
  assert.equal(eng.round, 2);
  answer(g, 'p0', '3,0', false, t + 100);
  answer(g, 'p1', '3,0', true, t + 100);
  assert.equal(g.cells.get('3,0').owner, 'p1');
  // Duel loser goes back to their Town Hall and is locked out of the hex.
  assert.equal(g.players.get('p0').knight.at, '1,0');
  assert.ok(g.isLocked('p0', '3,0', t + 200));
});

test('duel: both wrong → both lose, hex keeps its owner', () => {
  const g = makeGame(8, [1, 5]);
  g.moveKnight('p0', '3,0', 0);
  g.moveKnight('p1', '3,0', 0);
  const t = run(g, 0, 2 * MOVE);
  answer(g, 'p0', '3,0', false, t);
  answer(g, 'p1', '3,0', false, t);
  assert.equal(g.cells.get('3,0').owner, null);
  assert.equal(g.players.get('p0').knight.at, '1,0');
  assert.equal(g.players.get('p1').knight.at, '5,0');
  assert.ok(!g.engagements.has('3,0'));
});

test('duel: late rival is stopped after the wait limit and the first answers solo', () => {
  const g = makeGame(20, [1, 18]);
  g.moveKnight('p0', '3,0', 0);
  // Give p1 a long road of its own hexes along row 1 towards 3,0 (16 steps).
  for (let q = 3; q <= 17; q++) g.cells.get(key(q, 1)).owner = 'p1';
  const res = g.moveKnight('p1', '3,0', 0);
  assert.ok(res.ok);
  const waitEnds = 2 * MOVE + CONFIG.DUEL_WAIT_MS;
  const stoppedAt = Math.floor(waitEnds / MOVE);
  assert.ok(res.path.length - 1 > stoppedAt, 'p1 cannot make it in time');
  run(g, 0, waitEnds);
  const eng = g.engagements.get('3,0');
  assert.equal(eng.phase, 'question');
  assert.ok(!eng.duel);
  assert.deepEqual(eng.participants, ['p0']);
  assert.equal(g.players.get('p1').knight.state, 'idle');
  // Stopped part-way along its road, not at the target.
  assert.equal(g.players.get('p1').knight.at, res.path[stoppedAt]);
});

test('knight stops when a hex on its road is taken by an enemy', () => {
  const g = makeGame(14, [1, 12]);
  for (const q of [2, 3, 4, 5]) g.cells.get(key(q, 0)).owner = 'p0';
  g.moveKnight('p0', '6,0', 0);
  g.update(MOVE);
  g.cells.get('3,0').owner = 'p1';
  run(g, MOVE, 4 * MOVE);
  assert.equal(g.players.get('p0').knight.state, 'idle');
  assert.equal(g.players.get('p0').knight.at, '2,0');
});

test('resource hexes pay their owner over time', () => {
  const g = makeGame(14, [1, 12], { resources: { '2,0': 'gold', '1,1': 'wood', '6,0': 'gold' } });
  run(g, 0, CONFIG.RESOURCE_INTERVAL_MS * 3);
  const p = g.players.get('p0');
  assert.equal(p.gold, 3 * CONFIG.RESOURCE_AMOUNT);
  assert.equal(p.wood, 3 * CONFIG.RESOURCE_AMOUNT);
});

test('Town Hall upgrades cost resources and make the capital harder to take', () => {
  const g = makeGame(8, [1, 4]);
  const p1 = g.players.get('p1');
  assert.equal(g.upgradeTownHall('p1').error, 'no_resources');
  p1.gold = 500;
  p1.wood = 500;
  assert.equal(g.upgradeTownHall('p1').level, 2);
  assert.equal(g.upgradeTownHall('p1').level, 3);
  assert.equal(g.upgradeTownHall('p1').error, 'max_level');
  assert.equal(p1.gold, 500 - 50 - 120);

  // p0 attacks the level-3 hall at 4,0 (adjacent to p0's 3,0 after a capture).
  g.cells.get('2,0').owner = 'p0';
  g.cells.get('3,0').owner = 'p0';
  g.players.get('p0').knight.at = '3,0';
  g.moveKnight('p0', '4,0', 0);
  g.drainEvents();
  g.update(MOVE);
  const q = g.drainEvents().find((e) => e.type === 'question');
  assert.equal(q.data.deadline, MOVE + 15000);
  assert.equal(q.data.required, 3);
  assert.equal(q.data.difficulty, 5, 'Town Hall questions are the hardest');
  answer(g, 'p0', '4,0', true, MOVE + 100);
  answer(g, 'p0', '4,0', true, MOVE + 200);
  assert.equal(g.cells.get('4,0').owner, 'p1', 'two correct answers are not enough at level 3');
  answer(g, 'p0', '4,0', true, MOVE + 300);
  assert.equal(g.cells.get('4,0').owner, 'p0');
});

test('capturing a Town Hall takes the whole empire and ends the game', () => {
  const g = makeGame(8, [1, 4]);
  g.players.get('p1').gold = 7;
  g.cells.get('2,0').owner = 'p0';
  g.cells.get('3,0').owner = 'p0';
  g.players.get('p0').knight.at = '3,0';
  g.moveKnight('p0', '4,0', 0);
  g.update(MOVE);
  answer(g, 'p0', '4,0', true, MOVE + 100);
  const p1 = g.players.get('p1');
  assert.equal(p1.alive, false);
  assert.equal([...g.cells.values()].filter((c) => c.owner === 'p1').length, 0);
  assert.equal(g.cells.get('5,0').owner, 'p0');
  assert.equal(g.cells.get('4,0').ruin, true, 'captured capital is left as ruins');
  assert.equal(g.cells.get('4,0').townHallOf, null);
  assert.equal(g.players.get('p0').gold, 7);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  assert.equal(g.moveKnight('p0', '6,1', MOVE + 200).error, 'game_over');
});

test('snapshot never leaks correct answers and only shows own locks', () => {
  const g = makeGame(8, [1, 5]);
  g.moveKnight('p0', '3,0', 0);
  g.update(2 * MOVE);
  answer(g, 'p0', '3,0', false, 5000);
  const json = JSON.stringify(g.snapshotFor('p1', 5000));
  assert.ok(!json.includes('correct'));
  assert.deepEqual(g.snapshotFor('p1', 5000).locks, {});
  assert.ok(g.snapshotFor('p0', 5000).locks['3,0']);
});
