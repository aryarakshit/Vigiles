#!/usr/bin/env bash
# Vigiles — build, check and deploy the Stylus vault to Robinhood Chain testnet.
#
#   ./scripts/deploy_stylus.sh                              # build + on-chain activation check (no key needed)
#   PRIVATE_KEY_PATH=./key.txt ./scripts/deploy_stylus.sh  # build + check + deploy + activate + record manifest
#
# No cargo-stylus or Docker required. The pipeline is the same one cargo-stylus
# runs, done directly:
#   1. cargo +nightly build (panic=immediate-abort, see vigiles-vault/.cargo/config.toml)
#   2. wasm-opt -Oz re-serialises the module (canonical LEBs — Nitro rejects the
#      linker's padded ones) and shrinks it
#   3. scripts/stylus_raw.py: brotli-11 + EFF00000 prefix, eth_call
#      ArbWasm.activateProgram with state overrides (= `cargo stylus check`),
#      then CREATE with the 43-byte prelude and the real activateProgram tx.
#
# Requirements: Rust nightly (rust-src, wasm32 target), Node (viem via mcp/node_modules),
# Python 3 with `brotli`, Binaryen `wasm-opt` (npm i -g binaryen).
# The private key file is passed by path; nothing in this script prints it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_DIR="$ROOT/vigiles-vault"
WASM="$VAULT_DIR/target/wasm32-unknown-unknown/release/vigiles_vault.wasm"
OPT="$VAULT_DIR/target/wasm32-unknown-unknown/release/vigiles_vault.opt.wasm"
MANIFEST="$ROOT/deployments/robinhood-testnet.json"

RPC_URL="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
EXPLORER="${EXPLORER:-https://explorer.testnet.chain.robinhood.com}"
PRIVATE_KEY_PATH="${PRIVATE_KEY_PATH:-}"

if rustup toolchain list | grep -q '^nightly-x86_64-pc-windows-gnu'; then NIGHTLY="+nightly-x86_64-pc-windows-gnu"; else NIGHTLY="+nightly"; fi

echo "== [1/4] cargo build (nightly, build-std, immediate-abort) =="
( cd "$VAULT_DIR" && cargo $NIGHTLY build --release --target wasm32-unknown-unknown )
[ -f "$WASM" ] || { echo "WASM not found at $WASM"; exit 1; }

echo "== [2/4] wasm-opt -Oz (re-serialise + shrink) =="
command -v wasm-opt >/dev/null || { echo "wasm-opt missing: npm i -g binaryen"; exit 1; }
wasm-opt -Oz --enable-bulk-memory-opt --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int -o "$OPT" "$WASM"
echo "   raw $(wc -c < "$WASM") B -> opt $(wc -c < "$OPT") B"

if [ -z "$PRIVATE_KEY_PATH" ]; then
  echo "== [3/4] on-chain activation check =="
  python "$ROOT/scripts/stylus_raw.py" check --wasm "$OPT" --rpc "$RPC_URL"
  echo "== Dry run complete. Set PRIVATE_KEY_PATH=<file> to deploy. =="
  exit 0
fi

echo "== [3/4] check + deploy + activate =="
OUT=$(python "$ROOT/scripts/stylus_raw.py" deploy --wasm "$OPT" --rpc "$RPC_URL" --key-path "$PRIVATE_KEY_PATH" | tee /dev/stderr)
JSON=$(echo "$OUT" | grep -E '^\{"agentVault"' | tail -1)
[ -n "$JSON" ] || { echo "deploy did not report an address"; exit 1; }

echo "== [4/4] recording deployment =="
python - "$MANIFEST" "$JSON" <<'PY'
import json, sys, datetime
path, blob = sys.argv[1], json.loads(sys.argv[2])
m = json.load(open(path))
m["agentVault"] = blob["agentVault"]
m["agentVaultDeployTx"] = blob["deployTx"]
m["agentVaultActivateTx"] = blob["activateTx"]
m["deployedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(m, open(path, "w"), indent=2)
print("wrote", path)
PY
ADDR=$(echo "$JSON" | python -c "import sys,json; print(json.load(sys.stdin)['agentVault'])")
echo
echo "AgentVault (Stylus) : $ADDR"
echo "Explorer            : $EXPLORER/address/$ADDR"
echo "Next: PRIVATE_KEY=0x... ./scripts/deploy_mocks.sh"
