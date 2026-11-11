$ErrorActionPreference = 'Stop'
$builder = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Build-RCRD-Share.ps1'
$packageVersion = (Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version
$included = @(& $builder -ListIncludedFiles)
if ($included.Count -lt 10 -or $included -notcontains 'README.md') { throw 'The share-package manifest is incomplete.' }
if ($included -notcontains 'assets/spotify-icon-white.svg') { throw 'The share-package manifest omits the Spotify icon.' }
if ($included -notcontains 'assets/rcrd-cover-placeholder.webp') { throw 'The share-package manifest omits the disconnected cover artwork.' }
if ($included -notcontains 'walkthrough/RCRD-complete-walkthrough.mp4' -or $included -notcontains 'walkthrough/RCRD-complete-walkthrough-transcript.md') { throw 'The share-package manifest omits the in-app walkthrough.' }
if ($included | Where-Object { $_ -match '(^|/)(\.env$|\.data|desktop-prototype|tests|release)|\.key$|\.enc$|\.dmp$' }) { throw 'The share-package manifest includes a private path.' }
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

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$fixtureRoot = Join-Path $tempRoot ("rcrd-share-test-{0}" -f [guid]::NewGuid().ToString('N'))
$resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
if (-not $resolvedFixture.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid synthetic share-package directory.' }

try {
  New-Item -ItemType Directory -Path $resolvedFixture | Out-Null
  foreach ($name in $included) {
    $source = if ($name -eq 'README.md') { 'SHARE_README.md' } else { $name }
    $file = Join-Path $resolvedFixture ($source.Replace('/', [IO.Path]::DirectorySeparatorChar))
    New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
    $value = if ($source -eq '.env.example') { $safeExample -join "`n" } elseif ($source -eq 'package.json') { @{ version = $packageVersion } | ConvertTo-Json -Compress } else { "synthetic:$source" }
    [IO.File]::WriteAllText($file, $value)
  }
  [IO.File]::WriteAllText((Join-Path $resolvedFixture 'README.md'), 'synthetic:credited-readme')
  [IO.File]::WriteAllText((Join-Path $resolvedFixture '.env'), 'SYNTHETIC_PRIVATE_VALUE=not-for-share')
  $privateDirectory = Join-Path $resolvedFixture '.data'
  New-Item -ItemType Directory -Path $privateDirectory | Out-Null
  [IO.File]::WriteAllText((Join-Path $privateDirectory 'oauth-sessions.enc'), 'synthetic-private-session')
  $output = Join-Path $resolvedFixture 'package.zip'
  & $builder -SourceRoot $resolvedFixture -OutputPath $output | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($output)
  try {
    $actual = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    if (@(Compare-Object $included $actual).Count) { throw 'The package contents differ from the explicit manifest.' }
    $reader = [IO.StreamReader]::new(($archive.GetEntry('README.md')).Open())
    try { if ($reader.ReadToEnd() -ne 'synthetic:SHARE_README.md') { throw 'The default package did not use its privacy-reviewed README.' } }
    finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
  $second = Join-Path $resolvedFixture 'credited.zip'
  & $builder -SourceRoot $resolvedFixture -OutputPath $second -IncludeContributorCredit | Out-Null
  $credited = [IO.Compression.ZipFile]::OpenRead($second)
  try {
    $reader = [IO.StreamReader]::new(($credited.GetEntry('README.md')).Open())
    try { if ($reader.ReadToEnd() -ne 'synthetic:credited-readme') { throw 'The optional contributor-credit package used the wrong README.' } }
    finally { $reader.Dispose() }
  } finally { $credited.Dispose() }
  [IO.File]::WriteAllText((Join-Path $resolvedFixture '.env.example'), 'SPOTIFY_CLIENT_SECRET=synthetic-secret-that-must-not-ship')
  $rejected = $false
  try { & $builder -SourceRoot $resolvedFixture -OutputPath (Join-Path $resolvedFixture 'unsafe.zip') | Out-Null } catch { $rejected = $true }
  if (-not $rejected -or (Test-Path -LiteralPath (Join-Path $resolvedFixture 'unsafe.zip'))) { throw 'A modified environment example was not rejected.' }
  Write-Output 'Synthetic share-package allowlist and README choices passed.'
} finally {
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
