import { readFileSync, readdirSync } from 'node:fs';
import { CONFIG } from './config.js';
import { generatedQuestions } from './generators.js';

const DATA_DIR = new URL('../data/', import.meta.url);

/** [{ id, name, icon }] in display order. */
export function loadCategories(path = new URL('categories.json', DATA_DIR)) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Hand-written questions from every data/questions/<category>.json file. */
export function loadQuestions(dir = new URL('questions/', DATA_DIR)) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
}

/** Hand-written plus table-generated questions (capitals, elements, arithmetic). */
export function loadAllQuestions() {
  return [...loadQuestions(), ...generatedQuestions()];
}

/**
 * Hands out questions by category and difficulty. Questions already asked in
 * this match come back only rarely (`repeatChance`), or once their pool has
 * run out. Generated questions are picked only `generatedShare` of the time
 * when hand-written ones are available too. When a category has nothing at the
 * wanted difficulty, the nearest difficulty is used, then the other allowed categories.
 */
export class QuestionBank {
  constructor(questions, {
    rand = Math.random,
    repeatChance = CONFIG.QUESTION_REPEAT_CHANCE,
    generatedShare = CONFIG.GENERATED_QUESTION_SHARE,
  } = {}) {
    this.rand = rand;
    this.repeatChance = repeatChance;
    this.generatedShare = generatedShare;
    this.byId = new Map(questions.map((q) => [q.id, q]));
    // Map<category, Map<difficulty, id[]>>
    this.pools = new Map();
    for (const q of questions) {
      if (!this.pools.has(q.category)) this.pools.set(q.category, new Map());
      const byDifficulty = this.pools.get(q.category);
      if (!byDifficulty.has(q.difficulty)) byDifficulty.set(q.difficulty, []);
      byDifficulty.get(q.difficulty).push(q.id);
    }
    this.used = new Set();
  }

  get(id) {
    return this.byId.get(id);
  }

  categories() {
    return [...this.pools.keys()];
  }

  // Candidate pools, best match first.
  *poolsFor(category, difficulty, allowedCategories) {
    const byNearest = (byDifficulty) => [...byDifficulty.keys()]
      .sort((a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty) || b - a)
      .map((d) => byDifficulty.get(d));
    if (this.pools.has(category)) yield* byNearest(this.pools.get(category));
    for (const other of allowedCategories ?? this.categories()) {
      if (other !== category && this.pools.has(other)) yield* byNearest(this.pools.get(other));
    }
  }

  /** Returns a question id; never one of `excludeIds`. */
  draw(category, difficulty, excludeIds = [], allowedCategories = null) {
    const exclude = new Set(excludeIds);
    for (const ids of this.poolsFor(category, difficulty, allowedCategories)) {
      const allowed = ids.filter((id) => !exclude.has(id));
      if (!allowed.length) continue;
      const generated = allowed.filter((id) => this.byId.get(id).generated);
      const written = allowed.filter((id) => !this.byId.get(id).generated);
      const useGenerated = !written.length || (generated.length > 0 && this.rand() < this.generatedShare);
      const isFresh = (id) => !this.used.has(id);
      let pool = useGenerated ? generated : written;
      const other = useGenerated ? written : generated;
      // Rather switch sources than repeat a question.
      if (!pool.some(isFresh) && other.some(isFresh)) pool = other;
      const fresh = pool.filter((id) => !this.used.has(id));
      const seen = pool.filter((id) => this.used.has(id));
      const repeat = !fresh.length || (seen.length > 0 && this.rand() < this.repeatChance);
      const from = repeat ? seen : fresh;
      const id = from[Math.floor(this.rand() * from.length)];
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
    return { id, category: q.category, text: q.text, options, correctIndex: options.indexOf(q.correct) };
  }
}
