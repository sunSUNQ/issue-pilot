# =============================================================================
# start-reviewer-agent.ps1 - REVIEWER launcher (dual-App: read + write)
# Governance V2 — R7 Reviewer Bot identity (frozen: policies/governance-v2/)
# Scheme B (dual-App):
#   read  App  pl-issue-reviewer-read[bot]  -> sunSUNQ/provenlattice (READ ONLY, no Issues)
#   write App  pl-issue-reviewer-write[bot] -> sunSUNQ/issue-pilot   (Issues:Write, comments only)
#
# Usage (agent window / interactive):
#   . D:\issue-pilot\launchers\start-reviewer-agent.ps1      # dot-source: env stays in THIS session
#   powershell -File .\start-reviewer-agent.ps1 -Shell       # spawn a prepared child shell
#
# Identity is HARD-PINNED. No parameters can switch role or App.
# Contains no credentials: PEM paths only; tokens minted in-memory per session.
# Renewal = re-dot-source this script (re-mints both tokens fresh).
# =============================================================================

param([switch]$Shell)

$ErrorActionPreference = 'Stop'

# --- pinned role constants (REVIEWER, dual-App) ------------------------------
$Role           = 'reviewer'
# read side (product repo, read-only, no Issues)
$ReadAppId          = '5881440'              # pl-issue-reviewer-read App
$ReadInstallationId = '184852170'            # fresh install on sunSUNQ/provenlattice
$ReadExpectedBot    = 'pl-issue-reviewer-read[bot]'
$RepoFull           = 'sunSUNQ/provenlattice'
# write side (control repo, Issues:Write, comments only)
$WriteAppId          = '5881570'             # pl-issue-reviewer-write App
$WriteInstallationId = '184852983'            # fresh install on sunSUNQ/issue-pilot
$WriteExpectedBot    = 'pl-issue-reviewer-write[bot]'
$ControlRepo         = 'sunSUNQ/issue-pilot'
$ControlRoot         = 'D:\issue-pilot'
$TokenScript         = Join-Path $ControlRoot 'scripts\pl-token.mjs'

# --- runtime layout ----------------------------------------------------------
$RuntimeDir = Join-Path $ControlRoot "runtime\$Role"
$GhDir      = Join-Path $RuntimeDir 'gh'
$GitConfig  = Join-Path $RuntimeDir 'gitconfig'
$AskPass    = Join-Path $RuntimeDir 'askpass.cmd'
$KeysDir    = Join-Path $RuntimeDir 'keys'
$ReadPem    = Join-Path $KeysDir  'pl-issue-reviewer-read.private-key.pem'
$WritePem   = Join-Path $KeysDir  'pl-issue-reviewer-write.private-key.pem'

function Abort([string]$reason) { Write-Host "LAUNCHER_ABORT[$Role]: $reason" -ForegroundColor Red; exit 1 }

# --- 0. tooling sanity -------------------------------------------------------
foreach ($tool in 'node', 'git', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Abort "$tool not found in PATH" }
}
if (-not (Test-Path -LiteralPath $TokenScript)) { Abort "token script missing: $TokenScript" }
if ($ReadAppId -like '<*' -or $WriteAppId -like '<*') {
  Abort "App/installation ids not filled in yet 鈥?run setup-reviewer-apps wizard first, then edit this script's pinned constants"
}

# --- 1. purge inherited credentials (incl. expired/foreign GH_TOKEN) ---------
foreach ($v in 'GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','PL_GIT_TOKEN','PL_WRITE_GIT_TOKEN') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

# --- 2. per-role dirs + configs ----------------------------------------------
New-Item -ItemType Directory -Force -Path $GhDir, $KeysDir | Out-Null
$hostsYml = Join-Path $GhDir 'hosts.yml'
if (-not (Test-Path $hostsYml)) {
  Set-Content -LiteralPath $hostsYml -Value "# pl-$Role : intentionally empty - no stored GitHub credentials" -Encoding ASCII
}
try {
  . (Join-Path $PSScriptRoot 'lib-proxy.ps1')
  $gitProxy = Resolve-LauncherGitProxy -Role $Role
} catch { Abort $_.Exception.Message }
@"
[credential]
  helper =
[credential "https://github.com"]
  helper =
[http]
  sslVerify = true
"@ | Set-Content -LiteralPath $GitConfig -Encoding ASCII
if ($gitProxy) {
  & git config --file $GitConfig http.proxy $gitProxy 2>$null
  if ($LASTEXITCODE -ne 0) { Abort "failed to write isolated Git proxy config" }
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
if (-not (Test-Path -LiteralPath $ReadPem))  { Abort "READ PEM not found: $ReadPem" }
if (-not (Test-Path -LiteralPath $WritePem)) { Abort "WRITE PEM not found: $WritePem" }

# --- 4. mint + self-verify READ token (product repo, read-only) --------------
$env:PL_APP_ID              = $ReadAppId
$env:PL_APP_INSTALLATION_ID = $ReadInstallationId
$env:PL_APP_KEY_PATH        = $ReadPem
$env:PL_EXPECTED_BOT        = $ReadExpectedBot
$env:PL_REPO_EXPECTED       = $RepoFull

$raw = & node $TokenScript 2>&1
if ($LASTEXITCODE -ne 0) {
  $err = ($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join '; '
  Abort "READ mint/self-verify failed: $err"
}
try { $m = ($raw -join '') | ConvertFrom-Json } catch { Abort 'READ mint output not parseable (stdout withheld)' }
if ($m.appId -ne [int]$ReadAppId) { Abort "READ post-mint app mismatch: $($m.appId)" }
if ($m.installationId -ne [int]$ReadInstallationId) { Abort "READ post-mint installation mismatch: $($m.installationId)" }
if ($m.bot -ne $ReadExpectedBot) { Abort "READ viewer mismatch: got '$($m.bot)', expected '$ReadExpectedBot'" }
if ($m.repos -notcontains $RepoFull) { Abort "READ installation repos lack $RepoFull" }
if ($m.repos -contains $ControlRepo) { Abort "READ App unexpectedly covers control repo $ControlRepo (boundary breach)" }
$readToken   = $m.token
$readBot     = $m.bot
$readExpires = $m.expiresAt

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

# --- 6. inject session env (App-only operation scope) ------------------------
# default GH_TOKEN / PL_GIT_TOKEN = READ side (product repo reads)
$env:GH_TOKEN              = $readToken
$env:PL_GIT_TOKEN          = $readToken
$env:PL_WRITE_GIT_TOKEN    = $writeToken
$env:PL_ROLE               = $Role
$env:PL_PRINCIPAL          = 'pl-issue-reviewer[bot]'
$env:PL_GITHUB_LOGIN       = 'pl-issue-reviewer[bot]'
# read side (product repo)
$env:PL_APP_ID             = $ReadAppId
$env:PL_APP_INSTALLATION_ID = $ReadInstallationId
$env:PL_APP_KEY_PATH       = $ReadPem
$env:PL_EXPECTED_BOT       = $ReadExpectedBot
$env:PL_TOKEN_BOT          = $readBot
$env:PL_REPO_EXPECTED      = $RepoFull
# write side (control repo)
$env:PL_WRITE_APP_ID             = $WriteAppId
$env:PL_WRITE_APP_INSTALLATION_ID = $WriteInstallationId
$env:PL_WRITE_APP_KEY_PATH       = $WritePem
$env:PL_WRITE_EXPECTED_BOT       = $WriteExpectedBot
$env:PL_WRITE_TOKEN_BOT          = $writeBot
# common
$env:PL_TOKEN_EXPIRES_AT   = $readExpires
$env:PL_WRITE_TOKEN_EXPIRES_AT = $writeExpires
$env:PL_ENFORCE_APP        = '1'
$env:PL_RUNTIME_DIR        = $RuntimeDir
$env:GH_CONFIG_DIR         = $GhDir
$env:GIT_CONFIG_GLOBAL     = $GitConfig
$env:GIT_CONFIG_NOSYSTEM   = '1'
$env:GIT_TERMINAL_PROMPT   = '0'
$env:GIT_ASKPASS           = $AskPass

$m = $null; $m2 = $null; $raw = $null; $raw2 = $null   # drop in-memory token copy references

Write-Host "LAUNCHER_OK[$Role]: both bot identities verified, tokens minted (in-memory only)"
Write-Host "  READ  app=$ReadAppId installation=$ReadInstallationId bot=$readBot expires=$readExpires"
Write-Host "  WRITE app=$WriteAppId installation=$WriteInstallationId bot=$writeBot expires=$writeExpires"
Write-Host "  GH_TOKEN/PL_GIT_TOKEN=READ side; PL_WRITE_GIT_TOKEN=WRITE side"
Write-Host "  renew: re-dot-source this script (re-mints both tokens)"

if ($Shell) {
  powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location $ControlRoot"
}
