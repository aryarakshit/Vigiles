export const ROBINHOOD_CHAIN = {
  id: 46630, // Robinhood Chain Testnet (Arbitrum Orbit L2)
  name: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
    public: { http: ["https://rpc.testnet.chain.robinhood.com"] },
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
  // Deployed / configured Stylus AgentVault on Robinhood Chain Testnet
  agentVault: "0x361594F5429D23ECE0A88E4fBE529E1c49D524d8",
  swapAdapter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  tokens: {
    ETH: {
      symbol: "ETH",
      name: "Native Ether",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      icon: "💎",
    },
    TSLA: {
      symbol: "TSLA",
      name: "Tesla Inc. (Tokenized Stock)",
      address: "0x4033B42C0637F55c70C7a4F658605553641b7145",
      decimals: 18,
      icon: "⚡",
    },
    AMZN: {
      symbol: "AMZN",
      name: "Amazon.com Inc. (Tokenized Stock)",
      address: "0x535805FEb6B9F2b88F5f0732A8528994793d56d6",
      decimals: 18,
      icon: "📦",
    },
    AAPL: {
      symbol: "AAPL",
      name: "Apple Inc. (Tokenized Stock)",
      address: "0x91807d47A6d203D0aC58C3Fe04A7F1186e8A9C1b",
      decimals: 18,
      icon: "🍎",
    },
  },
};

export const AGENT_VAULT_ABI = [
  {
    type: "function",
    name: "depositEth",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "depositErc20",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawEth",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawErc20",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createSessionKey",
    inputs: [
      { name: "agent", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "tokens", type: "address[]" },
      { name: "perTradeCaps", type: "uint256[]" },
      { name: "dailyCaps", type: "uint256[]" },
      { name: "adapters", type: "address[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTokenPolicy",
    inputs: [
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
      { name: "allowed", type: "bool" },
      { name: "perTradeCap", type: "uint256" },
      { name: "dailyCap", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAdapter",
    inputs: [
      { name: "agent", type: "address" },
      { name: "adapter", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeSessionKey",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setSessionSlippage",
    inputs: [
      { name: "agent", type: "address" },
      { name: "maxSlippageBps", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeTrade",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "adapter", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "received", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSession",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [
      { name: "active", type: "bool" },
      { name: "expiry", type: "uint256" },
      { name: "epoch", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTokenPolicy",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "perTradeCap", type: "uint256" },
      { name: "dailyCap", type: "uint256" },
      { name: "availableNow", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isAdapterAllowed",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
      { name: "adapter", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sessionSlippage",
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Custom Errors
  { type: "error", name: "SessionKeyInactive", inputs: [] },
  { type: "error", name: "SessionKeyExpired", inputs: [] },
  { type: "error", name: "TokenNotAllowed", inputs: [] },
  { type: "error", name: "SpendLimitExceeded", inputs: [] },
  { type: "error", name: "DailyLimitExceeded", inputs: [] },
  { type: "error", name: "AdapterNotAllowed", inputs: [] },
  { type: "error", name: "ZeroAddressNotAllowed", inputs: [] },
  { type: "error", name: "IdenticalTokensNotAllowed", inputs: [] },
  { type: "error", name: "ZeroAmountNotAllowed", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "InsufficientOutput", inputs: [] },
  { type: "error", name: "OverSpent", inputs: [] },
  { type: "error", name: "ReentrancyError", inputs: [] },
  { type: "error", name: "PriceFloorViolated", inputs: [] },
  { type: "error", name: "SequencerDown", inputs: [] },
  { type: "error", name: "GracePeriodNotOver", inputs: [] },
  { type: "error", name: "OracleFeedStale", inputs: [] },
] as const;

export const SWAP_ADAPTER_ABI = [
  {
    type: "function",
    name: "swapExactIn",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
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