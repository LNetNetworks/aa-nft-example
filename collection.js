#!/usr/bin/env node
'use strict';
/**
 * Armado de colección lista para IPFS.
 *
 *   node collection.js images   --count 5000 --seed nftlnet --out ./collection
 *   node collection.js metadata --cid <CID_DE_IMAGES>       --out ./collection
 *   node collection.js stats    --out ./collection
 *
 * Estructura: <out>/images/1.png …  <out>/metadata/1.json  + traits.json + rarity.csv
 * El paso `metadata` va DESPUÉS de subir images/, porque cada JSON referencia
 * ipfs://<CID>/<id>.png.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generate, encodePNG } = require('./generate.js');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const COLLECTION = 'Pixel Flores';
const DESCRIPTION =
  'Flor pixel art de 100x100 px generada proceduralmente. Arte 100% on-seed: la pieza se reproduce exacta desde su seed.';

function cmdImages() {
  const count = parseInt(arg('count', '5000'), 10);
  const seed = arg('seed', 'nftlnet');
  const out = path.resolve(arg('out', './collection'));
  const scale = parseInt(arg('scale', '4'), 10);
  const imgDir = path.join(out, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const seen = new Map();
  const rows = [];
  let collisions = 0;

  for (let id = 1; id <= count; id++) {
    let t, tokenSeed, salt = 0, hash;
    // si dos piezas salen pixel-idénticas, se re-tira con sufijo hasta que sea única
    for (;;) {
      tokenSeed = `${seed}#${id}` + (salt ? `+${salt}` : '');
      t = generate(tokenSeed);
      hash = crypto.createHash('sha1').update(Buffer.from(t.grid.flat())).digest('hex');
      if (!seen.has(hash)) break;
      salt++; collisions++;
    }
    seen.set(hash, id);
    fs.writeFileSync(path.join(imgDir, `${id}.png`), encodePNG(t.grid, scale));
    rows.push({ id, seed: tokenSeed, hash, tier: t.tier, score: t.rarityScore, traits: t.traits });
    if (id % 500 === 0) process.stdout.write(`  ${id}/${count}\n`);
  }

  fs.writeFileSync(path.join(out, 'traits.json'), JSON.stringify(rows));
  console.log(`\n${count} imágenes en ${imgDir} (${25 * scale}x${25 * scale} px)`);
  console.log(`Únicas a nivel píxel: ${seen.size}/${count}  (re-tiros por colisión: ${collisions})`);
  console.log('Siguiente paso: subir images/ a IPFS, después `node collection.js metadata --cid <CID>`');
}

/** frecuencia real de cada valor dentro de la colección → ranking de rareza */
function rankRarity(rows) {
  const freq = {};
  for (const r of rows) for (const a of r.traits) {
    freq[a.trait_type] = freq[a.trait_type] || {};
    freq[a.trait_type][a.value] = (freq[a.trait_type][a.value] || 0) + 1;
  }
  for (const r of rows) {
    r.collectionScore =
      Math.round(r.traits.reduce((s, a) => s + rows.length / freq[a.trait_type][a.value], 0) * 100) / 100;
  }
  const sorted = [...rows].sort((a, b) => b.collectionScore - a.collectionScore);
  sorted.forEach((r, i) => (r.rank = i + 1));
  return { freq, sorted };
}

function cmdMetadata() {
  const out = path.resolve(arg('out', './collection'));
  const cid = arg('cid', null);
  const ext = arg('ext', '.png');
  if (!cid) { console.error('Falta --cid <CID de la carpeta images/>'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(path.join(out, 'traits.json'), 'utf8'));
  const metaDir = path.join(out, 'metadata');
  fs.mkdirSync(metaDir, { recursive: true });
  const { freq } = rankRarity(rows);

  for (const r of rows) {
    const meta = {
      name: `${COLLECTION} #${r.id}`,
      description: DESCRIPTION,
      image: `ipfs://${cid}/${r.id}${ext}`,
      external_url: `ipfs://${cid}/${r.id}${ext}`,
      attributes: [
        ...r.traits.map((a) => ({ trait_type: a.trait_type, value: String(a.value) })),
        { trait_type: 'Rareza', value: r.tier },
        { display_type: 'number', trait_type: 'Ranking', value: r.rank },
      ],
      properties: { seed: r.seed, sha1: r.hash, rarity_score: r.collectionScore },
    };
    fs.writeFileSync(path.join(metaDir, `${r.id}.json`), JSON.stringify(meta));
  }

  fs.writeFileSync(
    path.join(out, 'rarity.csv'),
    'id,rank,score,tier,' + rows[0].traits.map((t) => t.trait_type).join(',') + '\n' +
      [...rows].sort((a, b) => a.rank - b.rank)
        .map((r) => [r.id, r.rank, r.collectionScore, r.tier, ...r.traits.map((t) => t.value)].join(','))
        .join('\n')
  );
  fs.writeFileSync(path.join(out, 'trait-frequency.json'), JSON.stringify(freq, null, 2));

  const collectionMeta = {
    name: COLLECTION,
    description: DESCRIPTION,
    image: `ipfs://${cid}/1${ext}`,
    total_supply: rows.length,
  };
  fs.writeFileSync(path.join(out, 'collection.json'), JSON.stringify(collectionMeta, null, 2));

  console.log(`${rows.length} metadatos en ${metaDir}`);
  console.log(`image → ipfs://${cid}/<id>${ext}`);
  console.log('Siguiente paso: subir metadata/ y usar tokenURI = ipfs://<CID_METADATA>/<tokenId>.json');
}

function cmdStats() {
  const out = path.resolve(arg('out', './collection'));
  const rows = JSON.parse(fs.readFileSync(path.join(out, 'traits.json'), 'utf8'));
  const { freq, sorted } = rankRarity(rows);
  const tiers = {};
  for (const r of rows) tiers[r.tier] = (tiers[r.tier] || 0) + 1;
  console.log(`Piezas: ${rows.length}`);
  console.log('Tiers:', tiers);
  for (const k in freq) {
    const line = Object.entries(freq[k]).sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}:${n} (${((n / rows.length) * 100).toFixed(1)}%)`).join('  ');
    console.log(`\n${k}\n  ${line}`);
  }
  console.log('\nTop 10 más raras:');
  for (const r of sorted.slice(0, 10))
    console.log(`  #${r.id}  rank ${r.rank}  ${r.tier.padEnd(11)} ${r.traits.map((t) => t.value).join('/')}`);
}

const cmd = process.argv[2];
if (cmd === 'images') cmdImages();
else if (cmd === 'metadata') cmdMetadata();
else if (cmd === 'stats') cmdStats();
else { console.error('Uso: node collection.js <images|metadata|stats> [flags]'); process.exit(1); }
