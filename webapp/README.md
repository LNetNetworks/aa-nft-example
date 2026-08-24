# Pixel Flores — webapp de minteo (LNET testnet)

Login con Google (Privy) → minteo de un ERC-721 por UserOperation ERC-4337 → galería
de lo ya minteado, todo en una pantalla. El arte y los metadatos salen de las dos
carpetas IPFS de la colección.

Arquitectura tomada de `examples/privy-google-aa` del repo
[LNetNetworks/AccountAbstraction](https://github.com/LNetNetworks/AccountAbstraction):

```
Google login -> EOA embebida de Privy -> firma EntryPoint.getUserOpHash
                                              |
                    /api/bundler (agrega el Bearer de Keycloak desde una cookie HttpOnly)
                                              v
                              bundler.l-net.io -> EntryPoint.handleOps
                                              v
                       LnetAccount.execute(PixelFlores, 0, mint())
```

Un solo servicio y un solo puerto: en dev el backend `/api` es middleware de Vite;
en Vercel es la función `api/[...path].js`. El token del bundler nunca entra al
browser (cookie HttpOnly), y `/api/bundler` valida cada UserOp contra una policy.

## Diferencias contra el ejemplo de referencia

| | Ejemplo | Acá |
| --- | --- | --- |
| Cuenta inteligente | salt aleatoria: una cuenta nueva por operación | **salt fija (0)**: la misma cuenta siempre, así los tokens se acumulan |
| Nonce | siempre `0` con `initCode` | `EntryPoint.getNonce(sender, 0)`, e `initCode` **solo** si la cuenta todavía no existe |
| Inner call | `set(uint256)` | `mint()` — hay que poner `ALLOWED_INNER_CALLS=mint()` o la policy rechaza todo |

Las dos primeras son lo que hace posible mintear más de una vez: con salt aleatoria
cada minteo iría a una cuenta distinta, y con `nonce: 0` fijo el segundo UserOp de
una cuenta ya creada sería rechazado.

## Puesta en marcha

```bash
npm install
npm run dev      # app + /api en http://127.0.0.1:5173
```

`.env` ya viene con el Privy app ID, la red, el bundler, Keycloak y los CIDs de IPFS.
Falta una sola cosa: `VITE_NFT_ADDRESS`.

En el dashboard de Privy hay que permitir el origen `http://127.0.0.1:5173`
(y el dominio del deploy), o Google devuelve 403.

## Desplegar el contrato

El contrato está en `../contracts/src/PixelFlores.sol` (ERC-721 sin dependencias,
minteo secuencial del #1 al #5000, `baseURI` fijado en el constructor y sin setter).

```bash
cd ../contracts && forge build      # ya compilado: out/PixelFlores.sol/PixelFlores.json
cd ../webapp && node scripts/deploy-nft.cjs
```

Contrato desplegado en la testnet: **`0xcAfAf19c68E4E6c90E3fBdc7Df15d21B83AE6D9C`**

### Dos cosas que hay que saber antes de recompilar

**1. `evm_version = "paris"` es obligatorio.** LNET corre Besu 23.10.2, que no soporta
Cancun. Solc 0.8.28 apunta a Cancun por defecto y emite `MCOPY`, que en ese nodo es un
opcode inválido: el CREATE consume *todo* el gas y revierte **sin data**, sin importar
el gasLimit. Ese síntoma no dice "opcode inválido" en ningún lado — se diagnostica
desensamblando el bytecode y buscando opcodes post-Paris. Está fijado en
`../contracts/foundry.toml`; si se saca, el deploy vuelve a fallar igual de opaco.

**2. El deploy va DIRECTO, no por el Hub.** Es como el propio repo desplegó su stack
(`broadcast/DeployEntryPoint.s.sol`: CREATE con `to: null` desde `0x248906Bf…`,
EntryPoint de 14.986 bytes):

```bash
DIRECT=1 node scripts/deploy-nft.cjs
```

El camino por el Hub **no sirve para este contrato**: medido con bytecode dummy de
tamaño creciente, `Hub.execute` con `to = address(0)` deploya hasta **2320 bytes de
runtime** y falla desde 2328, y el límite no es de gas (falla igual con 50M). Nuestro
runtime son 4750 bytes. Por el camino directo no hay tope: probado hasta 14.321 bytes.

### Camino por el Hub (para contratos chicos)

Necesita dos claves que habilita el equipo de LNet:

| Variable | Rol |
| --- | --- |
| `RELAYER_PK` | caller en allowlist del Hub — manda el tx |
| `SENDER_PK` | deployer permisionado — firma el `Forward` EIP-712 |

Con un `forward.from` no permisionado el Hub revierte con `0xfc336c41`. Si la clave
del relayer además tiene permiso de raw-tx directo, `DIRECT=1 node scripts/deploy-nft.cjs`
despliega sin pasar por el Hub.

Verificado que no hay atajo: `LnetAccount` solo tiene `execute`/`executeBatch` (CALL,
no CREATE), el bundler no expone ningún método de deploy, y en la testnet no hay
ninguna factory CREATE2 singleton (probadas las cuatro habituales, todas sin código).

El script imprime la dirección y **verifica leyendo el contrato** (`name`, `totalMinted`,
`MAX_SUPPLY`, `baseURI`) antes de darla por buena. Va en `.env` como `VITE_NFT_ADDRESS`
y hay que reiniciar el dev server, porque los `VITE_*` se hornean al arrancar.

El Hub tiene `allowedDeployers(address)` y `isCallerAllowed(address)` como views, útiles
para saber si una clave está habilitada antes de gastar un tx.

## Qué hace la pantalla

- **Mintear** — contador `minteados / 5000`, próximo id, tu EOA de Privy, tu cuenta
  inteligente (con aviso de que se crea en el primer minteo) y cuántas flores tenés.
  El id realmente asignado se lee del evento `Transfer` del receipt, no de
  `totalMinted + 1`: entre leer y mintear puede entrar otro usuario.
- **Detalle** — imagen ampliada y traits, leídos del JSON en IPFS solo al abrir una
  tarjeta (5000 fetches al gateway para pintar la grilla no tendrían sentido).
- **Galería** — grilla de lo minteado, más nuevo primero, con badge en las tuyas.
  Los dueños se leen con `ownersOfRange(from, count)`, una sola llamada en vez de N.

Un UserOp cuyo call interno revierte igual entra en un tx exitoso, así que la UI
mira `success` del receipt y decodifica el error custom (`SoldOut`, etc.) del log
`UserOperationRevertReason`.

## Deploy en Vercel

```bash
vercel link      # Root Directory: webapp
vercel --prod
```

Las variables sin prefijo (`KEYCLOAK_CLIENT_SECRET`, `NAAS_*`, `SESSION_SECRET`,
`ALLOWED_*`, `BUNDLER_URL`) van en Settings → Environment Variables; `.env` no se
sube. `SESSION_SECRET` es obligatoria ahí: sin ella cada instancia firma la cookie
con su propia clave y un cold start invalida las sesiones vivas.

## Verificación end-to-end

`eth_sendUserOperation` contra el bundler con una EOA nueva (lo que hace Privy al
crear la wallet embebida), sin browser:

```
owner (EOA nueva)  : 0x85F65d37AA05a14FC3b7fa0F18752346B39A6F95
cuenta inteligente : 0xFa3ede2485FE56cA8BbbFe291f2482d12CAcb0b3 (no existe aun)
[minteo 1] initCode=si nonce=0  -> success: true  -> token #1
[minteo 2] initCode=no nonce=1  -> success: true  -> token #2
tokenURI(1) : ipfs://bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy/1.json
```

El segundo minteo es el que importa: misma cuenta, nonce 1, sin `initCode`. Con la
salt aleatoria y el `nonce: 0` fijo del ejemplo de referencia eso no funcionaría.

Ese contrato de prueba quedó con dos tokens de una EOA desechable, así que se
redesplegó uno limpio para que el minteo real arranque en el #1.

## Nota de seguridad

La policy quedó cerrada a `mint()` sobre la dirección del NFT (`ALLOWED_CALL_TARGETS`),
en vez del `*` que acepta cualquier contrato: así el peor caso de un XSS es "mintear
una flor a nombre del usuario logueado".
