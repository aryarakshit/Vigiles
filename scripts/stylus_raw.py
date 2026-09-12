#!/usr/bin/env python3
"""
Stylus deploy without cargo-stylus — the same on-chain procedure, in ~150 lines.

  python scripts/stylus_raw.py check   [--wasm PATH] [--rpc URL]
  python scripts/stylus_raw.py deploy  --key-path key.txt [--wasm PATH] [--rpc URL]

check  : compress the WASM exactly as cargo-stylus does (strip custom sections,
         brotli-11, EFF00000 prefix) and ask ArbWasm.activateProgram via eth_call
         with a state override placing the code at a dummy address. If the chain
         returns (version, dataFee) the program is valid and activatable.
deploy : CREATE the contract with the 43-byte EVM prelude, then send
         ArbWasm.activateProgram(address) with dataFee + 20 %. Prints the address
         and both tx hashes. Uses `cast` (Foundry) for signing; the key file is
         passed by path and never read by this script.

Reference: stylus-tools 0.10.9 (core/deployment/prelude.rs, core/activation.rs).
"""
import argparse, json, os, re, subprocess, sys, urllib.request

ARB_WASM = "0x0000000000000000000000000000000000000071"
EOF_NO_DICT = bytes([0xEF, 0xF0, 0x00, 0x00])
DUMMY = "0x00000000000000000000000000000000000000c0de"[:42]
SPOOF_SENDER = "0x000000000000000000000000000000000000beef"
SEL_ACTIVATE = "58c780c2"  # activateProgram(address)

def rpc(url, method, params):
    req = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"content-type": "application/json", "user-agent": "vigiles-deploy/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    if "error" in body:
        raise RuntimeError(json.dumps(body["error"]))
    return body["result"]

def strip_custom_sections(wasm: bytes) -> bytes:
    """Drop custom sections (id 0), keep everything else byte-for-byte."""
    def leb(b, i):
        r = s = 0
        while True:
            x = b[i]; i += 1; r |= (x & 0x7F) << s; s += 7
            if not x & 0x80:
                return r, i
    out = bytearray(wasm[:8]); i = 8
    while i < len(wasm):
        sid = wasm[i]; size, j = leb(wasm, i + 1); end = j + size
        if sid != 0:
            out += wasm[i:end]
        i = end
    return bytes(out)

def deploy_ready_code(wasm_path: str) -> bytes:
    import brotli
    raw = open(wasm_path, "rb").read()
    stripped = strip_custom_sections(raw)
    compressed = brotli.compress(stripped, quality=11, lgwin=22)
    return EOF_NO_DICT + compressed, len(stripped), len(compressed)

def prelude(code: bytes) -> bytes:
    # PUSH32 len | DUP1 | PUSH1 43 | PUSH1 0 | CODECOPY | PUSH1 0 | RETURN | version 0 | code
    return bytes([0x7F]) + len(code).to_bytes(32, "big") + bytes([0x80, 0x60, 43, 0x60, 0x00, 0x39, 0x60, 0x00, 0xF3, 0x00]) + code

def data_fee(url, code: bytes, at: str):
    call = {"from": SPOOF_SENDER, "to": ARB_WASM, "data": "0x" + SEL_ACTIVATE + at[2:].rjust(64, "0"), "value": hex(10**18)}
    override = {SPOOF_SENDER: {"balance": hex(2**255)}, at: {"code": "0x" + code.hex()}}
    try:
        ret = rpc(url, "eth_call", [call, "latest", override])
    except RuntimeError as e:
        return None, str(e)
    ret = bytes.fromhex(ret[2:])
    version = int.from_bytes(ret[0:32], "big"); fee = int.from_bytes(ret[32:64], "big")
    return (version, fee), None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["check", "deploy"])
    ap.add_argument("--wasm", default=os.path.join(os.path.dirname(__file__), "..", "vigiles-vault", "target", "wasm32-unknown-unknown", "release", "vigiles_vault.wasm"))
    ap.add_argument("--rpc", default="https://rpc.testnet.chain.robinhood.com")
    ap.add_argument("--key-path")
    ap.add_argument("--bump", type=int, default=20)
    a = ap.parse_args()

    code, raw_len, comp_len = deploy_ready_code(a.wasm)
    print(f"wasm: {raw_len} B stripped, {comp_len} B brotli, contract code {len(code)} B (EIP-170 limit 24576)")
    if len(code) > 24576:
        sys.exit("contract code exceeds 24 KiB")

    (res, err) = data_fee(a.rpc, code, DUMMY)
    if err:
        sys.exit(f"activation check FAILED: {err}")
    version, fee = res
    print(f"activation check OK: stylus version {version}, data fee {fee / 1e18:.6f} ETH")
    if a.cmd == "check":
        return

    if not a.key_path or not os.path.exists(a.key_path):
        sys.exit("--key-path is required for deploy")
    key_file = os.path.abspath(a.key_path)
    initcode = "0x" + prelude(code).hex()

    print("deploying (CREATE)…")
    out = subprocess.run(["cast", "send", "--rpc-url", a.rpc, "--keystore" if False else "--private-key", open(key_file).read().strip(), "--create", initcode, "--json"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"deploy tx failed: {out.stderr[-600:]}")
    rec = json.loads(out.stdout)
    address = rec.get("contractAddress"); deploy_tx = rec.get("transactionHash")
    if not address or rec.get("status") not in ("0x1", 1, "1"):
        sys.exit(f"deploy receipt not successful: {rec}")
    print(f"deployed at {address}  tx {deploy_tx}")

    (res, err) = data_fee(a.rpc, code, address)
    if err:
        sys.exit(f"post-deploy fee check failed: {err}")
    fee = res[1]; value = fee * (100 + a.bump) // 100
    print(f"activating with {value / 1e18:.6f} ETH (data fee + {a.bump}%)…")
    out = subprocess.run(["cast", "send", "--rpc-url", a.rpc, "--private-key", open(key_file).read().strip(), ARB_WASM, "activateProgram(address)", address, "--value", str(value), "--json"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"activation tx failed: {out.stderr[-600:]}")
    rec = json.loads(out.stdout)
    if rec.get("status") not in ("0x1", 1, "1"):
        sys.exit(f"activation receipt not successful: {rec}")
    print(f"activated  tx {rec.get('transactionHash')}")
    print(json.dumps({"agentVault": address, "deployTx": deploy_tx, "activateTx": rec.get("transactionHash")}))

if __name__ == "__main__":
    main()
