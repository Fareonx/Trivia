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

// Which corners of the hexagon each player count spawns on.
const SPAWN_CORNERS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4] };

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
 * Generates a hexagon-shaped map with holes (chokepoints), difficulty 1–5 per
 * hex and resource hexes. Returns { radius, seed, cells, spawns } where
 * `cells` is a Map<key, {q, r, difficulty, resource}> (holes are simply absent)
 * and `spawns` holds one Town Hall key per player.
 */
export function generateMap(playerCount, seed = Date.now()) {
  const rand = mulberry32(seed);
  const radius = CONFIG.MAP_RADIUS_BY_PLAYERS[playerCount] ?? CONFIG.MAP_RADIUS_BY_PLAYERS[4];
  const origin = { q: 0, r: 0 };

  const all = new Set();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (distance(origin, { q, r }) <= radius) all.add(key(q, r));
    }
  }

  const spawnRing = radius - 1;
  const spawns = SPAWN_CORNERS[playerCount].map((i) => key(DIRECTIONS[i].q * spawnRing, DIRECTIONS[i].r * spawnRing));
  const spawnCoords = spawns.map(parseKey);
  const distToSpawn = (k) => Math.min(...spawnCoords.map((s) => distance(s, parseKey(k))));

  // Keep a safe zone around every Town Hall free of holes.
  const protectedKeys = new Set([...all].filter((k) => distToSpawn(k) <= 2));

  // Grow hole clusters while the walkable area stays connected.
  const cells = new Set(all);
  const targetHoles = Math.floor(all.size * CONFIG.HOLE_RATIO);
  let holes = 0;
  let attempts = 0;
  while (holes < targetHoles && attempts < 500) {
    attempts++;
    const candidates = [...cells].filter((k) => !protectedKeys.has(k));
    if (!candidates.length) break;
    const cluster = [pick(rand, candidates)];
    const size = 2 + Math.floor(rand() * 4);
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
