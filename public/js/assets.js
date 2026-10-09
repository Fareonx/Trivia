// Sprite loading and per-player tinting.
//
// Every sprite paints its team-coloured parts in BLUE. Once at load time we
// copy each sprite into an offscreen canvas per player colour and rotate only
// the blue hues to that colour. Grey armour, brown wood and gold stay as they
// are, and nothing is recomputed per frame (no ctx.filter in the render loop).
//
// To use your own art: drop a transparent PNG into /assets (see
// tools/remove-bg.js) with team parts in blue, and change the path below.

export const ASSET_FILES = {
  knight: 'assets/knight.svg',
  townhall: 'assets/townhall.svg',
  gold: 'assets/gold.svg',
  wood: 'assets/wood.svg',
};

const TINTED = ['knight', 'townhall'];

export const TEAM_COLORS = {
  blue: { hue: 220, css: '#2f6fe0' },
  red: { hue: 0, css: '#d93a3a' },
  green: { hue: 130, css: '#2fa84f' },
  yellow: { hue: 46, css: '#e0b52f' },
  purple: { hue: 280, css: '#8e44ad' },
  orange: { hue: 26, css: '#e67e22' },
  teal: { hue: 172, css: '#16a085' },
  pink: { hue: 330, css: '#e84393' },
};

// Hues counted as "team colour" in the source art.
const TEAM_HUE_MIN = 185;
const TEAM_HUE_MAX = 255;
const TEAM_MIN_SATURATION = 0.25;
// Sprites are rasterised at this size; draw calls scale them down.
const RASTER_SIZE = 256;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function rasterize(img) {
  const canvas = document.createElement('canvas');
  const scale = RASTER_SIZE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  canvas.width = Math.round((img.naturalWidth || img.width) * scale);
  canvas.height = Math.round((img.naturalHeight || img.height) * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Grey, faded copy used for captured capitals.
function ruin(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = Math.round(0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) * 0.8;
    px[i] = grey; px[i + 1] = grey; px[i + 2] = grey;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function tint(source, hue) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < TEAM_MIN_SATURATION || h < TEAM_HUE_MIN || h > TEAM_HUE_MAX) continue;
    const [r, g, b] = hslToRgb(hue, s, l);
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Loads all sprites. Returns { get(name, color?) → canvas }; color may also be 'ruin' for the Town Hall. */
export async function loadAssets() {
  const base = {};
  const tinted = {};
  await Promise.all(Object.entries(ASSET_FILES).map(async ([name, src]) => {
    base[name] = rasterize(await loadImage(src));
  }));
  for (const name of TINTED) {
    tinted[name] = {};
    for (const [color, { hue }] of Object.entries(TEAM_COLORS)) tinted[name][color] = tint(base[name], hue);
  }
  tinted.townhall.ruin = ruin(base.townhall);
  return {
    get(name, color) {
      return (color && tinted[name]?.[color]) || base[name];
    },
  };
}
