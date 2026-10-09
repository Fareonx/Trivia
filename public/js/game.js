// Canvas map renderer and input for Zəka Döyüşü.
//
// Draw order (back to front):
//   1. terrain cache: grey hexes by difficulty + owner tint + borders
//      (re-rendered only when ownership or zoom changes)
//   2. attackable-hex hints, hover, locks, busy/duel timers
//   3. resources
//   4. Town Halls (or ruins) and Knights, sorted by y so lower sprites overlap upper ones
//   5. short-lived effects (capture flash, fail cross, dust, upgrade stars) and duel/question timers

import { hexToPixel, pixelToHex, hexCorners, neighborKeys, key as hexKey } from '/shared/hex.js';
import { TEAM_COLORS } from './assets.js';

const HEX_SIZE = 36;
const DIFFICULTY_GREYS = ['#d4d7db', '#b3b8be', '#92989f', '#727880', '#545a62'];
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.2;
const EFFECT_MS = { capture: 700, fail: 600, arrive: 450, upgrade: 900, death: 1200 };

export class GameView {
  constructor(canvas, { assets, serverNow, onCellClick, onStep = () => {}, categoryIcon = () => '' }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.serverNow = serverNow;
    this.onCellClick = onCellClick;
    this.onStep = onStep;
    this.categoryIcon = categoryIcon;
    this.effects = [];
    this.lastStep = null;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.state = null;
    this.cells = new Map();
    this.players = new Map();
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.centered = false;
    this.hover = null;
    this.terrain = null;
    this.terrainKey = '';
    this.dpr = 1;

    this.bindInput();
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setState(state) {
    this.state = state;
    this.cells = new Map(state.cells.map((c) => [c.key, c]));
    this.players = new Map(state.players.map((p) => [p.id, p]));
    this.me = this.players.get(state.you);
    if (!this.centered && this.me) {
      const c = this.cells.get(this.me.townHall);
      const p = hexToPixel(c.q, c.r, HEX_SIZE);
      // Start centred on our own Town Hall.
      this.camera = { x: p.x, y: p.y, zoom: 1 };
      this.centered = true;
    }
  }

  /** Starts a short animation on a hex: 'capture' | 'fail' | 'arrive' | 'upgrade'. */
  effect(type, key, { color = '#ffffff' } = {}) {
    if (!this.cells.has(key)) return;
    this.effects.push({ type, key, color, start: performance.now(), duration: EFFECT_MS[type] ?? 600 });
  }

  // ------------------------------------------------------------------ input

  bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cam: { ...this.camera }, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      this.hover = this.cellAt(e.clientX, e.clientY);
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (drag.moved) {
        this.camera.x = drag.cam.x - dx / this.camera.zoom;
        this.camera.y = drag.cam.y - dy / this.camera.zoom;
        c.style.cursor = 'grabbing';
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const cell = this.cellAt(e.clientX, e.clientY);
        if (cell) this.onCellClick(cell);
      }
      drag = null;
      c.style.cursor = 'grab';
    });
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.screenToWorld(e.clientX, e.clientY);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.camera.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.camera.zoom = zoom;
      const after = this.screenToWorld(e.clientX, e.clientY);
      this.camera.x += before.x - after.x;
      this.camera.y += before.y - after.y;
    }, { passive: false });
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
    this.terrainKey = '';
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - rect.width / 2) / this.camera.zoom + this.camera.x,
      y: (sy - rect.top - rect.height / 2) / this.camera.zoom + this.camera.y,
    };
  }

  cellAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const { q, r } = pixelToHex(w.x, w.y, HEX_SIZE);
    return this.cells.get(hexKey(q, r)) ?? null;
  }

  // ------------------------------------------------------------------ rules mirrored for hints

  canTarget(cell, now) {
    const me = this.me;
    if (!me?.alive || me.knight.state !== 'idle' || this.state.phase !== 'playing') return false;
    if (cell.owner === me.id) return false;
    if ((this.state.locks[cell.key] ?? 0) > now) return false;
    if (this.state.engagements.some((e) => e.target === cell.key)) return false;
    return neighborKeys(cell.key).some((n) => this.cells.get(n)?.owner === me.id);
  }

  // ------------------------------------------------------------------ drawing helpers

  center(k) {
    const c = this.cells.get(k);
    return hexToPixel(c.q, c.r, HEX_SIZE);
  }

  hexPath(ctx, cx, cy, size) {
    const pts = hexCorners(cx, cy, size);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  colorOf(playerId) {
    const p = this.players.get(playerId);
    return p ? TEAM_COLORS[p.color].css : '#888';
  }

  knightPosition(player, now) {
    const k = player.knight;
    if (k.state === 'moving' && k.path?.length > 1) {
      const step = this.state.config.moveMsPerHex;
      const t = Math.max(0, now - k.moveStart) / step;
      const i = Math.min(k.path.length - 2, Math.floor(t));
      const f = Math.min(1, t - i);
      const a = this.center(k.path[i]);
      const b = this.center(k.path[i + 1]);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, moving: true, step: Math.floor(t), f };
    }
    return { ...this.center(k.at), moving: false };
  }

  // Terrain changes rarely; render it once into an offscreen canvas.
  buildTerrain() {
    const zoom = this.camera.zoom * this.dpr;
    const signature = `${zoom.toFixed(2)}|${this.state.cells.map((c) => `${c.key}:${c.owner ?? '-'}:${c.category}`).join(',')}`;
    if (signature === this.terrainKey) return;
    this.terrainKey = signature;

    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const c of this.cells.values()) {
      const p = hexToPixel(c.q, c.r, HEX_SIZE);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = HEX_SIZE * 1.2;
    const bounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    const canvas = this.terrain?.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil(bounds.w * zoom);
    canvas.height = Math.ceil(bounds.h * zoom);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(zoom, 0, 0, zoom, -bounds.x * zoom, -bounds.y * zoom);
    ctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);

    for (const c of this.cells.values()) {
      const { x, y } = hexToPixel(c.q, c.r, HEX_SIZE);
      this.hexPath(ctx, x, y, HEX_SIZE - 1);
      ctx.fillStyle = DIFFICULTY_GREYS[c.difficulty - 1];
      ctx.fill();
      if (c.owner) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = this.colorOf(c.owner);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = '#2a2f37';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Question category icon at the top of the hex (part of the cached layer, so emoji are drawn rarely).
      if (c.category && !c.townHallOf) {
        ctx.font = '15px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.categoryIcon(c.category), x, y - HEX_SIZE * 0.5);
      }
      // Difficulty pips at the bottom of the hex.
      ctx.fillStyle = '#1b1f2699';
      for (let i = 0; i < c.difficulty; i++) {
        ctx.beginPath();
        ctx.arc(x + (i - (c.difficulty - 1) / 2) * 6, y + HEX_SIZE * 0.62, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Thick borders where territory changes hands.
    const corners = hexCorners(0, 0, HEX_SIZE - 2);
    // Edge i of a pointy-top hex faces neighbour direction EDGE_DIR[i].
    const EDGE_DIR = [0, 5, 4, 3, 2, 1];
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const c of this.cells.values()) {
      if (!c.owner) continue;
      const { x, y } = hexToPixel(c.q, c.r, HEX_SIZE);
      const ns = neighborKeys(c.key);
      ctx.strokeStyle = this.colorOf(c.owner);
      for (let i = 0; i < 6; i++) {
        const n = this.cells.get(ns[EDGE_DIR[i]]);
        if (n && n.owner === c.owner) continue;
        const a = corners[i];
        const b = corners[(i + 1) % 6];
        ctx.beginPath();
        ctx.moveTo(x + a.x, y + a.y);
        ctx.lineTo(x + b.x, y + b.y);
        ctx.stroke();
      }
    }
    this.terrain = { canvas, bounds };
  }

  drawSprite(img, x, y, height) {
    const w = (img.width / img.height) * height;
    this.ctx.drawImage(img, x - w / 2, y - height, w, height);
  }

  drawBadge(x, y, text, bg) {
    const ctx = this.ctx;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  // ------------------------------------------------------------------ frame

  draw() {
    const ctx = this.ctx;
    // The canvas may have been created while its screen was hidden (size 0).
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * (window.devicePixelRatio || 1))) this.resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b1f26';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.state) return;
    const now = this.serverNow();
    const { zoom } = this.camera;

    this.buildTerrain();
    const s = zoom * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.canvas.width / 2 - this.camera.x * s, this.canvas.height / 2 - this.camera.y * s);
    const t = this.terrain;
    ctx.drawImage(t.canvas, t.bounds.x, t.bounds.y, t.bounds.w, t.bounds.h);

    // Attackable hexes for our idle knight.
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffffb0';
    for (const c of this.cells.values()) {
      if (!this.canTarget(c, now)) continue;
      const { x, y } = this.center(c.key);
      this.hexPath(ctx, x, y, HEX_SIZE - 6);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (this.hover) {
      const { x, y } = this.center(this.hover.key);
      this.hexPath(ctx, x, y, HEX_SIZE - 3);
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.canTarget(this.hover, now) ? '#ffffff' : '#e5484d99';
      ctx.stroke();
    }

    // Our own locked hexes are darkened here; their countdown badge is drawn above the sprites.
    const locks = Object.entries(this.state.locks).filter(([k, until]) => until > now && this.cells.has(k));
    for (const [k] of locks) {
      const { x, y } = this.center(k);
      this.hexPath(ctx, x, y, HEX_SIZE - 1);
      ctx.fillStyle = '#00000066';
      ctx.fill();
    }

    // Path preview for our walking knight.
    const myKnight = this.me?.knight;
    if (myKnight?.state === 'moving' && myKnight.path) {
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.colorOf(this.me.id);
      ctx.beginPath();
      myKnight.path.forEach((k, i) => {
        const p = this.center(k);
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Resources.
    for (const c of this.cells.values()) {
      if (!c.resource) continue;
      const { x, y } = this.center(c.key);
      this.drawSprite(this.assets.get(c.resource), x - HEX_SIZE * 0.42, y + HEX_SIZE * 0.25, HEX_SIZE * 0.6);
    }

    // Town Halls and Knights, sorted by y.
    const sprites = [];
    for (const c of this.cells.values()) {
      if (c.ruin) {
        const { x, y } = this.center(c.key);
        sprites.push({ y: y + HEX_SIZE * 0.55, draw: () => {
          ctx.globalAlpha = 0.6;
          this.drawSprite(this.assets.get('townhall', 'ruin'), x, y + HEX_SIZE * 0.55, HEX_SIZE * 1.5);
          ctx.globalAlpha = 1;
        } });
      }
      if (!c.townHallOf) continue;
      const owner = this.players.get(c.townHallOf);
      const { x, y } = this.center(c.key);
      sprites.push({ y: y + HEX_SIZE * 0.55, draw: () => {
        this.drawSprite(this.assets.get('townhall', owner.color), x, y + HEX_SIZE * 0.55, HEX_SIZE * 1.75);
        this.drawBadge(x, y - HEX_SIZE * 1.3, '★'.repeat(owner.townHallLevel), '#1b1f26c0');
      } });
    }
    const perHex = new Map();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.knight.state === 'respawning') {
        // Fallen knight: countdown next to its Town Hall until it returns.
        const hall = this.center(p.townHall);
        sprites.push({ y: hall.y + HEX_SIZE, draw: () => {
          this.drawBadge(hall.x + HEX_SIZE * 0.55, hall.y + HEX_SIZE * 0.35, `💀 ${formatSeconds(p.knight.respawnAt - now)}`, '#1b1f26d0');
        } });
        continue;
      }
      const pos = this.knightPosition(p, now);
      const slot = pos.moving ? 0 : (perHex.get(p.knight.at) ?? 0);
      if (!pos.moving) perHex.set(p.knight.at, slot + 1);
      // Standing on a Town Hall: step in front of it (lower right) so it stays visible.
      const onHall = !pos.moving && this.cells.get(p.knight.at)?.townHallOf;
      const dx = (onHall ? HEX_SIZE * 0.5 : 0) + (slot ? HEX_SIZE * 0.4 * (slot % 2 ? 1 : -1) : 0);
      const baseY = pos.y + HEX_SIZE * (onHall ? 0.75 : 0.5);
      // Two little hops per hex while walking.
      const bob = pos.moving && !this.reducedMotion ? Math.abs(Math.sin(pos.f * Math.PI * 2)) * 4 : 0;
      if (p.id === this.me?.id) this.trackSteps(pos);
      sprites.push({ y: baseY, draw: () => {
        this.drawSprite(this.assets.get('knight', p.color), pos.x + dx, baseY - bob, HEX_SIZE * 1.25);
      } });
    }
    sprites.sort((a, b) => a.y - b.y).forEach((sp) => sp.draw());

    this.drawEffects();

    // Lock countdowns on top of everything, so a Town Hall sprite cannot hide them.
    for (const [k, until] of locks) {
      const { x, y } = this.center(k);
      const onHall = this.cells.get(k).townHallOf;
      this.drawBadge(x, y - (onHall ? HEX_SIZE * 1.75 : 4), `🔒 ${formatSeconds(until - now)}`, '#e5484dd0');
    }

    // Busy hexes: duel / question timers, visible to everyone.
    for (const e of this.state.engagements) {
      const { x, y } = this.center(e.target);
      const label = e.phase === 'waiting' ? `⏳ ${formatSeconds(e.deadline - now)}`
        : `${e.duel ? '⚔ ' : '❓ '}${formatSeconds(e.deadline - now)}`;
      if (e.duel && e.phase === 'question' && !this.reducedMotion) {
        // Pulsing crossed swords above a running duel.
        const pulse = 1 + 0.15 * Math.sin(now / 150);
        ctx.font = `${Math.round(22 * pulse)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚔️', x, y - HEX_SIZE * 1.5);
      }
      this.drawBadge(x, y - HEX_SIZE * 0.95, label, e.duel ? '#b5179ed0' : '#1b1f26d0');
    }
  }

  // Footstep callback each time our own knight enters a new hex.
  trackSteps(pos) {
    if (!pos.moving) {
      this.lastStep = null;
      return;
    }
    if (this.lastStep !== null && pos.step > this.lastStep) this.onStep();
    this.lastStep = pos.step;
  }

  drawEffects() {
    const ctx = this.ctx;
    const t = performance.now();
    this.effects = this.effects.filter((e) => t - e.start < e.duration);
    for (const e of this.effects) {
      const p = (t - e.start) / e.duration;
      const { x, y } = this.center(e.key);
      ctx.save();
      if (e.type === 'capture') {
        this.hexPath(ctx, x, y, HEX_SIZE - 1);
        ctx.globalAlpha = 0.75 * (1 - p);
        ctx.fillStyle = e.color;
        ctx.fill();
        if (!this.reducedMotion) {
          this.hexPath(ctx, x, y, HEX_SIZE * (1 + p));
          ctx.globalAlpha = 1 - p;
          ctx.lineWidth = 4;
          ctx.strokeStyle = e.color;
          ctx.stroke();
        }
      } else if (e.type === 'fail') {
        const shake = this.reducedMotion ? 0 : Math.sin(p * 40) * 4 * (1 - p);
        ctx.globalAlpha = 1 - p * p;
        ctx.strokeStyle = '#e5484d';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        const r = HEX_SIZE * 0.4;
        ctx.beginPath();
        ctx.moveTo(x + shake - r, y - r);
        ctx.lineTo(x + shake + r, y + r);
        ctx.moveTo(x + shake + r, y - r);
        ctx.lineTo(x + shake - r, y + r);
        ctx.stroke();
      } else if (e.type === 'arrive') {
        ctx.fillStyle = '#d8d2c4';
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (0.8 + (i / 4) * 1.4);
          const d = HEX_SIZE * (0.2 + 0.5 * p);
          ctx.globalAlpha = 0.6 * (1 - p);
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * d, y + HEX_SIZE * 0.5 - Math.abs(Math.sin(a)) * d * 0.3, 3 + 4 * p, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.type === 'death') {
        ctx.font = '26px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1 - p;
        ctx.fillText('💀', x, y - HEX_SIZE * 0.2 - (this.reducedMotion ? 0 : p * HEX_SIZE * 0.8));
      } else if (e.type === 'upgrade') {
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f2c84b';
        ctx.globalAlpha = 1 - p;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const d = HEX_SIZE * (0.3 + 1.2 * p);
          ctx.fillText('★', x + Math.cos(a) * d, y - HEX_SIZE * 0.4 + Math.sin(a) * d);
        }
      }
      ctx.restore();
    }
  }
}

function formatSeconds(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
