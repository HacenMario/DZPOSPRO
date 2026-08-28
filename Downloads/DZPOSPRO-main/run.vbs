' DZ POS PRO — Windows launcher
' Starts the backend server (npm run dev) and opens the app in the browser.
' Uses this script's own folder so it works no matter where you unzip.

Set objShell = CreateObject("WScript.Shell")
Set objFSO  = CreateObject("Scripting.FileSystemObject")

strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strBackendDir = objFSO.BuildPath(strScriptDir, "backend")

If Not objFSO.FolderExists(strBackendDir) Then
    MsgBox "Backend folder not found at:" & vbCrLf & strBackendDir & vbCrLf & vbCrLf & _
           "Please make sure you extracted the full project.", vbCritical, "DZ POS PRO"
    WScript.Quit 1
End If

' Read PORT from .env (default 3001)
strPort = "3001"
strEnvFile = objFSO.BuildPath(strBackendDir, ".env")
If objFSO.FileExists(strEnvFile) Then
    Set objFile = objFSO.OpenTextFile(strEnvFile, 1)
    Do Until objFile.AtEndOfStream
        strLine = Trim(objFile.ReadLine)
        If Left(strLine, 5) = "PORT=" Then
            strPort = Trim(Mid(strLine, 6))
            Exit Do
        End If
    Loop
    objFile.Close
End If

objShell.CurrentDirectory = strBackendDir

' Install deps if node_modules is missing
If Not objFSO.FolderExists(objFSO.BuildPath(strBackendDir, "node_modules")) Then
    MsgBox "Installing dependencies (first run only)...", vbInformation, "DZ POS PRO"
    objShell.Run "cmd /c npm install", 0, True
End If

' Start the server (hidden window)
objShell.Run "cmd /c npm run dev", 0, False

' Wait for the server to come up
WScript.Sleep 3500

' Open the browser
objShell.Run "http://localhost:" & strPort, 1, False

MsgBox "DZ POS PRO is running on http://localhost:" & strPort & vbCrLf & vbCrLf & _
       "Use stop.vbs to stop the server.", vbInformation, "DZ POS PRO"
