import { CONFIG } from './config.js';
import { findPath } from '../shared/hex.js';

function between(rand, [min, max]) {
  return min + rand() * (max - min);
}

/**
 * Computer opponent. It reads the authoritative Game state on the server and
 * acts only through the same public methods a human uses (moveKnight,
 * submitAnswer, upgradeTownHall), so every rule applies to it unchanged.
 */
export class Bot {
  constructor(id, level = 'medium', rand = Math.random) {
    this.id = id;
    this.level = CONFIG.BOT_LEVELS[level] ? level : 'medium';
    this.rand = rand;
    this.nextThink = null;
    this.pending = null;
  }

  accuracy(difficulty) {
    const base = CONFIG.BOT_LEVELS[this.level].accuracy;
    return Math.max(0.05, base - (difficulty - 1) * CONFIG.BOT_ACCURACY_DROP_PER_DIFFICULTY);
  }

  update(game, now) {
    if (game.phase !== 'playing') return;
    const me = game.players.get(this.id);
    if (!me?.alive) return;

    const next = CONFIG.TOWN_HALL_LEVELS[me.townHallLevel + 1];
    if (next && me.gold >= next.cost.gold && me.wood >= next.cost.wood) game.upgradeTownHall(this.id);

    const knight = me.knight;
    if (knight.state === 'answering') {
      this.answer(game, knight.target, now);
      return;
    }
    this.pending = null;
    if (knight.state !== 'idle') {
      this.nextThink = null;
      return;
    }
    if (this.nextThink === null) this.nextThink = now + between(this.rand, CONFIG.BOT_THINK_MS);
    if (now >= this.nextThink) {
      this.nextThink = null;
      this.attack(game, now);
    }
  }

  answer(game, target, now) {
    const eng = game.engagements.get(target);
    if (!eng || eng.phase !== 'question' || !eng.active.includes(this.id) || eng.answers.has(this.id)) return;
    const roundKey = `${target}#${eng.round}#${eng.deadline}`;
    if (this.pending?.key !== roundKey) {
      const latest = eng.deadline - now - 2000;
      const delay = Math.max(500, Math.min(between(this.rand, CONFIG.BOT_ANSWER_MS), latest));
      const difficulty = game.cells.get(target).difficulty;
      this.pending = { key: roundKey, at: now + delay, correct: this.rand() < this.accuracy(difficulty) };
    }
    if (now < this.pending.at) return;
    const { correctIndex, options } = eng.question;
    let index = correctIndex;
    if (!this.pending.correct) {
      const wrong = options.map((_, i) => i).filter((i) => i !== correctIndex);
      index = wrong[Math.floor(this.rand() * wrong.length)];
    }
    this.pending = null;
    game.submitAnswer(this.id, index, now);
  }

  // Hexes the knight could legally be sent to right now, best first.
  rankTargets(game, now) {
    const me = game.players.get(this.id);
    const options = [];
    for (const cell of game.cells.values()) {
      if (cell.owner === this.id) continue;
      if (!game.isAdjacentToTerritory(this.id, cell.key)) continue;
      if (game.isLocked(this.id, cell.key, now) || game.engagements.has(cell.key)) continue;
      if (game.knightsHeadingTo(cell.key, this.id).length >= 2) continue;
      const path = findPath(me.knight.at, cell.key, (k) => game.cells.get(k)?.owner === this.id);
      if (!path) continue;
      const enemyHall = cell.townHallOf && cell.townHallOf !== this.id;
      const score = (cell.resource ? 3 : 0)
        + (cell.owner ? 1 : 0)
        + (enemyHall ? 6 : 0)
        - 0.8 * cell.difficulty
        - 0.5 * (path.length - 1)
        + this.rand() * 1.5;
      options.push({ key: cell.key, score });
    }
    return options.sort((a, b) => b.score - a.score);
  }

  attack(game, now) {
    for (const { key } of this.rankTargets(game, now)) {
      if (game.moveKnight(this.id, key, now).ok) return key;
    }
    return null;
  }
}
