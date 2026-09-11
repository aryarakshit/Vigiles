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
} from "lucide-react";
import { CONTRACT_ADDRESSES } from "../config/contracts";

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
}

export default function Home() {
  // Wallet State
  const [walletConnected, setWalletConnected] = useState<boolean>(true);
  const [userAddress, setUserAddress] = useState<string>("0xa11ce52d000000000000000000000000000a11ce");

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

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [
      {
        id: Math.random().toString(),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message,
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

    setSessionKeys((prev) => [newKey, ...prev]);
    addLog(
      "success",
      `SessionKeyCreated: Agent ${newAgentAddress.slice(0, 6)}...${newAgentAddress.slice(-4)} | Max: $${newMaxSpend} | Daily: $${newDailyLimit} | Expiry: ${newExpiryDays}d`
    );
  };

  // Handle Revoke Session Key
  const handleRevokeKey = (agentAddress: string) => {
    setSessionKeys((prev) =>
      prev.map((k) => (k.agentAddress === agentAddress ? { ...k, isActive: false } : k))
    );
    addLog(
      "warning",
      `SessionKeyRevoked: Emergency kill-switch executed for agent ${agentAddress.slice(0, 6)}...${agentAddress.slice(-4)}`
    );
  };

  // Handle Deposit / Withdraw
  const handleVaultAction = () => {
    const amountNum = parseFloat(actionAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    if (activeTab === "deposit") {
      if ((balances[selectedToken] || 0) < amountNum) {
        addLog("error", `Deposit failed: Insufficient wallet balance for ${selectedToken}`);
        return;
      }
      setBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] - amountNum }));
      setVaultBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] + amountNum }));
      addLog("success", `Deposit: Locked ${amountNum} ${selectedToken} into AgentVault`);
    } else {
      if ((vaultBalances[selectedToken] || 0) < amountNum) {
        addLog("error", `Withdraw failed: Insufficient vault balance for ${selectedToken}`);
        return;
      }
      setVaultBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] - amountNum }));
      setBalances((prev) => ({ ...prev, [selectedToken]: prev[selectedToken] + amountNum }));
      addLog("success", `Withdraw: Returned ${amountNum} ${selectedToken} to wallet`);
    }
    setActionAmount("");
  };

  // Handle Faucet Mint
  const handleFaucet = (token: string) => {
    setBalances((prev) => ({ ...prev, [token]: (prev[token] || 0) + 100 }));
    addLog("info", `Faucet: Minted 100 Mock ${token} (Tokenized Stock) on Robinhood Testnet`);
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
    setVaultBalances((prev) => ({ ...prev, [simToken]: prev[simToken] - tradeAmount }));
    setSessionKeys((prev) =>
      prev.map((k) => (k.agentAddress === simAgent ? { ...k, spentToday: newSpent } : k))
    );
    addLog(
      "success",
      `TradeExecuted: Agent ${key.agentName} traded $${tradeAmount} ${simToken} via Robinhood DEX Router! Nonce verified, spend limits updated.`
    );
  };

  const totalVaultUsd =
    vaultBalances.ETH * 2800 +
    vaultBalances.AAPL * 225 +
    vaultBalances.TSLA * 240 +
    vaultBalances.NVDA * 120;

  return (
    <div className="min-h-screen bg-[#0A0D14] text-gray-100 flex flex-col">
      {/* --- Top Navigation --- */}
      <header className="border-b border-[#1E293B] bg-[#0E131F]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-[#00C805] to-emerald-400 p-2 rounded-xl shadow-lg shadow-[#00C805]/20">
              <Shield className="w-6 h-6 text-black font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-white">
                  Agent<span className="text-[#00C805]">Shield</span>
                </span>
                <span className="text-xs bg-[#00C805]/10 text-[#00C805] border border-[#00C805]/30 px-2 py-0.5 rounded-full font-mono font-medium">
                  Stylus Rust WASM
                </span>
              </div>
              <p className="text-xs text-gray-400">Risk-Management Vault for AI Agents on Robinhood Chain</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden md:flex items-center space-x-2 bg-[#18202F] border border-[#263249] px-3 py-1.5 rounded-lg text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-[#00C805] animate-pulse" />
              <span className="text-gray-300">Robinhood Chain Testnet</span>
              <span className="text-gray-500">•</span>
              <span className="text-gray-400">ID: 1333137</span>
            </div>

            <button
              onClick={() => setWalletConnected(!walletConnected)}
              className="flex items-center space-x-2 bg-gradient-to-r from-[#00C805] to-emerald-500 hover:from-emerald-400 hover:to-[#00C805] text-black font-semibold text-sm px-4 py-2 rounded-lg transition shadow-md shadow-[#00C805]/20"
            >
              <Key className="w-4 h-4" />
              <span>{walletConnected ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : "Connect Wallet"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* --- Main Dashboard Container --- */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 space-y-8">
        {/* --- Highlight Metrics Row --- */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#121824] border border-[#222E42] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>Total Vault Value Protected</span>
              <DollarSign className="w-4 h-4 text-[#00C805]" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              ${totalVaultUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-[#00C805] mt-1 flex items-center">
              <Shield className="w-3 h-3 mr-1" /> Multi-token RWA isolation
            </div>
          </div>

          <div className="bg-[#121824] border border-[#222E42] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>Active Agent Session Keys</span>
              <Cpu className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {sessionKeys.filter((k) => k.isActive).length} <span className="text-xs text-gray-500 font-normal">/ {sessionKeys.length} total</span>
            </div>
            <div className="text-xs text-emerald-400 mt-1 flex items-center">
              <Zap className="w-3 h-3 mr-1" /> Autonomous Trading Active
            </div>
          </div>

          <div className="bg-[#121824] border border-[#222E42] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>24h Daily Spend Limit</span>
              <TrendingUp className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              ${sessionKeys.reduce((acc, k) => acc + (k.isActive ? k.spentToday : 0), 0).toLocaleString()}
              <span className="text-xs text-gray-500 font-normal"> / ${sessionKeys.reduce((acc, k) => acc + (k.isActive ? k.dailyLimit : 0), 0).toLocaleString()}</span>
            </div>
            <div className="text-xs text-blue-400 mt-1 flex items-center">
              <RefreshCw className="w-3 h-3 mr-1" /> Automatic 24h Rolling Window
            </div>
          </div>

          <div className="bg-[#121824] border border-[#222E42] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>On-Chain Security Invariants</span>
              <CheckCircle2 className="w-4 h-4 text-[#00C805]" />
            </div>
            <div className="text-lg font-bold text-[#00C805] tracking-tight">
              Stylus Verified
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Zero-Panics • Reentrancy Guard • WASM
            </div>
          </div>
        </div>

        {/* --- Two Column Layout --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* --- Left Column: Vault Assets & Faucet (1 col) --- */}
          <div className="space-y-6">
            {/* Vault Balance Card */}
            <div className="bg-[#121824] border border-[#222E42] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white flex items-center">
                  <Shield className="w-4 h-4 text-[#00C805] mr-2" />
                  Your Protected Vault Assets
                </h2>
                <span className="text-xs text-gray-400 font-mono">AgentShield Vault</span>
              </div>

              <div className="space-y-3">
                {Object.entries(CONTRACT_ADDRESSES.tokens).map(([key, info]) => {
                  const vBal = vaultBalances[key] || 0;
                  const wBal = balances[key] || 0;
                  return (
                    <div
                      key={key}
                      className="bg-[#18202F] border border-[#263249] p-3 rounded-lg flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{info.icon}</span>
                        <div>
                          <div className="text-sm font-semibold text-white">{info.symbol}</div>
                          <div className="text-xs text-gray-400">{info.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-white font-mono">{vBal.toFixed(2)}</div>
                        <div className="text-xs text-gray-400 font-mono">Wallet: {wBal.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Deposit / Withdraw Action Box */}
              <div className="mt-6 border-t border-[#222E42] pt-4">
                <div className="flex rounded-lg bg-[#0F141C] p-1 mb-4 border border-[#222E42]">
                  <button
                    onClick={() => setActiveTab("deposit")}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                      activeTab === "deposit"
                        ? "bg-[#00C805] text-black shadow"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Deposit to Vault
                  </button>
                  <button
                    onClick={() => setActiveTab("withdraw")}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                      activeTab === "withdraw"
                        ? "bg-[#00C805] text-black shadow"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Withdraw
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex space-x-2">
                    <select
                      value={selectedToken}
                      onChange={(e) => setSelectedToken(e.target.value)}
                      className="bg-[#18202F] border border-[#263249] text-white text-xs rounded-lg px-3 py-2 font-mono"
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
                      placeholder="Amount"
                      className="flex-1 bg-[#18202F] border border-[#263249] text-white text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#00C805]"
                    />
                  </div>

                  <button
                    onClick={handleVaultAction}
                    className="w-full bg-[#18202F] hover:bg-[#222E42] border border-[#00C805]/50 hover:border-[#00C805] text-[#00C805] text-xs font-semibold py-2.5 rounded-lg transition flex items-center justify-center space-x-1"
                  >
                    {activeTab === "deposit" ? (
                      <>
                        <ArrowDownRight className="w-4 h-4" />
                        <span>Lock In Vault</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-4 h-4" />
                        <span>Withdraw to Wallet</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Faucet Box for Judges / Testers */}
              <div className="mt-4 p-3 bg-[#18202F]/50 border border-dashed border-[#263249] rounded-lg">
                <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center justify-between">
                  <span>Robinhood Testnet Faucet</span>
                  <span className="text-[10px] text-[#00C805]">1-Click Mint</span>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleFaucet("AAPL")}
                    className="flex-1 text-[11px] bg-[#222E42] hover:bg-[#2D3D58] py-1 rounded text-white font-mono"
                  >
                    +100 AAPL
                  </button>
                  <button
                    onClick={() => handleFaucet("TSLA")}
                    className="flex-1 text-[11px] bg-[#222E42] hover:bg-[#2D3D58] py-1 rounded text-white font-mono"
                  >
                    +100 TSLA
                  </button>
                  <button
                    onClick={() => handleFaucet("NVDA")}
                    className="flex-1 text-[11px] bg-[#222E42] hover:bg-[#2D3D58] py-1 rounded text-white font-mono"
                  >
                    +100 NVDA
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* --- Right Column: Session Key Manager & Active Agents (2 cols) --- */}
          <div className="lg:col-span-2 space-y-6">
            {/* Session Key Generator Form */}
            <div className="bg-[#121824] border border-[#222E42] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center">
                    <Key className="w-4 h-4 text-[#00C805] mr-2" />
                    Issue Cryptographic AI Session Key
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Enforces strict on-chain risk boundaries: per-trade caps, daily loss limits, and asset whitelisting.
                  </p>
                </div>
                <span className="text-xs font-mono bg-[#00C805]/10 text-[#00C805] px-2 py-1 rounded border border-[#00C805]/20">
                  Risk Engine Active
                </span>
              </div>

              <form onSubmit={handleCreateSessionKey} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">AI Agent Identifier / Name</label>
                    <input
                      type="text"
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      className="w-full bg-[#18202F] border border-[#263249] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#00C805]"
                      placeholder="e.g. Robinhood HFT Bot"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Agent Wallet Address</label>
                    <input
                      type="text"
                      value={newAgentAddress}
                      onChange={(e) => setNewAgentAddress(e.target.value)}
                      className="w-full bg-[#18202F] border border-[#263249] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#00C805]"
                      placeholder="0x..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Max Spend / Trade</span>
                      <span className="text-white font-mono">${newMaxSpend}</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={newMaxSpend}
                      onChange={(e) => setNewMaxSpend(Number(e.target.value))}
                      className="w-full accent-[#00C805]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>24h Daily Spend Limit</span>
                      <span className="text-white font-mono">${newDailyLimit}</span>
                    </div>
                    <input
                      type="range"
                      min="200"
                      max="5000"
                      step="100"
                      value={newDailyLimit}
                      onChange={(e) => setNewDailyLimit(Number(e.target.value))}
                      className="w-full accent-[#00C805]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Session Key Expiry</label>
                    <select
                      value={newExpiryDays}
                      onChange={(e) => setNewExpiryDays(Number(e.target.value))}
                      className="w-full bg-[#18202F] border border-[#263249] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#00C805]"
                    >
                      <option value={1}>24 Hours</option>
                      <option value={7}>7 Days (Recommended)</option>
                      <option value={30}>30 Days</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-2">Whitelisted Trading Assets (RWAs)</label>
                  <div className="flex flex-wrap gap-2">
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
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
                            isChecked
                              ? "bg-[#00C805]/20 text-[#00C805] border-[#00C805]"
                              : "bg-[#18202F] text-gray-400 border-[#263249] hover:border-gray-500"
                          }`}
                        >
                          {isChecked ? "✓ " : "+ "}
                          {symbol}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#00C805] hover:bg-emerald-400 text-black font-semibold text-xs py-3 rounded-lg transition shadow-md shadow-[#00C805]/20 flex items-center justify-center space-x-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Deploy Session Key to Arbitrum Stylus Vault</span>
                </button>
              </form>
            </div>

            {/* Active AI Agent Monitors */}
            <div className="bg-[#121824] border border-[#222E42] rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-white mb-4 flex items-center">
                <Activity className="w-4 h-4 text-[#00C805] mr-2" />
                Active AI Agent Monitors & Risk Tracking
              </h2>

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
                      className={`p-4 rounded-xl border transition ${
                        key.isActive
                          ? "bg-[#18202F] border-[#263249]"
                          : "bg-[#141820]/60 border-red-900/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-sm text-white">{key.agentName}</span>
                            {key.isActive ? (
                              <span className="text-[10px] bg-[#00C805]/20 text-[#00C805] border border-[#00C805]/40 px-2 py-0.5 rounded-full font-mono">
                                ACTIVE
                              </span>
                            ) : (
                              <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.5 rounded-full font-mono">
                                REVOKED
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 font-mono mt-1">
                            {key.agentAddress}
                          </div>
                        </div>

                        {key.isActive && (
                          <button
                            onClick={() => handleRevokeKey(key.agentAddress)}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs px-3 py-1.5 rounded-lg transition font-medium flex items-center space-x-1"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Revoke Key</span>
                          </button>
                        )}
                      </div>

                      {/* Spend Progress Bar */}
                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>
                            Daily Spend: <span className="text-white font-mono">${key.spentToday}</span> / ${key.dailyLimit}
                          </span>
                          <span className="font-mono">{spendPercent}% consumed</span>
                        </div>
                        <div className="w-full bg-[#0F141C] h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              spendPercent > 90 ? "bg-red-500" : spendPercent > 60 ? "bg-amber-400" : "bg-[#00C805]"
                            }`}
                            style={{ width: `${spendPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Metadata row */}
                      <div className="mt-4 pt-3 border-t border-[#263249]/60 flex flex-wrap items-center justify-between text-xs text-gray-400 gap-2">
                        <div className="flex items-center space-x-2">
                          <span>Whitelisted:</span>
                          {key.allowedTokens.map((t) => (
                            <span
                              key={t}
                              className="bg-[#222E42] text-gray-200 px-1.5 py-0.5 rounded text-[11px] font-mono"
                            >
                              {t}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center space-x-4 font-mono text-[11px]">
                          <span>Max / Tx: ${key.maxSpendLimit}</span>
                          <span>Expires: ~{hoursLeft}d</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* --- Interactive AI Agent Simulation Terminal --- */}
        <div className="bg-[#121824] border border-[#222E42] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Terminal className="w-5 h-5 text-[#00C805]" />
              <h2 className="text-base font-semibold text-white">
                Live AI Agent Trade Execution Simulator
              </h2>
            </div>
            <span className="text-xs text-gray-400 font-mono">Simulates MCP Server `execute_trade()`</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Simulation Controls */}
            <div className="bg-[#18202F] p-4 rounded-xl border border-[#263249] space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Select AI Agent Caller</label>
                <select
                  value={simAgent}
                  onChange={(e) => setSimAgent(e.target.value)}
                  className="w-full bg-[#0F141C] border border-[#263249] text-white text-xs rounded-lg px-3 py-2 font-mono"
                >
                  {sessionKeys.map((k) => (
                    <option key={k.agentAddress} value={k.agentAddress}>
                      {k.agentName} ({k.agentAddress.slice(0, 6)}...)
                    </option>
                  ))}
                  <option value="0x6666666666666666666666666666666666666666">
                    🚨 Unauthorized Hacker Bot (0x6666...)
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">RWA Asset</label>
                  <select
                    value={simToken}
                    onChange={(e) => setSimToken(e.target.value)}
                    className="w-full bg-[#0F141C] border border-[#263249] text-white text-xs rounded-lg px-3 py-2 font-mono"
                  >
                    <option value="AAPL">AAPL</option>
                    <option value="TSLA">TSLA</option>
                    <option value="NVDA">NVDA (Unwhitelisted)</option>
                    <option value="ETH">ETH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Trade Amount ($)</label>
                  <input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="w-full bg-[#0F141C] border border-[#263249] text-white text-xs rounded-lg px-3 py-2 font-mono"
                    placeholder="200"
                  />
                </div>
              </div>

              <button
                onClick={handleExecuteTrade}
                className="w-full bg-gradient-to-r from-[#00C805] to-emerald-500 hover:from-emerald-400 hover:to-[#00C805] text-black font-semibold text-xs py-2.5 rounded-lg transition flex items-center justify-center space-x-1 shadow-md shadow-[#00C805]/20"
              >
                <Zap className="w-4 h-4" />
                <span>Simulate Agent Trade Call</span>
              </button>

              <div className="text-[11px] text-gray-400 border-t border-[#263249] pt-2 space-y-1 font-mono">
                <div>• Try $400 on AAPL: Pass</div>
                <div>• Try $600 on AAPL: Revert (SpendLimitExceeded)</div>
                <div>• Try $200 on NVDA: Revert (TokenNotAllowed)</div>
              </div>
            </div>

            {/* Execution Console Output */}
            <div className="lg:col-span-2 bg-[#0A0D14] border border-[#222E42] rounded-xl p-4 font-mono text-xs overflow-y-auto max-h-60 space-y-1.5">
              <div className="text-gray-500 text-[11px] border-b border-[#222E42] pb-1 flex justify-between">
                <span>ON-CHAIN WASM RISK ENGINE LOG</span>
                <span className="text-[#00C805]">LIVE</span>
              </div>
              {logs.map((log) => {
                const color =
                  log.type === "success"
                    ? "text-[#00C805]"
                    : log.type === "error"
                    ? "text-red-400"
                    : log.type === "warning"
                    ? "text-amber-400"
                    : "text-blue-400";
                return (
                  <div key={log.id} className="leading-relaxed">
                    <span className="text-gray-600">[{log.timestamp}]</span>{" "}
                    <span className={color}>{log.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* --- Footer --- */}
      <footer className="border-t border-[#1E293B] bg-[#0E131F] py-6 text-xs text-gray-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="text-gray-300 font-semibold">AgentShield</span>
            <span>•</span>
            <span>Built with Arbitrum Stylus (Rust WASM) for Robinhood Chain Orbit L2</span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-[#00C805]">Arbitrum Open House Buildathon 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
