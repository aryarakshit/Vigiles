// Signs and sends one transaction for scripts/stylus_raw.py. Payload on stdin:
//   { "rpc": url, "keyPath": file, "to": address|null, "data": hex, "value": decimalString }
// Prints the receipt as JSON. Uses viem from mcp/node_modules; the key is read
// from the file, used to sign, and never printed.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "mcp", "package.json"));
const { createPublicClient, createWalletClient, defineChain, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const input = JSON.parse(readFileSync(0, "utf8"));
const pk = readFileSync(input.keyPath, "utf8").trim();
const account = privateKeyToAccount(pk);
const chain = defineChain({
  id: input.chainId ?? 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [input.rpc] } },
});
const transport = http(input.rpc, { fetchOptions: { headers: { "user-agent": "vigiles-deploy/1.0" } } });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

const hash = await wallet.sendTransaction({
  to: input.to ?? undefined,
  data: input.data,
  value: BigInt(input.value ?? "0"),
});
const r = await pub.waitForTransactionReceipt({ hash });
process.stdout.write(
  JSON.stringify({ transactionHash: r.transactionHash, status: r.status, contractAddress: r.contractAddress ?? null, gasUsed: r.gasUsed.toString(), blockNumber: r.blockNumber.toString() }),
);
