#!/usr/bin/env bash
# Vigiles — build, check and deploy the Stylus vault to Robinhood Chain testnet.
#
#   ./scripts/deploy_stylus.sh                 # build + `cargo stylus check` (dry run, no key needed)
#   PRIVATE_KEY_PATH=./key.txt ./scripts/deploy_stylus.sh   # build + check + deploy + activate
#
# Requirements:
#   - Rust nightly with rust-src + wasm32 target (see vigiles-vault/.cargo/config.toml)
#   - cargo-stylus (`cargo install cargo-stylus`), OR Docker (falls back to the official image)
#   - A funded key on Robinhood Chain testnet; the file must contain only the hex key.
#
# The private key file is passed to cargo-stylus by path and is never echoed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_DIR="$ROOT/vigiles-vault"
WASM="$VAULT_DIR/target/wasm32-unknown-unknown/release/vigiles_vault.wasm"
MANIFEST="$ROOT/deployments/robinhood-testnet.json"

RPC_URL="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
EXPLORER="${EXPLORER:-https://explorer.testnet.chain.robinhood.com}"
PRIVATE_KEY_PATH="${PRIVATE_KEY_PATH:-}"
CARGO_STYLUS_IMAGE="${CARGO_STYLUS_IMAGE:-offchainlabs/cargo-stylus-base:0.6.3}"

# Pick the nightly toolchain name. Windows/GNU hosts install it under a triple-suffixed name.
if rustup toolchain list | grep -q '^nightly-x86_64-pc-windows-gnu'; then
  NIGHTLY="+nightly-x86_64-pc-windows-gnu"
else
  NIGHTLY="+nightly"
fi

echo "== [1/4] Building WASM with panic=immediate-abort (nightly, build-std) =="
( cd "$VAULT_DIR" && cargo $NIGHTLY build --release --target wasm32-unknown-unknown )
[ -f "$WASM" ] || { echo "WASM not found at $WASM"; exit 1; }
RAW=$(wc -c < "$WASM")
echo "   raw wasm: $RAW bytes (limit 131072)"
if command -v python >/dev/null 2>&1 && python -c "import brotli" 2>/dev/null; then
  BR=$(python -c "import brotli;print(len(brotli.compress(open('$WASM','rb').read(),quality=11,lgwin=22)))")
  echo "   brotli:   $BR bytes (EIP-170 limit 24576)"
fi

# Resolve a `cargo stylus` runner: native binary or Docker.
run_stylus() {
  if cargo stylus --version >/dev/null 2>&1; then
    ( cd "$VAULT_DIR" && cargo stylus "$@" )
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    local mounts=(-v "$VAULT_DIR:/src" -w /src)
    [ -n "$PRIVATE_KEY_PATH" ] && mounts+=(-v "$(cd "$(dirname "$PRIVATE_KEY_PATH")" && pwd)/$(basename "$PRIVATE_KEY_PATH"):/key.txt:ro")
    docker run --rm "${mounts[@]}" "$CARGO_STYLUS_IMAGE" cargo stylus "$@"
  else
    echo "Neither 'cargo stylus' nor a running Docker daemon is available."
    echo "Install with:  cargo install cargo-stylus   (Linux/macOS)"
    echo "or start Docker Desktop and re-run."
    exit 1
  fi
}

echo "== [2/4] cargo stylus check against $RPC_URL =="
run_stylus check --wasm-file target/wasm32-unknown-unknown/release/vigiles_vault.wasm --endpoint "$RPC_URL"

if [ -z "$PRIVATE_KEY_PATH" ]; then
  echo "== Dry run complete. Set PRIVATE_KEY_PATH=<file> to deploy. =="
  exit 0
fi

echo "== [3/4] Deploying + activating on Robinhood Chain (46630) =="
KEY_ARG="$PRIVATE_KEY_PATH"
if ! cargo stylus --version >/dev/null 2>&1; then KEY_ARG="/key.txt"; fi
OUT=$(run_stylus deploy \
  --wasm-file target/wasm32-unknown-unknown/release/vigiles_vault.wasm \
  --endpoint "$RPC_URL" \
  --private-key-path "$KEY_ARG" \
  --no-verify 2>&1 | tee /dev/stderr)

ADDR=$(echo "$OUT" | grep -oiE 'deployed code at address:? *0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}' | tail -1 || true)
TX=$(echo "$OUT" | grep -oiE 'deployment tx hash:? *0x[0-9a-fA-F]{64}' | grep -oE '0x[0-9a-fA-F]{64}' | tail -1 || true)

if [ -z "$ADDR" ]; then
  echo "Could not parse the deployed address from cargo-stylus output; update $MANIFEST by hand."
  exit 1
fi

echo "== [4/4] Recording deployment =="
python - "$MANIFEST" "$ADDR" "$TX" <<'PY'
import json, sys, datetime
path, addr, tx = sys.argv[1], sys.argv[2], sys.argv[3] or None
m = json.load(open(path))
m["agentVault"] = addr
m["agentVaultDeployTx"] = tx
m["deployedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(m, open(path, "w"), indent=2)
print("wrote", path)
PY

echo
echo "AgentVault (Stylus) : $ADDR"
echo "Explorer            : $EXPLORER/address/$ADDR"
echo "Next: ./scripts/deploy_mocks.sh   (tokenized-stock mocks + swap adapter)"
