param(
  [Parameter(Mandatory)][string]$ProjectRoot,
  [Parameter(Mandatory)][string]$ArchivePath,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$ExpectedSha256,
  [int]$ParentPid = 0,
  [int]$Port = 0,
  [string]$NodeExe = '',
  [string]$HandoffId = '',
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$archive = [IO.Path]::GetFullPath($ArchivePath)
$runtime = Join-Path $root '.data'
$stageParent = Join-Path $runtime 'update-staging'
$stage = [IO.Path]::GetDirectoryName($archive)
$separator = [IO.Path]::DirectorySeparatorChar
if ($stage -eq $stageParent -or -not $stage.StartsWith($stageParent + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update archive is outside the private staging folder.' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'RCRD project folder is a link.' }
if ((Get-Item -LiteralPath $runtime).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'RCRD private data folder is a link.' }
if ((Get-Item -LiteralPath $stageParent).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update staging folder is a link.' }
if ((Get-Item -LiteralPath $stage).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update staging folder is a link.' }
if ((Get-Item -LiteralPath $archive).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update archive is a link.' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid update version or digest.' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $ExpectedSha256.ToUpperInvariant()) { throw 'The release ZIP failed its SHA-256 check.' }

$zip = [IO.Compression.ZipFile]::OpenRead($archive)
$entries = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$total = [long]0
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if ($name.EndsWith('/')) { continue }
    if ($entries.Count -ge 500 -or $name -notmatch '^[A-Za-z0-9_. -]+(?:/[A-Za-z0-9_. -]+)*$') { throw 'The release ZIP contains an unsafe file name.' }
    $parts = $name.Split('/')
    if ($parts | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_.EndsWith('.') -or $_.EndsWith(' ') -or ($_.StartsWith('.') -and $_ -ne '.env.example') }) { throw 'The release ZIP contains a private or unsafe path.' }
    if ($parts.Count -gt 1 -and $parts[0] -notin @('assets', 'scripts', 'walkthrough')) { throw 'The release ZIP contains an unexpected folder.' }
    if ($parts.Count -eq 1 -and $name -notin @('.env.example', 'ADMIN_GUIDE.md', 'SECURITY.md', 'app.js', 'distinction.css', 'index.html', 'Launch RCRD.cmd', 'Launch RCRD.vbs', 'LICENSE', 'manifest.webmanifest', 'package.json', 'RCRD.cmd', 'README.md', 'server.js', 'styles.css')) { throw 'The release ZIP contains an unexpected root file.' }
    if (-not $seen.Add($name)) { throw 'The release ZIP contains duplicate files.' }
    if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'The release ZIP contains a symbolic link.' }
    $total += $entry.Length
    if ($entry.Length -gt 256MB -or $total -gt 512MB) { throw 'The release ZIP expands beyond the supported size.' }
    $entries.Add($entry)
  }
  foreach ($required in @('package.json', 'server.js', 'app.js', 'index.html', 'scripts/Start-RCRD.ps1', 'scripts/Restart-RCRD.cjs', 'scripts/Update-RCRD.ps1')) {
    if (-not $seen.Contains($required)) { throw "The release ZIP is missing $required." }
  }
  $package = $zip.GetEntry('package.json')
  if ($package.Length -gt 1MB) { throw 'The release metadata is too large.' }
  $reader = [IO.StreamReader]::new($package.Open())
  try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json }
  finally { $reader.Dispose() }
  if ($metadata.version -ne $Version) { throw 'The release ZIP version does not match the GitHub release.' }
  if ($ValidateOnly) { $entries.FullName; return }
  if ($ParentPid -le 0 -or $Port -lt 1 -or $Port -gt 65535 -or $HandoffId -notmatch '^[a-f0-9]{48}$' -or -not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw 'Invalid update handoff.' }
  $node = [IO.Path]::GetFullPath($NodeExe)
  $statusFile = Join-Path $runtime 'update-status.json'
  function Set-UpdateStatus([string]$status, [string]$message = '') {
    $temporary = "$statusFile.$HandoffId.tmp"
    [IO.File]::WriteAllText($temporary, (ConvertTo-Json -Compress @{ status = $status; version = $Version; message = $message; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }))
    Move-Item -LiteralPath $temporary -Destination $statusFile -Force
  }
  $readyFile = Join-Path $runtime "update-ready-$HandoffId"
  [IO.File]::WriteAllText("$readyFile.tmp", $HandoffId)
  Move-Item -LiteralPath "$readyFile.tmp" -Destination $readyFile
  $parentGone = $false
  $installed = [System.Collections.Generic.List[object]]::new()
  $newChild = $null
  $backupRoot = Join-Path $runtime "update-backups/$HandoffId"
  $extractedRoot = Join-Path $stage 'extracted'
  function Start-RcrdServer([string]$expectedVersion) {
    $serverFile = Join-Path $root 'server.js'
    $child = Start-Process -FilePath $node -ArgumentList @("`"$serverFile`"") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log') -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($health.app -eq 'rcrd' -and $health.version -eq $expectedVersion -and [int]$health.pid -eq $child.Id) { return $child }
      } catch {}
      $child.Refresh()
      if ($child.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    try { if (-not $child.HasExited) { Stop-Process -InputObject $child -Force } } catch {}
    throw "RCRD $expectedVersion did not start successfully."
  }
  try {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $parentGone = $true; break }
      Start-Sleep -Milliseconds 200
    }
    if (-not $parentGone) { throw 'The previous RCRD server did not exit.' }
    [IO.Directory]::CreateDirectory($extractedRoot) | Out-Null
    foreach ($entry in $entries) {
      $relative = $entry.FullName.Replace('/', $separator)
      $destination = [IO.Path]::GetFullPath((Join-Path $extractedRoot $relative))
      if (-not $destination.StartsWith($extractedRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw 'The release ZIP contains a path outside staging.' }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
      $source = $entry.Open(); $target = [IO.File]::Create($destination)
      try { $source.CopyTo($target) } finally { $source.Dispose(); $target.Dispose() }
    }
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    foreach ($entry in $entries) {
      $relative = $entry.FullName.Replace('/', $separator)
      $destination = [IO.Path]::GetFullPath((Join-Path $root $relative))
      if (-not $destination.StartsWith($root + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw 'The release ZIP contains a path outside RCRD.' }
      $folder = [IO.Path]::GetDirectoryName($destination)
      while ($folder.Length -gt $root.Length) {
        if ((Test-Path -LiteralPath $folder) -and ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'An application folder is a link.' }
        $folder = [IO.Path]::GetDirectoryName($folder)
      }
      if ((Test-Path -LiteralPath $destination) -and ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'An application file is a link.' }
      $hadOriginal = Test-Path -LiteralPath $destination -PathType Leaf
      if ($hadOriginal) {
        $backup = Join-Path $backupRoot $relative
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($backup)) | Out-Null
        [IO.File]::Copy($destination, $backup)
      }
      $installed.Add([pscustomobject]@{ Destination = $destination; Relative = $relative; HadOriginal = $hadOriginal })
    }
    Set-UpdateStatus 'installing'
    foreach ($item in $installed) {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.Destination)) | Out-Null
      [IO.File]::Copy((Join-Path $extractedRoot $item.Relative), $item.Destination, $true)
    }
    $newChild = Start-RcrdServer $Version
    Set-UpdateStatus 'complete'
  } catch {
    $reason = $_.Exception.Message
    if ($parentGone) {
      if ($newChild) { try { Stop-Process -InputObject $newChild -Force } catch {} }
      foreach ($item in $installed) {
        try { if ($item.HadOriginal) { [IO.File]::Copy((Join-Path $backupRoot $item.Relative), $item.Destination, $true) } elseif (Test-Path -LiteralPath $item.Destination) { [IO.File]::Delete($item.Destination) } } catch {}
      }
      try { Start-RcrdServer ((Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version) | Out-Null } catch { $reason += ' The previous server also could not restart.' }
    }
    Set-UpdateStatus 'failed' $reason
    exit 1
  }
} finally {
  $zip.Dispose()
  if (-not $ValidateOnly -and $stage.StartsWith($stageParent + $separator, [StringComparison]::OrdinalIgnoreCase)) {
    try { Remove-Item -LiteralPath $stage -Recurse -Force } catch {}
  }
}
