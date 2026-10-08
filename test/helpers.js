// Shared fixtures for the game and bot tests.
import { Game } from '../server/Game.js';
import { QuestionBank } from '../server/questions.js';
import { CONFIG } from '../server/config.js';
import { key } from '../shared/hex.js';

export const MOVE = CONFIG.MOVE_MS_PER_HEX;

export function questions() {
  const out = [];
  let id = 1;
  for (let d = 1; d <= 5; d++) {
    for (let i = 0; i < 6; i++) out.push({ id: id++, difficulty: d, text: `Q${id}`, correct: 'yes', wrong: ['a', 'b', 'c'] });
  }
  return out;
}

// A two-row strip of hexes: q = 0..width-1, r = 0..1. Homes sit on row 0.
export function stripMap(width, homes, { difficulty = 1, resources = {} } = {}) {
  const cells = new Map();
  for (let q = 0; q < width; q++) {
    for (const r of [0, 1]) {
      const k = key(q, r);
      cells.set(k, { q, r, difficulty, resource: resources[k] ?? null });
    }
  }
  return { radius: width, seed: 0, cells, spawns: homes.map((q) => key(q, 0)) };
}

export function makeGame(width, homes, opts) {
  const players = homes.map((_, i) => ({ id: `p${i}`, name: `P${i}` }));
  return new Game({
    players,
    questionBank: new QuestionBank(questions(), () => 0.3),
    map: stripMap(width, homes, opts),
    now: 0,
  });
}

export function run(game, from, to) {
  for (let t = from; t <= to; t += 100) game.update(t);
  return to;
}

export function answer(game, playerId, target, correct, now) {
  const eng = game.engagements.get(target);
  const idx = correct ? eng.question.correctIndex : (eng.question.correctIndex + 1) % 4;
  return game.submitAnswer(playerId, idx, now);
}
