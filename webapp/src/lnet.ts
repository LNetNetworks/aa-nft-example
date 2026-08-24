export const lnet = {
  id: Number(import.meta.env.VITE_LNET_CHAIN_ID || 648540),
  name: "LNET Testnet",
  bundlerUrl: import.meta.env.VITE_BUNDLER_URL || "https://bundler.l-net.io",
  rpcUrl:
    import.meta.env.VITE_READ_RPC_URL || import.meta.env.VITE_BUNDLER_URL || "https://bundler.l-net.io",
  lnetRpcUrl: import.meta.env.VITE_LNET_RPC_URL || "http://34.69.184.205:4545",
  entryPoint: import.meta.env.VITE_ENTRYPOINT_ADDRESS || "0x9fD181236dA8c890bD5007b44B80E395E130c57D",
  factory: import.meta.env.VITE_FACTORY_ADDRESS || "0x5589A0E344688976e473FD56BAe94411d9d56f67",
  /** ERC-721 Pixel Flores. Vacío hasta que se despliegue (ver scripts/deploy-nft.cjs). */
  nft: (import.meta.env.VITE_NFT_ADDRESS || "").trim(),
};

/** Carpetas IPFS de la colección: los CIDs son fijos y ya verificados. */
export const ipfs = {
  images: import.meta.env.VITE_IMAGES_CID || "bafybeiepelrkkegnony6zrgjbqzkxenb2ixqdzbipqrytbpbkize54s72q",
  metadata: import.meta.env.VITE_METADATA_CID || "bafybeigqyo3ljar4nxmzmlfi5vca5fuje4t4dbdoro2c3jfelkmg74n7oy",
  gateway: (import.meta.env.VITE_IPFS_GATEWAY || "https://ipfs.io").replace(/\/+$/, ""),
};

// Servido desde localhost, el gateway del nodo Kubo local va primero: responde en
// ~20ms contra los ~60-3000ms de uno público. En un deploy no se usa (el visitante
// no tiene nodo), así que la lista queda encabezada por el gateway público.
const localFirst =
  typeof location !== "undefined" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)
    ? ["http://127.0.0.1:8080"]
    : [];

/** Si un gateway no responde, la imagen se reintenta con el siguiente. */
export const gateways = [ipfs.gateway, "https://dweb.link", "https://4everland.io"].filter(
  (g, i, all) => all.indexOf(g) === i,
);

// Espejo servido por el propio deploy (scripts/mirror-assets.cjs). Los CIDs los
// provee un solo nodo, así que un gateway público tarda ~12s en la primera lectura
// de cada archivo: el tokenURI sigue siendo IPFS, pero la UI pinta desde acá y usa
// los gateways como fallback. Vacío = solo IPFS.
const mirror = (import.meta.env.VITE_ASSET_MIRROR ?? "/flowers").replace(/\/+$/, "");

// Fallback público en GitHub: si el espejo del deploy no está (o se clonó el repo
// y no se corrió mirror-assets), las imágenes salen igual desde el repo, que las
// sirve con CORS abierto. Último recurso: los gateways IPFS.
const githubAssets = (
  import.meta.env.VITE_GITHUB_ASSETS ??
  "https://raw.githubusercontent.com/LNetNetworks/aa-nft-example/main/assets"
).replace(/\/+$/, "");

/** Orígenes de la imagen, en orden de preferencia. */
export const imageSources = (tokenId: number | bigint): string[] => [
  ...(mirror ? [`${mirror}/${tokenId}.png`] : []),
  ...(githubAssets ? [`${githubAssets}/flowers/${tokenId}.png`] : []),
  ...gateways.map((g) => `${g}/ipfs/${ipfs.images}/${tokenId}.png`),
];

export const imageUrl = (tokenId: number | bigint, i = 0) => {
  const all = imageSources(tokenId);
  return all[Math.min(i, all.length - 1)];
};
export const imageSourceCount = (tokenId: number | bigint) => imageSources(tokenId).length;

/** Índice único con los traits de las 5000, para no pedir 5000 JSON al gateway. */
export const traitsIndexSources = [
  (import.meta.env.VITE_TRAITS_INDEX ?? "/traits.json") || null,
  githubAssets ? `${githubAssets}/traits.json` : null,
].filter((u): u is string => !!u);

export const metadataUrl = (tokenId: number | bigint, gw = 0) =>
  `${gateways[Math.min(gw, gateways.length - 1)]}/ipfs/${ipfs.metadata}/${tokenId}.json`;

/** Blockscout de la testnet. */
export const explorer = (import.meta.env.VITE_EXPLORER_URL || "https://explorer-testnet.l-net.io").replace(
  /\/+$/,
  "",
);
export const explorerToken = (tokenId: number | bigint) => `${explorer}/token/${lnet.nft}/instance/${tokenId}`;
export const explorerAddress = (address: string) => `${explorer}/address/${address}`;

export const lnetPrivyChain = {
  id: lnet.id,
  name: lnet.name,
  network: "lnet-testnet",
  nativeCurrency: { name: "LNET", symbol: "LNET", decimals: 18 },
  rpcUrls: { default: { http: [lnet.rpcUrl] } },
};
