# Pixel Flores — 5000 piezas en IPFS

Almacenado en dos lugares con **los mismos CIDs**: Lighthouse (durable) y un nodo
Kubo local (el que hoy sirve el contenido públicamente).
Verificado por gateway público `ipfs.io`: imágenes #1, #4321 y #5000 bajan
byte-por-byte idénticas al archivo local, y el metadata resuelve la imagen que referencia.

## CIDs

| Carpeta | CID | Contenido |
|---|---|---|
| `images/`   | `bafybeiepelrkkegnony6zrgjbqzkxenb2ixqdzbipqrytbpbkize54s72q` | 5000 PNG de 100×100 px |
| `metadata/` | `bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy` | 5000 JSON (ERC-721 / OpenSea) |

## URIs para el contrato

```
baseURI  = ipfs://bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy/
tokenURI = ipfs://bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy/<tokenId>.json
image    = ipfs://bafybeiepelrkkegnony6zrgjbqzkxenb2ixqdzbipqrytbpbkize54s72q/<tokenId>.png
```

Los tokenId van de 1 a 5000, sin padding en el nombre de archivo.

## Verificar

```bash
curl https://ipfs.io/ipfs/bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy/1.json
curl -o 1.png https://ipfs.io/ipfs/bafybeiepelrkkegnony6zrgjbqzkxenb2ixqdzbipqrytbpbkize54s72q/1.png
```

## Lighthouse (almacenamiento durable)

Las dos carpetas están subidas a Lighthouse — 10.000 archivos, 8.2 MB de 5 GB.
La subida da **exactamente los mismos CIDs** que Kubo local (verificado: mismo
`bafybeiepel…` y `bafybeigqyo…`), así que los metadatos no dependen de qué
servicio sirva el contenido.

```bash
node upload-lighthouse.js ./collection/images     # ~9 min para 5000 archivos
node upload-lighthouse.js ./collection/metadata
```

**Nota sobre el gateway:** con una cuenta sin saldo, `gateway.lighthouse.storage`
responde `402 Payment Required` para los archivos propios — verificado que es por
cuenta y no por contenido, porque un CID ajeno pasa con 200 por ese mismo gateway.
En ese estado Lighthouse tampoco anuncia los CIDs a la DHT (`ipfs routing findprovs`
no devuelve ningún provider), así que la disponibilidad pública depende de un nodo
propio hasta cargar plan. Los CIDs no cambian al hacerlo.

## Requisito de disponibilidad (nodo local)

El contenido se resuelve mientras el daemon local esté corriendo y alcanzable.

```bash
ipfs daemon                  # levantar a mano
brew services start kubo     # levantar siempre, incluso tras reiniciar
ipfs routing provide <CID>   # re-anunciar a la DHT si dejara de encontrarse
ipfs shutdown                # bajar
```

Sin pinning externo, si el nodo se apaga el contenido deja de estar disponible
(los CIDs no cambian: al volver a prenderlo, vuelve a resolver).

## Reproducir la colección desde cero

```bash
node collection.js images --count 5000 --seed nftlnet --out ./collection
ipfs add -r --cid-version 1 --quieter collection/images     # -> mismo CID de images
node collection.js metadata --cid <CID_IMAGES> --out ./collection
ipfs add -r --cid-version 1 --quieter collection/metadata   # -> mismo CID de metadata
```

Cada pieza es determinista desde su seed (`nftlnet#<id>`), así que estos CIDs son
reproducibles en cualquier máquina.
