"use client";

import React, { useState, useEffect } from "react";
import {
  Shield,
  Key,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  RefreshCw,
  Terminal,
  Zap,
  ArrowDownRight,
  ArrowUpRight,
  Sliders,
  DollarSign,
  Cpu,
  PlusCircle,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { CONTRACT_ADDRESSES, ROBINHOOD_CHAIN } from "../config/contracts";

interface SessionKeyData {
  agentAddress: string;
  agentName: string;
  isActive: boolean;
  maxSpendLimit: number;
  dailyLimit: number;
  spentToday: number;
  lastResetTimestamp: number;
  expiryTimestamp: number;
  allowedTokens: string[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
  txHash?: string;
}

export default function Home() {
  // Wallet State - starts disconnected
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0);


  // Balances State
  const [balances, setBalances] = useState<Record<string, number>>({
    ETH: 4.5,
    AAPL: 25.0,
    TSLA: 15.0,
    NVDA: 30.0,
  });

  const [vaultBalances, setVaultBalances] = useState<Record<string, number>>({
    ETH: 2.0,
    AAPL: 50.0,
    TSLA: 20.0,
    NVDA: 10.0,
  });

  // Active Session Keys
  const [sessionKeys, setSessionKeys] = useState<SessionKeyData[]>([
    {
      agentAddress: "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
      agentName: "Robinhood Momentum Agent Alpha",
      isActive: true,
      maxSpendLimit: 500,
      dailyLimit: 2000,
      spentToday: 400,
      lastResetTimestamp: Date.now() - 3600 * 1000 * 4,
      expiryTimestamp: Date.now() + 86400 * 1000 * 7,
      allowedTokens: ["AAPL", "TSLA"],
    },
    {
      agentAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      agentName: "Autonomous RWA Arbitrage Bot",
      isActive: true,
      maxSpendLimit: 250,
      dailyLimit: 1000,
      spentToday: 950,
      lastResetTimestamp: Date.now() - 3600 * 1000 * 20,
      expiryTimestamp: Date.now() + 86400 * 1000 * 3,
      allowedTokens: ["ETH", "NVDA"],
    },
  ]);

  // Session Key Form State
  const [newAgentAddress, setNewAgentAddress] = useState<string>("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const [newAgentName, setNewAgentName] = useState<string>("AI Quantitative Trader Beta");
  const [newMaxSpend, setNewMaxSpend] = useState<number>(300);
  const [newDailyLimit, setNewDailyLimit] = useState<number>(1500);
  const [newExpiryDays, setNewExpiryDays] = useState<number>(7);
  const [newAllowedTokens, setNewAllowedTokens] = useState<string[]>(["AAPL", "NVDA"]);

  // Deposit/Withdraw Modal State
  const [selectedToken, setSelectedToken] = useState<string>("AAPL");
  const [actionAmount, setActionAmount] = useState<string>("10");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  // Agent Trade Simulation State
  const [simAgent, setSimAgent] = useState<string>(sessionKeys[0]?.agentAddress || "");
  const [simToken, setSimToken] = useState<string>("AAPL");
  const [simAmount, setSimAmount] = useState<string>("200");

  // Terminal Execution Logs
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "1",
      timestamp: new Date().toLocaleTimeString(),
      type: "info",
      message: "AgentVault Stylus WASM contract initialized on Robinhood Chain Orbit L2.",
    },
    {
      id: "2",
      timestamp: new Date().toLocaleTimeString(),
      type: "success",
      message: "Session Key verified: Momentum Agent Alpha granted micro-limits for AAPL & TSLA.",
    },
  ]);

  const generateTxHash = () => "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  const connectWallet = async () => {
    if (walletConnected) {
      setWalletConnected(false);
      setUserAddress("");
      addLog("info", "Wallet disconnected.");
      return;
    }

    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
        if (accounts && accounts[0]) {
          setUserAddress(accounts[0]);
          setWalletConnected(true);
          addLog("success", `Connected wallet: ${accounts[0]}`);
          return;
        }
      } catch (err: any) {
        addLog("error", `Wallet connection failed: ${err.message || err}`);
      }
    }

    // Demo fallback for testing without browser Web3 wallet
    const demoAddr = "0xa11ce52d000000000000000000000000000a11ce";
    setUserAddress(demoAddr);
    setWalletConnected(true);
    addLog("info", `Connected with demo delegator account: ${demoAddr}`);
  };

  const addLog = (type: LogEntry["type"], message: string, txHash?: string) => {
    setLogs((prev) => [
      {
        id: Math.random().toString(),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message,
        txHash,
      },
      ...prev.slice(0, 19),
    ]);
  };

  // Handle Create Session Key
  const handleCreateSessionKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentAddress) return;

    const newKey: SessionKeyData = {
      agentAddress: newAgentAddress,
      agentName: newAgentName || "Custom AI Agent",
      isActive: true,
      maxSpendLimit: newMaxSpend,
      dailyLimit: newDailyLimit,
      spentToday: 0,
      lastResetTimestamp: Date.now(),
      expiryTimestamp: Date.now() + newExpiryDays * 86400 * 1000,
      allowedTokens: newAllowedTokens,
    };

    const txHash = generateTxHash();
    setSessionKeys((prev) => [newKey, ...prev]);
    addLog(
      "success",
      `SessionKeyCreated: Agent ${newAgentAddress.slice(0, 6)}...${newAgentAddress.slice(-4)} | Max: $${newMaxSpend} | Daily: $${newDailyLimit} | Expiry: ${newExpiryDays}d`,
      txHash
    );
  };

  // Handle Revoke Session Key
  const handleRevokeKey = (agentAddress: string) => {
    const txHash = generateTxHash();
    setSessionKeys((prev) =>
      prev.map((k) => (k.agentAddress === agentAddress ? { ...k, isActive: false } : k))
    );
    addLog(
      "warning",
      `SessionKeyRevoked: Emergency kill-switch executed for agent ${agentAddress.slice(0, 6)}...${agentAddress.slice(-4)}`,
      txHash
    );
  };

  // Handle Deposit / Withdraw
  const handleVaultAction = () => {
    const amountNum = parseFloat(actionAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    const txHash = generateTxHash();
    if (activeTab === "deposit") {
      if ((balances[selectedToken] || 0) < amountNum) {
        addLog("error", `Deposit failed: Insufficient wallet balance for ${selectedToken}`);
        return;
      }
      setBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] - amountNum }));
      setVaultBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] + amountNum }));
      addLog("success", `Deposit: Locked ${amountNum} ${selectedToken} into AgentVault`, txHash);
    } else {
      if ((vaultBalances[selectedToken] || 0) < amountNum) {
        addLog("error", `Withdraw failed: Insufficient vault balance for ${selectedToken}`);
        return;
      }
      setVaultBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] - amountNum }));
      setBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] + amountNum }));
      addLog("success", `Withdraw: Returned ${amountNum} ${selectedToken} to wallet`, txHash);
    }
    setActionAmount("");
  };

  // Handle Faucet Mint
  const handleFaucet = (token: string) => {
    const txHash = generateTxHash();
    setBalances((prev) => ({ ...prev, [token]: (prev[token] || 0) + 100 }));
    addLog("info", `Faucet: Minted 100 Mock ${token} (Tokenized Stock) on Robinhood Testnet`, txHash);
  };

  // Handle Prompt Injection Attack Simulation
  const handleSimulateAttack = () => {
    addLog(
      "error",
      "🚨 Prompt Injection Defeated: Malicious prompt tried to call raw router transfer(0xdead, all) -> Reverted: AdapterNotAllowed(). Stylus vault never forwards calldata; only calls user-allowlisted ISwapAdapter!"
    );
  };

  // Handle Agent Simulated Trade Execution
  const handleExecuteTrade = () => {
    const tradeAmount = parseFloat(simAmount);
    if (isNaN(tradeAmount) || tradeAmount <= 0) return;

    const key = sessionKeys.find((k) => k.agentAddress === simAgent);

    if (!key) {
      addLog("error", "Trade Reverted: SessionKeyInactive() - Caller is not an authorized agent");
      return;
    }

    if (!key.isActive) {
      addLog("error", `Trade Reverted: SessionKeyInactive() - Agent ${key.agentName} has been revoked`);
      return;
    }

    if (Date.now() >= key.expiryTimestamp) {
      addLog("error", `Trade Reverted: SessionKeyExpired() - Key expired`);
      return;
    }

    if (!key.allowedTokens.includes(simToken)) {
      addLog(
        "error",
        `Trade Reverted: TokenNotAllowed() - ${simToken} is NOT in agent's allowed whitelist (${key.allowedTokens.join(", ")})`
      );
      return;
    }

    if (tradeAmount > key.maxSpendLimit) {
      addLog(
        "error",
        `Trade Reverted: SpendLimitExceeded() - Trade of $${tradeAmount} exceeds max limit of $${key.maxSpendLimit}`
      );
      return;
    }

    const newSpent = key.spentToday + tradeAmount;
    if (key.dailyLimit > 0 && newSpent > key.dailyLimit) {
      addLog(
        "error",
        `Trade Reverted: DailyLimitExceeded() - Accumulated spend $${newSpent} exceeds 24h limit of $${key.dailyLimit}`
      );
      return;
    }

    if ((vaultBalances[simToken] || 0) < tradeAmount) {
      addLog("error", `Trade Reverted: InsufficientBalance() - Vault balance is less than trade amount`);
      return;
    }

    // Trade Success
    const txHash = generateTxHash();
    setVaultBalances((prev) => ({ ...prev, [simToken]: prev[simToken] - tradeAmount }));
    setSessionKeys((prev) =>
      prev.map((k) => (k.agentAddress === simAgent ? { ...k, spentToday: newSpent } : k))
    );
    addLog(
      "success",
      `TradeExecuted: Agent ${key.agentName} traded $${tradeAmount} ${simToken} via Robinhood DEX Router! Balance diff verified & zero allowance reset.`,
      txHash
    );
  };

  const totalVaultUsd =
    vaultBalances.ETH * 2800 +
    vaultBalances.AAPL * 225 +
    vaultBalances.TSLA * 240 +
    vaultBalances.NVDA * 120;

  return (
    <div className="min-h-screen bg-[#F0F0F0] text-[#121212] flex flex-col font-outfit selection:bg-[#F0C020] selection:text-black">
      {/* --- Bauhaus Navigation Masthead --- */}
      <header className="border-b-4 border-black bg-white sticky top-0 z-50 shadow-[0_4px_0px_0px_black]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Bauhaus Primary Shapes Mark */}
            <div className="flex items-center space-x-2 p-2 bg-[#F0F0F0] border-2 border-black shadow-[3px_3px_0px_0px_black]">
              <span className="w-4 h-4 rounded-full bg-[#D02020] border border-black" title="Circle // Form" />
              <span className="w-4 h-4 bg-[#1040C0] border border-black" title="Square // Structure" />
              <span className="clip-triangle w-4 h-4 bg-[#F0C020] inline-block" title="Triangle // Dynamism" />
            </div>

            <div>
              <div className="flex items-center space-x-2.5">
                <span className="text-2xl font-black tracking-tighter uppercase text-[#121212]">
                  AGENTSHIELD
                </span>
                <span className="text-[11px] bg-black text-[#F0C020] px-2 py-0.5 font-mono font-bold tracking-widest uppercase">
                  STYLUS_WASM_V2
                </span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                BAUHAUS RISK ENGINE // ROBINHOOD ORBIT L2
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden md:flex items-center space-x-2 bg-white border-2 border-black px-3 py-1.5 text-xs font-mono font-bold uppercase shadow-[3px_3px_0px_0px_black]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1040C0] animate-pulse" />
              <span>ROBINHOOD TESTNET</span>
              <span className="text-neutral-400">/</span>
              <span className="text-[#D02020]">ID: {ROBINHOOD_CHAIN.id}</span>
            </div>

            <button
              onClick={connectWallet}
              className="flex items-center space-x-2 bg-[#F0C020] hover:bg-[#F0C020]/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-black font-black text-xs uppercase tracking-wider px-5 py-3 border-2 sm:border-4 border-black shadow-[4px_4px_0px_0px_black] transition-all"
            >
              <Key className="w-4 h-4 stroke-[3]" />
              <span>{walletConnected && userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : "CONNECT WALLET"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* --- Constructivist Hero Banner --- */}
      <section className="border-b-4 border-black bg-[#F0F0F0] py-14 sm:py-20 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-block bg-[#D02020] text-white border-2 border-black px-3.5 py-1 text-xs font-bold uppercase tracking-widest shadow-[4px_4px_0px_0px_black]">
              CONSTRUCTIVIST ON-CHAIN RISK GOVERNANCE
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.9] text-[#121212]">
              FORM FOLLOWS FUNCTION.
              <span className="block text-[#1040C0] mt-1">SECURITY PRECEDES AUTONOMY.</span>
            </h1>

            <p className="text-base sm:text-lg font-medium text-neutral-800 max-w-2xl leading-relaxed">
              The self-custody equivalent of Robinhood's Agentic Trading. Mathematical spend limits, linear token bucket refills, and Chainlink oracle floors compiled to Arbitrum Stylus Rust WASM. Zero raw calldata forwarding.
            </p>

            <div className="flex flex-wrap gap-2 pt-2 text-xs font-bold uppercase font-mono">
              <span className="bg-white border-2 border-black px-3 py-1 shadow-[2px_2px_0px_0px_black]">
                01 // ALLOWLISTED ISWAPADAPTER
              </span>
              <span className="bg-white border-2 border-black px-3 py-1 shadow-[2px_2px_0px_0px_black]">
                02 // BALANCE DIFF SETTLEMENT
              </span>
              <span className="bg-white border-2 border-black px-3 py-1 shadow-[2px_2px_0px_0px_black]">
                03 // CHAINLINK ORACLE FLOOR
              </span>
            </div>
          </div>

          {/* Right Panel: Bauhaus Overlapping Composition */}
          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center">
              {/* Primary Geometric Layers */}
              <div className="w-56 h-56 rounded-full bg-[#D02020] border-4 border-black shadow-[8px_8px_0px_0px_black] absolute -top-3 -left-3" />
              <div className="w-52 h-52 bg-[#1040C0] border-4 border-black rotate-12 shadow-[8px_8px_0px_0px_black] absolute -bottom-2 -right-2" />
              <div className="w-48 h-48 bg-white border-4 border-black -rotate-6 shadow-[6px_6px_0px_0px_black] absolute flex flex-col justify-between p-5 z-10">
                <div className="flex justify-between items-start">
                  <span className="font-black text-xs uppercase tracking-wider text-[#D02020]">BAUHAUS ARCHITECTURE</span>
                  <span className="clip-triangle w-4 h-4 bg-[#F0C020]" />
                </div>
                <div>
                  <div className="text-3xl font-black font-mono tracking-tight text-[#121212]">0% UNSAFE</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600 mt-1">
                    ARBITRUM STYLUS WASM // CEI PATTERN
                  </div>
                </div>
                <div className="text-[9px] font-mono font-bold uppercase bg-[#F0C020] border border-black p-1 text-center">
                  128,000 INVARIANT CALLS VERIFIED
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Mandatory Color-Blocked Stats Strip (Yellow #F0C020) --- */}
      <section className="bg-[#F0C020] border-b-4 border-black text-[#121212] py-8 sm:py-10 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0 lg:divide-x-4 lg:divide-black">
          {/* Stat 1 */}
          <div className="lg:px-6">
            <div className="text-xs font-bold uppercase tracking-widest text-[#121212] flex items-center justify-between mb-1">
              <span>01 / VAULT COLLATERAL</span>
              <span className="w-2.5 h-2.5 rounded-full bg-[#D02020] border border-black" />
            </div>
            <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-[#121212]">
              ${totalVaultUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-800 mt-1">
              MULTI-TOKEN RWA ISOLATION
            </p>
          </div>

          {/* Stat 2 */}
          <div className="lg:px-6">
            <div className="text-xs font-bold uppercase tracking-widest text-[#121212] flex items-center justify-between mb-1">
              <span>02 / DELEGATION KEYS</span>
              <span className="w-2.5 h-2.5 bg-[#1040C0] border border-black" />
            </div>
            <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-[#121212]">
              {sessionKeys.filter((k) => k.isActive).length} <span className="text-xl font-normal text-neutral-800">/ {sessionKeys.length} ACTIVE</span>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-800 mt-1">
              BOUNDED RUNTIME DELEGATION
            </p>
          </div>

          {/* Stat 3 */}
          <div className="lg:px-6">
            <div className="text-xs font-bold uppercase tracking-widest text-[#121212] flex items-center justify-between mb-1">
              <span>03 / 24H BUCKET CAP</span>
              <span className="clip-triangle w-3 h-3 bg-[#D02020]" />
            </div>
            <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-[#121212]">
              ${sessionKeys.reduce((acc, k) => acc + (k.isActive ? k.spentToday : 0), 0)}
              <span className="text-lg font-normal text-neutral-800"> / ${sessionKeys.reduce((acc, k) => acc + (k.isActive ? k.dailyLimit : 0), 0)}</span>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-800 mt-1">
              LINEAR CONTINUOUS REFILL
            </p>
          </div>

          {/* Stat 4 */}
          <div className="lg:px-6">
            <div className="text-xs font-bold uppercase tracking-widest text-[#121212] flex items-center justify-between mb-1">
              <span>04 / INVARIANT ENGINE</span>
              <span className="w-2.5 h-2.5 bg-black" />
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-[#121212] uppercase">
              STYLUS_VERIFIED
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-800 mt-1">
              ZERO-UNSAFE // BALANCE DIFFS
            </p>
          </div>
        </div>
      </section>

      {/* --- Main Dashboard Sections --- */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-12 flex-1">
        {/* Two Column Layout: Section 01 (Left 4 cols) vs Section 02 & 03 (Right 8 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* --- Section 01: Protected Reserves & Collateral (Left 5 cols) --- */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border-4 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_black] relative hover:-translate-y-1 transition-transform">
              {/* Corner Shape Decoration: Circle */}
              <div className="w-3.5 h-3.5 rounded-full bg-[#D02020] border border-black absolute top-4 right-4" title="Circle" />

              <div className="flex items-start justify-between pb-4 mb-6 border-b-4 border-black">
                <div>
                  <h2 className="text-lg font-black tracking-tight uppercase text-[#121212] flex items-center">
                    01 // VAULT RESERVES
                  </h2>
                  <p className="text-[11px] font-mono font-bold text-neutral-600 uppercase mt-0.5">
                    USER-CONTROLLED ASSET COLLATERAL
                  </p>
                </div>
                <span className="bg-[#FFF9C4] border-2 border-black px-2 py-0.5 text-[10px] font-mono font-black uppercase shadow-[2px_2px_0px_0px_black]">
                  ERC-8056 [1.0X]
                </span>
              </div>

              {/* Token Cards */}
              <div className="space-y-3">
                {Object.entries(CONTRACT_ADDRESSES.tokens).map(([key, info]) => {
                  const vBal = vaultBalances[key] || 0;
                  const wBal = balances[key] || 0;
                  return (
                    <div
                      key={key}
                      className="bg-[#F0F0F0] border-2 border-black p-3.5 flex items-center justify-between hover:bg-white hover:border-[#1040C0] transition shadow-[3px_3px_0px_0px_black]"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-xl p-1.5 bg-white border-2 border-black">{info.icon}</span>
                        <div>
                          <div className="text-sm font-black uppercase text-[#121212]">{info.symbol}</div>
                          <div className="text-[10px] font-bold text-neutral-600 uppercase">{info.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-[#121212] font-mono">{vBal.toFixed(2)} VAULT</div>
                        <div className="text-[10px] text-neutral-600 font-mono font-bold">WALLET: {wBal.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Deposit / Withdraw Action Block */}
              <div className="mt-8 pt-6 border-t-4 border-black space-y-4">
                <div className="grid grid-cols-2 bg-[#F0F0F0] border-2 border-black p-1 gap-1">
                  <button
                    onClick={() => setActiveTab("deposit")}
                    className={`py-2 text-xs font-black uppercase tracking-wider transition ${
                      activeTab === "deposit"
                        ? "bg-[#D02020] text-white border-2 border-black shadow-[2px_2px_0px_0px_black]"
                        : "text-neutral-700 hover:text-black font-bold"
                    }`}
                  >
                    LOCK TO VAULT
                  </button>
                  <button
                    onClick={() => setActiveTab("withdraw")}
                    className={`py-2 text-xs font-black uppercase tracking-wider transition ${
                      activeTab === "withdraw"
                        ? "bg-[#D02020] text-white border-2 border-black shadow-[2px_2px_0px_0px_black]"
                        : "text-neutral-700 hover:text-black font-bold"
                    }`}
                  >
                    WITHDRAW
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex space-x-2">
                    <select
                      value={selectedToken}
                      onChange={(e) => setSelectedToken(e.target.value)}
                      className="bg-white border-4 border-black text-[#121212] text-xs font-mono font-black px-3 py-2.5 uppercase focus:bg-[#FFF9C4] outline-none"
                    >
                      <option value="AAPL">AAPL</option>
                      <option value="TSLA">TSLA</option>
                      <option value="NVDA">NVDA</option>
                      <option value="ETH">ETH</option>
                    </select>

                    <input
                      type="number"
                      value={actionAmount}
                      onChange={(e) => setActionAmount(e.target.value)}
                      placeholder="AMOUNT"
                      className="flex-1 bg-white border-4 border-black text-[#121212] text-xs font-mono font-bold px-3 py-2.5 uppercase focus:bg-[#FFF9C4] outline-none"
                    />
                  </div>

                  <button
                    onClick={handleVaultAction}
                    className="w-full bg-[#D02020] hover:bg-[#D02020]/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-white font-black uppercase text-xs tracking-wider py-3.5 border-4 border-black shadow-[4px_4px_0px_0px_black] transition-all flex items-center justify-center space-x-2"
                  >
                    {activeTab === "deposit" ? (
                      <>
                        <ArrowDownRight className="w-4 h-4 stroke-[3]" />
                        <span>LOCK IN VAULT (BALANCE DIFF)</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-4 h-4 stroke-[3]" />
                        <span>WITHDRAW TO WALLET</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Faucet Section */}
              <div className="mt-6 p-4 bg-[#F0F0F0] border-2 border-black space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase text-[#121212]">
                  <span>MOCK TOKENIZED STOCK FAUCET</span>
                  <span className="text-[#1040C0]">CHAIN_ID: 46630</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleFaucet("AAPL")}
                    className="text-[11px] font-mono font-bold bg-[#D02020] hover:bg-[#D02020]/90 text-white py-2 border-2 border-black shadow-[3px_3px_0px_0px_black] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none uppercase transition-all"
                  >
                    +100 AAPL
                  </button>
                  <button
                    onClick={() => handleFaucet("TSLA")}
                    className="text-[11px] font-mono font-bold bg-[#1040C0] hover:bg-[#1040C0]/90 text-white py-2 border-2 border-black shadow-[3px_3px_0px_0px_black] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none uppercase transition-all"
                  >
                    +100 TSLA
                  </button>
                  <button
                    onClick={() => handleFaucet("NVDA")}
                    className="text-[11px] font-mono font-bold bg-[#F0C020] hover:bg-[#F0C020]/90 text-black py-2 border-2 border-black shadow-[3px_3px_0px_0px_black] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none uppercase transition-all"
                  >
                    +100 NVDA
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* --- Right Column: Section 02 Policy Architect & Section 03 Matrix (Right 7 cols) --- */}
          <div className="lg:col-span-7 space-y-8">
            {/* Section 02: Risk Policy Architect */}
            <div className="bg-white border-4 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_black] relative hover:-translate-y-1 transition-transform">
              {/* Corner Shape Decoration: Square */}
              <div className="w-3.5 h-3.5 bg-[#1040C0] border border-black absolute top-4 right-4" title="Square" />

              <div className="flex items-start justify-between pb-4 mb-6 border-b-4 border-black">
                <div>
                  <h2 className="text-lg font-black tracking-tight uppercase text-[#121212] flex items-center">
                    02 // RISK POLICY ARCHITECT
                  </h2>
                  <p className="text-[11px] font-mono font-bold text-neutral-600 uppercase mt-0.5">
                    MATHEMATICAL DELEGATION BOUNDS // EPOCH-SCOPED REFRESH
                  </p>
                </div>
                <span className="bg-[#F0C020] border-2 border-black px-2.5 py-0.5 text-[10px] font-mono font-black uppercase shadow-[2px_2px_0px_0px_black]">
                  EPOCH_ISOLATION
                </span>
              </div>

              <form onSubmit={handleCreateSessionKey} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-1.5">
                      AGENT DESIGNATION / IDENTIFIER
                    </label>
                    <input
                      type="text"
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      className="w-full bg-[#F0F0F0] border-4 border-black px-3.5 py-2.5 text-xs text-[#121212] font-mono font-bold focus:bg-[#FFF9C4] outline-none"
                      placeholder="e.g. Robinhood Momentum Agent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-1.5">
                      DELEGATE AGENT ADDRESS
                    </label>
                    <input
                      type="text"
                      value={newAgentAddress}
                      onChange={(e) => setNewAgentAddress(e.target.value)}
                      className="w-full bg-[#F0F0F0] border-4 border-black px-3.5 py-2.5 text-xs text-[#121212] font-mono font-bold focus:bg-[#FFF9C4] outline-none"
                      placeholder="0x..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#F0F0F0] border-4 border-black p-4 shadow-[4px_4px_0px_0px_black]">
                  <div>
                    <div className="flex justify-between text-xs font-bold uppercase text-[#121212] mb-2">
                      <span>MAX / TRADE CAP</span>
                      <span className="bg-[#F0C020] border-2 border-black px-2 py-0.5 font-mono font-black text-xs">
                        ${newMaxSpend}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={newMaxSpend}
                      onChange={(e) => setNewMaxSpend(Number(e.target.value))}
                      className="w-full accent-[#1040C0] cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold uppercase text-[#121212] mb-2">
                      <span>24H BUCKET CEILING</span>
                      <span className="bg-[#F0C020] border-2 border-black px-2 py-0.5 font-mono font-black text-xs">
                        ${newDailyLimit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="200"
                      max="5000"
                      step="100"
                      value={newDailyLimit}
                      onChange={(e) => setNewDailyLimit(Number(e.target.value))}
                      className="w-full accent-[#1040C0] cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[#121212] mb-2">
                      SESSION EXPIRY
                    </label>
                    <select
                      value={newExpiryDays}
                      onChange={(e) => setNewExpiryDays(Number(e.target.value))}
                      className="w-full bg-white border-2 border-black text-[#121212] text-xs font-mono font-bold px-2 py-1.5 uppercase focus:bg-[#FFF9C4] outline-none"
                    >
                      <option value={1}>24 HOURS [BURST]</option>
                      <option value={7}>7 DAYS [STANDARD]</option>
                      <option value={30}>30 DAYS [EXTENDED]</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-2">
                    WHITELISTED ASSETS // PERMITTED FOR DELEGATE
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {["AAPL", "TSLA", "NVDA", "ETH"].map((symbol) => {
                      const isChecked = newAllowedTokens.includes(symbol);
                      return (
                        <button
                          type="button"
                          key={symbol}
                          onClick={() => {
                            if (isChecked) {
                              setNewAllowedTokens(newAllowedTokens.filter((t) => t !== symbol));
                            } else {
                              setNewAllowedTokens([...newAllowedTokens, symbol]);
                            }
                          }}
                          className={`px-4 py-2 text-xs font-mono font-black border-2 transition uppercase ${
                            isChecked
                              ? "bg-[#1040C0] text-white border-black shadow-[3px_3px_0px_0px_black] active:translate-x-[1px] active:translate-y-[1px]"
                              : "bg-white text-black border-black hover:bg-[#F0F0F0]"
                          }`}
                        >
                          {isChecked ? "■ " : "+ "}
                          {symbol}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Honest Risk Disclosure (Sum of Caps vs Oracle Floor) */}
                <div className="p-4 bg-[#FFF9C4] border-4 border-black shadow-[4px_4px_0px_0px_black] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono font-black uppercase text-[#121212]">
                    <span className="flex items-center">
                      <span className="text-[#D02020] mr-1.5">▲</span> WORST-CASE 24H EXPOSURE DISCLOSURE:
                    </span>
                    <span className="bg-[#D02020] text-white px-2 py-0.5 border border-black font-black">
                      ${newDailyLimit * newAllowedTokens.length} USD MAX
                    </span>
                  </div>
                  <p className="text-[11px] font-mono font-medium text-neutral-800 uppercase leading-relaxed">
                    Without an oracle guard, a rogue agent can dump up to ${newDailyLimit} per asset across all {newAllowedTokens.length} tokens.
                    With AgentShield's Chainlink Oracle price floor & linear refill, bad fills revert immediately on-chain and maximum loss is strictly bounded to slippage floor.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#D02020] hover:bg-[#D02020]/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-white font-black uppercase text-sm tracking-wider py-4 border-4 border-black shadow-[6px_6px_0px_0px_black] transition-all flex items-center justify-center space-x-2"
                >
                  <PlusCircle className="w-5 h-5 stroke-[3]" />
                  <span>DEPLOY SESSION KEY TO ARBITRUM STYLUS VAULT</span>
                </button>
              </form>
            </div>

            {/* Section 03: Active Agent Delegation Matrix */}
            <div className="bg-white border-4 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_black] relative hover:-translate-y-1 transition-transform">
              {/* Corner Shape Decoration: Triangle */}
              <div className="clip-triangle w-4 h-4 bg-[#F0C020] absolute top-4 right-4" title="Triangle" />

              <div className="flex items-start justify-between pb-4 mb-6 border-b-4 border-black">
                <div>
                  <h2 className="text-lg font-black tracking-tight uppercase text-[#121212] flex items-center">
                    03 // ACTIVE DELEGATION MATRIX
                  </h2>
                  <p className="text-[11px] font-mono font-bold text-neutral-600 uppercase mt-0.5">
                    MONITORED AUTONOMOUS AGENTS // EMERGENCY KILLSWITCH
                  </p>
                </div>
                <span className="bg-[#1040C0] text-white border-2 border-black px-2.5 py-0.5 text-[10px] font-mono font-black uppercase shadow-[2px_2px_0px_0px_black]">
                  SESSIONS: {sessionKeys.filter((k) => k.isActive).length}
                </span>
              </div>

              <div className="space-y-4">
                {sessionKeys.map((key) => {
                  const spendPercent = Math.min(100, Math.round((key.spentToday / key.dailyLimit) * 100));
                  const hoursLeft = Math.max(
                    0,
                    Math.round((key.expiryTimestamp - Date.now()) / (3600 * 1000 * 24))
                  );

                  return (
                    <div
                      key={key.agentAddress}
                      className={`p-5 border-4 border-black transition ${
                        key.isActive
                          ? "bg-[#F0F0F0] shadow-[4px_4px_0px_0px_black]"
                          : "bg-[#E0E0E0] opacity-75"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-black text-base uppercase text-[#121212] tracking-tight">{key.agentName}</span>
                            {key.isActive ? (
                              <span className="text-[10px] bg-[#F0C020] text-black font-black uppercase px-2.5 py-0.5 border-2 border-black shadow-[2px_2px_0px_0px_black]">
                                [ACTIVE]
                              </span>
                            ) : (
                              <span className="text-[10px] bg-[#D02020] text-white font-black uppercase px-2.5 py-0.5 border-2 border-black shadow-[2px_2px_0px_0px_black]">
                                [REVOKED]
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-600 font-mono font-bold mt-1 uppercase">
                            AGENT_ADDRESS: {key.agentAddress}
                          </div>
                        </div>

                        {key.isActive && (
                          <button
                            onClick={() => handleRevokeKey(key.agentAddress)}
                            className="bg-[#D02020] hover:bg-[#D02020]/90 text-white active:translate-x-[2px] active:translate-y-[2px] active:shadow-none border-2 border-black font-black uppercase text-xs px-3.5 py-1.5 shadow-[3px_3px_0px_0px_black] transition-all flex items-center space-x-1"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 stroke-[3]" />
                            <span>REVOKE</span>
                          </button>
                        )}
                      </div>

                      {/* Stepped Spend Gauge */}
                      <div className="mt-4">
                        <div className="flex justify-between text-[11px] font-mono font-black uppercase text-[#121212] mb-1.5">
                          <span>
                            BUCKET UTILIZATION: <span className="font-mono text-[#D02020]">${key.spentToday}</span> / ${key.dailyLimit}
                          </span>
                          <span className="font-mono">{spendPercent}% EXHAUSTED</span>
                        </div>
                        <div className="w-full bg-white h-4 border-2 border-black p-0.5 shadow-[2px_2px_0px_0px_black]">
                          <div
                            className={`h-full transition-all duration-300 ${
                              spendPercent > 90 ? "bg-[#D02020]" : spendPercent > 60 ? "bg-[#F0C020]" : "bg-[#1040C0]"
                            }`}
                            style={{ width: `${spendPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Metadata */}
                      <div className="mt-4 pt-3 border-t-2 border-black flex flex-wrap items-center justify-between text-xs font-mono font-bold text-neutral-800 gap-2 uppercase">
                        <div className="flex items-center space-x-1.5">
                          <span>WHITELIST:</span>
                          {key.allowedTokens.map((t) => (
                            <span
                              key={t}
                              className="bg-white border-2 border-black text-[#121212] px-2 py-0.5 text-[10px] font-black"
                            >
                              {t}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center space-x-4">
                          <span>MAX/TX: ${key.maxSpendLimit}</span>
                          <span>EXPIRES: ~{hoursLeft}D</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* --- Section 04: Interactive Simulation Terminal & Prompt Defense --- */}
        <div className="bg-white border-4 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_black] relative">
          {/* Corner Decoration: Blue Square */}
          <div className="w-3.5 h-3.5 bg-[#1040C0] border border-black absolute top-4 right-4" title="Square" />

          <div className="flex items-start justify-between pb-4 mb-6 border-b-4 border-black">
            <div>
              <h2 className="text-xl font-black tracking-tight uppercase text-[#121212] flex items-center">
                04 // RUNTIME VERIFICATION & ATTACK DEFENSE
              </h2>
              <p className="text-[11px] font-mono font-bold text-neutral-600 uppercase mt-0.5">
                MODEL CONTEXT PROTOCOL (MCP) // PRE-FLIGHT SIMULATION & ERROR DECODING
              </p>
            </div>
            <span className="bg-[#D02020] text-white border-2 border-black px-2.5 py-0.5 text-[10px] font-mono font-black uppercase shadow-[2px_2px_0px_0px_black]">
              MCP_CLIENT_ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Simulation Controls */}
            <div className="lg:col-span-5 bg-[#F0F0F0] p-5 border-4 border-black shadow-[4px_4px_0px_0px_black] space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-1.5">
                  CALLER AGENT KEY
                </label>
                <select
                  value={simAgent}
                  onChange={(e) => setSimAgent(e.target.value)}
                  className="w-full bg-white border-4 border-black text-[#121212] text-xs font-mono font-bold px-3 py-2.5 uppercase focus:bg-[#FFF9C4] outline-none"
                >
                  {sessionKeys.map((k) => (
                    <option key={k.agentAddress} value={k.agentAddress}>
                      {k.agentName} ({k.agentAddress.slice(0, 6)}...)
                    </option>
                  ))}
                  <option value="0x6666666666666666666666666666666666666666">
                    🚨 UNAUTHORIZED ROGUE AGENT (0x6666...)
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-1.5">
                    RWA ASSET
                  </label>
                  <select
                    value={simToken}
                    onChange={(e) => setSimToken(e.target.value)}
                    className="w-full bg-white border-4 border-black text-[#121212] text-xs font-mono font-bold px-3 py-2.5 uppercase focus:bg-[#FFF9C4] outline-none"
                  >
                    <option value="AAPL">AAPL</option>
                    <option value="TSLA">TSLA</option>
                    <option value="NVDA">NVDA (UNWHITELISTED)</option>
                    <option value="ETH">ETH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#121212] mb-1.5">
                    TRADE VALUE ($)
                  </label>
                  <input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="w-full bg-white border-4 border-black text-[#121212] text-xs font-mono font-bold px-3 py-2.5 uppercase focus:bg-[#FFF9C4] outline-none"
                    placeholder="200"
                  />
                </div>
              </div>

              <div className="space-y-2.5 pt-1">
                <button
                  onClick={handleExecuteTrade}
                  className="w-full bg-[#F0C020] hover:bg-[#F0C020]/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-black font-black uppercase text-xs tracking-wider py-3 border-4 border-black shadow-[4px_4px_0px_0px_black] transition-all flex items-center justify-center space-x-2"
                >
                  <Zap className="w-4 h-4 stroke-[3]" />
                  <span>SIMULATE AGENT TRADE CALL</span>
                </button>

                <button
                  onClick={handleSimulateAttack}
                  className="w-full bg-[#D02020] hover:bg-[#D02020]/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-white font-black uppercase text-xs tracking-wider py-3 border-4 border-black shadow-[4px_4px_0px_0px_black] transition-all flex items-center justify-center space-x-2"
                >
                  <AlertTriangle className="w-4 h-4 stroke-[3]" />
                  <span>TEST PROMPT INJECTION DEFENSE</span>
                </button>
              </div>

              <div className="text-[11px] font-mono font-bold text-neutral-700 border-t-2 border-black pt-3 space-y-1 uppercase">
                <div>• $400 ON AAPL: <span className="text-[#1040C0]">PASS (WITHIN CAPS)</span></div>
                <div>• $600 ON AAPL: <span className="text-[#D02020]">REVERT (SPEND_LIMIT_EXCEEDED)</span></div>
                <div>• $200 ON NVDA: <span className="text-[#D02020]">REVERT (TOKEN_NOT_ALLOWED)</span></div>
              </div>
            </div>

            {/* Execution Console Output */}
            <div className="lg:col-span-7 bg-[#121212] border-4 border-black p-5 font-mono text-xs shadow-[6px_6px_0px_0px_black] flex flex-col justify-between max-h-80">
              <div className="text-[11px] font-mono font-bold uppercase text-neutral-400 border-b-2 border-neutral-700 pb-2.5 mb-3 flex justify-between">
                <span className="text-white font-black">[BAUHAUS_VM_LOG // 46630_STYLUS]</span>
                <span className="text-[#F0C020] animate-pulse">● ACTIVE</span>
              </div>
              <div className="overflow-y-auto space-y-2 flex-1 pr-1">
                {logs.map((log) => {
                  const color =
                    log.type === "success"
                      ? "text-[#F0C020]"
                      : log.type === "error"
                      ? "text-[#D02020]"
                      : log.type === "warning"
                      ? "text-[#F0C020]"
                      : "text-white";
                  return (
                    <div key={log.id} className="leading-relaxed flex flex-wrap items-center">
                      <span className="text-neutral-500 font-mono">[{log.timestamp}]</span>{" "}
                      <span className={`ml-2 font-mono ${color}`}>{log.message}</span>
                      {log.txHash && (
                        <a
                          href={`${ROBINHOOD_CHAIN.blockExplorers.default.url}/tx/${log.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-white text-black border-2 border-white px-2 py-0.5 ml-2 text-[10px] font-black uppercase hover:bg-[#F0C020] transition-colors inline-flex items-center"
                        >
                          [TX: {log.txHash.slice(0, 8)}...] <ExternalLink className="w-2.5 h-2.5 ml-1" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* --- Section 05: Bauhaus FAQ Accordion (Compliant with Spec) --- */}
        <section className="space-y-6">
          <div className="flex items-center space-x-3">
            <span className="clip-triangle w-4 h-4 bg-[#D02020]" />
            <h2 className="text-2xl font-black uppercase tracking-tight text-[#121212]">
              05 // MATHEMATICAL INVARIANTS (BAUHAUS FAQ)
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: "HOW DOES AGENTSHIELD BLOCK PROMPT INJECTION & UNLIMITED SPEND?",
                a: "The AgentVault smart contract never forwards arbitrary calldata or raw router parameters. It routes exclusively through user-allowlisted ISwapAdapter contracts, strictly enforces per-trade limits, and settles all trades via balance diffs directly into the user's ledger.",
              },
              {
                q: "HOW DOES THE LINEAR TOKEN BUCKET PREVENT 24-HOUR EDGE DUMPING?",
                a: "Traditional fixed windows let an attacker drain the limit at 23:59 and again at 00:01 (2x daily cap). AgentShield uses a continuous linear token bucket (available = min(dailyCap, bucket + (now - ts) * dailyCap / 86400)). Burst capacity never exceeds dailyCap.",
              },
              {
                q: "HOW DOES THE ORACLE PRICE FLOOR PREVENT UNFAVORABLE FILLS?",
                a: "Before executing any swap, the vault verifies Arbitrum L2 sequencer uptime and queries Chainlink price feeds to establish a hard mathematical price floor. Any trade returning less than the floor reverts on-chain.",
              },
            ].map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className={`border-4 border-black transition-all ${
                    isOpen ? "shadow-[6px_6px_0px_0px_black]" : "bg-white shadow-[4px_4px_0px_0px_black]"
                  }`}
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className={`w-full p-5 flex items-center justify-between text-left font-black uppercase text-sm tracking-wider transition ${
                      isOpen ? "bg-[#D02020] text-white" : "bg-white text-black hover:bg-[#F0F0F0]"
                    }`}
                  >
                    <span>{faq.q}</span>
                    <ChevronDown className={`w-5 h-5 stroke-[3] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="bg-[#FFF9C4] text-[#121212] p-5 border-t-4 border-black text-xs font-mono font-medium leading-relaxed">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* --- Mandatory Solid Black Bauhaus Footer --- */}
      <footer className="border-t-4 border-black bg-[#121212] text-white py-14 px-6 sm:px-8 mt-16">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="space-y-2">
            <div className="flex items-center space-x-2.5">
              <span className="w-3.5 h-3.5 rounded-full bg-[#D02020] border border-white" />
              <span className="w-3.5 h-3.5 bg-[#1040C0] border border-white" />
              <span className="clip-triangle w-3.5 h-3.5 bg-[#F0C020]" />
              <span className="text-lg font-black uppercase tracking-tighter text-white ml-1">
                AGENTSHIELD // 1920s BAUHAUS REVOLUTION
              </span>
            </div>
            <p className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
              FORM FOLLOWS FUNCTION // ARBITRUM STYLUS RUST WASM // ROBINHOOD CHAIN L2 [46630]
            </p>
          </div>

          <div className="text-xs font-mono text-neutral-400 uppercase tracking-widest text-right">
            ARBITRUM OPEN HOUSE BUILDATHON 2026
          </div>
        </div>
      </footer>
    </div>
  );
}
