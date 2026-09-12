"use client";

import { Activity } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { NYSE_WINDOW, TOKEN_LIST, TOKENS, type TokenSymbol } from "../config/contracts";
import { WEEKDAY_LABELS, authorizeSessionGuards, fmtSod, isWithinTradingWindow, parseSod, type Guards } from "../lib/guards";
import { useVault } from "../state/useVault";
import { Addr, Button, Field, Label, Mark, Panel, Tag, fmtDuration, fmtShares, toWei } from "./ui";

interface TokenRow {
  on: boolean;
  perTrade: string;
  daily: string;
  cap: string;
}

const DEFAULT_ROWS: Record<TokenSymbol, TokenRow> = {
  AAPL: { on: true, perTrade: "5", daily: "20", cap: "60" },
  TSLA: { on: true, perTrade: "5", daily: "20", cap: "12" },
  NVDA: { on: false, perTrade: "5", daily: "20", cap: "0" },
};

export function CageBuilder() {
  const { api, snap, run, agent, tokenAddress, adapterAddress, refresh } = useVault();
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [days, setDays] = useState("7");
  // Default to 24/7 so a first trade succeeds on any day; NYSE hours is one click away.
  const [start, setStart] = useState("00:00");
  const [end, setEnd] = useState("00:00");
  const [mask, setMask] = useState<number>(0);
  const [perHour, setPerHour] = useState("5");
  const [hbHours, setHbHours] = useState("24");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Hydrate the guard editor from chain state once a session exists.
  useEffect(() => {
    const g = snap.guards;
    if (g.windowStart === 0 && g.windowEnd === 0 && g.weekdayMask === 0 && g.maxTradesPerHour === 0 && g.heartbeatInterval === 0) return;
    setStart(fmtSod(g.windowStart));
    setEnd(fmtSod(g.windowEnd));
    setMask(g.weekdayMask);
    setPerHour(String(g.maxTradesPerHour));
    setHbHours(String(g.heartbeatInterval / 3600));
  }, [snap.guards]);

  const draft: Guards = useMemo(
    () => ({
      windowStart: parseSod(start),
      windowEnd: parseSod(end),
      weekdayMask: mask,
      maxTradesPerHour: Math.max(0, parseInt(perHour || "0", 10) || 0),
      heartbeatInterval: Math.max(0, Math.round((parseFloat(hbHours || "0") || 0) * 3600)),
    }),
    [start, end, mask, perHour, hbHours],
  );

  // Applying guards stamps a heartbeat, so preview the draft as if freshly applied.
  const draftVerdict = authorizeSessionGuards(now, draft, { ...snap.guards, lastHeartbeat: now }, false);
  const liveVerdict = authorizeSessionGuards(now, snap.guards, snap.guards, false);
  const session = snap.session;
  const hbLeft = snap.guards.heartbeatInterval ? snap.guards.heartbeatInterval - (now - snap.guards.lastHeartbeat) : null;

  const worstCaseUsd = TOKEN_LIST.filter((t) => rows[t.symbol].on).reduce((acc, t) => acc + (parseFloat(rows[t.symbol].daily) || 0) * TOKENS[t.symbol].refUsd, 0);

  const go = async (label: string, fn: () => Promise<`0x${string}` | null>) => {
    setBusy(label);
    const ok = await run(label, fn);
    setBusy(null);
    return ok;
  };

  // Position caps are their own transaction (setPositionCap), keyed to the current epoch.
  const setCaps = async (current: Partial<Record<TokenSymbol, bigint>>) => {
    for (const t of TOKEN_LIST) {
      if (!rows[t.symbol].on) continue;
      const want = toWei(rows[t.symbol].cap);
      if (want !== (current[t.symbol] ?? 0n)) {
        await go(`Position cap ${t.symbol}`, () => api!.setPositionCap(agent.address, tokenAddress(t.symbol), want));
      }
    }
  };

  const grant = async () => {
    const on = TOKEN_LIST.filter((t) => rows[t.symbol].on);
    if (!on.length) return;
    const expiry = now + Math.max(1, parseInt(days || "1", 10)) * 86400;
    const ok = await go("Grant session key", () =>
      api!.createSessionKey(
        agent.address,
        expiry,
        on.map((t) => tokenAddress(t.symbol)),
        on.map((t) => toWei(rows[t.symbol].perTrade)),
        on.map((t) => toWei(rows[t.symbol].daily)),
        [adapterAddress],
      ),
    );
    if (!ok) return;
    // A new epoch starts with no caps, so the "Max hold" column is applied right away.
    await setCaps({});
    await refresh();
  };

  const applyGuards = async () => {
    const ok = await go("Apply guardrails", () => api!.setSessionGuards(agent.address, draft));
    if (!ok) return;
    await setCaps(snap.caps);
    await refresh();
  };

  const toggleDay = (i: number) => setMask((m) => m ^ (1 << i));
  const presetNyse = () => {
    setStart(fmtSod(NYSE_WINDOW.start));
    setEnd(fmtSod(NYSE_WINDOW.end));
    setMask(NYSE_WINDOW.weekdays);
  };
  const presetAlways = () => {
    setStart("00:00");
    setEnd("00:00");
    setMask(0);
  };

  const Verdict = ({ label, ok, error, sub }: { label: string; ok: boolean; error?: string; sub?: React.ReactNode }) => (
    <div className={`p-4 border ${ok ? "border-ink/25" : "border-accent"} min-w-0`}>
      <Label>{label}</Label>
      <div className="flex items-start gap-3 mt-2">
        <Mark state={ok ? "ok" : "block"} />
        <div className={`h !text-[14px] !tracking-normal leading-tight break-words ${ok ? "" : "text-accent"}`}>{ok ? "Would admit" : error}</div>
      </div>
      {sub && <div className="meta mt-2">{sub}</div>}
    </div>
  );

  return (
    <Panel
      idx="02"
      title="The cage"
      right={
        <span className="flex items-center gap-2 text-[13px] text-ink/60 whitespace-nowrap">
          <Mark state={session.active ? "ok" : "idle"} />
          {session.active ? `Active · epoch ${session.epoch} · ${fmtDuration(session.expiry - now)} left` : "No session key yet"}
        </span>
      }
    >
      {/* ---- Session key ---- */}
      <div className="p-5 md:p-6 flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
          <Field label="Agent · session key holder" hint="An ephemeral key generated in this browser. Your wallet key is never shared.">
            <div className="field flex items-center justify-between gap-3">
              <span className="truncate">
                <Addr a={agent.address} chars={10} />
              </span>
              <span className="meta whitespace-nowrap">gas {fmtShares(snap.agentEth, 4)} ETH</span>
            </div>
          </Field>
          <Field label="Expires in">
            <div className="flex items-stretch">
              <input className="field w-20 text-center" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              <span className="flex items-center px-3 border border-l-0 border-ink/35 text-[13px] text-ink/60">days</span>
            </div>
          </Field>
        </div>

        <div className="border border-ink/25">
          <div className="grid grid-cols-[36px_56px_1fr_1fr_1fr] gap-2 px-3 py-2.5 border-b border-ink/15">
            <span />
            <Label>Token</Label>
            <Label>Per trade</Label>
            <Label>Per 24h</Label>
            <Label>Max hold</Label>
          </div>
          {TOKEN_LIST.map((t, i) => {
            const r = rows[t.symbol];
            const p = snap.policies[t.symbol];
            return (
              <div key={t.symbol} className={`grid grid-cols-[36px_56px_1fr_1fr_1fr] gap-2 px-3 py-2.5 items-center ${i < TOKEN_LIST.length - 1 ? "border-b border-ink/10" : ""} ${r.on ? "" : "opacity-50"}`}>
                <button type="button" className={`checkbox ${r.on ? "checkbox-on" : ""}`} onClick={() => setRows({ ...rows, [t.symbol]: { ...r, on: !r.on } })} aria-label={`toggle ${t.symbol}`} aria-pressed={r.on} />
                <div className="h text-base">{t.symbol}</div>
                <input className="field" disabled={!r.on} value={r.perTrade} onChange={(e) => setRows({ ...rows, [t.symbol]: { ...r, perTrade: e.target.value } })} />
                <input className="field" disabled={!r.on} value={r.daily} onChange={(e) => setRows({ ...rows, [t.symbol]: { ...r, daily: e.target.value } })} />
                <div className="flex flex-col min-w-0">
                  <input className="field" disabled={!r.on} value={r.cap} onChange={(e) => setRows({ ...rows, [t.symbol]: { ...r, cap: e.target.value } })} placeholder="0 = none" />
                  {p.allowed && (
                    <span className="meta text-[11px] mt-1 truncate">
                      {fmtShares(p.availableNow)} / {fmtShares(p.dailyCap)} left today
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <Label>Worst case per day</Label>
            <div className="num text-3xl text-accent mt-1">≈ ${worstCaseUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="meta mt-1">Σ 24h caps × reference price. Everything else is untouchable.</div>
          </div>
          <div className="flex gap-2">
            {session.active && (
              <Button variant="secondary" disabled={!api || !!busy} onClick={() => go("Revoke session key", () => api!.revoke(agent.address))}>
                Revoke
              </Button>
            )}
            <Button disabled={!api || !!busy} onClick={grant}>
              {busy === "Grant session key" ? "…" : session.active ? "Re-issue key" : "Grant session key"}
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Guardrails ---- */}
      <div className="border-t border-ink/15">
        <div className="px-5 md:px-6 py-3 border-b border-ink/15 flex items-center justify-between gap-3">
          <Tag>Guardrails</Tag>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={presetNyse}>
              NYSE hours
            </Button>
            <Button size="sm" variant="ghost" onClick={presetAlways}>
              24 / 7
            </Button>
          </div>
        </div>

        <div className="p-5 md:p-6 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Window opens · UTC">
              <input className="field" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Window closes · UTC">
              <input className="field" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          <div>
            <div className="hours" aria-label="24-hour trading window">
              {Array.from({ length: 24 }, (_, h) => {
                const probe = Math.floor(now / 86400) * 86400 + h * 3600 + 1800;
                const on = isWithinTradingWindow(probe, { ...draft, weekdayMask: 0 });
                const isNow = Math.floor((now % 86400) / 3600) === h;
                return <div key={h} className={`${on ? "on" : ""} ${isNow ? "now" : ""}`} title={`${String(h).padStart(2, "0")}:00 UTC`} />;
              })}
            </div>
            <div className="flex justify-between meta text-[12px] mt-2">
              <span>00:00</span>
              <span>white = open · green = now</span>
              <span>23:00</span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px bg-ink/15 border border-ink/35">
            {WEEKDAY_LABELS.map((d, i) => (
              <button key={d} type="button" className={`toggle !border-0 ${mask & (1 << i) ? "toggle-on" : "bg-page"}`} onClick={() => toggleDay(i)} aria-pressed={!!(mask & (1 << i))}>
                {d}
              </button>
            ))}
          </div>
          <div className="meta -mt-3">No days selected = every day. Same open/close = no time restriction.</div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max trades / rolling hour" hint="0 = unlimited. Stops a looping agent.">
              <input className="field" inputMode="numeric" value={perHour} onChange={(e) => setPerHour(e.target.value)} />
            </Field>
            <Field label="Heartbeat interval · hours" hint="0 = off. Agent freezes if you go quiet.">
              <input className="field" inputMode="decimal" value={hbHours} onChange={(e) => setHbHours(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Verdict label="Vault says now" ok={liveVerdict.ok} error={liveVerdict.ok ? undefined : liveVerdict.error} sub={hbLeft !== null ? `Heartbeat ${hbLeft > 0 ? `${fmtDuration(hbLeft)} left` : "expired"}` : undefined} />
            <Verdict label="Draft would say" ok={draftVerdict.ok} error={draftVerdict.ok ? undefined : draftVerdict.error} sub={`${new Date(now * 1000).toUTCString().slice(0, 25)} UTC`} />
          </div>

          <div className="grid grid-cols-2 gap-px bg-ink/20 border border-ink/40">
            <Button variant="secondary" className="!border-0 h-14 bg-page" disabled={!api || !!busy} onClick={() => go("Heartbeat", () => api!.heartbeat(agent.address))}>
              <Activity strokeWidth={2.5} className="w-4 h-4" /> Heartbeat
            </Button>
            <Button className="!border-0 h-14" disabled={!api || !!busy} onClick={applyGuards}>
              {busy === "Apply guardrails" ? "…" : "Apply guardrails"}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
