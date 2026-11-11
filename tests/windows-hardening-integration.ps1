$ErrorActionPreference = 'Stop'

function Assert-Condition($Condition, $Message) {
  if (-not $Condition) { throw $Message }
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port }
  finally { $listener.Stop() }
}

function Wait-Healthy($Port, $ExpectedPid) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  while ($watch.ElapsedMilliseconds -lt 10000) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -NoProxy -TimeoutSec 1
      if ($health.ok -and $health.app -eq 'rcrd' -and $health.pid -eq $ExpectedPid) { return }
    } catch {}
    Start-Sleep -Milliseconds 50
  }
  throw 'The isolated RCRD process did not become healthy.'
}

function Stop-OwnedProcess($Process) {
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -ErrorAction Stop
      Assert-Condition ($Process.WaitForExit(5000)) 'The isolated RCRD process did not stop.'
    }
  } finally { $Process.Dispose() }
}

$repository = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repository 'server.js'
$preloadSource = Join-Path $PSScriptRoot 'fixtures/mock-discogs-fetch.cjs'
$node = (Get-Command node -ErrorAction Stop).Source
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$root = Join-Path $temporaryRoot ('rcrd-hardening-test-' + [guid]::NewGuid().ToString('N'))
$data = Join-Path $root '.data'
$counter = Join-Path $root 'provider-calls.txt'
$cache = Join-Path $data 'spotify-cache.json'
$backup = Join-Path $data 'spotify-cache.damaged.backup'
$server = Join-Path $root 'server.js'
$preload = Join-Path $root 'mock-discogs-fetch.cjs'
$active = $null
$port = Get-FreePort

function Start-IsolatedServer($PreloadPath, $ErrorFile) {
  $arguments = @()
  if ($PreloadPath) { $arguments += @('--require', ('"' + $PreloadPath + '"')) }
  $arguments += '"' + $server + '"'
  return Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -UseNewEnvironment -RedirectStandardError $ErrorFile -WindowStyle Hidden -PassThru
}

try {
  New-Item -ItemType Directory -Path $data -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $server
  Copy-Item -LiteralPath (Join-Path $repository 'package.json') -Destination (Join-Path $root 'package.json')
  Copy-Item -LiteralPath $preloadSource -Destination $preload
  [IO.File]::WriteAllText((Join-Path $root '.env'), "PORT=$port`nDISCOGS_CONSUMER_KEY=synthetic-key`nDISCOGS_CONSUMER_SECRET=synthetic-secret`n")

  $active = Start-IsolatedServer $preload (Join-Path $root 'discogs-stderr.txt')
  Wait-Healthy $port $active.Id
  $first = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/search?q=synthetic-first" -NoProxy -SkipHttpErrorCheck -TimeoutSec 5
  $second = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/search?q=synthetic-second" -NoProxy -SkipHttpErrorCheck -TimeoutSec 5
  Assert-Condition ($first.StatusCode -eq 429 -and $second.StatusCode -eq 429) 'Discogs cooldown did not return HTTP 429 twice.'
  Assert-Condition (([string]($first.Headers['Retry-After'] | Select-Object -First 1)) -eq '4') 'Discogs did not honor Retry-After.'
  Assert-Condition ([IO.File]::ReadAllText($counter) -eq 'x') 'The second Discogs search reached the mock provider during cooldown.'
  Stop-OwnedProcess $active
  $active = $null
  Write-Output 'PASS: isolated Windows process honors Discogs Retry-After and suppresses a second provider call.'

  $damaged = [Text.Encoding]::UTF8.GetBytes('{synthetic-damaged-cache')
  [IO.File]::WriteAllBytes($cache, $damaged)
  $active = Start-IsolatedServer $null (Join-Path $root 'damaged-stderr.txt')
  Assert-Condition ($active.WaitForExit(10000)) 'The damaged cache did not stop startup.'
  Assert-Condition ($active.ExitCode -ne 0) 'The damaged cache unexpectedly allowed startup.'
  Assert-Condition ([IO.File]::ReadAllText((Join-Path $root 'damaged-stderr.txt')).Contains('Could not restore the Spotify cache')) 'The startup error was not actionable.'
  Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($cache)) -eq [Convert]::ToBase64String($damaged)) 'Startup changed the damaged cache.'
  Stop-OwnedProcess $active
  $active = $null

  Move-Item -LiteralPath $cache -Destination $backup
  $active = Start-IsolatedServer $null (Join-Path $root 'recovery-stderr.txt')
  Wait-Healthy $port $active.Id
  Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($backup)) -eq [Convert]::ToBase64String($damaged)) 'Recovery changed the backup.'
  Assert-Condition (-not (Test-Path -LiteralPath $cache)) 'Recovery unexpectedly rewrote the cache.'
  Stop-OwnedProcess $active
  $active = $null
  Write-Output 'PASS: damaged cache blocks startup, remains intact, and an isolated backup permits recovery.'
} finally {
  Stop-OwnedProcess $active
  $resolved = [IO.Path]::GetFullPath($root)
  Assert-Condition ($resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) 'Refusing cleanup outside the temporary directory.'
  Assert-Condition ([IO.Path]::GetFileName($resolved).StartsWith('rcrd-hardening-test-')) 'Refusing cleanup outside the synthetic test directory.'
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
