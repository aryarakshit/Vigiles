"use client";

import React from "react";
import { EXPLORER_URL } from "../config/contracts";

/* ------------------------------------------------------------------
   Primitives for the Swiss system. Structure is drawn with borders;
   hierarchy with weight, case and scale. No radius, no shadows.
------------------------------------------------------------------- */

export function Panel({
  idx,
  title,
  right,
  children,
  className = "",
}: {
  idx: string;
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      <header className="panel-head">
        <div className="n">{idx}</div>
        <div className="t">{title}</div>
        {right ? <div className="r">{right}</div> : <div className="r border-l-0" />}
      </header>
      {children}
    </section>
  );
}

export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>;
}

/** Numbered section label, e.g. <Idx n="02" /> renders "02 —". */
export function Idx({ n, children }: { n: string; children?: React.ReactNode }) {
  return (
    <div className="idx">
      {n} — {children}
    </div>
  );
}

/** Inverted rectangular tag (white on black). */
export function Tag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/70 ${className}`}>{children}</span>;
}

export function Mark({ state }: { state: "ok" | "block" | "warn" | "idle" }) {
  return <span className={`mark mark-${state}`} aria-hidden />;
}

/** Big number in a bordered cell. Number scales on hover, like a stat card. */
export function Stat({ label, value, sub, accent = false, className = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={`group flex flex-col justify-between p-4 min-w-0 ${className}`}>
      <Label>{label}</Label>
      <div className={`num text-4xl md:text-5xl mt-3 truncate ${accent ? "text-accent" : ""}`}>{value}</div>
      {sub && <div className="meta mt-2">{sub}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg" }) {
  const v = variant === "secondary" ? "btn-secondary" : variant === "ghost" ? "btn-ghost" : "";
  const s = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";
  return (
    <button className={`btn ${v} ${s} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 min-w-0">
      <Label>{label}</Label>
      {children}
      {hint && <div className="meta">{hint}</div>}
    </label>
  );
}

export function Addr({ a, chars = 6 }: { a: string; chars?: number }) {
  if (!a) return <span className="text-ink/40">—</span>;
  return (
    <span className="tabular-nums" title={a}>
      {a.slice(0, 2 + chars)}…{a.slice(-4)}
    </span>
  );
}

export function TxLink({ hash, label = "tx" }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return null;
  return (
    <a className="link text-[13px]" href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">
      {label} {hash.slice(0, 8)}…
    </a>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`border-t border-ink/20 ${className}`} />;
}

export function fmtShares(x: bigint, digits = 2): string {
  return (Number(x) / 1e18).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtEth(x: bigint): string {
  return (Number(x) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function toWei(s: string): bigint {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1e6)) * 10n ** 12n;
}

export function fmtDuration(sec: number): string {
  if (sec <= 0) return "0s";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
