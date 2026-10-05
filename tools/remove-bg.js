#!/usr/bin/env node
// Makes the background of a sprite transparent.
//
//   node tools/remove-bg.js input.png output.png [--tolerance 32] [--trim]
//
// The background colours are sampled from the image border (up to two, so the
// fake grey/white "transparency checkerboard" baked into many AI-generated
// images is handled too). A flood fill from the border clears every connected
// pixel close to those colours; enclosed areas of the same colour inside the
// sprite are kept. Edge pixels get partial alpha for a softer outline.

import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

function parseArgs(argv) {
  const args = { tolerance: 32, trim: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tolerance') args.tolerance = Number(argv[++i]);
    else if (argv[i] === '--trim') args.trim = true;
    else args.files.push(argv[i]);
  }
  return args;
}

function colorDistance(px, i, c) {
  const dr = px[i] - c[0];
  const dg = px[i + 1] - c[1];
  const db = px[i + 2] - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// The one or two most common (quantised) colours along the border.
function borderColors(px, width, height) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    if (px[i + 3] === 0) return;
    const q = [px[i] >> 3, px[i + 1] >> 3, px[i + 2] >> 3].join(',');
    const entry = counts.get(q) ?? { n: 0, sum: [0, 0, 0] };
    entry.n++;
    entry.sum[0] += px[i]; entry.sum[1] += px[i + 1]; entry.sum[2] += px[i + 2];
    counts.set(q, entry);
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
  const total = [...counts.values()].reduce((s, e) => s + e.n, 0);
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .filter((e, idx) => idx === 0 || e.n / total > 0.1)
    .map((e) => e.sum.map((v) => v / e.n));
}

export async function removeBackground(input, output, { tolerance = 32, trim = false } = {}) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = data;
  const refs = borderColors(px, width, height);
  const distToBg = (i) => Math.min(...refs.map((c) => colorDistance(px, i, c)));

  const bg = new Uint8Array(width * height);
  const stack = [];
  const seed = (x, y) => {
    const p = y * width + x;
    if (!bg[p] && (px[p * 4 + 3] === 0 || distToBg(p * 4) <= tolerance)) {
      bg[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) seed(x - 1, y);
    if (x < width - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < height - 1) seed(x, y + 1);
  }

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (bg[p]) {
      px[i + 3] = 0;
      continue;
    }
    // Soften the outline: foreground pixels touching the background that are
    // still close-ish to the background colour become semi-transparent.
    const x = p % width;
    const y = (p - x) / width;
    const touchesBg = (x > 0 && bg[p - 1]) || (x < width - 1 && bg[p + 1])
      || (y > 0 && bg[p - width]) || (y < height - 1 && bg[p + width]);
    if (touchesBg) {
      const t = Math.min(1, Math.max(0.35, (distToBg(i) - tolerance) / tolerance));
      px[i + 3] = Math.round(px[i + 3] * t);
    }
  }

  let img = sharp(px, { raw: { width, height, channels: 4 } });
  if (trim) img = sharp(await img.png().toBuffer()).trim();
  await img.png().toFile(output);
  return { width, height, backgroundColors: refs.map((c) => c.map(Math.round)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length !== 2) {
    console.error('Usage: node tools/remove-bg.js input.png output.png [--tolerance 32] [--trim]');
    process.exit(1);
  }
  const [input, output] = args.files;
  const res = await removeBackground(input, output, args);
  console.log(`Saved ${output} (${res.width}×${res.height}), background: ${JSON.stringify(res.backgroundColors)}`);
}
