// Questions assembled from data tables (countries, chemical elements) and
// arithmetic. They use the same shape as the hand-written ones, plus
// `generated: true`, so the bank can keep them to a minority share.
import { readFileSync } from 'node:fs';
import { mulberry32 } from './mapgen.js';

const TABLES = new URL('../data/tables/', import.meta.url);
const readTable = (name) => JSON.parse(readFileSync(new URL(name, TABLES), 'utf8'));

const CONTINENTS = ['Avropa', 'Asiya', 'Afrika', 'Şimali Amerika', 'Cənubi Amerika', 'Okeaniya'];

// Three distinct wrong options from `pool`, never equal to `correct`.
function distractors(rand, pool, correct) {
  const options = [...new Set(pool.filter((x) => x !== correct))];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options.slice(0, 3);
}

function make(id, category, difficulty, text, correct, wrong) {
  return { id, category, difficulty, text, correct: String(correct), wrong: wrong.map(String), generated: true };
}

export function countryQuestions(countries = readTable('countries.json'), rand = mulberry32(11)) {
  const out = [];
  for (const c of countries) {
    // Wrong answers come from the same continent so they are plausible.
    const neighbours = countries.filter((o) => o.continent === c.continent && o.code !== c.code);
    if (!c.skipCapital) {
      out.push(make(`gen-capital-${c.code}`, 'geography', c.fame,
        `Ölkə: ${c.name}. Paytaxtı hansı şəhərdir?`, c.capital, distractors(rand, neighbours.map((o) => o.capital), c.capital)));
      out.push(make(`gen-capital-of-${c.code}`, 'geography', Math.min(5, c.fame + 1),
        `${c.capital} hansı ölkənin paytaxtıdır?`, c.name, distractors(rand, neighbours.map((o) => o.name), c.name)));
    }
    if (!c.skipContinent) {
      out.push(make(`gen-continent-${c.code}`, 'geography', c.fame,
        `${c.name} hansı materikdə (dünya hissəsində) yerləşir?`, c.continent, distractors(rand, CONTINENTS, c.continent)));
    }
  }
  return out;
}

export function elementQuestions(elements = readTable('elements.json'), rand = mulberry32(17)) {
  const out = [];
  for (const e of elements) {
    if (e.skipSymbol) continue;
    out.push(make(`gen-element-${e.symbol}`, 'science', e.fame,
      `Kimyəvi işarəsi "${e.symbol}" olan element hansıdır?`, e.name, distractors(rand, elements.map((o) => o.name), e.name)));
    out.push(make(`gen-symbol-${e.symbol}`, 'science', Math.min(5, e.fame + 1),
      `Element: ${e.name}. Kimyəvi işarəsi hansıdır?`, e.symbol, distractors(rand, elements.map((o) => o.symbol), e.symbol)));
  }
  return out;
}

// Wrong answers close to the right one: off by small amounts, by ten, or digits swapped.
function nearNumbers(rand, n) {
  const step = Math.max(1, Math.round(Math.abs(n) * 0.1));
  const candidates = [n + 1, n - 1, n + 2, n - 2, n + 10, n - 10, n + step, n - step, n * 2, Math.round(n / 2)];
  const swapped = Number(String(n).split('').reverse().join(''));
  if (swapped !== n) candidates.push(swapped);
  return distractors(rand, candidates.filter((x) => x > 0 && Number.isInteger(x)), n);
}

// [difficulty, how many, () => [text, answer]]
const ARITHMETIC = [
  [1, 30, (r) => { const a = 5 + r(40); const b = 3 + r(30); return [`${a} + ${b}`, a + b]; }],
  [1, 15, (r) => { const a = 20 + r(60); const b = 2 + r(19); return [`${a} − ${b}`, a - b]; }],
  [2, 30, (r) => { const a = 3 + r(7); const b = 3 + r(7); return [`${a} × ${b}`, a * b]; }],
  [2, 15, (r) => { const a = 40 + r(60); const b = 20 + r(60); return [`${a} + ${b}`, a + b]; }],
  [3, 20, (r) => { const a = 12 + r(40); const b = 3 + r(7); return [`${a} × ${b}`, a * b]; }],
  [3, 15, (r) => { const p = [10, 20, 25, 50][r(4)]; const n = (2 + r(18)) * 20; return [`${n} ədədinin ${p} faizi`, (n * p) / 100]; }],
  [3, 10, (r) => { const a = 11 + r(10); return [`${a}²`, a * a]; }],
  [4, 20, (r) => { const a = 12 + r(19); const b = 12 + r(19); return [`${a} × ${b}`, a * b]; }],
  [4, 10, (r) => { const a = 12 + r(14); return [`√${a * a}`, a]; }],
  [4, 10, (r) => { const p = [15, 30, 40, 75][r(4)]; const n = (2 + r(18)) * 20; return [`${n} ədədinin ${p} faizi`, (n * p) / 100]; }],
  [5, 15, (r) => { const a = 101 + r(400); const b = 11 + r(30); return [`${a} × ${b}`, a * b]; }],
  [5, 10, (r) => { const a = 3 + r(9); return [`${a}³`, a * a * a]; }],
  [5, 10, (r) => { const a = 12 + r(30); const b = 3 + r(9); const c = 2 + r(8); return [`(${a} + ${b}) × ${c}`, (a + b) * c]; }],
];

export function arithmeticQuestions(rand = mulberry32(23)) {
  const r = (n) => Math.floor(rand() * n);
  const out = [];
  const seen = new Set();
  let n = 0;
  for (const [difficulty, count, build] of ARITHMETIC) {
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const [expr, answer] = build(r);
      if (seen.has(expr)) continue;
      seen.add(expr);
      i++;
      out.push(make(`gen-math-${++n}`, 'math', difficulty, `Hesablayın: ${expr} = ?`, answer, nearNumbers(rand, answer)));
    }
  }
  return out;
}

export function generatedQuestions() {
  return [...countryQuestions(), ...elementQuestions(), ...arithmeticQuestions()];
}
