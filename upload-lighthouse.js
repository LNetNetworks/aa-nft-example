#!/usr/bin/env node
'use strict';
/**
 * Sube una carpeta a IPFS via Lighthouse y devuelve el CID del directorio.
 *   node upload-lighthouse.js ./collection/images
 * Requiere LIGHTHOUSE_API_KEY en .env
 */
const fs = require('fs');
const path = require('path');
const lighthouse = require('@lighthouse-web3/sdk');

for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const key = process.env.LIGHTHOUSE_API_KEY;
if (!key) { console.error('Falta LIGHTHOUSE_API_KEY en .env'); process.exit(1); }

(async () => {
  const target = process.argv[2];
  if (!target) { console.error('Uso: node upload-lighthouse.js <carpeta>'); process.exit(1); }
  const files = fs.statSync(target).isDirectory() ? fs.readdirSync(target).length : 1;
  const bytes = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).reduce((s, f) => s + fs.statSync(path.join(target, f)).size, 0)
    : fs.statSync(target).size;
  console.log(`Subiendo ${target}: ${files} archivos, ${(bytes / 1048576).toFixed(1)} MB`);

  let last = 0;
  const res = await lighthouse.upload(target, key, 1, (p) => {
    const pct = Math.floor((p.uploaded / bytes) * 100);
    if (pct >= last + 10) { last = pct; process.stdout.write(`  ${pct}%\n`); }
  });
  console.log(JSON.stringify(res.data, null, 2));
  const cid = res.data.Hash || res.data.cid;
  console.log(`\nCID = ${cid}`);
  console.log(`gateway: https://gateway.lighthouse.storage/ipfs/${cid}`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
