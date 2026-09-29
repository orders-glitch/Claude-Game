// Procedurally painted textures. No external image assets are needed: everything is generated at load.
import * as THREE from 'three';
import { Simplex, mulberry32 } from './noise.js';

const cache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Tileable noise built from integer-frequency sinusoids (tiles perfectly).
function tileableField(size, waves, seed, minK = 1, maxK = 12, falloff = 1.0) {
  const rnd = mulberry32(seed);
  const comps = [];
  for (let i = 0; i < waves; i++) {
    const kx = Math.round((rnd() * 2 - 1) * maxK);
    const ky = Math.round((rnd() * 2 - 1) * maxK);
    const k = Math.hypot(kx, ky);
    if (k < minK) { i--; continue; }
    comps.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.pow(k, falloff)]);
  }
  const out = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  const tau = Math.PI * 2 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let c = 0; c < comps.length; c++) {
        const w = comps[c];
        v += Math.sin((w[0] * x + w[1] * y) * tau + w[2]) * w[3];
      }
      out[y * size + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const r = max - min;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / r;
  return out;
}

export function waterNormalTexture() {
  return memo('waterNormal', () => {
    const size = 256;
    const f = tileableField(size, 90, 7, 2, 22, 1.25);
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const strength = 6.0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = f[y * size + ((x - 1 + size) % size)];
        const r = f[y * size + ((x + 1) % size)];
        const u = f[((y - 1 + size) % size) * size + x];
        const d = f[((y + 1) % size) * size + x];
        let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { srgb: false });
  });
}

export function detailNoiseTexture() {
  return memo('detail', () => {
    const size = 256;
    const a = tileableField(size, 60, 3, 1, 8, 1.0);
    const b = tileableField(size, 80, 5, 8, 40, 0.8);
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      img.data[i * 4] = a[i] * 255;
      img.data[i * 4 + 1] = b[i] * 255;
      img.data[i * 4 + 2] = (a[i] * 0.5 + b[i] * 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { srgb: false });
  });
}

function grain(ctx, w, h, amount, seed = 1, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const rnd = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount * scale;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// Wood planking. `tone` is a CSS colour for the base timber.
export function woodTexture(tone = '#6b4a2e', key = 'wood') {
  return memo(key + tone, () => {
    const w = 256, h = 256;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const base = new THREE.Color(tone);
    const noise = new Simplex(9);
    const plank = 32;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / plank);
      const shade = 0.85 + ((row * 37) % 7) / 7 * 0.3;
      for (let x = 0; x < w; x++) {
        const grainN = noise.noise2(x * 0.01 + row * 13, y * 0.25) * 0.5 + noise.noise2(x * 0.05, y * 0.6 + row) * 0.25;
        let v = shade * (0.9 + grainN * 0.18);
        const seamY = y % plank;
        if (seamY < 2) v *= 0.45;
        const off = (row * 97) % w;
        if ((x + off) % 128 < 2) v *= 0.55;
        const i = (y * w + x) * 4;
        img.data[i] = Math.min(255, base.r * 255 * v);
        img.data[i + 1] = Math.min(255, base.g * 255 * v);
        img.data[i + 2] = Math.min(255, base.b * 255 * v);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c);
  });
}

export function canvasSailTexture(tint = '#e9e0c8', key = 'sail') {
  return memo(key + tint, () => {
    const w = 256, h = 256;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    // vertical cloth panels with seams
    for (let x = 0; x < w; x += 21) {
      ctx.fillStyle = `rgba(90,70,40,${0.08 + (x % 3) * 0.02})`;
      ctx.fillRect(x, 0, 1.5, h);
      ctx.fillStyle = `rgba(255,255,255,0.05)`;
      ctx.fillRect(x + 3, 0, 6, h);
    }
    // grime & weathering
    const n = new Simplex(4);
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = n.fbm(x * 0.012, y * 0.012, 4) * 0.5 + 0.5;
        const d = 1 - v * 0.22 - (y / h) * 0.08;
        const i = (y * w + x) * 4;
        img.data[i] *= d; img.data[i + 1] *= d; img.data[i + 2] *= d * 0.97;
      }
    }
    ctx.putImageData(img, 0, 0);
    // reef bands
    ctx.fillStyle = 'rgba(80,60,30,0.18)';
    for (let y = 40; y < h; y += 64) ctx.fillRect(0, y, w, 3);
    grain(ctx, w, h, 14, 3);
    return finish(c);
  });
}

export function stuccoTexture() {
  return memo('stucco', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const n = new Simplex(21);
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = 0.86 + n.fbm(x * 0.02, y * 0.02, 5) * 0.12 + n.noise2(x * 0.3, y * 0.3) * 0.03;
        const stain = Math.max(0, n.fbm(x * 0.008 + 5, y * 0.03, 3)) * (y / s) * 0.35;
        const i = (y * s + x) * 4;
        img.data[i] = 255 * (v - stain * 0.9);
        img.data[i + 1] = 255 * (v - stain);
        img.data[i + 2] = 255 * (v - stain * 1.1);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c);
  });
}

export function stoneTexture() {
  return memo('stone', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8f8676';
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(12);
    const rowH = 32;
    for (let y = 0; y < s; y += rowH) {
      const off = (y / rowH) % 2 ? 24 : 0;
      for (let x = -off; x < s; x += 48 + Math.floor(rnd() * 10)) {
        const g = 120 + rnd() * 40;
        ctx.fillStyle = `rgb(${g + 10},${g + 4},${g - 8})`;
        ctx.fillRect(x + 2, y + 2, 44, rowH - 4);
      }
    }
    grain(ctx, s, s, 40, 5);
    return finish(c);
  });
}

export function roofTileTexture() {
  return memo('rooftile', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9a4a2c';
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(33);
    for (let y = 0; y < s; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < s; x += 16) {
        const r = 150 + rnd() * 50, g = 70 + rnd() * 25, b = 40 + rnd() * 15;
        const grd = ctx.createLinearGradient(x, 0, x + 16, 0);
        grd.addColorStop(0, `rgb(${r * 0.6},${g * 0.6},${b * 0.6})`);
        grd.addColorStop(0.5, `rgb(${r},${g},${b})`);
        grd.addColorStop(1, `rgb(${r * 0.55},${g * 0.55},${b * 0.55})`);
        ctx.fillStyle = grd;
        ctx.fillRect(x + 1, y, 14, 15);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, y + 14, 16, 2);
      }
    }
    grain(ctx, s, s, 20, 6);
    return finish(c);
  });
}

export function thatchTexture() {
  return memo('thatch', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8c7648';
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(44);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s, y = rnd() * s;
      const l = 10 + rnd() * 20;
      const g = 100 + rnd() * 80;
      ctx.strokeStyle = `rgba(${g + 30},${g + 10},${g - 40},0.7)`;
      ctx.lineWidth = 1 + rnd();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y + l);
      ctx.stroke();
    }
    for (let y = 0; y < s; y += 32) {
      ctx.fillStyle = 'rgba(40,30,15,0.35)';
      ctx.fillRect(0, y, s, 3);
    }
    return finish(c);
  });
}

export function plasterClapboardTexture() {
  return memo('clapboard', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d8d0bc';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      const grd = ctx.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)');
      grd.addColorStop(0.2, 'rgba(255,255,255,0.05)');
      grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, y, s, 16);
    }
    grain(ctx, s, s, 24, 8);
    return finish(c);
  });
}

// ---------------------------------------------------------------- Flags (period accurate, 1716)
function drawSkull(ctx, cx, cy, s, color = '#f0ebe0') {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  // crossed bones
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.13;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.8, cy + s * 0.25); ctx.lineTo(cx + s * 0.8, cy + s * 1.05);
  ctx.moveTo(cx + s * 0.8, cy + s * 0.25); ctx.lineTo(cx - s * 0.8, cy + s * 1.05);
  ctx.stroke();
  for (const [bx, by] of [[-0.8, 0.25], [0.8, 1.05], [0.8, 0.25], [-0.8, 1.05]]) {
    ctx.beginPath(); ctx.arc(cx + bx * s - s * 0.05, cy + by * s, s * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + bx * s + s * 0.05, cy + by * s + s * 0.07, s * 0.09, 0, Math.PI * 2); ctx.fill();
  }
  // cranium
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.46, s * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - s * 0.26, cy + s * 0.2, s * 0.52, s * 0.35);
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(cx - s * 0.17, cy + s * 0.02, s * 0.12, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + s * 0.17, cy + s * 0.02, s * 0.12, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.14); ctx.lineTo(cx - s * 0.06, cy + s * 0.27); ctx.lineTo(cx + s * 0.06, cy + s * 0.27); ctx.fill();
  for (let i = -2; i <= 2; i++) ctx.fillRect(cx + i * s * 0.1 - 1, cy + s * 0.38, 2, s * 0.17);
}

export function flagTexture(kind) {
  return memo('flag_' + kind, () => {
    const w = 256, h = 160;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    if (kind === 'britain') {
      // Red Ensign of 1707: red field, Union (St George over St Andrew) canton.
      ctx.fillStyle = '#b3201f'; ctx.fillRect(0, 0, w, h);
      const cw = w * 0.5, ch = h * 0.5;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
      ctx.fillStyle = '#1b2d6b'; ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = ch * 0.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cw, ch); ctx.moveTo(cw, 0); ctx.lineTo(0, ch); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cw / 2 - ch * 0.17, 0, ch * 0.34, ch); ctx.fillRect(0, ch / 2 - ch * 0.17, cw, ch * 0.34);
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(cw / 2 - ch * 0.1, 0, ch * 0.2, ch); ctx.fillRect(0, ch / 2 - ch * 0.1, cw, ch * 0.2);
      ctx.restore();
    } else if (kind === 'spain') {
      // Cross of Burgundy: ragged red saltire on white.
      ctx.fillStyle = '#f2eee2'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#b21f24'; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(20, 16); ctx.lineTo(w - 20, h - 16); ctx.moveTo(w - 20, 16); ctx.lineTo(20, h - 16); ctx.stroke();
      ctx.lineWidth = 8;
      for (let i = 1; i < 8; i++) {
        const t = i / 8;
        for (const [ax, ay, bx, by] of [[20, 16, w - 20, h - 16], [w - 20, 16, 20, h - 16]]) {
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (i % 2 ? 12 : -12), y - 12); ctx.stroke();
        }
      }
    } else if (kind === 'france') {
      // Royal French white ensign, sown with gold fleurs-de-lis.
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9a23a';
      for (let y = 20; y < h; y += 44) for (let x = (y / 44) % 2 ? 44 : 22; x < w; x += 56) {
        ctx.beginPath(); ctx.ellipse(x, y, 5, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x - 8, y + 2, 4, 8, -0.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 8, y + 2, 4, 8, 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - 9, y + 6, 18, 3);
      }
    } else if (kind === 'dutch') {
      // Prinsenvlag-descended tricolour, red-white-blue by 1716.
      ctx.fillStyle = '#ae1c28'; ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#f5f3ee'; ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#21468b'; ctx.fillRect(0, (h * 2) / 3, w, h / 3);
    } else if (kind === 'pirate' || kind === 'player') {
      ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, w, h);
      drawSkull(ctx, w / 2, h * 0.3, 56);
    } else if (kind === 'white') {
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
    }
    // weathering
    grain(ctx, w, h, 22, 2);
    const t = finish(c, { repeat: false });
    return t;
  });
}

// Parchment for UI / map.
export function parchmentCanvas(w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const n = new Simplex(77);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = n.fbm(x * 0.006, y * 0.006, 5) * 0.5 + 0.5;
      const edge = Math.min(x, y, w - x, h - y) / Math.min(w, h);
      const burn = Math.max(0, 0.08 - edge) * 6;
      const k = 0.88 + v * 0.14 - burn;
      const i = (y * w + x) * 4;
      img.data[i] = 232 * k; img.data[i + 1] = 214 * k; img.data[i + 2] = 172 * k; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function smokeSpriteTexture() {
  return memo('smoke', () => {
    const s = 128;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const n = new Simplex(99);
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = x / s - 0.5, dy = y / s - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const f = n.fbm(x * 0.04, y * 0.04, 4) * 0.5 + 0.5;
        const a = Math.max(0, 1 - d) ** 1.5 * (0.5 + f * 0.7);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { repeat: false });
  });
}

export function glowSpriteTexture() {
  return memo('glow', () => {
    const s = 64;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,240,200,0.8)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return finish(c, { repeat: false });
  });
}

export function windowTexture() {
  return memo('window', () => {
    const w = 64, h = 96;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a1e14'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1612'; ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = '#3d2b1b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w / 2, 6); ctx.lineTo(w / 2, h - 6); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    return finish(c, { repeat: false });
  });
}
