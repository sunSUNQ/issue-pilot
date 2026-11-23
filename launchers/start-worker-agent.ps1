# =============================================================================
# start-worker-agent.ps1 - WORKER launcher (dual-App: product + control-write)
# Governance V2 - Plan A six-App model:
#   product App  pl-issue-worker[bot]          -> sunSUNQ/provenlattice (Contents/Pulls/Checks per contract)
#   write  App   pl-worker-control-write[bot]  -> sunSUNQ/issue-pilot   (Issues:Write only)
#
# Usage (agent window / interactive):
#   . D:\issue-pilot\launchers\start-worker-agent.ps1      # dot-source: env stays in THIS session
#   powershell -File .\start-worker-agent.ps1 -Shell       # spawn a prepared child shell
#
# Identity is HARD-PINNED in this script. No parameters can switch role or App.
# Contains no credentials: PEM paths only; tokens minted in-memory per session.
# Renewal = re-dot-source this script (re-mints both tokens fresh).
# =============================================================================

param([switch]$Shell)

$ErrorActionPreference = 'Stop'

# --- pinned role constants (WORKER, dual-App) ---------------------------------
$Role           = 'worker'
# product side (provenlattice)
$AppId          = '5394857'                      # pl-issue-worker App
$InstallationId = '184866208'                    # pinned installation on sunSUNQ
$ExpectedBot    = 'pl-issue-worker[bot]'
$RepoFull       = 'sunSUNQ/provenlattice'
# write side (control repo, Issues:Write)
$WriteAppId          = '5885389'                 # pl-worker-control-write App
$WriteInstallationId = '<FILL_AFTER_OWNER_REPORTS>'   # installed on sunSUNQ/issue-pilot only
$WriteExpectedBot    = 'pl-worker-control-write[bot]'
$ControlRepo         = 'sunSUNQ/issue-pilot'
$ControlRoot    = 'D:\issue-pilot'
$TokenScript    = Join-Path $ControlRoot 'scripts\pl-token.mjs'

# --- runtime layout ----------------------------------------------------------
$RuntimeDir = Join-Path $ControlRoot "runtime\$Role"
$GhDir      = Join-Path $RuntimeDir 'gh'
$GitConfig  = Join-Path $RuntimeDir 'gitconfig'
$AskPass    = Join-Path $RuntimeDir 'askpass.cmd'
$KeysDir    = Join-Path $RuntimeDir 'keys'
$PemPrimary = Join-Path $KeysDir 'pl-issue-worker.private-key.pem'
$PemFallback = 'C:\Users\sunqinghw\Downloads\pl-issue-worker.2026-10-20.private-key.pem'
$WritePem   = Join-Path $KeysDir 'pl-worker-control-write.private-key.pem'

function Abort([string]$reason) { Write-Host "LAUNCHER_ABORT[$Role]: $reason" -ForegroundColor Red; exit 1 }

# --- 0. tooling sanity -------------------------------------------------------
foreach ($tool in 'node', 'git', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Abort "$tool not found in PATH" }
}
if (-not (Test-Path -LiteralPath $TokenScript)) { Abort "token script missing: $TokenScript" }
if ($AppId -like '<*' -or $WriteAppId -like '<*' -or $WriteInstallationId -like '<*') {
  Abort "App/installation ids not filled in yet - Owner must report control App Installation ID first, then edit the pinned constants"
}

# --- 1. purge inherited credentials (incl. expired/foreign GH_TOKEN) ---------
foreach ($v in 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PL_GIT_TOKEN', 'PL_WRITE_GIT_TOKEN') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

# --- 2. per-role dirs + configs ----------------------------------------------
New-Item -ItemType Directory -Force -Path $GhDir, $KeysDir | Out-Null
$hostsYml = Join-Path $GhDir 'hosts.yml'
if (-not (Test-Path $hostsYml)) {
  Set-Content -LiteralPath $hostsYml -Value "# pl-$Role : intentionally empty - no stored GitHub credentials" -Encoding ASCII
}
if (-not (Test-Path $GitConfig)) {
  @"
[credential]
	helper =
[credential "https://github.com"]
	helper =
[http]
	sslVerify = true
"@ | Set-Content -LiteralPath $GitConfig -Encoding ASCII
}
if (-not (Test-Path $AskPass)) {
  @"
@echo off
rem serves the in-memory installation token only; no credential storage
echo(%PROMPT%| findstr /I "Username" >NUL 2>&1
if %ERRORLEVEL% EQU 0 (
  echo x-access-token
  exit /b 0
)
echo %PL_GIT_TOKEN%
exit /b 0
"@ | Set-Content -LiteralPath $AskPass -Encoding ASCII
}

# --- 3. locate PEMs ----------------------------------------------------------
$PemPath = if (Test-Path -LiteralPath $PemPrimary) { $PemPrimary }
  elseif (Test-Path -LiteralPath $PemFallback) { $PemFallback; Write-Host "WARN[$Role]: PEM still in Downloads (owner migration pending): $PemFallback" -ForegroundColor Yellow }
  else { Abort "PEM not found at $PemPrimary or $PemFallback" }
if (-not (Test-Path -LiteralPath $WritePem)) { Abort "WRITE PEM not found: $WritePem (place pl-worker-control-write private key here)" }

# --- 4. mint + self-verify PRODUCT token (product repo, primary App) ----------
$env:PL_APP_ID              = $AppId
$env:PL_APP_INSTALLATION_ID = $InstallationId
$env:PL_APP_KEY_PATH        = $PemPath
$env:PL_EXPECTED_BOT        = $ExpectedBot
$env:PL_REPO_EXPECTED       = $RepoFull

$raw = & node $TokenScript 2>&1
if ($LASTEXITCODE -ne 0) {
  $err = ($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join '; '
  Abort "PRODUCT mint/self-verify failed: $err"
}
try { $m = ($raw -join '') | ConvertFrom-Json } catch { Abort 'PRODUCT mint output not parseable (stdout withheld)' }
if ($m.appId -ne [int]$AppId) { Abort "PRODUCT post-mint app mismatch: $($m.appId)" }
if ($m.installationId -ne [int]$InstallationId) { Abort "PRODUCT post-mint installation mismatch: $($m.installationId)" }
if ($m.bot -ne $ExpectedBot) { Abort "PRODUCT viewer mismatch: got '$($m.bot)', expected '$ExpectedBot'" }
if ($m.repos -notcontains $RepoFull) { Abort "PRODUCT installation repos lack $RepoFull" }
if ($m.repos -contains $ControlRepo) { Abort "PRODUCT App unexpectedly covers control repo $ControlRepo (boundary breach)" }
$extras = @($m.repos | Where-Object { $_ -ne $RepoFull })
if ($extras.Count -gt 0) { Write-Host "WARN[$Role]: PRODUCT installation also covers: $($extras -join ', ')" -ForegroundColor Yellow }
$productToken   = $m.token
$productBot     = $m.bot
$productExpires = $m.expiresAt

# --- 5. mint + self-verify WRITE token (control repo, Issues:Write) ----------
$env:PL_APP_ID              = $WriteAppId
$env:PL_APP_INSTALLATION_ID = $WriteInstallationId
$env:PL_APP_KEY_PATH        = $WritePem
$env:PL_EXPECTED_BOT        = $WriteExpectedBot
$env:PL_REPO_EXPECTED       = $ControlRepo

$raw2 = & node $TokenScript 2>&1
if ($LASTEXITCODE -ne 0) {
  $err = ($raw2 | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join '; '
  Abort "WRITE mint/self-verify failed: $err"
}
try { $m2 = ($raw2 -join '') | ConvertFrom-Json } catch { Abort 'WRITE mint output not parseable (stdout withheld)' }
if ($m2.appId -ne [int]$WriteAppId) { Abort "WRITE post-mint app mismatch: $($m2.appId)" }
if ($m2.installationId -ne [int]$WriteInstallationId) { Abort "WRITE post-mint installation mismatch: $($m2.installationId)" }
if ($m2.bot -ne $WriteExpectedBot) { Abort "WRITE viewer mismatch: got '$($m2.bot)', expected '$WriteExpectedBot'" }
if ($m2.repos -notcontains $ControlRepo) { Abort "WRITE installation repos lack $ControlRepo" }
if ($m2.repos -contains $RepoFull) { Abort "WRITE App unexpectedly covers product repo $RepoFull (boundary breach)" }
$writeToken   = $m2.token
$writeBot     = $m2.bot
$writeExpires = $m2.expiresAt

# --- 6. inject session env (App-only operation scope) --------------------------
# default GH_TOKEN / PL_GIT_TOKEN = PRODUCT side (product repo reads/writes)
$env:GH_TOKEN              = $productToken
$env:PL_GIT_TOKEN          = $productToken
$env:PL_WRITE_GIT_TOKEN    = $writeToken
$env:PL_ROLE               = $Role
$env:PL_PRINCIPAL          = 'pl-issue-worker[bot]'
$env:PL_GITHUB_LOGIN       = 'pl-issue-worker[bot]'
# product side (provenlattice)
$env:PL_APP_ID             = $AppId
$env:PL_APP_INSTALLATION_ID = $InstallationId
$env:PL_APP_KEY_PATH       = $PemPath
$env:PL_EXPECTED_BOT       = $ExpectedBot
$env:PL_TOKEN_BOT          = $productBot
$env:PL_REPO_EXPECTED      = $RepoFull
$env:PL_TOKEN_EXPIRES_AT   = $productExpires
# write side (control repo)
$env:PL_WRITE_APP_ID             = $WriteAppId
$env:PL_WRITE_APP_INSTALLATION_ID = $WriteInstallationId
$env:PL_WRITE_APP_KEY_PATH       = $WritePem
$env:PL_WRITE_EXPECTED_BOT       = $WriteExpectedBot
$env:PL_WRITE_TOKEN_BOT          = $writeBot
$env:PL_WRITE_TOKEN_EXPIRES_AT   = $writeExpires
# common
$env:PL_ENFORCE_APP        = '1'
$env:PL_RUNTIME_DIR        = $RuntimeDir
$env:GH_CONFIG_DIR         = $GhDir
$env:GIT_CONFIG_GLOBAL     = $GitConfig
$env:GIT_CONFIG_NOSYSTEM   = '1'
$env:GIT_TERMINAL_PROMPT   = '0'
$env:GIT_ASKPASS           = $AskPass

$m = $null; $m2 = $null; $raw = $null; $raw2 = $null   # drop in-memory token copy references

Write-Host "LAUNCHER_OK[$Role]: both bot identities verified, tokens minted (in-memory only)"
Write-Host "  PRODUCT app=$AppId installation=$InstallationId bot=$productBot expires=$productExpires"
Write-Host "  WRITE   app=$WriteAppId installation=$WriteInstallationId bot=$writeBot expires=$writeExpires"
Write-Host "  GH_TOKEN/PL_GIT_TOKEN=PRODUCT side; PL_WRITE_GIT_TOKEN=WRITE side"
Write-Host "  renew: re-dot-source this script (re-mints both tokens)"

if ($Shell) {
  powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location $ControlRoot"
}
