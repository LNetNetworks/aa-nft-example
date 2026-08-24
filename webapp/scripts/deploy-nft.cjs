#!/usr/bin/env node
/**
 * Despliega PixelFlores en LNET testnet.
 *
 * LNET es una red Besu permisionada: ninguna cuenta puede mandar un tx crudo. El
 * único camino es el PermissionedMetaTxHub, y hacen falta DOS claves que habilita
 * el equipo de LNet (docs/lnet-integration.md del repo AccountAbstraction):
 *
 *   RELAYER_PK  caller en allowlist del Hub  -> manda el tx
 *   SENDER_PK   deployer permisionado        -> firma el Forward EIP-712
 *
 * Si el relayer además tiene permiso de raw-tx directo, DIRECT=1 despliega sin Hub.
 *
 *   node scripts/deploy-nft.cjs
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// .env propio de la webapp, sin dependencia externa.
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
}

const RPC = process.env.VITE_LNET_RPC_URL || "http://34.69.184.205:4545";
const CHAIN_ID = Number(process.env.VITE_LNET_CHAIN_ID || 648540);
const HUB = process.env.HUB_ADDRESS || "0x4053cA6bcdEc6638d9Ad83a5c74d0246C7670ACd";
const ARTIFACT = path.join(__dirname, "..", "..", "contracts", "out", "PixelFlores.sol", "PixelFlores.json");

const HUB_ABI = [
  "function execute((address from,address to,uint256 value,uint32 space,uint256 nonce,uint256 deadline,bytes32 dataHash,address caller) forward, bytes callData, bytes signature) payable",
  "event ContractDeployed(address indexed signer, address deployed, bytes32 dataHash)",
];
const FORWARD_TYPES = {
  Forward: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "space", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "caller", type: "address" },
  ],
};
const NFT_ABI = [
  "function name() view returns (string)",
  "function totalMinted() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function baseURI() view returns (string)",
];

const rndNonce = () => (BigInt(Date.now()) << 160n) | ethers.toBigInt(ethers.randomBytes(20));

// Las claves se aceptan con o sin prefijo 0x.
const normPk = (pk) => (pk && !pk.startsWith("0x") ? `0x${pk}` : pk);

async function main() {
  const metadataCid = process.env.VITE_METADATA_CID;
  if (!metadataCid) throw new Error("Falta VITE_METADATA_CID en .env");
  const baseURI = `ipfs://${metadataCid}/`;

  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(`No existe el artifact ${ARTIFACT}\nCompilá primero:  cd ../contracts && forge build`);
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  // creation code + argumento del constructor
  const initData = ethers.concat([
    artifact.bytecode.object,
    ethers.AbiCoder.defaultAbiCoder().encode(["string"], [baseURI]),
  ]);

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const relayerPk = process.env.RELAYER_PK;
  if (!relayerPk) {
    throw new Error(
      "Falta RELAYER_PK en .env — es una clave que habilita el equipo de LNet (caller en allowlist del Hub).",
    );
  }
  const relayer = new ethers.Wallet(normPk(relayerPk), provider);
  console.log(`red      : ${RPC} (chain ${CHAIN_ID})`);
  console.log(`relayer  : ${relayer.address}`);
  console.log(`baseURI  : ${baseURI}`);
  console.log(`bytecode : ${(initData.length - 2) / 2} bytes`);

  let deployed;
  if (process.env.DIRECT === "1") {
    // Camino directo: solo funciona si esta clave tiene permiso de raw-tx.
    console.log("\nmodo DIRECT (sin Hub)…");
    const tx = await relayer.sendTransaction({ data: initData, gasPrice: 0n, gasLimit: 6_000_000n });
    const receipt = await tx.wait();
    deployed = receipt.contractAddress;
    console.log(`tx       : ${tx.hash}`);
  } else {
    const senderPk = process.env.SENDER_PK || process.env.DEPLOYER_PK;
    if (!senderPk) {
      throw new Error(
        "Falta SENDER_PK en .env — el deployer permisionado que firma el Forward del Hub.\n" +
          "Con un forward.from no permisionado el Hub revierte con 0xfc336c41.",
      );
    }
    const signer = new ethers.Wallet(normPk(senderPk), provider);
    console.log(`deployer : ${signer.address}`);
    console.log(`hub      : ${HUB}`);

    const forward = {
      from: signer.address,
      to: ethers.ZeroAddress, // to = 0 => CREATE
      value: 0n,
      space: 0,
      nonce: rndNonce(),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      dataHash: ethers.keccak256(initData),
      caller: relayer.address,
    };
    const domain = { name: "PermissionedMetaTxHub", version: "1", chainId: CHAIN_ID, verifyingContract: HUB };
    const signature = await signer.signTypedData(domain, FORWARD_TYPES, forward);

    const hub = new ethers.Contract(HUB, HUB_ABI, relayer);
    console.log("\nenviando Hub.execute…");
    const tx = await hub.execute(forward, initData, signature, { gasLimit: 6_000_000n, gasPrice: 0n });
    const receipt = await tx.wait();
    console.log(`tx       : ${tx.hash}`);
    for (const log of receipt.logs) {
      try {
        const parsed = hub.interface.parseLog(log);
        if (parsed?.name === "ContractDeployed") { deployed = parsed.args.deployed; break; }
      } catch { /* log de otro contrato */ }
    }
    if (!deployed) throw new Error("El tx entró pero no hubo evento ContractDeployed");
  }

  // Verificación: que el contrato responda, no solo que el tx no falle.
  const nft = new ethers.Contract(deployed, NFT_ABI, provider);
  const [name, minted, max, base] = await Promise.all([
    nft.name(), nft.totalMinted(), nft.MAX_SUPPLY(), nft.baseURI(),
  ]);
  console.log(`\nPixelFlores desplegado en ${deployed}`);
  console.log(`  name=${name}  totalMinted=${minted}  MAX_SUPPLY=${max}`);
  console.log(`  baseURI=${base}`);
  console.log(`\nPegá esto en .env y reiniciá el dev server (los VITE_* se hornean al arrancar):`);
  console.log(`  VITE_NFT_ADDRESS=${deployed}`);
}

main().catch((err) => {
  console.error(`\nFALLO: ${err.message}`);
  process.exit(1);
});
