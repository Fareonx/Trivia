import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionBank, loadQuestions, loadCategories } from '../server/questions.js';
import { mulberry32 } from '../server/mapgen.js';

const questions = loadQuestions();
const categories = loadCategories();

test('every category has enough questions at every difficulty', () => {
  for (const { id } of categories) {
    const own = questions.filter((q) => q.category === id);
    assert.ok(own.length >= 20, `${id} has ${own.length}`);
    for (let d = 1; d <= 5; d++) assert.ok(own.some((q) => q.difficulty === d), `${id} lacks difficulty ${d}`);
  }
});

test('questions are well-formed and unique', () => {
  const known = new Set(categories.map((c) => c.id));
  const ids = new Set();
  const texts = new Set();
  for (const q of questions) {
    assert.ok(known.has(q.category), `${q.id}: unknown category`);
    assert.ok(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5, q.id);
    assert.equal(q.wrong.length, 3, q.id);
    assert.equal(new Set([q.correct, ...q.wrong]).size, 4, `${q.id}: options must differ`);
    assert.ok(!ids.has(q.id) && !texts.has(q.text), `${q.id}: duplicate`);
    ids.add(q.id);
    texts.add(q.text);
  }
});

test('draw stays in the asked category and difficulty when it can', () => {
  const bank = new QuestionBank(questions, { rand: mulberry32(1) });
  for (let i = 0; i < 50; i++) {
    const q = bank.get(bank.draw('space', 3));
    assert.equal(q.category, 'space');
    assert.equal(q.difficulty, 3);
  }
});

test('draw falls back to the nearest difficulty, then to other allowed categories', () => {
  const bank = new QuestionBank([
    { id: 'a', category: 'x', difficulty: 2, text: 'a', correct: '1', wrong: ['2', '3', '4'] },
    { id: 'b', category: 'y', difficulty: 5, text: 'b', correct: '1', wrong: ['2', '3', '4'] },
  ], { rand: () => 0.5 });
  assert.equal(bank.draw('x', 5), 'a');
  assert.equal(bank.draw('x', 1, ['a'], ['x', 'y']), 'b');
  assert.equal(bank.draw('missing', 1, [], ['y']), 'b');
});

test('repeats are rare while fresh questions remain', () => {
  const bank = new QuestionBank(questions, { rand: mulberry32(7) });
  const seen = new Set();
  let repeats = 0;
  const draws = 300;
  for (let i = 0; i < draws; i++) {
    const { id } = categories[i % categories.length];
    const q = bank.draw(id, 1 + (i % 5));
    if (seen.has(q)) repeats++;
    seen.add(q);
  }
  assert.ok(repeats / draws <= 0.1, `repeat rate ${(repeats / draws * 100).toFixed(1)}%`);
});

test('present never puts the correct answer anywhere but correctIndex', () => {
  const bank = new QuestionBank(questions, { rand: mulberry32(3) });
  for (const q of questions.slice(0, 40)) {
    const p = bank.present(q.id);
    assert.equal(p.options[p.correctIndex], q.correct);
    assert.equal(p.category, q.category);
  }
});
