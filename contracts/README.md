# contracts

Foundry workspace for Vigiles.

- `src/AgentVaultSolidityReference.sol` — EVM twin of the Stylus vault, kept line-for-line in sync so the whole test suite (hostile adapters, fuzz, invariants) exercises the same rules.
- `src/IAgentVault.sol` — interface + events + custom errors shared by the reference and the tests.
- `src/IAgentVaultStylus.sol` — **generated** exact ABI of the deployed Stylus vault (`cargo run --features export-abi`). CI diffs it; do not hand-edit.
- `src/Mock*.sol` — tokenized-stock ERC20 with a faucet, configurable hostile swap adapter, Chainlink-shaped feeds.
- `test/AgentVault.t.sol` — v2 behaviour, hostile adapters, exploit regressions, oracle guard.
- `test/AgentVaultGuards.t.sol` — v3 guardrails: trading window (incl. fuzz vs. an independent clock), velocity, heartbeat, position cap, intent receipts, access control, and the end-to-end hijacked-agent scenario.
- `test/AgentVaultInvariants.t.sol` — solvency and user-isolation invariants under random deposits/withdrawals/trades/time-warps.
- `script/DeployMocks.s.sol` — deploys mocks + adapter to Robinhood Chain testnet; driven by `scripts/deploy_mocks.sh`.

```bash
forge test -vv
```
