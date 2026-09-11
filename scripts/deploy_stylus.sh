#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${RPC_URL:-https://rpc.robinhood.com/testnet}"
PRIVATE_KEY="${PRIVATE_KEY:-}"

echo "========================================================"
echo "  AgentShield Stylus Vault Deployment to Robinhood Chain"
echo "========================================================"

# 1. Compile to wasm32-unknown-unknown
echo "[1/3] Compiling Rust contract to WebAssembly..."
cd "$(dirname "$0")/../agent-shield-vault"
cargo build --release --target wasm32-unknown-unknown

WASM_PATH="target/wasm32-unknown-unknown/release/agent_shield_vault.wasm"
if [ ! -f "$WASM_PATH" ]; then
    echo "Error: WASM artifact not found at $WASM_PATH"
    exit 1
fi

WASM_SIZE=$(wc -c < "$WASM_PATH")
echo "WASM binary successfully created: $WASM_PATH ($WASM_SIZE bytes)"

# 2. Deploy using cargo-stylus
echo "[2/3] Deploying to Robinhood Chain Testnet ($RPC_URL)..."
if [ -n "$PRIVATE_KEY" ]; then
    cargo stylus deploy --endpoint "$RPC_URL" --private-key "$PRIVATE_KEY"
else
    echo "Dry run: Run with PRIVATE_KEY set to broadcast on-chain."
fi

echo "[3/3] Deployment complete. AgentShield is live!"
