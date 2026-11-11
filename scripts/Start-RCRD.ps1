param(
  [ValidateSet('start', 'restart', 'stop', 'status')]
  [string]$Action = 'start',
  [switch]$NoBrowser,
  [switch]$RcrdChrome,
  [switch]$RcrdFirefox,
  [int]$ExpectedPid = 0
)

$ErrorActionPreference = 'Stop'
if ($RcrdChrome -and $RcrdFirefox) { throw 'Choose only one RCRD browser.' }
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DataDirectory = Join-Path $ProjectRoot '.data'
$PidFile = Join-Path $DataDirectory 'rcrd-server.json'
$LogFile = Join-Path $DataDirectory 'server.log'
$ErrorLogFile = Join-Path $DataDirectory 'server-error.log'
$ServerFile = Join-Path $ProjectRoot 'server.js'

function Get-ConfiguredPort {
  param([string]$EnvFile = (Join-Path $ProjectRoot '.env'))

  $value = $env:PORT
  if (-not $value -and (Test-Path -LiteralPath $EnvFile)) {
    foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
      $match = [regex]::Match($line, '^\s*PORT\s*=\s*(.*?)\s*$')
      if ($match.Success) {
        $value = $match.Groups[1].Value.Trim('"', "'")
        if ($value) { break }
      }
    }
  }

  if (-not $value) { return 3000 }
  $configuredPort = 0
  if (-not [int]::TryParse($value, [ref]$configuredPort) -or $configuredPort -lt 1 -or $configuredPort -gt 65535) {
    throw 'PORT must be an integer from 1 to 65535.'
  }
  return $configuredPort
}

$Port = Get-ConfiguredPort
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "${Url}api/health"

function Get-PortOwnerId {
  foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
    if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      return [int]$Matches[1]
    }
  }
  return 0
}

function Get-RcrdHealth {
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($response.ok -eq $true -and $response.app -eq 'rcrd' -and $response.pid) { return $response }
  } catch {}
  return $null
}

function Get-RcrdFirefoxPath {
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe' }
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\firefox.exe' }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [System.IO.Path]::GetFullPath($candidate) }
  }
  throw 'Firefox was not found. Install Firefox to use the dedicated RCRD profile; the primary browser was not opened.'
}

function Get-RcrdChromePath {
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
  if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [System.IO.Path]::GetFullPath($candidate) }
  }
  throw 'Chrome was not found in a standard installation location. Install Chrome to use the RCRD app window; the primary browser was not opened.'
}

function Initialize-RcrdWindowProbe {
  if (-not ('RcrdWindowProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class RcrdWindowProbe {
  private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  public static int FindProfileProcessId(string profile) {
    var singleton = FindWindowEx(new IntPtr(-3), IntPtr.Zero, "Chrome_MessageWindow", profile);
    if (singleton == IntPtr.Zero) return 0;
    uint processId;
    GetWindowThreadProcessId(singleton, out processId);
    return checked((int)processId);
  }

  public static List<long> FindWindows(int processId) {
    var matches = new List<long>();
    if (!EnumWindows((window, parameter) => {
      if (!IsWindowVisible(window)) return true;
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == processId) matches.Add(window.ToInt64());
      return true;
    }, IntPtr.Zero)) throw new InvalidOperationException("Windows could not be enumerated.");
    return matches;
  }

  public static bool Activate(long handle) {
    var window = new IntPtr(handle);
    if (IsIconic(window)) ShowWindowAsync(window, 9);
    return SetForegroundWindow(window) || GetForegroundWindow() == window;
  }
}
'@
  }
}

function Get-RcrdChromeWindowRecords {
  param([string]$Profile)
  Initialize-RcrdWindowProbe
  $processId = [RcrdWindowProbe]::FindProfileProcessId($Profile)
  if (-not $processId) { return $null }
  return [pscustomobject]@{ ProcessId = $processId; Handles = @([RcrdWindowProbe]::FindWindows($processId)) }
}

function Get-ExistingRcrdChrome {
  param([string]$Chrome, [string]$Profile, [switch]$AllowStarting)
  try {
    $record = Get-RcrdChromeWindowRecords -Profile $Profile
    if (-not $record) { return $null }
    $candidate = Get-Process -Id $record.ProcessId -ErrorAction Stop
    if ($candidate.ProcessName -ne 'chrome' -or -not $candidate.Path -or
        -not [string]::Equals([System.IO.Path]::GetFullPath($candidate.Path), $Chrome, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'The RCRD Chrome profile owner could not be verified.'
    }
  } catch {
    throw 'RCRD could not verify its Chrome profile owner. No new window was started.'
  }
  if ($record.Handles.Count -gt 1) { throw 'More than one RCRD Chrome window is already open. Close the extra window before launching RCRD again.' }
  if ($record.Handles.Count -eq 0 -and $AllowStarting) { return $null }
  if ($record.Handles.Count -eq 0) { throw 'RCRD Chrome is running without a visible window. Close that Chrome process before launching RCRD again.' }
  return [pscustomobject]@{ Id = $candidate.Id; Handle = $record.Handles[0] }
}

function Activate-RcrdChromeWindow {
  param($Window)
  if ([RcrdWindowProbe]::Activate([long]$Window.Handle)) { return $true }
  try { return [bool](New-Object -ComObject WScript.Shell).AppActivate('RCRD — Music discovery & collecting') } catch { return $false }
}

function Wait-ForRcrdChromeWindow {
  param([string]$Chrome, [string]$Profile, [int]$TimeoutMs = 10000)
  $watch = [Diagnostics.Stopwatch]::StartNew()
  do {
    $existing = Get-ExistingRcrdChrome -Chrome $Chrome -Profile $Profile -AllowStarting
    if ($existing) { return $existing }
    if ($watch.ElapsedMilliseconds -ge $TimeoutMs) { break }
    Start-Sleep -Milliseconds 100
  } while ($true)
  throw 'Chrome started, but the RCRD window could not be confirmed. Check open windows before trying again.'
}

function New-RcrdPrivateDirectorySecurity {
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($sid in @($currentUser, [System.Security.Principal.SecurityIdentifier]'S-1-5-18', [System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
  }
  return $security
}

function Assert-RcrdPrivateDirectorySecurity {
  param([string]$Path, [switch]$AllowInherited)
  $security = Get-Acl -LiteralPath $Path
  $allowed = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
  if (-not $AllowInherited -and -not $security.AreAccessRulesProtected) {
    throw 'RCRD private storage inherits Windows permissions. Review its access before launching; RCRD will not silently change an existing folder.'
  }
  foreach ($rule in $security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin $allowed) {
      throw 'RCRD private storage permits another Windows account. Review its access before launching; RCRD will not silently remove permissions.'
    }
  }
}

function Ensure-RcrdPrivateDirectory {
  param([string]$Path, [switch]$AllowInherited)
  if (Test-Path -LiteralPath $Path) {
    $entry = Get-Item -LiteralPath $Path -Force
    if (-not $entry.PSIsContainer -or ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw 'RCRD cannot use a linked or non-directory browser profile location.'
    }
  } else {
    [System.IO.Directory]::CreateDirectory($Path, (New-RcrdPrivateDirectorySecurity)) | Out-Null
  }
  Assert-RcrdPrivateDirectorySecurity $Path -AllowInherited:$AllowInherited
}

function Test-RcrdFirefoxProfileInUse {
  param([string]$Profile)
  $lockPath = Join-Path $Profile 'parent.lock'
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $false }
  try {
    $handle = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    $handle.Dispose()
    return $false
  } catch [System.IO.IOException] {
    return $true
  } catch {
    throw 'RCRD could not check whether its Firefox profile is in use. No new Firefox window was started.'
  }
}

function Get-RcrdWebAppId {
  param([string]$Profile, [string]$AppUrl)
  $registryDirectory = Join-Path $Profile 'taskbartabs'
  $registryPath = Join-Path $registryDirectory 'taskbartabs.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { return $null }
  $directory = Get-Item -LiteralPath $registryDirectory -Force
  $file = Get-Item -LiteralPath $registryPath -Force
  if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
      ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 65536) {
    throw 'The RCRD Firefox web-app registration could not be safely read.'
  }
  try {
    $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
    $matches = @($registry.taskbarTabs | Where-Object {
      $_.userContextId -eq 0 -and
      [string]::Equals(([string]$_.startUrl).TrimEnd('/'), $AppUrl.TrimEnd('/'), [StringComparison]::OrdinalIgnoreCase)
    })
    if ($matches.Count -gt 1) { throw 'Multiple RCRD web apps matched.' }
    if ($matches.Count -eq 0) { return $null }
    $id = [string]$matches[0].id
    if ($id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
      throw 'Invalid RCRD web-app identifier.'
    }
    return $id
  } catch {
    throw 'The RCRD Firefox web-app registration is invalid. Recreate it using Firefox Add tab to taskbar.'
  }
}

function Get-ExistingRcrdFirefox {
  param([string]$Firefox, [string]$Profile)
  try {
    foreach ($entry in (Get-CimInstance -ClassName Win32_Process -Filter "Name = 'firefox.exe'" -ErrorAction Stop)) {
      if (-not $entry.ExecutablePath -or -not [System.IO.Path]::IsPathRooted([string]$entry.ExecutablePath) -or
          -not [string]::Equals([System.IO.Path]::GetFullPath([string]$entry.ExecutablePath), $Firefox, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $argument = [regex]::Match([string]$entry.CommandLine, '(?i)(?:^|\s)-profile\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))(?:\s|$)')
      if (-not $argument.Success) { continue }
      $selected = if ($argument.Groups['quoted'].Success) { $argument.Groups['quoted'].Value } else { $argument.Groups['plain'].Value }
      if (-not [System.IO.Path]::IsPathRooted($selected) -or
          -not [string]::Equals([System.IO.Path]::GetFullPath($selected), $Profile, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $candidate = Get-Process -Id ([int]$entry.ProcessId) -ErrorAction SilentlyContinue
      if ($candidate -and $candidate.ProcessName -eq 'firefox') { return $candidate }
    }
  } catch {}
  return $null
}

function Open-Rcrd {
  if ($NoBrowser) { return }
  if ($RcrdChrome) {
    $chrome = Get-RcrdChromePath
    Ensure-RcrdPrivateDirectory $DataDirectory
    $profile = Join-Path $DataDirectory 'chrome-profile'
    Ensure-RcrdPrivateDirectory $profile -AllowInherited
    $existing = Get-ExistingRcrdChrome -Chrome $chrome -Profile $profile
    if ($existing) {
      $activated = Activate-RcrdChromeWindow -Window $existing
      if (-not $activated) { throw 'RCRD Chrome is already open, but its window could not be activated. No new window was started.' }
      Write-Host 'RCRD Chrome is already open.'
      return
    }
    $arguments = @('--no-first-run', '--no-default-browser-check', '--force-dark-mode', '--start-maximized', "--user-data-dir=`"$profile`"", "--app=$Url")
    $launched = Start-Process -FilePath $chrome -ArgumentList $arguments -WorkingDirectory $ProjectRoot -PassThru
    if ($launched.WaitForExit(1000) -and $launched.ExitCode -ne 0) {
      throw "Chrome exited with code $($launched.ExitCode) while opening RCRD. Check that the RCRD Chrome profile is not blocked."
    }
    Wait-ForRcrdChromeWindow -Chrome $chrome -Profile $profile | Out-Null
    return
  }
  if (-not $RcrdFirefox) { Start-Process $Url; return }
  $firefox = Get-RcrdFirefoxPath
  Ensure-RcrdPrivateDirectory $DataDirectory
  $profile = Join-Path $DataDirectory 'firefox-profile'
  Ensure-RcrdPrivateDirectory $profile -AllowInherited
  $webAppId = Get-RcrdWebAppId -Profile $profile -AppUrl $Url
  $existing = Get-ExistingRcrdFirefox -Firefox $firefox -Profile $profile
  if ($existing) {
    $activated = $false
    try { $activated = (New-Object -ComObject WScript.Shell).AppActivate($existing.Id) } catch {}
    if (-not $activated) { throw 'RCRD Firefox is running, but its window could not be activated. Close that window and launch RCRD again.' }
    Write-Host 'RCRD Firefox is already open.'
    return
  }
  if (Test-RcrdFirefoxProfileInUse -Profile $profile) {
    throw 'The RCRD Firefox profile is in use, but its window could not be verified. Close the existing RCRD Firefox window and try again.'
  }
  $arguments = @('-no-remote', '-profile', "`"$profile`"")
  if ($webAppId) {
    $arguments += @('-taskbar-tab', $webAppId, '-new-window', $Url, '-container', '0')
  } else {
    $arguments += @('-new-window', $Url)
    Write-Host 'In Firefox, use Add tab to taskbar once to create the RCRD app window.'
  }
  $launched = Start-Process -FilePath $firefox -ArgumentList $arguments -WorkingDirectory $ProjectRoot -PassThru
  if ($launched.WaitForExit(1000)) {
    throw 'Firefox exited immediately while opening RCRD. Close any remaining RCRD Firefox windows and try again.'
  }
}

function Get-ManagedProcess {
  param($Health)

  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  try {
    $runtime = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
    $recordedRoot = [System.IO.Path]::GetFullPath([string]$runtime.root)
    $expectedRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
    $recordedPid = [int]$runtime.pid
    $recordedPort = [int]$runtime.port
    $recordedStart = [datetime]::Parse([string]$runtime.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    if ($recordedPid -le 0 -or $recordedPort -ne $Port -or
        -not [string]::Equals($recordedRoot, $expectedRoot, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    if ($Health -and [int]$Health.pid -ne $recordedPid) { return $null }

    $candidate = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if (-not $candidate -or $candidate.ProcessName -ne 'node') { return $null }

    $processInfo = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $recordedPid" -ErrorAction Stop
    if (-not $processInfo -or [int]$processInfo.ProcessId -ne $recordedPid) { return $null }
    $launch = [regex]::Match([string]$processInfo.CommandLine, '^\s*(?:"[^"]+"|\S+)\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))(?:\s|$)')
    if (-not $launch.Success) { return $null }
    $scriptArgument = if ($launch.Groups['quoted'].Success) { $launch.Groups['quoted'].Value } else { $launch.Groups['plain'].Value }
    if (-not [System.IO.Path]::IsPathRooted($scriptArgument) -or
        -not [string]::Equals([System.IO.Path]::GetFullPath($scriptArgument), [System.IO.Path]::GetFullPath($ServerFile), [StringComparison]::OrdinalIgnoreCase)) { return $null }

    $startupSeconds = ($recordedStart - $candidate.StartTime.ToUniversalTime()).TotalSeconds
    if ($startupSeconds -lt 0 -or $startupSeconds -gt 300) { return $null }

    $ownerId = Get-PortOwnerId
    if ($Health -and $ownerId -ne $recordedPid) { return $null }
    if ($ownerId -and $ownerId -ne $recordedPid) { return $null }
    return $candidate
  } catch {
    return $null
  }
}

function Stop-RcrdProcess {
  param($Health)

  $candidate = Get-ManagedProcess -Health $Health
  if (-not $candidate) { return $false }

  Write-Host "Stopping RCRD (PID $($candidate.Id))..."
  Stop-Process -InputObject $candidate -Force
  if (-not $candidate.WaitForExit(5000)) { throw 'RCRD did not stop within 5 seconds.' }
  if (Test-Path -LiteralPath $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
  return $true
}

$lockHash = [System.Security.Cryptography.SHA256]::Create()
try {
  $lockId = [BitConverter]::ToString($lockHash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([System.IO.Path]::GetFullPath($ProjectRoot).ToUpperInvariant()))).Replace('-', '')
} finally { $lockHash.Dispose() }
$launchMutex = [System.Threading.Mutex]::new($false, "Local\RCRD-Launcher-$lockId")
$launchLockHeld = $false
try {
  try { $launchLockHeld = $launchMutex.WaitOne(30000) }
  catch [System.Threading.AbandonedMutexException] { $launchLockHeld = $true }
  if (-not $launchLockHeld) { throw 'Another RCRD launch is still in progress. Try again shortly.' }

if ($RcrdChrome -and -not $NoBrowser -and $Action -in @('start', 'restart')) {
  Get-RcrdChromePath | Out-Null
  Ensure-RcrdPrivateDirectory $DataDirectory
  Ensure-RcrdPrivateDirectory (Join-Path $DataDirectory 'chrome-profile') -AllowInherited
}
if ($RcrdFirefox -and -not $NoBrowser -and $Action -in @('start', 'restart')) {
  Get-RcrdFirefoxPath | Out-Null
  Ensure-RcrdPrivateDirectory $DataDirectory
  Ensure-RcrdPrivateDirectory (Join-Path $DataDirectory 'firefox-profile') -AllowInherited
}

$health = Get-RcrdHealth
if ($ExpectedPid -ne 0 -and ($Action -ne 'restart' -or -not $health -or [int]$health.pid -ne $ExpectedPid)) {
  throw 'The requested RCRD process is no longer running. No process was stopped.'
}
if ($Action -eq 'status') {
  if ($health) { Write-Host "RCRD is running at $Url (PID $($health.pid))."; exit 0 }
  Write-Host 'RCRD is not running.'
  exit 1
}

if ($Action -eq 'stop') {
  if (Stop-RcrdProcess -Health $health) { Write-Host 'RCRD has stopped.'; exit 0 }
  if ($health) { throw 'RCRD is responding, but this launcher cannot verify that it owns the server process. It was not stopped.' }
  Write-Host 'No verified RCRD server is running.'
  if (Test-Path -LiteralPath $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
  exit 0
}

if ($Action -eq 'restart' -and $health) {
  if (-not (Stop-RcrdProcess -Health $health)) {
    throw 'RCRD is responding, but this launcher cannot verify that it owns the server process. It was not stopped.'
  }
  $health = $null
}

if ($health -and $Action -eq 'start') {
  Write-Host "RCRD is already running. Opening $Url"
  Open-Rcrd
  exit 0
}

if (Test-Path $PidFile) {
  if (-not (Stop-RcrdProcess -Health $null)) {
    Remove-Item -LiteralPath $PidFile -Force
  }
}

$portOwnerId = Get-PortOwnerId
if ($portOwnerId) {
  $owner = Get-Process -Id $portOwnerId -ErrorAction SilentlyContinue
  $ownerName = if ($owner) { $owner.ProcessName } else { "PID $portOwnerId" }
  throw "Port $Port is being used by $ownerName, not by a launcher-managed RCRD server. Close that app or set a different PORT in .env."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed or is not available in PATH.'
}

Ensure-RcrdPrivateDirectory $DataDirectory
Write-Host 'Starting RCRD...'
$started = Start-Process -FilePath 'node' `
  -ArgumentList @("`"$ServerFile`"") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $LogFile `
  -RedirectStandardError $ErrorLogFile `
  -PassThru

$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 250
  $health = Get-RcrdHealth
  if ($health -and [int]$health.pid -eq $started.Id -and (Get-ManagedProcess -Health $health)) {
    Write-Host "RCRD is ready at $Url"
    Open-Rcrd
    exit 0
  }
  $started.Refresh()
  if ($started.HasExited) { break }
} while ((Get-Date) -lt $deadline)

throw "RCRD did not become ready. Check $ErrorLogFile."
} finally {
  if ($launchLockHeld) { $launchMutex.ReleaseMutex() }
  $launchMutex.Dispose()
}
