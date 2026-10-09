import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../server/mapgen.js';
import { neighborKeys, distance, parseKey } from '../shared/hex.js';

function connected(cells) {
  const keys = [...cells.keys()];
  const seen = new Set([keys[0]]);
  const queue = [keys[0]];
  while (queue.length) {
    for (const n of neighborKeys(queue.shift())) {
      if (cells.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen.size === keys.length;
}

for (const players of [2, 3, 4, 5, 6, 7, 8]) {
  test(`map for ${players} players is valid and sized ~25 hexes per player`, () => {
    for (const seed of [1, 42, 1234, 99999]) {
      const map = generateMap(players, seed);
      assert.equal(map.spawns.length, players);
      assert.equal(new Set(map.spawns).size, players, 'distinct Town Halls');
      assert.ok(Math.abs(map.cells.size - 25 * players) <= 2.5 * players, `size ${map.cells.size}`);
      assert.ok(connected(map.cells), 'walkable area must be connected');
      const total = 3 * map.radius * (map.radius + 1) + 1;
      assert.ok(map.cells.size < total, 'map has holes');
      for (const s of map.spawns) {
        assert.ok(map.cells.has(s));
        for (const n of neighborKeys(s)) assert.ok(map.cells.has(n), 'start territory has no holes');
        const res = [...map.cells.values()].filter((c) => c.resource && distance(parseKey(s), c) <= 3);
        assert.ok(res.some((c) => c.resource === 'gold') && res.some((c) => c.resource === 'wood'));
      }
      // Start territories (hall + neighbours) never touch each other.
      for (let i = 0; i < players; i++) {
        for (let j = i + 1; j < players; j++) {
          assert.ok(distance(parseKey(map.spawns[i]), parseKey(map.spawns[j])) >= 3, 'bases spread apart');
        }
      }
      for (const c of map.cells.values()) assert.ok(c.difficulty >= 1 && c.difficulty <= 5);
    }
  });
}

test('map generation is deterministic per seed', () => {
  const a = generateMap(3, 7);
  const b = generateMap(3, 7);
  assert.deepEqual([...a.cells.entries()], [...b.cells.entries()]);
});
