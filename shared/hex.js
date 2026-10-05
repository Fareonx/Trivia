// Hex math shared by the server and the browser (axial coordinates, pointy-top).
// See https://www.redblobgames.com/grids/hexagons/ for the formulas.

export const DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function key(q, r) {
  return `${q},${r}`;
}

export function parseKey(k) {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

export function neighbors(q, r) {
  return DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

export function neighborKeys(k) {
  const { q, r } = parseKey(k);
  return neighbors(q, r).map((n) => key(n.q, n.r));
}

export function distance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hexToPixel(q, r, size) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

function roundAxial(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // `|| 0` turns -0 into 0 so keys stay canonical.
  return { q: q || 0, r: r || 0 };
}

export function pixelToHex(x, y, size) {
  const fq = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const fr = ((2 / 3) * y) / size;
  return roundAxial(fq, fr);
}

// Corner points of a pointy-top hex centred at (cx, cy).
export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}

// Breadth-first shortest path between two hex keys.
// `passable(k)` decides which intermediate hexes may be walked through; the
// goal itself is always allowed. Returns the list of keys from start to goal
// (inclusive), or null when unreachable.
export function findPath(startKey, goalKey, passable) {
  if (startKey === goalKey) return [startKey];
  const prev = new Map([[startKey, null]]);
  const queue = [startKey];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighborKeys(cur)) {
      if (prev.has(n)) continue;
      if (n !== goalKey && !passable(n)) continue;
      prev.set(n, cur);
      if (n === goalKey) {
        const path = [n];
        let p = cur;
        while (p !== null) {
          path.push(p);
          p = prev.get(p);
        }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}
