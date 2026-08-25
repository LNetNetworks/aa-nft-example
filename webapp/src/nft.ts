// Capa de contrato: lecturas de PixelFlores por el RPC del bundler (sin token) y
// minteo por UserOperation ERC-4337 (firmado por la EOA embebida de Privy y
// enviado por el proxy /api/bundler, que agrega el Bearer de Keycloak).
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  concat,
  dataSlice,
  getBytes,
  isHexString,
  toBeHex,
  zeroPadValue,
} from "ethers";
import type { Eip1193Provider } from "ethers";
import { lnet } from "./lnet";
import { BUNDLER_PROXY_ENDPOINT, CREDENTIALS, ensureSession } from "./session";

const UO =
  "(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";

const ENTRYPOINT_ABI = [
  `function getUserOpHash(${UO} userOp) view returns (bytes32)`,
  // Clave para poder mintear más de una vez con la MISMA cuenta: el nonce lo
  // lleva el EntryPoint, no la cuenta.
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
];
const FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
  "function createAccount(address owner, uint256 salt) returns (address)",
];
const ACCOUNT_ABI = ["function execute(address dest, uint256 value, bytes func)"];
const NFT_ABI = [
  "function mint() returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalMinted() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function remaining() view returns (uint256)",
  "function baseURI() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownersOfRange(uint256 from, uint256 count) view returns (address[])",
  // Sin el evento en el ABI, getEvent("Transfer") devuelve null y el id del token
  // minteado nunca se puede leer del receipt.
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

// Salt fija: la cuenta inteligente de un usuario es siempre la misma, así los
// tokens que mintea se acumulan en una sola dirección (el ejemplo de referencia
// usa salt aleatoria y crea una cuenta nueva por operación, que acá no sirve).
const ACCOUNT_SALT = 0n;

const provider = new JsonRpcProvider(lnet.rpcUrl, lnet.id);
const factory = new Contract(lnet.factory, FACTORY_ABI, provider);
const entryPoint = new Contract(lnet.entryPoint, ENTRYPOINT_ABI, provider);
const accountIface = new Interface(ACCOUNT_ABI);
const nftIface = new Interface(NFT_ABI);

export const nftConfigured = () => /^0x[0-9a-fA-F]{40}$/.test(lnet.nft);

/**
 * Traduce el error de una operación a algo mostrable. El caso importante es que
 * el usuario no firme: ethers tira un ACTION_REJECTED con el payload completo del
 * personal_sign adentro, y volcarlo en pantalla no le dice nada a nadie. No es un
 * fallo, es una decisión, así que se reporta como cancelación.
 */
export function describeError(err: unknown): { cancelled: boolean; message: string } {
  const e = err as {
    code?: string | number;
    message?: string;
    info?: { error?: { code?: number; message?: string } };
  };
  const rejected =
    e?.code === "ACTION_REJECTED" ||
    e?.code === 4001 ||
    e?.info?.error?.code === 4001 ||
    /user rejected|user denied|rejected the request/i.test(e?.message || "");
  if (rejected) return { cancelled: true, message: "Operación cancelada" };
  return { cancelled: false, message: e?.message || String(err) };
}

function nftContract() {
  if (!nftConfigured()) {
    throw new Error(
      "VITE_NFT_ADDRESS no está configurada — desplegá el contrato con `node scripts/deploy-nft.cjs` y ponelo en .env",
    );
  }
  return new Contract(lnet.nft, NFT_ABI, provider);
}

export type CollectionState = {
  name: string;
  symbol: string;
  totalMinted: number;
  maxSupply: number;
  baseURI: string;
};

export async function readCollection(): Promise<CollectionState> {
  const nft = nftContract();
  const [name, symbol, totalMinted, maxSupply, baseURI] = await Promise.all([
    nft.name(),
    nft.symbol(),
    nft.totalMinted(),
    nft.MAX_SUPPLY(),
    nft.baseURI(),
  ]);
  return {
    name,
    symbol,
    totalMinted: Number(totalMinted),
    maxSupply: Number(maxSupply),
    baseURI,
  };
}

export type MintedToken = { id: number; owner: string };

/** Dueños de un rango de ids en una sola llamada (evita N eth_call para la galería). */
export async function readOwners(from: number, count: number): Promise<MintedToken[]> {
  if (count <= 0) return [];
  const owners: string[] = await nftContract().ownersOfRange(from, count);
  return owners
    .map((owner, i) => ({ id: from + i, owner }))
    .filter((t) => t.owner !== "0x0000000000000000000000000000000000000000");
}

/** Todos los minteados, en tandas, para que "mis flores" no se limite a una ventana. */
export async function readAllMinted(total: number): Promise<MintedToken[]> {
  const CHUNK = 500;
  const out: MintedToken[] = [];
  for (let from = 1; from <= total; from += CHUNK) {
    out.push(...(await readOwners(from, Math.min(CHUNK, total - from + 1))));
  }
  return out;
}

export async function readBalance(account: string): Promise<number> {
  return Number(await nftContract().balanceOf(account));
}

/** Dirección de la cuenta inteligente de este owner (existe o no en cadena). */
export async function smartAccountOf(owner: string): Promise<string> {
  return factory.getFunction("getAddress(address,uint256)")(owner, ACCOUNT_SALT);
}

export async function accountDeployed(address: string): Promise<boolean> {
  return (await provider.getCode(address)) !== "0x";
}

// ------------------------------------------------------------------ UserOp ----

function pack128(hi: bigint | number, lo: bigint | number): string {
  return zeroPadValue(toBeHex((BigInt(hi) << 128n) | BigInt(lo)), 32);
}

type PackedUserOperation = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
};

const serialize = (op: PackedUserOperation) => ({
  sender: op.sender,
  nonce: toBeHex(op.nonce),
  initCode: op.initCode,
  callData: op.callData,
  accountGasLimits: op.accountGasLimits,
  preVerificationGas: toBeHex(op.preVerificationGas),
  gasFees: op.gasFees,
  paymasterAndData: op.paymasterAndData,
  signature: op.signature,
});

const UNAUTHORIZED = -32001;

async function rpc<T>(url: string, method: string, params: unknown[], authed = false): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: authed ? CREDENTIALS : "omit",
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const text = await response.text();
  let payload: { result?: T; error?: string | { code?: number; message?: string; data?: string } };
  try {
    payload = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`${url} devolvió una respuesta ${response.status} no-JSON`), {
      code: response.status === 401 ? UNAUTHORIZED : undefined,
    });
  }
  const error = payload.error;
  if (typeof error === "string") {
    throw Object.assign(new Error(error), { code: response.status === 401 ? UNAUTHORIZED : undefined });
  }
  if (error) {
    const err = new Error(`${error.message}${error.data ? `\n${error.data}` : ""}`);
    (err as { code?: number }).code = error.code;
    throw err;
  }
  return payload.result as T;
}

const bundlerRead = <T>(method: string, params: unknown[]) => rpc<T>(lnet.bundlerUrl, method, params);

async function bundlerSend<T>(method: string, params: unknown[]): Promise<T> {
  await ensureSession();
  try {
    return await rpc<T>(BUNDLER_PROXY_ENDPOINT, method, params, true);
  } catch (err) {
    if ((err as { code?: number }).code === UNAUTHORIZED) {
      await ensureSession(true);
      return rpc<T>(BUNDLER_PROXY_ENDPOINT, method, params, true);
    }
    throw err;
  }
}

type ReceiptLog = { address?: string; topics?: string[]; data?: string };
export type UserOpReceipt = { userOpHash?: string; success?: boolean; logs?: ReceiptLog[]; [k: string]: unknown };

async function waitForReceipt(userOpHash: string): Promise<UserOpReceipt> {
  for (let i = 0; i < 60; i++) {
    const receipt = await bundlerRead<UserOpReceipt | null>("eth_getUserOperationReceipt", [userOpHash]);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timeout esperando ${userOpHash}`);
}

const ERROR_STRING = "0x08c379a0";
const PANIC = "0x4e487b71";
// Los errores custom del contrato, para que "SoldOut" no llegue como bytes crudos.
const CUSTOM_ERRORS: Record<string, string> = {
  "0x52df9fe5": "SoldOut — ya se mintearon las 5000",
  "0x4d5e5fb3": "NotMinted",
  "0xea8e4eb5": "NotAuthorized",
  "0x5d652eb1": "WrongOwner",
  "0xd92e233d": "ZeroAddress",
  "0xb40c733e": "NotReceiver",
};

function decodeRevert(data: string): string | null {
  if (!isHexString(data) || data === "0x") return null;
  try {
    if (data.startsWith(ERROR_STRING)) {
      return AbiCoder.defaultAbiCoder().decode(["string"], dataSlice(data, 4))[0] as string;
    }
    if (data.startsWith(PANIC)) {
      const [code] = AbiCoder.defaultAbiCoder().decode(["uint256"], dataSlice(data, 4));
      return `Panic(0x${(code as bigint).toString(16)})`;
    }
  } catch {
    /* cae al genérico */
  }
  const selector = data.slice(0, 10).toLowerCase();
  return CUSTOM_ERRORS[selector] || `error custom ${data.length > 66 ? `${data.slice(0, 66)}...` : data}`;
}

function revertReasonFrom(receipt: UserOpReceipt, userOpHash: string): string | null {
  const topic = entryPoint.interface.getEvent("UserOperationRevertReason")?.topicHash;
  if (!topic) return null;
  for (const log of receipt.logs || []) {
    const topics = log.topics || [];
    if (topics[0]?.toLowerCase() !== topic.toLowerCase()) continue;
    if (topics[1]?.toLowerCase() !== userOpHash.toLowerCase()) continue;
    try {
      const parsed = entryPoint.interface.parseLog({ topics: [...topics], data: log.data || "0x" });
      if (parsed) return decodeRevert(parsed.args.revertReason as string);
    } catch {
      return null;
    }
  }
  return null;
}

// El id minteado se saca del evento Transfer(0x0 -> cuenta) del propio receipt,
// en vez de asumir totalMinted+1: entre leer y mintear puede entrar otro usuario.
function mintedIdFrom(receipt: UserOpReceipt, account: string): number | null {
  const transferTopic = nftIface.getEvent("Transfer")?.topicHash?.toLowerCase();
  if (!transferTopic) return null;
  for (const log of receipt.logs || []) {
    const topics = log.topics || [];
    if (topics[0]?.toLowerCase() !== transferTopic) continue;
    if (lnet.nft && log.address && log.address.toLowerCase() !== lnet.nft.toLowerCase()) continue;
    if (topics.length < 4) continue;
    const from = `0x${topics[1].slice(26)}`;
    const to = `0x${topics[2].slice(26)}`;
    if (BigInt(from) !== 0n) continue;
    if (to.toLowerCase() !== account.toLowerCase()) continue;
    return Number(BigInt(topics[3]));
  }
  return null;
}

export type MintResult = {
  owner: string;
  smartAccount: string;
  userOpHash: string;
  tokenId: number | null;
  success: boolean;
  revertReason: string | null;
};

// Dos minteos en vuelo a la vez arman su UserOp sobre el mismo estado leído, y eso
// se rompe de dos formas según cuándo caiga el segundo click:
//   - Mismo nonce y mismos datos: el UserOp es idéntico, así que tiene el mismo
//     userOpHash. Verificado contra el bundler: acepta las dos y devuelve el mismo
//     hash, con lo cual un solo minteo se reporta como dos.
//   - El segundo lee el nonce ya avanzado pero todavía ve la cuenta sin crear:
//     manda initCode para una cuenta que el primero acaba de crear, y el
//     EntryPoint lo rechaza en validación.
// El candado evita las dos: el segundo click no arma nada, espera el resultado del
// que ya está corriendo.
let inFlight: Promise<MintResult> | null = null;

export function mintInFlight(): boolean {
  return inFlight !== null;
}

export type MintPhase = (message: string) => void;

export function mint(ethereumProvider: Eip1193Provider, onPhase?: MintPhase): Promise<MintResult> {
  if (inFlight) return inFlight;
  inFlight = mintOnce(ethereumProvider, onPhase).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function mintOnce(ethereumProvider: Eip1193Provider, onPhase?: MintPhase): Promise<MintResult> {
  const phase = (m: string) => onPhase?.(m);
  if (!nftConfigured()) {
    throw new Error("VITE_NFT_ADDRESS no está configurada — falta desplegar el contrato");
  }
  const browserProvider = new BrowserProvider(ethereumProvider);
  const signer = await browserProvider.getSigner();
  const owner = await signer.getAddress();

  phase("Preparando la operación…");
  const sender = await smartAccountOf(owner);
  const deployed = await accountDeployed(sender);

  // initCode solo la primera vez; después la cuenta ya existe y el EntryPoint
  // rechazaría un createAccount repetido (AA10 sender already constructed).
  const initCode = deployed
    ? "0x"
    : concat([lnet.factory, factory.interface.encodeFunctionData("createAccount", [owner, ACCOUNT_SALT])]);
  const nonce: bigint = await entryPoint.getNonce(sender, 0);

  const op: PackedUserOperation = {
    sender,
    nonce,
    initCode,
    callData: accountIface.encodeFunctionData("execute", [
      lnet.nft,
      0,
      nftIface.encodeFunctionData("mint", []),
    ]),
    accountGasLimits: pack128(3_000_000, 1_000_000),
    preVerificationGas: 100_000n,
    gasFees: pack128(0, 0), // gas cero en LNET
    paymasterAndData: "0x",
    signature: "0x",
  };

  const userOpHash = await entryPoint.getUserOpHash(op);
  phase(deployed ? "Firmando…" : "Firmando y creando tu cuenta…");
  op.signature = await signer.signMessage(getBytes(userOpHash));

  phase("Enviando al bundler…");
  const returned = await bundlerSend<string>("eth_sendUserOperation", [serialize(op), lnet.entryPoint]);
  if (returned.toLowerCase() !== userOpHash.toLowerCase()) {
    throw new Error(`El bundler devolvió ${returned}, se esperaba ${userOpHash}`);
  }

  phase("Esperando confirmación en LNET…");
  const receipt = await waitForReceipt(userOpHash);
  // Inclusión no es ejecución: un UserOp cuyo call interno revierte igual entra
  // en un tx exitoso, así que hay que mirar `success` del receipt.
  const success = receipt.success !== false;
  return {
    owner,
    smartAccount: sender,
    userOpHash,
    tokenId: success ? mintedIdFrom(receipt, sender) : null,
    success,
    revertReason: success ? null : revertReasonFrom(receipt, userOpHash),
  };
}
