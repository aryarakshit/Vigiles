export const ROBINHOOD_CHAIN = {
  id: 1333137, // Custom Orbit Chain ID for Robinhood Chain
  name: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.robinhood.com/testnet"] },
    public: { http: ["https://rpc.robinhood.com/testnet"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
};

export const CONTRACT_ADDRESSES = {
  agentVault: "0x361594F5429D23ECE0A88E4fBE529E1c49D524d8",
  dexRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  tokens: {
    ETH: {
      symbol: "ETH",
      name: "Native Ether",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      icon: "💎",
    },
    AAPL: {
      symbol: "AAPL",
      name: "Apple Inc. (Tokenized)",
      address: "0x1111111111111111111111111111111111111111",
      decimals: 18,
      icon: "🍎",
    },
    TSLA: {
      symbol: "TSLA",
      name: "Tesla Inc. (Tokenized)",
      address: "0x2222222222222222222222222222222222222222",
      decimals: 18,
      icon: "⚡",
    },
    NVDA: {
      symbol: "NVDA",
      name: "NVIDIA Corp. (Tokenized)",
      address: "0x3333333333333333333333333333333333333333",
      decimals: 18,
      icon: "🚀",
    },
  },
};

export const AGENT_VAULT_ABI = [
  {
    type: "function",
    name: "deposit_eth",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "deposit_erc20",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw_eth",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw_erc20",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "create_session_key",
    inputs: [
      { name: "agent", type: "address" },
      { name: "max_spend_limit", type: "uint256" },
      { name: "daily_limit", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed_tokens_list", type: "address[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "set_token_whitelist",
    inputs: [
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revoke_session_key",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "execute_trade",
    inputs: [
      { name: "user", type: "address" },
      { name: "token_address", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "dex_router", type: "address" },
      { name: "call_data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "get_balance",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "is_session_active",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "is_token_allowed",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_session_limits",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [
      { name: "is_active", type: "bool" },
      { name: "max_spend_limit", type: "uint256" },
      { name: "daily_limit", type: "uint256" },
      { name: "spent_today", type: "uint256" },
      { name: "last_reset_timestamp", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
