import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { explorerAddress, explorerToken, imageSourceCount, imageUrl, metadataUrl, traitsIndexSources } from "./lnet";
import {
  accountDeployed,
  mint,
  nftConfigured,
  readAllMinted,
  readBalance,
  readCollection,
  smartAccountOf,
  type CollectionState,
  type MintResult,
  type MintedToken,
} from "./nft";
import { endSession, setPrivyTokenProvider } from "./session";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Status = { state: "idle" | "running" | "ok" | "error"; message: string };
type Trait = { trait_type: string; value: string | number };
type TokenMeta = { name: string; attributes: Trait[] };

/** Un gateway público puede fallar; se reintenta con el siguiente. */
function PixImg({ id, className }: { id: number; className: string }) {
  const [src, setSrc] = useState(0);
  return (
    <img
      className={className}
      src={imageUrl(id, src)}
      alt={`Flor #${id}`}
      loading="lazy"
      onError={() => setSrc((i) => (i + 1 < imageSourceCount(id) ? i + 1 : i))}
    />
  );
}

export function App() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const [collection, setCollection] = useState<CollectionState | null>(null);
  const [tokens, setTokens] = useState<MintedToken[]>([]);
  const [smartAccount, setSmartAccount] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle", message: "" });
  const [, setResult] = useState<MintResult | null>(null);
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [meta, setMeta] = useState<Record<number, TokenMeta | "loading" | "error">>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const wallet = useMemo(() => wallets.find((w) => w.walletClientType === "privy") || wallets[0], [wallets]);
  // `disabled` depende de un re-render; un doble click rápido puede entrar dos
  // veces antes de eso, así que el corte real es este ref sincrónico.
  const minting = useRef(false);
  const busy = status.state === "running";
  const configured = nftConfigured();

  useEffect(() => {
    setPrivyTokenProvider(authenticated ? getAccessToken : null);
    return () => setPrivyTokenProvider(null);
  }, [authenticated, getAccessToken]);

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const state = await readCollection();
      setCollection(state);
      const all = await readAllMinted(state.totalMinted);
      setTokens(all.reverse());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [configured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ?id=N abre esa flor directo, así el detalle es enlazable.
  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get("id"));
    if (Number.isInteger(id) && id > 0) void openToken(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wallet?.address || !configured) {
      setSmartAccount(null);
      setBalance(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const account = await smartAccountOf(wallet.address);
        if (!alive) return;
        setSmartAccount(account);
        const [exists, bal] = await Promise.all([accountDeployed(account), readBalance(account)]);
        if (!alive) return;
        setAccountExists(exists);
        setBalance(bal);
      } catch {
        /* el error de lectura ya se muestra arriba */
      }
    })();
    return () => {
      alive = false;
    };
  }, [wallet?.address, configured, collection?.totalMinted]);

  // Los traits salen del índice servido por el deploy (una sola descarga para las
  // 5000). Si no está, se cae al JSON del token en IPFS.
  const indexRef = useRef<Record<string, [string, string][]> | null | "failed">(null);

  const openToken = useCallback(async (id: number) => {
    setOpen(id);
    setMeta((m) => (m[id] && m[id] !== "error" ? m : { ...m, [id]: "loading" }));

    if (indexRef.current === null) {
      for (const url of traitsIndexSources) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          indexRef.current = await res.json();
          break;
        } catch {
          /* siguiente origen */
        }
      }
      if (indexRef.current === null) indexRef.current = "failed";
    }
    const fromIndex =
      indexRef.current && indexRef.current !== "failed" ? indexRef.current[String(id)] : null;
    if (fromIndex) {
      setMeta((m) => ({
        ...m,
        [id]: { name: `Flor #${id}`, attributes: fromIndex.map(([k, v]) => ({ trait_type: k, value: v })) },
      }));
      return;
    }

    try {
      const res = await fetch(metadataUrl(id));
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as TokenMeta;
      setMeta((m) => ({ ...m, [id]: data }));
    } catch {
      setMeta((m) => ({ ...m, [id]: "error" }));
    }
  }, []);

  async function onMint() {
    if (minting.current) return;
    if (!wallet) {
      setStatus({ state: "error", message: "No hay wallet después del login." });
      return;
    }
    minting.current = true;
    setResult(null);
    try {
      setStatus({ state: "running", message: "Firmando y enviando…" });
      const res = await mint(await wallet.getEthereumProvider());
      setResult(res);
      if (!res.success) {
        setStatus({ state: "error", message: res.revertReason || "La ejecución falló" });
        return;
      }
      let id = res.tokenId;
      const state = await readCollection().catch(() => null);
      if (!id && state) id = state.totalMinted;
      setStatus({ state: "ok", message: id ? `Minteaste la #${id}` : "Minteado" });
      await refresh();
      if (id) {
        setTab("mine");
        void openToken(id);
      }
    } catch (err) {
      setStatus({ state: "error", message: (err as Error).message });
    } finally {
      minting.current = false;
    }
  }

  const mineKey = smartAccount?.toLowerCase();
  const mine = useMemo(() => tokens.filter((t) => t.owner.toLowerCase() === mineKey), [tokens, mineKey]);
  const nextId = collection ? collection.totalMinted + 1 : null;
  const soldOut = collection ? collection.totalMinted >= collection.maxSupply : false;
  const pct = collection ? (collection.totalMinted / collection.maxSupply) * 100 : 0;
  const list = tab === "mine" ? mine : tokens;
  const openMeta = open != null ? meta[open] : undefined;
  const openOwner = open != null ? tokens.find((t) => t.id === open)?.owner : undefined;
  const openIsMine = !!openOwner && openOwner.toLowerCase() === mineKey;
  const userEmail = user?.google?.email || user?.email?.address || null;

  return (
    <>
      <div className="bg" aria-hidden="true" />
      <main>
        <header>
          <h1>
            <b>Flores NFT</b> <span>- Account Abstraction LNET</span>
          </h1>
          {ready && (authenticated ? (
            <div className="session">
              <span className="mail">{user?.google?.email || user?.email?.address}</span>
              <button className="btn-ghost" onClick={async () => {
                setPrivyTokenProvider(null);
                await endSession();
                await logout();
                setSmartAccount(null);
                setBalance(null);
                setTab("all");
                setStatus({ state: "idle", message: "" });
              }}>Salir</button>
            </div>
          ) : (
            <button className="btn" disabled={busy} onClick={async () => {
              try { await login(); } catch (e) { setStatus({ state: "error", message: (e as Error).message }); }
            }}>Entrar con Google</button>
          ))}
        </header>

        <section className="card mint">
          <div>
            <div className="count">
              <b>{collection ? collection.totalMinted : "—"}</b>
              <span>/ {collection ? collection.maxSupply : 5000}</span>
            </div>
            <div className="bar"><i style={{ width: `${Math.max(pct, collection && collection.totalMinted ? 1.2 : 0)}%` }} /></div>
            {!loadError && collection && (
              <p className="next">{soldOut ? "Colección completa" : <>Próxima: <b>#{nextId}</b></>}</p>
            )}
            {loadError && <p className="status error">{loadError}</p>}

            {authenticated && smartAccount && (
              <div className="rows">
                <div className="row">
                  <span>Cuenta</span>
                  <code>{short(smartAccount)}{!accountExists && " · nueva"}</code>
                </div>
                <div className="row">
                  <span>Tus flores</span>
                  <code>{balance ?? "—"}</code>
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              className="btn big"
              disabled={!ready || !authenticated || busy || !configured || soldOut}
              onClick={onMint}
            >
              {/* Sin el id: entre leer totalMinted y que el UserOp entre puede mintear
                  otro usuario, así que el número del botón podría no ser el que sale. */}
              {busy ? "Minteando…" : soldOut ? "Agotado" : "Mintear un NFT"}
            </button>
            {status.message && <p className={`status ${status.state}`}>{status.message}</p>}
          </div>
        </section>

        <nav className="tabs">
          <button className="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            Galería <i>{tokens.length}</i>
          </button>
          <button className="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
            Mis flores <i>{mine.length}</i>
          </button>
          <span className="spacer" />
          <button className="btn-ghost" onClick={() => void refresh()} disabled={!configured}>Actualizar</button>
        </nav>

        {list.length === 0 ? (
          <p className="empty">
            {tab === "mine" ? "Todavía no tenés ninguna." : "Todavía no se minteó ninguna."}
          </p>
        ) : (
          <div className="grid">
            {list.map((t) => (
              <button
                key={t.id}
                className={`tile${t.owner.toLowerCase() === mineKey ? " mine" : ""}`}
                onClick={() => void openToken(t.id)}
              >
                <PixImg id={t.id} className="" />
                {t.owner.toLowerCase() === mineKey && <span className="own" />}
                <span className="id">#{t.id}</span>
              </button>
            ))}
          </div>
        )}

        {open != null && (
          <div className="overlay" onClick={() => setOpen(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>Flor #{open}</h2>
                <button className="close" onClick={() => setOpen(null)} aria-label="Cerrar">×</button>
              </header>
              <PixImg id={open} className="shot" />

              <div className="owner">
                <span className="k">Dueño</span>
                {openOwner ? (
                  <a href={explorerAddress(openOwner)} target="_blank" rel="noreferrer">{openOwner}</a>
                ) : (
                  <span className="mail">—</span>
                )}
                {/* El email solo se conoce para el usuario logueado: no hay forma
                    de saber el mail del dueño de una flor ajena. */}
                {openIsMine && userEmail && <span className="mail">{userEmail}</span>}
                {openIsMine && <span className="badge">tuya</span>}
              </div>

              {openMeta === "error" && <p className="status error">No se pudo leer el metadata.</p>}
              {openMeta && typeof openMeta === "object" && (
                <ul className="traits">
                  {openMeta.attributes.map((a) => (
                    <li key={a.trait_type} className={a.trait_type === "Rareza" ? "hl" : undefined}>
                      <span className="k">{a.trait_type}</span>
                      <span className="v">{String(a.value)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="actions">
                <a className="primary" href={explorerToken(open)} target="_blank" rel="noreferrer">
                  Ver en el explorador ↗
                </a>
                <a className="secondary" href={metadataUrl(open)} target="_blank" rel="noreferrer">
                  tokenURI ↗
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
