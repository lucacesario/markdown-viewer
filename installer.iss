#define MyAppName "Markdown Viewer"
#define MyAppVersion "1.0.0"
#define MyAppExeName "markdown-viewer.exe"
#define MyAppPublisher "Luca Cesario"

[Setup]
AppId={{A8D52C13-20BC-4EC7-BE5A-45B1784D5610}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}

DefaultDirName={localappdata}\Programs\Markdown Viewer
DefaultGroupName=Markdown Viewer

PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible

OutputDir=dist
OutputBaseFilename=Markdown-Viewer-Setup-v{#MyAppVersion}

SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

Compression=lzma2
SolidCompression=yes
WizardStyle=modern

ChangesAssociations=yes
CloseApplications=yes

[Tasks]
Name: "desktopicon"; \
    Description: "Create a desktop shortcut"; \
    GroupDescription: "Additional shortcuts:"; \
    Flags: unchecked

Name: "mdassociation"; \
    Description: "Register Markdown Viewer for .md files"; \
    GroupDescription: "File associations:"; \
    Flags: checkedonce

[Files]
Source: "target\release\markdown-viewer.exe"; \
    DestDir: "{app}"; \
    Flags: ignoreversion

[Icons]
Name: "{group}\Markdown Viewer"; \
    Filename: "{app}\{#MyAppExeName}"

Name: "{userdesktop}\Markdown Viewer"; \
    Filename: "{app}\{#MyAppExeName}"; \
    Tasks: desktopicon

[Registry]

; ------------------------------------------------------------
; Register Markdown Viewer itself
; ------------------------------------------------------------

Root: HKCU; \
    Subkey: "Software\Classes\Applications\{#MyAppExeName}"; \
    ValueType: string; \
    ValueName: "FriendlyAppName"; \
    ValueData: "{#MyAppName}"; \
    Flags: uninsdeletekey

Root: HKCU; \
    Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; \
    ValueType: string; \
    ValueName: ".md"; \
    ValueData: ""; \
    Flags: uninsdeletevalue

Root: HKCU; \
    Subkey: "Software\Classes\Applications\{#MyAppExeName}\shell\open\command"; \
    ValueType: string; \
    ValueName: ""; \
    ValueData: """{app}\{#MyAppExeName}"" ""%1"""; \
    Flags: uninsdeletekey

; ------------------------------------------------------------
; Markdown Viewer ProgID
; ------------------------------------------------------------

Root: HKCU; \
    Subkey: "Software\Classes\MarkdownViewer.md"; \
    ValueType: string; \
    ValueName: ""; \
    ValueData: "Markdown Document"; \
    Tasks: mdassociation; \
    Flags: uninsdeletekey

Root: HKCU; \
    Subkey: "Software\Classes\MarkdownViewer.md\DefaultIcon"; \
    ValueType: string; \
    ValueName: ""; \
    ValueData: "{app}\{#MyAppExeName},0"; \
    Tasks: mdassociation

Root: HKCU; \
    Subkey: "Software\Classes\MarkdownViewer.md\shell\open\command"; \
    ValueType: string; \
    ValueName: ""; \
    ValueData: """{app}\{#MyAppExeName}"" ""%1"""; \
    Tasks: mdassociation

; ------------------------------------------------------------
; Tell Windows that Markdown Viewer can open .md
; ------------------------------------------------------------

Root: HKCU; \
    Subkey: "Software\Classes\.md\OpenWithProgids"; \
    ValueType: none; \
    ValueName: "MarkdownViewer.md"; \
    Tasks: mdassociation; \
    Flags: uninsdeletevalue

[Run]

; Optional: make choosing Markdown Viewer as the default easy.
Filename: "ms-settings:defaultapps"; \
    Description: "Choose Markdown Viewer as the default app for .md files"; \
    Flags: shellexec postinstall skipifsilent unchecked