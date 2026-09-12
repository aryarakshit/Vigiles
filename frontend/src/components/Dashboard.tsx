"use client";

import { ArrowUpRight } from "lucide-react";
import React from "react";
import { AgentConsole } from "./AgentConsole";
import { CageBuilder } from "./CageBuilder";
import { Ledger } from "./Ledger";
import { Masthead } from "./Masthead";
import { Idx, Mark, TxLink } from "./ui";
import { VaultPanel } from "./VaultPanel";
import { DEPLOYMENT } from "../config/contracts";
import { ERROR_COPY } from "../lib/guards";
import { VaultProvider, useVault } from "../state/useVault";

const GUARDS = [
  { n: "01", name: "Spend caps", what: "Per-trade and rolling-24h budget per token. Linear refill, no midnight double-dip.", err: "SpendLimitExceeded" },
  { n: "02", name: "Whitelist", what: "Tokens and venues the agent may touch. Everything else does not exist to it.", err: "TokenNotAllowed" },
  { n: "03", name: "Trading window", what: "UTC hours and weekdays. Tokenized stocks trade 24/5; liquidity does not.", err: "OutsideTradingWindow" },
  { n: "04", name: "Velocity limit", what: "Max trades per rolling hour. LLM agents fail by repetition, not just size.", err: "VelocityLimitExceeded" },
  { n: "05", name: "Position cap", what: "Max holding per ticker. Bounds the buy side the way daily caps bound the sell side.", err: "PositionCapExceeded" },
  { n: "06", name: "Dead-man switch", what: "Miss a heartbeat and the agent freezes until you check in.", err: "HeartbeatMissed" },
  { n: "07", name: "Intent receipts", what: "Every trade commits keccak(rationale) on-chain. No receipt, no trade.", err: "MissingIntent" },
  { n: "08", name: "Price floor", what: "Chainlink-priced minimum output, per user, with a sequencer-uptime check. No admin key.", err: "SlippageExceeded" },
] as const;

/** The cage, as geometric abstraction: a frame, five bars, one green circle. */
function CageComposition() {
  return (
    <div className="relative border border-ink/40 bg-mute swiss-grid-pattern aspect-[4/3] overflow-hidden" aria-hidden>
      <div className="absolute inset-8 md:inset-10 flex justify-between">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="block w-2.5 md:w-3 h-full bg-ink" />
        ))}
      </div>
      <span className="absolute left-[39%] top-[36%] w-[22%] aspect-square rounded-full bg-accent" />
    </div>
  );
}

function Hero() {
  const { lastBlock } = useVault();
  return (
    <section className="border-b border-ink/30">
      <div className="mx-auto max-w-[1440px] grid grid-cols-1 lg:grid-cols-12">
        {/* 7 : 5 — words on the left, geometry on the right */}
        <div className="lg:col-span-7 p-6 md:p-12 lg:p-16 border-b lg:border-b-0 lg:border-r border-ink/30 flex flex-col justify-between gap-14">
          <div>
            <Idx n="00">Robinhood Chain · Arbitrum Stylus · Rust</Idx>
            <h1 className="display text-6xl md:text-8xl xl:text-[6rem] mt-6">
              Give the
              <br />
              agent a<br />
              <span className="text-accent">cage</span>, not
              <br />
              your wallet.
            </h1>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
            <p className="md:col-span-8 max-w-xl text-base md:text-lg leading-relaxed text-ink/75">
              Deposit tokenized stocks into a vault that never releases them. Mint a revocable session key for your AI agent with hard, on-chain limits. A hijacked or hallucinating agent can only trade inside the cage — and the contract, not a prompt, decides where the bars are.
            </p>
            <div className="md:col-span-4 md:text-right">
              <a href="#workbench" className="btn btn-lg w-full md:w-auto group !inline-flex">
                Open the workbench
                <ArrowUpRight strokeWidth={2.5} className="w-5 h-5 transition-transform duration-150 ease-out group-hover:rotate-45" />
              </a>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col">
          <div className="p-8 md:p-12 border-b border-ink/30">
            <CageComposition />
          </div>

          {/* facts, as a quiet list */}
          <dl className="px-8 md:px-12 py-6 grid grid-cols-[1fr_auto] gap-y-3 text-[14px]">
            {[
              ["Stylus WASM", "23.8 KB brotli"],
              ["Tests", "50 Foundry · 35 Rust"],
              ["Invariant fuzz", "128k calls"],
              ["unsafe blocks", "0"],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-ink/55">{k}</dt>
                <dd className="font-semibold tabular-nums text-right">{v}</dd>
              </React.Fragment>
            ))}
            <dt className="text-ink/55">Deployed</dt>
            <dd className="font-semibold text-right">{DEPLOYMENT.agentVault ? <TxLink hash={DEPLOYMENT.deployTx} label="deploy" /> : <span className="text-accent">Pending</span>}</dd>
          </dl>

          {/* last refusal: the signal, in the signal colour */}
          <div className={`mt-auto border-t border-ink/30 p-8 md:p-12 ${lastBlock ? "bg-accent text-page" : ""}`}>
            <div className={`label ${lastBlock ? "!text-page/70" : ""}`}>Last refusal</div>
            {lastBlock ? (
              <>
                <div className="h text-2xl md:text-3xl mt-2 break-all">{lastBlock}</div>
                <div className="mt-2 text-[14px] leading-relaxed text-page/80">{ERROR_COPY[lastBlock]}</div>
              </>
            ) : (
              <div className="mt-2 flex items-center gap-3 text-ink/50 text-[14px]">
                <Mark state="idle" /> None yet. Attack the cage below.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function GuardTable() {
  return (
    <section className="border-b border-ink/30">
      <div className="mx-auto max-w-[1440px] grid grid-cols-1 lg:grid-cols-12">
        {/* 4 : 8 — a quiet label column, then the list */}
        <div className="lg:col-span-4 p-6 md:p-12 lg:p-16 border-b lg:border-b-0 lg:border-r border-ink/30">
          <div className="lg:sticky lg:top-10">
            <Idx n="01">System</Idx>
            <h2 className="display text-5xl md:text-7xl mt-5">
              Eight
              <br />
              bars.
            </h2>
            <p className="mt-6 max-w-sm text-ink/70 text-[15px] leading-relaxed">
              Every bar is checked inside <span className="font-semibold text-ink">executeTrade</span>, in a fixed order, before any external call. The first bar hit is the one reported. <span className="text-accent font-semibold">Green</span> marks a refusal: the cage doing its job.
            </p>
          </div>
        </div>

        <ol className="lg:col-span-8 py-2 md:py-4">
          {GUARDS.map((g, i) => (
            <li
              key={g.n}
              className={`group grid grid-cols-[56px_1fr] md:grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 px-6 md:px-12 py-6 ${i < GUARDS.length - 1 ? "border-b border-ink/15" : ""} transition-colors duration-150 hover:bg-mute cursor-default`}
            >
              <span className="num text-xl md:text-2xl text-accent">{g.n}</span>
              <div className="min-w-0">
                <div className="h text-lg md:text-xl transition-colors duration-150 group-hover:text-accent">{g.name}</div>
                <div className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-ink/65">{g.what}</div>
              </div>
              <span className="col-start-2 md:col-start-3 text-[11px] uppercase tracking-[0.12em] text-ink/45 group-hover:text-accent transition-colors duration-150 md:text-right">{g.err}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Toasts() {
  const { toasts, dismiss } = useVault();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2.5rem)]">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "block" ? "toast-block" : ""}`}>
          <Mark state={t.tone === "block" ? "block" : t.tone === "ok" ? "ok" : "warn"} />
          <div className="min-w-0">
            <div className="font-semibold text-[14px]">{t.title}</div>
            {t.body && <div className="meta break-words mt-1">{t.body}</div>}
            {t.txHash && (
              <div className="mt-1">
                <TxLink hash={t.txHash} />
              </div>
            )}
          </div>
          <button className="text-ink/50 hover:text-accent text-lg leading-none" onClick={() => dismiss(t.id)} aria-label="dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink/30">
      <div className="mx-auto max-w-[1440px] grid grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-6 p-6 md:p-10 border-b md:border-b-0 md:border-r border-ink/15">
          <div className="h text-xl">Vigiles</div>
          <div className="meta mt-2">After the night watch of Rome. Arbitrum Open House Singapore Buildathon 2026 · MIT</div>
        </div>
        {[
          ["GitHub", "https://github.com/aryarakshit/vigiles"],
          ["Stylus source", "https://github.com/aryarakshit/vigiles/tree/main/vigiles-vault/src"],
          ["MCP server", "https://github.com/aryarakshit/vigiles/tree/main/mcp"],
        ].map(([label, href], i) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`md:col-span-2 p-6 md:p-10 flex items-center justify-between gap-3 text-[14px] font-semibold hover:text-accent transition-colors duration-150 group ${i < 2 ? "border-b md:border-b-0 md:border-r border-ink/15" : ""}`}
          >
            {label}
            <ArrowUpRight strokeWidth={2.5} className="w-4 h-4 transition-transform duration-150 ease-out group-hover:rotate-45" />
          </a>
        ))}
      </div>
    </footer>
  );
}

export function Dashboard() {
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  );
}

function Shell() {
  return (
    <main className="min-h-screen flex flex-col">
      <Masthead />
      <Hero />
      <GuardTable />
      {/* the workbench: one grid, rules drawn as borders, panels share edges */}
      <section id="workbench" className="mx-auto max-w-[1440px] w-full">
        <div className="px-6 md:px-12 pt-14 pb-8 flex items-baseline justify-between">
          <div>
            <Idx n="02">Workbench</Idx>
            <h2 className="h text-3xl md:text-4xl mt-3">Build the cage, then try to break it.</h2>
          </div>
          <span className="meta hidden md:inline">Deposit → grant → guardrails → execute → attack</span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,4fr)] border-t border-ink/30">
          <div className="flex flex-col xl:border-r border-ink/30">
            <VaultPanel />
            <Ledger />
          </div>
          <CageBuilder />
          <div className="xl:border-l border-ink/30">
            <AgentConsole />
          </div>
        </div>
      </section>
      <Footer />
      <Toasts />
    </main>
  );
}
