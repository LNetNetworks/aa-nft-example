# aa-nft-example

Ejemplo end-to-end sobre **LNET testnet**: una colección NFT generada
proceduralmente, publicada en IPFS, con un ERC-721 propio y una webapp donde se
mintea con **login de Google (Privy) + Account Abstraction (ERC-4337)** — sin que el
usuario firme una transacción ni pague gas.

```
Google login -> EOA embebida de Privy -> firma EntryPoint.getUserOpHash
                                              |
                    /api/bundler (agrega el Bearer de Keycloak desde una cookie HttpOnly)
                                              v
                              bundler.l-net.io -> EntryPoint.handleOps
                                              v
                       LnetAccount.execute(PixelFlores, 0, mint())
```

Construido sobre el stack de [LNetNetworks/AccountAbstraction](https://github.com/LNetNetworks/AccountAbstraction),
tomando su `examples/privy-google-aa` como base del cliente.

## En la testnet

| | |
| --- | --- |
| ERC-721 | [`0xcAfAf19c68E4E6c90E3fBdc7Df15d21B83AE6D9C`](https://explorer-testnet.l-net.io/token/0xcAfAf19c68E4E6c90E3fBdc7Df15d21B83AE6D9C) |
| Imágenes (IPFS) | `bafybeiepelrkkegnony6zrgjbqzkxenb2ixqdzbipqrytbpbkize54s72q` |
| Metadata (IPFS) | `bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy` |
| EntryPoint v0.7 | `0x9fD181236dA8c890bD5007b44B80E395E130c57D` |
| LnetAccountFactory | `0x5589A0E344688976e473FD56BAe94411d9d56f67` |
| Chain ID | 648540 |

`tokenURI = ipfs://<metadata CID>/<tokenId>.json`, con ids del 1 al 5000.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `generate.js` | Generador de flores pixel art de 100×100 px, determinista por seed, sin dependencias (encoder PNG propio) |
| `collection.js` | Arma la colección completa: imágenes, metadata ERC-721, ranking de rareza |
| `upload-lighthouse.js` | Sube una carpeta a IPFS por Lighthouse y devuelve el CID del directorio |
| `contracts/` | `PixelFlores.sol` — ERC-721 sin dependencias, minteo secuencial, `baseURI` inmutable |
| `webapp/` | Vite + React + Privy + backend `/api` en un solo servicio |
| `docs/generator.md` | Traits, rareza y uso del generador |
| `docs/ipfs.md` | CIDs, cómo se publicó y cómo reproducirlos |

## Arrancar

```bash
# 1. arte + metadata (opcional: los CIDs de arriba ya están en IPFS)
node collection.js images --count 5000 --seed nftlnet --out ./collection
node collection.js metadata --cid <CID_IMAGES> --out ./collection

# 2. contrato
cd contracts && forge install foundry-rs/forge-std --no-git && forge build

# 3. webapp
cd ../webapp && cp .env.example .env   # completar VITE_PRIVY_APP_ID y las de Keycloak
npm install && npm run dev             # app + /api en :5173
```

Para desplegar el contrato hacen falta las claves permisionadas de LNet
(`RELAYER_PK`, `SENDER_PK`): ver `webapp/README.md`.

## Cuatro cosas que hay que saber de LNET

1. **`evm_version = "paris"` es obligatorio.** LNET corre Besu 23.10.2, sin soporte
   de Cancun. Solc 0.8.28 apunta a Cancun por defecto y emite `MCOPY`, que ahí es un
   opcode inválido: el CREATE consume *todo* el gas y revierte **sin revert data**,
   con cualquier gasLimit, y `estimateGas` falla con "missing revert data". No hay
   ningún mensaje que lo diga; se diagnostica desensamblando el bytecode.
2. **El deploy de un contrato mediano va directo, no por el Hub.** `Hub.execute` con
   `to = address(0)` deploya hasta **2320 bytes de runtime** (medido por bisección
   con bytecode dummy) y no es un límite de gas: falla igual con 50M. Por raw-tx
   directo no hay tope — probado hasta 14.321 bytes, que es como se desplegó el
   propio EntryPoint del stack.
3. **La policy del proxy es default-deny.** `ALLOWED_INNER_CALLS` viene con
   `set(uint256)` del ejemplo original; sin ponerla en `mint()` todos los minteos se
   rechazan con `inner call 0x1249c58b is not allowed`.
4. **Salt fija y nonce del EntryPoint.** El ejemplo de referencia usa salt aleatoria
   y `nonce: 0`, que sirve para una operación suelta. Para que un usuario acumule
   tokens hace falta salt fija (misma cuenta siempre), `EntryPoint.getNonce()` e
   `initCode` solo cuando la cuenta todavía no existe.
