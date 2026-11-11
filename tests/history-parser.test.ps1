$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("rcrd-history-parser-test-" + [guid]::NewGuid().ToString('N'))
$parser = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Parse-Spotify-History.ps1'
[void](New-Item -ItemType Directory -Path $temporary)
try {
  $archivePath = Join-Path $temporary 'synthetic.zip'
  $outputPath = Join-Path $temporary 'summary.json'
  $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entry = $archive.CreateEntry('nested/Streaming_History_Audio_2025.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.Encoding]::UTF8)
    try {
      $writer.Write('[{"ts":"2025-01-01T12:00:00Z","username":"synthetic-user","ms_played":180000,"spotify_track_uri":"spotify:track:trackone","master_metadata_track_name":"One","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album","ip_addr_decrypted":"synthetic-private-ip"},{"ts":"2025-01-02T12:00:00Z","username":"synthetic-user","ms_played":45000,"spotify_track_uri":"spotify:track:trackone","master_metadata_track_name":"One","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album"},{"ts":"2025-01-03T12:00:00Z","username":"synthetic-user","ms_played":1000,"spotify_track_uri":"spotify:track:tracktwo","master_metadata_track_name":"Two","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album"}]')
    } finally { $writer.Dispose() }
  } finally { $archive.Dispose() }

  & $parser -ArchivePath $archivePath -OutputPath $outputPath
  $raw = [IO.File]::ReadAllText($outputPath)
  & node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" $outputPath
  if ($LASTEXITCODE -ne 0) { throw 'The parser summary is not readable by the Node server.' }
  $summary = ConvertFrom-Json -InputObject $raw
  if ($summary.username -ne 'synthetic-user' -or $summary.totalPlays -ne 2 -or $summary.tracks.Count -ne 1 -or $summary.tracks[0].plays -ne 2) { throw 'Valid synthetic archive produced an incorrect summary.' }
  if ($raw -match 'synthetic-private-ip|ip_addr_decrypted|ms_played') { throw 'Private source fields leaked into the summary.' }

  $anonymousPath = Join-Path $temporary 'anonymous.zip'
  $anonymous = [IO.Compression.ZipFile]::Open($anonymousPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entry = $anonymous.CreateEntry('Streaming_History_Audio_2025.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { $writer.Write('[{"ts":"2025-01-01T12:00:00Z","ms_played":180000,"spotify_track_uri":"spotify:track:trackone","master_metadata_track_name":"One","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album"}]') }
    finally { $writer.Dispose() }
  } finally { $anonymous.Dispose() }
  $anonymousOutput = Join-Path $temporary 'anonymous-summary.json'
  & $parser -ArchivePath $anonymousPath -OutputPath $anonymousOutput
  & node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" $anonymousOutput
  if ($LASTEXITCODE -ne 0) { throw 'An account-ID-free summary is not readable by the Node server.' }
  $anonymousSummary = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($anonymousOutput))
  if ($null -ne $anonymousSummary.username -or $anonymousSummary.totalPlays -ne 1) { throw 'An export without an account ID was not summarized for confirmation.' }

  $mixedPath = Join-Path $temporary 'mixed-accounts.zip'
  $mixed = [IO.Compression.ZipFile]::Open($mixedPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entry = $mixed.CreateEntry('Streaming_History_Audio_2025.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { $writer.Write('[{"ts":"2025-01-01T12:00:00Z","username":"synthetic-user","ms_played":180000,"spotify_track_uri":"spotify:track:trackone","master_metadata_track_name":"One","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album"},{"ts":"2025-01-02T12:00:00Z","username":"other-user","ms_played":180000,"spotify_track_uri":"spotify:track:trackone","master_metadata_track_name":"One","master_metadata_album_artist_name":"Artist","master_metadata_album_album_name":"Album"}]') }
    finally { $writer.Dispose() }
  } finally { $mixed.Dispose() }
  $mixedOutput = Join-Path $temporary 'mixed-summary.json'
  $rejected = $false
  try { & $parser -ArchivePath $mixedPath -OutputPath $mixedOutput } catch { $rejected = $true }
  if (-not $rejected -or [IO.File]::Exists($mixedOutput)) { throw 'Mixed-account history was not rejected.' }

  $invalidPath = Join-Path $temporary 'invalid.zip'
  [IO.File]::WriteAllText($invalidPath, 'not a ZIP')
  $invalidOutput = Join-Path $temporary 'invalid-summary.json'
  $rejected = $false
  try { & $parser -ArchivePath $invalidPath -OutputPath $invalidOutput } catch { $rejected = $true }
  if (-not $rejected -or [IO.File]::Exists($invalidOutput)) { throw 'Malformed ZIP was not rejected safely.' }

  $manyPath = Join-Path $temporary 'many-entries.zip'
  $many = [IO.Compression.ZipFile]::Open($manyPath, [IO.Compression.ZipArchiveMode]::Create)
  try { for ($index = 0; $index -le 1000; $index++) { [void]$many.CreateEntry("unrelated-$index.txt") } }
  finally { $many.Dispose() }
  $manyOutput = Join-Path $temporary 'many-summary.json'
  $rejected = $false
  try { & $parser -ArchivePath $manyPath -OutputPath $manyOutput } catch { $rejected = $true }
  if (-not $rejected -or [IO.File]::Exists($manyOutput)) { throw 'Oversized entry count was not rejected safely.' }
  Write-Output 'Spotify history parser synthetic tests passed.'
} finally {
  $resolved = [IO.Path]::GetFullPath($temporary)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ($resolved.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('rcrd-history-parser-test-', [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
