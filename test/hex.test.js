import test from 'node:test';
import assert from 'node:assert/strict';
import { key, parseKey, neighbors, distance, hexToPixel, pixelToHex, findPath } from '../shared/hex.js';

test('neighbors are all at distance 1', () => {
  for (const n of neighbors(2, -1)) assert.equal(distance({ q: 2, r: -1 }, n), 1);
  assert.equal(new Set(neighbors(0, 0).map((n) => key(n.q, n.r))).size, 6);
});

test('pixel conversion round-trips', () => {
  for (const [q, r] of [[0, 0], [3, -2], [-4, 5], [7, 1]]) {
    const { x, y } = hexToPixel(q, r, 30);
    assert.deepEqual(pixelToHex(x + 3, y - 4, 30), { q, r });
  }
});

test('findPath avoids impassable hexes and returns null when blocked', () => {
  const open = new Set(['0,0', '1,0', '1,-1', '2,-1', '3,-1', '3,0']);
  const path = findPath('0,0', '4,0', (k) => open.has(k) && k !== '2,0');
  assert.equal(path[0], '0,0');
  assert.equal(path.at(-1), '4,0');
  for (let i = 1; i < path.length; i++) assert.equal(distance(parseKey(path[i - 1]), parseKey(path[i])), 1);
  assert.equal(findPath('0,0', '9,9', (k) => open.has(k)), null);
});
