$ErrorActionPreference = 'Stop'
$updater = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Update-RCRD.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("rcrd-update-apply-" + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $fixture 'payload'
$stage = Join-Path $fixture '.data/update-staging/test'
$archive = Join-Path $stage 'release.zip'
$previousPort = $env:PORT
$newServerPid = 0
try {
  New-Item -ItemType Directory -Path $payload, $stage, (Join-Path $payload 'scripts') -Force | Out-Null
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  $env:PORT = [string]$port
  [IO.File]::WriteAllText((Join-Path $fixture '.env'), 'PRIVATE_TEST_MARKER=keep')
  [IO.File]::WriteAllText((Join-Path $fixture '.data/account-marker'), 'keep account data')
  [IO.File]::WriteAllText((Join-Path $fixture 'server.js'), 'throw new Error("old version should not run")')
  [IO.File]::WriteAllText((Join-Path $fixture 'package.json'), '{"version":"1.0.0"}')
  foreach ($file in @('app.js', 'index.html', 'scripts/Start-RCRD.ps1', 'scripts/Restart-RCRD.cjs', 'scripts/Update-RCRD.ps1')) {
    $destination = Join-Path $payload $file
    [IO.File]::WriteAllText($destination, 'synthetic release file')
  }
  [IO.File]::WriteAllText((Join-Path $payload 'server.js'), 'const http=require("node:http");http.createServer((request,response)=>{response.setHeader("Content-Type","application/json");response.end(JSON.stringify({app:"rcrd",version:"9.4.1",pid:process.pid}))}).listen(Number(process.env.PORT),"127.0.0.1");')
  [IO.File]::WriteAllText((Join-Path $payload 'package.json'), '{"version":"9.4.1"}')
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($name in @('server.js', 'app.js', 'index.html', 'package.json', 'scripts/Start-RCRD.ps1', 'scripts/Restart-RCRD.cjs', 'scripts/Update-RCRD.ps1')) {
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $payload $name), $name) | Out-Null
    }
  } finally { $zip.Dispose() }
  $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $waiting = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 1') -WindowStyle Hidden -PassThru
  $handoff = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 16)
  & $updater -ProjectRoot $fixture -ArchivePath $archive -Version '9.4.1' -ExpectedSha256 $digest -ParentPid $waiting.Id -Port $port -NodeExe (Get-Command node).Source -HandoffId $handoff
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
  $newServerPid = [int]$health.pid
  $status = Get-Content -LiteralPath (Join-Path $fixture '.data/update-status.json') -Raw | ConvertFrom-Json
  if ($health.version -ne '9.4.1' -or $status.status -ne 'complete') { throw 'The updated server did not pass its health check.' }
  if ((Get-Content -LiteralPath (Join-Path $fixture '.env') -Raw) -ne 'PRIVATE_TEST_MARKER=keep' -or (Get-Content -LiteralPath (Join-Path $fixture '.data/account-marker') -Raw) -ne 'keep account data') { throw 'Private configuration or account data changed during update.' }
  if (-not (Test-Path -LiteralPath (Join-Path $fixture ".data/update-backups/$handoff/package.json"))) { throw 'The previous application files were not backed up.' }
  Write-Output 'Synthetic update install, restart, and private-data preservation passed.'
  Stop-Process -Id $newServerPid -Force
  $newServerPid = 0
  $rollbackStage = Join-Path $fixture '.data/update-staging/rollback'
  New-Item -ItemType Directory -Path $rollbackStage -Force | Out-Null
  $rollbackArchive = Join-Path $rollbackStage 'release.zip'
  [IO.File]::WriteAllText((Join-Path $payload 'server.js'), 'throw new Error("synthetic failed update")')
  [IO.File]::WriteAllText((Join-Path $payload 'package.json'), '{"version":"9.4.2"}')
  $zip = [IO.Compression.ZipFile]::Open($rollbackArchive, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($name in @('server.js', 'app.js', 'index.html', 'package.json', 'scripts/Start-RCRD.ps1', 'scripts/Restart-RCRD.cjs', 'scripts/Update-RCRD.ps1')) {
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $payload $name), $name) | Out-Null
    }
  } finally { $zip.Dispose() }
  $rollbackDigest = (Get-FileHash -LiteralPath $rollbackArchive -Algorithm SHA256).Hash
  $waiting = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 1') -WindowStyle Hidden -PassThru
  $rollbackHandoff = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 16)
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$updater`"", '-ProjectRoot', "`"$fixture`"", '-ArchivePath', "`"$rollbackArchive`"", '-Version', '9.4.2', '-ExpectedSha256', $rollbackDigest, '-ParentPid', $waiting.Id, '-Port', $port, '-NodeExe', "`"$((Get-Command node).Source)`"", '-HandoffId', $rollbackHandoff)
  $helper = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $fixture 'helper.log') -RedirectStandardError (Join-Path $fixture 'helper-error.log') -PassThru
  if (-not $helper.WaitForExit(30000)) { Stop-Process -InputObject $helper -Force; throw 'The failed update helper did not exit.' }
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
  $newServerPid = [int]$health.pid
  $status = Get-Content -LiteralPath (Join-Path $fixture '.data/update-status.json') -Raw | ConvertFrom-Json
  if ($health.version -ne '9.4.1' -or $status.status -ne 'failed' -or (Get-Content -LiteralPath (Join-Path $fixture 'package.json') -Raw | ConvertFrom-Json).version -ne '9.4.1') { throw 'The previous application was not restored after update failure.' }
  if ((Get-Content -LiteralPath (Join-Path $fixture '.env') -Raw) -ne 'PRIVATE_TEST_MARKER=keep' -or (Get-Content -LiteralPath (Join-Path $fixture '.data/account-marker') -Raw) -ne 'keep account data') { throw 'Private data changed during rollback.' }
  Write-Output 'Synthetic failed update rolled back and restarted the previous version.'
} finally {
  if ($newServerPid -gt 0) { try { Stop-Process -Id $newServerPid -Force } catch {} }
  $env:PORT = $previousPort
  $target = [IO.Path]::GetFullPath($fixture)
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not $target.StartsWith($temporary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.Path]::GetFileName($target).StartsWith('rcrd-update-apply-')) { throw 'Unsafe test cleanup path.' }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
}
