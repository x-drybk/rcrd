param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputPath,
  [switch]$IncludeContributorCredit,
  [switch]$ListIncludedFiles
)

$ErrorActionPreference = 'Stop'
$files = @(
  '.env.example',
  'ADMIN_GUIDE.md',
  'SECURITY.md',
  'app.js',
  'assets/rcrd-app-icon.ico',
  'assets/rcrd-app-icon.png',
  'assets/rcrd-cover-placeholder.webp',
  'assets/spotify-full-logo-white.svg',
  'assets/spotify-icon-white.svg',
  'distinction.css',
  'index.html',
  'Launch RCRD.cmd',
  'Launch RCRD.vbs',
  'manifest.webmanifest',
  'package.json',
  'RCRD.cmd',
  'scripts/Restart-RCRD.cjs',
  'scripts/Parse-Spotify-History.ps1',
  'scripts/Start-RCRD.ps1',
  'server.js',
  'styles.css'
  'walkthrough/RCRD-complete-walkthrough.mp4',
  'walkthrough/RCRD-complete-walkthrough-transcript.md'
)
$readmeSource = if ($IncludeContributorCredit) { 'README.md' } else { 'SHARE_README.md' }
$entries = @($files | ForEach-Object { [pscustomobject]@{ Source = $_; Archive = $_ } })
$entries += [pscustomobject]@{ Source = $readmeSource; Archive = 'README.md' }

if ($ListIncludedFiles) { $entries.Archive | Sort-Object; return }

$root = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$packageVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The share-package project path must not be a link.' }
$sourceFiles = foreach ($entry in $entries) {
  $candidate = Join-Path $root ($entry.Source.Replace('/', [IO.Path]::DirectorySeparatorChar))
  $folder = $root
  foreach ($part in @($entry.Source.Split('/') | Select-Object -SkipLast 1)) {
    $folder = Join-Path $folder $part
    if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A share-package folder must not be a link.' }
  }
  $item = Get-Item -LiteralPath $candidate -ErrorAction Stop
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A share-package source is not a regular file.' }
  if (-not $item.FullName.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'A share-package source is outside the project.' }
  [pscustomobject]@{ FullName = $item.FullName; Archive = $entry.Archive }
}

$safeExample = @(
  'DISCOGS_CONSUMER_KEY=replace_with_rotated_key',
  'DISCOGS_CONSUMER_SECRET=replace_with_rotated_secret',
  'DISCOGS_REQUEST_TOKEN_URL=https://api.discogs.com/oauth/request_token',
  'DISCOGS_AUTHORIZE_URL=https://www.discogs.com/oauth/authorize',
  'DISCOGS_ACCESS_TOKEN_URL=https://api.discogs.com/oauth/access_token',
  'DISCOGS_CALLBACK_URL=http://127.0.0.1:3000/auth/discogs/callback',
  "DISCOGS_USER_AGENT=RCRD/$packageVersion +http://localhost:3000",
  'SPOTIFY_CLIENT_ID=replace_with_spotify_client_id',
  'SPOTIFY_CLIENT_SECRET=replace_with_spotify_client_secret',
  'SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/spotify/callback',
  'GENIUS_ACCESS_TOKEN=',
  'SESSION_COOKIE_MAX_AGE_DAYS=365',
  'SPOTIFY_REFRESH_TOKEN_MAX_AGE_DAYS=180',
  'RCRD_METADATA_CONTACT='
)
$example = @(Get-Content -LiteralPath (Join-Path $root '.env.example'))
if ($example.Count -ne $safeExample.Count -or (Compare-Object $example $safeExample)) { throw 'The share-package environment example differs from its safe template.' }

if (-not $OutputPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $OutputPath = Join-Path $root "release/RCRD-source-$stamp.zip"
}
$archivePath = [IO.Path]::GetFullPath($OutputPath)
if ([IO.Path]::GetExtension($archivePath) -ne '.zip') { throw 'The share-package output must be a .zip file.' }
if (Test-Path -LiteralPath $archivePath) { throw 'The share-package output already exists.' }
$archiveDirectory = Split-Path -Parent $archivePath
New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = $null
$archive = $null
$created = $false
try {
  $stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $created = $true
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  foreach ($item in $sourceFiles) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $item.Archive, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  $archive.Dispose()
  $archive = $null
  $stream = $null
} catch {
  if ($archive) { $archive.Dispose() }
  elseif ($stream) { $stream.Dispose() }
  if ($created) { Remove-Item -LiteralPath $archivePath -Force }
  throw
}
Write-Output $archivePath
