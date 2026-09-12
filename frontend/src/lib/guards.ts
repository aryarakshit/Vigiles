/**
 * TypeScript port of `vigiles-vault/src/risk_engine.rs`.
 *
 * Used for (1) the simulation vault when no contract is deployed, and
 * (2) the live "what would the vault say right now" preview while the user
 * edits a policy. The on-chain contract is always the source of truth.
 */

export const SECONDS_PER_DAY = 86_400n;
export const SECONDS_PER_HOUR = 3_600n;

export interface Guards {
  windowStart: number; // seconds since UTC midnight
  windowEnd: number;
  weekdayMask: number; // bit 0 = Sunday .. bit 6 = Saturday; 0 = every day
  maxTradesPerHour: number; // 0 = unlimited
  heartbeatInterval: number; // seconds; 0 = disabled
}

export interface Counters {
  lastHeartbeat: number;
  hourWindowStart: number;
  hourTradeCount: number;
  tradeNonce: number;
}

export interface TokenPolicy {
  allowed: boolean;
  perTradeCap: bigint;
  dailyCap: bigint;
  bucket: bigint;
  bucketTs: bigint;
}

export const EMPTY_GUARDS: Guards = { windowStart: 0, windowEnd: 0, weekdayMask: 0, maxTradesPerHour: 0, heartbeatInterval: 0 };
export const EMPTY_COUNTERS: Counters = { lastHeartbeat: 0, hourWindowStart: 0, hourTradeCount: 0, tradeNonce: 0 };

/** Every revert the vault can produce, in the order the contract checks them. */
export type VaultError =
  | "ZeroAddress"
  | "ZeroAmount"
  | "InvalidToken"
  | "SessionKeyInactive"
  | "SessionKeyExpired"
  | "AdapterNotAllowed"
  | "TokenNotAllowed"
  | "SpendLimitExceeded"
  | "DailyLimitExceeded"
  | "InsufficientBalance"
  | "MissingIntent"
  | "HeartbeatMissed"
  | "OutsideTradingWindow"
  | "VelocityLimitExceeded"
  | "PositionCapExceeded"
  | "OverSpent"
  | "InsufficientOutput"
  | "ExternalCallFailed"
  | "ReentrancyError"
  | "InvalidCap"
  | "InvalidAdapter"
  | "InvalidGuard"
  | "Unauthorized"
  | "SafeMathError";

/** Human copy for each revert, written for the person reading the ledger, not the developer. */
export const ERROR_COPY: Record<VaultError, string> = {
  ZeroAddress: "A required address was zero.",
  ZeroAmount: "Amount must be greater than zero.",
  InvalidToken: "Token in and token out must differ and be valid.",
  SessionKeyInactive: "This agent has no active session key. It was never granted, or it was revoked.",
  SessionKeyExpired: "The session key has expired.",
  AdapterNotAllowed: "The agent tried to route through a venue you never allow-listed.",
  TokenNotAllowed: "The agent tried to touch a token outside its whitelist.",
  SpendLimitExceeded: "The trade is larger than the per-trade cap.",
  DailyLimitExceeded: "The rolling 24h budget for this token is exhausted.",
  InsufficientBalance: "The vault does not hold enough of the input token.",
  MissingIntent: "No intent receipt: the agent submitted a trade without committing to a rationale.",
  HeartbeatMissed: "Dead-man switch tripped: you have not checked in within the heartbeat interval.",
  OutsideTradingWindow: "Outside the trading window you set for this agent.",
  VelocityLimitExceeded: "Rolling-hour trade budget spent. The agent is being throttled.",
  PositionCapExceeded: "The fill would push your holding of the output token past its cap.",
  OverSpent: "The venue tried to take more input than authorised.",
  InsufficientOutput: "The venue returned less than the minimum output.",
  ExternalCallFailed: "The external venue call reverted.",
  ReentrancyError: "Reentrant call blocked.",
  InvalidCap: "Per-trade cap must be non-zero and no larger than the daily cap.",
  InvalidAdapter: "Adapter address is invalid or collides with a token.",
  InvalidGuard: "Guard values out of range.",
  Unauthorized: "Caller is not authorised.",
  SafeMathError: "Array lengths mismatch or arithmetic overflow.",
};

export function weekday(nowSec: number): number {
  return Number((BigInt(Math.floor(nowSec)) / SECONDS_PER_DAY + 4n) % 7n);
}

export function secondsOfDay(nowSec: number): number {
  return Math.floor(nowSec) % 86_400;
}

export function isWithinTradingWindow(nowSec: number, g: Guards): boolean {
  if (g.weekdayMask !== 0 && (g.weekdayMask & (1 << weekday(nowSec))) === 0) return false;
  if (g.windowStart === g.windowEnd) return true;
  const sod = secondsOfDay(nowSec);
  if (g.windowStart < g.windowEnd) return sod >= g.windowStart && sod < g.windowEnd;
  return sod >= g.windowStart || sod < g.windowEnd;
}

export function isHeartbeatAlive(nowSec: number, g: Guards, c: Counters): boolean {
  if (g.heartbeatInterval === 0) return true;
  return nowSec - c.lastHeartbeat <= g.heartbeatInterval;
}

export function checkVelocity(nowSec: number, g: Guards, c: Counters): { ok: true; next: Counters } | { ok: false } {
  if (g.maxTradesPerHour === 0) return { ok: true, next: { ...c, tradeNonce: c.tradeNonce + 1 } };
  const fresh = nowSec - c.hourWindowStart >= Number(SECONDS_PER_HOUR);
  const start = fresh ? nowSec : c.hourWindowStart;
  const count = fresh ? 0 : c.hourTradeCount;
  if (count >= g.maxTradesPerHour) return { ok: false };
  return { ok: true, next: { ...c, hourWindowStart: start, hourTradeCount: count + 1, tradeNonce: c.tradeNonce + 1 } };
}

export function calcAvailable(p: TokenPolicy, nowSec: bigint): bigint {
  if (p.dailyCap === 0n) return 0n;
  if (p.bucketTs === 0n) return p.dailyCap;
  if (nowSec <= p.bucketTs) return p.bucket < p.dailyCap ? p.bucket : p.dailyCap;
  const refill = ((nowSec - p.bucketTs) * p.dailyCap) / SECONDS_PER_DAY;
  const total = p.bucket + refill;
  return total < p.dailyCap ? total : p.dailyCap;
}

/**
 * Runs the session-level guards exactly as `execute_trade` does and returns the
 * first revert, or the counters to persist. Pure; safe to call on every keystroke.
 */
export function authorizeSessionGuards(
  nowSec: number,
  g: Guards,
  c: Counters,
  intentIsZero: boolean,
): { ok: true; next: Counters } | { ok: false; error: VaultError } {
  if (intentIsZero) return { ok: false, error: "MissingIntent" };
  if (!isHeartbeatAlive(nowSec, g, c)) return { ok: false, error: "HeartbeatMissed" };
  if (!isWithinTradingWindow(nowSec, g)) return { ok: false, error: "OutsideTradingWindow" };
  const v = checkVelocity(nowSec, g, c);
  if (!v.ok) return { ok: false, error: "VelocityLimitExceeded" };
  return { ok: true, next: v.next };
}

/** Bit helpers for the weekday mask. */
export const WEEKDAY_LABELS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export const WEEKDAYS_MASK = 0x3e;

export function fmtSod(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseSod(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.min(86_399, Math.max(0, h * 3600 + m * 60));
}
