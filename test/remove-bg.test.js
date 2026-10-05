import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { removeBackground } from '../tools/remove-bg.js';

test('removes a baked-in checkerboard background but keeps the sprite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-'));
  const squares = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      squares.push(`<rect x="${x * 16}" y="${y * 16}" width="16" height="16" fill="${(x + y) % 2 ? '#cccccc' : '#ffffff'}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">${squares.join('')}
    <circle cx="64" cy="64" r="40" fill="#2f6fe0"/><circle cx="64" cy="64" r="10" fill="#ffffff"/></svg>`;
  const input = join(dir, 'in.png');
  const output = join(dir, 'out.png');
  await sharp(Buffer.from(svg)).png().toFile(input);

  await removeBackground(input, output);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alpha(2, 2), 0, 'white square cleared');
  assert.equal(alpha(20, 2), 0, 'grey square cleared');
  assert.equal(alpha(64, 40), 255, 'sprite kept');
  assert.equal(alpha(64, 64), 255, 'enclosed white kept');
});
