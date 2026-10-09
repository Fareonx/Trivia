import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../server/Bot.js';
import { Game } from '../server/Game.js';
import { QuestionBank, loadAllQuestions } from '../server/questions.js';
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

test('bot upgrades its Town Hall only after the minimum time and with a reserve', () => {
  const g = makeGame(14, [1, 12]);
  const p = g.players.get('p0');
  const bot = new Bot('p0', 'medium', () => 0);
  const minutes = CONFIG.BOT_UPGRADE.minMinutes[2].medium;
  p.gold = 500;
  p.wood = 500;
  bot.update(g, minutes * 60000 - 1000);
  assert.equal(p.townHallLevel, 1, 'too early');
  p.gold = 60;
  p.wood = 60;
  bot.update(g, minutes * 60000);
  assert.equal(p.townHallLevel, 1, 'no reserve yet');
  p.gold = 80;
  p.wood = 80;
  bot.update(g, minutes * 60000 + 100);
  assert.equal(p.townHallLevel, 2);
  assert.equal(p.gold, 30);
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

function simulate(mode, seed, levels = ['hard', 'easy']) {
  const rand = mulberry32(seed);
  const game = new Game({
    players: levels.map((level, i) => ({ id: `${level}-${i}`, name: level })),
    questionBank: new QuestionBank(loadAllQuestions(), { rand }),
    map: generateMap(levels.length, seed),
    settings: { mode },
    now: 0,
    rand,
  });
  const bots = levels.map((level, i) => new Bot(`${level}-${i}`, level, rand));
  const LIMIT = 3 * 60 * 60 * 1000;
  let t = 0;
  let gameOver = null;
  for (; t <= LIMIT && game.phase === 'playing'; t += 100) {
    game.update(t);
    for (const b of bots) b.update(game, t);
    gameOver = game.drainEvents().find((e) => e.type === 'gameOver') ?? gameOver;
    if (t % 10000 === 0) {
      for (const p of game.players.values()) {
        if (!p.alive) continue;
        assert.ok(game.cells.has(p.knight.at), 'knight stands on a real hex');
        if (p.knight.state === 'idle') assert.equal(game.cells.get(p.knight.at).owner, p.id, 'idle knight stands on own land');
        assert.ok(p.gold >= 0 && p.wood >= 0);
        assert.equal(game.cells.get(p.townHall).owner, p.id, 'alive player still owns their capital');
      }
    }
  }
  assert.equal(game.phase, 'over', `no winner after ${t / 60000} min`);
  const winner = game.players.get(game.winner);
  assert.ok(winner?.alive);
  console.log(`  ${mode}: ${game.winner} won after ${(t / 60000).toFixed(1)} min (${gameOver.data.reason})`);
  return { game, winner, gameOver };
}

test('bot vs bot: a capital match runs to a winner without breaking any rule', () => {
  const { game, winner } = simulate('capital', 2024);
  assert.equal(owned(game, winner.id), game.cells.size - owned(game, null));
  assert.ok(CONFIG.BOT_LEVELS[game.winner.split('-')[0]]);
});

test('bot vs bot: four bots finish a match on a 100-hex map', () => {
  const { game } = simulate('capital', 31, ['hard', 'medium', 'medium', 'easy']);
  assert.ok(Math.abs(game.cells.size - 100) <= 10);
});

test('bot vs bot: a territory match ends with the biggest empire winning', () => {
  const { game, gameOver } = simulate('territory', 77);
  assert.ok(['board_full', 'capitals'].includes(gameOver.data.reason));
  assert.equal(gameOver.data.standings[0].playerId, game.winner);
});
