"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DEPLOYMENT, IS_DEPLOYED, TOKEN_LIST, type TokenSymbol } from "../config/contracts";
import { type Counters, type Guards, EMPTY_COUNTERS, EMPTY_GUARDS, type VaultError } from "../lib/guards";
import { connectInjected, hasInjectedWallet, OnchainVault } from "../lib/onchain";
import { SIM_ADAPTER, SIM_TOKENS, SimVault } from "../lib/sim";
import { type AgentIdentity, type LedgerEvent, type PolicyView, type SessionView, type VaultApi, VaultRevert } from "../lib/vault";

export type Mode = "onchain" | "sim";

export interface Toast {
  id: number;
  tone: "ok" | "block" | "info";
  title: string;
  body?: string;
  txHash?: Hex | null;
}

export interface Snapshot {
  wallet: Record<TokenSymbol, bigint>;
  vault: Record<TokenSymbol, bigint>;
  agentEth: bigint;
  session: SessionView;
  policies: Record<TokenSymbol, PolicyView>;
  guards: Guards & Counters;
  caps: Record<TokenSymbol, bigint>;
  canTradeNow: boolean;
  events: LedgerEvent[];
}

const EMPTY_SNAPSHOT: Snapshot = {
  wallet: { AAPL: 0n, TSLA: 0n, NVDA: 0n },
  vault: { AAPL: 0n, TSLA: 0n, NVDA: 0n },
  agentEth: 0n,
  session: { active: false, expiry: 0, epoch: 0 },
  policies: {
    AAPL: { allowed: false, perTradeCap: 0n, dailyCap: 0n, availableNow: 0n },
    TSLA: { allowed: false, perTradeCap: 0n, dailyCap: 0n, availableNow: 0n },
    NVDA: { allowed: false, perTradeCap: 0n, dailyCap: 0n, availableNow: 0n },
  },
  guards: { ...EMPTY_GUARDS, ...EMPTY_COUNTERS },
  caps: { AAPL: 0n, TSLA: 0n, NVDA: 0n },
  canTradeNow: true,
  events: [],
};

/** Plaintext rationales the agent committed to on-chain, keyed by keccak hash. Local-only. */
export interface IntentRecord {
  hash: Hex;
  text: string;
  at: number;
}

interface Ctx {
  mode: Mode;
  setMode: (m: Mode) => void;
  deployed: boolean;
  walletAvailable: boolean;
  connecting: boolean;
  api: VaultApi | null;
  user: Address | null;
  agent: AgentIdentity;
  rotateAgent: () => void;
  snap: Snapshot;
  loading: boolean;
  refresh: () => Promise<void>;
  toasts: Toast[];
  dismiss: (id: number) => void;
  /** Runs a write, shows the outcome, refreshes. Returns true on success. */
  run: (label: string, fn: () => Promise<Hex | null>) => Promise<boolean>;
  tokenAddress: (s: TokenSymbol) => Address;
  adapterAddress: Address;
  intents: IntentRecord[];
  rememberIntent: (text: string) => Hex;
  connect: () => Promise<void>;
  disconnect: () => void;
  lastBlock: VaultError | null;
  setLastBlock: (e: VaultError | null) => void;
}

const VaultCtx = createContext<Ctx | null>(null);

const LS_AGENT = "vigiles.agent";
const LS_INTENTS = "vigiles.intents";

function loadAgent(): AgentIdentity {
  try {
    const raw = localStorage.getItem(LS_AGENT);
    if (raw) {
      const pk = JSON.parse(raw) as Hex;
      return { privateKey: pk, address: privateKeyToAccount(pk).address };
    }
  } catch {
    /* fall through */
  }
  const pk = generatePrivateKey();
  try {
    localStorage.setItem(LS_AGENT, JSON.stringify(pk));
  } catch {
    /* private window */
  }
  return { privateKey: pk, address: privateKeyToAccount(pk).address };
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("sim");
  const [api, setApi] = useState<VaultApi | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [agent, setAgent] = useState<AgentIdentity>({ address: "0x0000000000000000000000000000000000000000", privateKey: "0x" });
  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [intents, setIntents] = useState<IntentRecord[]>([]);
  const [lastBlock, setLastBlock] = useState<VaultError | null>(null);
  const simRef = useRef<SimVault | null>(null);
  const toastId = useRef(0);

  const walletAvailable = typeof window !== "undefined" && hasInjectedWallet();

  // Boot: agent identity, remembered intents, default to sim.
  useEffect(() => {
    setAgent(loadAgent());
    try {
      const raw = localStorage.getItem(LS_INTENTS);
      if (raw) setIntents(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    simRef.current = new SimVault();
    setApi(simRef.current);
  }, []);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((p) => [{ id, ...t }, ...p].slice(0, 6));
    window.setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 9000);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  const tokenAddress = useCallback(
    (s: TokenSymbol): Address => (mode === "sim" ? SIM_TOKENS[s] : (TOKEN_LIST.find((t) => t.symbol === s)!.address as Address)),
    [mode],
  );
  const adapterAddress: Address = mode === "sim" ? SIM_ADAPTER : (DEPLOYMENT.swapAdapter as Address) ?? SIM_ADAPTER;

  const refresh = useCallback(async () => {
    if (!api || agent.privateKey === "0x") return;
    setLoading(true);
    try {
      const a = agent.address;
      const syms = TOKEN_LIST.map((t) => t.symbol);
      const addr = (s: TokenSymbol) => (api.mode === "sim" ? SIM_TOKENS[s] : (TOKEN_LIST.find((t) => t.symbol === s)!.address as Address));
      const [wallet, vault, policies, caps, agentEth, session, guards, canTradeNow, events] = await Promise.all([
        Promise.all(syms.map((s) => api.walletBalance(addr(s)))),
        Promise.all(syms.map((s) => api.vaultBalance(addr(s)))),
        Promise.all(syms.map((s) => api.tokenPolicy(a, addr(s)))),
        Promise.all(syms.map((s) => api.positionCap(a, addr(s)))),
        api.nativeBalance(a),
        api.session(a),
        api.guards(a),
        api.canTradeNow(a),
        api.events(a),
      ]);
      const rec = <T,>(vals: T[]) => Object.fromEntries(syms.map((s, i) => [s, vals[i]])) as Record<TokenSymbol, T>;
      setSnap({ wallet: rec(wallet), vault: rec(vault), policies: rec(policies), caps: rec(caps), agentEth, session, guards, canTradeNow, events });
    } catch (e) {
      push({ tone: "block", title: "Read failed", body: (e as Error).message.slice(0, 160) });
    } finally {
      setLoading(false);
    }
  }, [api, agent, push]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<Hex | null>) => {
      try {
        const tx = await fn();
        push({ tone: "ok", title: label, txHash: tx });
        await refresh();
        return true;
      } catch (e) {
        if (e instanceof VaultRevert) {
          setLastBlock(e.name);
          push({ tone: "block", title: `${label} · blocked by vault`, body: e.name });
        } else {
          const msg = (e as Error).message ?? String(e);
          push({ tone: "block", title: `${label} · failed`, body: msg.split("\n")[0].slice(0, 180) });
        }
        await refresh();
        return false;
      }
    },
    [push, refresh],
  );

  const connect = useCallback(async () => {
    if (!IS_DEPLOYED) {
      push({ tone: "info", title: "Vault not deployed yet", body: "deployments/robinhood-testnet.json has no addresses. Run scripts/deploy_stylus.sh, then reload." });
      return;
    }
    if (!hasInjectedWallet()) {
      push({ tone: "info", title: "No wallet found", body: "Install MetaMask (or any EIP-1193 wallet) to use the on-chain vault." });
      return;
    }
    setConnecting(true);
    try {
      const { address, wallet } = await connectInjected();
      setApi(new OnchainVault(address, wallet));
      setModeState("onchain");
      push({ tone: "ok", title: "Connected to Robinhood Chain", body: address });
    } catch (e) {
      push({ tone: "block", title: "Connect failed", body: (e as Error).message.split("\n")[0].slice(0, 160) });
    } finally {
      setConnecting(false);
    }
  }, [push]);

  const disconnect = useCallback(() => {
    setApi(simRef.current);
    setModeState("sim");
  }, []);

  const setMode = useCallback(
    (m: Mode) => {
      if (m === "onchain") void connect();
      else disconnect();
    },
    [connect, disconnect],
  );

  const rotateAgent = useCallback(() => {
    try {
      localStorage.removeItem(LS_AGENT);
    } catch {
      /* ignore */
    }
    setAgent(loadAgent());
  }, []);

  const rememberIntent = useCallback((text: string): Hex => {
    const hash = keccak256(stringToHex(text));
    setIntents((prev) => {
      const next = [{ hash, text, at: Date.now() }, ...prev.filter((i) => i.hash !== hash)].slice(0, 50);
      try {
        localStorage.setItem(LS_INTENTS, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    return hash;
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      mode,
      setMode,
      deployed: IS_DEPLOYED,
      walletAvailable,
      connecting,
      api,
      user: api?.user ?? null,
      agent,
      rotateAgent,
      snap,
      loading,
      refresh,
      toasts,
      dismiss,
      run,
      tokenAddress,
      adapterAddress,
      intents,
      rememberIntent,
      connect,
      disconnect,
      lastBlock,
      setLastBlock,
    }),
    [mode, setMode, walletAvailable, connecting, api, agent, rotateAgent, snap, loading, refresh, toasts, dismiss, run, tokenAddress, adapterAddress, intents, rememberIntent, connect, disconnect, lastBlock],
  );

  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export function useVault(): Ctx {
  const ctx = useContext(VaultCtx);
  if (!ctx) throw new Error("useVault outside VaultProvider");
  return ctx;
}
