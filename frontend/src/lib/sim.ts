import type { Address } from "viem";
import { TOKEN_LIST } from "../config/contracts";
import {
  EMPTY_COUNTERS,
  EMPTY_GUARDS,
  authorizeSessionGuards,
  calcAvailable,
  type Counters,
  type Guards,
  type TokenPolicy,
} from "./guards";
import { VaultRevert, type AgentIdentity, type LedgerEvent, type PolicyView, type SessionView, type TradeRequest, type TradeResult, type VaultApi } from "./vault";

/** Deterministic pseudo-addresses so the simulation has stable, explorer-free identifiers. */
export const SIM_USER = "0xA11CE00000000000000000000000000000000001" as Address;
export const SIM_ADAPTER = "0xADA0000000000000000000000000000000000001" as Address;
export const SIM_TOKENS: Record<string, Address> = {
  AAPL: "0xAAA1000000000000000000000000000000000001" as Address,
  TSLA: "0xAAA2000000000000000000000000000000000002" as Address,
  NVDA: "0xAAA3000000000000000000000000000000000003" as Address,
};

const ONE = 10n ** 18n;
const key = (...parts: (string | number | bigint)[]) => parts.map(String).join("|").toLowerCase();

/**
 * In-memory vault with the same rules as the Stylus contract. Swaps fill 1:1
 * through the mock adapter, mirroring `MockSwapAdapter` in Normal mode.
 * Clearly labelled in the UI; never presented as on-chain.
 */
export class SimVault implements VaultApi {
  readonly mode = "sim" as const;
  readonly user = SIM_USER;

  private wallet = new Map<string, bigint>();
  private vault = new Map<string, bigint>();
  private native = new Map<string, bigint>();
  private sessions = new Map<string, { active: boolean; expiry: number; epoch: number }>();
  private policies = new Map<string, TokenPolicy>(); // user|agent|epoch|token
  private adapters = new Map<string, boolean>();
  private caps = new Map<string, bigint>();
  private guardState = new Map<string, Guards & Counters>();
  private log: LedgerEvent[] = [];
  private block = 1n;

  constructor() {
    for (const t of TOKEN_LIST) this.wallet.set(key(SIM_TOKENS[t.symbol]), 100n * ONE);
    this.native.set(key(SIM_USER), 5n * ONE);
  }

  private now() {
    return Math.floor(Date.now() / 1000);
  }

  private emit(kind: LedgerEvent["kind"], summary: string, extra: Partial<LedgerEvent> = {}) {
    this.block += 1n;
    this.log.unshift({ id: `sim-${this.block}-${this.log.length}`, kind, blockNumber: this.block, txHash: null, timestamp: this.now(), summary, ...extra });
  }

  private sym(a: Address) {
    return TOKEN_LIST.find((t) => SIM_TOKENS[t.symbol].toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 8);
  }

  private shares(x: bigint) {
    return (Number(x) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  private gs(agent: Address): Guards & Counters {
    return this.guardState.get(key(this.user, agent)) ?? { ...EMPTY_GUARDS, ...EMPTY_COUNTERS };
  }

  // ---------------- reads ----------------
  async vaultBalance(token: Address) {
    return this.vault.get(key(this.user, token)) ?? 0n;
  }
  async walletBalance(token: Address) {
    return this.wallet.get(key(token)) ?? 0n;
  }
  async nativeBalance(who: Address) {
    return this.native.get(key(who)) ?? 0n;
  }
  async session(agent: Address): Promise<SessionView> {
    const s = this.sessions.get(key(this.user, agent)) ?? { active: false, expiry: 0, epoch: 0 };
    return { active: s.active && this.now() < s.expiry, expiry: s.expiry, epoch: s.epoch };
  }
  async tokenPolicy(agent: Address, token: Address): Promise<PolicyView> {
    const s = await this.session(agent);
    const p = this.policies.get(key(this.user, agent, s.epoch, token));
    if (!p) return { allowed: false, perTradeCap: 0n, dailyCap: 0n, availableNow: 0n };
    return { allowed: p.allowed, perTradeCap: p.perTradeCap, dailyCap: p.dailyCap, availableNow: calcAvailable(p, BigInt(this.now())) };
  }
  async guards(agent: Address) {
    return this.gs(agent);
  }
  async canTradeNow(agent: Address) {
    return authorizeSessionGuards(this.now(), this.gs(agent), this.gs(agent), false).ok;
  }
  async positionCap(agent: Address, token: Address) {
    const s = await this.session(agent);
    return this.caps.get(key(this.user, agent, s.epoch, token)) ?? 0n;
  }
  async adapterAllowed(agent: Address, adapter: Address) {
    const s = await this.session(agent);
    return this.adapters.get(key(this.user, agent, s.epoch, adapter)) ?? false;
  }
  async events() {
    return [...this.log];
  }

  // ---------------- user writes ----------------
  async faucet(token: Address, amount: bigint) {
    this.wallet.set(key(token), (await this.walletBalance(token)) + amount);
    return null;
  }
  async deposit(token: Address, amount: bigint) {
    const w = await this.walletBalance(token);
    if (w < amount) throw new VaultRevert("InsufficientBalance", "simulate");
    this.wallet.set(key(token), w - amount);
    this.vault.set(key(this.user, token), (await this.vaultBalance(token)) + amount);
    this.emit("Deposit", `Deposited ${this.shares(amount)} ${this.sym(token)}`);
    return null;
  }
  async withdraw(token: Address, amount: bigint) {
    const v = await this.vaultBalance(token);
    if (v < amount) throw new VaultRevert("InsufficientBalance", "simulate");
    this.vault.set(key(this.user, token), v - amount);
    this.wallet.set(key(token), (await this.walletBalance(token)) + amount);
    this.emit("Withdraw", `Withdrew ${this.shares(amount)} ${this.sym(token)}`);
    return null;
  }
  async createSessionKey(agent: Address, expiry: number, tokens: Address[], perTradeCaps: bigint[], dailyCaps: bigint[], adapters: Address[]) {
    if (expiry <= this.now()) throw new VaultRevert("SessionKeyExpired", "simulate");
    const prev = this.sessions.get(key(this.user, agent));
    const epoch = (prev?.epoch ?? 0) + 1;
    this.sessions.set(key(this.user, agent), { active: true, expiry, epoch });
    tokens.forEach((t, i) => {
      if (perTradeCaps[i] === 0n || dailyCaps[i] === 0n || perTradeCaps[i] > dailyCaps[i]) throw new VaultRevert("InvalidCap", "simulate");
      this.policies.set(key(this.user, agent, epoch, t), { allowed: true, perTradeCap: perTradeCaps[i], dailyCap: dailyCaps[i], bucket: dailyCaps[i], bucketTs: BigInt(this.now()) });
    });
    for (const a of adapters) this.adapters.set(key(this.user, agent, epoch, a), true);
    this.guardState.set(key(this.user, agent), { ...this.gs(agent), lastHeartbeat: this.now() });
    this.emit("SessionKeyCreated", `Session key granted · epoch ${epoch} · expires ${new Date(expiry * 1000).toLocaleString()}`);
    return null;
  }
  async setSessionGuards(agent: Address, g: Guards) {
    if (g.windowStart >= 86400 || g.windowEnd >= 86400 || g.weekdayMask > 0x7f) throw new VaultRevert("InvalidGuard", "simulate");
    this.guardState.set(key(this.user, agent), { ...this.gs(agent), ...g, lastHeartbeat: this.now() });
    this.emit("SessionGuardsUpdated", `Guardrails set · ${g.maxTradesPerHour || "∞"}/h · heartbeat ${g.heartbeatInterval ? g.heartbeatInterval / 3600 + "h" : "off"}`);
    return null;
  }
  async setPositionCap(agent: Address, token: Address, max: bigint) {
    const s = await this.session(agent);
    if (!s.active) throw new VaultRevert("SessionKeyInactive", "simulate");
    this.caps.set(key(this.user, agent, s.epoch, token), max);
    this.emit("PositionCapUpdated", `Position cap ${this.sym(token)} ≤ ${this.shares(max)}`);
    return null;
  }
  async heartbeat(agent: Address) {
    this.guardState.set(key(this.user, agent), { ...this.gs(agent), lastHeartbeat: this.now() });
    this.emit("Heartbeat", "Heartbeat");
    return null;
  }
  async revoke(agent: Address) {
    const prev = this.sessions.get(key(this.user, agent)) ?? { active: false, expiry: 0, epoch: 0 };
    this.sessions.set(key(this.user, agent), { active: false, expiry: prev.expiry, epoch: prev.epoch + 1 });
    this.emit("SessionKeyRevoked", `Session key revoked · epoch ${prev.epoch + 1}`);
    return null;
  }
  async fundAgent(agent: Address, wei: bigint) {
    this.native.set(key(this.user), (await this.nativeBalance(this.user)) - wei);
    this.native.set(key(agent), (await this.nativeBalance(agent)) + wei);
    return null;
  }

  // ---------------- agent write ----------------
  async agentTrade(agent: AgentIdentity, req: TradeRequest): Promise<TradeResult> {
    const fail = (name: VaultRevert["name"]): never => {
      this.emit("Blocked", `Blocked: ${name}`, { error: name });
      throw new VaultRevert(name, "simulate");
    };
    const now = this.now();
    if (req.tokenIn === req.tokenOut) fail("InvalidToken");
    if (req.amountIn === 0n || req.minAmountOut === 0n) fail("ZeroAmount");

    const s = this.sessions.get(key(this.user, agent.address));
    if (!s?.active) fail("SessionKeyInactive");
    if (now >= s!.expiry) fail("SessionKeyExpired");
    if (!this.adapters.get(key(this.user, agent.address, s!.epoch, req.adapter))) fail("AdapterNotAllowed");

    const pin = this.policies.get(key(this.user, agent.address, s!.epoch, req.tokenIn));
    if (!pin?.allowed) fail("TokenNotAllowed");
    if (req.amountIn > pin!.perTradeCap) fail("SpendLimitExceeded");
    const avail = calcAvailable(pin!, BigInt(now));
    if (req.amountIn > avail) fail("DailyLimitExceeded");
    const pout = this.policies.get(key(this.user, agent.address, s!.epoch, req.tokenOut));
    if (!pout?.allowed) fail("TokenNotAllowed");
    const inBal = await this.vaultBalance(req.tokenIn);
    if (inBal < req.amountIn) fail("InsufficientBalance");

    const g = this.gs(agent.address);
    const auth = authorizeSessionGuards(now, g, g, req.intentHash === ("0x" + "0".repeat(64)));
    if (!auth.ok) return fail(auth.error);

    // 1:1 fill via the mock adapter.
    const received = req.amountIn;
    if (received < req.minAmountOut) fail("InsufficientOutput");
    const cap = this.caps.get(key(this.user, agent.address, s!.epoch, req.tokenOut)) ?? 0n;
    const outBal = await this.vaultBalance(req.tokenOut);
    if (cap !== 0n && outBal + received > cap) fail("PositionCapExceeded");

    // Effects
    pin!.bucket = avail - req.amountIn;
    pin!.bucketTs = BigInt(now);
    this.vault.set(key(this.user, req.tokenIn), inBal - req.amountIn);
    this.vault.set(key(this.user, req.tokenOut), outBal + received);
    this.guardState.set(key(this.user, agent.address), { ...g, ...auth.next });

    this.emit("IntentRecorded", `Intent #${auth.next.tradeNonce} committed`, { intentHash: req.intentHash, nonce: auth.next.tradeNonce });
    this.emit("TradeExecuted", `Trade ${this.shares(req.amountIn)} ${this.sym(req.tokenIn)} → ${this.shares(received)} ${this.sym(req.tokenOut)}`);
    // No fake hashes: simulation rows never link to an explorer.
    return { txHash: null, received };
  }
}
