import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { QuestionBank } from '../server/questions.js';
import { CONFIG } from '../server/config.js';
import { key } from '../shared/hex.js';
import { MOVE, makeGame, stripMap, run, answer, questions } from './helpers.js';

const capture = (g, playerId, k, time = 0) => g.capture(g.players.get(playerId), g.cells.get(k), time);

test('hexes get only the enabled categories, in roughly equal shares', () => {
  const qs = [];
  for (const category of ['a', 'b', 'c']) {
    for (let d = 1; d <= 5; d++) qs.push({ id: `${category}${d}`, category, difficulty: d, text: `${category}${d}`, correct: '1', wrong: ['2', '3', '4'] });
  }
  const g = new Game({
    players: [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }],
    questionBank: new QuestionBank(qs, { rand: () => 0.4 }),
    map: stripMap(10, [1, 8]),
    settings: { categories: ['a', 'c', 'unknown'] },
    now: 0,
  });
  const counts = { a: 0, c: 0 };
  for (const cell of g.cells.values()) {
    counts[cell.category]++;
    assert.equal(cell.questionId, null, 'questions are drawn on the first attack, not up front');
  }
  assert.deepEqual(Object.keys(counts).sort(), ['a', 'c']);
  assert.equal(counts.a, counts.c);
  assert.equal(g.snapshotFor('p0', 0).cells[0].category !== undefined, true);
});

test('a level-1 Town Hall asks a difficulty-4 question', () => {
  const g = makeGame(8, [1, 4]);
  g.cells.get('2,0').owner = 'p0';
  g.cells.get('3,0').owner = 'p0';
  g.players.get('p0').knight.at = '3,0';
  g.moveKnight('p0', '4,0', 0);
  g.drainEvents();
  g.update(MOVE);
  const q = g.drainEvents().find((e) => e.type === 'question');
  assert.equal(q.data.difficulty, 4);
  assert.equal(q.data.required, 1);
});

test('a knight whose hex is captured dies even with its own land next to it', () => {
  const g = makeGame(14, [1, 12]);
  g.players.get('p0').knight.at = '2,0';
  capture(g, 'p1', '2,0', 500);
  const knight = g.players.get('p0').knight;
  assert.equal(knight.state, 'respawning');
  assert.equal(knight.respawnAt, 500 + CONFIG.RESPAWN_MS);
  assert.ok(g.drainEvents().some((e) => e.type === 'knightKilled'));
});

test('a surrounded knight dies and comes back at its Town Hall after 10 seconds', () => {
  const g = makeGame(14, [1, 12]);
  // An isolated enclave of p0 deep in the middle, with the knight on it.
  g.cells.get('6,0').owner = 'p0';
  g.players.get('p0').knight.at = '6,0';
  capture(g, 'p1', '6,0', 1000);
  const knight = g.players.get('p0').knight;
  assert.equal(knight.state, 'respawning');
  assert.equal(knight.respawnAt, 1000 + CONFIG.RESPAWN_MS);
  assert.equal(g.moveKnight('p0', '3,0', 2000).error, 'knight_dead');
  run(g, 1000, 1000 + CONFIG.RESPAWN_MS - 100);
  assert.equal(knight.state, 'respawning');
  g.update(1000 + CONFIG.RESPAWN_MS);
  assert.equal(knight.state, 'idle');
  assert.equal(knight.at, '1,0');
  assert.ok(g.moveKnight('p0', '3,0', 1000 + CONFIG.RESPAWN_MS).ok);
});

test('a knight returning after a wrong answer to a hex it lost meanwhile retreats or dies', () => {
  const g = makeGame(14, [1, 12]);
  for (const q of [2, 3, 4, 5]) g.cells.get(key(q, 0)).owner = 'p0';
  g.players.get('p0').knight.at = '5,0';
  g.moveKnight('p0', '6,0', 0);
  g.update(MOVE);
  // While p0 answers on 6,0, p1 takes 5,0 (the hex p0 came from) and every hex around it.
  for (const k of ['4,0', '4,1', '5,1']) g.cells.get(k).owner = 'p1';
  capture(g, 'p1', '5,0', MOVE + 100);
  answer(g, 'p0', '6,0', false, MOVE + 200);
  assert.equal(g.players.get('p0').knight.state, 'respawning');
});

test('territory mode ends when no neutral hex is left; most hexes wins', () => {
  const g = makeGame(8, [1, 6], { settings: { mode: 'territory' } });
  const keys = [...g.cells.keys()].filter((k) => !g.cells.get(k).owner);
  const last = keys.pop();
  keys.forEach((k, i) => { g.cells.get(k).owner = i % 3 === 0 ? 'p1' : 'p0'; });
  g.drainEvents();
  capture(g, 'p0', last);
  assert.equal(g.phase, 'over');
  const over = g.drainEvents().find((e) => e.type === 'gameOver');
  assert.equal(over.data.reason, 'board_full');
  assert.equal(over.data.winner, 'p0');
  assert.equal(over.data.standings[0].playerId, 'p0');
  assert.ok(over.data.standings[0].cells > over.data.standings[1].cells);
});

test('capital mode keeps going when the board is full', () => {
  const g = makeGame(8, [1, 6]);
  const keys = [...g.cells.keys()].filter((k) => !g.cells.get(k).owner);
  const last = keys.pop();
  keys.forEach((k) => { g.cells.get(k).owner = 'p0'; });
  capture(g, 'p0', last);
  assert.equal(g.phase, 'playing');
});

test('the host can stop a territory game; ties end in a draw', () => {
  const capital = makeGame(8, [1, 6]);
  assert.equal(capital.stopByHost(0).error, 'wrong_mode');

  const g = makeGame(8, [1, 6], { settings: { mode: 'territory' } });
  capture(g, 'p1', '3,0');
  assert.ok(g.stopByHost(10).ok);
  assert.equal(g.winner, 'p1');

  const tie = makeGame(8, [1, 6], { settings: { mode: 'territory' } });
  assert.ok(tie.stopByHost(0).ok);
  assert.equal(tie.phase, 'over');
  assert.equal(tie.winner, null);
});

test('taking a capital still eliminates the player in territory mode', () => {
  const g = makeGame(8, [1, 4], { settings: { mode: 'territory' } });
  capture(g, 'p0', '4,0');
  assert.equal(g.players.get('p1').alive, false);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
});

test('eight players start with eight different colours and Town Halls', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const g = new Game({ players, questionBank: new QuestionBank(questions()), seed: 3, now: 0 });
  const all = [...g.players.values()];
  assert.equal(new Set(all.map((p) => p.color)).size, 8);
  assert.equal(new Set(all.map((p) => p.townHall)).size, 8);
  for (const p of all) assert.equal(g.cells.get(p.townHall).townHallOf, p.id);
  assert.ok(Math.abs(g.cells.size - 200) <= 20);
});
