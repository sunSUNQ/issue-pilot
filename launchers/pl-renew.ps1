# =============================================================================
# pl-renew.ps1 - installation token renewal (shared by both roles)
# R16 implementation (dispatch PL-SOLO-V2-SINGLE-USER-IMPLEMENTATION-R16)
#
# Usage (inside a launcher session):
#   . D:\issue-pilot\launchers\pl-renew.ps1
# Dot-source is REQUIRED: it updates GH_TOKEN / PL_GIT_TOKEN / PL_TOKEN_EXPIRES_AT
# in the CURRENT session. Token value is never printed; only expires_at is shown.
# =============================================================================

$ErrorActionPreference = 'Stop'

if ($env:PL_ENFORCE_APP -ne '1') { throw 'pl-renew: not a launcher session (PL_ENFORCE_APP unset) - refusing' }
foreach ($v in 'PL_ROLE', 'PL_APP_ID', 'PL_APP_INSTALLATION_ID', 'PL_APP_KEY_PATH') {
  if (-not (Get-Item "Env:$v" -ErrorAction SilentlyContinue)) { throw "pl-renew: $v missing from session env" }
}
$TokenScript = 'D:\issue-pilot\scripts\pl-token.mjs'
if (-not (Test-Path -LiteralPath $TokenScript)) { throw "pl-renew: token script missing: $TokenScript" }

$raw = & node $TokenScript 2>&1
if ($LASTEXITCODE -ne 0) {
  $err = ($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join '; '
  throw "pl-renew: mint failed (fail-closed, session keeps previous token): $err"
}
try { $m = ($raw -join '') | ConvertFrom-Json } catch { throw 'pl-renew: mint output not parseable (stdout withheld)' }
if ($m.appId -ne [int]$env:PL_APP_ID) { throw "pl-renew: app mismatch ($($m.appId) != $($env:PL_APP_ID))" }
if ($m.installationId -ne [int]$env:PL_APP_INSTALLATION_ID) { throw "pl-renew: installation mismatch ($($m.installationId) != $($env:PL_APP_INSTALLATION_ID))" }

$env:GH_TOKEN = $m.token
$env:PL_GIT_TOKEN = $m.token
$env:PL_TOKEN_EXPIRES_AT = $m.expiresAt
$env:PL_TOKEN_BOT = $m.bot
$m = $null; $raw = $null

"renewed[$($env:PL_ROLE)]: expires_at=$env:PL_TOKEN_EXPIRES_AT (token in-memory only)"
