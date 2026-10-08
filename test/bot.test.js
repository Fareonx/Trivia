import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../server/Bot.js';
import { Game } from '../server/Game.js';
import { QuestionBank, loadQuestions } from '../server/questions.js';
import { generateMap, mulberry32 } from '../server/mapgen.js';
import { CONFIG } from '../server/config.js';
import { neighborKeys } from '../shared/hex.js';
import { makeGame } from './helpers.js';

function tick(game, bots, from, to, step = 100) {
  for (let t = from; t <= to; t += step) {
    game.update(t);
    for (const b of bots) b.update(game, t);
    game.drainEvents();
  }
  return to;
}

const owned = (game, id) => [...game.cells.values()].filter((c) => c.owner === id).length;

test('bot only ranks hexes it may legally attack', () => {
  const g = makeGame(14, [1, 12]);
  const bot = new Bot('p0', 'medium', mulberry32(1));
  g.locks.get('p0').set('3,0', 60000);
  const keys = bot.rankTargets(g, 0).map((t) => t.key);
  assert.ok(keys.length > 0);
  assert.ok(!keys.includes('3,0'), 'locked hex skipped');
  for (const k of keys) {
    assert.notEqual(g.cells.get(k).owner, 'p0');
    assert.ok(neighborKeys(k).some((n) => g.cells.get(n)?.owner === 'p0'));
  }
});

test('a bot that always answers right expands its territory', () => {
  const g = makeGame(14, [1, 12]);
  const start = owned(g, 'p0');
  tick(g, [new Bot('p0', 'hard', () => 0)], 0, 60000);
  assert.ok(owned(g, 'p0') > start + 2, `owned ${owned(g, 'p0')}`);
});

test('a bot that answers wrong is locked out, and answers before the deadline', () => {
  const g = makeGame(14, [1, 12]);
  const bot = new Bot('p0', 'easy', () => 0.99);
  let deadline = null;
  let lockedAt = null;
  for (let t = 0; t <= 60000 && lockedAt === null; t += 100) {
    g.update(t);
    bot.update(g, t);
    const target = g.players.get('p0').knight.target;
    const eng = target && g.engagements.get(target);
    if (eng?.phase === 'question') deadline = eng.deadline;
    if (g.locks.get('p0').size) lockedAt = t;
  }
  assert.ok(lockedAt !== null, 'bot got locked out after a wrong answer');
  assert.ok(lockedAt <= deadline - 2000 + 100, 'answered with time to spare');
  assert.equal(owned(g, 'p0'), 5);
});

test('bot upgrades its Town Hall when it can afford it', () => {
  const g = makeGame(14, [1, 12]);
  const p = g.players.get('p0');
  p.gold = 60;
  p.wood = 60;
  new Bot('p0', 'medium', mulberry32(2)).update(g, 0);
  assert.equal(p.townHallLevel, 2);
  assert.equal(p.gold, 10);
});

test('bot answers each duel round only once', () => {
  const g = makeGame(8, [1, 5]);
  const bot = new Bot('p0', 'hard', () => 0);
  g.moveKnight('p1', '3,0', 0);
  g.moveKnight('p0', '3,0', 0);
  let calls = 0;
  const original = g.submitAnswer.bind(g);
  g.submitAnswer = (...args) => { calls++; return original(...args); };
  tick(g, [bot], 0, 4000 + 30000);
  assert.equal(calls, 1);
});

test('bot vs bot: a full match runs to a winner without breaking any rule', () => {
  const rand = mulberry32(2024);
  const game = new Game({
    players: [{ id: 'hard', name: 'Hard' }, { id: 'easy', name: 'Easy' }],
    questionBank: new QuestionBank(loadQuestions(), rand),
    map: generateMap(2, 2024),
    now: 0,
  });
  const bots = [new Bot('hard', 'hard', rand), new Bot('easy', 'easy', rand)];
  const LIMIT = 3 * 60 * 60 * 1000;
  let t = 0;
  for (; t <= LIMIT && game.phase === 'playing'; t += 100) {
    game.update(t);
    for (const b of bots) b.update(game, t);
    game.drainEvents();
    if (t % 10000 === 0) {
      for (const p of game.players.values()) {
        if (!p.alive) continue;
        assert.ok(game.cells.has(p.knight.at), 'knight stands on a real hex');
        assert.ok(p.gold >= 0 && p.wood >= 0);
        assert.equal(game.cells.get(p.townHall).owner, p.id, 'alive player still owns their capital');
      }
    }
  }
  assert.equal(game.phase, 'over', `no winner after ${t / 60000} min`);
  const winner = game.players.get(game.winner);
  assert.ok(winner.alive);
  assert.equal(owned(game, winner.id), game.cells.size - owned(game, null));
  console.log(`  winner: ${game.winner} after ${(t / 60000).toFixed(1)} min, Town Hall level ${winner.townHallLevel}`);
  assert.ok(CONFIG.BOT_LEVELS[game.winner]);
});
