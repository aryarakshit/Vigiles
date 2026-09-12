import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbiItem,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOYMENT, ROBINHOOD_CHAIN, TOKEN_ABI, TOKEN_LIST, VAULT_ABI } from "../config/contracts";
import { type Counters, type Guards, type VaultError } from "./guards";
import type { AgentIdentity, LedgerEvent, PolicyView, SessionView, TradeRequest, TradeResult, VaultApi } from "./vault";
import { VaultRevert } from "./vault";

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function publicClient(): PublicClient {
  return createPublicClient({ chain: ROBINHOOD_CHAIN, transport: http() });
}

/** Connects the injected wallet and switches (or adds) Robinhood Chain. */
export async function connectInjected(): Promise<{ address: Address; wallet: WalletClient }> {
  const eth = (window as unknown as { ethereum: Eip1193 }).ethereum;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const wallet = createWalletClient({ chain: ROBINHOOD_CHAIN, transport: custom(eth) });
  try {
    await wallet.switchChain({ id: ROBINHOOD_CHAIN.id });
  } catch {
    await wallet.addChain({ chain: ROBINHOOD_CHAIN });
  }
  return { address: accounts[0], wallet };
}

const EVENT_ABI = {
  Deposit: parseAbiItem("event Deposit(address indexed user, address indexed token, uint256 amount)"),
  Withdraw: parseAbiItem("event Withdraw(address indexed user, address indexed token, uint256 amount)"),
  SessionKeyCreated: parseAbiItem("event SessionKeyCreated(address indexed user, address indexed agent, uint256 expiry, uint256 epoch)"),
  SessionKeyRevoked: parseAbiItem("event SessionKeyRevoked(address indexed user, address indexed agent, uint256 epoch)"),
  SessionGuardsUpdated: parseAbiItem(
    "event SessionGuardsUpdated(address indexed user, address indexed agent, uint256 windowStart, uint256 windowEnd, uint256 weekdayMask, uint256 maxTradesPerHour, uint256 heartbeatInterval)",
  ),
  Heartbeat: parseAbiItem("event Heartbeat(address indexed user, address indexed agent, uint256 timestamp)"),
  PositionCapUpdated: parseAbiItem(
    "event PositionCapUpdated(address indexed user, address indexed agent, address indexed token, uint256 maxPosition, uint256 epoch)",
  ),
  TradeExecuted: parseAbiItem(
    "event TradeExecuted(address indexed user, address indexed agent, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 spent, uint256 received, address adapter)",
  ),
  IntentRecorded: parseAbiItem("event IntentRecorded(address indexed user, address indexed agent, uint256 indexed nonce, bytes32 intentHash)"),
} as const;

function symbolOf(addr: Address): string {
  return TOKEN_LIST.find((t) => t.address?.toLowerCase() === addr.toLowerCase())?.symbol ?? addr.slice(0, 8);
}

function shares(x: bigint): string {
  return (Number(x) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** viem wraps custom errors several layers deep; walk to the named revert. */
export function decodeRevert(err: unknown): VaultError | null {
  if (err instanceof BaseError) {
    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name) return name as VaultError;
  }
  return null;
}

export class OnchainVault implements VaultApi {
  readonly mode = "onchain" as const;
  private readonly pub = publicClient();
  private readonly vault: Address;

  constructor(readonly user: Address, private readonly wallet: WalletClient) {
    if (!DEPLOYMENT.agentVault) throw new Error("AgentVault is not deployed; see deployments/robinhood-testnet.json");
    this.vault = DEPLOYMENT.agentVault;
  }

  // ---------------- reads ----------------

  private read<T>(functionName: string, args: unknown[]): Promise<T> {
    return this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName, args } as never) as Promise<T>;
  }

  vaultBalance(token: Address) {
    return this.read<bigint>("getBalance", [this.user, token]);
  }

  walletBalance(token: Address) {
    return this.pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [this.user] });
  }

  nativeBalance(who: Address) {
    return this.pub.getBalance({ address: who });
  }

  async session(agent: Address): Promise<SessionView> {
    const [active, expiry, epoch] = await this.read<[boolean, bigint, bigint]>("getSession", [this.user, agent]);
    return { active, expiry: Number(expiry), epoch: Number(epoch) };
  }

  async tokenPolicy(agent: Address, token: Address): Promise<PolicyView> {
    const [allowed, perTradeCap, dailyCap, availableNow] = await this.read<[boolean, bigint, bigint, bigint]>("getTokenPolicy", [
      this.user,
      agent,
      token,
    ]);
    return { allowed, perTradeCap, dailyCap, availableNow };
  }

  async guards(agent: Address): Promise<Guards & Counters> {
    const r = await this.read<bigint[]>("getSessionGuards", [this.user, agent]);
    const n = (i: number) => Number(r[i]);
    return {
      windowStart: n(0),
      windowEnd: n(1),
      weekdayMask: n(2),
      maxTradesPerHour: n(3),
      heartbeatInterval: n(4),
      lastHeartbeat: n(5),
      hourWindowStart: n(6),
      hourTradeCount: n(7),
      tradeNonce: n(8),
    };
  }

  canTradeNow(agent: Address) {
    return this.read<boolean>("canTradeNow", [this.user, agent]);
  }

  positionCap(agent: Address, token: Address) {
    return this.read<bigint>("getPositionCap", [this.user, agent, token]);
  }

  adapterAllowed(agent: Address, adapter: Address) {
    return this.read<boolean>("isAdapterAllowed", [this.user, agent, adapter]);
  }

  async events(agent: Address | null): Promise<LedgerEvent[]> {
    const latest = await this.pub.getBlockNumber();
    // Orbit chains produce blocks quickly; ~200k blocks is a comfortable demo window.
    const fromBlock = latest > 200_000n ? latest - 200_000n : 0n;
    const user = this.user;
    const out: LedgerEvent[] = [];

    const pull = async <K extends keyof typeof EVENT_ABI>(kind: K, args: Record<string, unknown>, summarize: (a: Record<string, unknown>) => string) => {
      const logs = await this.pub.getLogs({ address: this.vault, event: EVENT_ABI[kind], args: args as never, fromBlock, toBlock: latest });
      for (const l of logs) {
        const a = l.args as Record<string, unknown>;
        out.push({
          id: `${l.transactionHash}-${l.logIndex}`,
          kind,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          timestamp: 0,
          summary: summarize(a),
          intentHash: kind === "IntentRecorded" ? (a.intentHash as Hex) : undefined,
          nonce: kind === "IntentRecorded" ? Number(a.nonce) : undefined,
        });
      }
    };

    const withAgent = agent ? { user, agent } : { user };
    await Promise.all([
      pull("Deposit", { user }, (a) => `Deposited ${shares(a.amount as bigint)} ${symbolOf(a.token as Address)}`),
      pull("Withdraw", { user }, (a) => `Withdrew ${shares(a.amount as bigint)} ${symbolOf(a.token as Address)}`),
      pull("SessionKeyCreated", withAgent, (a) => `Session key granted · epoch ${a.epoch} · expires ${new Date(Number(a.expiry) * 1000).toLocaleString()}`),
      pull("SessionKeyRevoked", withAgent, (a) => `Session key revoked · epoch ${a.epoch}`),
      pull("SessionGuardsUpdated", withAgent, (a) => `Guardrails set · ${a.maxTradesPerHour}/h · heartbeat ${Number(a.heartbeatInterval) / 3600}h`),
      pull("Heartbeat", withAgent, () => "Heartbeat"),
      pull("PositionCapUpdated", withAgent, (a) => `Position cap ${symbolOf(a.token as Address)} ≤ ${shares(a.maxPosition as bigint)}`),
      pull("TradeExecuted", withAgent, (a) => `Trade ${shares(a.spent as bigint)} ${symbolOf(a.tokenIn as Address)} → ${shares(a.received as bigint)} ${symbolOf(a.tokenOut as Address)}`),
      pull("IntentRecorded", withAgent, (a) => `Intent #${a.nonce} committed`),
    ]);

    // Block timestamps: dedupe by block to keep RPC calls low.
    const blocks = Array.from(new Set(out.map((e) => e.blockNumber)));
    const ts = new Map<bigint, number>();
    await Promise.all(
      blocks.map(async (b) => {
        const blk = await this.pub.getBlock({ blockNumber: b });
        ts.set(b, Number(blk.timestamp));
      }),
    );
    for (const e of out) e.timestamp = ts.get(e.blockNumber) ?? 0;
    return out.sort((x, y) => (y.blockNumber === x.blockNumber ? 0 : y.blockNumber > x.blockNumber ? 1 : -1));
  }

  // ---------------- user writes ----------------

  private async write(functionName: string, args: unknown[], value?: bigint): Promise<Hex> {
    const { request } = await this.pub.simulateContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName,
      args,
      account: this.user,
      value,
    } as never);
    const hash = await this.wallet.writeContract(request as never);
    await this.pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  async faucet(token: Address, amount: bigint) {
    const hash = await this.wallet.writeContract({
      address: token,
      abi: TOKEN_ABI,
      functionName: "mint",
      args: [this.user, amount],
      account: this.user,
      chain: ROBINHOOD_CHAIN,
    });
    await this.pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  async deposit(token: Address, amount: bigint) {
    const allowance = await this.pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "allowance", args: [this.user, this.vault] });
    if (allowance < amount) {
      const h = await this.wallet.writeContract({
        address: token,
        abi: TOKEN_ABI,
        functionName: "approve",
        args: [this.vault, amount],
        account: this.user,
        chain: ROBINHOOD_CHAIN,
      });
      await this.pub.waitForTransactionReceipt({ hash: h });
    }
    return this.write("depositErc20", [token, amount]);
  }

  withdraw(token: Address, amount: bigint) {
    return this.write("withdrawErc20", [token, amount]);
  }

  createSessionKey(agent: Address, expiry: number, tokens: Address[], perTradeCaps: bigint[], dailyCaps: bigint[], adapters: Address[]) {
    return this.write("createSessionKey", [agent, BigInt(expiry), tokens, perTradeCaps, dailyCaps, adapters]);
  }

  setSessionGuards(agent: Address, g: Guards) {
    return this.write("setSessionGuards", [
      agent,
      BigInt(g.windowStart),
      BigInt(g.windowEnd),
      BigInt(g.weekdayMask),
      BigInt(g.maxTradesPerHour),
      BigInt(g.heartbeatInterval),
    ]);
  }

  setPositionCap(agent: Address, token: Address, max: bigint) {
    return this.write("setPositionCap", [agent, token, max]);
  }

  heartbeat(agent: Address) {
    return this.write("heartbeat", [agent]);
  }

  revoke(agent: Address) {
    return this.write("revokeSessionKey", [agent]);
  }

  async fundAgent(agent: Address, wei: bigint) {
    const hash = await this.wallet.sendTransaction({ account: this.user, to: agent, value: wei, chain: ROBINHOOD_CHAIN });
    await this.pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ---------------- agent write ----------------

  /**
   * Signs with the *agent's* key, never the user's. Pre-flights with
   * `simulateContract` so a guard rejection surfaces as a decoded custom error
   * before any gas is spent.
   */
  async agentTrade(agent: AgentIdentity, req: TradeRequest): Promise<TradeResult> {
    const account = privateKeyToAccount(agent.privateKey);
    const agentWallet = createWalletClient({ account, chain: ROBINHOOD_CHAIN, transport: http() });
    const args = [req.user, req.tokenIn, req.tokenOut, req.amountIn, req.minAmountOut, req.adapter, req.intentHash, "0x"];

    let request: unknown;
    let received: bigint;
    try {
      const sim = await this.pub.simulateContract({ address: this.vault, abi: VAULT_ABI, functionName: "executeTrade", args, account } as never);
      request = sim.request;
      received = sim.result as bigint;
    } catch (e) {
      const name = decodeRevert(e);
      if (name) throw new VaultRevert(name, "simulate");
      throw e;
    }
    const txHash = await agentWallet.writeContract(request as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new VaultRevert("ExternalCallFailed", "send");
    return { txHash, received };
  }
}

export const DEFAULT_AGENT_GAS = parseEther("0.002");
