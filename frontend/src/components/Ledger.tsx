"use client";

import React, { useMemo, useState } from "react";
import { keccak256, stringToHex } from "viem";
import { useVault } from "../state/useVault";
import { Button, Label, Mark, Panel, TxLink } from "./ui";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Ledger() {
  const { snap, intents, refresh, loading, mode } = useVault();
  const [tab, setTab] = useState<"events" | "intents">("events");
  const [probe, setProbe] = useState("");

  const onChainHashes = useMemo(() => new Set(snap.events.filter((e) => e.intentHash).map((e) => e.intentHash!.toLowerCase())), [snap.events]);
  const probeHash = probe ? keccak256(stringToHex(probe)) : null;
  const probeMatch = probeHash ? onChainHashes.has(probeHash.toLowerCase()) : null;

  return (
    <Panel
      idx="04"
      title="Ledger"
      right={
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      }
    >
      {/* tabs as a two-cell bar */}
      <div className="grid grid-cols-2 border-b border-ink/15">
        {(["events", "intents"] as const).map((t) => (
          <button
            key={t}
            className={`h-12 text-[14px] font-semibold capitalize transition-colors duration-150 border-b-2 -mb-px ${tab === t ? "border-accent text-ink" : "border-transparent text-ink/50 hover:text-ink"}`}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
          >
            {t} · {t === "events" ? snap.events.length : intents.length}
          </button>
        ))}
      </div>

      {tab === "events" ? (
        <div className="max-h-[440px] overflow-y-auto">
          {snap.events.length === 0 ? (
            <div className="px-5 py-5 meta">No entries for this user/agent yet.</div>
          ) : (
            snap.events.map((e) => (
              <div key={e.id} className={`row ${e.kind === "Blocked" ? "row-block" : ""}`}>
                <Mark state={e.kind === "Blocked" ? "block" : e.kind === "TradeExecuted" || e.kind === "IntentRecorded" ? "ok" : "idle"} />
                <span className="meta">{e.timestamp ? hhmm(e.timestamp * 1000) : `#${e.blockNumber}`}</span>
                <span className="min-w-0 leading-tight">
                  <span className={`font-semibold text-[14px] ${e.kind === "Blocked" ? "text-accent" : ""}`}>{e.kind}</span>
                  <span className="block meta truncate mt-0.5">
                    {e.summary}
                    {e.intentHash && <span className="text-ink/40"> · {e.intentHash.slice(0, 12)}…</span>}
                  </span>
                </span>
                {mode === "onchain" ? <TxLink hash={e.txHash} /> : <span />}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="p-5 border-b border-ink/15 flex flex-col gap-3 bg-mute">
            <Label>Verify a rationale against the chain</Label>
            <textarea className="field h-20 resize-none" placeholder="Paste the exact plaintext an agent claims it committed…" value={probe} onChange={(e) => setProbe(e.target.value)} />
            {probeHash && (
              <div className="flex items-start gap-3 text-[13px]">
                <Mark state={probeMatch ? "ok" : "block"} />
                <div className="min-w-0">
                  <div className={`font-semibold text-[14px] ${probeMatch ? "" : "text-accent"}`}>{probeMatch ? "Matches an on-chain IntentRecorded" : "No on-chain match — altered or never committed"}</div>
                  <div className="meta truncate mt-0.5">{probeHash}</div>
                </div>
              </div>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {intents.length === 0 ? (
              <div className="px-5 py-5 meta">No rationales recorded in this browser yet.</div>
            ) : (
              intents.map((i) => {
                const committed = onChainHashes.has(i.hash.toLowerCase());
                return (
                  <div key={i.hash} className="row">
                    <Mark state={committed ? "ok" : "idle"} />
                    <span className="meta">{hhmm(i.at)}</span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13px]">{i.text}</span>
                      <span className="block meta truncate mt-0.5">
                        {i.hash.slice(0, 16)}… · {committed ? "committed" : "not on-chain (trade was blocked)"}
                      </span>
                    </span>
                    <span />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
