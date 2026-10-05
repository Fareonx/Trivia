import { readFileSync } from 'node:fs';

const DEFAULT_PATH = new URL('../data/questions.json', import.meta.url);

export function loadQuestions(path = DEFAULT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Hands out questions by difficulty. Questions already used in this match are
 * skipped until the pool for a difficulty runs dry, then that pool is recycled.
 * When a difficulty has no questions at all, the nearest difficulty is used.
 */
export class QuestionBank {
  constructor(questions, rand = Math.random) {
    this.rand = rand;
    this.byId = new Map(questions.map((q) => [q.id, q]));
    this.pools = new Map();
    for (const q of questions) {
      if (!this.pools.has(q.difficulty)) this.pools.set(q.difficulty, []);
      this.pools.get(q.difficulty).push(q.id);
    }
    this.used = new Set();
  }

  get(id) {
    return this.byId.get(id);
  }

  // Returns a question id for the difficulty, never one of `excludeIds`.
  draw(difficulty, excludeIds = []) {
    const exclude = new Set(excludeIds);
    const difficulties = [...this.pools.keys()].sort(
      (a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty) || a - b,
    );
    for (const d of difficulties) {
      const pool = this.pools.get(d).filter((id) => !exclude.has(id));
      if (!pool.length) continue;
      let fresh = pool.filter((id) => !this.used.has(id));
      if (!fresh.length) {
        pool.forEach((id) => this.used.delete(id));
        fresh = pool;
      }
      const id = fresh[Math.floor(this.rand() * fresh.length)];
      this.used.add(id);
      return id;
    }
    throw new Error('Question bank is empty');
  }

  // Builds a shuffled presentation. `correctIndex` must stay on the server.
  present(id) {
    const q = this.byId.get(id);
    const options = [q.correct, ...q.wrong];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { id, text: q.text, options, correctIndex: options.indexOf(q.correct) };
  }
}
