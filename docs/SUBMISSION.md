# Vigiles — HackQuest submission

Paste-ready text for the submission form. Fill the three `⟨…⟩` placeholders after deployment. Every number below is reproducible from the repo (`forge test`, `cargo test --lib`, the WASM size check in CI).

---

## Project name

Vigiles

## One-liner

Session keys, not wallet keys — a Stylus (Rust) vault that cages AI trading agents with hard on-chain limits.

## Links

- Live dashboard: https://vigilesprj.vercel.app
- Code: https://github.com/aryarakshit/Vigiles
- Vault on Robinhood Chain testnet: https://explorer.testnet.chain.robinhood.com/address/0xa3c88463bf249bda1c92ac75fe7c3f77cf989be0 (activation tx: https://explorer.testnet.chain.robinhood.com/tx/0xd4045e4d31508f3b9c7dbfff7168095a7b216e6a921e15535a15c420674eb694)
- Demo video: ⟨link⟩
- MCP server: https://github.com/aryarakshit/Vigiles/tree/main/mcp

## Chain

Robinhood Chain testnet (Arbitrum Orbit L2, chain id 46630). Contract is Arbitrum Stylus (Rust → WASM).

## Problem

AI agents can now trade autonomously, and to trade they need signing authority. A wallet key is all-or-nothing: one prompt injection, one bad tool result, one runaway loop, and the agent can empty the account in a single transaction. Every existing safeguard lives off-chain, in the same process as the thing it is guarding.

## What we built

A self-custody vault on Robinhood Chain. The user deposits tokenized stocks into a contract that never releases them to anyone but the user, then mints a revocable **session key** for their agent. The agent can rotate value between whitelisted tokens, inside limits the contract enforces — not a prompt, not a policy file, not a middleware.

Eight guards, all checked inside `executeTrade` in a fixed order before any external call:

1. **Spend caps** — per-trade and rolling-24h per token, linear token-bucket refill (no midnight double-dip).
2. **Token + venue whitelist** — epoch-scoped; revocation wipes it in one transaction.
3. **Trading window** — UTC open/close + weekday mask. Tokenized stocks trade 24/5; liquidity follows NYSE.
4. **Velocity limit** — max trades per rolling hour. LLM agents fail by repetition, not just size.
5. **Position cap** — max holding per ticker; bounds the buy side the way daily caps bound the sell side.
6. **Dead-man switch** — a heartbeat interval; if the human goes quiet, the agent freezes.
7. **Intent receipts** — every trade must carry `keccak256(rationale)`, emitted on-chain. The agent commits to *why* before it can act, and the log is tamper-evident.
8. **Oracle price floor** — Chainlink-shaped feeds + L2 sequencer uptime, configured **per user**. There is no admin key to compromise.

Plus: balance-diff settlement (the vault measures what the venue actually took and returned), exact approve → swap → approve-to-zero, reentrancy lock on every mutating entrypoint, token policies immutable per epoch, zero `unsafe` Rust.

Around the contract: a dashboard (viem) with an in-browser agent key and six one-click attack scenarios, a tamper-evident intent verifier, and an MCP server (official SDK) so Claude Desktop / Cursor can trade through the cage with `status`, `preflight`, `execute_trade` (rationale mandatory) and `intent_log`.

## Why it's different

Session keys with spend caps exist (ERC-7715, Safe modules). What doesn't: guards designed for *how AI agents actually fail* — repetition (velocity limit), silence (dead-man switch), untraceability (intent receipts), and 24/5 markets with 6.5-hour liquidity (trading window). And the accent colour on the dashboard is spent on exactly one thing: refusals. A refusal is the cage working.

## Technical notes judges may care about

- **Stylus size engineering.** The vault compresses to 21,900 B brotli against the 24,576 B EIP-170 ceiling, and Robinhood Chain's own prover validated activation (`scripts/stylus_raw.py check`). Getting a 19-function contract there took a limb-wise `U256/u64` division (replacing 4.4 KB of `ruint`), a division-free oracle floor (`minOut·D + D > N`), and building `core` with the `immediate-abort` panic strategy (removing ~10 KB of `core::fmt` that panics keep alive through function pointers).
- **Two implementations, one rule set.** A line-for-line Solidity twin lets the Foundry suite (hostile adapters, fuzz, invariants) exercise the same rules; the exported Stylus ABI is committed and diffed in CI.
- **Tests:** 50 Foundry (incl. `Solvency` and `BobIsolation` invariants over 128,000 calls, a fuzz test of the trading window against an independent clock, and an end-to-end hijacked-agent scenario) + 35 Rust (pure risk engine + `TestVM` against the real contract, including every oracle branch).
- **Bugs found and fixed during the build:** the `#[public]` macro was exporting the private reentrancy-guard helpers — anyone could brick the vault with one call; `executeTrade`'s `data` was ABI-typed `uint8[]` not `bytes`; the original feed registry was global with no access control.

## What was done before vs. during the buildathon

*(Be explicit — the T&C permit existing work that is substantially developed during the event, and disqualify misleading claims.)*

- **Before (as "AgentShield"):** a v2 scaffold — spend caps, whitelist, epoch revocation, balance-diff settlement, a Solidity twin with hostile-adapter and invariant tests, a mocked dashboard. It was not deployable (WASM over the size limit) and the frontend had no chain integration.
- **During the buildathon:** the five agent-specific guards (window, velocity, position cap, heartbeat, intent receipts); the oracle floor ported to Stylus with per-user feeds; the size engineering that made the contract deployable; three security fixes; the real viem dashboard with attack scenarios and intent verifier; the MCP server on the official SDK; the Robinhood Chain deployment (2026-09-12) verified end to end on-chain; ⟨anything else you ship before Oct 1⟩.

## Team

⟨name(s), roles⟩

## Wallet for prizes (Arbitrum One)

⟨0x… — the same address used at registration⟩
