import { defineChain, type Address } from "viem";
import deployments from "../../../deployments/robinhood-testnet.json";
import vaultAbiJson from "./AgentVaultStylus.abi.json";

/** Robinhood Chain Testnet (Arbitrum Orbit L2). */
export const ROBINHOOD_CHAIN = defineChain({
  id: deployments.chainId,
  name: deployments.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [deployments.rpcUrl] },
    public: { http: [deployments.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: deployments.explorerUrl },
  },
  testnet: true,
});

export const EXPLORER_URL = deployments.explorerUrl;

/** Exact ABI of the deployed Stylus vault (generated from `cargo run --features export-abi`). */
export const VAULT_ABI = vaultAbiJson as readonly unknown[] as typeof vaultAbiJson;

/** Minimal ERC20 + faucet surface of MockTokenizedStock. */
export const TOKEN_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export type TokenSymbol = "AAPL" | "TSLA" | "NVDA";

export interface TokenMeta {
  symbol: TokenSymbol;
  name: string;
  address: Address | null;
  decimals: 18;
  /** Reference price used only for the worst-case exposure estimate in the UI. */
  refUsd: number;
}

export const TOKENS: Record<TokenSymbol, TokenMeta> = {
  AAPL: { symbol: "AAPL", name: "Tokenized Apple", address: deployments.tokens.AAPL as Address | null, decimals: 18, refUsd: 225 },
  TSLA: { symbol: "TSLA", name: "Tokenized Tesla", address: deployments.tokens.TSLA as Address | null, decimals: 18, refUsd: 240 },
  NVDA: { symbol: "NVDA", name: "Tokenized Nvidia", address: deployments.tokens.NVDA as Address | null, decimals: 18, refUsd: 120 },
};

export const TOKEN_LIST: TokenMeta[] = [TOKENS.AAPL, TOKENS.TSLA, TOKENS.NVDA];

export const DEPLOYMENT = {
  agentVault: deployments.agentVault as Address | null,
  swapAdapter: deployments.swapAdapter as Address | null,
  deployTx: deployments.agentVaultDeployTx as `0x${string}` | null,
  deployedAt: deployments.deployedAt as string | null,
};

/** True when every address needed for a live demo is present in the manifest. */
export const IS_DEPLOYED =
  !!DEPLOYMENT.agentVault && !!DEPLOYMENT.swapAdapter && TOKEN_LIST.every((t) => !!t.address);

/** Seconds since UTC midnight for the NYSE regular session during EDT. */
export const NYSE_WINDOW = { start: 13 * 3600 + 30 * 60, end: 20 * 3600, weekdays: 0x3e } as const;
