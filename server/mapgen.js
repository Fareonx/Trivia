import { CONFIG } from './config.js';
import { DIRECTIONS, key, parseKey, neighborKeys, distance } from '../shared/hex.js';

// Small deterministic PRNG so a map can be reproduced from its seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hexes at exactly `radius` steps from the origin, walking once around the ring.
export function ringKeys(radius) {
  if (radius === 0) return [key(0, 0)];
  const out = [];
  let q = DIRECTIONS[4].q * radius;
  let r = DIRECTIONS[4].r * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(key(q, r));
      q += DIRECTIONS[side].q;
      r += DIRECTIONS[side].r;
    }
  }
  return out;
}

// Smallest hexagon that still leaves room for some holes around `target` hexes.
export function radiusFor(target) {
  let radius = 2;
  while (0.9 * (3 * radius * radius + 3 * radius + 1) < target) radius++;
  return radius;
}

function isConnected(keys) {
  if (keys.size === 0) return true;
  const [first] = keys;
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighborKeys(cur)) {
      if (keys.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === keys.size;
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

/**
 * Generates a hexagon-shaped map of about CELLS_PER_PLAYER hexes per player,
 * with holes (chokepoints), difficulty 1–5 per hex and resource hexes.
 * Returns { radius, seed, cells, spawns } where `cells` is a
 * Map<key, {q, r, difficulty, resource}> (holes are simply absent) and
 * `spawns` holds one Town Hall key per player, spread evenly around the edge.
 */
export function generateMap(playerCount, seed = Date.now()) {
  const rand = mulberry32(seed);
  const target = CONFIG.CELLS_PER_PLAYER * playerCount;
  const radius = radiusFor(target);
  const origin = { q: 0, r: 0 };

  const all = new Set();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (distance(origin, { q, r }) <= radius) all.add(key(q, r));
    }
  }

  const ring = ringKeys(radius - 1);
  const offset = Math.floor(rand() * ring.length);
  const spawns = Array.from({ length: playerCount }, (_, i) => ring[(offset + Math.floor((i * ring.length) / playerCount)) % ring.length]);
  const spawnCoords = spawns.map(parseKey);
  const distToSpawn = (k) => Math.min(...spawnCoords.map((s) => distance(s, parseKey(k))));

  // Keep a safe zone around every Town Hall free of holes.
  const protectedKeys = new Set([...all].filter((k) => distToSpawn(k) <= 2));

  // Grow hole clusters while the walkable area stays connected.
  const cells = new Set(all);
  const targetHoles = Math.max(0, all.size - target);
  let holes = 0;
  let attempts = 0;
  while (holes < targetHoles && attempts < 2000) {
    attempts++;
    const candidates = [...cells].filter((k) => !protectedKeys.has(k));
    if (!candidates.length) break;
    const cluster = [pick(rand, candidates)];
    // Clusters of 2–5 make chokepoints; single holes fill the remainder when clusters no longer fit.
    const size = Math.min(targetHoles - holes, attempts > 500 ? 1 : 2 + Math.floor(rand() * 4));
    while (cluster.length < size) {
      const options = neighborKeys(pick(rand, cluster)).filter(
        (n) => cells.has(n) && !protectedKeys.has(n) && !cluster.includes(n),
      );
      if (!options.length) break;
      cluster.push(pick(rand, options));
    }
    cluster.forEach((k) => cells.delete(k));
    if (isConnected(cells)) {
      holes += cluster.length;
    } else {
      cluster.forEach((k) => cells.add(k));
    }
  }

  // Difficulty grows with distance from the nearest Town Hall (contested middle is hardest).
  const maxDist = Math.max(...[...cells].map(distToSpawn));
  const result = new Map();
  for (const k of cells) {
    const { q, r } = parseKey(k);
    const d = distToSpawn(k);
    let difficulty;
    if (d <= 1) {
      difficulty = 1;
    } else {
      const noise = rand() - 0.5;
      difficulty = Math.round(1 + (d / maxDist) * 4 + noise);
      difficulty = Math.max(1, Math.min(5, difficulty));
    }
    result.set(k, { q, r, difficulty, resource: null });
  }

  // Fairness: every player gets one gold and one wood hex 2–3 steps from home.
  for (const s of spawnCoords) {
    for (const type of ['gold', 'wood']) {
      const near = [...result.values()].filter((c) => {
        const d = distance(s, c);
        return d >= 2 && d <= 3 && !c.resource;
      });
      if (near.length) pick(rand, near).resource = type;
    }
  }
  // Extra resources scattered over the rest of the map.
  const extra = Math.floor(result.size * CONFIG.RESOURCE_RATIO) - spawns.length * 2;
  const free = [...result.values()].filter((c) => !c.resource && distToSpawn(key(c.q, c.r)) >= 3);
  for (let i = 0; i < extra && free.length; i++) {
    const idx = Math.floor(rand() * free.length);
    free.splice(idx, 1)[0].resource = i % 2 === 0 ? 'gold' : 'wood';
  }

  return { radius, seed, cells: result, spawns };
}
