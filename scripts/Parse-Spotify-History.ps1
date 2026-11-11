param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$maximumEntryBytes = 64MB
$maximumTotalBytes = 512MB
$maximumEvents = 2000000
$maximumTracks = 100000
$minimumPlayMs = 30000
$tracks = @{}
$usernames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$totalBytes = [long]0
$totalEvents = 0
$totalPlays = 0
$firstAt = [DateTimeOffset]::MaxValue
$lastAt = [DateTimeOffset]::MinValue
$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
  if ($archive.Entries.Count -gt 1000) { throw 'The archive contains too many files.' }
  $audioEntries = @($archive.Entries | Where-Object {
    [IO.Path]::GetFileName($_.FullName) -match '^(Streaming_History_Audio_.*|endsong_.*)\.json$'
  })
  if (-not $audioEntries.Count -or $audioEntries.Count -gt 100) { throw 'Select a Spotify Extended Streaming History ZIP with audio history files.' }
  foreach ($entry in $audioEntries) {
    if ($entry.Length -gt $maximumEntryBytes) { throw 'An audio history file is too large to import safely.' }
    $totalBytes += $entry.Length
    if ($totalBytes -gt $maximumTotalBytes) { throw 'The audio history is too large to import safely.' }
    $stream = $entry.Open()
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)
    try {
      $buffer = [char[]]::new(32768)
      $content = [Text.StringBuilder]::new()
      while (($read = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if ($content.Length + $read -gt $maximumEntryBytes) { throw 'An audio history file expands beyond the safe limit.' }
        [void]$content.Append($buffer, 0, $read)
      }
      $events = ConvertFrom-Json -InputObject $content.ToString()
      if ($events -isnot [array]) { throw 'An audio history file is not a JSON array.' }
      foreach ($event in $events) {
        $totalEvents++
        if ($totalEvents -gt $maximumEvents) { throw 'The archive contains too many listening events.' }
        if ($event.username -is [string] -and $event.username.Length -gt 0) { [void]$usernames.Add($event.username) }
        $uri = [string]$event.spotify_track_uri
        if ($uri -cnotmatch '^spotify:track:[A-Za-z0-9]+$') { continue }
        $milliseconds = [long]0
        if (-not [long]::TryParse([string]$event.ms_played, [ref]$milliseconds) -or $milliseconds -lt $minimumPlayMs -or $milliseconds -gt 86400000) { continue }
        $playedAt = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse([string]$event.ts, [ref]$playedAt) -or $playedAt.Year -lt 2000 -or $playedAt -gt [DateTimeOffset]::UtcNow.AddDays(1)) { continue }
        $title = [string]$event.master_metadata_track_name
        $artist = [string]$event.master_metadata_album_artist_name
        if (-not $title.Trim() -or -not $artist.Trim()) { continue }
        if (-not $tracks.ContainsKey($uri)) {
          if ($tracks.Count -ge $maximumTracks) { throw 'The archive contains too many distinct tracks.' }
          $tracks[$uri] = @{ uri = $uri; title = $title.Substring(0, [Math]::Min(180, $title.Length)); artist = $artist.Substring(0, [Math]::Min(120, $artist.Length)); album = ([string]$event.master_metadata_album_album_name).Substring(0, [Math]::Min(180, ([string]$event.master_metadata_album_album_name).Length)); plays = 0 }
        }
        $tracks[$uri].plays++
        $totalPlays++
        if ($playedAt -lt $firstAt) { $firstAt = $playedAt }
        if ($playedAt -gt $lastAt) { $lastAt = $playedAt }
      }
    } finally { $reader.Dispose() }
  }
} finally { $archive.Dispose() }

if ($usernames.Count -gt 1) { throw 'The archive identifies more than one Spotify account.' }
if ($totalPlays -eq 0) { throw 'No qualifying music plays were found in this archive.' }
$archiveUsername = $null
if ($usernames.Count -eq 1) { $archiveUsername = @($usernames)[0] }
$summary = @{
  version = 1
  username = $archiveUsername
  totalPlays = $totalPlays
  firstAt = $firstAt.ToUniversalTime().ToString('o')
  lastAt = $lastAt.ToUniversalTime().ToString('o')
  tracks = @($tracks.Values | Sort-Object -Property plays -Descending)
}
$json = ConvertTo-Json -InputObject $summary -Depth 5 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
