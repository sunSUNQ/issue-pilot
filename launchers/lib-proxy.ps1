# Shared Git proxy resolution for role launchers. Never log ProxyServer or credentials.
function Resolve-LauncherGitProxy {
  param([string]$Role, [switch]$SkipGlobalProxy, [object]$InternetSettings)
  if (-not $SkipGlobalProxy) {
    $savedGlobal = $env:GIT_CONFIG_GLOBAL
    try {
      Remove-Item Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
      $explicit = & git config --global --get http.proxy 2>$null
      if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($explicit)) {
        Write-Host "LAUNCHER_PROXY[$Role]: explicit git global proxy enabled"
        return ([string]$explicit).Trim()
      }
    } finally {
      if ($null -ne $savedGlobal) { $env:GIT_CONFIG_GLOBAL = $savedGlobal }
      else { Remove-Item Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue }
    }
  }
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $settings = if ($PSBoundParameters.ContainsKey('InternetSettings')) { $InternetSettings } else { Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue }
  if (-not $settings) { return $null }
  $raw = [string]$settings.ProxyServer
  $pac = -not [string]::IsNullOrWhiteSpace([string]$settings.AutoConfigURL)
  if ([int]$settings.ProxyEnable -ne 1) {
    if ($pac -and [string]::IsNullOrWhiteSpace($raw)) {
      Write-Host "LAUNCHER_PROXY[$Role]: PAC-only configuration is unsupported; using direct connection"
    }
    return $null
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    if ($pac) {
      Write-Host "LAUNCHER_PROXY[$Role]: PAC-only configuration is unsupported; using direct connection"
      return $null
    }
    throw 'Windows system proxy is enabled but ProxyServer is empty; check Internet Settings.'
  }
  $endpoint = $raw.Trim()
  if ($endpoint.Contains('=')) {
    $parts = @{}
    foreach ($segment in $endpoint.Split(';')) {
      $pair = $segment.Split('=', 2)
      if ($pair.Count -ne 2 -or $pair[0].Trim() -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($pair[1])) {
        throw 'Windows system ProxyServer is malformed; check Internet Settings.'
      }
      $parts[$pair[0].Trim()] = $pair[1].Trim()
    }
    if (-not $parts.ContainsKey('https')) {
      throw 'Windows system ProxyServer lacks an https entry; check Internet Settings.'
    }
    $endpoint = $parts['https']
  }
  if ($endpoint -notmatch '^[^:/;=\s]+:[0-9]{1,5}$') {
    throw 'Windows system ProxyServer is malformed; check Internet Settings.'
  }
  $uri = $null
  if (-not [Uri]::TryCreate("http://$endpoint", [UriKind]::Absolute, [ref]$uri) -or
      $uri.Port -lt 1 -or $uri.Port -gt 65535 -or [string]::IsNullOrWhiteSpace($uri.Host)) {
    throw 'Windows system ProxyServer is malformed; check Internet Settings.'
  }
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $pending = $client.BeginConnect($uri.Host, $uri.Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(3000)) {
      throw 'Windows system proxy is unreachable; check Internet Settings.'
    }
    $client.EndConnect($pending)
  } catch {
    throw 'Windows system proxy is unreachable; check Internet Settings.'
  } finally {
    $client.Dispose()
  }
  Write-Host "LAUNCHER_PROXY[$Role]: system proxy detected/enabled"
  return $uri.AbsoluteUri.TrimEnd('/')
}
