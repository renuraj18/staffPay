@echo off
rem Portable StaffPay: creates a desktop shortcut to StaffPay.exe in this folder.
setlocal
set "EXE=%~dp0StaffPay.exe"
if not exist "%EXE%" (
  echo StaffPay.exe was not found next to this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\StaffPay.lnk');" ^
  "$s.TargetPath = '%EXE%'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Attendance and salary'; $s.Save()"
if errorlevel 1 (
  echo Could not create the shortcut.
  pause
  exit /b 1
)
echo Desktop shortcut "StaffPay" created.
timeout /t 3 >nul
