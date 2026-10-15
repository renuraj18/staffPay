; Inno Setup script for the StaffPay Windows installer.
; Built by .github/workflows/release.yml:  iscc /DAppVersion=1.2.3 installer\StaffPay.iss
; Expects dist\StaffPay.exe (from `npm run build:exe`) and writes dist\StaffPay-Setup.exe.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6F1C2A9E-5B7D-4C3E-9A1F-2D8E4B6C7A10}
AppName=StaffPay
AppVersion={#AppVersion}
AppVerName=StaffPay {#AppVersion}
AppPublisher=StaffPay
; Per-user install: no administrator rights needed, and updates install over the old version.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\StaffPay
DefaultGroupName=StaffPay
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir=..\dist
OutputBaseFilename=StaffPay-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=StaffPay
UninstallDisplayIcon={app}\StaffPay.exe
; Close a running StaffPay before replacing the exe during an update.
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\StaffPay.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\StaffPay"; Filename: "{app}\StaffPay.exe"; WorkingDir: "{app}"; Comment: "Attendance and salary"
Name: "{group}\StaffPay data folder"; Filename: "{localappdata}\StaffPay\data"
Name: "{group}\Uninstall StaffPay"; Filename: "{uninstallexe}"
Name: "{autodesktop}\StaffPay"; Filename: "{app}\StaffPay.exe"; WorkingDir: "{app}"; Comment: "Attendance and salary"; Tasks: desktopicon

[Run]
Filename: "{app}\StaffPay.exe"; Description: "Open StaffPay now"; Flags: nowait postinstall skipifsilent

; Salary data in %LOCALAPPDATA%\StaffPay\data is deliberately left in place on uninstall and update.
