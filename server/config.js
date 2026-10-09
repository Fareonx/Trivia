// All gameplay numbers live here so balance can be tuned in one place.

export const CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  // Movement: walking one hex takes this long.
  MOVE_MS_PER_HEX: 1000,

  // Answer timer depends on hex difficulty: 40s at difficulty 1 → 30s at difficulty 5.
  ANSWER_MS_EASY: 40000,
  ANSWER_MS_HARD: 30000,

  // After a wrong answer / timeout the hex is locked for that player only.
  LOCK_MS: 60000,

  // A knight that arrives first waits at most this long for a rival heading to the same hex.
  DUEL_WAIT_MS: 10000,

  // A knight whose hex is captured while it is surrounded dies and returns to its Town Hall after this long.
  RESPAWN_MS: 10000,

  // Chance that a question already asked in this match is picked again while fresh ones remain.
  QUESTION_REPEAT_CHANCE: 0.07,

  // Resource hexes pay their owner +RESOURCE_AMOUNT every RESOURCE_INTERVAL_MS.
  RESOURCE_INTERVAL_MS: 5000,
  RESOURCE_AMOUNT: 1,

  // Town Hall levels. `cost` is what upgrading TO that level costs.
  // difficulty: minimum question difficulty; answerMs: caps the attacker's timer;
  // questions: correct answers needed in a row.
  TOWN_HALL_LEVELS: {
    1: { cost: null, difficulty: 4, answerMs: null, questions: 1 },
    2: { cost: { gold: 50, wood: 50 }, difficulty: 5, answerMs: 20000, questions: 2 },
    3: { cost: { gold: 120, wood: 120 }, difficulty: 5, answerMs: 15000, questions: 3 },
  },

  // 'capital': win by taking every other Town Hall.
  // 'territory': also ends when no neutral hex is left or the host stops it; most hexes wins.
  MODES: ['capital', 'territory'],

  // Map generation.
  MAP_RADIUS_BY_PLAYERS: { 2: 6, 3: 7, 4: 8 },
  HOLE_RATIO: 0.12,
  RESOURCE_RATIO: 0.12,

  // Server tick.
  TICK_MS: 100,

  // Bots: chance of a correct answer is `accuracy − (difficulty − 1) × ACCURACY_DROP_PER_DIFFICULTY`.
  BOT_LEVELS: {
    easy: { accuracy: 0.6 },
    medium: { accuracy: 0.75 },
    hard: { accuracy: 0.9 },
  },
  BOT_ACCURACY_DROP_PER_DIFFICULTY: 0.08,
  // Pause before picking the next hex, and "thinking" time before answering.
  BOT_THINK_MS: [1500, 3000],
  BOT_ANSWER_MS: [4000, 15000],
  BOT_NAMES: ['Bot Nizami', 'Bot Füzuli', 'Bot Nəsimi'],
};

export const PLAYER_COLORS = ['blue', 'red', 'green', 'yellow'];

export function answerMsForDifficulty(difficulty) {
  const t = (difficulty - 1) / 4;
  return Math.round(CONFIG.ANSWER_MS_EASY + (CONFIG.ANSWER_MS_HARD - CONFIG.ANSWER_MS_EASY) * t);
}
