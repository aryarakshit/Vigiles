/**
 * Vigiles MCP server.
 *
 * Gives an AI agent (Claude Desktop, Cursor, any MCP host) a *session key*, not
 * a wallet: every tool here goes through the Vigiles vault on Robinhood
 * Chain, so the hard limits live in the contract, not in this file.
 *
 *   AGENT_PRIVATE_KEY   hex key of the agent's session address (required for trades)
 *   VAULT_ADDRESS       overrides deployments/robinhood-testnet.json
 *   RPC_URL             overrides the manifest RPC
 *   INTENT_LOG          path of the append-only rationale log (default ~/.vigiles/intents.jsonl)
 *
 * The private key never reaches the model: it is read from the environment,
 * used to sign, and never echoed in any tool result.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseAbiItem,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "deployments", "robinhood-testnet.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  agentVault: string | null;
  swapAdapter: string | null;
  tokens: Record<string, string | null>;
};
const VAULT_ABI = JSON.parse(readFileSync(join(here, "..", "frontend", "src", "config", "AgentVaultStylus.abi.json"), "utf8"));

const RPC_URL = process.env.RPC_URL ?? manifest.rpcUrl;
const VAULT = (process.env.VAULT_ADDRESS ?? manifest.agentVault) as Address | null;
const ADAPTER = manifest.swapAdapter as Address | null;
const INTENT_LOG = process.env.INTENT_LOG ?? join(homedir(), ".vigiles", "intents.jsonl");

const chain = defineChain({
  id: manifest.chainId,
  name: manifest.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: manifest.explorerUrl } },
});

const pub = createPublicClient({ chain, transport: http(RPC_URL) });

function agentAccount() {
  const pk = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("AGENT_PRIVATE_KEY is not set. Generate a fresh key for the agent and have the vault owner grant it a session key.");
  }
  return privateKeyToAccount(pk);
}

function requireVault(): Address {
  if (!VAULT) throw new Error("AgentVault is not deployed: deployments/robinhood-testnet.json has no agentVault. Run scripts/deploy_stylus.sh.");
  return VAULT;
}

const TOKEN_BY_SYMBOL = Object.fromEntries(Object.entries(manifest.tokens).filter(([, a]) => !!a).map(([s, a]) => [s.toUpperCase(), a as Address]));
const SYMBOL_BY_TOKEN = Object.fromEntries(Object.entries(TOKEN_BY_SYMBOL).map(([s, a]) => [a.toLowerCase(), s]));

/** Accepts a ticker ("AAPL") or a raw address. */
function resolveToken(x: string): Address {
  const bySym = TOKEN_BY_SYMBOL[x.toUpperCase()];
  if (bySym) return bySym;
  if (/^0x[0-9a-fA-F]{40}$/.test(x)) return x as Address;
  throw new Error(`Unknown token "${x}". Known: ${Object.keys(TOKEN_BY_SYMBOL).join(", ") || "(none deployed)"}`);
}

function symbolOf(a: Address) {
  return SYMBOL_BY_TOKEN[a.toLowerCase()] ?? a;
}

/** Human copy for each revert so the model can explain itself instead of retrying blindly. */
const ERROR_COPY: Record<string, string> = {
  SessionKeyInactive: "No active session key for this agent. Ask the vault owner to grant one.",
  SessionKeyExpired: "The session key has expired. Ask the owner to re-issue it.",
  AdapterNotAllowed: "That venue is not allow-listed. Use the configured adapter.",
  TokenNotAllowed: "That token is outside the whitelist for this session. Do not retry with it.",
  SpendLimitExceeded: "Order exceeds the per-trade cap. Reduce size.",
  DailyLimitExceeded: "The rolling 24h budget for this token is exhausted. Wait for refill.",
  InsufficientBalance: "The vault does not hold enough of the input token.",
  MissingIntent: "A rationale is mandatory; the vault refuses trades without an intent receipt.",
  HeartbeatMissed: "Dead-man switch tripped: the owner has not checked in. Stop trading and notify them.",
  OutsideTradingWindow: "Outside the owner's trading window. Wait for the next window.",
  VelocityLimitExceeded: "Rolling-hour trade budget spent. Stop and wait; do not loop.",
  PositionCapExceeded: "This fill would exceed the max holding of the output token.",
  InsufficientOutput: "The venue returned less than minAmountOut.",
  OverSpent: "The venue tried to take more than authorised.",
  ExternalCallFailed: "The venue call reverted.",
};

function decodeRevert(e: unknown): string | null {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return r?.data?.errorName ?? null;
  }
  return null;
}

function read<T>(functionName: string, args: unknown[]): Promise<T> {
  return pub.readContract({ address: requireVault(), abi: VAULT_ABI, functionName, args } as never) as Promise<T>;
}

function appendIntent(rec: Record<string, unknown>) {
  mkdirSync(dirname(INTENT_LOG), { recursive: true });
  appendFileSync(INTENT_LOG, JSON.stringify(rec) + "\n");
}

function readIntents(): Record<string, unknown>[] {
  if (!existsSync(INTENT_LOG)) return [];
  return readFileSync(INTENT_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const fmt = (x: bigint) => formatUnits(x, 18);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "vigiles", version: "3.0.0" });

server.tool(
  "vigiles_status",
  "Describe the cage this agent is trading inside: session key, guardrails (trading window, velocity, heartbeat), per-token caps, position caps, and whether a trade would be admitted right now. Call this before planning any trade.",
  { userAddress: z.string().describe("Vault owner (the delegator).") },
  async ({ userAddress }) => {
    const agent = agentAccount().address;
    const user = userAddress as Address;
    const [active, expiry, epoch] = await read<[boolean, bigint, bigint]>("getSession", [user, agent]);
    const g = await read<bigint[]>("getSessionGuards", [user, agent]);
    const canTradeNow = await read<boolean>("canTradeNow", [user, agent]);
    const tokens = await Promise.all(
      Object.entries(TOKEN_BY_SYMBOL).map(async ([sym, addr]) => {
        const [allowed, perTrade, daily, avail] = await read<[boolean, bigint, bigint, bigint]>("getTokenPolicy", [user, agent, addr]);
        const cap = await read<bigint>("getPositionCap", [user, agent, addr]);
        const bal = await read<bigint>("getBalance", [user, addr]);
        return { symbol: sym, address: addr, allowed, perTradeCap: fmt(perTrade), dailyCap: fmt(daily), availableNow: fmt(avail), maxHolding: cap === 0n ? "unlimited" : fmt(cap), vaultBalance: fmt(bal) };
      }),
    );
    const hh = (s: bigint) => `${String(Number(s) / 3600 | 0).padStart(2, "0")}:${String((Number(s) % 3600) / 60 | 0).padStart(2, "0")}`;
    const body = {
      network: `${manifest.chainName} (${manifest.chainId})`,
      vault: requireVault(),
      agent,
      session: { active, expiresAt: new Date(Number(expiry) * 1000).toISOString(), epoch: Number(epoch) },
      guards: {
        tradingWindowUtc: g[0] === g[1] ? "no restriction" : `${hh(g[0])}–${hh(g[1])}`,
        weekdayMask: Number(g[2]) === 0 ? "every day" : Number(g[2]).toString(2).padStart(7, "0") + " (bit0=Sun)",
        maxTradesPerHour: Number(g[3]) || "unlimited",
        heartbeatInterval: Number(g[4]) ? `${Number(g[4]) / 3600}h` : "off",
        lastHeartbeat: Number(g[5]) ? new Date(Number(g[5]) * 1000).toISOString() : null,
        tradesThisHour: Number(g[7]),
        tradeNonce: Number(g[8]),
      },
      canTradeNow,
      adapter: ADAPTER,
      tokens,
      note: "Every executeTrade must carry a rationale; its keccak256 is committed on-chain as an intent receipt.",
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

const tradeShape = {
  userAddress: z.string().describe("Vault owner (the delegator)."),
  sell: z.string().describe("Token to sell: ticker (AAPL) or address."),
  buy: z.string().describe("Token to buy: ticker (TSLA) or address."),
  shares: z.string().describe("Amount of the sell token, in whole shares (e.g. '4.5')."),
  maxSlippageBps: z.number().int().min(0).max(5000).default(500).describe("Max slippage in basis points; sets minAmountOut."),
  rationale: z.string().min(8).describe("Plain-language reason for this trade. Its keccak256 becomes the on-chain intent receipt."),
};

async function buildTrade(a: { userAddress: string; sell: string; buy: string; shares: string; maxSlippageBps: number; rationale: string }) {
  const tokenIn = resolveToken(a.sell);
  const tokenOut = resolveToken(a.buy);
  const amountIn = parseUnits(a.shares, 18);
  const minAmountOut = (amountIn * BigInt(10_000 - a.maxSlippageBps)) / 10_000n; // mock adapter fills 1:1
  const intentHash = keccak256(stringToHex(a.rationale));
  if (!ADAPTER) throw new Error("No swap adapter in the deployment manifest.");
  return { tokenIn, tokenOut, amountIn, minAmountOut, intentHash, args: [a.userAddress as Address, tokenIn, tokenOut, amountIn, minAmountOut, ADAPTER, intentHash, "0x"] };
}

server.tool(
  "vigiles_preflight",
  "Dry-run a trade against the live vault with eth_call. Returns whether it would be admitted and, if not, which guardrail refuses it and what to do. Costs no gas. Use this before vigiles_execute_trade.",
  tradeShape,
  async (a) => {
    const t = await buildTrade(a);
    const account = agentAccount();
    try {
      const sim = await pub.simulateContract({ address: requireVault(), abi: VAULT_ABI, functionName: "executeTrade", args: t.args, account } as never);
      return { content: [{ type: "text", text: JSON.stringify({ admitted: true, wouldReceive: fmt(sim.result as bigint), buy: symbolOf(t.tokenOut), intentHash: t.intentHash }, null, 2) }] };
    } catch (e) {
      const name = decodeRevert(e);
      const body = name ? { admitted: false, refusedBy: name, guidance: ERROR_COPY[name] ?? "Refused by the vault." } : { admitted: false, error: (e as Error).message.split("\n")[0] };
      return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
    }
  },
);

server.tool(
  "vigiles_execute_trade",
  "Execute a trade through the Vigiles vault with the agent's session key. Simulates first; if any guardrail refuses, nothing is sent. On success the rationale is appended to the local intent log and its hash is on-chain in the IntentRecorded event.",
  tradeShape,
  async (a) => {
    const t = await buildTrade(a);
    const account = agentAccount();
    const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
    try {
      const { request, result } = await pub.simulateContract({ address: requireVault(), abi: VAULT_ABI, functionName: "executeTrade", args: t.args, account } as never);
      const txHash = await wallet.writeContract(request as never);
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
      const rec = { ts: new Date().toISOString(), txHash, intentHash: t.intentHash, rationale: a.rationale, sell: symbolOf(t.tokenIn), buy: symbolOf(t.tokenOut), shares: a.shares, user: a.userAddress, agent: account.address };
      appendIntent(rec);
      const body = {
        status: receipt.status === "success" ? "executed" : "reverted",
        txHash,
        explorer: `${manifest.explorerUrl}/tx/${txHash}`,
        received: fmt(result as bigint),
        intentHash: t.intentHash,
        gasUsed: receipt.gasUsed.toString(),
      };
      return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
    } catch (e) {
      const name = decodeRevert(e);
      const body = name
        ? { status: "refused", refusedBy: name, guidance: ERROR_COPY[name] ?? "Refused by the vault.", gasSpent: "0 (caught in simulation)" }
        : { status: "error", error: (e as Error).message.split("\n")[0] };
      return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
    }
  },
);

server.tool(
  "vigiles_intent_log",
  "Read this agent's local rationale log and verify each entry against the on-chain IntentRecorded events. Any rationale whose hash is not on-chain was either refused or altered after the fact.",
  { userAddress: z.string().describe("Vault owner (the delegator)."), lookbackBlocks: z.number().int().min(1).max(2_000_000).default(200_000) },
  async ({ userAddress, lookbackBlocks }) => {
    const agent = agentAccount().address;
    const latest = await pub.getBlockNumber();
    const logs = await pub.getLogs({
      address: requireVault(),
      event: parseAbiItem("event IntentRecorded(address indexed user, address indexed agent, uint256 indexed nonce, bytes32 intentHash)"),
      args: { user: userAddress as Address, agent },
      fromBlock: latest > BigInt(lookbackBlocks) ? latest - BigInt(lookbackBlocks) : 0n,
      toBlock: latest,
    });
    const onChain = new Map(logs.map((l) => [String(l.args.intentHash).toLowerCase(), { nonce: Number(l.args.nonce), tx: l.transactionHash }]));
    const local = readIntents().filter((r) => String(r.agent).toLowerCase() === agent.toLowerCase());
    const rows = local.map((r) => {
      const hit = onChain.get(String(r.intentHash).toLowerCase());
      return { ...r, onChain: !!hit, nonce: hit?.nonce ?? null };
    });
    const orphaned = [...onChain.entries()].filter(([h]) => !local.some((r) => String(r.intentHash).toLowerCase() === h)).map(([h, v]) => ({ intentHash: h, ...v, note: "on-chain receipt with no local rationale" }));
    return { content: [{ type: "text", text: JSON.stringify({ logFile: INTENT_LOG, entries: rows, onChainWithoutLocalRationale: orphaned }, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
