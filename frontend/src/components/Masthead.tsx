"use client";

import React from "react";
import { DEPLOYMENT, EXPLORER_URL, ROBINHOOD_CHAIN } from "../config/contracts";
import { useVault } from "../state/useVault";
import { Addr, Mark } from "./ui";

export function Masthead() {
  const { mode, deployed, user, connect, disconnect, connecting, walletAvailable } = useVault();

  return (
    <>
      <header className="border-b border-ink/30">
        <div className="mx-auto max-w-[1440px] grid grid-cols-[auto_1fr_auto] items-stretch min-h-[72px]">
          {/* logo mark: bar, green bar, bar — the cage in three glyphs */}
          <a href="#" className="flex items-center gap-4 px-5 md:px-8 group" aria-label="Vigiles">
            <span className="flex items-end gap-[3px]" aria-hidden>
              <span className="block w-3 h-6 bg-ink" />
              <span className="block w-3 h-6 bg-accent transition-transform duration-150 ease-out group-hover:-translate-y-1" />
              <span className="block w-3 h-6 bg-ink" />
            </span>
            <span className="h text-lg md:text-xl">Vigiles</span>
          </a>

          <div className="hidden md:flex items-center px-4">
            <span className="text-[14px] text-ink/55">Session keys, not wallet keys</span>
          </div>

          <div className="flex items-stretch">
            <div className="hidden lg:flex items-center gap-2 px-6 text-[13px] text-ink/60">
              <Mark state={mode === "onchain" ? "ok" : "warn"} />
              {mode === "onchain" ? `${ROBINHOOD_CHAIN.name} · ${ROBINHOOD_CHAIN.id}` : "Simulation"}
            </div>
            {DEPLOYMENT.agentVault && (
              <a className="hidden lg:flex items-center px-6 link text-[13px]" href={`${EXPLORER_URL}/address/${DEPLOYMENT.agentVault}`} target="_blank" rel="noreferrer">
                vault <Addr a={DEPLOYMENT.agentVault} chars={4} />
              </a>
            )}
            <div className="flex items-stretch border-l border-ink/30">
              {mode === "onchain" && user ? (
                <button className="px-6 text-[14px] font-semibold hover:text-accent transition-colors duration-150" onClick={disconnect}>
                  <Addr a={user} /> · disconnect
                </button>
              ) : (
                <button
                  className="px-6 md:px-8 bg-ink text-page text-[14px] font-semibold hover:bg-accent transition-colors duration-150 disabled:bg-transparent disabled:text-ink/35"
                  onClick={connect}
                  disabled={connecting}
                  title={!deployed ? "Deploy the vault first (scripts/deploy_stylus.sh)" : !walletAvailable ? "No EIP-1193 wallet detected" : ""}
                >
                  {connecting ? "Connecting…" : "Connect"}
                  <span className="hidden sm:inline">&nbsp;wallet</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {mode === "sim" && (
        <div className="border-b border-ink/15 bg-mute">
          <div className="mx-auto max-w-[1440px] px-5 md:px-8 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
            <span className="text-accent font-semibold">Simulation.</span>
            <span className="text-ink/75">Same rules as the Stylus vault, nothing on-chain.</span>
            <span className="text-ink/45">{deployed ? "Connect a wallet to switch to Robinhood Chain." : "Vault not deployed yet — run scripts/deploy_stylus.sh."}</span>
          </div>
        </div>
      )}
    </>
  );
}
