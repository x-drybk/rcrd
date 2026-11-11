Option Explicit

Dim shell, fileSystem, projectRoot, powerShellScript, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fileSystem.BuildPath(projectRoot, "scripts\Start-RCRD.ps1")
command = "PowerShell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & powerShellScript & Chr(34) & " -Action start -RcrdChrome"

exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  MsgBox "RCRD could not start or open its Chrome app window." & vbCrLf & vbCrLf & _
    "The server may still be running. Check that Chrome is installed; do not delete or copy any browser profile data." & vbCrLf & vbCrLf & _
    "Open README.md for official download and first-run setup links, or RCRD.cmd for status and troubleshooting.", _
    vbExclamation, "RCRD"
End If
