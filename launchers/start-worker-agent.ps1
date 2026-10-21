# =============================================================================
# start-worker-agent.ps1 - G1_SINGLE_USER_APP_SCOPED_OPERATION launcher
# R16 implementation (dispatch PL-SOLO-V2-SINGLE-USER-IMPLEMENTATION-R16)
#
# Usage (agent window / interactive):
#   . D:\issue-pilot\launchers\start-worker-agent.ps1      # dot-source: env stays in THIS session
#   powershell -File .\start-worker-agent.ps1 -Shell       # spawn a prepared child shell
#
# Identity is HARD-PINNED in this script. No parameters can switch role.
# Contains no credentials: PEM path only; token minted in-memory per session.
# =============================================================================

param([switch]$Shell)

$ErrorActionPreference = 'Stop'

# --- pinned role constants (WORKER) ------------------------------------------
$Role           = 'worker'
$AppId          = '5394857'                      # pl-issue-worker App
$InstallationId = '173364328'                    # pinned installation on sunSUNQ
$ExpectedBot    = 'pl-issue-worker[bot]'
$RepoFull       = 'sunSUNQ/provenlattice'
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

function Abort([string]$reason) { Write-Host "LAUNCHER_ABORT[$Role]: $reason" -ForegroundColor Red; exit 1 }

# --- 0. tooling sanity -------------------------------------------------------
foreach ($tool in 'node', 'git', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Abort "$tool not found in PATH" }
}
if (-not (Test-Path -LiteralPath $TokenScript)) { Abort "token script missing: $TokenScript" }

# --- 1. purge inherited credentials (incl. expired/foreign GH_TOKEN) ---------
foreach ($v in 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PL_GIT_TOKEN') {
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

# --- 3. locate PEM (keys dir preferred; Downloads fallback until migration) ---
$PemPath = if (Test-Path -LiteralPath $PemPrimary) { $PemPrimary }
  elseif (Test-Path -LiteralPath $PemFallback) { $PemFallback; Write-Host "WARN[$Role]: PEM still in Downloads (owner migration pending): $PemFallback" -ForegroundColor Yellow }
  else { Abort "PEM not found at $PemPrimary or $PemFallback" }

# --- 4. mint + self-verify (scripts/pl-token.mjs; token stays in memory) ------
$env:PL_APP_ID              = $AppId
$env:PL_APP_INSTALLATION_ID = $InstallationId
$env:PL_APP_KEY_PATH        = $PemPath
$env:PL_EXPECTED_BOT        = $ExpectedBot
$env:PL_REPO_EXPECTED       = $RepoFull

$raw = & node $TokenScript 2>&1
if ($LASTEXITCODE -ne 0) {
  $err = ($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join '; '
  Abort "mint/self-verify failed: $err"
}
try { $m = ($raw -join '') | ConvertFrom-Json } catch { Abort 'mint output not parseable (stdout withheld)' }
if ($m.appId -ne [int]$AppId) { Abort "post-mint app mismatch: $($m.appId)" }
if ($m.installationId -ne [int]$InstallationId) { Abort "post-mint installation mismatch: $($m.installationId)" }
if ($m.bot -ne $ExpectedBot) { Abort "viewer mismatch: got '$($m.bot)', expected '$ExpectedBot'" }
if ($m.repos -notcontains $RepoFull) { Abort "installation repos lack $RepoFull" }
$extras = @($m.repos | Where-Object { $_ -ne $RepoFull })
if ($extras.Count -gt 0) { Write-Host "WARN[$Role]: installation also covers: $($extras -join ', ')" -ForegroundColor Yellow }

# --- 5. inject session env (App-only operation scope) --------------------------
$env:GH_TOKEN              = $m.token
$env:PL_GIT_TOKEN          = $m.token
$env:PL_ROLE               = $Role
$env:PL_APP_ID             = $AppId
$env:PL_APP_INSTALLATION_ID = $InstallationId
$env:PL_APP_KEY_PATH       = $PemPath
$env:PL_EXPECTED_BOT       = $ExpectedBot
$env:PL_REPO_EXPECTED      = $RepoFull
$env:PL_TOKEN_EXPIRES_AT   = $m.expiresAt
$env:PL_TOKEN_BOT          = $m.bot
$env:PL_ENFORCE_APP        = '1'
$env:PL_RUNTIME_DIR        = $RuntimeDir
$env:GH_CONFIG_DIR         = $GhDir
$env:GIT_CONFIG_GLOBAL     = $GitConfig
$env:GIT_CONFIG_NOSYSTEM   = '1'
$env:GIT_TERMINAL_PROMPT   = '0'
$env:GIT_ASKPASS           = $AskPass

$m = $null; $raw = $null   # drop in-memory token copy references

Write-Host "LAUNCHER_OK[$Role]: bot identity verified, GH_TOKEN minted (in-memory only)"
Write-Host "  app=$AppId installation=$InstallationId expires_at=$env:PL_TOKEN_EXPIRES_AT"
Write-Host "  GH_CONFIG_DIR=$GhDir  GIT_CONFIG_GLOBAL=$GitConfig  PL_ENFORCE_APP=1"
Write-Host "  renew: . D:\issue-pilot\launchers\pl-renew.ps1"

if ($Shell) {
  powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location $ControlRoot"
}

