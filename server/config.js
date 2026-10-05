// All gameplay numbers live here so balance can be tuned in one place.

export const CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  // Movement: walking one hex takes this long.
  MOVE_MS_PER_HEX: 2000,

  // Answer timer depends on hex difficulty: 40s at difficulty 1 → 30s at difficulty 5.
  ANSWER_MS_EASY: 40000,
  ANSWER_MS_HARD: 30000,

  // After a wrong answer / timeout the hex is locked for that player only.
  LOCK_MS: 60000,

  // A knight that arrives first waits at most this long for a rival heading to the same hex.
  DUEL_WAIT_MS: 10000,

  // Resource hexes pay their owner +RESOURCE_AMOUNT every RESOURCE_INTERVAL_MS.
  RESOURCE_INTERVAL_MS: 5000,
  RESOURCE_AMOUNT: 1,

  // Town Hall levels. `cost` is what upgrading TO that level costs.
  // answerMs: overrides the attacker's answer timer; questions: correct answers needed in a row.
  TOWN_HALL_LEVELS: {
    1: { cost: null, answerMs: null, questions: 1 },
    2: { cost: { gold: 50, wood: 50 }, answerMs: 20000, questions: 1 },
    3: { cost: { gold: 120, wood: 120 }, answerMs: 20000, questions: 2 },
  },

  // Map generation.
  MAP_RADIUS_BY_PLAYERS: { 2: 6, 3: 7, 4: 8 },
  HOLE_RATIO: 0.12,
  RESOURCE_RATIO: 0.12,

  // Server tick.
  TICK_MS: 100,
};

export const PLAYER_COLORS = ['blue', 'red', 'green', 'yellow'];

export function answerMsForDifficulty(difficulty) {
  const t = (difficulty - 1) / 4;
  return Math.round(CONFIG.ANSWER_MS_EASY + (CONFIG.ANSWER_MS_HARD - CONFIG.ANSWER_MS_EASY) * t);
}
