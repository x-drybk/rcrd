$ErrorActionPreference = 'Stop'
$updater = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Update-RCRD.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("rcrd-update-test-" + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $fixture 'payload'
$stage = Join-Path $fixture '.data/update-staging/test'
$archive = Join-Path $stage 'release.zip'
try {
  New-Item -ItemType Directory -Path $payload, $stage, (Join-Path $payload 'scripts') -Force | Out-Null
  foreach ($file in @('server.js', 'app.js', 'index.html', 'scripts/Start-RCRD.ps1', 'scripts/Restart-RCRD.cjs', 'scripts/Update-RCRD.ps1')) {
    $destination = Join-Path $payload $file
    [IO.File]::WriteAllText($destination, 'synthetic release file')
  }
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
  $valid = @(& $updater -ProjectRoot $fixture -ArchivePath $archive -Version '9.4.1' -ExpectedSha256 $digest -ValidateOnly)
  if ($valid.Count -ne 7 -or $valid -notcontains 'scripts/Update-RCRD.ps1') { throw 'A valid release ZIP was not accepted.' }
  $zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Update)
  try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $payload 'app.js'), '../outside.js') | Out-Null }
  finally { $zip.Dispose() }
  $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $rejected = $false
  try { & $updater -ProjectRoot $fixture -ArchivePath $archive -Version '9.4.1' -ExpectedSha256 $digest -ValidateOnly 2>$null | Out-Null } catch { $rejected = $true }
  if (-not $rejected -or (Test-Path -LiteralPath (Join-Path $fixture 'outside.js'))) { throw 'An unsafe release ZIP was accepted.' }
  $wrong = $false
  try { & $updater -ProjectRoot $fixture -ArchivePath $archive -Version '9.4.1' -ExpectedSha256 ('0' * 64) -ValidateOnly 2>$null | Out-Null } catch { $wrong = $true }
  if (-not $wrong) { throw 'A release ZIP with the wrong digest was accepted.' }
  Write-Output 'Update archive validation passed.'
} finally {
  $target = [IO.Path]::GetFullPath($fixture)
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not $target.StartsWith($temporary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.Path]::GetFileName($target).StartsWith('rcrd-update-test-')) { throw 'Unsafe test cleanup path.' }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
}
