#!/usr/bin/env node
/**
 * Espeja los assets de la colección dentro de public/ para que el deploy los sirva
 * por CDN.
 *
 * Por qué: los CIDs los provee un solo nodo, así que un gateway público tarda
 * ~12s por imagen en la primera lectura (búsqueda en la DHT + descarga desde ese
 * nodo). El tokenURI sigue apuntando a IPFS —esa es la fuente canónica—, pero la
 * UI pinta desde el espejo y usa los gateways solo como fallback.
 *
 *   node scripts/mirror-assets.cjs
 *
 * Genera public/flowers/<id>.png (una por token) y public/traits.json (índice
 * único con los atributos de las 5000: 5000 JSON sueltos serían 5000 requests).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
// assets/ viene en el repo; collection/ es la salida completa del generador.
const SRC_IMG = fs.existsSync(path.join(ROOT, "assets", "flowers"))
  ? path.join(ROOT, "assets", "flowers")
  : path.join(ROOT, "collection", "images");
const SRC_TRAITS = fs.existsSync(path.join(ROOT, "assets", "traits.json"))
  ? path.join(ROOT, "assets", "traits.json")
  : path.join(ROOT, "collection", "traits.json");
const OUT_IMG = path.join(__dirname, "..", "public", "flowers");
const OUT_TRAITS = path.join(__dirname, "..", "public", "traits.json");

if (!fs.existsSync(SRC_IMG)) {
  console.error(`No existe ${SRC_IMG}\nGeneralas primero:  node collection.js images --count 5000 --out ./collection`);
  process.exit(1);
}

fs.mkdirSync(OUT_IMG, { recursive: true });
const files = fs.readdirSync(SRC_IMG).filter((f) => f.endsWith(".png"));
let bytes = 0;
for (const f of files) {
  const buf = fs.readFileSync(path.join(SRC_IMG, f));
  fs.writeFileSync(path.join(OUT_IMG, f), buf);
  bytes += buf.length;
}
console.log(`imágenes: ${files.length} (${(bytes / 1048576).toFixed(1)} MB) -> public/flowers/`);

if (fs.existsSync(SRC_TRAITS)) {
  const raw = JSON.parse(fs.readFileSync(SRC_TRAITS, "utf8"));
  // assets/traits.json ya viene como índice {id: [[k,v]...]}; el traits.json del
  // generador es la lista completa y hay que reducirlo a lo que la UI muestra.
  const index = Array.isArray(raw)
    ? Object.fromEntries(
        raw.map((r) => [r.id, [...r.traits.map((t) => [t.trait_type, String(t.value)]), ["Rareza", r.tier]]]),
      )
    : raw;
  fs.writeFileSync(OUT_TRAITS, JSON.stringify(index));
  const kb = fs.statSync(OUT_TRAITS).size / 1024;
  console.log(`traits: ${Object.keys(index).length} tokens (${kb.toFixed(0)} KB) -> public/traits.json`);
}
