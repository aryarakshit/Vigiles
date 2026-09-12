#!/usr/bin/env bash
# Vigiles — deploy tokenized-stock mocks + swap adapter to Robinhood Chain testnet
# and record their addresses in deployments/robinhood-testnet.json.
#
#   PRIVATE_KEY=0x... ./scripts/deploy_mocks.sh
#
# Requires Foundry (`forge`). The key is read from the environment by forge only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/deployments/robinhood-testnet.json"
RPC_URL="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"

[ -n "${PRIVATE_KEY:-}" ] || { echo "Set PRIVATE_KEY=0x<hex> in the environment."; exit 1; }

echo "== Deploying MockTokenizedStock x3 + MockSwapAdapter to $RPC_URL =="
OUT=$(cd "$ROOT/contracts" && forge script script/DeployMocks.s.sol:DeployMocks \
  --rpc-url "$RPC_URL" --broadcast -vv 2>&1 | tee /dev/stderr)

JSON=$(echo "$OUT" | grep -oE 'MOCKS_JSON *\{.*\}' | sed 's/MOCKS_JSON *//' | tail -1)
[ -n "$JSON" ] || { echo "Could not find MOCKS_JSON in forge output."; exit 1; }

python - "$MANIFEST" "$JSON" <<'PY'
import json, sys
path, blob = sys.argv[1], json.loads(sys.argv[2])
m = json.load(open(path))
m["swapAdapter"] = blob["swapAdapter"]
m["tokens"]["AAPL"] = blob["aapl"]
m["tokens"]["TSLA"] = blob["tsla"]
m["tokens"]["NVDA"] = blob["nvda"]
m["deployer"] = blob["deployer"]
json.dump(m, open(path, "w"), indent=2)
print("wrote", path)
print(json.dumps(m, indent=2))
PY
