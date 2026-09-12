import type { Address, Hex } from "viem";
import type { Counters, Guards, VaultError } from "./guards";

/** One row in the on-chain ledger panel. */
export interface LedgerEvent {
  id: string;
  kind:
    | "Deposit"
    | "Withdraw"
    | "SessionKeyCreated"
    | "SessionKeyRevoked"
    | "SessionGuardsUpdated"
    | "Heartbeat"
    | "PositionCapUpdated"
    | "TradeExecuted"
    | "IntentRecorded"
    | "Blocked";
  blockNumber: bigint;
  txHash: Hex | null;
  timestamp: number;
  summary: string;
  /** Present for IntentRecorded rows. */
  intentHash?: Hex;
  nonce?: number;
  /** Present for Blocked rows (simulation / pre-flight rejections). */
  error?: VaultError;
}

export interface SessionView {
  active: boolean;
  expiry: number;
  epoch: number;
}

export interface PolicyView {
  allowed: boolean;
  perTradeCap: bigint;
  dailyCap: bigint;
  availableNow: bigint;
}

export interface TradeRequest {
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  adapter: Address;
  intentHash: Hex;
}

export interface TradeResult {
  txHash: Hex | null;
  received: bigint;
}

/** Thrown by trade execution when the vault rejects. `name` is the custom error selector name. */
export class VaultRevert extends Error {
  constructor(public readonly name: VaultError, public readonly phase: "simulate" | "send") {
    super(name);
  }
}

export interface AgentIdentity {
  address: Address;
  privateKey: Hex;
}

/**
 * Everything the dashboard needs from a vault. Two implementations:
 *  - `OnchainVault` (lib/onchain.ts): viem against the deployed Stylus contract.
 *  - `SimVault`     (lib/sim.ts):     in-memory, same rules, clearly labelled.
 */
export interface VaultApi {
  readonly mode: "onchain" | "sim";
  readonly user: Address;

  // ---- reads ----
  vaultBalance(token: Address): Promise<bigint>;
  walletBalance(token: Address): Promise<bigint>;
  nativeBalance(who: Address): Promise<bigint>;
  session(agent: Address): Promise<SessionView>;
  tokenPolicy(agent: Address, token: Address): Promise<PolicyView>;
  guards(agent: Address): Promise<Guards & Counters>;
  canTradeNow(agent: Address): Promise<boolean>;
  positionCap(agent: Address, token: Address): Promise<bigint>;
  adapterAllowed(agent: Address, adapter: Address): Promise<boolean>;
  events(agent: Address | null): Promise<LedgerEvent[]>;

  // ---- user writes (return tx hash; sim returns null) ----
  faucet(token: Address, amount: bigint): Promise<Hex | null>;
  deposit(token: Address, amount: bigint): Promise<Hex | null>;
  withdraw(token: Address, amount: bigint): Promise<Hex | null>;
  createSessionKey(
    agent: Address,
    expiry: number,
    tokens: Address[],
    perTradeCaps: bigint[],
    dailyCaps: bigint[],
    adapters: Address[],
  ): Promise<Hex | null>;
  setSessionGuards(agent: Address, g: Guards): Promise<Hex | null>;
  setPositionCap(agent: Address, token: Address, max: bigint): Promise<Hex | null>;
  heartbeat(agent: Address): Promise<Hex | null>;
  revoke(agent: Address): Promise<Hex | null>;
  fundAgent(agent: Address, wei: bigint): Promise<Hex | null>;

  // ---- agent write ----
  agentTrade(agent: AgentIdentity, req: TradeRequest): Promise<TradeResult>;
}
