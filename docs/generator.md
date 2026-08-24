# Pixel Flores — generador random de NFTs

Genera flores **pixel art de 100×100 px** de forma procedural. Cero dependencias
(encoder PNG propio sobre `zlib` de Node). Cada pieza sale de una grilla lógica de
25×25 píxeles escalada ×4, así que los píxeles quedan perfectamente cuadrados.

## Uso

```bash
node generate.js --count 20 --out ./output --seed nftlnet
```

| Flag      | Default          | Qué hace |
|-----------|------------------|----------|
| `--count` | `10`             | Cuántos NFTs generar |
| `--out`   | `./output`       | Carpeta de salida |
| `--seed`  | `nftlnet`        | Seed de la colección (determinista) |
| `--scale` | `4`              | Píxeles por celda: `4` → 100×100, `20` → 500×500 |
| `--start` | `1`              | ID inicial (para generar por lotes) |
| `--name`  | `Pixel Flores`   | Nombre de la colección en el metadata |

Salida por token: `0001.png` + `0001.json` (metadata estilo OpenSea), más
`index.json` y `gallery.html` con la colección completa.

**Determinismo:** cada pieza usa la seed `"<seed>#<id>"`. Misma seed + mismo id →
exactamente el mismo PNG, siempre. Ideal para regenerar arte on-demand desde el
tokenId sin guardar los archivos.

## Traits (9 + rareza)

| Trait | Valores |
|-------|---------|
| Paleta | Rosa Neón, Girasol, Cielo, Lavanda, Fuego, Menta, Sangre, Nieve, **Oro**, **Void** |
| Pétalos | 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16 |
| Forma | Redonda, Puntiaguda, Margarita, Estrella, Corazón |
| Centro | Punto, Anillo, Relleno, Espiral, Cruz |
| Tallo | Recto, Curva izquierda, Curva derecha, Doble (con capullo), Sin tallo |
| Hojas | 0–6 |
| Fondo | Plano, Degradado, Rayos, Cuadros, Estrellado, Marco |
| Aura | Ninguna, Brillo, Chispas, Halo doble |
| Contorno | Sí / No |

Cada trait tiene peso propio; la rareza se calcula como Σ(1/p) y se traduce a
tier con umbrales calibrados sobre 6000 muestras:

`Común ~52% · Poco común ~28% · Raro ~13% · Épico ~6% · Legendario ~1%`

Combinaciones posibles: 10 × 11 × 5 × 5 × 5 × 7 × 6 × 4 × 2 = **4.6 M**
(más rotación aleatoria de la corola, tamaño y lado de cada hoja, y sembrado de estrellas).

El radio de la corola y el exponente de pétalo se ajustan según el conteo: pocos
pétalos quedan compactos y separados, muchos se estiran en pompón sin fusionarse.

## Uso como librería

```js
const { generate, encodePNG } = require('./generate.js');
const t = generate('mi-coleccion#42');
require('fs').writeFileSync('42.png', encodePNG(t.grid, 4)); // 100x100
console.log(t.traits, t.tier, t.rarityScore);
```
