#!/usr/bin/env node
'use strict';
/**
 * Generador random de NFTs: flores pixel art de 100x100 px.
 * Sin dependencias: encoder PNG propio (zlib nativo de Node).
 *
 *   node generate.js --count 20 --out ./output --seed nftlnet
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------------------------------------------------------- PRNG ---- */
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFrom = (seed) => mulberry32(hashSeed(String(seed))());

/* -------------------------------------------------------------- colores --- */
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const P = (name, weight, c) => ({
  name,
  weight,
  petalLight: hex(c[0]),
  petalMid: hex(c[1]),
  petalDark: hex(c[2]),
  centerLight: hex(c[3]),
  centerDark: hex(c[4]),
  stem: hex(c[5]),
  stemDark: hex(c[6]),
  bg: hex(c[7]),
  bgAlt: hex(c[8]),
  accent: hex(c[9]),
});

const PALETTES = [
  P('Rosa Neón', 18, ['#ff9ecb', '#ff4fa3', '#b3195f', '#ffe066', '#c9911a', '#3ddc84', '#1e8449', '#2b1b3d', '#4a2c63', '#ffd6ea']),
  P('Girasol', 16, ['#ffe873', '#ffc93c', '#c98a00', '#7a4a1e', '#3f2410', '#5ec45e', '#2c7a2c', '#1b2a4a', '#33518a', '#fff3b0']),
  P('Cielo', 14, ['#bfe6ff', '#6ec6ff', '#1f6fc9', '#fff6cc', '#d3a021', '#68d18f', '#237a4a', '#10243b', '#1d4467', '#e8f6ff']),
  P('Lavanda', 13, ['#dcc4ff', '#b07cff', '#6a35c9', '#ffe9a8', '#c79a21', '#7fd6a0', '#2f8459', '#1a1230', '#38235c', '#f0e4ff']),
  P('Fuego', 11, ['#ffc07a', '#ff6b35', '#a82b12', '#ffe9b0', '#c98b18', '#6bbf59', '#2f7a30', '#25110c', '#4d1f14', '#ffd9a8']),
  P('Menta', 9, ['#ccfff0', '#66e5bd', '#12876a', '#fff0b8', '#c39a1e', '#5cc98f', '#238055', '#0e2723', '#1b4a41', '#e9fffa']),
  P('Sangre', 7, ['#ff8f8f', '#d92b2b', '#7a0d0d', '#ffe0a0', '#b3811a', '#4fae62', '#1f6b32', '#1a0d10', '#3b161c', '#ffc9c9']),
  P('Nieve', 6, ['#ffffff', '#dbe6f0', '#8fa3b8', '#ffd8ec', '#c4749f', '#8fd6a8', '#3f8f61', '#20303f', '#3d5468', '#ffffff']),
  P('Oro', 4, ['#fff3c4', '#ffcf40', '#a87a08', '#fff9e6', '#c9a227', '#c9b458', '#8a7420', '#241a05', '#4d3a0c', '#fffbe0']),
  P('Void', 2, ['#5b4d7a', '#2b2340', '#0d0a16', '#66fff0', '#0f8f86', '#3a3358', '#1b1830', '#050408', '#140f22', '#8dfff5']),
];

const SHAPES = {
  Redonda: { p: 0.7, inner: 0.46 },
  Puntiaguda: { p: 1.7, inner: 0.3 },
  Margarita: { p: 1.15, inner: 0.24 },
  Estrella: { p: 2.7, inner: 0.16 },
  Corazón: { p: 1.25, inner: 0.36, heart: true },
};

const G = 25; // grilla lógica (25 * 4 = 100 px)

/* ------------------------------------------------------------ generador --- */
function generate(seedStr) {
  const rand = rngFrom(seedStr);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const traits = [];
  let rarityScore = 0;

  function T(name, entries) {
    const tot = entries.reduce((s, e) => s + e[1], 0);
    let r = rand() * tot;
    let hit = entries[entries.length - 1];
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) { hit = e; break; }
    }
    const p = hit[1] / tot;
    const v = hit[0];
    traits.push({ trait_type: name, value: v && v.name ? v.name : v });
    rarityScore += 1 / p;
    return v;
  }

  const pal = T('Paleta', PALETTES.map((p) => [p, p.weight]));
  const petals = T('Pétalos', [[5, 26], [6, 20], [8, 14], [4, 11], [7, 10], [3, 7], [9, 6], [10, 6], [12, 5], [16, 3], [2, 2]]);
  const shapeName = T('Forma', [['Redonda', 30], ['Puntiaguda', 26], ['Margarita', 22], ['Estrella', 14], ['Corazón', 8]]);
  const center = T('Centro', [['Punto', 26], ['Anillo', 24], ['Relleno', 20], ['Espiral', 16], ['Cruz', 14]]);
  const stemStyle = T('Tallo', [['Recto', 34], ['Curva izquierda', 24], ['Curva derecha', 24], ['Doble', 10], ['Sin tallo', 8]]);
  const nLeaves = T('Hojas', [[2, 28], [1, 24], [3, 18], [4, 10], [0, 10], [5, 6], [6, 4]]);
  const bgStyle = T('Fondo', [['Plano', 26], ['Degradado', 24], ['Rayos', 18], ['Cuadros', 16], ['Estrellado', 12], ['Marco', 4]]);
  const aura = T('Aura', [['Ninguna', 60], ['Brillo', 26], ['Chispas', 10], ['Halo doble', 4]]);
  const outline = T('Contorno', [['Sí', 74], ['No', 26]]) === 'Sí';

  const shape = SHAPES[shapeName];
  const col = new Array(G * G).fill(null);
  const mask = new Uint8Array(G * G); // 0 fondo | 1 pétalo | 2 tallo/hoja | 3 centro | 4 contorno | 5 aura
  const put = (x, y, c, m) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= G || y >= G) return;
    col[y * G + x] = c;
    mask[y * G + x] = m;
  };

  const cx = 12, cy = 9;
  // corolas con muchos pétalos se estiran (pompón) y las de pocos se compactan
  const R = petals <= 3 ? 7.0 : petals <= 7 ? 7.6 : petals <= 10 ? 7.2 : 7.9;
  const rot = rand() * Math.PI * 2;
  // a más pétalos, exponente más agresivo: si no, se fusionan en un borrón
  const pExp = shape.p * (petals >= 12 ? 1.9 : petals >= 9 ? 1.35 : petals <= 3 ? 1.4 : 1);
  const pIn = shape.inner * (petals >= 12 ? 0.8 : 1);
  const rAt = (th) => {
    const m = Math.pow(Math.abs(Math.cos((petals * (th - rot)) / 2)), pExp);
    let r = R * (pIn + (1 - pIn) * m);
    if (shape.heart && m > 0.93) r *= 0.76;
    return r;
  };

  /* fondo */
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let c;
      switch (bgStyle) {
        case 'Degradado':
          c = mix(pal.bg, pal.bgAlt, y / (G - 1));
          break;
        case 'Rayos': {
          const k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 6));
          c = k % 2 === 0 ? pal.bg : mix(pal.bg, pal.bgAlt, 0.6);
          break;
        }
        case 'Cuadros':
          c = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0 ? pal.bg : mix(pal.bg, pal.bgAlt, 0.5);
          break;
        case 'Marco':
          c = x < 2 || y < 2 || x >= G - 2 || y >= G - 2 ? pal.bgAlt : pal.bg;
          break;
        default:
          c = mix(pal.bg, pal.bgAlt, Math.min(1, d / 18) * 0.45);
      }
      col[y * G + x] = c;
    }
  }
  if (bgStyle === 'Estrellado') {
    const n = ri(7, 15);
    for (let i = 0; i < n; i++) {
      const x = ri(0, G - 1), y = ri(0, G - 1), i0 = y * G + x;
      col[i0] = mix(col[i0], pal.accent, 0.75);
    }
  }

  /* tallo + hojas */
  const y0 = Math.round(cy + R * 0.55);
  if (stemStyle !== 'Sin tallo') {
    const dir = stemStyle === 'Curva izquierda' ? -1 : stemStyle === 'Curva derecha' ? 1 : 0;
    const amp = dir ? ri(2, 3) : 0;
    const y1 = G - 1;
    const sx = (y) => cx + Math.round(dir * amp * Math.pow((y - y0) / (y1 - y0), 1.6));
    for (let y = y0; y <= y1; y++) {
      put(sx(y), y, pal.stem, 2);
      put(sx(y) + 1, y, pal.stemDark, 2);
    }
    if (stemStyle === 'Doble') {
      // rama lateral con capullo, siempre por debajo de la corola
      const side = rand() < 0.5 ? -1 : 1;
      const by = ri(G - 7, G - 5);
      for (let k = 1; k <= 3; k++) put(sx(by) + side * k, by - Math.floor(k / 2), pal.stem, 2);
      const bx = sx(by) + side * 4, byy = by - 2;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(bx + ox * side, byy + oy, pal.petalMid, 2);
      put(bx, byy - 1, pal.petalLight, 2);
      put(bx + side, byy - 1, pal.petalDark, 2);
    }

    // hoja de dos filas: fila superior clara, fila inferior oscura
    const LEAF_S = [[2, -1, 0], [3, -1, 0], [1, 0, 1], [2, 0, 1]];
    const LEAF_L = [[2, -1, 0], [3, -1, 0], [4, -1, 0], [1, 0, 1], [2, 0, 1], [3, 0, 1]];
    const top = y0 + 2, bottom = G - 2;
    const step = nLeaves > 1 ? (bottom - top) / (nLeaves - 1) : 0;
    for (let i = 0; i < nLeaves; i++) {
      const ly = Math.min(bottom, Math.round(top + i * step) + (nLeaves <= 3 ? ri(0, 1) : 0));
      const side = i % 2 === 0 ? -1 : 1;
      const leaf = rand() < (nLeaves >= 5 ? 0.8 : 0.5) ? LEAF_S : LEAF_L;
      for (const [ox, oy, dark] of leaf) {
        put(sx(ly) + (side < 0 ? -ox : ox + 1), ly + oy, dark ? pal.stemDark : pal.stem, 2);
      }
    }
  }

  /* pétalos */
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R + 1) continue;
      const r = rAt(Math.atan2(dy, dx));
      if (d > r) continue;
      const t = r > 0 ? d / r : 1;
      let c = t > 0.8 ? pal.petalDark : t > 0.38 ? pal.petalLight : pal.petalMid;
      if (c === pal.petalLight && dx < 0 && dy < 0 && t > 0.45 && t < 0.78) c = mix(c, WHITE, 0.22);
      put(x, y, c, 1);
    }
  }

  /* centro */
  const cr = Math.max(2.1, R * 0.3);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > cr) continue;
      let c = pal.centerLight;
      switch (center) {
        case 'Punto': c = d <= cr * 0.45 ? pal.centerDark : pal.centerLight; break;
        case 'Anillo': c = d > cr * 0.6 ? pal.centerDark : pal.centerLight; break;
        case 'Relleno': c = d > cr * 0.85 ? pal.centerDark : pal.centerLight; break;
        case 'Espiral': {
          const a = Math.atan2(dy, dx);
          const k = Math.floor((a + Math.PI) / (Math.PI / 2)) + Math.floor(d);
          c = k % 2 === 0 ? pal.centerLight : pal.centerDark;
          break;
        }
        case 'Cruz': c = Math.abs(dx) <= 0.5 || Math.abs(dy) <= 0.5 ? pal.centerDark : pal.centerLight; break;
      }
      put(x, y, c, 3);
    }
  }

  /* contorno */
  if (outline) {
    const line = mix(pal.petalDark, BLACK, 0.6);
    const edge = [];
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        if (mask[y * G + x] !== 0) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => {
          const nx = x + ox, ny = y + oy;
          return nx >= 0 && ny >= 0 && nx < G && ny < G && mask[ny * G + nx] > 0 && mask[ny * G + nx] < 4;
        });
        if (near) edge.push(y * G + x);
      }
    }
    for (const i of edge) { col[i] = line; mask[i] = 4; }
  }

  /* aura */
  if (aura !== 'Ninguna') {
    const glow = [];
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        if (mask[y * G + x] !== 0) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (aura === 'Halo doble') {
          if (Math.abs(d - (R + 2.2)) < 0.6) glow.push([y * G + x, 0.55]);
          continue;
        }
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => {
          const nx = x + ox, ny = y + oy;
          return nx >= 0 && ny >= 0 && nx < G && ny < G && mask[ny * G + nx] > 0;
        });
        if (near && d < R + 3) glow.push([y * G + x, aura === 'Chispas' ? 0.0 : 0.32]);
      }
    }
    if (aura === 'Chispas') {
      const n = ri(3, 6);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = R + 1.8 + rand() * 2.2;
        const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
        for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const i0 = ny * G + nx;
          if (mask[i0] !== 0) continue;
          col[i0] = mix(col[i0], pal.accent, ox === 0 && oy === 0 ? 0.9 : 0.45);
          mask[i0] = 5;
        }
      }
    } else {
      for (const [i, t] of glow) { col[i] = mix(col[i], pal.accent, t); mask[i] = 5; }
    }
  }

  // umbrales calibrados sobre 6000 muestras: ~52% / 28% / 13% / 6% / 1%
  const tier =
    rarityScore < 53 ? 'Común' :
    rarityScore < 65 ? 'Poco común' :
    rarityScore < 80 ? 'Raro' :
    rarityScore < 100 ? 'Épico' : 'Legendario';

  return { grid: col, traits, rarityScore: Math.round(rarityScore * 10) / 10, tier };
}

/* ------------------------------------------------------------ PNG write --- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(grid, scale) {
  const W = G * scale, H = G * scale;
  const raw = Buffer.alloc(H * (W * 3 + 1));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filtro none
    const gy = (y / scale) | 0;
    for (let x = 0; x < W; x++) {
      const c = grid[gy * G + ((x / scale) | 0)];
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ CLI --- */
function argv(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const hasFlag = (n) => process.argv.includes('--' + n);

function main() {
  const count = parseInt(argv('count', '10'), 10);
  const outDir = path.resolve(argv('out', './output'));
  const seed = argv('seed', 'nftlnet');
  const scale = parseInt(argv('scale', '4'), 10); // 25*4 = 100px
  const start = parseInt(argv('start', '1'), 10);
  const collection = argv('name', 'Pixel Flores');

  fs.mkdirSync(outDir, { recursive: true });
  const index = [];

  for (let i = 0; i < count; i++) {
    const id = start + i;
    const tokenSeed = `${seed}#${id}`;
    const t = generate(tokenSeed);
    const file = `${String(id).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(outDir, file), encodePNG(t.grid, scale));
    const meta = {
      name: `${collection} #${id}`,
      description: `Flor pixel art de ${G * scale}x${G * scale} px generada proceduralmente. Seed: ${tokenSeed}`,
      image: file,
      seed: tokenSeed,
      attributes: [
        ...t.traits.map((a) => ({ trait_type: a.trait_type, value: String(a.value) })),
        { trait_type: 'Rareza', value: t.tier },
        { display_type: 'number', trait_type: 'Puntaje rareza', value: t.rarityScore },
      ],
    };
    fs.writeFileSync(path.join(outDir, `${String(id).padStart(4, '0')}.json`), JSON.stringify(meta, null, 2));
    index.push({ id, file, tier: t.tier, score: t.rarityScore, traits: t.traits });
    process.stdout.write(`  #${id}  ${t.tier.padEnd(11)} ${t.traits.map((x) => x.value).join(' / ')}\n`);
  }

  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  // galería HTML
  const cards = index
    .map(
      (t) => `<figure><img src="${t.file}" alt="#${t.id}"><figcaption><b>#${t.id}</b> <span class="t t-${t.tier.split(' ')[0]}">${t.tier}</span><br>${t.traits.map((x) => `${x.trait_type}: ${x.value}`).join('<br>')}</figcaption></figure>`
    )
    .join('\n');
  fs.writeFileSync(
    path.join(outDir, 'gallery.html'),
    `<!doctype html><meta charset="utf-8"><title>${collection}</title>
<style>
:root{color-scheme:dark}body{background:#111;color:#eee;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
h1{font-size:18px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:18px}
figure{margin:0;background:#1b1b1b;border:1px solid #2e2e2e;border-radius:10px;padding:10px}
img{width:100%;image-rendering:pixelated;border-radius:6px;display:block}
figcaption{margin-top:8px;color:#9a9a9a;font-size:11px}
.t{padding:1px 5px;border-radius:4px;background:#333;color:#ddd}
.t-Raro{background:#1d4ed8}.t-Épico{background:#7c3aed}.t-Legendario{background:#b45309}
</style><h1>${collection} — ${index.length} piezas</h1><main>${cards}</main>`
  );

  const dist = {};
  for (const t of index) dist[t.tier] = (dist[t.tier] || 0) + 1;
  console.log(`\n${count} NFTs en ${outDir} (${G * scale}x${G * scale} px)`);
  console.log('Rareza:', dist);
  console.log('Galería:', path.join(outDir, 'gallery.html'));
}

if (require.main === module) main();
module.exports = { generate, encodePNG };
