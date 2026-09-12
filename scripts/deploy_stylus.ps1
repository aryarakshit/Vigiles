# Vigiles — Windows wrapper. The real logic lives in deploy_stylus.sh and runs
# under Git Bash so Windows and Linux/macOS share one tested code path.
#
#   .\scripts\deploy_stylus.ps1                                 # build + check (dry run)
#   .\scripts\deploy_stylus.ps1 -PrivateKeyPath .\key.txt       # build + check + deploy
param (
    [string]$RpcUrl = "https://rpc.testnet.chain.robinhood.com",
    [string]$PrivateKeyPath = ""
)
$ErrorActionPreference = "Stop"

$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) { $bash = "C:\Program Files\Git\bin\bash.exe" }
if (-not (Test-Path $bash)) { throw "Git Bash not found. Install Git for Windows or run scripts/deploy_stylus.sh under WSL." }

$env:RPC_URL = $RpcUrl
if ($PrivateKeyPath) { $env:PRIVATE_KEY_PATH = (Resolve-Path $PrivateKeyPath).Path -replace '\\', '/' }

$script = (Join-Path $PSScriptRoot "deploy_stylus.sh") -replace '\\', '/'
& $bash -lc "'$script'"
exit $LASTEXITCODE
