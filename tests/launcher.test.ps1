$ErrorActionPreference = 'Stop'
# Use the real directory security descriptor without depending on PowerShell module autoload inside npm.
function Get-Acl { param([string]$LiteralPath) return [System.IO.Directory]::GetAccessControl($LiteralPath) }
$launcher = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Start-RCRD.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'The launcher did not parse.' }

foreach ($name in @('Get-ConfiguredPort', 'Get-ManagedProcess', 'Stop-RcrdProcess', 'Get-RcrdChromePath', 'Initialize-RcrdWindowProbe', 'Get-RcrdChromeWindowRecords', 'Get-ExistingRcrdChrome', 'Activate-RcrdChromeWindow', 'Wait-ForRcrdChromeWindow', 'Get-RcrdFirefoxPath', 'New-RcrdPrivateDirectorySecurity', 'Assert-RcrdPrivateDirectorySecurity', 'Ensure-RcrdPrivateDirectory', 'Test-RcrdFirefoxProfileInUse', 'Get-RcrdWebAppId', 'Get-ExistingRcrdFirefox', 'Open-Rcrd')) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $definition) { throw "Missing launcher function: $name" }
  Set-Item -Path "Function:\$name" -Value $definition.Body.GetScriptBlock()
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Case)
  if ($Actual -ne $Expected) { throw "$Case failed: expected $Expected, received $Actual" }
}

$previousPort = $env:PORT
$portFixture = New-Item -ItemType File -Path (Join-Path ([System.IO.Path]::GetTempPath()) ("rcrd-launcher-test-{0}.env" -f [guid]::NewGuid().ToString('N')))
try {
  $env:PORT = $null
  Assert-Equal (Get-ConfiguredPort -EnvFile "$($portFixture.FullName)-missing") 3000 'default port'
  Set-Content -LiteralPath $portFixture.FullName -Value 'PORT="4321"'
  Assert-Equal (Get-ConfiguredPort -EnvFile $portFixture.FullName) 4321 'quoted file port'
  $env:PORT = '5432'
  Assert-Equal (Get-ConfiguredPort -EnvFile $portFixture.FullName) 5432 'environment port precedence'
  $env:PORT = '65536'
  $invalidPortRejected = $false
  try { Get-ConfiguredPort -EnvFile $portFixture.FullName | Out-Null } catch { $invalidPortRejected = $true }
  Assert-Equal $invalidPortRejected $true 'invalid port rejection'
} finally {
  $env:PORT = $previousPort
  Remove-Item -LiteralPath $portFixture.FullName -Force
}

$ProjectRoot = 'C:\synthetic-rcrd'
$ServerFile = Join-Path $ProjectRoot 'server.js'
$PidFile = Join-Path $ProjectRoot '.data/rcrd-server.json'
$Port = 4321
$script:ProcessStart = [datetime]'2026-09-23T12:00:00Z'
$script:Runtime = [pscustomobject]@{
  pid = 24680
  port = $Port
  root = $ProjectRoot
  startedAt = $script:ProcessStart.AddSeconds(1).ToString('o')
}
$script:Process = [pscustomobject]@{ Id = 24680; ProcessName = 'node'; StartTime = $script:ProcessStart }
$script:Process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($timeout) $true }
$script:ProcessInfo = [pscustomobject]@{
  ProcessId = 24680
  CommandLine = '"C:\Program Files\nodejs\node.exe" "C:\synthetic-rcrd\server.js"'
}
$script:OwnerId = 24680
$script:RuntimePresent = $true
$script:StoppedId = 0
$script:RemovedPid = $false

function Test-Path { param([string]$LiteralPath) return $script:RuntimePresent }
function Get-Content { param([string]$LiteralPath, [switch]$Raw) return ($script:Runtime | ConvertTo-Json -Compress) }
function Get-Process { param([int]$Id, $ErrorAction) if ($Id -eq $script:Process.Id) { return $script:Process }; return $null }
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $script:ProcessInfo }
function Get-PortOwnerId { return $script:OwnerId }
function Stop-Process { param($InputObject, [switch]$Force) $script:StoppedId = $InputObject.Id }
function Remove-Item { param([string]$LiteralPath, [switch]$Force, $ErrorAction) $script:RemovedPid = $true }

$health = [pscustomobject]@{ pid = 24680 }
Assert-Equal (Get-ManagedProcess -Health $health).Id 24680 'managed process match'

$script:ProcessInfo.CommandLine = '"C:\Program Files\nodejs\node.exe" "C:\other-project\server.js"'
Assert-Equal (Get-ManagedProcess -Health $health) $null 'unrelated Node process rejection'
Assert-Equal (Stop-RcrdProcess -Health $health) $false 'unauthorized stop rejection'
Assert-Equal $script:StoppedId 0 'unrelated process remains running'
$script:ProcessInfo.CommandLine = '"C:\Program Files\nodejs\node.exe" "C:\synthetic-rcrd\server.js"'

$script:OwnerId = 99999
Assert-Equal (Get-ManagedProcess -Health $health) $null 'different port owner rejection'
$script:OwnerId = 24680

$script:Runtime.root = 'C:\other-project'
Assert-Equal (Get-ManagedProcess -Health $health) $null 'different project root rejection'
$script:Runtime.root = $ProjectRoot

$script:Runtime.port = 5000
Assert-Equal (Get-ManagedProcess -Health $health) $null 'different configured port rejection'
$script:Runtime.port = $Port

$script:Runtime.startedAt = $script:ProcessStart.AddHours(-1).ToString('o')
Assert-Equal (Get-ManagedProcess -Health $health) $null 'stale PID record rejection'
$script:Runtime.startedAt = $script:ProcessStart.AddSeconds(1).ToString('o')

$script:RuntimePresent = $false
Assert-Equal (Get-ManagedProcess -Health $health) $null 'missing PID record rejection'
$script:RuntimePresent = $true

Assert-Equal (Get-ManagedProcess -Health $null).Id 24680 'verified unresponsive process match'
$ProjectRoot = 'C:\synthetic rcrd'
$ServerFile = Join-Path $ProjectRoot 'server.js'
$script:Runtime.root = $ProjectRoot
$script:ProcessInfo.CommandLine = '"C:\Program Files\nodejs\node.exe" "C:\synthetic rcrd\server.js"'
Assert-Equal (Get-ManagedProcess -Health $health).Id 24680 'quoted path with spaces match'
Assert-Equal (Stop-RcrdProcess -Health $health) $true 'managed stop'
Assert-Equal $script:StoppedId 24680 'managed process selected for stop'
Assert-Equal $script:RemovedPid $true 'PID record cleanup'

$originalProgramFiles = $env:ProgramFiles
$originalProgramFilesX86 = ${env:ProgramFiles(x86)}
$originalLocalAppData = $env:LOCALAPPDATA
try {
  $env:ProgramFiles = 'C:\synthetic-program-files'
  ${env:ProgramFiles(x86)} = 'C:\synthetic-program-files-x86'
  $env:LOCALAPPDATA = 'C:\synthetic-local-app-data'
  $script:FirefoxExists = $true
  $script:ChromeExists = $false
  function Test-Path {
    param([string]$LiteralPath, $PathType)
    return ($script:FirefoxExists -and $LiteralPath -eq 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe') -or
      ($script:ChromeExists -and $LiteralPath -eq 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe')
  }
  Assert-Equal (Get-RcrdFirefoxPath) 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe' 'dedicated Firefox executable'
  $script:FirefoxExists = $false
  $missingFirefoxRejected = $false
  try { Get-RcrdFirefoxPath | Out-Null } catch { $missingFirefoxRejected = $true }
  Assert-Equal $missingFirefoxRejected $true 'missing Firefox does not fall back to primary browser'
  $script:ChromeExists = $true
  Assert-Equal (Get-RcrdChromePath) 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe' 'dedicated Chrome executable'
  $script:ChromeExists = $false
  $missingChromeRejected = $false
  try { Get-RcrdChromePath | Out-Null } catch { $missingChromeRejected = $true }
  Assert-Equal $missingChromeRejected $true 'missing Chrome does not fall back to primary browser'
} finally {
  $env:ProgramFiles = $originalProgramFiles
  ${env:ProgramFiles(x86)} = $originalProgramFilesX86
  $env:LOCALAPPDATA = $originalLocalAppData
}

function Test-Path { param([string]$LiteralPath, $PathType) return [System.IO.Directory]::Exists($LiteralPath) -or [System.IO.File]::Exists($LiteralPath) }
$fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('rcrd-firefox-profile-test-' + [guid]::NewGuid().ToString('N'))
try {
  Ensure-RcrdPrivateDirectory $fixtureDirectory
  Assert-Equal ([System.IO.Directory]::Exists($fixtureDirectory)) $true 'private directory created'
  Assert-Equal (Get-Acl -LiteralPath $fixtureDirectory).AreAccessRulesProtected $true 'new directory has protected permissions'
  Ensure-RcrdPrivateDirectory $fixtureDirectory
} finally {
  if ([System.IO.Directory]::Exists($fixtureDirectory)) { [System.IO.Directory]::Delete($fixtureDirectory) }
}

$unsafeDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('rcrd-existing-acl-test-' + [guid]::NewGuid().ToString('N'))
try {
  [System.IO.Directory]::CreateDirectory($unsafeDirectory) | Out-Null
  $unsafeSecurity = New-RcrdPrivateDirectorySecurity
  $foreign = [System.Security.Principal.SecurityIdentifier]'S-1-5-11'
  $unsafeSecurity.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($foreign, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, [System.Security.AccessControl.AccessControlType]::Allow))
  $script:UnsafeSecurity = $unsafeSecurity
  function Get-Acl { param([string]$LiteralPath) return $script:UnsafeSecurity }
  $unsafeRejected = $false
  try { Ensure-RcrdPrivateDirectory $unsafeDirectory } catch { $unsafeRejected = $_.Exception.Message -match 'another Windows account' }
  Assert-Equal $unsafeRejected $true 'existing broad access is rejected without changing it'
  Assert-Equal (@($unsafeSecurity.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-11' }).Count -gt 0) $true 'existing access is preserved for user review'

  $safeInheritedSecurity = New-RcrdPrivateDirectorySecurity
  $safeInheritedSecurity.SetAccessRuleProtection($false, $false)
  $script:UnsafeSecurity = $safeInheritedSecurity
  $rootRejected = $false
  try { Ensure-RcrdPrivateDirectory $unsafeDirectory } catch { $rootRejected = $_.Exception.Message -match 'inherits Windows permissions' }
  Assert-Equal $rootRejected $true 'storage root must not inherit permissions'
  Ensure-RcrdPrivateDirectory $unsafeDirectory -AllowInherited
  $foreignInheritedSecurity = New-RcrdPrivateDirectorySecurity
  $foreignInheritedSecurity.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($foreign, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, [System.Security.AccessControl.AccessControlType]::Allow))
  $foreignInheritedSecurity.SetAccessRuleProtection($false, $false)
  $script:UnsafeSecurity = $foreignInheritedSecurity
  $childRejected = $false
  try { Ensure-RcrdPrivateDirectory $unsafeDirectory -AllowInherited } catch { $childRejected = $_.Exception.Message -match 'another Windows account' }
  Assert-Equal $childRejected $true 'inherited profile permissions still reject another account'
} finally {
  if ([System.IO.Directory]::Exists($unsafeDirectory)) { [System.IO.Directory]::Delete($unsafeDirectory) }
}

function Test-Path { param([string]$LiteralPath, $PathType) return $true }
function Get-Item { param([string]$LiteralPath, [switch]$Force) return [pscustomobject]@{ PSIsContainer = $true; Attributes = [System.IO.FileAttributes]::ReparsePoint } }
$linkedProfileRejected = $false
try { Ensure-RcrdPrivateDirectory 'C:\synthetic-rcrd\.data\firefox-profile' } catch { $linkedProfileRejected = $true }
Assert-Equal $linkedProfileRejected $true 'linked profile rejected'
function Get-Item { param([string]$LiteralPath, [switch]$Force) return [pscustomobject]@{ PSIsContainer = $false; Attributes = [System.IO.FileAttributes]::Normal } }
$fileProfileRejected = $false
try { Ensure-RcrdPrivateDirectory 'C:\synthetic-rcrd\.data\firefox-profile' } catch { $fileProfileRejected = $true }
Assert-Equal $fileProfileRejected $true 'non-directory profile rejected'

function Test-Path { param([string]$LiteralPath, $PathType) return (Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType) }
$lockFixture = Join-Path ([System.IO.Path]::GetTempPath()) ('rcrd-firefox-lock-test-' + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($lockFixture) | Out-Null
$lockFixturePath = Join-Path $lockFixture 'parent.lock'
try {
  Assert-Equal (Test-RcrdFirefoxProfileInUse -Profile $lockFixture) $false 'missing lock is not in use'
  [System.IO.File]::WriteAllBytes($lockFixturePath, [byte[]]@())
  Assert-Equal (Test-RcrdFirefoxProfileInUse -Profile $lockFixture) $false 'stale unlocked file is not in use'
  $heldLock = [System.IO.File]::Open($lockFixturePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
  try { Assert-Equal (Test-RcrdFirefoxProfileInUse -Profile $lockFixture) $true 'active profile lock detected' }
  finally { $heldLock.Dispose() }
} finally {
  if ([System.IO.File]::Exists($lockFixturePath)) { [System.IO.File]::Delete($lockFixturePath) }
  [System.IO.Directory]::Delete($lockFixture)
}

$script:HasRegistration = $false
$script:RegistryLength = 200
$script:RegistryAttributes = [System.IO.FileAttributes]::Normal
$script:WebAppId = '11111111-2222-3333-4444-555555555555'
$script:WebAppRegistryJson = '{"taskbarTabs":[{"id":"' + $script:WebAppId + '","userContextId":0,"startUrl":"http://127.0.0.1:4321/"}]}'
function Test-Path { param([string]$LiteralPath, $PathType) return $script:HasRegistration }
function Get-Item { param([string]$LiteralPath, [switch]$Force) return [pscustomobject]@{ Attributes = $script:RegistryAttributes; Length = $script:RegistryLength } }
function Get-Content { param([string]$LiteralPath, [switch]$Raw) return $script:WebAppRegistryJson }
$testProfile = 'C:\synthetic-rcrd\.data\firefox-profile'
Assert-Equal (Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:4321/') $null 'unregistered app uses normal setup window'
$script:HasRegistration = $true
Assert-Equal (Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:4321/') $script:WebAppId 'exact local web-app registration'
Assert-Equal (Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:5000/') $null 'different local port is not reused'
$script:RegistryLength = 70000
$unsafeRegistrationRejected = $false
try { Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:4321/' | Out-Null } catch { $unsafeRegistrationRejected = $true }
Assert-Equal $unsafeRegistrationRejected $true 'oversized registration rejected'
$script:RegistryLength = 200
$script:RegistryAttributes = [System.IO.FileAttributes]::ReparsePoint
$unsafeRegistrationRejected = $false
try { Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:4321/' | Out-Null } catch { $unsafeRegistrationRejected = $true }
Assert-Equal $unsafeRegistrationRejected $true 'linked registration rejected'
$script:RegistryAttributes = [System.IO.FileAttributes]::Normal
$script:WebAppRegistryJson = '{"taskbarTabs":[{"id":"not-an-id","userContextId":0,"startUrl":"http://127.0.0.1:4321/"}]}'
$invalidRegistrationRejected = $false
try { Get-RcrdWebAppId -Profile $testProfile -AppUrl 'http://127.0.0.1:4321/' | Out-Null } catch { $invalidRegistrationRejected = $true }
Assert-Equal $invalidRegistrationRejected $true 'malformed registration rejected'
$script:WebAppRegistryJson = '{"taskbarTabs":[{"id":"' + $script:WebAppId + '","userContextId":0,"startUrl":"http://127.0.0.1:4321/"}]}'

$script:FirefoxProcessInfo = [pscustomobject]@{
  ProcessId = 13579
  ExecutablePath = 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe'
  CommandLine = '"C:\synthetic-program-files\Mozilla Firefox\firefox.exe" -no-remote -profile "C:\synthetic-rcrd\.data\firefox-profile" -new-window http://127.0.0.1:4321/'
}
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $script:FirefoxProcessInfo }
function Get-Process { param([int]$Id, $ErrorAction) if ($Id -eq 13579) { return [pscustomobject]@{ Id = 13579; ProcessName = 'firefox' } }; return $null }
Assert-Equal (Get-ExistingRcrdFirefox -Firefox $script:FirefoxProcessInfo.ExecutablePath -Profile 'C:\synthetic-rcrd\.data\firefox-profile').Id 13579 'matching dedicated Firefox process'
Assert-Equal (Get-ExistingRcrdFirefox -Firefox $script:FirefoxProcessInfo.ExecutablePath -Profile 'C:\synthetic-rcrd\.data\different-profile') $null 'different Firefox profile rejected'
$script:FirefoxProcessInfo.ExecutablePath = 'C:\other-firefox\firefox.exe'
Assert-Equal (Get-ExistingRcrdFirefox -Firefox 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe' -Profile 'C:\synthetic-rcrd\.data\firefox-profile') $null 'different Firefox executable rejected'

Initialize-RcrdWindowProbe

$script:ChromeWindows = @([pscustomobject]@{ Id = 24681; ProcessName = 'chrome'; Path = 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe'; MainWindowHandle = 0; MainWindowTitle = '' })
$script:ChromeProfileRecord = [pscustomobject]@{ ProcessId = 24681; Handles = @(1) }
$chromeProfile = 'C:\synthetic-rcrd\.data\chrome-profile'
function Get-RcrdChromeWindowRecords { param([string]$Profile) if ($Profile -eq $chromeProfile) { return $script:ChromeProfileRecord }; return $null }
function Get-Process { param([int]$Id, $ErrorAction) return @($script:ChromeWindows | Where-Object Id -eq $Id)[0] }
$chromeExecutable = 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe'
Assert-Equal (Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile).Id 24681 'matching dedicated Chrome profile window'
Assert-Equal (Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile 'C:\different-profile') $null 'unrelated Chrome profile ignored'
$script:ChromeWindows[0].ProcessName = 'firefox'
$wrongProcessRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $wrongProcessRejected = $_.Exception.Message -match 'could not verify its Chrome profile owner' }
Assert-Equal $wrongProcessRejected $true 'non-Chrome profile owner blocks another launch'
$script:ChromeWindows[0].ProcessName = 'chrome'
$script:ChromeWindows[0].Path = 'C:\other-chrome\chrome.exe'
$wrongExecutableRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $wrongExecutableRejected = $_.Exception.Message -match 'could not verify its Chrome profile owner' }
Assert-Equal $wrongExecutableRejected $true 'different Chrome executable blocks another launch'
$script:ChromeWindows[0].Path = $null
$unverifiedChromeRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $unverifiedChromeRejected = $_.Exception.Message -match 'could not verify its Chrome profile owner' }
Assert-Equal $unverifiedChromeRejected $true 'unverifiable matching window blocks another launch'
$script:ChromeWindows[0].Path = $chromeExecutable
$script:WindowEnumerationFails = $true
function Get-RcrdChromeWindowRecords { param([string]$Profile) if ($script:WindowEnumerationFails) { throw 'Synthetic window enumeration failure.' }; if ($Profile -eq $chromeProfile) { return $script:ChromeProfileRecord }; return $null }
$enumerationRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $enumerationRejected = $_.Exception.Message -match 'could not verify its Chrome profile owner' }
Assert-Equal $enumerationRejected $true 'failed window enumeration blocks another launch'
$script:WindowEnumerationFails = $false
$script:ChromeProfileRecord.Handles = @(1, 2)
$duplicateRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $duplicateRejected = $_.Exception.Message -match 'More than one RCRD Chrome window' }
Assert-Equal $duplicateRejected $true 'existing duplicate windows block another launch'
$script:ChromeProfileRecord.Handles = @(1)
Assert-Equal (Wait-ForRcrdChromeWindow -Chrome $chromeExecutable -Profile $chromeProfile -TimeoutMs 0).Id 24681 'observable Chrome window completes launch'
$script:ChromeProfileRecord.Handles = @()
$hiddenProfileRejected = $false
try { Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile | Out-Null } catch { $hiddenProfileRejected = $_.Exception.Message -match 'without a visible window' }
Assert-Equal $hiddenProfileRejected $true 'running profile without a window blocks another launch'
Assert-Equal (Get-ExistingRcrdChrome -Chrome $chromeExecutable -Profile $chromeProfile -AllowStarting) $null 'new Chrome process may still create its window'
$missingWindowRejected = $false
try { Wait-ForRcrdChromeWindow -Chrome $chromeExecutable -Profile $chromeProfile -TimeoutMs 0 | Out-Null } catch { $missingWindowRejected = $_.Exception.Message -match 'could not be confirmed' }
Assert-Equal $missingWindowRejected $true 'unconfirmed Chrome launch fails without an unbounded wait'

function Get-RcrdFirefoxPath { return 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe' }
function Get-ExistingRcrdFirefox { return $script:ExistingFirefox }
function Test-RcrdFirefoxProfileInUse { return $script:ProfileLocked }
$script:ProfileDirs = @()
function Ensure-RcrdPrivateDirectory { param([string]$Path) $script:ProfileDirs += $Path }
$script:Launched = @()
function Start-Process {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [switch]$PassThru)
  $script:Launched += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = $ArgumentList; WorkingDirectory = $WorkingDirectory }
  $exitCode = if ($FilePath -like '*chrome.exe') { $script:ChromeExitCode } else { 0 }
  $launched = [pscustomobject]@{ ExitCode = $exitCode; IsChrome = ($FilePath -like '*chrome.exe') }
  $launched | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
    param($timeout)
    if ($this.IsChrome) { return $script:ChromeExitsImmediately }
    return $script:FirefoxExitsImmediately
  }
  return $launched
}
$ProjectRoot = 'C:\synthetic-rcrd'
$DataDirectory = Join-Path $ProjectRoot '.data'
$Url = 'http://127.0.0.1:4321/'
$RcrdChrome = $false
$RcrdFirefox = $true
$NoBrowser = $true
$script:ExistingFirefox = $null
$script:ProfileLocked = $false
$script:FirefoxExitsImmediately = $false
Open-Rcrd
Assert-Equal $script:Launched.Count 0 'NoBrowser skips Firefox'
$NoBrowser = $false
$script:ProfileLocked = $true
$profileLockRejected = $false
try { Open-Rcrd } catch { $profileLockRejected = $_.Exception.Message -match 'profile is in use' }
Assert-Equal $profileLockRejected $true 'locked unverifiable profile is not launched'
Assert-Equal $script:Launched.Count 0 'profile lock creates no Firefox process'
$script:ProfileLocked = $false
$script:HasRegistration = $false
Open-Rcrd
Assert-Equal $script:Launched.Count 1 'dedicated Firefox setup window launched once'
Assert-Equal $script:Launched[0].FilePath 'C:\synthetic-program-files\Mozilla Firefox\firefox.exe' 'Firefox executable used'
Assert-Equal ($script:Launched[0].ArgumentList -join '|') ('-no-remote|-profile|"C:\synthetic-rcrd\.data\firefox-profile"|-new-window|http://127.0.0.1:4321/') 'isolated first-run setup arguments'
$script:HasRegistration = $true
Open-Rcrd
Assert-Equal $script:Launched.Count 2 'registered app launched once'
Assert-Equal ($script:Launched[1].ArgumentList -join '|') ('-no-remote|-profile|"C:\synthetic-rcrd\.data\firefox-profile"|-taskbar-tab|' + $script:WebAppId + '|-new-window|http://127.0.0.1:4321/|-container|0') 'registered app-window arguments'
$script:FirefoxExitsImmediately = $true
$earlyExitRejected = $false
try { Open-Rcrd } catch { $earlyExitRejected = $_.Exception.Message -match 'exited immediately' }
Assert-Equal $earlyExitRejected $true 'immediate Firefox exit is reported'
$script:FirefoxExitsImmediately = $false
Assert-Equal $script:Launched[0].WorkingDirectory $ProjectRoot 'Firefox working directory'
Assert-Equal @($script:ProfileDirs | Where-Object { $_ -notin @('C:\synthetic-rcrd\.data', 'C:\synthetic-rcrd\.data\firefox-profile') }).Count 0 'only private profile directories'
$script:ExistingFirefox = [pscustomobject]@{ Id = 13579 }
$script:ActivatedId = 0
$script:ActivationWorks = $true
function New-Object {
  param([string]$ComObject)
  $window = [pscustomobject]@{}
  $window | Add-Member -MemberType ScriptMethod -Name AppActivate -Value { param($id) $script:ActivatedId = $id; return $script:ActivationWorks }
  return $window
}
Open-Rcrd
Assert-Equal $script:Launched.Count 3 'already-open profile does not launch again'
Assert-Equal $script:ActivatedId 13579 'already-open profile is activated'

function Get-RcrdChromePath { return 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe' }
function Get-ExistingRcrdChrome { param([string]$Chrome, [string]$Profile) $script:CheckedChromeProfile = $Profile; return $script:ExistingChrome }
function Activate-RcrdChromeWindow { param($Window) $script:ActivatedId = $Window.Id; return $script:ActivationWorks }
function Wait-ForRcrdChromeWindow { param([string]$Chrome, [string]$Profile) $script:WaitedChrome = $Chrome; $script:WaitedProfile = $Profile; if (-not $script:ChromeWindowReady) { throw 'Chrome started, but the RCRD window could not be confirmed.' } }
$RcrdFirefox = $false
$RcrdChrome = $true
$NoBrowser = $true
$script:ChromeExitsImmediately = $false
$script:ChromeExitCode = 0
$script:Launched = @()
$script:ProfileDirs = @()
$script:ExistingChrome = $null
$script:ChromeWindowReady = $true
$script:WaitedChrome = ''
Open-Rcrd
Assert-Equal $script:Launched.Count 0 'NoBrowser skips Chrome'
$NoBrowser = $false
Open-Rcrd
Assert-Equal $script:Launched.Count 1 'Chrome app window requested'
Assert-Equal $script:Launched[0].FilePath 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe' 'Chrome executable used'
Assert-Equal ($script:Launched[0].ArgumentList -join '|') ('--no-first-run|--no-default-browser-check|--force-dark-mode|--start-maximized|--user-data-dir="C:\synthetic-rcrd\.data\chrome-profile"|--app=http://127.0.0.1:4321/') 'isolated maximized dark app-window arguments'
Assert-Equal $script:Launched[0].WorkingDirectory $ProjectRoot 'Chrome working directory'
Assert-Equal $script:WaitedChrome 'C:\synthetic-program-files\Google\Chrome\Application\chrome.exe' 'Chrome launch waits for an observable window'
Assert-Equal $script:WaitedProfile 'C:\synthetic-rcrd\.data\chrome-profile' 'Chrome launch waits on the dedicated profile'
Assert-Equal $script:CheckedChromeProfile 'C:\synthetic-rcrd\.data\chrome-profile' 'Chrome lookup uses the dedicated profile'
Assert-Equal @($script:ProfileDirs | Where-Object { $_ -notin @('C:\synthetic-rcrd\.data', 'C:\synthetic-rcrd\.data\chrome-profile') }).Count 0 'Chrome uses only private profile directories'
$script:ExistingChrome = [pscustomobject]@{ Id = 24681 }
Open-Rcrd
Assert-Equal $script:Launched.Count 1 'already-open Chrome app does not launch again'
Assert-Equal $script:ActivatedId 24681 'already-open Chrome app is activated'
$script:ActivationWorks = $false
$activationRejected = $false
try { Open-Rcrd } catch { $activationRejected = $_.Exception.Message -match 'could not be activated' }
Assert-Equal $activationRejected $true 'failed Chrome activation does not open a duplicate'
Assert-Equal $script:Launched.Count 1 'failed activation leaves Chrome process count unchanged'
$script:ActivationWorks = $true
$script:ExistingChrome = $null
$script:ChromeExitsImmediately = $true
Open-Rcrd
Assert-Equal $script:Launched.Count 2 'normal Chrome handoff exit is accepted'
$script:ChromeExitCode = 1
$failedChromeRejected = $false
try { Open-Rcrd } catch { $failedChromeRejected = $_.Exception.Message -match 'exited with code 1' }
Assert-Equal $failedChromeRejected $true 'failed Chrome launch is reported'
$script:ChromeExitCode = 0
$script:ChromeExitsImmediately = $false
$script:ChromeWindowReady = $false
$unconfirmedLaunchRejected = $false
try { Open-Rcrd } catch { $unconfirmedLaunchRejected = $_.Exception.Message -match 'could not be confirmed' }
Assert-Equal $unconfirmedLaunchRejected $true 'unconfirmed Chrome window is reported instead of claiming success'

$launcherSource = [System.IO.File]::ReadAllText($launcher)
if ($launcherSource -notmatch 'Local\\RCRD-Launcher-\$lockId' -or $launcherSource -notmatch '\$launchMutex\.WaitOne\(30000\)' -or
    $launcherSource -notmatch '\$launchMutex\.ReleaseMutex\(\)') { throw 'Launcher actions must be serialized and release their mutex.' }

$vbs = [System.IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'Launch RCRD.vbs'))
$menu = [System.IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'RCRD.cmd'))
$package = [System.IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json')) | ConvertFrom-Json
$vscodeTasks = [System.IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) '.vscode/tasks.json')) | ConvertFrom-Json
$vscodeStart = @($vscodeTasks.tasks | Where-Object { $_.label -eq 'RCRD: Start' })
$vscodeRestart = @($vscodeTasks.tasks | Where-Object { $_.label -eq 'RCRD: Restart' })
if ($vbs -notmatch '-RcrdChrome' -or ([regex]::Matches($menu, '-RcrdChrome')).Count -ne 1 -or
    $menu -notmatch '-Action restart -NoBrowser' -or $package.scripts.launch -notmatch '-RcrdChrome' -or
    $vscodeStart.Count -ne 1 -or $vscodeStart[0].args -notcontains '-RcrdChrome' -or
    $vscodeRestart.Count -ne 1 -or $vscodeRestart[0].args -notcontains '-NoBrowser') {
  throw 'The user-facing launchers must select the dedicated Chrome profile.'
}

Write-Host 'Launcher synthetic checks passed.'
