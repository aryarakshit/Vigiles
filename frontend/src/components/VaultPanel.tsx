"use client";

import React, { useState } from "react";
import { TOKEN_LIST, TOKENS, type TokenSymbol } from "../config/contracts";
import { useVault } from "../state/useVault";
import { Button, Field, Label, Panel, Stat, fmtShares, toWei } from "./ui";

export function VaultPanel() {
  const { api, snap, run, tokenAddress, mode } = useVault();
  const [sym, setSym] = useState<TokenSymbol>("AAPL");
  const [amt, setAmt] = useState("25");
  const [busy, setBusy] = useState<string | null>(null);

  const wei = toWei(amt);
  const total = TOKEN_LIST.reduce((acc, t) => acc + Number(snap.vault[t.symbol]) / 1e18, 0);
  const refUsd = TOKEN_LIST.reduce((acc, t) => acc + (Number(snap.vault[t.symbol]) / 1e18) * TOKENS[t.symbol].refUsd, 0);

  const go = async (label: string, fn: () => Promise<`0x${string}` | null>) => {
    setBusy(label);
    await run(label, fn);
    setBusy(null);
  };

  return (
    <Panel idx="01" title="Vault" right={<span className="label">{mode === "sim" ? "In memory" : "On-chain"}</span>}>
      {/* three cells, rules between them */}
      <div className="grid grid-cols-3 border-b border-ink/15">
        {TOKEN_LIST.map((t, i) => (
          <Stat key={t.symbol} label={t.symbol} value={fmtShares(snap.vault[t.symbol], 1)} sub={`Wallet ${fmtShares(snap.wallet[t.symbol], 0)}`} className={i < 2 ? "border-r border-ink/15" : ""} />
        ))}
      </div>

      <div className="p-5 md:p-6 flex flex-col gap-5">
        <div className="grid grid-cols-[1.4fr_1fr] gap-4">
          <Field label="Token">
            <select className="field" value={sym} onChange={(e) => setSym(e.target.value as TokenSymbol)}>
              {TOKEN_LIST.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol} · {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shares">
            <input className="field" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-px bg-ink/20 border border-ink/40">
          <Button className="!border-0 h-14" disabled={!api || wei === 0n || !!busy} onClick={() => go(`Deposit ${amt} ${sym}`, () => api!.deposit(tokenAddress(sym), wei))}>
            {busy?.startsWith("Deposit") ? "…" : "Deposit"}
          </Button>
          <Button variant="secondary" className="!border-0 h-14 bg-page" disabled={!api || wei === 0n || !!busy} onClick={() => go(`Withdraw ${amt} ${sym}`, () => api!.withdraw(tokenAddress(sym), wei))}>
            {busy?.startsWith("Withdraw") ? "…" : "Withdraw"}
          </Button>
          <Button variant="ghost" size="sm" className="!border-0 col-span-2 h-12 bg-page" disabled={!api || !!busy} onClick={() => go(`Faucet 100 ${sym}`, () => api!.faucet(tokenAddress(sym), 100n * 10n ** 18n))}>
            Faucet · mint 100 {sym}
          </Button>
        </div>
      </div>

      {/* running total band */}
      <div className="border-t border-ink/15 bg-mute p-5 md:p-6 grid grid-cols-[1fr_auto] items-end gap-4">
        <div>
          <Label>Total in vault</Label>
          <div className="num text-3xl mt-2">{total.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-medium text-ink/55">shares</span></div>
        </div>
        <div className="meta text-right">≈ ${refUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} at ref. prices</div>
        <p className="col-span-2 meta leading-snug">Funds never leave this contract. An agent can move value between whitelisted tokens inside it — it can never withdraw.</p>
      </div>
    </Panel>
  );
}
