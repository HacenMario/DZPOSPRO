' DZ POS PRO — Windows stopper
' Stops the backend server (kills all node.exe processes).

Set objShell = CreateObject("WScript.Shell")
objShell.Run "taskkill /F /IM node.exe", 0, True
MsgBox "DZ POS PRO server has been stopped.", vbInformation, "DZ POS PRO"
